import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeletionContext,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';

type Row = Record<string, unknown>;
type Condition =
  | { kind: 'eq'; key: string; value: unknown }
  | { kind: 'and'; conditions: Condition[] };

function toCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());
}

// Real and()/eq() build opaque SQL AST nodes; mocking them to build a small,
// interpretable Condition tree instead lets the fake db below actually
// filter rows per-query, matching the precision the real handler depends on
// (e.g. removing exactly one member's row out of several on a project).
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown): Condition => ({
      kind: 'eq',
      key: toCamel(column.name),
      value,
    }),
    and: (...conditions: Condition[]): Condition => ({ kind: 'and', conditions }),
  };
});

function matches(row: Row, condition?: Condition): boolean {
  if (!condition) return true;
  if (condition.kind === 'eq') return row[condition.key] === condition.value;
  return condition.conditions.every((c) => matches(row, c));
}

const capturedExporter = {
  fn: null as ((ctx: ExportContext) => Promise<PluginExportSection>) | null,
};
const capturedImporter = {
  fn: null as ((section: PluginExportSection, ctx: ImportContext) => Promise<void>) | null,
};
const capturedDeleter = {
  fn: null as ((ctx: DeletionContext) => Promise<{ deleted: number; errors?: string[] }>) | null,
};

const secretsDelete = vi.fn();

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    db: { getClient: vi.fn(async () => fakeDb) },
    secrets: { delete: secretsDelete },
    portability: {
      provideExport: vi.fn(async (fn: typeof capturedExporter.fn) => {
        capturedExporter.fn = fn;
      }),
      provideImport: vi.fn(async (fn: typeof capturedImporter.fn) => {
        capturedImporter.fn = fn;
      }),
      provideDelete: vi.fn(async (fn: typeof capturedDeleter.fn) => {
        capturedDeleter.fn = fn;
      }),
    },
  },
}));

// Named properties stay `Row[]` (not `Row[] | undefined`) so test assertions
// can index them directly; the index signature covers the fake db's
// generic `store[tableName]` access from a runtime-computed table name.
interface Store extends Record<string, Row[]> {
  plainwrite_projects: Row[];
  plainwrite_project_members: Row[];
  plainwrite_credentials: Row[];
  plainwrite_project_credentials: Row[];
  plainwrite_file_cache: Row[];
  plainwrite_drafts: Row[];
  plainwrite_collection_schemas: Row[];
  plainwrite_publish_events: Row[];
}

let store: Store = {
  plainwrite_projects: [],
  plainwrite_project_members: [],
  plainwrite_credentials: [],
  plainwrite_project_credentials: [],
  plainwrite_file_cache: [],
  plainwrite_drafts: [],
  plainwrite_collection_schemas: [],
  plainwrite_publish_events: [],
};

function resetStore() {
  store = {
    plainwrite_projects: [],
    plainwrite_project_members: [],
    plainwrite_credentials: [],
    plainwrite_project_credentials: [],
    plainwrite_file_cache: [],
    plainwrite_drafts: [],
    plainwrite_collection_schemas: [],
    plainwrite_publish_events: [],
  };
}

