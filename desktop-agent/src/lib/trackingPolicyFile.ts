/**
 * The last Tracking Policy this Device received, kept in userData (#293) so a
 * start without the server applies it instead of the hard-coded defaults.
 * Removed on sign-out so the next account never starts on another's policy.
 */

import fs from "fs";
import path from "path";
import { normalizeTrackingPolicy, type SavedTrackingPolicy, type TrackingPolicy } from "./trackingPolicy";

export const TRACKING_POLICY_FILENAME = "tracking-policy.json";

function filePath(dir: string): string {
  return path.join(dir, TRACKING_POLICY_FILENAME);
}

export function loadSavedTrackingPolicy(dir: string): SavedTrackingPolicy | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(dir), "utf-8"));
    const policy = normalizeTrackingPolicy(raw?.policy);
    if (!policy || typeof raw.receivedAt !== "string") return null;
    return { policy, receivedAt: raw.receivedAt };
  } catch {
    return null;
  }
}

export function saveTrackingPolicy(dir: string, policy: TrackingPolicy, receivedAt: Date): void {
  const saved: SavedTrackingPolicy = { policy, receivedAt: receivedAt.toISOString() };
  const target = filePath(dir);
  const tmp = `${target}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(saved, null, 2), "utf-8");
    fs.renameSync(tmp, target);
  } catch (err) {
    console.warn("[TrackingPolicy] Could not save the policy:", (err as Error).message);
  }
}

export function clearSavedTrackingPolicy(dir: string): void {
  try {
    fs.unlinkSync(filePath(dir));
  } catch {
    /* already gone */
  }
}
