import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertRlsInvariants } from "../../scripts/lib/rlsInvariants";
import { checkRlsInvariantsAtBoot } from "../../server/rlsInvariantsCheck";
import { RLS_EXEMPT_TABLES } from "../../shared/rlsInvariants";
import { endOwnerPool, getOwnerPool } from "../helpers/db";

/**
 * #328 / migration 0041: jobs and dead_letters must stay outside RLS. The tests
 * run on scratch tables, never the real ones: the test database is shared and
 * enabling RLS on `jobs` would break other suites mid-run.
 */
const suffix = randomBytes(4).toString("hex");
const planted = `rls_probe_${suffix}`;
const clean = `rls_probe_clean_${suffix}`;

async function state(table: string) {
  const { rows } = await getOwnerPool().query(
    `SELECT c.relrowsecurity AS rls,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
       FROM pg_class c WHERE c.oid = to_regclass($1)`,
    [table]
  );
  return rows[0] as { rls: boolean; policies: number };
}

async function plant() {
  const pool = getOwnerPool();
  await pool.query(`ALTER TABLE ${planted} ENABLE ROW LEVEL SECURITY`);
  await pool.query(`CREATE POLICY workspace_isolation ON ${planted} USING (true)`);
}

describe("RLS invariants (#328)", () => {
  beforeAll(async () => {
    const pool = getOwnerPool();
    await pool.query(`CREATE TABLE ${planted} (id int)`);
    await pool.query(`CREATE TABLE ${clean} (id int)`);
  });

  afterAll(async () => {
    const pool = getOwnerPool();
    await pool.query(`DROP TABLE IF EXISTS ${planted}, ${clean}`);
    await endOwnerPool();
  });

  it("covers jobs and dead_letters, which are currently outside RLS", async () => {
    expect([...RLS_EXEMPT_TABLES]).toEqual(["jobs", "dead_letters"]);
    for (const table of RLS_EXEMPT_TABLES) expect((await state(table)).rls).toBe(false);
  });

  it("drops the policy and disables RLS, reports it, and is a no-op the second time", async () => {
    await plant();
    expect(await state(planted)).toEqual({ rls: true, policies: 1 });

    const lines: string[] = [];
    const changes = await assertRlsInvariants(getOwnerPool(), (m) => lines.push(m), [planted]);

    expect(changes).toEqual([`${planted}: RLS disabled, policy workspace_isolation dropped`]);
    expect(lines).toEqual([`[invariants] ${planted}: RLS disabled, policy workspace_isolation dropped`]);
    expect(await state(planted)).toEqual({ rls: false, policies: 0 });

    const again: string[] = [];
    expect(await assertRlsInvariants(getOwnerPool(), (m) => again.push(m), [planted])).toEqual([]);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatch(/nothing changed/);
  });

  it("leaves a correct table alone", async () => {
    const lines: string[] = [];
    expect(await assertRlsInvariants(getOwnerPool(), (m) => lines.push(m), [clean])).toEqual([]);
    expect(lines).toEqual([`[invariants] ${clean}: already outside RLS, nothing changed`]);
  });

  it("boot check names the table and the fix when RLS is on", async () => {
    await plant();
    const reported: string[] = [];
    const message = await checkRlsInvariantsAtBoot(getOwnerPool(), [planted, clean], (m) => reported.push(m));

    expect(reported).toEqual([message]);
    expect(message).toContain(planted);
    expect(message).not.toContain(clean);
    expect(message).toContain(`DROP POLICY IF EXISTS workspace_isolation ON ${planted}`);
    expect(message).toContain(`ALTER TABLE ${planted} DISABLE ROW LEVEL SECURITY`);
    expect(message).toMatch(/next publish/);
  });

  it("boot check is silent when everything is off, and ignores a failing query", async () => {
    await assertRlsInvariants(getOwnerPool(), () => {}, [planted]);
    const reported: string[] = [];
    expect(await checkRlsInvariantsAtBoot(getOwnerPool(), [planted, clean], (m) => reported.push(m))).toBeNull();
    expect(reported).toEqual([]);

    const broken = { query: async () => { throw new Error("db down"); } };
    expect(await checkRlsInvariantsAtBoot(broken, [planted], (m) => reported.push(m))).toBeNull();
    expect(reported).toEqual([]);
  });
});
