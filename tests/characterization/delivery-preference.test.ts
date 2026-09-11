import { beforeEach, describe, expect, it } from "vitest";
import { PARALLEL_WORKSPACE_ID, SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { emailsTo } from "../fakes/resend";
import { makeApp } from "../helpers/app";
import { newAgent, registerUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCrmProject } from "../helpers/fixtures";
import { addWorkspaceMembership, plantParallelWorkspace } from "../helpers/workspace";

/**
 * Delivery Preference (#210). Seam: HTTP `/api/notifications/delivery-preferences`.
 * Per User × Active Workspace. Inbox stays on; mandatory categories stay on.
 */

const EMAIL_ON = {
  "work-assignments": true,
  reminders: true,
  approvals: true,
  membership: true,
  billing: true,
  security: true,
};

describe("Delivery Preference HTTP (#210)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("defaults every category to email on, and refuses an anonymous caller", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const listed = await user.agent.get("/api/notifications/delivery-preferences");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ emailByCategory: EMAIL_ON });

    const anonymous = await newAgent(app).get("/api/notifications/delivery-preferences");
    expect(anonymous.status).toBe(401);
  });

  it("persists optional email off on the Active Workspace Membership and ignores mandatory off", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    await plantParallelWorkspace();
    await addWorkspaceMembership(user.id, PARALLEL_WORKSPACE_ID, "member");

    const saved = await user.agent.put("/api/notifications/delivery-preferences").send({
      emailByCategory: { reminders: false, security: false },
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({
      emailByCategory: { ...EMAIL_ON, reminders: false },
    });

    const remembered = await user.agent.get("/api/notifications/delivery-preferences");
    expect(remembered.body).toEqual({
      emailByCategory: { ...EMAIL_ON, reminders: false },
    });

    await user.agent.put("/api/memberships/active").send({ workspaceId: PARALLEL_WORKSPACE_ID });
    const parallel = await user.agent.get("/api/notifications/delivery-preferences");
    expect(parallel.body).toEqual({ emailByCategory: EMAIL_ON });

    await user.agent.put("/api/memberships/active").send({ workspaceId: SEEDED_WORKSPACE_ID });
    const back = await user.agent.get("/api/notifications/delivery-preferences");
    expect(back.body.emailByCategory.reminders).toBe(false);
  });

  it("keeps assignment in the inbox when work-assignments email is off", async () => {
    const app = await makeApp();
    const owner = await registerUser(app, { firstName: "Owner" });
    const teammate = await registerUser(app, { firstName: "Team" });
    const created = await createCrmProject(owner.agent, { name: "Assignable" });

    const off = await teammate.agent.put("/api/notifications/delivery-preferences").send({
      emailByCategory: { "work-assignments": false },
    });
    expect(off.status).toBe(200);

    const assign = await owner.agent
      .patch(`/api/crm/projects/${created.crmProject.id}`)
      .send({ assigneeId: teammate.id });
    expect(assign.status).toBe(200);

    const inbox = await teammate.agent.get("/api/notifications");
    expect(inbox.body).toHaveLength(1);
    expect(inbox.body[0].type).toBe("assignment");
    expect(emailsTo(teammate.email)).toHaveLength(0);
  });
});
