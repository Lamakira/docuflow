/**
 * Thin persistence adapter over the ADR-0008 domain modules (#113).
 * HTTP and Worker callers keep importing `storage` from here. Module
 * persistence interfaces live under `server/modules/`.
 */

import type { IStorage } from "./modules";
import { DatabaseStorage } from "./modules/postgresStorage";

export type { IStorage } from "./modules";
export type { DocumentWriter, ProjectWriter } from "./modules/writers";
export { DatabaseStorage } from "./modules/postgresStorage";

export const storage: IStorage = new DatabaseStorage();
