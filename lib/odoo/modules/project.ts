/**
 * Project module: projects, tags, task stages and tasks.
 */

import type { OdooModule } from "../types";

export const projectModule: OdooModule = {
  name: "project",
  label: "Project",
  description: "Projects, tags, stages and tasks",
  tables: [
    // ===== Master data =====
    {
      tableName: "project_project",
      odooModel: "project.project",
      label: "Projects",
      type: "master",
      importOrder: 500,
    },
    {
      tableName: "project_tags",
      odooModel: "project.tags",
      label: "Project Tags",
      type: "master",
      importOrder: 510,
    },
    {
      tableName: "project_task_type",
      odooModel: "project.task.type",
      label: "Task Stages",
      type: "master",
      importOrder: 520,
    },
    // ===== Transactions =====
    {
      tableName: "project_task",
      odooModel: "project.task",
      label: "Tasks",
      type: "transaction",
      dateFilterColumn: "create_date",
      importOrder: 530,
    },
  ],
  relations: [
    {
      fromTable: "project_project",
      fromColumn: "partner_id",
      toTable: "res_partner",
      toColumn: "id",
      onDelete: "nullify",
      label: "Project customer",
    },
    {
      fromTable: "project_project",
      fromColumn: "user_id",
      toTable: "res_users",
      toColumn: "id",
      onDelete: "nullify",
      label: "Project manager",
    },
    {
      fromTable: "project_project",
      fromColumn: "company_id",
      toTable: "res_company",
      toColumn: "id",
      onDelete: "block",
      label: "Project company",
    },
    {
      fromTable: "project_task",
      fromColumn: "project_id",
      toTable: "project_project",
      toColumn: "id",
      onDelete: "cascade",
      label: "Parent project",
    },
    {
      fromTable: "project_task",
      fromColumn: "stage_id",
      toTable: "project_task_type",
      toColumn: "id",
      onDelete: "nullify",
      label: "Task stage",
    },
    {
      fromTable: "project_task",
      fromColumn: "partner_id",
      toTable: "res_partner",
      toColumn: "id",
      onDelete: "nullify",
      label: "Task customer",
    },
    {
      fromTable: "project_task",
      fromColumn: "parent_id",
      toTable: "project_task",
      toColumn: "id",
      onDelete: "nullify",
      label: "Parent task",
    },
    {
      fromTable: "project_task",
      fromColumn: "company_id",
      toTable: "res_company",
      toColumn: "id",
      onDelete: "block",
      label: "Task company",
    },
  ],
};
