import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  uniqueIndex,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
  vector,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User role enum values
export const userRoleValues = ["admin", "user"] as const;
export type UserRole = typeof userRoleValues[number];

// User storage table with email/password auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique().notNull(),
  password: varchar("password", { length: 255 }).notNull(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role", { length: 20 }).notNull().default("user"),
  isMainAdmin: integer("is_main_admin").notNull().default(0),
  canViewDailyUpdates: integer("can_view_daily_updates").notNull().default(0),
  hoursPerDay: integer("hours_per_day").notNull().default(8),
  lastGeneratedPassword: varchar("last_generated_password", { length: 255 }),
  lastLoginAt: timestamp("last_login_at"),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  role: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type SafeUser = Omit<User, "password">;

// Projects table - folders containing documents
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 50 }),
  ownerId: varchar("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id],
  }),
  documents: many(documents),
}));

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// Documents table - pages with nested structure and block content
export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 500 }).notNull().default("Untitled"),
  content: jsonb("content").$type<any>(),
  icon: varchar("icon", { length: 50 }),
  coverImage: varchar("cover_image"),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  parentId: varchar("parent_id"),
  position: integer("position").notNull().default(0),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_document_project").on(table.projectId),
  index("IDX_document_parent").on(table.parentId),
  index("IDX_document_created_by").on(table.createdById),
]);

export const documentsRelations = relations(documents, ({ one, many }) => ({
  project: one(projects, {
    fields: [documents.projectId],
    references: [projects.id],
  }),
  parent: one(documents, {
    fields: [documents.parentId],
    references: [documents.id],
    relationName: "parentChild",
  }),
  children: many(documents, {
    relationName: "parentChild",
  }),
  createdBy: one(users, {
    fields: [documents.createdById],
    references: [users.id],
  }),
}));

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

// Type for document with children for tree structure
export type DocumentWithChildren = Document & {
  children?: DocumentWithChildren[];
};

// Type for document with creator info
export type DocumentWithCreator = Document & {
  createdBy?: SafeUser;
};

// Type for TipTap JSON content
export interface TipTapContent {
  type: string;
  content?: TipTapContent[];
  attrs?: Record<string, any>;
  marks?: Array<{ type: string; attrs?: Record<string, any> }>;
  text?: string;
}

// Document embeddings table for vector search (uses pgvector)
export const documentEmbeddings = pgTable("document_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerId: varchar("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull().default(0),
  chunkText: text("chunk_text").notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  // The pgvector column `server/embeddings.ts` writes and orders by through raw
  // SQL. Nullable because it was added to a table that already had rows.
  embedding: vector("embedding", { dimensions: 1536 }),
  metadata: jsonb("metadata").$type<{
    title?: string;
    projectName?: string;
    breadcrumbs?: string[];
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_embeddings_document").on(table.documentId),
  index("idx_embeddings_project").on(table.projectId),
  index("idx_embeddings_owner").on(table.ownerId),
  index("idx_embeddings_hash").on(table.contentHash),
]);

export const documentEmbeddingsRelations = relations(documentEmbeddings, ({ one }) => ({
  document: one(documents, {
    fields: [documentEmbeddings.documentId],
    references: [documents.id],
  }),
  project: one(projects, {
    fields: [documentEmbeddings.projectId],
    references: [projects.id],
  }),
  owner: one(users, {
    fields: [documentEmbeddings.ownerId],
    references: [users.id],
  }),
}));

export type DocumentEmbedding = typeof documentEmbeddings.$inferSelect;
export type InsertDocumentEmbedding = typeof documentEmbeddings.$inferInsert;

// Video transcripts table - tracks video embeds and their transcripts for the knowledge base
export const videoTranscripts = pgTable("video_transcripts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoUrl: varchar("video_url", { length: 2000 }).notNull(),
  videoId: varchar("video_id", { length: 255 }).notNull(),
  provider: varchar("provider", { length: 50 }).notNull(),
  documentId: varchar("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerId: varchar("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  transcript: text("transcript"),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_video_transcripts_document").on(table.documentId),
  index("idx_video_transcripts_video_id").on(table.videoId),
  index("idx_video_transcripts_owner").on(table.ownerId),
  index("idx_video_transcripts_status").on(table.status),
]);

export const videoTranscriptsRelations = relations(videoTranscripts, ({ one }) => ({
  document: one(documents, {
    fields: [videoTranscripts.documentId],
    references: [documents.id],
  }),
  project: one(projects, {
    fields: [videoTranscripts.projectId],
    references: [projects.id],
  }),
  owner: one(users, {
    fields: [videoTranscripts.ownerId],
    references: [users.id],
  }),
}));

