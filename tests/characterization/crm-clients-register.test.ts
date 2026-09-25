import { beforeEach, describe, expect, it } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerUser } from "../helpers/auth";
import { createClient, createCrmProject } from "../helpers/fixtures";

/**
 * The Clients register's page (#275). `GET /api/crm/clients` answers the whole
 * list when there is no `page`, as every Client picker reads it; with `page` it
 * narrows, orders and pages on the server, and counts each Client's Projects.
 */
describe("the Clients register page (#275)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function seed() {
    const app = await makeApp();
    const user = await registerUser(app);
    const acme = await createClient(user.agent, { name: "acme", company: "Acme Ltd", status: "client", source: "direct" });
    const bolt = await createClient(user.agent, { name: "Bolt", company: "Zeta Works", status: "lead", source: "fiverr" });
    const cairn = await createClient(user.agent, { name: "Cairn", status: "prospect" });
    await createCrmProject(user.agent, { name: "Acme site", clientId: acme.id, status: "won_in_progress" });
    await createCrmProject(user.agent, { name: "Acme app", clientId: acme.id, status: "won_completed" });
    await createCrmProject(user.agent, { name: "Bolt audit", clientId: bolt.id, status: "won_completed" });
    const names = async (query: Record<string, string>) =>
      (await user.agent.get("/api/crm/clients").query({ page: 1, ...query })).body.data.map(
        (client: { name: string }) => client.name,
      );
    return { user, acme, bolt, cairn, names };
  }

  it("keeps the plain list without page, and pages with its own Project count", async () => {
    const { user } = await seed();
    const plain = await user.agent.get("/api/crm/clients");
    expect(Array.isArray(plain.body)).toBe(true);
    expect(plain.body).toHaveLength(3);

    const first = await user.agent.get("/api/crm/clients").query({ page: 1, pageSize: 2 });
    expect(first.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(first.body.data.map((c: { name: string; projectCount: number }) => [c.name, c.projectCount])).toEqual([
      ["acme", 2],
      ["Bolt", 1],
    ]);
    const second = await user.agent.get("/api/crm/clients").query({ page: 2, pageSize: 2 });
    expect(second.body.data.map((c: { name: string }) => c.name)).toEqual(["Cairn"]);
  });

  it("narrows by status, source, open Projects and the search before paging", async () => {
    const { user, names } = await seed();
    expect(await names({ status: "lead" })).toEqual(["Bolt"]);
    expect(await names({ source: "fiverr" })).toEqual(["Bolt"]);
    expect(await names({ source: "none" })).toEqual(["Cairn"]);
    // Bolt's only Project is completed, so it has none open.
    expect(await names({ openProjects: "yes" })).toEqual(["acme"]);
    expect(await names({ openProjects: "no" })).toEqual(["Bolt", "Cairn"]);
    expect(await names({ search: "zeta" })).toEqual(["Bolt"]);
    expect(await names({ search: "AC" })).toEqual(["acme"]);
    expect(await names({ search: "%" })).toEqual([]);
    const counted = await user.agent.get("/api/crm/clients").query({ page: 1, openProjects: "no" });
    expect(counted.body.total).toBe(2);
  });

  it("sorts by any register column, with no value last in both directions", async () => {
    const { names } = await seed();
    expect(await names({ sort: "name", dir: "desc" })).toEqual(["Cairn", "Bolt", "acme"]);
    expect(await names({ sort: "company" })).toEqual(["acme", "Bolt", "Cairn"]);
    expect(await names({ sort: "company", dir: "desc" })).toEqual(["Bolt", "acme", "Cairn"]);
    // CLIENT, LEAD, PROSPECT.
    expect(await names({ sort: "status" })).toEqual(["acme", "Bolt", "Cairn"]);
    expect(await names({ sort: "source", dir: "desc" })).toEqual(["Bolt", "acme", "Cairn"]);
    expect(await names({ sort: "projects", dir: "desc" })).toEqual(["acme", "Bolt", "Cairn"]);
    // An unknown column falls back to name order.
    expect(await names({ sort: "nope" })).toEqual(["acme", "Bolt", "Cairn"]);
  });
});
