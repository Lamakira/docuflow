/**
 * The ESM loader hook automatic instrumentation needs in development (#26).
 *
 * `npm run dev` runs TypeScript through tsx, which loads the server as ES
 * modules; `npm start` runs the esbuild bundle, which is CommonJS. That
 * difference decides how OpenTelemetry can patch a library:
 *
 *   CommonJS  every `require` goes through one function, which the SDK wraps.
 *             Nothing else is needed, which is why the container's entry point
 *             is `node dist/index.cjs` and nothing more.
 *
 *   ESM       imports are resolved by the module loader, and a patched copy of
 *             `express` handed back to a `require` never reaches an `import`.
 *             Node's answer is a loader hook, registered before the program's
 *             module graph is built — hence `--import` on the dev script rather
 *             than a call inside server/telemetry.ts, which runs too late.
 *
 * Without this, `npm run dev` still traces HTTP and PostgreSQL — those
 * instrumentations patch objects in place — and silently loses every express
 * route span and the `http.route` attribute with them. The failure is invisible:
 * traces still arrive, they are just anonymous.
 */

import { register } from "node:module";

register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
