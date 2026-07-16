import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";
import { io as createClient, type Socket } from "socket.io-client";
import type { Ack, RoomView } from "../../shared/types.js";

const port = 31_000 + (process.pid % 1_000);
const url = `http://127.0.0.1:${port}`;

const emitAck = <T>(socket: Socket, event: string, payload: unknown = {}): Promise<T> => new Promise((resolve, reject) => {
  socket.timeout(4_000).emit(event, payload, (error: Error | null, ack: Ack<T>) => {
    if (error) reject(error);
    else if (!ack.ok) reject(new Error(ack.error));
    else resolve(ack.data as T);
  });
});

const waitForServer = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch { /* 起動待ち */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("テストサーバーが起動しませんでした");
};

const connect = async (): Promise<{ socket: Socket; getState: () => RoomView | null }> => {
  let state: RoomView | null = null;
  const socket = createClient(url, { transports: ["websocket"], forceNew: true });
  socket.on("roomState", (next: RoomView) => { state = next; });
  if (!socket.connected) await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return { socket, getState: () => state };
};

const waitForState = async (getState: () => RoomView | null, check: (state: RoomView) => boolean): Promise<RoomView> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = getState();
    if (state && check(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("期待するルーム状態になりませんでした");
};

test("3クライアントで参加・再接続・決着・再戦まで進行できる", { timeout: 30_000 }, async () => {
  let server: ChildProcess | null = null;
  const clients: { socket: Socket; getState: () => RoomView | null }[] = [];
  try {
    server = spawn(process.execPath, ["dist/server/server/src/index.js"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForServer();

    const host = await connect();
    const second = await connect();
    const third = await connect();
    clients.push(host, second, third);

    const hostSession = await emitAck<{ code: string; playerId: string; token: string }>(host.socket, "createRoom", { name: "アオいろ" });
    const secondSession = await emitAck<{ code: string; playerId: string; token: string }>(second.socket, "joinRoom", { code: hostSession.code, name: "ペンギン" });
    await emitAck(third.socket, "joinRoom", { code: hostSession.code, name: "ひつじ" });
    await waitForState(host.getState, (state) => state.players.length === 3);
    await emitAck(host.socket, "startGame");
    for (const client of clients) {
      const state = await waitForState(client.getState, (next) => next.status === "playing");
      assert.equal(state.hand.length, 4);
      assert.equal(state.players.every((player) => !("hand" in player)), true);
    }

    second.socket.disconnect();
    const reconnected = await connect();
    clients[1] = reconnected;
    await emitAck(reconnected.socket, "reconnectRoom", { code: hostSession.code, token: secondSession.token });
    const restored = await waitForState(reconnected.getState, (state) => state.viewerId === secondSession.playerId);
    assert.equal(restored.hand.length, 4);

    for (let step = 0; step < 240; step += 1) {
      const states = clients.map((client) => client.getState()).filter((state): state is RoomView => Boolean(state));
      const reference = states[0];
      if (!reference) { await new Promise((resolve) => setTimeout(resolve, 20)); continue; }
      if (reference.status === "finished") break;
      const actionable = states.find((state) => state.pending && state.pending.kind !== "waiting" && state.pending.options.length > 0);
      if (actionable?.pending) {
        const client = clients.find((candidate) => candidate.getState()?.viewerId === actionable.viewerId)!;
        await emitAck(client.socket, "submitAction", { pendingId: actionable.pending.id, optionId: actionable.pending.options[0].id });
      } else if (!reference.pending) {
        const currentId = reference.players.find((player) => player.isTurn)?.id;
        const client = clients.find((candidate) => candidate.getState()?.viewerId === currentId);
        const card = client?.getState()?.hand.find((item) => item.type !== "secret");
        if (client && card) await emitAck(client.socket, "playCard", { instanceId: card.instanceId });
      }
      await new Promise((resolve) => setTimeout(resolve, 8));
    }

    const finished = await waitForState(host.getState, (state) => state.status === "finished");
    assert.ok(finished.result);
    await emitAck(host.socket, "rematch");
    const rematch = await waitForState(host.getState, (state) => state.status === "playing" && state.turnNumber === 1);
    assert.equal(rematch.players.length, 3);
    assert.equal(rematch.hand.length, 4);
  } finally {
    for (const client of clients) client.socket.disconnect();
    server?.kill();
  }
});