export const insertVideoTranscriptSchema = createInsertSchema(videoTranscripts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type VideoTranscript = typeof videoTranscripts.$inferSelect;
export type InsertVideoTranscript = z.infer<typeof insertVideoTranscriptSchema>;
export type VideoTranscriptStatus = "pending" | "processing" | "completed" | "error";

// Audio recordings table - stores voice recordings with transcripts
export const audioRecordings = pgTable("audio_recordings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").references(() => documents.id, { onDelete: "cascade" }),
  companyDocumentId: varchar("company_document_id"),
  ownerId: varchar("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  audioUrl: varchar("audio_url", { length: 2000 }).notNull(),
  transcript: text("transcript"),
  transcriptStatus: varchar("transcript_status", { length: 50 }).notNull().default("pending"),
  duration: integer("duration"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_audio_recordings_document").on(table.documentId),
  index("idx_audio_recordings_company_document").on(table.companyDocumentId),
  index("idx_audio_recordings_owner").on(table.ownerId),
]);

export const audioRecordingsRelations = relations(audioRecordings, ({ one }) => ({
  document: one(documents, {
    fields: [audioRecordings.documentId],
    references: [documents.id],
  }),
  owner: one(users, {
    fields: [audioRecordings.ownerId],
    references: [users.id],
  }),
}));

export const insertAudioRecordingSchema = createInsertSchema(audioRecordings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AudioRecording = typeof audioRecordings.$inferSelect;
export type InsertAudioRecording = z.infer<typeof insertAudioRecordingSchema>;
export type AudioTranscriptStatus = "pending" | "processing" | "completed" | "error";

// CRM Project Status enum values
export const crmProjectStatusValues = [
  "lead",
  "discovering_call_completed",
  "proposal_sent",
  "follow_up",
  "in_negotiation",
  "won",
  "won_not_started",
  "won_in_progress",
  "won_in_review",
  "won_completed",
  "lost",
  "won_cancelled"
] as const;

export type CrmProjectStatus = typeof crmProjectStatusValues[number];

// CRM Project Type enum values
export const crmProjectTypeValues = [
  "one_time",
  "monthly",
  "hourly_budget",
  "internal"
] as const;

export type CrmProjectType = typeof crmProjectTypeValues[number];

// Contact Status enum values
export const contactStatusValues = [
  "lead",
  "prospect",
  "client",
  "client_recurrent"
] as const;

export type ContactStatus = typeof contactStatusValues[number];

// Client Source enum values
export const clientSourceValues = [
  "fiverr",
  "zoho",
  "direct"
] as const;

export type ClientSource = typeof clientSourceValues[number];

// CRM Clients table - companies/individuals associated with projects (now called Contacts)
export const crmClients = pgTable("crm_clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  company: varchar("company", { length: 255 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  phoneFormat: varchar("phone_format", { length: 20 }).default("us"),
  notes: text("notes"),
  status: varchar("status", { length: 50 }).notNull().default("lead"),
  source: varchar("source", { length: 50 }),
  fiverrUsername: varchar("fiverr_username", { length: 100 }),
  ownerId: varchar("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_crm_clients_owner").on(table.ownerId),
  index("idx_crm_clients_status").on(table.status),
]);

export const crmClientsRelations = relations(crmClients, ({ one, many }) => ({
  owner: one(users, {
    fields: [crmClients.ownerId],
    references: [users.id],
  }),
  contacts: many(crmContacts),
  crmProjects: many(crmProjects),
}));

export const insertCrmClientSchema = createInsertSchema(crmClients).omit({
  id: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
});

export type CrmClient = typeof crmClients.$inferSelect;
export type InsertCrmClient = z.infer<typeof insertCrmClientSchema>;

// CRM Contacts table - contact persons for clients
export const crmContacts = pgTable("crm_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => crmClients.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 100 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  isPrimary: integer("is_primary").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_crm_contacts_client").on(table.clientId),
]);

export const crmContactsRelations = relations(crmContacts, ({ one }) => ({
  client: one(crmClients, {
    fields: [crmContacts.clientId],
    references: [crmClients.id],
  }),
}));

export const insertCrmContactSchema = createInsertSchema(crmContacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CrmContact = typeof crmContacts.$inferSelect;
export type InsertCrmContact = z.infer<typeof insertCrmContactSchema>;

// CRM Projects table - CRM metadata for projects
export const crmProjects = pgTable("crm_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").references(() => crmClients.id, { onDelete: "set null" }),
  status: varchar("status", { length: 50 }).notNull().default("lead"),
  projectType: varchar("project_type", { length: 50 }).default("one_time"),
  assigneeId: varchar("assignee_id").references(() => users.id, { onDelete: "set null" }),
  startDate: timestamp("start_date"),
  dueDate: timestamp("due_date"),
  actualFinishDate: timestamp("actual_finish_date"),
  comments: text("comments"),
  budgetedHours: integer("budgeted_hours"),
  budgetedMinutes: integer("budgeted_minutes").default(0),
  actualHours: integer("actual_hours"),
  actualMinutes: integer("actual_minutes").default(0),
  documentationEnabled: integer("documentation_enabled").default(0),
  isDocumentationOnly: integer("is_documentation_only").default(0),
  reviewStartedAt: timestamp("review_started_at"),
  totalReviewMs: bigint("total_review_ms", { mode: "number" }).default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_crm_projects_project").on(table.projectId),
  index("idx_crm_projects_client").on(table.clientId),
  index("idx_crm_projects_assignee").on(table.assigneeId),
  index("idx_crm_projects_status").on(table.status),
  index("idx_crm_projects_doc_only").on(table.isDocumentationOnly),
]);

export const crmProjectsRelations = relations(crmProjects, ({ one }) => ({
  project: one(projects, {
    fields: [crmProjects.projectId],
    references: [projects.id],
  }),
  client: one(crmClients, {
    fields: [crmProjects.clientId],
    references: [crmClients.id],
  }),
  assignee: one(users, {
    fields: [crmProjects.assigneeId],
    references: [users.id],
  }),
}));

export const insertCrmProjectSchema = createInsertSchema(crmProjects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CrmProject = typeof crmProjects.$inferSelect;
export type InsertCrmProject = z.infer<typeof insertCrmProjectSchema>;

// Extended CRM Project type with joined data for API responses
export type CrmProjectWithDetails = CrmProject & {
  project?: Project;
  client?: CrmClient & { contacts?: CrmContact[] };
  assignee?: SafeUser;
  members?: ProjectMemberWithUser[];
  latestNote?: CrmProjectNoteWithCreator;
  tags?: CrmTag[];
};

// CRM Project Stage History table - tracks status changes over time
export const crmProjectStageHistory = pgTable("crm_project_stage_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crmProjectId: varchar("crm_project_id").notNull().references(() => crmProjects.id, { onDelete: "cascade" }),
  fromStatus: varchar("from_status", { length: 50 }),
  toStatus: varchar("to_status", { length: 50 }).notNull(),
  changedById: varchar("changed_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  changedAt: timestamp("changed_at").defaultNow(),
}, (table) => [
  index("idx_crm_stage_history_project").on(table.crmProjectId),
  index("idx_crm_stage_history_changed_at").on(table.changedAt),
]);

export const crmProjectStageHistoryRelations = relations(crmProjectStageHistory, ({ one }) => ({
  crmProject: one(crmProjects, {
    fields: [crmProjectStageHistory.crmProjectId],
    references: [crmProjects.id],
  }),
  changedBy: one(users, {
    fields: [crmProjectStageHistory.changedById],
    references: [users.id],
  }),
}));

export const insertCrmProjectStageHistorySchema = createInsertSchema(crmProjectStageHistory).omit({
  id: true,
  changedAt: true,
});

export type CrmProjectStageHistory = typeof crmProjectStageHistory.$inferSelect;
export type InsertCrmProjectStageHistory = z.infer<typeof insertCrmProjectStageHistorySchema>;

export type CrmProjectStageHistoryWithUser = CrmProjectStageHistory & {
  changedBy?: SafeUser;
};

// CRM Tags table - tags for distinguishing projects (like Zoho CRM)
export const crmTags = pgTable("crm_tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(),
  color: varchar("color", { length: 20 }).notNull().default("#6366f1"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_crm_tags_name").on(table.name),
]);

export const insertCrmTagSchema = createInsertSchema(crmTags).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CrmTag = typeof crmTags.$inferSelect;
export type InsertCrmTag = z.infer<typeof insertCrmTagSchema>;

// CRM Project Tags junction table - links tags to projects
export const crmProjectTags = pgTable("crm_project_tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crmProjectId: varchar("crm_project_id").notNull().references(() => crmProjects.id, { onDelete: "cascade" }),
  tagId: varchar("tag_id").notNull().references(() => crmTags.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_crm_project_tags_project").on(table.crmProjectId),
  index("idx_crm_project_tags_tag").on(table.tagId),
]);

export const crmProjectTagsRelations = relations(crmProjectTags, ({ one }) => ({
  crmProject: one(crmProjects, {
    fields: [crmProjectTags.crmProjectId],
    references: [crmProjects.id],
  }),
  tag: one(crmTags, {
    fields: [crmProjectTags.tagId],
    references: [crmTags.id],
  }),
}));

export const insertCrmProjectTagSchema = createInsertSchema(crmProjectTags).omit({
  id: true,
  createdAt: true,
});

export type CrmProjectTag = typeof crmProjectTags.$inferSelect;
export type InsertCrmProjectTag = z.infer<typeof insertCrmProjectTagSchema>;

// Company Document Folders table - folders for organizing company documents
export const companyDocumentFolders = pgTable("company_document_folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdById: varchar("created_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_company_document_folders_created_by").on(table.createdById),
]);

