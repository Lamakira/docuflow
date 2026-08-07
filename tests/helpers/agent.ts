import { createHash, createHmac } from "crypto";
import type { Express } from "express";
import { newAgent, type Agent, type TestUser } from "./auth";

/**
 * Desktop-agent fixtures: the v1 protocol's door is a bearer token minted for a
 * device, not a session cookie, so every agent suite starts by signing a device
 * in and keeps the credentials it hands back.
 */

export interface AgentDevice {
  deviceId: string;
  deviceToken: string;
  accessToken: string;
  expiresAt: string;
  /** Pre-set with the bearer token; agent routes never look at cookies. */
  request: Agent;
}

export interface DeviceMeta {
  deviceName?: string;
  os?: string | null;
  clientVersion?: string;
}

/** Sign a registered user's desktop agent in and keep the device credentials. */
export async function loginDevice(
  app: Express,
  user: TestUser,
  deviceMeta: DeviceMeta = {}
): Promise<AgentDevice> {
  const res = await newAgent(app)
    .post("/api/agent/auth/login")
    .send({
      email: user.email,
      password: user.password,
      deviceMeta: {
        deviceName: "Test Workstation",
        os: "linux",
        clientVersion: "0.1.0",
        ...deviceMeta,
      },
    });
  if (res.status !== 200) {
    throw new Error(`loginDevice failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    deviceId: res.body.deviceId,
    deviceToken: res.body.deviceToken,
    accessToken: res.body.accessToken,
    expiresAt: res.body.expiresAt,
    request: bearer(app, res.body.accessToken),
  };
}

/** A request agent carrying an arbitrary bearer token. */
export function bearer(app: Express, accessToken: string): Agent {
  return newAgent(app).set("Authorization", `Bearer ${accessToken}`);
}

/** The claims the server packed into an access token, without verifying it. */
export function decodeJwtPayload(token: string): {
  sub: string;
  uid: string;
  iat: number;
  exp: number;
} {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
}

/**
 * The signing key `tests/setup.ts` configured, as `server/config.ts` splits it:
 * the id a token's header names, and the secret the HMAC is taken with.
 */
function harnessSigningKey(): { id: string; secret: string } {
  const separator = process.env.JWT_SECRET!.indexOf(":");
  return {
    id: process.env.JWT_SECRET!.slice(0, separator),
    secret: process.env.JWT_SECRET!.slice(separator + 1),
  };
}

/**
 * Mint an access token the server will accept as genuine.
 *
 * `tests/setup.ts` fixes `JWT_SECRET`, so a suite can sign the same HS256 token
 * `desktopTokens.ts` does — the only way to reach branches the live endpoints
 * cannot produce, such as an already-expired token. That it works at all is the
 * point of the key living in the environment: nothing but the configured key
 * connects this token to the running server.
 */
export function mintAccessToken(claims: {
  deviceId: string;
  userId: string;
  /** Seconds from now; negative for an already-expired token. */
  expiresInSeconds: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const key = harnessSigningKey();
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  const data = `${encode({ alg: "HS256", typ: "JWT", kid: key.id })}.${encode({
    sub: claims.deviceId,
    uid: claims.userId,
    iat: now,
    exp: now + claims.expiresInSeconds,
  })}`;
  const signature = createHmac("sha256", key.secret)
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `${data}.${signature}`;
}

/** The SHA-256 the server stores instead of the raw device token. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * A real 1×1 PNG.
 *
 * The upload route checks the PNG magic bytes and then hands the buffer to
 * sharp, so magic bytes alone are not enough — the image has to decode.
 */
export const PNG_1X1: Buffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
