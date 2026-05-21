/**
 * Human Resources module.
 *
 * Note: `hr_employee` is already declared in the base module. We add
 * departments, jobs, employee categories, work locations and contracts here.
 */

import type { OdooModule } from "../types";

export const hrModule: OdooModule = {
  name: "hr",
  label: "Human Resources",
  description: "Departments, jobs, employees and contracts",
  tables: [
    // ===== Master data =====
    {
      tableName: "hr_department",
      odooModel: "hr.department",
      label: "Departments",
      type: "master",
      importOrder: 200,
    },
    {
      tableName: "hr_job",
      odooModel: "hr.job",
      label: "Job Positions",
      type: "master",
      importOrder: 210,
    },
    {
      tableName: "hr_employee_category",
      odooModel: "hr.employee.category",
      label: "Employee Tags",
      type: "master",
      importOrder: 220,
    },
    {
      tableName: "hr_work_location",
      odooModel: "hr.work.location",
      label: "Work Locations",
      type: "master",
      importOrder: 230,
    },
    // ===== Transactions =====
    {
      tableName: "hr_contract",
      odooModel: "hr.contract",
      label: "Employee Contracts",
      type: "transaction",
      dateFilterColumn: "date_start",
      importOrder: 240,
    },
  ],
  relations: [
    {
      fromTable: "hr_department",
      fromColumn: "parent_id",
      toTable: "hr_department",
      toColumn: "id",
      onDelete: "nullify",
      label: "Parent department",
    },
    {
      fromTable: "hr_department",
      fromColumn: "company_id",
      toTable: "res_company",
      toColumn: "id",
      onDelete: "block",
      label: "Department company",
    },
    {
      fromTable: "hr_department",
      fromColumn: "manager_id",
      toTable: "hr_employee",
      toColumn: "id",
      onDelete: "nullify",
      label: "Department manager",
    },
    {
      fromTable: "hr_job",
      fromColumn: "department_id",
      toTable: "hr_department",
      toColumn: "id",
      onDelete: "nullify",
      label: "Job department",
    },
    {
      fromTable: "hr_job",
      fromColumn: "company_id",
      toTable: "res_company",
      toColumn: "id",
      onDelete: "block",
      label: "Job company",
    },
    {
      fromTable: "hr_work_location",
      fromColumn: "company_id",
      toTable: "res_company",
      toColumn: "id",
      onDelete: "block",
      label: "Work location company",
    },
    {
      fromTable: "hr_employee",
      fromColumn: "department_id",
      toTable: "hr_department",
      toColumn: "id",
      onDelete: "nullify",
      label: "Employee department",
    },
    {
      fromTable: "hr_employee",
      fromColumn: "job_id",
      toTable: "hr_job",
      toColumn: "id",
      onDelete: "nullify",
      label: "Employee job",
    },
    {
      fromTable: "hr_employee",
      fromColumn: "parent_id",
      toTable: "hr_employee",
      toColumn: "id",
      onDelete: "nullify",
      label: "Employee manager",
    },
    {
      fromTable: "hr_employee",
      fromColumn: "work_location_id",
      toTable: "hr_work_location",
      toColumn: "id",
      onDelete: "nullify",
      label: "Employee work location",
    },
    {
      fromTable: "hr_employee",
      fromColumn: "company_id",
      toTable: "res_company",
      toColumn: "id",
      onDelete: "block",
      label: "Employee company",
    },
    {
      fromTable: "hr_employee",
      fromColumn: "user_id",
      toTable: "res_users",
      toColumn: "id",
      onDelete: "nullify",
      label: "Related user",
    },
    {
      fromTable: "hr_contract",
      fromColumn: "employee_id",
      toTable: "hr_employee",
      toColumn: "id",
      onDelete: "cascade",
      label: "Contract employee",
    },
    {
      fromTable: "hr_contract",
      fromColumn: "department_id",
      toTable: "hr_department",
      toColumn: "id",
      onDelete: "nullify",
      label: "Contract department",
    },
    {
      fromTable: "hr_contract",
      fromColumn: "job_id",
      toTable: "hr_job",
      toColumn: "id",
      onDelete: "nullify",
      label: "Contract job",
    },
    {
      fromTable: "hr_contract",
      fromColumn: "company_id",
      toTable: "res_company",
      toColumn: "id",
      onDelete: "block",
      label: "Contract company",
    },
  ],
};
