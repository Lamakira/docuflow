import { defineConfig } from "vitest/config";
import path from "path";

const fake = (name: string) => path.resolve(import.meta.dirname, "tests/fakes", name);

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
      // External-provider stubs, applied at the vendor package boundary so no
      // application module has to know it is under test (ADR-0018). See
      // tests/README.md for what each fake does.
      "@google-cloud/storage": fake("gcs.ts"),
      openai: fake("openai.ts"),
      resend: fake("resend.ts"),
      playwright: fake("playwright.ts"),
      stripe: fake("stripe.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: "./tests/global-setup.ts",
    setupFiles: ["./tests/setup.ts"],
    // The app logs every API request and response body; keep that noise for
    // failures only, where it is the fastest way to see what the server did.
    silent: "passed-only",
    // One shared test database — suites truncate between tests and must not interleave.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
