import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Runtime query schema for Plainwrite.
 *
 * This file intentionally lives under app/ because the Sovereign runtime mounts
 * the plugin app tree into Next routes. Server components/actions must not
 * import runtime query helpers from outside that mounted tree.
 */

export const plainwriteProjects = sqliteTable('plainwrite_projects', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  createdBy: text('created_by').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  provider: text('provider').notNull(),
  providerUrl: text('provider_url'),
  repoOwner: text('repo_owner').notNull(),
  repoName: text('repo_name').notNull(),
  branch: text('branch').notNull(),
  pathPrefix: text('path_prefix').notNull(),
  imageUploadPath: text('image_upload_path').notNull().default('public/images'),
  ssgType: text('ssg_type').notNull(),
  isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
  metadataVisibility: text('metadata_visibility').notNull(),
  archivedAt: integer('archived_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const plainwriteProjectMembers = sqliteTable(
  'plainwrite_project_members',
  {
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    invitedBy: text('invited_by'),
    joinedAt: integer('joined_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    uniqueIndex('plainwrite_project_members_project_user_idx').on(t.projectId, t.userId),
  ],
);

export const plainwriteCredentials = sqliteTable(
  'plainwrite_credentials',
  {
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(),
    authType: text('auth_type').notNull(),
    connectionId: text('connection_id'),
    secretRef: text('secret_ref').notNull(),
    tokenExpiresAt: integer('token_expires_at'),
    providerLogin: text('provider_login'),
    status: text('status').notNull(),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    uniqueIndex('plainwrite_credentials_project_user_idx').on(t.projectId, t.userId),
  ],
);

/**
 * One shared, owner-managed GitHub credential per project. Backed by a
 * `scope: 'plugin'` sdk.secrets entry (readable by any user of this plugin,
 * unlike the per-user `scope: 'user'` secrets behind `plainwriteCredentials`)
 * so an owner can let invited members publish without connecting their own
 * PAT. `resolveGitHubCredential` falls back to this row only when the
 * current user has no working personal credential.
 */
export const plainwriteProjectCredentials = sqliteTable('plainwrite_project_credentials', {
  tenantId: text('tenant_id').notNull(),
  projectId: text('project_id').primaryKey(),
  createdBy: text('created_by').notNull(),
  provider: text('provider').notNull(),
  authType: text('auth_type').notNull(),
  secretRef: text('secret_ref').notNull(),
  providerLogin: text('provider_login'),
  status: text('status').notNull(),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const plainwriteFileCache = sqliteTable(
  'plainwrite_file_cache',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    path: text('path').notNull(),
    collection: text('collection'),
    filename: text('filename').notNull(),
    sha: text('sha').notNull(),
    lastSyncedAt: integer('last_synced_at').notNull(),
  },
  (t) => [uniqueIndex('plainwrite_file_cache_project_path_idx').on(t.projectId, t.path)],
);

export const plainwriteDrafts = sqliteTable(
  'plainwrite_drafts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    filePath: text('file_path').notNull(),
    userId: text('user_id').notNull(),
    content: text('content'),
    status: text('status').notNull(),
    commitMessage: text('commit_message'),
    baseSha: text('base_sha'),
    committedAt: integer('committed_at'),
    publishedAt: integer('published_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('plainwrite_drafts_project_file_user_idx').on(
      t.projectId,
      t.filePath,
      t.userId,
    ),
  ],
);

export const plainwriteCollectionSchemas = sqliteTable(
  'plainwrite_collection_schemas',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    collection: text('collection').notNull(),
    schemaJson: text('schema').notNull(),
    inferredAt: integer('inferred_at'),
    updatedAt: integer('updated_at').notNull(),
    updatedBy: text('updated_by'),
  },
  (t) => [
    uniqueIndex('plainwrite_collection_schemas_project_collection_idx').on(
      t.projectId,
      t.collection,
    ),
  ],
);

export const plainwritePublishEvents = sqliteTable('plainwrite_publish_events', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  projectId: text('project_id').notNull(),
  userId: text('user_id').notNull(),
  provider: text('provider').notNull(),
  branch: text('branch').notNull(),
  commitSha: text('commit_sha'),
  message: text('message').notNull(),
  files: text('files').notNull(),
  status: text('status').notNull(),
  errorCode: text('error_code'),
  errorSummary: text('error_summary'),
  createdAt: integer('created_at').notNull(),
});

export const plainwriteTables = {
  plainwriteProjects,
  plainwriteProjectMembers,
  plainwriteCredentials,
  plainwriteProjectCredentials,
  plainwriteFileCache,
  plainwriteDrafts,
  plainwriteCollectionSchemas,
  plainwritePublishEvents,
};

export type PlainwriteProject = InferSelectModel<typeof plainwriteProjects>;
export type PlainwriteProjectMember = InferSelectModel<typeof plainwriteProjectMembers>;
export type PlainwriteCredential = InferSelectModel<typeof plainwriteCredentials>;
export type PlainwriteProjectCredential = InferSelectModel<typeof plainwriteProjectCredentials>;
export type PlainwriteFileCacheEntry = InferSelectModel<typeof plainwriteFileCache>;
export type PlainwriteDraft = InferSelectModel<typeof plainwriteDrafts>;
export type PlainwriteCollectionSchema = InferSelectModel<typeof plainwriteCollectionSchemas>;
export type PlainwritePublishEvent = InferSelectModel<typeof plainwritePublishEvents>;
export type NewPlainwriteProject = InferInsertModel<typeof plainwriteProjects>;
export type NewPlainwriteProjectMember = InferInsertModel<typeof plainwriteProjectMembers>;
export type NewPlainwriteCredential = InferInsertModel<typeof plainwriteCredentials>;
export type NewPlainwriteProjectCredential = InferInsertModel<typeof plainwriteProjectCredentials>;
export type NewPlainwriteFileCacheEntry = InferInsertModel<typeof plainwriteFileCache>;
export type NewPlainwriteDraft = InferInsertModel<typeof plainwriteDrafts>;
export type NewPlainwriteCollectionSchema = InferInsertModel<typeof plainwriteCollectionSchemas>;
export type NewPlainwritePublishEvent = InferInsertModel<typeof plainwritePublishEvents>;
