import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * Phase 8 ticket #141: Billable Seats from active Memberships.
 * Seams: Billing module (count, capacity check Invitation will call,
 * purchased-capacity floor) and Membership add (fail closed). Stripe and
 * Invitation UX are not this suite. Characterization stays green.
 */

describe("Billable Seat count", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("equals non-archived Memberships in the Workspace", async () => {
    const { storage } = await import("../../server/storage");
    const { countConsumedSeats } = await import("../../server/modules/billing");

    await expect(inSeededWorkspace(() => countConsumedSeats())).resolves.toBe(0);

    await storage.createUser({
      email: "ada@test.invalid",
      password: "not-a-real-hash",
      firstName: "Ada",
    });
    await storage.createUser({
      email: "bob@test.invalid",
      password: "not-a-real-hash",
      firstName: "Bob",
    });

    await expect(inSeededWorkspace(() => countConsumedSeats())).resolves.toBe(2);
  });

  it("does not count Archived Memberships", async () => {
    const { storage } = await import("../../server/storage");
    const { countConsumedSeats } = await import("../../server/modules/billing");

    const ada = await storage.createUser({
      email: "ada@test.invalid",
      password: "not-a-real-hash",
      firstName: "Ada",
    });
    await storage.createUser({
      email: "bob@test.invalid",
      password: "not-a-real-hash",
      firstName: "Bob",
    });

    await storage.archiveUser(ada.id, true);

    await expect(inSeededWorkspace(() => countConsumedSeats())).resolves.toBe(1);
  });

  it("does not count Service Accounts", async () => {
    const { makeApp } = await import("../helpers/app");
    const { registerUser, setWorkspaceRole } = await import("../helpers/auth");
    const { countConsumedSeats } = await import("../../server/modules/billing");

    const app = await makeApp();
    await registerUser(app);
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const created = await owner.agent.post("/api/service-accounts").send({ name: "CRM" });
    expect(created.status).toBe(201);

    await expect(inSeededWorkspace(() => countConsumedSeats())).resolves.toBe(2);
  });
});

describe("fail-closed Membership add", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects adding a Membership that would exceed purchased capacity", async () => {
    const { storage } = await import("../../server/storage");
    const {
      SeatExhaustedError,
      assertSeatAvailable,
      countConsumedSeats,
      setEntitlementOverride,
    } = await import("../../server/modules/billing");

    await inSeededWorkspace(() =>
      setEntitlementOverride({ seatCapacity: 1 }, { kind: "system" })
    );

    await storage.createUser({
      email: "ada@test.invalid",
      password: "not-a-real-hash",
      firstName: "Ada",
    });
    await expect(inSeededWorkspace(() => countConsumedSeats())).resolves.toBe(1);
    await expect(inSeededWorkspace(() => assertSeatAvailable())).rejects.toBeInstanceOf(
      SeatExhaustedError
    );

    await expect(
      storage.createUser({
        email: "bob@test.invalid",
        password: "not-a-real-hash",
        firstName: "Bob",
      })
    ).rejects.toBeInstanceOf(SeatExhaustedError);

    await expect(inSeededWorkspace(() => countConsumedSeats())).resolves.toBe(1);
  });

  it("does not block Memberships on the seeded legacy Plan", async () => {
    const { storage } = await import("../../server/storage");
    const { assertSeatAvailable, countConsumedSeats, effectiveEntitlements } = await import(
      "../../server/modules/billing"
    );

    await expect(inSeededWorkspace(() => effectiveEntitlements())).resolves.toMatchObject({
      seatCapacity: 500,
    });

    for (let i = 0; i < 3; i += 1) {
      await storage.createUser({
        email: `member-${i}@test.invalid`,
        password: "not-a-real-hash",
        firstName: `M${i}`,
      });
    }

    await expect(inSeededWorkspace(() => countConsumedSeats())).resolves.toBe(3);
    await expect(inSeededWorkspace(() => assertSeatAvailable())).resolves.toBeUndefined();
  });
});

