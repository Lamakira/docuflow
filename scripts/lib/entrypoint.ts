/**
 * Is this module the file the user ran, or was it imported?
 *
 * Every script here exports its work as a function the tests call directly, and
 * runs that function only when invoked as a command. Getting that check wrong is
 * quiet in both directions — a script that never runs, or one that runs itself
 * during a test — so all of them ask the same way.
 *
 * Real paths, not the raw strings: `tsx`, `npm`, and a symlinked checkout can
 * each hand `process.argv[1]` a path that reaches the same file by another name.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isEntryPoint(moduleUrl: string): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;

  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    // argv[1] names something unreadable: not this module, whatever it is.
    return false;
  }
}
