import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerUser } from "../helpers/auth";
import { createCrmProject, createDocument, tiptap } from "../helpers/fixtures";

/**
 * Characterization: video transcript sync for documentation pages.
 *
 * The scraper behind this feature drives a headless Chromium at a hard-coded
 * path; `playwright` is aliased to a fake that throws loudly (ADR-0018), so
 * these tests deliberately stay on the no-video paths, which is what the
 * endpoints do for every page that has no Loom or Fathom embed.
 *
 * Quirks frozen here:
 *  - The status endpoint answers a zeroed summary for a page that has no
 *    videos rather than 404 or an empty body.
 *  - Sync on a page with no content short-circuits to "No content to sync"
 *    without the `added`/`removed` counters the other branch returns.
 *  - Retrying an unknown transcript is a 404; there is no ownership check
 *    beyond the document and project existing.
 */
describe("video transcripts (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reports an empty transcript summary for a page with no videos", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { project } = await createCrmProject(user.agent);
    const doc = await createDocument(user.agent, project.id, {
      content: tiptap("Just text, no embeds"),
    });

    const res = await user.agent.get(`/api/documents/${doc.id}/transcripts`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      total: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      error: 0,
      transcripts: [],
    });

    const missing = await user.agent.get(
      "/api/documents/00000000-0000-0000-0000-000000000000/transcripts"
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Document not found" });
  });

  it("syncs a page with no videos, and short-circuits an empty page", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { project } = await createCrmProject(user.agent);
    const withText = await createDocument(user.agent, project.id, {
      content: tiptap("Still no embeds"),
    });
    const empty = await createDocument(user.agent, project.id, { title: "Empty page" });

    const synced = await user.agent.post(`/api/documents/${withText.id}/sync-transcripts`);
    expect(synced.status).toBe(200);
    expect(synced.body).toEqual({
      message: "Transcript sync initiated",
      added: 0,
      removed: 0,
      errors: [],
    });

    // Quirk: the no-content branch returns a different message and different
    // fields — no `errors` array.
    const noContent = await user.agent.post(`/api/documents/${empty.id}/sync-transcripts`);
    expect(noContent.status).toBe(200);
    expect(noContent.body).toEqual({ message: "No content to sync", added: 0, removed: 0 });

    const missing = await user.agent.post(
      "/api/documents/00000000-0000-0000-0000-000000000000/sync-transcripts"
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Document not found" });
  });

  it("reports an unknown transcript retry as 404", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const res = await user.agent.post(
      "/api/transcripts/00000000-0000-0000-0000-000000000000/retry"
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Transcript not found" });
  });
});
