import type { Db } from "../db";

/** A Drizzle session that can write documents — the caller's transaction, or ours. */
export type DocumentWriter = Pick<Db, "insert" | "select" | "update">;
/** A Drizzle session that can insert a Project — the caller's transaction, or ours. */
export type ProjectWriter = Pick<Db, "insert">;
