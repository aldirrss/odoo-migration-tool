/**
 * CRM module: sales teams, stages, tags, lost reasons and leads.
 */

import type { OdooModule } from "../types";

export const crmModule: OdooModule = {
  name: "crm",
  label: "CRM",
  description: "Sales teams, pipeline stages and customer leads",
  tables: [
    // ===== Master data =====
    {
      tableName: "crm_team",
      odooModel: "crm.team",
      label: "Sales Teams",
      type: "master",
      importOrder: 550,
    },
    {
      tableName: "crm_stage",
      odooModel: "crm.stage",
      label: "Pipeline Stages",
      type: "master",
      importOrder: 560,
    },
    {
      tableName: "crm_tag",
      odooModel: "crm.tag",
      label: "CRM Tags",
      type: "master",
      importOrder: 570,
    },
    {
      tableName: "crm_lost_reason",
      odooModel: "crm.lost.reason",
      label: "Lost Reasons",
      type: "master",
      importOrder: 580,
    },
    // ===== Transactions =====
    {
      tableName: "crm_lead",
      odooModel: "crm.lead",
      label: "Leads / Opportunities",
      type: "transaction",
      dateFilterColumn: "create_date",
      importOrder: 590,
    },
  ],
  relations: [
    {
      fromTable: "crm_team",
      fromColumn: "user_id",
      toTable: "res_users",
      toColumn: "id",
      onDelete: "nullify",
      label: "Team leader",
    },
    {
      fromTable: "crm_team",
      fromColumn: "company_id",
      toTable: "res_company",
      toColumn: "id",
      onDelete: "nullify",
      label: "Sales team company",
    },
    {
      fromTable: "crm_lead",
      fromColumn: "team_id",
      toTable: "crm_team",
      toColumn: "id",
      onDelete: "nullify",
      label: "Lead sales team",
    },
    {
      fromTable: "crm_lead",
      fromColumn: "stage_id",
      toTable: "crm_stage",
      toColumn: "id",
      onDelete: "nullify",
      label: "Lead stage",
    },
    {
      fromTable: "crm_lead",
      fromColumn: "user_id",
      toTable: "res_users",
      toColumn: "id",
      onDelete: "nullify",
      label: "Lead salesperson",
    },
    {
      fromTable: "crm_lead",
      fromColumn: "partner_id",
      toTable: "res_partner",
      toColumn: "id",
      onDelete: "nullify",
      label: "Lead customer",
    },
    {
      fromTable: "crm_lead",
      fromColumn: "lost_reason_id",
      toTable: "crm_lost_reason",
      toColumn: "id",
      onDelete: "nullify",
      label: "Lead lost reason",
    },
    {
      fromTable: "crm_lead",
      fromColumn: "company_id",
      toTable: "res_company",
      toColumn: "id",
      onDelete: "block",
      label: "Lead company",
    },
  ],
};
