---
name: Desktop agent forge hang fix
description: electron-forge 7 + webpack plugin hangs indefinitely at "Running postPackage hook" — root cause and fix for dist build scripts.
---

## Rule
In `dist-linux.js`, `dist-win.js`, `dist-mac.js`: the `electron-forge package` call must use `{ timeout: 180000, killSignal: "SIGKILL" }` and the catch block must check whether `out/<platform>/` exists to distinguish a hung-but-succeeded packaging from a real failure.

## Why
`@electron-forge/plugin-webpack` calls `webpack(options).run(cb)` but never calls `compiler.close()`. Webpack 5 keeps internal handles open (even with `cache: false`), preventing natural process exit. Listr2 also intercepts SIGTERM, so the forge process never terminates on its own after packaging completes. Result: the process spins at "Running postPackage hook" forever.

## How to apply
- `execSync("npx electron-forge package ...")` with `timeout: 180000, killSignal: "SIGKILL"`
- Wrap in try/catch; in catch, check `fs.existsSync(outDir) && fs.readdirSync(outDir).find(n => n.endsWith("-linux-x64"))` — if found, log a note and continue; if not found, log error and `process.exit(1)`
- Declare `const outDir` BEFORE the try block (catch block references it)
- `forge.config.ts` hook `postPackage: async () => { setImmediate(() => process.exit(0)); }` is a fast-path on envs that do invoke the hook, but cannot be relied upon alone
- `cache: false` (or `cache: process.env.NODE_ENV === 'production' ? false : { type: 'filesystem' }`) in both webpack configs reduces open handles but does not fully fix the hang
