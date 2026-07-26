import { randomUUID } from 'node:crypto';
import { sdk } from '@sovereignfs/sdk';
import type {
  DeletionContext,
  DeletionResult,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';
import { and, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import {
  plainwriteCollectionSchemas,
  plainwriteCredentials,
  plainwriteDrafts,
  plainwriteFileCache,
  plainwriteProjectCredentials,
  plainwriteProjectMembers,
  plainwriteProjects,
  plainwritePublishEvents,
} from '../_db/schema';

// The SDK intentionally returns an opaque dialect-agnostic DB client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BaseSQLiteDatabase<'async', any, any>;

const PLUGIN_ID = 'fs.sovereign.plainwrite';
const EXPORT_SCHEMA_VERSION = 1;

function now() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Registers Plainwrite's export/import/delete participation (RFC 0007).
 * Must be called from a request-scoped Plainwrite route — this repo calls
 * it from `app/layout.tsx`. See data-contracts.ts for the same
 * in-process-registry caveat.
 */
export async function registerPortabilityHandlers(): Promise<void> {
  await sdk.portability.provideExport(exportPlainwriteData);
  await sdk.portability.provideImport(importPlainwriteData);
  await sdk.portability.provideDelete(deletePlainwriteData);
}

// ---- Export shape ----
// Keyed by the row's *original* id/projectId — the import handler remaps
// project ids via ctx.remapId, so every cross-reference below travels as
// the original id and gets translated at import time.

interface ExportProject {
  id: string;
  name: string;
  description: string | null;
  repoOwner: string;
  repoName: string;
  branch: string;
  pathPrefix: string;
  imageUploadPath: string;
  ssgType: string;
  isPrivate: boolean;
  metadataVisibility: string;
  archivedAt: number | null;
  createdAt: number;
}

interface ExportSchema {
  projectId: string;
  collection: string;
  schemaJson: string;
  inferredAt: number | null;
  isManual: boolean;
}

interface ExportFileCacheEntry {
  projectId: string;
  path: string;
  collection: string | null;
  filename: string;
  sha: string;
  lastSyncedAt: number;
}

interface ExportPublishEvent {
  projectId: string;
  provider: string;
  branch: string;
  commitSha: string | null;
  message: string;
  files: string[];
  status: string;
  errorCode: string | null;
  errorSummary: string | null;
  createdAt: number;
}

interface ExportDraft {
  projectId: string;
  filePath: string;
  content: string | null;
  status: string;
  commitMessage: string | null;
  baseSha: string | null;
  committedAt: number | null;
  publishedAt: number | null;
  createdAt: number;
}

/** Metadata only — never the token. Shown to the user post-import as a reconnect checklist. */
interface ExportCredentialSummary {
  projectId: string;
  provider: string;
  authType: string;
  providerLogin: string | null;
}

interface PlainwriteExportData {
  projects: ExportProject[];
  schemas: ExportSchema[];
  fileCache: ExportFileCacheEntry[];
  publishEvents: ExportPublishEvent[];
  drafts: ExportDraft[];
  credentials: ExportCredentialSummary[];
}

async function exportPlainwriteData(ctx: ExportContext): Promise<PluginExportSection> {
  const db = (await sdk.db.getClient()) as Db;
  const { userId, tenantId } = ctx;

  const memberships = await db
    .select()
    .from(plainwriteProjectMembers)
    .where(and(eq(plainwriteProjectMembers.tenantId, tenantId), eq(plainwriteProjectMembers.userId, userId)));
  const ownedProjectIds = memberships.filter((m) => m.role === 'owner').map((m) => m.projectId);

  const projects: ExportProject[] = [];
  const schemas: ExportSchema[] = [];
  const fileCache: ExportFileCacheEntry[] = [];
  const publishEvents: ExportPublishEvent[] = [];

  if (ownedProjectIds.length > 0) {
    const projectRows = await db
      .select()
      .from(plainwriteProjects)
      .where(and(eq(plainwriteProjects.tenantId, tenantId), eq(plainwriteProjects.createdBy, userId)));
    for (const project of projectRows) {
      projects.push({
        id: project.id,
        name: project.name,
        description: project.description,
        repoOwner: project.repoOwner,
        repoName: project.repoName,
        branch: project.branch,
        pathPrefix: project.pathPrefix,
        imageUploadPath: project.imageUploadPath,
        ssgType: project.ssgType,
        isPrivate: project.isPrivate,
        metadataVisibility: project.metadataVisibility,
        archivedAt: project.archivedAt,
        createdAt: project.createdAt,
      });
    }

    for (const projectId of ownedProjectIds) {
      const [schemaRows, fileRows, eventRows] = await Promise.all([
        db
          .select()
          .from(plainwriteCollectionSchemas)
          .where(
            and(
              eq(plainwriteCollectionSchemas.tenantId, tenantId),
              eq(plainwriteCollectionSchemas.projectId, projectId),
            ),
          ),
        db
          .select()
          .from(plainwriteFileCache)
          .where(and(eq(plainwriteFileCache.tenantId, tenantId), eq(plainwriteFileCache.projectId, projectId))),
        db
          .select()
          .from(plainwritePublishEvents)
          .where(
            and(eq(plainwritePublishEvents.tenantId, tenantId), eq(plainwritePublishEvents.projectId, projectId)),
          ),
      ]);

      for (const schema of schemaRows) {
        schemas.push({
          projectId: schema.projectId,
          collection: schema.collection,
          schemaJson: schema.schemaJson,
          inferredAt: schema.inferredAt,
          isManual: schema.updatedBy !== null,
        });
      }
      for (const file of fileRows) {
        fileCache.push({
          projectId: file.projectId,
          path: file.path,
          collection: file.collection,
          filename: file.filename,
          sha: file.sha,
          lastSyncedAt: file.lastSyncedAt,
        });
      }
      for (const event of eventRows) {
        publishEvents.push({
          projectId: event.projectId,
          provider: event.provider,
          branch: event.branch,
          commitSha: event.commitSha,
          message: event.message,
          files: parsePublishedFiles(event.files),
          status: event.status,
          errorCode: event.errorCode,
          errorSummary: event.errorSummary,
          createdAt: event.createdAt,
        });
      }
    }
  }

  // The user's own drafts, across every project they're a member of (owned
  // or not) — drafts are personal work. A draft on a project the user
  // doesn't own has no matching entry in `projects` above, so the import
  // handler skips it (that project isn't part of this export).
  const draftRows = await db
    .select()
    .from(plainwriteDrafts)
    .where(and(eq(plainwriteDrafts.tenantId, tenantId), eq(plainwriteDrafts.userId, userId)));
  const drafts: ExportDraft[] = draftRows.map((draft) => ({
    projectId: draft.projectId,
    filePath: draft.filePath,
    content: draft.content,
    status: draft.status,
    commitMessage: draft.commitMessage,
    baseSha: draft.baseSha,
    committedAt: draft.committedAt,
    publishedAt: draft.publishedAt,
    createdAt: draft.createdAt,
  }));

  // Credential metadata only (never secretRef/token) — informational, to
  // remind the user which projects need reconnecting after import. Not
  // restored by the import handler.
  const credentialRows = await db
    .select()
    .from(plainwriteCredentials)
    .where(and(eq(plainwriteCredentials.tenantId, tenantId), eq(plainwriteCredentials.userId, userId)));
  const credentials: ExportCredentialSummary[] = credentialRows.map((credential) => ({
    projectId: credential.projectId,
    provider: credential.provider,
    authType: credential.authType,
    providerLogin: credential.providerLogin,
  }));

  const data: PlainwriteExportData = { projects, schemas, fileCache, publishEvents, drafts, credentials };
  return { pluginId: PLUGIN_ID, schemaVersion: EXPORT_SCHEMA_VERSION, data };
}

// ---- Import ----

function isPlainwriteExportData(value: unknown): value is PlainwriteExportData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PlainwriteExportData>;
  return (
    Array.isArray(candidate.projects) &&
    Array.isArray(candidate.schemas) &&
    Array.isArray(candidate.fileCache) &&
    Array.isArray(candidate.publishEvents) &&
    Array.isArray(candidate.drafts)
  );
}

async function importPlainwriteData(section: PluginExportSection, ctx: ImportContext): Promise<void> {
  if (!isPlainwriteExportData(section.data)) {
    throw new Error('Plainwrite import section has an unrecognized shape.');
  }
  const data = section.data;
  const db = (await sdk.db.getClient()) as Db;
  const ts = now();
  const projectIdMap = new Map<string, string>();

  for (const project of data.projects) {
    const newProjectId = ctx.remapId(project.id);
    projectIdMap.set(project.id, newProjectId);
    await db.insert(plainwriteProjects).values({
      id: newProjectId,
      tenantId: ctx.tenantId,
      createdBy: ctx.userId,
      name: project.name,
      description: project.description,
      provider: 'github',
      providerUrl: null,
      repoOwner: project.repoOwner,
      repoName: project.repoName,
      branch: project.branch,
      pathPrefix: project.pathPrefix,
      imageUploadPath: project.imageUploadPath,
      ssgType: project.ssgType,
      isPrivate: project.isPrivate,
      metadataVisibility: project.metadataVisibility,
      archivedAt: project.archivedAt,
      createdAt: project.createdAt,
      updatedAt: ts,
    });
    await db.insert(plainwriteProjectMembers).values({
      tenantId: ctx.tenantId,
      projectId: newProjectId,
      userId: ctx.userId,
      role: 'owner',
      invitedBy: null,
      joinedAt: ts,
    });
  }

  for (const schema of data.schemas) {
    const newProjectId = projectIdMap.get(schema.projectId);
    if (!newProjectId) continue;
    await db.insert(plainwriteCollectionSchemas).values({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      projectId: newProjectId,
      collection: schema.collection,
      schemaJson: schema.schemaJson,
      inferredAt: schema.inferredAt,
      updatedAt: ts,
      updatedBy: schema.isManual ? ctx.userId : null,
    });
  }

  for (const file of data.fileCache) {
    const newProjectId = projectIdMap.get(file.projectId);
    if (!newProjectId) continue;
    await db.insert(plainwriteFileCache).values({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      projectId: newProjectId,
      path: file.path,
      collection: file.collection,
      filename: file.filename,
      sha: file.sha,
      lastSyncedAt: file.lastSyncedAt,
    });
  }

  for (const event of data.publishEvents) {
    const newProjectId = projectIdMap.get(event.projectId);
    if (!newProjectId) continue;
    await db.insert(plainwritePublishEvents).values({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      projectId: newProjectId,
      userId: ctx.userId,
      provider: event.provider,
      branch: event.branch,
      commitSha: event.commitSha,
      message: event.message,
      files: JSON.stringify(event.files),
      status: event.status,
      errorCode: event.errorCode,
      errorSummary: event.errorSummary,
      createdAt: event.createdAt,
    });
  }

  for (const draft of data.drafts) {
    const newProjectId = projectIdMap.get(draft.projectId);
    // A draft on a project the exporting user didn't own has no entry in
    // `data.projects` (only owned projects are exported) — nothing to
    // attach it to on the importing side, so it's skipped.
    if (!newProjectId) continue;
    await db.insert(plainwriteDrafts).values({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      projectId: newProjectId,
      filePath: draft.filePath,
      userId: ctx.userId,
      content: draft.content,
      status: draft.status,
      commitMessage: draft.commitMessage,
      baseSha: draft.baseSha,
      committedAt: draft.committedAt,
      publishedAt: draft.publishedAt,
      createdAt: draft.createdAt,
      updatedAt: ts,
    });
  }

  // Credentials are intentionally not restored — SPEC.md: "users must
  // reconnect provider credentials" after import. data.credentials exists
  // only as informational metadata inside the bundle itself.
}

// ---- Delete ----

async function deletePlainwriteData(ctx: DeletionContext): Promise<DeletionResult> {
  const db = ctx.db as Db;
  const errors: string[] = [];
  let deleted = 0;

  const credentials = await db
    .select({ secretRef: plainwriteCredentials.secretRef })
    .from(plainwriteCredentials)
    .where(and(eq(plainwriteCredentials.tenantId, ctx.tenantId), eq(plainwriteCredentials.userId, ctx.userId)));
  for (const credential of credentials) {
    if (!credential.secretRef || credential.secretRef.startsWith('revoked:')) continue;
    try {
      await sdk.secrets.delete(credential.secretRef);
    } catch {
      errors.push(`Could not revoke a vault secret for one project's credential.`);
    }
  }
  await db
    .delete(plainwriteCredentials)
    .where(and(eq(plainwriteCredentials.tenantId, ctx.tenantId), eq(plainwriteCredentials.userId, ctx.userId)));
  deleted += credentials.length;

  // A shared project credential the deleted user created (PLW-034) is that
  // user's own PAT — it must not keep working for other members once the
  // creator's account is gone, whether the project itself survives (another
  // owner or a promoted member takes over) or is hard-deleted below.
  const sharedCredentials = await db
    .select({ projectId: plainwriteProjectCredentials.projectId, secretRef: plainwriteProjectCredentials.secretRef })
    .from(plainwriteProjectCredentials)
    .where(
      and(
        eq(plainwriteProjectCredentials.tenantId, ctx.tenantId),
        eq(plainwriteProjectCredentials.createdBy, ctx.userId),
      ),
    );
  for (const shared of sharedCredentials) {
    if (shared.secretRef && !shared.secretRef.startsWith('revoked:')) {
      try {
        await sdk.secrets.delete(shared.secretRef);
      } catch {
        errors.push(`Could not revoke a vault secret for one project's shared connection.`);
      }
    }
    await db
      .delete(plainwriteProjectCredentials)
      .where(
        and(
          eq(plainwriteProjectCredentials.tenantId, ctx.tenantId),
          eq(plainwriteProjectCredentials.projectId, shared.projectId),
        ),
      );
  }
  deleted += sharedCredentials.length;

  const draftRows = await db
    .select({ id: plainwriteDrafts.id })
    .from(plainwriteDrafts)
    .where(and(eq(plainwriteDrafts.tenantId, ctx.tenantId), eq(plainwriteDrafts.userId, ctx.userId)));
  await db
    .delete(plainwriteDrafts)
    .where(and(eq(plainwriteDrafts.tenantId, ctx.tenantId), eq(plainwriteDrafts.userId, ctx.userId)));
  deleted += draftRows.length;

  const memberships = await db
    .select()
    .from(plainwriteProjectMembers)
    .where(
      and(eq(plainwriteProjectMembers.tenantId, ctx.tenantId), eq(plainwriteProjectMembers.userId, ctx.userId)),
    );

  for (const membership of memberships) {
    if (membership.role !== 'owner') {
      await db
        .delete(plainwriteProjectMembers)
        .where(
          and(
            eq(plainwriteProjectMembers.tenantId, ctx.tenantId),
            eq(plainwriteProjectMembers.projectId, membership.projectId),
            eq(plainwriteProjectMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
      continue;
    }

    const allMembers = await db
      .select()
      .from(plainwriteProjectMembers)
      .where(
        and(
          eq(plainwriteProjectMembers.tenantId, ctx.tenantId),
          eq(plainwriteProjectMembers.projectId, membership.projectId),
        ),
      );
    const otherMembers = allMembers.filter((member) => member.userId !== ctx.userId);
    const otherOwners = otherMembers.filter((member) => member.role === 'owner');

    if (otherOwners.length > 0) {
      // Another owner already covers the project; just leave.
      await db
        .delete(plainwriteProjectMembers)
        .where(
          and(
            eq(plainwriteProjectMembers.tenantId, ctx.tenantId),
            eq(plainwriteProjectMembers.projectId, membership.projectId),
            eq(plainwriteProjectMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
    } else if (otherMembers.length > 0) {
      // Sole owner, but other members exist — transfer ownership to the
      // longest-tenured other member before leaving, so the project survives.
      const promotee = [...otherMembers].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (promotee) {
        await db
          .update(plainwriteProjectMembers)
          .set({ role: 'owner' })
          .where(
            and(
              eq(plainwriteProjectMembers.tenantId, ctx.tenantId),
              eq(plainwriteProjectMembers.projectId, membership.projectId),
              eq(plainwriteProjectMembers.userId, promotee.userId),
            ),
          );
      }
      await db
        .delete(plainwriteProjectMembers)
        .where(
          and(
            eq(plainwriteProjectMembers.tenantId, ctx.tenantId),
            eq(plainwriteProjectMembers.projectId, membership.projectId),
            eq(plainwriteProjectMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
    } else {
      // Sole member entirely — the project has no one left to own it.
      // Hard-delete it (mirrors hardDeleteProject's cleanup). Remote git
      // history lives outside Sovereign and is untouched.
      await db
        .delete(plainwritePublishEvents)
        .where(
          and(
            eq(plainwritePublishEvents.tenantId, ctx.tenantId),
            eq(plainwritePublishEvents.projectId, membership.projectId),
          ),
        );
      await db
        .delete(plainwriteCollectionSchemas)
        .where(
          and(
            eq(plainwriteCollectionSchemas.tenantId, ctx.tenantId),
            eq(plainwriteCollectionSchemas.projectId, membership.projectId),
          ),
        );
      await db
        .delete(plainwriteFileCache)
        .where(
          and(
            eq(plainwriteFileCache.tenantId, ctx.tenantId),
            eq(plainwriteFileCache.projectId, membership.projectId),
          ),
        );
      await db
        .delete(plainwriteProjectMembers)
        .where(
          and(
            eq(plainwriteProjectMembers.tenantId, ctx.tenantId),
            eq(plainwriteProjectMembers.projectId, membership.projectId),
          ),
        );
      await db
        .delete(plainwriteProjects)
        .where(and(eq(plainwriteProjects.tenantId, ctx.tenantId), eq(plainwriteProjects.id, membership.projectId)));
      deleted += 1;
    }
  }

  return { deleted, errors: errors.length > 0 ? errors : undefined };
}

function parsePublishedFiles(value: string): string[] {
  try {
    const files = JSON.parse(value) as unknown;
    return Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string') : [];
  } catch {
    return [];
  }
}