const fakeDb = {
  select(columns?: Record<string, unknown>) {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        return {
          where: async (condition?: Condition) => {
            const rows = (store[tableName] ?? []).filter((row) => matches(row, condition));
            if (!columns) return rows;
            return rows.map((row) => {
              const projected: Row = {};
              for (const key of Object.keys(columns)) projected[key] = row[key];
              return projected;
            });
          },
        };
      },
    };
  },
  insert(table: Table) {
    const tableName = getTableName(table);
    return {
      values: async (row: Row) => {
        (store[tableName] ??= []).push(row);
      },
    };
  },
  update(table: Table) {
    const tableName = getTableName(table);
    return {
      set: (patch: Row) => ({
        where: async (condition?: Condition) => {
          store[tableName] = (store[tableName] ?? []).map((row) =>
            matches(row, condition) ? { ...row, ...patch } : row,
          );
        },
      }),
    };
  },
  delete(table: Table) {
    const tableName = getTableName(table);
    return {
      where: async (condition?: Condition) => {
        store[tableName] = (store[tableName] ?? []).filter((row) => !matches(row, condition));
      },
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('portability export', () => {
  it("exports the user's owned projects with schemas/file cache/publish history, and their own drafts across all projects", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.plainwrite_project_members = [
      { tenantId: 't1', projectId: 'owned-1', userId: 'user-1', role: 'owner', joinedAt: 1 },
      { tenantId: 't1', projectId: 'member-1', userId: 'user-1', role: 'editor', joinedAt: 2 },
    ];
    store.plainwrite_projects = [
      {
        id: 'owned-1',
        tenantId: 't1',
        createdBy: 'user-1',
        name: 'Blog',
        description: null,
        repoOwner: 'octo',
        repoName: 'blog',
        branch: 'main',
        pathPrefix: 'src/content',
        imageUploadPath: 'public/images',
        ssgType: 'astro',
        isPrivate: false,
        metadataVisibility: 'all_members',
        archivedAt: null,
        createdAt: 10,
      },
    ];
    store.plainwrite_collection_schemas = [
      {
        tenantId: 't1',
        projectId: 'owned-1',
        collection: 'blog',
        schemaJson: '[]',
        inferredAt: 5,
        updatedBy: null,
      },
    ];
    store.plainwrite_file_cache = [
      {
        tenantId: 't1',
        projectId: 'owned-1',
        path: 'src/content/a.md',
        collection: null,
        filename: 'a.md',
        sha: 'sha1',
        lastSyncedAt: 6,
      },
    ];
    store.plainwrite_publish_events = [
      {
        tenantId: 't1',
        projectId: 'owned-1',
        provider: 'github',
        branch: 'main',
        commitSha: 'c1',
        message: 'Update a.md',
        files: JSON.stringify(['src/content/a.md']),
        status: 'success',
        errorCode: null,
        errorSummary: null,
        createdAt: 7,
      },
    ];
    store.plainwrite_drafts = [
      {
        tenantId: 't1',
        userId: 'user-1',
        projectId: 'owned-1',
        filePath: 'src/content/a.md',
        content: 'draft body 1',
        status: 'draft',
        commitMessage: null,
        baseSha: 'sha1',
        committedAt: null,
        publishedAt: null,
        createdAt: 8,
      },
      {
        tenantId: 't1',
        userId: 'user-1',
        projectId: 'member-1',
        filePath: 'src/content/b.md',
        content: 'draft body 2',
        status: 'draft',
        commitMessage: null,
        baseSha: null,
        committedAt: null,
        publishedAt: null,
        createdAt: 9,
      },
    ];
    store.plainwrite_credentials = [
      {
        tenantId: 't1',
        userId: 'user-1',
        projectId: 'owned-1',
        provider: 'github',
        authType: 'pat',
        providerLogin: 'octocat',
      },
    ];

    const section = await capturedExporter.fn?.({
      userId: 'user-1',
      tenantId: 't1',
      options: { includeFiles: true },
    });

    expect(section?.pluginId).toBe('fs.sovereign.plainwrite');
    expect(section?.schemaVersion).toBe(1);
    const data = section?.data as {
      projects: unknown[];
      schemas: unknown[];
      fileCache: unknown[];
      publishEvents: unknown[];
      drafts: Array<{ projectId: string }>;
      credentials: unknown[];
    };
    expect(data.projects).toHaveLength(1);
    expect(data.schemas).toHaveLength(1);
    expect(data.fileCache).toHaveLength(1);
    expect(data.publishEvents).toHaveLength(1);
    // Drafts from BOTH owned and member-only projects are included.
    expect(data.drafts.map((d) => d.projectId).sort()).toEqual(['member-1', 'owned-1']);
    expect(data.credentials).toEqual([
      { projectId: 'owned-1', provider: 'github', authType: 'pat', providerLogin: 'octocat' },
    ]);
    // No secretRef anywhere in the export.
    expect(JSON.stringify(section)).not.toContain('secretRef');
  });
});

describe('portability import', () => {
  it('rejects a section with an unrecognized shape', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    await expect(
      capturedImporter.fn?.(
        { pluginId: 'fs.sovereign.plainwrite', schemaVersion: 1, data: { nonsense: true } },
        { userId: 'user-2', tenantId: 't1', remapId: (id) => `new-${id}` },
      ),
    ).rejects.toThrow('unrecognized shape');
  });

  it('restores projects with remapped ids and skips drafts whose project was not exported', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.plainwrite',
      schemaVersion: 1,
      data: {
        projects: [
          {
            id: 'owned-1',
            name: 'Blog',
            description: null,
            repoOwner: 'octo',
            repoName: 'blog',
            branch: 'main',
            pathPrefix: 'src/content',
            imageUploadPath: 'public/images',
            ssgType: 'astro',
            isPrivate: false,
            metadataVisibility: 'all_members',
            archivedAt: null,
            createdAt: 10,
          },
        ],
        schemas: [
          {
            projectId: 'owned-1',
            collection: 'blog',
            schemaJson: '[]',
            inferredAt: 5,
            isManual: false,
          },
        ],
        fileCache: [
          {
            projectId: 'owned-1',
            path: 'src/content/a.md',
            collection: null,
            filename: 'a.md',
            sha: 'sha1',
            lastSyncedAt: 6,
          },
        ],
        publishEvents: [
          {
            projectId: 'owned-1',
            provider: 'github',
            branch: 'main',
            commitSha: 'c1',
            message: 'Update a.md',
            files: ['src/content/a.md'],
            status: 'success',
            errorCode: null,
            errorSummary: null,
            createdAt: 7,
          },
        ],
        drafts: [
          {
            projectId: 'owned-1',
            filePath: 'src/content/a.md',
            content: 'draft body 1',
            status: 'draft',
            commitMessage: null,
            baseSha: 'sha1',
            committedAt: null,
            publishedAt: null,
            createdAt: 8,
          },
          {
            // Belonged to a project the exporting user only had membership
            // on (not owner) — not in `projects`, so it has nothing to
            // attach to on import and must be skipped.
            projectId: 'member-1',
            filePath: 'src/content/b.md',
            content: 'draft body 2',
            status: 'draft',
            commitMessage: null,
            baseSha: null,
            committedAt: null,
            publishedAt: null,
            createdAt: 9,
          },
        ],
        credentials: [],
      },
    };

    await capturedImporter.fn?.(section, {
      userId: 'user-2',
      tenantId: 't1',
      remapId: (originalId) => `new-${originalId}`,
    });

    expect(store.plainwrite_projects).toHaveLength(1);
    expect(store.plainwrite_projects.at(0)).toMatchObject({
      id: 'new-owned-1',
      createdBy: 'user-2',
      name: 'Blog',
    });
    expect(store.plainwrite_project_members).toEqual([
      expect.objectContaining({ projectId: 'new-owned-1', userId: 'user-2', role: 'owner' }),
    ]);
    expect(store.plainwrite_collection_schemas).toHaveLength(1);
    expect(store.plainwrite_collection_schemas.at(0)).toMatchObject({ projectId: 'new-owned-1' });
    expect(store.plainwrite_file_cache).toHaveLength(1);
    expect(store.plainwrite_publish_events).toHaveLength(1);
    // Only the owned-project draft survives; the member-only one is skipped.
    expect(store.plainwrite_drafts).toHaveLength(1);
    expect(store.plainwrite_drafts.at(0)).toMatchObject({
      projectId: 'new-owned-1',
      filePath: 'src/content/a.md',
    });
    // Credentials are never restored by import.
    expect(store.plainwrite_credentials).toHaveLength(0);
  });
});