export const companyDocumentFoldersRelations = relations(companyDocumentFolders, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [companyDocumentFolders.createdById],
    references: [users.id],
  }),
  documents: many(companyDocuments),
}));

export const insertCompanyDocumentFolderSchema = createInsertSchema(companyDocumentFolders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CompanyDocumentFolder = typeof companyDocumentFolders.$inferSelect;
export type InsertCompanyDocumentFolder = z.infer<typeof insertCompanyDocumentFolderSchema>;

// Company document folder with creator info
export type CompanyDocumentFolderWithCreator = CompanyDocumentFolder & {
  createdBy?: SafeUser;
};

// Company Documents table - company terms, policies, and other documents
export const companyDocuments = pgTable("company_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 500 }).notNull(),
  description: text("description"),
  content: jsonb("content"),
  fileName: varchar("file_name", { length: 500 }),
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type", { length: 100 }),
  storagePath: varchar("storage_path", { length: 1000 }),
  folderId: varchar("folder_id").references(() => companyDocumentFolders.id, { onDelete: "cascade" }),
  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_company_documents_uploaded_by").on(table.uploadedById),
  index("idx_company_documents_folder").on(table.folderId),
]);

export const companyDocumentsRelations = relations(companyDocuments, ({ one }) => ({
  uploadedBy: one(users, {
    fields: [companyDocuments.uploadedById],
    references: [users.id],
  }),
  folder: one(companyDocumentFolders, {
    fields: [companyDocuments.folderId],
    references: [companyDocumentFolders.id],
  }),
}));

export const insertCompanyDocumentSchema = createInsertSchema(companyDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CompanyDocument = typeof companyDocuments.$inferSelect;
export type InsertCompanyDocument = z.infer<typeof insertCompanyDocumentSchema>;

// Company document with uploader info
export type CompanyDocumentWithUploader = CompanyDocument & {
  uploadedBy?: SafeUser;
  folder?: CompanyDocumentFolder;
};

// Company Document embeddings table for vector search (uses pgvector)
export const companyDocumentEmbeddings = pgTable("company_document_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyDocumentId: varchar("company_document_id").notNull().references(() => companyDocuments.id, { onDelete: "cascade" }),
  folderId: varchar("folder_id").references(() => companyDocumentFolders.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull().default(0),
  chunkText: text("chunk_text").notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  // Same pgvector column as document_embeddings, on the company-document side.
  embedding: vector("embedding", { dimensions: 1536 }),
  metadata: jsonb("metadata").$type<{
    title?: string;
    folderName?: string;
    mimeType?: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_company_embeddings_document").on(table.companyDocumentId),
  index("idx_company_embeddings_folder").on(table.folderId),
  index("idx_company_embeddings_hash").on(table.contentHash),
]);

export const companyDocumentEmbeddingsRelations = relations(companyDocumentEmbeddings, ({ one }) => ({
  companyDocument: one(companyDocuments, {
    fields: [companyDocumentEmbeddings.companyDocumentId],
    references: [companyDocuments.id],
  }),
  folder: one(companyDocumentFolders, {
    fields: [companyDocumentEmbeddings.folderId],
    references: [companyDocumentFolders.id],
  }),
}));

export type CompanyDocumentEmbedding = typeof companyDocumentEmbeddings.$inferSelect;
export type InsertCompanyDocumentEmbedding = typeof companyDocumentEmbeddings.$inferInsert;

// Teams table - for organizing users into groups
export const teams = pgTable("teams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  ownerId: varchar("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const teamsRelations = relations(teams, ({ one, many }) => ({
  owner: one(users, {
    fields: [teams.ownerId],
    references: [users.id],
  }),
  members: many(teamMembers),
  invites: many(teamInvites),
}));

export const insertTeamSchema = createInsertSchema(teams).omit({
  id: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
});

export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;

// Team member role enum
export const teamMemberRoleValues = ["owner", "admin", "member"] as const;
export type TeamMemberRole = typeof teamMemberRoleValues[number];

// Team Members table - junction between users and teams
export const teamMembers = pgTable("team_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  teamId: varchar("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).notNull().default("member"),
  joinedAt: timestamp("joined_at").defaultNow(),
}, (table) => [
  index("idx_team_members_team").on(table.teamId),
  index("idx_team_members_user").on(table.userId),
]);

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
}));

export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({
  id: true,
  joinedAt: true,
});

export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;

// Team member with user info
export type TeamMemberWithUser = TeamMember & {
  user?: SafeUser;
};

