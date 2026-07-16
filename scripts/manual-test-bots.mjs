import { io } from "socket.io-client";

const code = process.argv[2];
const count = Number(process.argv[3] ?? 2);
const server = process.argv[4] ?? "http://127.0.0.1:3002";
if (!code) throw new Error("Usage: node scripts/manual-test-bots.mjs ROOM_CODE [COUNT] [SERVER_URL]");

for (let index = 0; index < count; index += 1) {
  const socket = io(server, { transports: ["websocket"] });
  socket.on("connect", () => {
    socket.emit("joinRoom", { code, name: `テスト${index + 1}` }, (ack) => {
      if (!ack.ok) console.error(ack.error);
    });
  });
}

setInterval(() => {}, 60_000);
