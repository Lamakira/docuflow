import { mkdtempSync, rmSync } from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../script/bundles";
import { installedByImage, packageOf } from "../helpers/runtimeTree";

/**
 * What the runtime image has to install, derived from the bundle (#36).
 *
 * `npm ci --omit=dev` in the Dockerfile's runtime stage omits the dev half and
 * nothing else, so `dependencies` plus `optionalDependencies` is a claim about
 * the server: these are the modules `dist/index.cjs` still resolves from
 * node_modules after `script/bundles.ts` has inlined its allowlist — see
 * `tests/helpers/runtimeTree.ts`. The claim used to be false in
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
 * package can be present and still fail to initialise — `sharp` needs libvips.
 * `.github/workflows/ci.yml` imports every `dependencies` entry inside the built
 * image, which is where that half is answered, on the runtime tree rather than
 * on this checkout's.
 */

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
  // other one, `bufferutil`, is an `optionalDependencies` entry: it installs,
  // and the test below pins it external so the copy that installs is the copy
  // `ws` loads. This one is declared nowhere, which is also why esbuild cannot
  // resolve it and it reaches the metafile as an external import at all.
  "utf-8-validate": "declared nowhere; optional native speedup for ws, required in a try/catch",
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

    declared = installedByImage();
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
    expect(declared).toContain("unpdf");

    // ...and sharp specifically is still visible to the derivation. If this
    // fails, its import in server/agentRoutes.ts stopped being a string literal
    // and the package now has to be carried in CARRIED_BY_HAND by hand.
    expect(imported).toContain("sharp");
  });

  it("leaves the native optional speedup for node_modules to answer", () => {
    // Bundling `bufferutil` inlines node-gyp-build with it, and node-gyp-build
    // finds the prebuild beside `__dirname` — which after bundling is `dist/`
    // and not `node_modules/bufferutil`. It throws there, inside the try/catch
    // `ws` wraps it in, so the image installed the speedup, `ws` used its
    // JavaScript fallback, and nothing anywhere said so. Only the manifest
    // field it is declared under kept it out of the external list.
    expect(imported).toContain("bufferutil");
  });

  it("keeps its exception lists honest", () => {
    // An exception outlives what it excused: the import moves, the package
    // goes, and the entry stays behind quietly excusing a name that no longer
    // appears. Reading both lists back against the build is what makes a stale
    // one fail rather than sit, and it is the only thing that reads the reasons.
    for (const [name, reason] of Object.entries(NOT_INSTALLED)) {
      expect(
        imported,
        `${name} is excused as "${reason}", but the bundle no longer imports it`
      ).toContain(name);
    }

    for (const [name, reason] of Object.entries(CARRIED_BY_HAND)) {
      expect(
        declared,
        `${name} is carried by hand as "${reason}", but nothing installs it`
      ).toContain(name);
      expect(
        imported,
        `${name} is carried by hand as "${reason}", but the metafile sees it — drop the entry`
      ).not.toContain(name);
    }
  });
});
