import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerUser } from "../helpers/auth";
import { createCrmProject, createDocument, tiptap } from "../helpers/fixtures";
import { chatCalls, embeddingCalls, setChatReply } from "../fakes/openai";
import { completeUpload } from "../helpers/objects";
import { pdfSaying } from "../helpers/pdf";

/**
 * Characterization: the retrieval-augmented chat endpoint and the embedding
 * pipeline behind it. The OpenAI client is faked at the package boundary
 * (ADR-0018) with deterministic bag-of-words vectors, so similarity ordering is
 * real while nothing leaves the process.
 *
 * Quirks frozen here:
 *  - Document embeddings are not generated on the save request;
 *    `POST /api/embeddings/rebuild` is the synchronous path.
 *  - Chat always answers 200 with `{ message, model, relevantDocs, usedFallback }`
 *    and the model name hard-coded to "gpt-4.1-nano".
 *  - With no embeddings to match, chat falls back to pasting whole documents
 *    into the prompt and reports `usedFallback: true`.
 *  - Every user's chat sees every project in the workspace, because the project
 *    overview is built from the company-wide project list.
 */
describe("chat and embeddings (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("validates the chat payload", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const empty = await user.agent.post("/api/chat").send({ message: "" });
    expect(empty.status).toBe(400);
    expect(empty.body.message).toBe("Invalid request");
    expect(Array.isArray(empty.body.errors)).toBe(true);

    const badMode = await user.agent.post("/api/chat").send({ message: "hi", mode: "everything" });
    expect(badMode.status).toBe(400);
  });

  it("falls back to pasting whole pages when the caller owns no embeddings", async () => {
    const app = await makeApp();
    const author = await registerUser(app);
    // Every embedding row is written with `owner_id` = the user whose request
    // generated it, and vector search filters on `owner_id` = the caller
    // (`server/embeddings.ts`). A second user's search therefore always comes
    // back empty — which is what puts chat on the fallback path deterministically.
    const user = await registerUser(app);
    const { project } = await createCrmProject(author.agent, { name: "Atlas" });
    await createDocument(author.agent, project.id, {
      title: "Runbook",
      content: tiptap("Restart the ingest worker"),
    });
    setChatReply("Restart it from the console.");

    const res = await user.agent.post("/api/chat").send({ message: "How do I restart?" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "Restart it from the console.",
      model: "gpt-4.1-nano",
      relevantDocs: 0,
      usedFallback: true,
    });

    const [call] = chatCalls();
    expect(call.model).toBe("gpt-4.1-nano");
    const systemPrompt = call.messages[0].content;
    expect(systemPrompt).toContain("# Available Projects");
    expect(systemPrompt).toContain("Atlas");
    // Quirk: the fallback pastes page text straight into the prompt, and
    // `getAllUserDocuments` is company-wide — so a user who owns nothing still
    // gets someone else's page content in their prompt.
    expect(systemPrompt).toContain("Restart the ingest worker");
    expect(call.messages.at(-1)).toEqual({ role: "user", content: "How do I restart?" });
  });

  it("passes conversation history through and honours the mode", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    await user.agent
      .post("/api/company-documents")
      .send({ name: "Expense policy", content: tiptap("Receipts within 30 days") });

    const res = await user.agent.post("/api/chat").send({
      message: "What is the expense policy?",
      mode: "company",
      conversationHistory: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ],
    });
    expect(res.status).toBe(200);

    const call = chatCalls().at(-1)!;
    expect(call.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    const systemPrompt = call.messages[0].content;
    expect(systemPrompt).toContain("# Company Documents");
    expect(systemPrompt).toContain("Expense policy");
    // Company mode omits the project overview entirely.
    expect(systemPrompt).not.toContain("# Available Projects");

    const projectsOnly = await user.agent
      .post("/api/chat")
      .send({ message: "anything", mode: "projects" });
    expect(projectsOnly.status).toBe(200);
    expect(chatCalls().at(-1)!.messages[0].content).not.toContain("# Company Documents");
  });

  it("keeps an uploaded PDF's text in the index when the document is renamed", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const issued = await user.agent.post("/api/objects/upload");
    const storagePath = completeUpload(
      issued.body.uploadURL,
      pdfSaying("quarterly revenue recognition policy"),
      "application/pdf"
    );
    const created = await user.agent.post("/api/company-documents").send({
      name: "Policy",
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      storagePath,
    });
    expect(created.status).toBe(201);

    // Synchronous, and the company half of it is why: an uploaded file's text
    // lives in object storage rather than in `content`, so the rebuild has to
    // re-extract it. It used to skip every upload for having no `content`.
    const rebuilt = await user.agent.post("/api/embeddings/rebuild");
    expect(rebuilt.body.companyDocuments).toEqual({ processed: 1, errors: 0 });

    const before = await user.agent
      .post("/api/chat")
      .send({ message: "revenue recognition", mode: "company" });
    expect(before.status).toBe(200);
    expect(chatCalls().at(-1)!.messages[0].content).toContain("quarterly revenue recognition policy");

    const renamed = await user.agent
      .patch(`/api/company-documents/${created.body.id}`)
      .send({ name: "Revenue policy" });
    expect(renamed.status).toBe(200);

    const after = await user.agent
      .post("/api/chat")
      .send({ message: "revenue recognition", mode: "company" });
    expect(after.status).toBe(200);
    const prompt = chatCalls().at(-1)!.messages[0].content;
    // The regression: a name-only PATCH re-embedded `document.content`, which is
    // null for an upload, so every chunk was replaced by "(Empty page)" — the
    // only write path that touched an existing upload's index destroyed it (#43).
    expect(prompt).toContain("quarterly revenue recognition policy");
    expect(prompt).not.toContain("(Empty page)");
    // And the new title is what the chunk is filed under, which is why a rename
    // has to reach the index at all.
    expect(prompt).toContain("Revenue policy");
  });

  it("rebuilds embeddings synchronously and then retrieves the matching page", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { project } = await createCrmProject(user.agent, { name: "Atlas" });
    await createDocument(user.agent, project.id, {
      title: "Deployment",
      content: tiptap("Deployments run through the release pipeline"),
    });
    await createDocument(user.agent, project.id, {
      title: "Onboarding",
      content: tiptap("New joiners get a laptop on day one"),
    });

    const rebuilt = await user.agent.post("/api/embeddings/rebuild");
    expect(rebuilt.status).toBe(200);
    // `processed`/`errors`/`total` count this user's project documents. The
    // company-document half is company-wide rather than per user, so it is
    // reported separately rather than folded into those totals — #43 wired it
    // in as the repair path for a change of PDF parser, and there is none here.
    expect(rebuilt.body).toEqual({
      message: "Embeddings rebuild complete",
      processed: 2,
      errors: 0,
      total: 2,
      companyDocuments: { processed: 0, errors: 0 },
    });
    expect(embeddingCalls().length).toBeGreaterThan(0);

    const res = await user.agent
      .post("/api/chat")
      .send({ message: "release pipeline", mode: "projects" });
    expect(res.status).toBe(200);
    expect(res.body.usedFallback).toBe(false);
    expect(res.body.relevantDocs).toBeGreaterThan(0);

    const systemPrompt = chatCalls().at(-1)!.messages[0].content;
    expect(systemPrompt).toContain("# Relevant Project Documentation");
    // The closest chunk is the deployment page, and it is attributed to its project.
    expect(systemPrompt).toContain("Atlas / Deployment");
  });

  it("shows every user's chat the whole workspace", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    await createCrmProject(owner.agent, { name: "Someone Elses Project" });

    const res = await stranger.agent.post("/api/chat").send({ message: "what exists?" });
    expect(res.status).toBe(200);
    // Quirk: the project overview is built from the company-wide list, so a user
    // with no projects still sees every project name in the prompt.
    expect(chatCalls().at(-1)!.messages[0].content).toContain("Someone Elses Project");
  });
});
