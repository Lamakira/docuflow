import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveApiBase } from "../../desktop-agent/src/lib/config";

/**
 * #236. The agent used to carry a production URL as its committed last resort,
 * so `npm run dev:v2` on a fresh clone authenticated against production —
 * ADR-0018 forbids this repository holding a production URL at all.
 *
 * The URL a shipped installer needs still has to come from somewhere, and a
 * packaged agent has neither an environment variable nor an override file. It
 * now comes from the build, baked into `DOCUFLOW_DEFAULT_API_URL` by
 * `webpack.main.config.js`, and the release scripts refuse to build without it.
 * What the repository commits is a local default that cannot reach anyone's
 * data.
 */
function homeWith(url: string | null): string {
  const dir = mkdtempSync(path.join(tmpdir(), "docuflow-url-"));
  if (url !== null) writeFileSync(path.join(dir, ".docuflow-url"), url);
  return dir;
}

describe("desktop agent API base", () => {
  it("falls back to localhost, never to a committed production host", () => {
    const home = homeWith(null);
    try {
      const resolved = resolveApiBase({}, home);
      expect(resolved.url).toBe("http://localhost:5000");
      expect(resolved.source).toBe("default");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("prefers the runtime environment variable above everything", () => {
    const home = homeWith("https://from-file.invalid");
    try {
      const resolved = resolveApiBase(
        { DOCUFLOW_API_URL: "https://from-env.invalid/", DOCUFLOW_DEFAULT_API_URL: "https://baked.invalid" },
        home,
      );
      expect(resolved.url).toBe("https://from-env.invalid");
      expect(resolved.source).toBe("env");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("prefers the override file above the baked build default", () => {
    const home = homeWith("https://from-file.invalid");
    try {
      const resolved = resolveApiBase({ DOCUFLOW_DEFAULT_API_URL: "https://baked.invalid" }, home);
      expect(resolved.url).toBe("https://from-file.invalid");
      expect(resolved.source).toBe("file");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("uses the build-time default when nothing else names a host", () => {
    const home = homeWith(null);
    try {
      const resolved = resolveApiBase({ DOCUFLOW_DEFAULT_API_URL: "https://baked.invalid/" }, home);
      expect(resolved.url).toBe("https://baked.invalid");
      expect(resolved.source).toBe("build");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
