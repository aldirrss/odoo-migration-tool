# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Next.js 14 (App Router) + TypeScript web tool for migrating data from a legacy Odoo 16 PostgreSQL database into a fresh Odoo DB (versions 16–19). The user-facing flow is a 5-step pipeline: **Connections → Extract → Clean → Validate → Import**.

## Commands

```bash
npm run dev              # next dev (http://localhost:3000)
npm run build            # next build
npm run start            # production server
npm run lint             # next lint (ESLint)

npm run db:generate      # drizzle-kit generate — produce SQL migrations from staging-schema.ts
npm run db:migrate       # drizzle-kit migrate  — apply pending migrations to the local staging DB
npm run db:studio        # drizzle-kit studio   — browse the staging DB
```

There is no test runner configured.

## Required environment

Copy `.env.example` to `.env`. `ENCRYPTION_KEY` (64-char hex) is **mandatory** — `lib/db/profiles.ts` throws on startup without it. Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
`STAGING_DATABASE_URL` points at a local PostgreSQL DB (`createdb odoo_migration_staging`). `TRANSACTION_DATE_FROM` (default `2026-01-01`) controls the cutoff used to filter transaction tables during extract.

## Architecture — three databases, one tool

The system juggles three PostgreSQL connections at once. Keep them straight:

1. **Source** ([lib/db/source.ts](lib/db/source.ts)) — the legacy Odoo 16 DB. Read-only. Pool keyed by profile ID, reused.
2. **Staging** ([lib/db/staging.ts](lib/db/staging.ts), schema in [lib/db/staging-schema.ts](lib/db/staging-schema.ts)) — a **local** Drizzle-managed DB. All extraction output lands here as JSONB blobs in `staged_records`; all cleaning/validation work happens here before anything touches the target. This is the only DB whose schema is managed by this repo.
3. **Target** ([lib/db/target.ts](lib/db/target.ts)) — a fresh Odoo DB. Written only during the Import step using `INSERT ... ON CONFLICT (id) DO NOTHING`, then `MAX(id)+1` sequence resets.

Connection profiles live in `config/connections.json` (gitignored). Passwords are AES-256-GCM encrypted via `ENCRYPTION_KEY` ([lib/db/profiles.ts](lib/db/profiles.ts)).

## Architecture — the module registry

This is the central extensibility point. **Do not hardcode table names in extract/clean/validate/import logic** — read them from the registry.

- [lib/odoo/types.ts](lib/odoo/types.ts) defines `OdooModule`, `TableDefinition` (`master` vs `transaction`, `importOrder`, optional `dateFilterColumn`), and `RelationDefinition` (`onDelete: "block" | "nullify" | "cascade"`).
- [lib/odoo/modules/](lib/odoo/modules/) holds one file per Odoo module (`base.ts`, `accounting.ts`, `pos.ts`). Each exports an `OdooModule`.
- [lib/odoo/modules/index.ts](lib/odoo/modules/index.ts) is the registry — `moduleRegistry: OdooModule[]` plus helpers `getAllTables()`, `getAllRelations()`, `findTable()`, `getIncomingRelations()`, `getOutgoingRelations()`.

To add a custom Odoo module: create `lib/odoo/modules/<your_module>.ts`, then push it into the `moduleRegistry` array in `index.ts`. The extract/clean/validate/import pipelines iterate the registry — no changes needed elsewhere.

`importOrder` (lower = earlier) drives both extraction order and topological import order. Master tables get low values; transactions get high values so their FK parents already exist when they're written to target.

## Architecture — the migration pipeline

Each step has a dedicated module in [lib/migration/](lib/migration/) and a matching API route under [app/api/](app/api/):

- **[lib/migration/extractor.ts](lib/migration/extractor.ts)** — creates an `extraction_jobs` row, then iterates `getAllTables()`. For each table issues `SELECT * FROM <source>.<table>` (with `>= TRANSACTION_DATE_FROM` filter when `type === "transaction"`) and writes one `staged_records` row per result with `sourceData` and `stagedData` both populated from the raw row.
- **[lib/migration/cleaner.ts](lib/migration/cleaner.ts)** — applied per record via the Staging UI. Edits update `stagedData` and flip `isDirty`. Deletes are soft (`isDeleted = true`); before allowing a delete, the cleaner checks `getIncomingRelations(table)` and refuses if any active child rows still reference the record under an `onDelete: "block"` relation.
- **[lib/migration/validator.ts](lib/migration/validator.ts)** — for each non-deleted staged record, walks `getOutgoingRelations(table)` and verifies the parent exists in either target DB or non-deleted staging. Writes `validation_status` + `validation_messages` back to `staged_records`.
- **[lib/migration/importer.ts](lib/migration/importer.ts)** — iterates tables in `importOrder` order; for each non-deleted (and, by default, validation-passed) staged record, issues `INSERT ... ON CONFLICT (id) DO NOTHING` against target. After all tables, resets each table's `id` sequence to `MAX(id)+1`. System columns (`create_uid`, `create_date`, `write_uid`, `write_date`) are copied as-is — Odoo's ORM is bypassed.

The staging-DB schema captures all this:
- `extraction_jobs` (audit log) → `staged_records` (one row per Odoo record, `(extractionJobId, tableName, sourceId)` unique) → `import_jobs`
- `table_extraction_status` tracks per-table progress within an extraction.

## Frontend conventions

- App Router under [app/](app/) — pages match pipeline steps: `connections/`, `extract/`, `staging/`, `validate/`, `import/`.
- API routes are server-only and call into `lib/migration/*`. Long-running jobs (`extract`, `import`) report progress; the frontend polls `/api/extract/status` and `/api/import/summary` rather than streaming.
- Session state (selected source/target profile, active job ID) lives in Zustand with `persist` middleware: [lib/store.ts](lib/store.ts) — key `odoo-migration-session`. Server data uses TanStack Query.
- UI primitives in [components/ui/](components/ui/) are shadcn-style wrappers over Radix. The split-view editor ([components/split-view-editor.tsx](components/split-view-editor.tsx)) diffs `sourceData` vs `stagedData` with yellow per-field highlights.
- Path alias `@/*` resolves from the repo root (see [tsconfig.json](tsconfig.json)).

## Things to remember

- The target DB is assumed **fresh** — `ON CONFLICT (id) DO NOTHING` means existing rows with conflicting IDs are silently kept, not updated.
- Master tables extract in full; transaction tables are date-filtered by `TRANSACTION_DATE_FROM`. A table's `type` determines which behavior applies.
- All connection profile passwords flow through `encrypt()` / `decrypt()` in [lib/db/profiles.ts](lib/db/profiles.ts); changing `ENCRYPTION_KEY` invalidates every stored profile.
- `staged_records.sourceData` is immutable — only edit `stagedData`. The `isDirty` flag is the source of truth for "edited".