// Team Invites table - invitation links for joining teams
export const teamInvites = pgTable("team_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  teamId: varchar("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 64 }).notNull().unique(),
  createdById: varchar("created_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at"),
  maxUses: integer("max_uses"),
  useCount: integer("use_count").notNull().default(0),
  isActive: varchar("is_active", { length: 5 }).notNull().default("true"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_team_invites_team").on(table.teamId),
  index("idx_team_invites_code").on(table.code),
]);

export const teamInvitesRelations = relations(teamInvites, ({ one }) => ({
  team: one(teams, {
    fields: [teamInvites.teamId],
    references: [teams.id],
  }),
  createdBy: one(users, {
    fields: [teamInvites.createdById],
    references: [users.id],
  }),
}));

export const insertTeamInviteSchema = createInsertSchema(teamInvites).omit({
  id: true,
  useCount: true,
  createdAt: true,
});

export type TeamInvite = typeof teamInvites.$inferSelect;
export type InsertTeamInvite = z.infer<typeof insertTeamInviteSchema>;

// Team invite with team info
export type TeamInviteWithTeam = TeamInvite & {
  team?: Team;
  createdBy?: SafeUser;
};

// Team with members and owner info
export type TeamWithDetails = Team & {
  owner?: SafeUser;
  members?: TeamMemberWithUser[];
  memberCount?: number;
};

// CRM Project Notes table - notes with user mentions for project updates
export const crmProjectNotes = pgTable("crm_project_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crmProjectId: varchar("crm_project_id").notNull().references(() => crmProjects.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdById: varchar("created_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mentionedUserIds: text("mentioned_user_ids").array(),
  // Audio note fields
  audioUrl: text("audio_url"),
  audioTranscript: text("audio_transcript"),
  transcriptStatus: varchar("transcript_status", { length: 20 }), // pending, processing, completed, error
  audioRecordingId: varchar("audio_recording_id"),
  // File attachments (stored as JSON array: [{url, filename, filesize, filetype}])
  attachments: text("attachments"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_crm_project_notes_project").on(table.crmProjectId),
  index("idx_crm_project_notes_created_by").on(table.createdById),
]);

export const crmProjectNotesRelations = relations(crmProjectNotes, ({ one }) => ({
  crmProject: one(crmProjects, {
    fields: [crmProjectNotes.crmProjectId],
    references: [crmProjects.id],
  }),
  createdBy: one(users, {
    fields: [crmProjectNotes.createdById],
    references: [users.id],
  }),
}));

export const insertCrmProjectNoteSchema = createInsertSchema(crmProjectNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CrmProjectNote = typeof crmProjectNotes.$inferSelect;
export type InsertCrmProjectNote = z.infer<typeof insertCrmProjectNoteSchema>;

// CRM Project Note with creator info
export type CrmProjectNoteWithCreator = CrmProjectNote & {
  createdBy?: SafeUser;
};

// Notifications table - for user mention notifications
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull().default("mention"),
  noteId: varchar("note_id").references(() => crmProjectNotes.id, { onDelete: "cascade" }),
  crmProjectId: varchar("crm_project_id").references(() => crmProjects.id, { onDelete: "cascade" }),
  fromUserId: varchar("from_user_id").references(() => users.id, { onDelete: "set null" }),
  message: text("message"),
  isRead: integer("is_read").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_notifications_user").on(table.userId),
  index("idx_notifications_unread").on(table.userId, table.isRead),
]);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  fromUser: one(users, {
    fields: [notifications.fromUserId],
    references: [users.id],
  }),
  note: one(crmProjectNotes, {
    fields: [notifications.noteId],
    references: [crmProjectNotes.id],
  }),
  crmProject: one(crmProjects, {
    fields: [notifications.crmProjectId],
    references: [crmProjects.id],
  }),
}));

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

export type NotificationWithDetails = Notification & {
  fromUser?: SafeUser;
  crmProject?: { id: string; project?: { name: string } };
};

// CRM Module field type enum values
export const crmFieldTypeValues = [
  "text",
  "number",
  "date",
  "datetime",
  "select",
  "multiselect",
  "checkbox",
  "textarea",
  "email",
  "phone",
  "url",
  "currency"
] as const;

export type CrmFieldType = typeof crmFieldTypeValues[number];

// CRM Modules table - customizable modules for project management
export const crmModules = pgTable("crm_modules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  icon: varchar("icon", { length: 50 }),
  isSystem: integer("is_system").notNull().default(0),
  isEnabled: integer("is_enabled").notNull().default(1),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_crm_modules_slug").on(table.slug),
  index("idx_crm_modules_enabled").on(table.isEnabled),
]);

export const insertCrmModuleSchema = createInsertSchema(crmModules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CrmModule = typeof crmModules.$inferSelect;
export type InsertCrmModule = z.infer<typeof insertCrmModuleSchema>;

// CRM Module Fields table - custom fields for each module
export const crmModuleFields = pgTable("crm_module_fields", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  moduleId: varchar("module_id").notNull().references(() => crmModules.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull(),
  fieldType: varchar("field_type", { length: 50 }).notNull().default("text"),
  description: text("description"),
  placeholder: varchar("placeholder", { length: 255 }),
  defaultValue: text("default_value"),
  options: jsonb("options").$type<string[]>(),
  isRequired: integer("is_required").notNull().default(0),
  isSystem: integer("is_system").notNull().default(0),
  isEnabled: integer("is_enabled").notNull().default(1),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_crm_module_fields_module").on(table.moduleId),
  index("idx_crm_module_fields_slug").on(table.slug),
]);

export const crmModuleFieldsRelations = relations(crmModuleFields, ({ one }) => ({
  module: one(crmModules, {
    fields: [crmModuleFields.moduleId],
    references: [crmModules.id],
  }),
}));

export const insertCrmModuleFieldSchema = createInsertSchema(crmModuleFields).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CrmModuleField = typeof crmModuleFields.$inferSelect;
export type InsertCrmModuleField = z.infer<typeof insertCrmModuleFieldSchema>;

// CRM Module with fields
export type CrmModuleWithFields = CrmModule & {
  fields?: CrmModuleField[];
};

// CRM Custom Field Values table - stores custom field values for projects
export const crmCustomFieldValues = pgTable("crm_custom_field_values", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crmProjectId: varchar("crm_project_id").notNull().references(() => crmProjects.id, { onDelete: "cascade" }),
  fieldId: varchar("field_id").notNull().references(() => crmModuleFields.id, { onDelete: "cascade" }),
  value: text("value"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_crm_custom_field_values_project").on(table.crmProjectId),
  index("idx_crm_custom_field_values_field").on(table.fieldId),
]);

export const crmCustomFieldValuesRelations = relations(crmCustomFieldValues, ({ one }) => ({
  crmProject: one(crmProjects, {
    fields: [crmCustomFieldValues.crmProjectId],
    references: [crmProjects.id],
  }),
  field: one(crmModuleFields, {
    fields: [crmCustomFieldValues.fieldId],
    references: [crmModuleFields.id],
  }),
}));

export const insertCrmCustomFieldValueSchema = createInsertSchema(crmCustomFieldValues).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CrmCustomFieldValue = typeof crmCustomFieldValues.$inferSelect;
export type InsertCrmCustomFieldValue = z.infer<typeof insertCrmCustomFieldValueSchema>;

// Time entry status values
export const timeEntryStatusValues = ["running", "paused", "stopped"] as const;
export type TimeEntryStatus = typeof timeEntryStatusValues[number];

// Tasks table - work units within CRM projects
export const taskStatusValues = ["open", "in_progress", "done", "archived"] as const;
export type TaskStatus = typeof taskStatusValues[number];

export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crmProjectId: varchar("crm_project_id").notNull().references(() => crmProjects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_tasks_crm_project").on(table.crmProjectId),
  index("idx_tasks_status").on(table.status),
]);

