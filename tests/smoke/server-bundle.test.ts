import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../script/bundles";

/**
 * What the runtime image has to install, derived from the bundle (#36).
 *
 * `npm ci --omit=dev` in the Dockerfile's runtime stage installs
 * `dependencies` and nothing else, so that list is a claim about the server:
 * these are the modules `dist/index.cjs` still resolves from node_modules after
 * `script/bundles.ts` has inlined its allowlist. The claim used to be false in
 * both directions at once — every client package was in it (a gigabyte of
 * `react-icons`, `@tiptap`, and `@radix-ui` installed into an image that only
 * ever serves them pre-bundled from `dist/public`) while nothing checked that
 * what the server actually imports was in it either.
 *
 * Neither error announces itself. A client package in `dependencies` costs disk
 * and nothing else; a server import missing from it builds, typechecks, tests,
 * and boots, then fails with `Cannot find module` on the first request that
 * reached the route using it — in the image, in production, at a moment nobody
 * chose.
 *
 * So the manifest is checked against the build's own metafile rather than read.
 * The two directions below are the two failures, and the exception lists are
 * the only place a package may sit outside the derivation — each with the
 * reason it does.
 *
 * **This does not prove the modules load**, only that they are declared. A
 * package can be present and still fail to initialise — `sharp` needs libvips,
 * `bcrypt` a matching prebuilt binary. `.github/workflows/ci.yml` imports every
 * `dependencies` entry inside the built image, which is where that half is
 * answered, on the runtime tree rather than on this checkout's.
 */

const REPO = join(import.meta.dirname, "..", "..");

/**
 * External imports the runtime image deliberately does not install, and why
 * each one is safe to leave out. A new entry here is a claim that the import is
 * never reached in production — check that before adding one.
 */
const NOT_INSTALLED: Record<string, string> = {
  // The dev server, behind `await import("./vite")` in server/index.ts's
  // non-production branch. esbuild keeps a dynamic import lazy, so the `require`
  // is emitted but never runs under NODE_ENV=production, which is what serves
  // `dist/public` through server/static.ts instead.
  vite: "dev-only branch: server/index.ts imports ./vite only when not production",
  "@vitejs/plugin-react": "reached only through vite.config.ts, from that same branch",
  "@replit/vite-plugin-runtime-error-modal": "reached only through vite.config.ts, from that same branch",
  // `ws` is bundled, and its two native speedups are `require`d inside a
  // try/catch — absent, it falls back to its JavaScript implementations. The
  // other one, `bufferutil`, is an optionalDependency and does install.
  "utf-8-validate": "optional native speedup for ws, required in a try/catch",
};

/**
 * Runtime dependencies the metafile cannot see, and why. Empty today, which is
 * itself worth knowing: the one import that looked invisible is not.
 * `server/agentRoutes.ts` loads sharp as `await import("sharp" as any)` — the
 * cast is TypeScript's and esbuild reads straight through it to a string
 * literal, so sharp arrives in the list below like any other import.
 *
 * What would land here is a specifier built at runtime — `require(name)` over a
 * variable, or a driver resolving a plugin by string. Nothing does that today.
 * Adding an entry means the import is real and unanalysable; say where it is.
 */
const CARRIED_BY_HAND: Record<string, string> = {};

/** Bare package name of an import specifier: `pg`, `@opentelemetry/api`. */
function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

let imported: string[];
let declared: string[];
let staged: string;

describe("dist/index.cjs", () => {
  beforeAll(async () => {
    staged = mkdtempSync(join(tmpdir(), "docuflow-server-bundle-"));

    // The same function the image build calls, not a second copy of its
    // configuration: what is external here is what is external there.
    const built = await buildServer(join(staged, "index.cjs"));
    const [output] = Object.values(built.metafile.outputs);

    imported = [
      ...new Set(
        output.imports
          .filter((i) => i.external && !isBuiltin(i.path) && !i.path.startsWith("."))
          .map((i) => packageOf(i.path))
      ),
    ].sort();

    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
    declared = Object.keys(pkg.dependencies).sort();
  }, 60_000);

  afterAll(() => {
    rmSync(staged, { recursive: true, force: true });
  });

  it("imports nothing the runtime image would not have", () => {
    const undeclared = imported.filter(
      (name) => !declared.includes(name) && !(name in NOT_INSTALLED)
    );

    // A name here is an import the image cannot resolve: either it belongs in
    // `dependencies`, or it belongs in NOT_INSTALLED with the reason it is
    // never reached in production.
    expect(undeclared).toEqual([]);
  });

  it("installs nothing the server does not import", () => {
    const unused = declared.filter(
      (name) => !imported.includes(name) && !(name in CARRIED_BY_HAND)
    );

    // A name here is weight in an image that never opens it — which is how
    // `react-icons` and `@tiptap` got there. It belongs in `devDependencies`:
    // the build stage installs the full tree, so the client build is unaffected.
    expect(unused).toEqual([]);
  });

  it("keeps the lazily imported ones, which are the ones a build would not miss", () => {
    // Every one of these is reached from inside a function rather than at load,
    // so a missing entry survives boot and the image's HEALTHCHECK both, and
    // surfaces on a screenshot upload or a document extraction instead.
    expect(declared).toContain("sharp");
    expect(declared).toContain("pdf-parse");

    // ...and sharp specifically is still visible to the derivation. If this
    // fails, its import in server/agentRoutes.ts stopped being a string literal
    // and the package now has to be carried in CARRIED_BY_HAND by hand.
    expect(imported).toContain("sharp");
  });
});
