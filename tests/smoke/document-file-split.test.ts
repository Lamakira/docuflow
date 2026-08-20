import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { urlForDatabase, withClient } from "../helpers/db";

/**
 * Phase 6 ticket #115: split Document from File (ADR-0012, Spec #112).
 * HTTP is not this suite — the journal is the seam. Characterization stays
 * green unless an HTTP contract actually changes.
 */

const SCRATCH_DB = "docuflow_document_file_split";
const BEFORE_SPLIT = "0012_colossal_nuke";
const OBJECT_KEY = "/objects/uploads/invoice-keep";
const DOCUMENT_ACCESS_WORKSPACE = "workspace";

const IDS = {
  page: "doc-page",
  file: "doc-file",
  pageEmbedding: "emb-page",
  fileEmbedding: "emb-file",
  projectDoc: "proj-page",
  projectEmbedding: "emb-proj",
} as const;

async function publicTables(url: string): Promise<string[]> {
  return withClient(url, async (client) => {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT LIKE '\\_\\_drizzle%'
        ORDER BY tablename`
    );
    return rows.map((row) => row.tablename);
  });
}

describe("split Document from File", () => {
  let scratch: string;

  beforeAll(async () => {
    await withClient(urlForDatabase("postgres"), async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
      await client.query(`CREATE DATABASE ${SCRATCH_DB}`);
    });
    scratch = urlForDatabase(SCRATCH_DB);

    await migrate(scratch, { applyThrough: BEFORE_SPLIT });
    await withClient(scratch, async (client) => {
      await client.query(
        `INSERT INTO users (id, email, password, role, is_main_admin, created_at)
         VALUES ('u-keep', 'keep@example.test', 'x', 'user', 0, '2020-01-01')`
      );
      await client.query(
        `INSERT INTO projects (id, name, owner_id, workspace_id)
         VALUES ('p-keep', 'Handbook project', 'u-keep', 'seeded')`
      );
      await client.query(
        `INSERT INTO documents (id, title, content, project_id, created_by_id, workspace_id)
         VALUES ($1, 'Project page', $2::jsonb, 'p-keep', 'u-keep', 'seeded')`,
        [IDS.projectDoc, JSON.stringify({ type: "doc" })]
      );
      await client.query(
        `INSERT INTO company_documents (id, name, content, uploaded_by_id, workspace_id)
         VALUES ($1, 'Handbook', $2::jsonb, 'u-keep', 'seeded')`,
        [IDS.page, JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] })]
      );
      await client.query(
        `INSERT INTO company_documents (id, name, file_name, file_size, mime_type, storage_path, uploaded_by_id, workspace_id)
         VALUES ($1, 'Invoice', 'invoice.pdf', 2048, 'application/pdf', $2, 'u-keep', 'seeded')`,
        [IDS.file, OBJECT_KEY]
      );
      await client.query(
        `INSERT INTO company_document_embeddings (id, company_document_id, chunk_index, chunk_text, content_hash, workspace_id)
         VALUES ($1, $2, 0, 'handbook chunk', 'hash-page', 'seeded'),
                ($3, $4, 0, 'invoice chunk', 'hash-file', 'seeded')`,
        [IDS.pageEmbedding, IDS.page, IDS.fileEmbedding, IDS.file]
      );
      await client.query(
        `INSERT INTO document_embeddings (id, document_id, project_id, owner_id, chunk_index, chunk_text, content_hash, workspace_id)
         VALUES ($1, $2, 'p-keep', 'u-keep', 0, 'project chunk', 'hash-proj', 'seeded')`,
        [IDS.projectEmbedding, IDS.projectDoc]
      );
    });
    await migrate(scratch);
  }, 120_000);

  afterAll(async () => {
    await withClient(urlForDatabase("postgres"), (client) =>
      client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
    );
  });

  it("stores an uploaded binary as a File and an edited page as a Document", async () => {
    const tables = await publicTables(scratch);
    expect(tables).toContain("files");
    expect(tables).toContain("company_documents");
    expect(tables).toContain("documents");

    const files = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ id: string }>(`SELECT id FROM files ORDER BY id`);
      return rows.map((row) => row.id);
    });
    expect(files).toEqual([IDS.file]);
    expect(files).not.toContain(IDS.page);
    expect(files).not.toContain(IDS.projectDoc);

    const pages = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ id: string; content: unknown; storage_path: string | null }>(
        `SELECT id, content, storage_path FROM company_documents WHERE id = $1`,
        [IDS.page]
      );
      return rows[0];
    });
    expect(pages).toMatchObject({ id: IDS.page, storage_path: null });
    expect(pages.content).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("keeps the existing object key on the File and does not re-key", async () => {
    const file = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ id: string; storage_path: string }>(
        `SELECT id, storage_path FROM files WHERE id = $1`,
        [IDS.file]
      );
      return rows[0];
    });
    expect(file).toEqual({ id: IDS.file, storage_path: OBJECT_KEY });

    const legacy = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ storage_path: string }>(
        `SELECT storage_path FROM company_documents WHERE id = $1`,
        [IDS.file]
      );
      return rows[0];
    });
    expect(legacy.storage_path).toBe(OBJECT_KEY);
  });

  it("defaults Document Access to everyone in the Workspace", async () => {
    const access = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ id: string; access: string }>(
        `SELECT id, access FROM company_documents ORDER BY id`
      );
      return rows;
    });
    expect(access).toEqual([
      { id: IDS.file, access: DOCUMENT_ACCESS_WORKSPACE },
      { id: IDS.page, access: DOCUMENT_ACCESS_WORKSPACE },
    ]);

    const fileAccess = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ id: string; access: string }>(
        `SELECT id, access FROM files ORDER BY id`
      );
      return rows;
    });
    expect(fileAccess).toEqual([{ id: IDS.file, access: DOCUMENT_ACCESS_WORKSPACE }]);
  });

  it("preserves legacy ids on the split rows", async () => {
    const ids = await withClient(scratch, async (client) => {
      const company = await client.query<{ id: string }>(
        `SELECT id FROM company_documents ORDER BY id`
      );
      const stored = await client.query<{ id: string }>(`SELECT id FROM files ORDER BY id`);
      const projectPages = await client.query<{ id: string }>(
        `SELECT id FROM documents WHERE id = $1`,
        [IDS.projectDoc]
      );
      return {
        company: company.rows.map((row) => row.id),
        files: stored.rows.map((row) => row.id),
        projectPages: projectPages.rows.map((row) => row.id),
      };
    });
    expect(ids.company).toEqual([IDS.file, IDS.page].sort());
    expect(ids.files).toEqual([IDS.file]);
    expect(ids.projectPages).toEqual([IDS.projectDoc]);
  });

  it("drops embeddings so search and citations cannot widen Document Access", async () => {
    const leftover = await withClient(scratch, async (client) => {
      const company = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM company_document_embeddings`
      );
      const project = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM document_embeddings`
      );
      return {
        company: Number(company.rows[0].count),
        project: Number(project.rows[0].count),
      };
    });
    expect(leftover).toEqual({ company: 0, project: 0 });
  });
});