export const tasksRelations = relations(tasks, ({ one }) => ({
  crmProject: one(crmProjects, {
    fields: [tasks.crmProjectId],
    references: [crmProjects.id],
  }),
}));

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

// Project Members table - multiple users can be members of a CRM project (self-managed)
export const projectMembers = pgTable("project_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crmProjectId: varchar("crm_project_id").notNull().references(() => crmProjects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_project_members_project").on(table.crmProjectId),
  index("idx_project_members_user").on(table.userId),
  uniqueIndex("idx_project_members_unique").on(table.crmProjectId, table.userId),
]);

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  crmProject: one(crmProjects, {
    fields: [projectMembers.crmProjectId],
    references: [crmProjects.id],
  }),
  user: one(users, {
    fields: [projectMembers.userId],
    references: [users.id],
  }),
}));

export const insertProjectMemberSchema = createInsertSchema(projectMembers).omit({
  id: true,
  createdAt: true,
});

export type ProjectMember = typeof projectMembers.$inferSelect;
export type InsertProjectMember = z.infer<typeof insertProjectMemberSchema>;
export type ProjectMemberWithUser = ProjectMember & { user?: SafeUser };

// Reminders table - self-only task/follow-up reminders with one-time due notification
export const reminders = pgTable("reminders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  crmProjectId: varchar("crm_project_id").notNull().references(() => crmProjects.id, { onDelete: "cascade" }),
  taskId: varchar("task_id").references(() => tasks.id, { onDelete: "set null" }),
  title: varchar("title", { length: 255 }).notNull(),
  note: text("note"),
  dueAt: timestamp("due_at").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("upcoming"),
  notified: integer("notified").notNull().default(0),
  notifiedInApp: integer("notified_in_app").notNull().default(0),
  emailSent: integer("email_sent").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_reminders_user").on(table.userId),
  index("idx_reminders_project").on(table.crmProjectId),
  index("idx_reminders_due").on(table.dueAt, table.notified),
]);

export const remindersRelations = relations(reminders, ({ one }) => ({
  user: one(users, {
    fields: [reminders.userId],
    references: [users.id],
  }),
  crmProject: one(crmProjects, {
    fields: [reminders.crmProjectId],
    references: [crmProjects.id],
  }),
  task: one(tasks, {
    fields: [reminders.taskId],
    references: [tasks.id],
  }),
}));

export const insertReminderSchema = createInsertSchema(reminders).omit({
  id: true,
  createdAt: true,
  notified: true,
  notifiedInApp: true,
  emailSent: true,
});

export type Reminder = typeof reminders.$inferSelect;
export type InsertReminder = z.infer<typeof insertReminderSchema>;

// Time Entries table - tracks time spent on CRM projects
export const timeEntries = pgTable("time_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  crmProjectId: varchar("crm_project_id").notNull().references(() => crmProjects.id, { onDelete: "cascade" }),
  // taskId: nullable for backward compat with existing entries; UI enforces selection for new entries
  taskId: varchar("task_id").references(() => tasks.id, { onDelete: "set null" }),
  description: text("description"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  duration: integer("duration").default(0), // Total tracked time in seconds (excluding idle)
  idleTime: integer("idle_time").default(0), // Total idle time in seconds
  status: varchar("status", { length: 20 }).notNull().default("running"),
  lastActivityAt: timestamp("last_activity_at"),
  // Idempotency key for desktop agent offline-first timer commands
  clientCommandId: varchar("client_command_id", { length: 64 }).unique(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_time_entries_user").on(table.userId),
  index("idx_time_entries_crm_project").on(table.crmProjectId),
  index("idx_time_entries_status").on(table.status),
  index("idx_time_entries_start").on(table.startTime),
  // Named as the boot-time DDL named it, which is the name production already
  // carries. Declared here so the journal produces it too — see migration 0004.
  index("idx_time_entries_task_id").on(table.taskId),
]);

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  user: one(users, {
    fields: [timeEntries.userId],
    references: [users.id],
  }),
  crmProject: one(crmProjects, {
    fields: [timeEntries.crmProjectId],
    references: [crmProjects.id],
  }),
  task: one(tasks, {
    fields: [timeEntries.taskId],
    references: [tasks.id],
  }),
}));

export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TimeEntry = typeof timeEntries.$inferSelect;
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;

// Time entry with user and project info for display
export type TimeEntryWithDetails = TimeEntry & {
  user?: SafeUser;
  crmProject?: CrmProject & {
    project?: Project;
    client?: CrmClient;
  };
  task?: Task;
};

