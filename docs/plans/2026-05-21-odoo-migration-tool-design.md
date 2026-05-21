# Odoo DB Migration Tool — Design Document
**Date:** 2026-05-21
**Status:** Approved — Built & Delivered

---

## Summary

A TypeScript-based internal web application for migrating Odoo 16 data to a fresh Odoo database (version 16 or higher). The tool extracts data directly from a source PostgreSQL database, stores it in a local staging PostgreSQL database, provides a visual split-view editor for cleaning and validating data, and finally imports the cleaned data directly into the target PostgreSQL database. Transactional data (records that produce journal entries/items) is scoped to >= January 1, 2026. All master data is extracted without date restriction, including archived records.

---

## Approach Chosen

**Next.js 15 monolith (App Router + API Routes)**

Single TypeScript codebase handling both frontend and backend. API routes handle all direct PostgreSQL connections server-side, keeping credentials secure. Chosen over a separate backend for simplicity and faster development as an internal tool.

---

## Design Details

### 1. Architecture

```
odoo-migration-tool/
├── app/
│   ├── page.tsx                        → Dashboard
│   ├── connections/
│   │   └── page.tsx                    → Manage DB connection profiles
│   ├── extract/
│   │   └── page.tsx                    → Extract wizard (source → staging)
│   ├── staging/
│   │   ├── page.tsx                    → Table browser (all extracted tables)
│   │   └── [table]/
│   │       └── page.tsx                → Split-view editor per table
│   ├── validate/
│   │   └── page.tsx                    → Validation report (staging vs target config)
│   └── import/
│       └── page.tsx                    → Import progress & logs
│
├── lib/
│   ├── db/
│   │   ├── source.ts                   → Source DB connection (pg)
│   │   ├── target.ts                   → Target DB connection (pg)
│   │   └── staging.ts                  → Staging DB connection (Drizzle ORM)
│   ├── odoo/
│   │   ├── tables.ts                   → Table definitions + filter rules
│   │   ├── relations.ts                → Inter-table relation mappings
│   │   └── modules/
│   │       ├── base.ts                 → Master data tables
│   │       ├── accounting.ts           → Accounting transaction tables
│   │       ├── pos.ts                  → Point of Sale tables
│   │       └── index.ts                → Module registry (extensible)
│   └── migration/
│       ├── extractor.ts                → Extract logic (source → staging)
│       ├── cleaner.ts                  → CRUD operations on staging
│       ├── validator.ts                → Validate staging vs target config
│       └── importer.ts                 → Import logic (staging → target)
│
├── components/
│   ├── split-view/                     → Diff editor (source | edit | split)
│   ├── relation-warning/               → Dependency impact display
│   └── progress-stepper/              → Step indicator (Extract→Clean→Validate→Import)
│
└── config/
    └── connections.json                → Saved DB profiles (encrypted at rest)
```

---

### 2. Tech Stack

| Layer | Library | Purpose |
|-------|---------|---------|
| Framework | Next.js 15 (App Router) | Full-stack TypeScript framework |
| Language | TypeScript | Full type safety across the stack |
| Styling | Tailwind CSS + shadcn/ui | UI components & layout |
| Table | TanStack Table | Complex data tables with sort/filter |
| Data Fetching | TanStack Query | Server state, caching, mutations |
| State | Zustand | Global state (migration session, progress) |
| DB Driver | pg (node-postgres) | Direct PostgreSQL connections |
| Staging ORM | Drizzle ORM | Type-safe staging DB schema & queries |
| Validation | Zod | Schema & form validation |
| Diff View | react-diff-viewer-continued | Split-view source vs edit comparison |
| Encryption | Node.js crypto (AES-256-GCM) | Credential storage |

---

### 3. Data Scope

#### Master Data — All records including archived, no date filter
```
res.partner              → Customers, vendors, contacts
res.company              → Companies & branches
res.currency             → Currencies
res.country              → Countries
product.template         → Product templates
product.product          → Product variants
product.category         → Product categories
account.account          → Chart of accounts
account.journal          → Accounting journals
account.tax              → Taxes
account.tax.group        → Tax groups
account.fiscal.position  → Fiscal positions
account.payment.term     → Payment terms
uom.uom                  → Units of measure
uom.category             → UoM categories
res.users                → Users
res.groups               → User groups
hr.employee              → Employees
stock.location           → Stock locations
stock.warehouse          → Warehouses
pos.config               → POS configurations
pos.payment.method       → POS payment methods
```

#### Transactional Data — Filter: date >= 2026-01-01 (configurable via TRANSACTION_DATE_FROM)
```
account.move             → Invoices, bills, journal entries
account.move.line        → Journal items
account.payment          → Payments
sale.order               → Sales orders
sale.order.line          → Sales order lines
purchase.order           → Purchase orders
purchase.order.line      → Purchase order lines
stock.picking            → Delivery orders / receipts
stock.move               → Stock movements
stock.move.line          → Stock movement details
stock.valuation.layer    → Inventory valuation
pos.session              → POS sessions
pos.order                → POS orders
pos.order.line           → POS order lines
pos.payment              → POS payments
```

---

### 4. Data Flow