describe('portability delete', () => {
  it("deletes the user's credentials (revoking each vault secret) and drafts", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.plainwrite_credentials = [{ tenantId: 't1', userId: 'user-1', secretRef: 'secret-1' }];
    store.plainwrite_drafts = [
      { tenantId: 't1', userId: 'user-1', id: 'd1' },
      { tenantId: 't1', userId: 'user-1', id: 'd2' },
    ];
    store.plainwrite_project_members = [];

    const result = await capturedDeleter.fn?.({ userId: 'user-1', tenantId: 't1', db: fakeDb });

    expect(secretsDelete).toHaveBeenCalledWith('secret-1');
    expect(store.plainwrite_credentials).toHaveLength(0);
    expect(store.plainwrite_drafts).toHaveLength(0);
    expect(result?.deleted).toBe(3); // 1 credential + 2 drafts
  });

  it("revokes a shared project credential the user created, even when the project itself survives", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    // Sole owner, but another member exists — project survives via
    // ownership transfer. The departing owner's shared PAT must still be
    // revoked so it can't keep publishing on their behalf afterward.
    store.plainwrite_project_members = [
      { tenantId: 't1', projectId: 'p1', userId: 'user-1', role: 'owner', joinedAt: 1 },
      { tenantId: 't1', projectId: 'p1', userId: 'user-2', role: 'editor', joinedAt: 2 },
    ];
    store.plainwrite_projects = [{ id: 'p1', tenantId: 't1' }];
    store.plainwrite_project_credentials = [
      { tenantId: 't1', projectId: 'p1', createdBy: 'user-1', secretRef: 'shared-secret-1' },
    ];

    const result = await capturedDeleter.fn?.({ userId: 'user-1', tenantId: 't1', db: fakeDb });

    expect(secretsDelete).toHaveBeenCalledWith('shared-secret-1');
    expect(store.plainwrite_project_credentials).toHaveLength(0);
    expect(store.plainwrite_projects).toHaveLength(1); // project survives via ownership transfer
    expect(result?.deleted).toBeGreaterThanOrEqual(2); // membership transfer + shared credential
  });

  it('just removes membership for a project the user does not own', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.plainwrite_project_members = [
      { tenantId: 't1', projectId: 'p1', userId: 'user-1', role: 'editor', joinedAt: 1 },
    ];

    const result = await capturedDeleter.fn?.({ userId: 'user-1', tenantId: 't1', db: fakeDb });

    expect(store.plainwrite_project_members).toHaveLength(0);
    expect(store.plainwrite_projects).toHaveLength(0); // untouched — no project rows were ever seeded, still none
    expect(result?.deleted).toBe(1);
  });

  it('transfers ownership to the longest-tenured other member, then removes the sole owner', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.plainwrite_project_members = [
      { tenantId: 't1', projectId: 'p1', userId: 'user-1', role: 'owner', joinedAt: 1 },
      { tenantId: 't1', projectId: 'p1', userId: 'user-3', role: 'editor', joinedAt: 3 },
      { tenantId: 't1', projectId: 'p1', userId: 'user-2', role: 'viewer', joinedAt: 2 },
    ];
    store.plainwrite_projects = [{ id: 'p1', tenantId: 't1' }];

    await capturedDeleter.fn?.({ userId: 'user-1', tenantId: 't1', db: fakeDb });

    const remaining = store.plainwrite_project_members;
    expect(remaining.find((m) => m.userId === 'user-1')).toBeUndefined();
    // user-2 joined before user-3, so user-2 is promoted.
    expect(remaining.find((m) => m.userId === 'user-2')).toMatchObject({ role: 'owner' });
    expect(remaining.find((m) => m.userId === 'user-3')).toMatchObject({ role: 'editor' });
    expect(store.plainwrite_projects).toHaveLength(1); // project survives
  });

  it('hard-deletes the project when the user is its sole member', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.plainwrite_project_members = [
      { tenantId: 't1', projectId: 'p1', userId: 'user-1', role: 'owner', joinedAt: 1 },
    ];
    store.plainwrite_projects = [{ id: 'p1', tenantId: 't1' }];
    store.plainwrite_collection_schemas = [{ tenantId: 't1', projectId: 'p1' }];
    store.plainwrite_file_cache = [{ tenantId: 't1', projectId: 'p1' }];
    store.plainwrite_publish_events = [{ tenantId: 't1', projectId: 'p1' }];

    const result = await capturedDeleter.fn?.({ userId: 'user-1', tenantId: 't1', db: fakeDb });

    expect(store.plainwrite_projects).toHaveLength(0);
    expect(store.plainwrite_project_members).toHaveLength(0);
    expect(store.plainwrite_collection_schemas).toHaveLength(0);
    expect(store.plainwrite_file_cache).toHaveLength(0);
    expect(store.plainwrite_publish_events).toHaveLength(0);
    expect(result?.deleted).toBe(1);
  });
});