// Time Entry Screenshots table
export const timeEntryScreenshots = pgTable("time_entry_screenshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timeEntryId: varchar("time_entry_id").notNull().references(() => timeEntries.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  crmProjectId: varchar("crm_project_id").notNull().references(() => crmProjects.id, { onDelete: "cascade" }),
  storageKey: varchar("storage_key", { length: 500 }).notNull(),
  contentHash: varchar("content_hash", { length: 64 }),
  /** % of the 60-second window before capture where keyboard input was detected (0–100). */
  keyboardActivityPercent: integer("keyboard_activity_percent"),
  /** % of the 60-second window before capture where mouse/pointer input was detected (0–100). */
  mouseActivityPercent: integer("mouse_activity_percent"),
  /** Raw keydown event count in the 60-second window (null when uiohook unavailable). */
  keyboardCount: integer("keyboard_count"),
  /** Raw pointer event count (mousedown + throttled mousemove + wheel) in the 60-second window. */
  mouseCount: integer("mouse_count"),
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  // ── Soft-delete tombstone ───────────────────────────────────────────────────
  // null = live screenshot.  non-null = tombstoned (removed operationally).
  // The row is NEVER physically deleted via the public API; only via FK cascade
  // when the parent time entry / user / project is itself deleted.
  // The GCS storage object is NOT deleted by the soft-delete endpoint — the
  // storageKey is preserved as an audit trail; a separate purge job handles GCS.
  /** When the screenshot was soft-deleted; null means it is still live. */
  deletedAt: timestamp("deleted_at"),
  /** User ID of the admin who performed the deletion; SET NULL when user is deleted. */
  deletedBy: varchar("deleted_by").references(() => users.id, { onDelete: "set null" }),
  /** Optional free-text reason recorded at deletion time. */
  deleteReason: varchar("delete_reason", { length: 500 }),
}, (table) => [
  index("idx_screenshots_time_entry").on(table.timeEntryId),
  index("idx_screenshots_user").on(table.userId),
  index("idx_screenshots_project").on(table.crmProjectId),
  index("idx_screenshots_captured").on(table.capturedAt),
  // Partial index — only indexes tombstoned rows; zero cost for live rows
  index("idx_screenshots_deleted").on(table.deletedAt),
]);

export const timeEntryScreenshotsRelations = relations(timeEntryScreenshots, ({ one }) => ({
  timeEntry: one(timeEntries, {
    fields: [timeEntryScreenshots.timeEntryId],
    references: [timeEntries.id],
  }),
  user: one(users, {
    fields: [timeEntryScreenshots.userId],
    references: [users.id],
  }),
  crmProject: one(crmProjects, {
    fields: [timeEntryScreenshots.crmProjectId],
    references: [crmProjects.id],
  }),
}));

export const insertTimeEntryScreenshotSchema = createInsertSchema(timeEntryScreenshots).omit({
  id: true,
  createdAt: true,
});

export type TimeEntryScreenshot = typeof timeEntryScreenshots.$inferSelect;
export type InsertTimeEntryScreenshot = z.infer<typeof insertTimeEntryScreenshotSchema>;

// ─── Desktop Agent: Devices ───

export const devices = pgTable("devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  os: varchar("os", { length: 100 }),
  clientVersion: varchar("client_version", { length: 50 }),
  /** SHA-256 hash of the device token (never store raw) */
  deviceTokenHash: varchar("device_token_hash", { length: 64 }).notNull(),
  lastSeenAt: timestamp("last_seen_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_devices_user").on(table.userId),
  index("idx_devices_token_hash").on(table.deviceTokenHash),
]);

export const devicesRelations = relations(devices, ({ one }) => ({
  user: one(users, { fields: [devices.userId], references: [users.id] }),
}));

export type Device = typeof devices.$inferSelect;
export type InsertDevice = typeof devices.$inferInsert;

// ─── Desktop Agent: Pairing Codes ───

export const agentPairingCodes = pgTable("agent_pairing_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 10 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_pairing_code").on(table.code),
]);

export type AgentPairingCode = typeof agentPairingCodes.$inferSelect;

// ─── Desktop Agent: Processed Batches (idempotency) ───

export const agentProcessedBatches = pgTable("agent_processed_batches", {
  batchId: varchar("batch_id").primaryKey(),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  eventCount: integer("event_count").notNull().default(0),
  processedAt: timestamp("processed_at").defaultNow(),
}, (table) => [
  index("idx_processed_batches_device").on(table.deviceId),
  index("idx_processed_batches_time").on(table.processedAt),
]);

// ─── Desktop Agent: Activity Events ───

export const agentActivityEvents = pgTable("agent_activity_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  timeEntryId: varchar("time_entry_id").references(() => timeEntries.id, { onDelete: "set null" }),
  batchId: varchar("batch_id").notNull(),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  data: jsonb("data"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_agent_events_device").on(table.deviceId),
  index("idx_agent_events_user_time").on(table.userId, table.timestamp),
  index("idx_agent_events_batch").on(table.batchId),
]);

// ─── Org-wide settings (single-row, id = "default") ───

export interface ScreenshotPolicy {
  screenshotsEnabled: boolean;
  /** Minimum capture interval in minutes. Must be >= 3. */
  captureIntervalMinMin: number;
  /** Maximum capture interval in minutes. Must be <= 15. */
  captureIntervalMaxMin: number;
  /** Whether to restrict captures to a time window */
  activeHoursEnabled: boolean;
  /** Start of capture window, "HH:mm" 24 h (default "08:00") */
  activeHoursStart: string;
  /** End of capture window, "HH:mm" 24 h (default "18:00") */
  activeHoursEnd: string;
  /** Whether the idle-prompt overlay is shown after inactivity */
  idlePromptEnabled: boolean;
  /** Minutes of inactivity before the idle prompt fires. Range: 1–60. */
  idleTimeoutMinutes: number;
  /** Seconds of countdown before the timer is auto-stopped. Range: 15–120. */
  idleCountdownSeconds: number;
}

export const DEFAULT_SCREENSHOT_POLICY: ScreenshotPolicy = {
  screenshotsEnabled: true,
  captureIntervalMinMin: 3,
  captureIntervalMaxMin: 5,
  activeHoursEnabled: false,
  activeHoursStart: "08:00",
  activeHoursEnd: "18:00",
  idlePromptEnabled: true,
  idleTimeoutMinutes: 10,
  idleCountdownSeconds: 60,
};

/** IANA timezone strings the admin allows in the Screencasts timezone selector.
 *  Empty array = no restriction (each user's browser timezone is used). */
export const DEFAULT_ALLOWED_TIMEZONES: string[] = [];

/** Public object paths for Help Center article images (`/public-objects/…`). Keyed by slot id. */
export type HelpCenterScreenshotsMap = Partial<Record<string, string>>;

