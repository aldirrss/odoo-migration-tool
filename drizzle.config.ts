import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/db/staging-schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.STAGING_DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/odoo_migration_staging",
  },
} satisfies Config;
