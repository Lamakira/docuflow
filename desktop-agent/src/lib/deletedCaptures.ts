import fs from "fs";
import path from "path";

/**
 * Drop the local copies of captures that were deleted on the web. A capture is
 * matched by the instant in its sidecar (`capturedAt`), the same one the agent
 * sent at presign. Files without a readable sidecar are left alone.
 * Returns the number of captures removed.
 */
export async function removeDeletedCaptures(
  dir: string,
  deleted: { capturedAt: string }[]
): Promise<number> {
  const instants = new Set(deleted.map((d) => Date.parse(d.capturedAt)).filter((t) => !Number.isNaN(t)));
  if (instants.size === 0) return 0;

  let files: string[];
  try {
    files = await fs.promises.readdir(dir);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const sidecar = JSON.parse(await fs.promises.readFile(path.join(dir, file), "utf8"));
      const at = typeof sidecar?.capturedAt === "string" ? Date.parse(sidecar.capturedAt) : NaN;
      if (Number.isNaN(at) || !instants.has(at)) continue;
      const base = path.join(dir, file.slice(0, -".json".length));
      await fs.promises.unlink(`${base}.png`).catch(() => {});
      await fs.promises.unlink(path.join(dir, file)).catch(() => {});
      removed++;
    } catch {
      /* unreadable sidecar: leave it */
    }
  }
  return removed;
}
