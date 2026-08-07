-- The pgvector extension and the two `embedding` columns `server/embeddings.ts`
-- has always written and ordered by through raw SQL. They were applied to the
-- production database out of band and were never declared in `shared/schema.ts`
-- or any migration, so a database built from the journal alone had no place to
-- put an embedding and every retrieval write failed. #24 folds them in.
--
-- `IF NOT EXISTS` throughout: the columns already exist wherever the out-of-band
-- DDL was run, so this migration is the same no-op there that it is a create on
-- a fresh database. The `CREATE EXTENSION` line and the `IF NOT EXISTS` clauses
-- are the hand-edits to what `drizzle-kit generate` emitted — drizzle does not
-- know an extension is needed, and generates unconditional DDL.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "company_document_embeddings" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
