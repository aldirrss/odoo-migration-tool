/**
 * Staging database connection (Drizzle ORM).
 * Uses a single shared pool — staging is always local.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./staging-schema";

const stagingPool = new Pool({
  connectionString:
    process.env.STAGING_DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/odoo_migration_staging",
  max: 10,
});

stagingPool.on("error", (err) => {
  console.error("[staging-pool] error", err);
});

export const stagingDb = drizzle(stagingPool, { schema });
export { schema };
