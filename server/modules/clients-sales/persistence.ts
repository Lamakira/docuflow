import type {
  Project,
  InsertProject,
  CrmClient,
  InsertCrmClient,
  CrmContact,
  InsertCrmContact,
  CrmProject,
  InsertCrmProject,
  CrmProjectWithDetails,
  CrmProjectNote,
  InsertCrmProjectNote,
  CrmProjectNoteWithCreator,
  CrmProjectStageHistory,
  InsertCrmProjectStageHistory,
  CrmProjectStageHistoryWithUser,
  CrmTag,
  InsertCrmTag,
  CrmProjectTag,
  CrmModule,
  InsertCrmModule,
  CrmModuleField,
  InsertCrmModuleField,
  CrmModuleWithFields,
  CrmCustomFieldValue,
} from "@shared/schema";

export interface ClientsSalesPersistence {
  getCrmClients(userId: string): Promise<CrmClient[]>;
  getCrmClient(id: string): Promise<CrmClient | undefined>;
  createCrmClient(client: InsertCrmClient & { ownerId: string }): Promise<CrmClient>;
  updateCrmClient(id: string, data: Partial<InsertCrmClient>): Promise<CrmClient | undefined>;
  deleteCrmClient(id: string): Promise<void>;

  getCrmContacts(clientId: string): Promise<CrmContact[]>;
  getCrmContact(id: string): Promise<CrmContact | undefined>;
  createCrmContact(contact: InsertCrmContact): Promise<CrmContact>;
  updateCrmContact(id: string, data: Partial<InsertCrmContact>): Promise<CrmContact | undefined>;
  deleteCrmContact(id: string): Promise<void>;

  getCrmProjects(
    userId: string,
    options?: {
      page?: number;
      pageSize?: number;
      status?: string;
      search?: string;
    }
  ): Promise<{ data: CrmProjectWithDetails[]; total: number; page: number; pageSize: number }>;
  getCrmProject(id: string): Promise<CrmProjectWithDetails | undefined>;
  getCrmProjectByProjectId(projectId: string): Promise<CrmProject | undefined>;
  createCrmProject(crmProject: InsertCrmProject): Promise<CrmProject>;
  createCrmProjectWithBase(
    projectData: InsertProject & { ownerId: string },
    crmData?: Partial<InsertCrmProject>
  ): Promise<{ project: Project; crmProject: CrmProject }>;
  updateCrmProject(id: string, data: Partial<InsertCrmProject>): Promise<CrmProject | undefined>;
  deleteCrmProject(id: string): Promise<void>;
  toggleDocumentation(crmProjectId: string, enabled: boolean): Promise<CrmProject | undefined>;
  getDocumentationEnabledProjects(userId?: string): Promise<Project[]>;

  getCrmProjectNotes(crmProjectId: string): Promise<CrmProjectNoteWithCreator[]>;
  getCrmProjectLatestNote(crmProjectId: string): Promise<CrmProjectNoteWithCreator | undefined>;
  createCrmProjectNote(note: InsertCrmProjectNote): Promise<CrmProjectNote>;
  updateCrmProjectNote(
    id: string,
    data: Partial<InsertCrmProjectNote>
  ): Promise<CrmProjectNote | undefined>;
  deleteCrmProjectNote(id: string): Promise<void>;

  getCrmProjectStageHistory(crmProjectId: string): Promise<CrmProjectStageHistoryWithUser[]>;
  createCrmProjectStageHistory(
    history: InsertCrmProjectStageHistory
  ): Promise<CrmProjectStageHistory>;

  getAllCrmTags(): Promise<CrmTag[]>;
  getCrmTag(id: string): Promise<CrmTag | undefined>;
  createCrmTag(tag: InsertCrmTag): Promise<CrmTag>;
  updateCrmTag(id: string, data: Partial<InsertCrmTag>): Promise<CrmTag | undefined>;
  deleteCrmTag(id: string): Promise<void>;

  getCrmProjectTags(crmProjectId: string): Promise<CrmTag[]>;
  addTagToProject(crmProjectId: string, tagId: string): Promise<CrmProjectTag>;
  removeTagFromProject(crmProjectId: string, tagId: string): Promise<void>;

  getCrmModules(): Promise<CrmModuleWithFields[]>;
  getCrmModule(id: string): Promise<CrmModuleWithFields | undefined>;
  createCrmModule(module: InsertCrmModule): Promise<CrmModule>;
  updateCrmModule(id: string, data: Partial<InsertCrmModule>): Promise<CrmModule | undefined>;
  deleteCrmModule(id: string): Promise<void>;

  getCrmModuleFields(moduleId: string): Promise<CrmModuleField[]>;
  getCrmModuleField(id: string): Promise<CrmModuleField | undefined>;
  createCrmModuleField(field: InsertCrmModuleField): Promise<CrmModuleField>;
  updateCrmModuleField(
    id: string,
    data: Partial<InsertCrmModuleField>
  ): Promise<CrmModuleField | undefined>;
  deleteCrmModuleField(id: string): Promise<void>;

  getCrmProjectCustomFields(crmProjectId: string): Promise<CrmCustomFieldValue[]>;
  setCrmProjectCustomField(
    crmProjectId: string,
    fieldId: string,
    value: string | null
  ): Promise<CrmCustomFieldValue>;
  updateCrmFieldValuesOnOptionRename(
    fieldId: string,
    oldLabel: string,
    newLabel: string
  ): Promise<void>;
  updateCrmProjectsColumnOnOptionRename(
    column: "status" | "projectType",
    oldLabel: string,
    newLabel: string
  ): Promise<void>;
  updateCrmClientsColumnOnOptionRename(
    column: "status",
    oldLabel: string,
    newLabel: string
  ): Promise<void>;
}