describe("purchased seat capacity floor", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects decreasing purchased capacity below current consumption", async () => {
    const { storage } = await import("../../server/storage");
    const {
      SeatCapacityFloorError,
      countConsumedSeats,
      getBillingProjection,
      setPurchasedSeatCapacity,
    } = await import("../../server/modules/billing");

    await storage.createUser({
      email: "ada@test.invalid",
      password: "not-a-real-hash",
      firstName: "Ada",
    });
    await storage.createUser({
      email: "bob@test.invalid",
      password: "not-a-real-hash",
      firstName: "Bob",
    });
    await expect(inSeededWorkspace(() => countConsumedSeats())).resolves.toBe(2);

    await expect(
      inSeededWorkspace(() => setPurchasedSeatCapacity(1, { kind: "system" }))
    ).rejects.toBeInstanceOf(SeatCapacityFloorError);

    const pin = await inSeededWorkspace(() => getBillingProjection());
    expect(pin.purchasedSeatCapacity).toBe(500);

    const decreased = await inSeededWorkspace(() =>
      setPurchasedSeatCapacity(2, { kind: "system" })
    );
    expect(decreased.purchasedSeatCapacity).toBe(2);
    expect(decreased.authorizationVersion).toBe(pin.authorizationVersion + 1);

    const { db } = await import("../../server/db");
    const { auditEvents, jobs } = await import("../../shared/schema");
    const events = await inSeededWorkspace(() => db.select().from(auditEvents));
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorKind: "system",
          action: "billing.seats_change",
          resourceType: "workspace_billing",
          payload: { from: 500, to: 2 },
        }),
      ])
    );
    const queuedJobs = await db.select().from(jobs);
    expect(queuedJobs).toEqual([]);
  });
});

describe("distinct seat exhaustion error", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("is distinct from capability denial and from Read-only Workspace", async () => {
    const { makeApp } = await import("../helpers/app");
    const { newAgent, promoteToAdmin, registerUser, setWorkspaceRole, uniqueEmail } = await import(
      "../helpers/auth"
    );
    const {
      ReadOnlyWorkspaceError,
      SeatExhaustedError,
      setEntitlementOverride,
    } = await import("../../server/modules/billing");

    expect(new SeatExhaustedError()).not.toBeInstanceOf(ReadOnlyWorkspaceError);
    expect(new SeatExhaustedError().statusCode).toBe(409);
    expect(new ReadOnlyWorkspaceError().statusCode).toBe(403);

    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const created = await owner.agent.post("/api/service-accounts").send({ name: "CRM" });
    expect(created.status).toBe(201);
    const sa = newAgent(app).set("Authorization", `Bearer ${created.body.plaintextKey}`);

    const denied = await sa.post("/api/v1/clients").send({ name: "Acme" });
    expect(denied.status).toBe(403);
    expect(denied.body.type).toBe("urn:docuflow:problem:forbidden");

    await inSeededWorkspace(() =>
      setEntitlementOverride({ seatCapacity: 1 }, { kind: "system" })
    );

    // Through the admin route, which is where a User is created now that #110
    // retired self-service registration. Same gate, same `SeatExhaustedError`.
    await promoteToAdmin(owner.id);
    const exhausted = await owner.agent.post("/api/admin/users").send({
      email: uniqueEmail("blocked"),
      firstName: "Blocked",
      lastName: "Member",
    });
    expect(exhausted.status).toBe(409);
    expect(exhausted.body).toEqual({ message: "Billable Seat capacity is exhausted" });
    expect(exhausted.body.type).not.toBe("urn:docuflow:problem:forbidden");
    expect(exhausted.body.type).not.toBe("urn:docuflow:problem:read-only-workspace");
    expect(exhausted.body.message).not.toBe("Workspace is read-only");
    expect(exhausted.body.message).not.toBe("Access denied");
  });
});
