# Discovery Scan Performance — Design Doc

**Date:** 2026-05-21
**Status:** Built & Delivered
**Predecessor:** [2026-05-21-phase-2-plan.md](./2026-05-21-phase-2-plan.md) (M3 — Auto-Discovery)

---

## Problem

Discovery scan against a real Odoo source DB took **207,819 ms (~3.5 minutes)**
even though the source DB is on `localhost`. Profile reveals classic N+1 plus
slow `information_schema` lookups:

| Pattern | Calls |
|---|---|
| Per-module model lookup | ~100 |
| Per-table column lookup (`information_schema.columns`) | ~1,000 |
| Per-table FK lookup (3-way join on `information_schema`) | ~1,000 |
| Per-table upsert into `discovered_tables` | ~1,000 |
| Per-FK insert into `discovered_relations` | ~3,000 |
| **Total queries** | **~6,200** |

Two factors compound:

1. **`information_schema.*` views are slow on large Odoo DBs.** They're abstractions over `pg_catalog` with heavy joins. Each call costs 30–100 ms when the catalog has 1000+ tables.
2. **Sequential `await` loops.** No batching, no concurrency.

Locally, ~6200 queries × ~40 ms ≈ 200 s. Matches observed.

---

## Approach

Replace the N+1 query strategy with a small fixed number of bulk operations:

| Stage | Before | After |
|---|---|---|
| Scan modules | 1 | 1 |
| Model→table mapping | 100 (per-module) | **1 bulk** (`WHERE module = ANY($1)`) |
| Column metadata | 1,000 (`information_schema.columns`) | **1 bulk** (`pg_catalog.pg_attribute`, `WHERE relname = ANY($1)`) |
| FK introspection | 1,000 (3-way `information_schema`) | **1 bulk** (`pg_catalog.pg_constraint` join) |
| Upsert modules | 100 | **1 bulk** (`INSERT ... ON CONFLICT DO UPDATE`) |
| Upsert tables | 1,000 | **1 bulk** (chunked 500) |
| Insert new relations | 3,000 | **1 bulk** (chunked 500) |
| **Total** | **~6,200** | **~7** |

`pg_catalog.pg_attribute` is much faster than `information_schema.columns` on
large catalogs because the latter is a view that joins three system tables
with PL/pgSQL-style filtering. Direct `pg_catalog` queries skip the view layer.

Estimated wall time: **<5 s on a 1000-table Odoo install**, vs 208 s before.

---

## Edge cases handled

- **Abstract / Transient Odoo models** appear in `ir_model` but have no physical
  table in `public` schema. Implicitly dropped — `pg_attribute` returns no rows
  for them, so they're absent from the column map and skipped.
- **Many-to-many relation tables** (no `id` column). Filtered explicitly:
  `if (!cols.some((c) => c.name === "id")) continue;` — keeps the extractor's
  `SELECT * ... ORDER BY id` assumption valid.
- **Re-scan with user-classified rows.** Bulk upsert uses
  `CASE WHEN user_classified THEN existing ELSE excluded END` to preserve
  user-edited `type`, `dateFilterColumn`, and `confidence`. `enabled` and
  `userClassified` are never touched by the upsert SET clause.
- **Existing relations with user-edited `onDelete`.** New code never updates
  relations: we fetch existing tuples first, diff in memory, and INSERT only
  new ones. User edits to `onDelete` are safe.
- **Concurrent scan attempts.** Transaction begins with
  `LOCK TABLE discovered_modules IN EXCLUSIVE MODE`, serializing parallel
  scans. The lock is short-lived because everything inside is bulk.
- **Built-in registry overlap.** Tables already declared in `lib/odoo/modules/`
  (base, accounting, pos) are excluded via `findTable(tableName)` before the
  bulk column query is even issued.

---

## UX additions

1. **Preview endpoint:** `GET /api/projects/[id]/discovery/preview` returns
   `{ installedModules, candidateModels }`. UI button **"Check size first"**
   calls this so the user sees what they're about to scan before committing.
2. **Elapsed timer:** while a scan is running, a small `Ns elapsed` counter
   ticks beside the spinner so the user knows the request isn't hung.
3. **Removed misleading copy:** "typically takes < 30s on small Odoo DBs" was
   factually wrong on the user's DB. Replaced with: "Typical runtime: a few
   seconds even for large Odoo databases."
4. **`maxDuration`** on the scan route dropped from `120` → `30` seconds. If
   a scan still exceeds 30 s after these optimizations, something is wrong
   (likely a much larger DB than expected) and we want to know about it.

Cancel-mid-scan and SSE-streaming progress remain in the parking lot. Not
worth the complexity once scan completes in seconds.

---

## Files changed

- [lib/migration/discovery.ts](../../lib/migration/discovery.ts) — full rewrite to bulk queries + transaction + LOCK.
- [app/api/projects/[id]/discovery/preview/route.ts](../../app/api/projects/[id]/discovery/preview/route.ts) — new endpoint.
- [app/api/projects/[id]/discovery/scan/route.ts](../../app/api/projects/[id]/discovery/scan/route.ts) — lower `maxDuration` to 30.
- [app/projects/[id]/discovery/page.tsx](../../app/projects/[id]/discovery/page.tsx) — preview button, elapsed timer, updated copy.

No schema changes. No new migrations.

---

## Verification

- `npx tsc --noEmit`: clean
- `npm run lint`: clean
- Manual: re-run scan against the same source DB and measure. Target: <10 s.

---

## Parking lot

- **SSE streaming progress** if scan ever exceeds 10 s in production.
- **Background-job queue + cancel** if scans grow beyond `maxDuration=30`.
- **Discovery diff between rescans** ("3 modules added, 1 removed").
- **Auto-graduate discovered classification to built-in registry** by exporting
  to `lib/odoo/modules/<name>.ts`.
