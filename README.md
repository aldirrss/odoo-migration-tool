# Odoo Migration Tool

A Next.js 14 + TypeScript web application for migrating data from a legacy Odoo 16 PostgreSQL database to a fresh Odoo database (versions 16–19 supported).

## Features

- **5-step guided workflow:** Connections → Extract → Clean → Validate → Import
- **Extensible module registry:** Built-in support for Base, Accounting, and POS — easily add custom modules
- **Split-view editor:** Side-by-side comparison of source vs. cleaned data with field-level diff highlighting
- **Dependency-aware deletion:** Warns about FK references before removing records, with block/nullify/cascade semantics
- **Date-filtered transactions:** Master data is migrated in full; transactions filtered by configurable date (default: from 2026-01-01)
- **Local staging database:** All work happens in a local PostgreSQL DB before touching the target
- **Encrypted credentials:** Connection passwords are stored locally with AES-256-GCM encryption

## Tech Stack

- Next.js 14 (App Router) + React 18 + TypeScript
- PostgreSQL via `pg` (source & target) and Drizzle ORM (staging)
- Tailwind CSS + Radix UI primitives (shadcn-style components)
- TanStack Query + Zustand
- Zod for input validation

## Prerequisites

1. **Node.js 18.17+** (Node 20+ recommended)
2. **Local PostgreSQL 14+** for the staging database
3. **Network access** to your source and target Odoo PostgreSQL databases

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create the local staging database
createdb odoo_migration_staging
# Or via psql:
#   psql -U postgres -c "CREATE DATABASE odoo_migration_staging;"

# 3. Copy the env template and fill in values
cp .env.example .env

# 4. Generate an encryption key (64-char hex) and put it in .env as ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 5. Apply staging-DB schema migrations
npm run db:generate
npm run db:migrate

# 6. Start the dev server
npm run dev
```

Then open <http://localhost:3000>.

## Workflow

### 1. Connections
Add at least one **source** profile (your legacy Odoo 16 DB) and one **target** profile (the fresh Odoo DB). Use the "Test connection" button to verify before saving.

### 2. Extract
Pick source + target profiles and start the extraction. The tool will read every defined table from the source and copy rows into the local staging DB (as JSONB blobs). Master data is extracted in full; transaction tables are filtered by the `TRANSACTION_DATE_FROM` env value.

### 3. Clean
Browse staged tables by module. Click a table to open the per-record editor:
- **Source** view: read-only original data
- **Edit** view: editable staged copy
- **Split** view: side-by-side with yellow highlights on changed fields

Deleting a record performs a soft-delete in staging. The tool checks all incoming FK relations and blocks deletion if active dependents exist with `onDelete: block`.

### 4. Validate
Runs a structural check against the target DB:
- For each referenced FK, verifies the parent record exists either in the target DB or in non-deleted staging
- Flags missing references as errors and lets you go back to clean them up

### 5. Import
Writes the cleaned staging data to the target DB in topological order (master tables first, transactions last). Records that failed validation are skipped by default.

## Project Structure

```
app/
├── api/                  # API routes (REST endpoints)
├── connections/          # Connection profiles page
├── extract/              # Extract page
├── staging/              # Staging browser + per-table editor
├── validate/             # Validation report
└── import/               # Import page

components/
├── ui/                   # shadcn-style primitives (Button, Card, etc.)
├── split-view-editor.tsx # Source/Edit/Split toggle editor
├── relation-warning.tsx  # Dependency impact display
└── progress-stepper.tsx  # 5-step nav

lib/
├── odoo/
│   ├── types.ts          # OdooModule / TableDefinition / RelationDefinition
│   └── modules/          # base.ts, accounting.ts, pos.ts, + your custom
├── db/
│   ├── source.ts         # Source DB pool
│   ├── target.ts         # Target DB pool
│   ├── staging.ts        # Drizzle (local)
│   ├── staging-schema.ts # Drizzle schema
│   └── profiles.ts       # Encrypted profile store
├── migration/
│   ├── extractor.ts
│   ├── cleaner.ts
│   ├── validator.ts
│   └── importer.ts
└── store.ts              # Zustand session state
```

## Adding a Custom Odoo Module

1. Create `lib/odoo/modules/your_module.ts`:

```ts
import type { OdooModule } from "../types";

export const yourModule: OdooModule = {
  name: "your_module",
  label: "Your Module",
  tables: [
    {
      tableName: "your_table",
      odooModel: "your.model",
      label: "Your Table",
      type: "master", // or "transaction" with dateFilterColumn
      importOrder: 300,
    },
  ],
  relations: [
    {
      fromTable: "your_table",
      fromColumn: "partner_id",
      toTable: "res_partner",
      toColumn: "id",
      onDelete: "block",
    },
  ],
};
```

2. Register it in `lib/odoo/modules/index.ts`:

```ts
import { yourModule } from "./your_module";

export const moduleRegistry: OdooModule[] = [
  baseModule,
  accountingModule,
  posModule,
  yourModule,  // <-- add here
];
```

No other code changes are needed — extract/clean/validate/import all read from the registry.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `STAGING_DATABASE_URL` | PostgreSQL URL for the local staging DB | `postgresql://postgres:postgres@localhost:5432/odoo_migration_staging` |
| `ENCRYPTION_KEY` | 64-char hex string for AES-256-GCM (required) | none |
| `TRANSACTION_DATE_FROM` | ISO date used to filter transaction tables | `2026-01-01` |

## Safety Notes

- **Always back up the target DB before running the import step.**
- The target DB is expected to be **fresh** (i.e. a newly-initialised Odoo DB). The tool uses raw INSERTs with `ON CONFLICT (id) DO NOTHING`, so existing records with conflicting IDs will be silently kept.
- After import, sequences are reset to `MAX(id) + 1` so Odoo can continue allocating new IDs.

## License

Internal tool — adapt to your needs.