```
[SOURCE DB]  ──pg──▶  [EXTRACT]  ──▶  [STAGING DB (local PostgreSQL)]
                                                   │
                                             [CLEANING UI]
                                             Split View Editor
                                             CRUD + Relation Warnings
                                                   │
                                             [VALIDATE]
                                             Check vs Target DB config
                                             (CoA, company, currency, journals)
                                                   │
                                          [TARGET DB]  ◀──pg──  [IMPORT]
```

---

### 5. UI/UX

#### Dashboard (`/`)
- Shows active Source DB and Target DB connection profiles
- Migration progress stepper: Connections → Extract → Clean → Validate → Import
- Quick stats: total tables extracted, records pending review, validation errors

#### Connection Profiles (`/connections`)
- List of saved profiles (name, host, port, database, user, role)
- Add / Edit / Delete profiles
- Test connection button
- Credentials stored encrypted in `config/connections.json` (AES-256-GCM)

#### Extract (`/extract`)
- Select Source DB profile
- Select Target DB profile
- Start extraction with real-time progress per table
- Error log for failed tables

#### Table Browser (`/staging`)
- Grid of all extracted tables grouped by module (Base, Accounting, POS)
- Per table: row count, dirty count (edited records), validation issue count
- Click table → opens split-view editor

#### Split-View Editor (`/staging/[table]`)
- **View toggle:** `Source` | `Edit` | `Split`
  - Source: read-only view of original extracted data
  - Edit: editable staging data
  - Split: side-by-side, left = source (read-only), right = staging (editable)
- List panel: paginated records list with search + dirty filter
- Field-level diff highlighting in yellow (changed fields)
- **Relation Warning Panel:** shows all dependent records across tables
  - `block` badge: hard block delete if active deps exist
  - `nullify` badge: warn, will set FK to null on import
  - `cascade` badge: warn, will cascade delete

#### Validate (`/validate`)
- Checks staging FK references against target DB and other staged records
- Per-table: total / passed / warnings / failed counts
- Records with `fail` status are skipped during import by default

#### Import (`/import`)
- Pre-import confirmation dialog
- Real-time progress (polling every 3s)
- Per-table summary: success / errors / skipped counts
- Sequence reset after each table import

---

### 6. Module Registry (Extensibility)

```typescript
// lib/odoo/modules/index.ts

interface TableDefinition {
  tableName: string           // PostgreSQL table name
  odooModel: string           // Odoo model name (e.g. "account.move")
  label: string               // Human-readable label for UI
  type: "master" | "transaction"
  dateFilterColumn?: string   // e.g. "date" for transactions
  importOrder?: number        // Lower = imported first
}

interface RelationDefinition {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  onDelete: "block" | "nullify" | "cascade"
  label?: string
}

interface OdooModule {
  name: string
  label: string
  description?: string
  tables: TableDefinition[]
  relations: RelationDefinition[]
}

export const moduleRegistry: OdooModule[] = [
  baseModule,
  accountingModule,
  posModule,
  // To add custom module: create file in modules/ and push here
]
```

Adding a new custom module requires only:
1. Create `lib/odoo/modules/custom_module.ts`
2. Define `TableDefinition[]` and `RelationDefinition[]`
3. Push to `moduleRegistry` in `index.ts`

---

### 7. Error Handling

| Scenario | Behavior |
|----------|---------|
| Source DB connection fail | Show error on connection profile, block extraction |
| Table extraction fail | Skip table, log error, continue with remaining tables |
| FK violation on import | Per-row error log, skip row, continue batch |
| Delete with active dependencies | Hard block in UI, show dependency list |
| Validation mismatch | Warning flag on record, allow override |
| Import partial failure | Per-row error log, sequence still reset |

---

### 8. Security

- All DB connections handled server-side in API routes — credentials never exposed to browser
- Connection profiles stored in `config/connections.json` with AES-256-GCM encryption
- No authentication required (internal tool, single user)
- Staging DB is local — no external network exposure

---

### 9. Target DB Requirements

Target database **must** be a fresh Odoo install (not a blank PostgreSQL DB):

1. Create via Odoo Database Manager (`http://your-odoo:8069/web/database/manager`)
2. Install all required modules (Accounting, POS, etc.)
3. Do NOT add any business data
4. Connect its PostgreSQL directly to the migration tool as "target" profile

This ensures all Odoo system records (sequences, `ir.model`, `ir.module.module`, default CoA, etc.) are already present before the migration inserts business data on top.

---

### 10. Import Strategy

- `INSERT ... ON CONFLICT (id) DO NOTHING` — safe to re-run
- Tables imported in `importOrder` sequence (master data first)
- Columns not present in target are filtered via `information_schema.columns`
- Sequence reset after each table: `setval(pg_get_serial_sequence(...), MAX(id), true)`
- Records with `validation_status = 'fail'` skipped by default (configurable)

---

## Parking Lot (v2 Ideas — Explicitly Deferred)

- **Multi-tenant / multi-user** — login system, project per client
- **Custom module auto-discovery** — scan Odoo DB for installed modules and auto-generate table definitions
- **Scheduled migration** — run migration on a cron schedule
- **Version upgrade mapping** — handle field renames/removals between Odoo 16 → 17/18/19
- **Audit trail** — log all cleaning edits with before/after values and timestamps
- **Export staging to CSV/Excel** — for offline review before import
- **Conflict resolution wizard** — guided UI for resolving FK conflicts in bulk
- **SSE/WebSocket streaming** — real-time extraction progress without polling
