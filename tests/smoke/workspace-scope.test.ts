import { describe, expect, it, vi } from "vitest";
import { UnscopedRlsQueryError, bindWorkspaceScope } from "../../server/workspaceScope";
import { runWithWorkspaceContext } from "../../server/workspaceContext";

/**
 * The seam in `server/workspaceScope.ts` against a fake driver, so what it sends
 * and how many connections it takes can be counted. The behaviour against a real
 * database is `workspace-rls.test.ts`.
 */

function textOf(config: unknown): string {
  return typeof config === "string" ? config : (config as { text: string }).text;
}

function fakePool() {
  const log: string[] = [];
  const client = {
    query: vi.fn(async (config: unknown) => {
      log.push(textOf(config));
      return { rows: [{ relname: "projects" }], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  const connect = vi.fn(async () => client);
  const pool = { query: vi.fn(), connect };
  return { pool, client, log, connect };
}

const setConfigs = (log: string[]) => log.filter((text) => text.includes("set_config"));

describe("workspace scope seam", () => {
  it("sets the Workspace once per scoped pool query, on a fresh or an already wrapped client", async () => {
    const { pool, log } = fakePool();
    bindWorkspaceScope(pool as never, { onUnscopedRlsQuery: "throw" });

    // The first checkout wraps the client; the pool hands the same object back later.
    const held = (await pool.connect()) as unknown as { release: () => void };
    held.release();

    for (let n = 1; n <= 2; n++) {
      log.length = 0;
      await runWithWorkspaceContext({ workspaceId: "w1" }, () => pool.query("SELECT * FROM projects" as never));
      expect(setConfigs(log), `query ${n}`).toHaveLength(1);
      expect(log).toEqual([
        "BEGIN",
        "SELECT set_config($1, $2, true)",
        "SELECT * FROM projects",
        "COMMIT",
      ]);
    }
  });

  it("runs the cold table lookup on the transaction client it is inspecting, not a second checkout", async () => {
    const { pool, log, connect } = fakePool();
    bindWorkspaceScope(pool as never, { onUnscopedRlsQuery: "throw" });

    const client = (await pool.connect()) as unknown as { query: (text: string) => Promise<unknown> };
    expect(connect).toHaveBeenCalledTimes(1);
    await client.query("BEGIN");

    await expect(client.query("SELECT * FROM projects")).rejects.toBeInstanceOf(UnscopedRlsQueryError);

    expect(connect).toHaveBeenCalledTimes(1);
    // BEGIN, then the lookup on the same client; the refused statement is never sent.
    expect(log).toEqual(["BEGIN", expect.stringContaining("pg_class")]);
  });
});
