import { defineConfig } from "drizzle-kit";
import { requireDatabaseUrl } from "./shared/databaseUrl";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: requireDatabaseUrl(),
  },
});
