import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What the runtime image installs, as the smoke suites read it (#36).
 *
 * `tests/smoke/server-bundle.test.ts` and `tests/smoke/migrate-bundle.test.ts`
 * both ask one question of two different bundles — is every bare specifier this
 * build left external something the runtime stage will have? — and both used to
 * carry their own copy of the answer's three parts. One copy is the point: a
 * manifest field added on one side and forgotten on the other is exactly the
 * drift that let `bufferutil` be bundled.
 */
export const REPO = join(import.meta.dirname, "..", "..");

/** Bare package name of an import specifier: `pg`, `@opentelemetry/api`. */
export function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Every package name `npm ci --omit=dev` installs, sorted.
 *
 * `--omit=dev` omits the dev half and nothing else, so `optionalDependencies`
 * is installed too and belongs here — it is a tree the bundle's externals may
 * resolve from, and `script/bundles.ts` marks it external for that reason.
 *
 * The install, not the image: since #43 the `Dockerfile` deletes
 * `@napi-rs/canvas` after this install, so the image is one package short of
 * what this function returns. Nothing here should learn about that — the
 * deletion is a packaging decision guarded where it happens, and a suite that
 * mirrored it would be a second copy of the answer to drift from.
 */
export function installedByImage(): string[] {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ].sort();
}
