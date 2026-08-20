export type { ClientsSalesPersistence } from "./persistence";

export const CLIENTS_SALES_TABLES = [
  "crm_clients",
  "crm_contacts",
  "crm_projects",
  "crm_project_notes",
  "crm_project_stage_history",
  "crm_tags",
  "crm_project_tags",
  "crm_modules",
  "crm_module_fields",
  "crm_custom_field_values",
] as const;

export const clientsSalesModule = {
  id: "clients-sales",
  name: "Clients & Sales",
  tables: CLIENTS_SALES_TABLES,
  persistence: "ClientsSalesPersistence",
} as const;