export const orgSettings = pgTable("org_settings", {
  id: varchar("id").primaryKey().default("default"),
  screenshotPolicy: jsonb("screenshot_policy").$type<ScreenshotPolicy>(),
  /** Admin-curated list of IANA timezone strings for the Screencasts dropdown.
   *  Null / empty = no dropdown shown; browser local timezone is used. */
  allowedTimezones: jsonb("allowed_timezones").$type<string[]>(),
  /** Help Center images: slot id → `/public-objects/…` path after admin upload. */
  helpCenterScreenshots: jsonb("help_center_screenshots").$type<HelpCenterScreenshotsMap>(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * The one Workspace this installation seeds (#93, ADR-0004, ADR-0006). The id is
 * named so migrate is idempotent: a second apply cannot insert another row.
 * Tracking Policy is copied from `org_settings`; that row stays until a later
 * ticket drops it. HTTP does not read these tables yet.
 */
export const SEEDED_WORKSPACE_ID = "seeded";

export const workspaceRoleSlugValues = ["owner", "administrator", "member"] as const;
export type WorkspaceRoleSlug = (typeof workspaceRoleSlugValues)[number];

export const VIEW_DAILY_UPDATES_CAPABILITY_ID = "view_daily_updates";

export const workspaces = pgTable("workspaces", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  screenshotPolicy: jsonb("screenshot_policy").$type<ScreenshotPolicy>(),
  allowedTimezones: jsonb("allowed_timezones").$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Workspace = typeof workspaces.$inferSelect;

export const capabilities = pgTable("capabilities", {
  id: varchar("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
});

export type Capability = typeof capabilities.$inferSelect;

export const workspaceRoles = pgTable(
  "workspace_roles",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 50 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [uniqueIndex("idx_workspace_roles_workspace_slug").on(table.workspaceId, table.slug)]
);

export type WorkspaceRole = typeof workspaceRoles.$inferSelect;

export const workspaceRoleCapabilities = pgTable(
  "workspace_role_capabilities",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceRoleId: varchar("workspace_role_id")
      .notNull()
      .references(() => workspaceRoles.id, { onDelete: "cascade" }),
    capabilityId: varchar("capability_id")
      .notNull()
      .references(() => capabilities.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("idx_workspace_role_capabilities_unique").on(
      table.workspaceRoleId,
      table.capabilityId
    ),
  ]
);

export const memberships = pgTable(
  "memberships",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceRoleId: varchar("workspace_role_id")
      .notNull()
      .references(() => workspaceRoles.id, { onDelete: "restrict" }),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_memberships_workspace_user").on(table.workspaceId, table.userId),
    index("idx_memberships_workspace").on(table.workspaceId),
    index("idx_memberships_user").on(table.userId),
  ]
);

export type Membership = typeof memberships.$inferSelect;

/**
 * Extra Capabilities on one Membership that its Workspace Role does not grant.
 * Seed copies per-user flags such as `canViewDailyUpdates` here so they are not
 * leftover authority on `users`. Custom Workspace Roles stay out of scope.
 */
export const membershipCapabilities = pgTable(
  "membership_capabilities",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    membershipId: varchar("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    capabilityId: varchar("capability_id")
      .notNull()
      .references(() => capabilities.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("idx_membership_capabilities_unique").on(table.membershipId, table.capabilityId),
  ]
);

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  roles: many(workspaceRoles),
  memberships: many(memberships),
}));

export const workspaceRolesRelations = relations(workspaceRoles, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [workspaceRoles.workspaceId],
    references: [workspaces.id],
  }),
  memberships: many(memberships),
  capabilities: many(workspaceRoleCapabilities),
}));

export const membershipsRelations = relations(memberships, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [memberships.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
  workspaceRole: one(workspaceRoles, {
    fields: [memberships.workspaceRoleId],
    references: [workspaceRoles.id],
  }),
  extraCapabilities: many(membershipCapabilities),
}));

export const membershipCapabilitiesRelations = relations(membershipCapabilities, ({ one }) => ({
  membership: one(memberships, {
    fields: [membershipCapabilities.membershipId],
    references: [memberships.id],
  }),
  capability: one(capabilities, {
    fields: [membershipCapabilities.capabilityId],
    references: [capabilities.id],
  }),
}));

export const workspaceRoleCapabilitiesRelations = relations(
  workspaceRoleCapabilities,
  ({ one }) => ({
    workspaceRole: one(workspaceRoles, {
      fields: [workspaceRoleCapabilities.workspaceRoleId],
      references: [workspaceRoles.id],
    }),
    capability: one(capabilities, {
      fields: [workspaceRoleCapabilities.capabilityId],
      references: [capabilities.id],
    }),
  })
);

// Desktop installer release registry.
// CI writes one row per build artifact. The backend serves stable download
// URLs that redirect to the storage URL, insulating users from GCS paths.
export const desktopReleases = pgTable(
  "desktop_releases",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Semver string, e.g. "0.1.6" */
    version: varchar("version", { length: 50 }).notNull(),
    /** One of: windows | macos | linux */
    platform: varchar("platform", { length: 20 }).notNull(),
    /** Original artifact filename, e.g. "DocuFlow-Agent-0.1.6-windows-setup.exe" */
    filename: varchar("filename", { length: 255 }).notNull(),
    /** Public GCS object URL — permanent direct-download link */
    storageUrl: text("storage_url").notNull(),
    fileSize: bigint("file_size", { mode: "number" }),
    sha256: varchar("sha256", { length: 64 }),
    /** True for exactly one row per platform at any time */
    isLatest: boolean("is_latest").notNull().default(false),
    publishedAt: timestamp("published_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_desktop_releases_platform_latest").on(table.platform, table.isLatest),
  ]
);

export type DesktopRelease = typeof desktopReleases.$inferSelect;

// ─── Project Daily Updates ───
// Users submit daily status updates for CRM projects they work on.
// Admins review all submissions in a dashboard table.

