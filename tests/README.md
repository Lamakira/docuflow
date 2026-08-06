# Test harness

HTTP-seam tests against the real Express app and a real PostgreSQL, per the
testing decisions in [Spec #18](https://github.com/Lamakira/docuflow/issues/18):
the primary seam is the HTTP contract; external providers get stubbed, never
application internals.

## Running

```bash
npm run test:db:up   # start the disposable Postgres (docker-compose.test.yml, port 5433)
npm test             # vitest run
npm run test:watch   # watch mode
npm run test:db:down # stop the database
```

## How it works

- `tests/setup.ts` fixes the environment **before any server module loads**
  (`DATABASE_URL`, `DB_DRIVER=pg`, test secrets). Server code is therefore
  only ever imported dynamically, never at a module's top level.
- `tests/global-setup.ts` pushes the schema from `shared/schema.ts` into the
  test database once per run (`drizzle-kit push`), pending migration-journal
  consolidation (#24).
- `tests/helpers/app.ts` boots the real app assembly (`server/app.ts`) —
  the exact middleware chain production uses, minus Vite/static and listen.
- `tests/helpers/db.ts` truncates all tables between tests.
- `DB_DRIVER=pg` makes `server/db.ts` use the standard node-postgres driver;
  production default remains Neon's serverless driver.

## Safety (ADR-0018)

The harness **refuses non-local database hosts** unless
`ALLOW_REMOTE_TEST_DB=1` is set. It truncates every table — never point it at
a database you care about, and never at anything production-related.

## Conventions

- Characterization suites freeze **current** behavior, bugs and quirks
  included — a test failing after a refactor means the contract moved.
  Document captured quirks with a comment at the assertion.
- Assert externally visible behavior (status, body, headers, side effects
  through other endpoints), never implementation details.
- New external-provider stubs belong at the provider client boundary, not
  inside application modules.
