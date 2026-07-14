/**
 * Lightweight load helper for Seller Room fingerprint publish rate.
 * Usage (with a running backend + REDIS_URL + valid JWT):
 *   SELLER_ROOM_ID=... MEETING_ID=... TOKEN=... BACKEND_HTTP=http://localhost:3001 \
 *   npx tsx scripts/seller-room-load-smoke.ts
 */
import { io } from "socket.io-client";

const backend = (process.env.BACKEND_HTTP || "http://localhost:3001").replace(/\/$/, "");
const token = process.env.TOKEN || "";
const sellerRoomId = process.env.SELLER_ROOM_ID || "";
const meetingId = process.env.MEETING_ID || "";
const tenantId = process.env.TENANT_ID || "";
const rate = Number(process.env.FP_RATE || "10");
const seconds = Number(process.env.DURATION_SEC || "5");

if (!token || !sellerRoomId || !meetingId) {
  console.error("Need TOKEN, SELLER_ROOM_ID, MEETING_ID");
  process.exit(1);
}

const socket = io(`${backend}/seller-room`, {
  transports: ["websocket"],
  auth: { token },
  query: { token, tenantId },
});

let published = 0;
let errors = 0;

socket.on("connect", () => {
  socket.emit("join-seller-room", { sellerRoomId, meetingId, tenantId });
});

socket.on("seller-room-joined", () => {
  const featureBytes = Buffer.alloc(58, 128).toString("base64");
  const started = Date.now();
  const timer = setInterval(() => {
    published += 1;
    socket.emit("fingerprint-publish", {
      sellerRoomId,
      fingerprint: {
        version: 1,
        userId: JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).sub,
        sellerRoomId,
        meetingId,
        seq: published,
        windowDurationMs: 200,
        captureMonoMs: Date.now(),
        energyDbfs: -20,
        featureType: "logmel_mfcc_v1",
        featureBytes,
      },
    });
    if (Date.now() - started >= seconds * 1000) {
      clearInterval(timer);
      console.log(JSON.stringify({ published, errors, rate, seconds }, null, 2));
      socket.close();
      process.exit(errors ? 1 : 0);
    }
  }, Math.max(10, Math.floor(1000 / rate)));
});

socket.on("error", (payload: { message?: string }) => {
  errors += 1;
  console.warn("error", payload?.message);
});
