/**
 * Mail / Discuss module.
 *
 * We deliberately keep this minimal. Migrating chatter history
 * (mail_message, mail_followers, mail_notification, mail_activity) is almost
 * never desirable: it doubles the staging volume, depends on cross-model
 * polymorphic references that resist FK validation, and the data has little
 * business value in a fresh target DB. The auto-discovery feature (Phase 2)
 * is the right place to enable those tables on a per-project basis if needed.
 *
 * Only `mail_template` is included: it is reusable master data referenced by
 * sale orders, invoices, etc.
 */

import type { OdooModule } from "../types";

export const mailModule: OdooModule = {
  name: "mail",
  label: "Mail & Discuss",
  description: "Mail templates (chatter history is intentionally excluded)",
  tables: [
    {
      tableName: "mail_template",
      odooModel: "mail.template",
      label: "Email Templates",
      type: "master",
      importOrder: 900,
    },
  ],
  relations: [
    {
      fromTable: "mail_template",
      fromColumn: "user_id",
      toTable: "res_users",
      toColumn: "id",
      onDelete: "nullify",
      label: "Template author",
    },
  ],
};
