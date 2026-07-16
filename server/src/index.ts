import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import type { Ack, GameSettings } from "../../shared/types.js";
import {
  addPlayer,
  cancelAction,
  createRoom,
  expirePending,
  kickPlayer,
  playCard,
  returnToLobby,
  roomView,
  startGame,
  submitAction,
  timeoutTurn,
  updateSettings,
  type ActionOutcome,
  type RoomInternal,
} from "./game.js";

const PORT = Number(process.env.PORT ?? 3002);
const app = express();
const server = createServer(app);
const io = new Server(server, { pingTimeout: 20_000, pingInterval: 10_000 });
const rooms = new Map<string, RoomInternal>();
const roomTimers = new Map<string, NodeJS.Timeout>();

const nameSchema = z.string().trim().min(1, "プレイヤー名を入力してください").max(16, "名前は16文字以内です");
const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/, "ルームコードは6文字です");
const createSchema = z.object({ name: nameSchema });
const joinSchema = z.object({ code: codeSchema, name: nameSchema });
const reconnectSchema = z.object({ code: codeSchema, token: z.string().min(20) });
const settingsSchema = z.object({
  maxPlayers: z.number().int().min(3).max(8).optional(),
  turnSeconds: z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(90)]).optional(),
  animationSpeed: z.enum(["normal", "fast"]).optional(),
});
const idSchema = z.string().uuid();

app.disable("x-powered-by");
app.get("/health", (_request, response) => response.json({ ok: true, rooms: rooms.size }));

const clientPath = path.resolve(process.cwd(), "dist/client");
app.use(express.static(clientPath, { maxAge: "1h", index: false }));
app.use((request, response, next) => {
  if (request.method === "GET" && request.accepts("html")) {
    response.sendFile(path.join(clientPath, "index.html"), (error) => error ? next(error) : undefined);
    return;
  }
  next();
});