export const projectDailyUpdates = pgTable(
  "project_daily_updates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    crmProjectId: varchar("crm_project_id").notNull().references(() => crmProjects.id, { onDelete: "cascade" }),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    updateDate: timestamp("update_date").notNull().defaultNow(),
    status: varchar("status", { length: 50 }).notNull(),
    whatHappened: text("what_happened"),
    whatWasDone: text("what_was_done"),
    nextSteps: text("next_steps"),
    blockageType: varchar("blockage_type", { length: 20 }),
    waitingOnClient: boolean("waiting_on_client").notNull().default(false),
    needsClientUpdate: boolean("needs_client_update").notNull().default(false),
    needsClientSubmission: boolean("needs_client_submission").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_daily_updates_project").on(table.crmProjectId),
    index("idx_daily_updates_user").on(table.userId),
    index("idx_daily_updates_date").on(table.updateDate),
    uniqueIndex("idx_daily_updates_unique").on(table.crmProjectId, table.userId, table.updateDate),
  ]
);

export const projectDailyUpdatesRelations = relations(projectDailyUpdates, ({ one }) => ({
  crmProject: one(crmProjects, {
    fields: [projectDailyUpdates.crmProjectId],
    references: [crmProjects.id],
  }),
  user: one(users, {
    fields: [projectDailyUpdates.userId],
    references: [users.id],
  }),
}));

export const insertProjectDailyUpdateSchema = createInsertSchema(projectDailyUpdates, {
  updateDate: z.coerce.date().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Payload accepted from clients — userId is derived server-side, not trusted from the request.
export const createProjectDailyUpdateApiSchema = insertProjectDailyUpdateSchema.omit({
  userId: true,
});

export type ProjectDailyUpdate = typeof projectDailyUpdates.$inferSelect;
export type InsertProjectDailyUpdate = z.infer<typeof insertProjectDailyUpdateSchema>;

export type ProjectDailyUpdateWithDetails = ProjectDailyUpdate & {
  crmProject?: CrmProject & { project?: Project };
  user?: SafeUser;
};

// Jobs — durable deferred work claimed by the Worker (ADR-0013, #82).
// Workspace id stays nullable and unreferenced: #94 backfills it. Seeding the
// Workspace (#93) does not stamp Jobs.
export const concurrencyClassValues = [
  "domain-consequence",
  "derived-processing",
  "external-delivery",
] as const;
export type ConcurrencyClass = (typeof concurrencyClassValues)[number];

export const jobs = pgTable(
  "jobs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    type: varchar("type", { length: 255 }).notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    workspaceId: varchar("workspace_id"),
    concurrencyClass: varchar("concurrency_class", { length: 32 }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    backoffMs: integer("backoff_ms").notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
    availableAt: timestamp("available_at").notNull().defaultNow(),
    claimedAt: timestamp("claimed_at"),
    claimExpiresAt: timestamp("claim_expires_at"),
    claimedBy: varchar("claimed_by"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    occurrenceKey: varchar("occurrence_key", { length: 255 }),
  },
  (table) => [
    index("idx_jobs_claimable")
      .on(table.availableAt, table.createdAt)
      .where(sql`${table.completedAt} IS NULL`),
    uniqueIndex("idx_jobs_occurrence").on(table.occurrenceKey),
  ]
);

export type JobRow = typeof jobs.$inferSelect;

export const deadLetters = pgTable(
  "dead_letters",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    jobId: varchar("job_id").notNull(),
    type: varchar("type", { length: 255 }).notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    workspaceId: varchar("workspace_id"),
    concurrencyClass: varchar("concurrency_class", { length: 32 }).notNull(),
    attempts: integer("attempts").notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    backoffMs: integer("backoff_ms").notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
    lastError: text("last_error").notNull(),
    claimedBy: varchar("claimed_by"),
    enqueuedAt: timestamp("enqueued_at").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idx_dead_letters_job").on(table.jobId)]
);

export type DeadLetterRow = typeof deadLetters.$inferSelect;

export const schedulerLeases = pgTable("scheduler_leases", {
  name: varchar("name").primaryKey(),
  holder: varchar("holder").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export type SchedulerLeaseRow = typeof schedulerLeases.$inferSelect;

// ─── Daily Update status set (single source of truth for form + admin dashboard) ───
// Combines project-management statuses with predefined progress statuses.
export const dailyUpdateStatusOptions = [
  { value: "on_track", label: "On Track", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  { value: "in_progress", label: "In Progress", color: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" },
  { value: "in_review", label: "In Review", color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" },
  { value: "blocked_client", label: "Blocked - Client", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  { value: "blocked_internal", label: "Blocked - Internal", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  { value: "completed", label: "Completed", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
] as const;

export type DailyUpdateStatus = typeof dailyUpdateStatusOptions[number]["value"];

// Statuses that represent a blockage and require specifying an internal/external cause.
export const dailyUpdateBlockedStatuses = ["blocked_client", "blocked_internal"] as const;

export const dailyUpdateBlockageTypeOptions = [
  { value: "internal", label: "Internal (our team)" },
  { value: "external", label: "External (waiting on client / third party)" },
] as const;

// ─── Evidence Quality Score ───
//
// A per-user (or per-entry) composite score (0–100) that measures how well
// a tracked session is supported by observable evidence.
//
// IMPORTANT: This score never modifies or replaces tracked time (duration /
// idleTime). It is purely an observational label on evidence completeness.
//
// Score components:
//   coverageScore  (0–40) — screenshot count vs 1-per-10-min expectation
//   qualityScore   (0–30) — deductions for duplicate / low-activity screenshots
//   eventsScore    (0–20) — presence of linked activity events
//   deviceScore    (0–10) — device heartbeat freshness
//
// Grade thresholds:
//   strong       ≥ 75
//   moderate     50–74
//   weak         25–49
//   insufficient  0–24

export type EvidenceGrade = "strong" | "moderate" | "weak" | "insufficient";

export interface EvidenceUserScore {
  userId: string;
  userName: string;
  entryCount: number;
  trackedSeconds: number;
  // Score components (sum = totalScore)
  coverageScore: number;
  qualityScore: number;
  eventsScore: number;
  deviceScore: number;
  totalScore: number;
  grade: EvidenceGrade;
  // Raw inputs (transparency — never used to rewrite time)
  screenshotCount: number;
  expectedScreenshots: number;
  dupRatio: number;
  avgActivityPct: number | null;
  hasEvents: boolean;
  deviceLastSeenDaysAgo: number | null;
}

export interface EvidenceQualityReport {
  gradeDistribution: {
    strong: number;
    moderate: number;
    weak: number;
    insufficient: number;
  };
  byUser: EvidenceUserScore[];
}
