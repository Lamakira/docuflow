import { randomBytes } from "node:crypto";

/** RFC 9562 UUIDv7 — time-ordered ids for the Outbox Event log (ADR-0013). */
export function uuidv7(nowMs = Date.now()): string {
  const bytes = randomBytes(16);
  bytes[0] = Math.floor(nowMs / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(nowMs / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(nowMs / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(nowMs / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(nowMs / 2 ** 8) & 0xff;
  bytes[5] = nowMs & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