io.on("connection", (socket) => {
  socket.on("createRoom", (input, ack: (result: Ack<{ code: string; playerId: string; token: string }>) => void) => {
    safeAck(ack, () => {
      ensureSocketFree(socket);
      const { name } = createSchema.parse(input);
      const code = generateRoomCode();
      const room = createRoom(code, name, socket.id);
      rooms.set(code, room);
      const player = room.players[0];
      socket.data.roomCode = code;
      socket.data.playerId = player.id;
      publish(room);
      return { code, playerId: player.id, token: player.token };
    });
  });

  socket.on("joinRoom", (input, ack: (result: Ack<{ code: string; playerId: string; token: string }>) => void) => {
    safeAck(ack, () => {
      ensureSocketFree(socket);
      const { code, name } = joinSchema.parse(input);
      const room = requireRoom(code);
      const player = addPlayer(room, name, socket.id);
      socket.data.roomCode = code;
      socket.data.playerId = player.id;
      publish(room);
      return { code, playerId: player.id, token: player.token };
    });
  });

  socket.on("reconnectRoom", (input, ack: (result: Ack<{ code: string; playerId: string; token: string }>) => void) => {
    safeAck(ack, () => {
      const { code, token } = reconnectSchema.parse(input);
      const room = requireRoom(code);
      const player = room.players.find((candidate) => candidate.token === token);
      if (!player) throw new Error("再接続情報が見つかりません。名前を入力して参加してください");
      const existingCode = socket.data.roomCode as string | undefined;
      const existingPlayerId = socket.data.playerId as string | undefined;
      if (existingCode || existingPlayerId) {
        if (existingCode !== code || existingPlayerId !== player.id) throw new Error("すでに別の部屋へ参加しています");
        if (player.socketId && player.socketId !== socket.id) throw new Error("この席は新しい接続で再開されています");
      }
      if (player.socketId && player.socketId !== socket.id) io.sockets.sockets.get(player.socketId)?.disconnect(true);
      player.socketId = socket.id;
      player.connected = true;
      socket.data.roomCode = code;
      socket.data.playerId = player.id;
      publish(room);
      for (const notice of player.pendingNotices) socket.emit("privateNotice", notice);
      return { code, playerId: player.id, token: player.token };
    });
  });

  socket.on("updateSettings", (input, ack: (result: Ack) => void) => {
    safeAck(ack, () => {
      const room = roomForSocket(socket);
      updateSettings(room, socket.data.playerId, settingsSchema.parse(input) as Partial<GameSettings>);
      publish(room);
    });
  });

  socket.on("kickPlayer", (input, ack: (result: Ack) => void) => {
    safeAck(ack, () => {
      const room = roomForSocket(socket);
      const targetId = idSchema.parse(input?.playerId);
      const removed = kickPlayer(room, socket.data.playerId, targetId);
      if (removed.socketId) {
        io.to(removed.socketId).emit("kicked", "ホストにより部屋から退出しました");
        io.sockets.sockets.get(removed.socketId)?.disconnect(true);
      }
      publish(room);
    });
  });

  socket.on("startGame", (_input, ack: (result: Ack) => void) => {
    safeAck(ack, () => {
      const room = roomForSocket(socket);
      startGame(room, socket.data.playerId);
      publish(room);
    });
  });

  socket.on("playCard", (input, ack: (result: Ack) => void) => {
    safeAck(ack, () => {
      const room = roomForSocket(socket);
      const instanceId = idSchema.parse(input?.instanceId);
      const outcome = playCard(room, socket.data.playerId, instanceId);
      publish(room, outcome);
    });
  });

  socket.on("submitAction", (input, ack: (result: Ack) => void) => {
    safeAck(ack, () => {
      const room = roomForSocket(socket);
      const pendingId = idSchema.parse(input?.pendingId);
      const optionId = z.string().min(1).parse(input?.optionId);
      const outcome = submitAction(room, socket.data.playerId, pendingId, optionId);
      publish(room, outcome);
    });
  });

  socket.on("cancelAction", (input, ack: (result: Ack) => void) => {
    safeAck(ack, () => {
      const room = roomForSocket(socket);
      const pendingId = idSchema.parse(input?.pendingId);
      cancelAction(room, socket.data.playerId, pendingId);
      publish(room);
    });
  });

  socket.on("ackNotice", (input, ack: (result: Ack) => void) => {
    safeAck(ack, () => {
      const room = roomForSocket(socket);
      const noticeId = idSchema.parse(input?.noticeId);
      const player = room.players.find((candidate) => candidate.id === socket.data.playerId)!;
      player.pendingNotices = player.pendingNotices.filter((notice) => notice.id !== noticeId);
    });
  });

  socket.on("rematch", (_input, ack: (result: Ack) => void) => {
    safeAck(ack, () => {
      const room = roomForSocket(socket);
      startGame(room, socket.data.playerId);
      publish(room);
    });
  });

  socket.on("returnToLobby", (_input, ack: (result: Ack) => void) => {
    safeAck(ack, () => {
      const room = roomForSocket(socket);
      returnToLobby(room, socket.data.playerId);
      publish(room);
    });
  });

  socket.on("leaveRoom", (_input, ack: (result: Ack) => void) => {
    safeAck(ack, () => {
      const room = roomForSocket(socket);
      if (room.status !== "lobby") throw new Error("ゲーム中は席を保持します。トップへ戻っても再接続できます");
      const index = room.players.findIndex((player) => player.id === socket.data.playerId);
      if (index >= 0) room.players.splice(index, 1);
      if (room.players.length === 0) {
        clearRoom(room.code);
      } else {
        if (room.hostId === socket.data.playerId) room.hostId = room.players[0].id;
        publish(room);
      }
      delete socket.data.roomCode;
      delete socket.data.playerId;
    });
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode as string | undefined;
    const playerId = socket.data.playerId as string | undefined;
    if (!code || !playerId) return;
    const room = rooms.get(code);
    const player = room?.players.find((candidate) => candidate.id === playerId);
    if (!room || !player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    publish(room);

    setTimeout(() => {
      const latest = rooms.get(code);
      const disconnected = latest?.players.find((candidate) => candidate.id === playerId);
      if (!latest || !disconnected || disconnected.connected) return;
      if (latest.status === "lobby" && disconnected.id !== latest.hostId) {
        latest.players = latest.players.filter((candidate) => candidate.id !== playerId);
        publish(latest);
      }
    }, 90_000).unref();
  });
});

function safeAck<T>(ack: ((result: Ack<T>) => void) | undefined, operation: () => T | void): void {
  if (typeof ack !== "function") return;
  try {
    const data = operation();
    ack(data === undefined ? { ok: true } : { ok: true, data: data as T });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "処理に失敗しました";
    ack({ ok: false, error: message });
  }
}

function ensureSocketFree(socket: Socket): void {
  if (socket.data.roomCode || socket.data.playerId) throw new Error("すでに部屋へ参加しています");
}

function publish(room: RoomInternal, outcome?: ActionOutcome): void {
  const oldTimer = roomTimers.get(room.code);
  if (oldTimer) clearTimeout(oldTimer);
  roomTimers.delete(room.code);

  if (outcome) {
    for (const effect of outcome.effects) {
      for (const player of room.players) {
        if (player.connected && player.socketId) io.to(player.socketId).emit("cardEffect", effect);
      }
    }
    for (const notice of outcome.notices) {
      const player = room.players.find((candidate) => candidate.id === notice.playerId);
      if (!player) continue;
      const queued = { ...notice, id: randomUUID() };
      player.pendingNotices.push(queued);
      if (player.pendingNotices.length > 20) player.pendingNotices.shift();
      if (player.socketId) io.to(player.socketId).emit("privateNotice", queued);
    }
  }

  if (room.status === "playing" && room.pending) {
    room.turnEndsAt = null;
    const delay = Math.max(0, room.pending.expiresAt - Date.now());
    const timer = setTimeout(() => {
      const latest = rooms.get(room.code);
      if (!latest?.pending || latest.pending.id !== room.pending?.id) return;
      const outcome = expirePending(latest);
      publish(latest, outcome);
    }, delay);
    timer.unref();
    roomTimers.set(room.code, timer);
  } else if (room.status === "playing") {
    const current = room.players[room.turnIndex];
    const seconds = room.settings.turnSeconds || (current.connected ? 0 : 90);
    if (!seconds) room.turnEndsAt = null;
    else if (!room.turnEndsAt) room.turnEndsAt = Date.now() + seconds * 1000;
    if (seconds) {
      const delay = Math.max(0, room.turnEndsAt! - Date.now());
      const timer = setTimeout(() => {
        const latest = rooms.get(room.code);
        if (!latest || latest.status !== "playing" || latest.pending) return;
        timeoutTurn(latest);
        publish(latest);
      }, delay);
      timer.unref();
      roomTimers.set(room.code, timer);
    }
  } else {
    room.turnEndsAt = null;
  }

  for (const player of room.players) {
    if (player.connected && player.socketId) io.to(player.socketId).emit("roomState", roomView(room, player.id));
  }
}

function generateRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function requireRoom(code: string): RoomInternal {
  const room = rooms.get(code);
  if (!room) throw new Error("部屋が見つかりません");
  return room;
}

function roomForSocket(socket: Socket): RoomInternal {
  const code = socket.data.roomCode as string | undefined;
  const playerId = socket.data.playerId as string | undefined;
  if (!code || !playerId) throw new Error("部屋へ入り直してください");
  const room = requireRoom(code);
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player || player.socketId !== socket.id) throw new Error("プレイヤー情報が見つかりません。再接続してください");
  return room;
}

function clearRoom(code: string): void {
  const timer = roomTimers.get(code);
  if (timer) clearTimeout(timer);
  roomTimers.delete(code);
  rooms.delete(code);
}

setInterval(() => {
  const expiry = Date.now() - 6 * 60 * 60 * 1000;
  for (const room of rooms.values()) {
    if (room.updatedAt < expiry || room.players.length === 0) clearRoom(room.code);
  }
}, 30 * 60 * 1000).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ひみつはめぐる server: http://localhost:${PORT}`);
});
