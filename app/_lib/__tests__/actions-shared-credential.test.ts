import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const secretsCreate = vi.fn();
const secretsUpdate = vi.fn();
const secretsDelete = vi.fn();
const secretsGet = vi.fn();

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    auth: { requireSession: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1' } })) },
    db: { getClient: vi.fn(async () => fakeDb) },
    secrets: {
      create: secretsCreate,
      update: secretsUpdate,
      delete: secretsDelete,
      get: secretsGet,
    },
    connections: { disconnect: vi.fn() },
  },
}));

vi.mock('../git-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git-providers')>();
  return {
    ...actual,
    getGitProvider: vi.fn(() => ({
      validatePat: vi.fn(async () => ({ login: 'octocat', canPush: true })),
      getFileTree: vi.fn(async () => []),
    })),
  };
});

let membershipRow: { role: string } | null = { role: 'owner' };
let projectRow: Record<string, unknown> | null = null;
let personalCredentialRow: Record<string, unknown> | null = null;
let sharedCredentialRow: Record<string, unknown> | null = null;
let draftRows: Record<string, unknown>[] = [];
const insertedSharedCredentials: Array<Record<string, unknown>> = [];
const updatedSharedCredentials: Array<Record<string, unknown>> = [];

const fakeDb = {
  select() {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        const builder = {
          where() {
            return builder;
          },
          orderBy: async () => [],
          limit: async () => {
            if (tableName === 'plainwrite_project_members') return membershipRow ? [membershipRow] : [];
            if (tableName === 'plainwrite_projects') return projectRow ? [projectRow] : [];
            if (tableName === 'plainwrite_credentials') return personalCredentialRow ? [personalCredentialRow] : [];
            if (tableName === 'plainwrite_project_credentials')
              return sharedCredentialRow ? [sharedCredentialRow] : [];
            return [];
          },
          then(resolve: (rows: unknown[]) => void) {
            if (tableName === 'plainwrite_drafts') {
              return resolve(draftRows.filter((row) => row.content !== null));
            }
            resolve([]);
          },
        };
        return builder;
      },
    };
  },
  delete() {
    return { where: async () => {} };
  },
  insert(table: Table) {
    const tableName = getTableName(table);
    return {
      values: async (row: Record<string, unknown>) => {
        if (tableName === 'plainwrite_project_credentials') {
          insertedSharedCredentials.push(row);
          sharedCredentialRow = row;
        }
      },
    };
  },
  update(table: Table) {
    const tableName = getTableName(table);
    return {
      set: (row: Record<string, unknown>) => ({
        where: async () => {
          if (tableName === 'plainwrite_project_credentials') {
            updatedSharedCredentials.push(row);
            sharedCredentialRow = { ...sharedCredentialRow, ...row };
          }
        },
      }),
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  insertedSharedCredentials.length = 0;
  updatedSharedCredentials.length = 0;
  membershipRow = { role: 'owner' };
  personalCredentialRow = null;
  sharedCredentialRow = null;
  draftRows = [];
  projectRow = {
    id: 'project-1',
    tenantId: 'tenant-1',
    repoOwner: 'octo',
    repoName: 'docs',
    provider: 'github',
    branch: 'main',
    pathPrefix: 'src/content',
    ssgType: 'astro',
    isPrivate: true,
    metadataVisibility: 'members_with_credentials',
  };
  secretsCreate.mockResolvedValue({ id: 'shared-secret-new' });
});

describe('connectSharedGitHubPat — owner-only shared credential', () => {
  it('stores the shared token as a plugin-scoped secret, never the raw token in the row', async () => {
    const { connectSharedGitHubPat } = await import('../actions');
    const formData = new FormData();
    formData.set('token', 'ghp_shared_secret_value');

    await connectSharedGitHubPat('project-1', formData);

    expect(secretsCreate).toHaveBeenCalledWith(expect.objectContaining({ scope: 'plugin' }));
    expect(insertedSharedCredentials).toHaveLength(1);
    const row = insertedSharedCredentials.at(0);
    expect(row?.secretRef).toBe('shared-secret-new');
    expect(row?.createdBy).toBe('user-1');
    expect(JSON.stringify(row)).not.toContain('ghp_shared_secret_value');
    expect(Object.keys(row ?? {})).not.toContain('token');
  });

  it('rejects a non-owner (editor) trying to connect a shared credential', async () => {
    membershipRow = { role: 'editor' };
    const { connectSharedGitHubPat } = await import('../actions');
    const formData = new FormData();
    formData.set('token', 'ghp_shared_secret_value');

    await expect(connectSharedGitHubPat('project-1', formData)).rejects.toThrow();
    expect(secretsCreate).not.toHaveBeenCalled();
  });

  it('reconnecting rotates the existing shared vault secret instead of orphaning it', async () => {
    sharedCredentialRow = {
      tenantId: 'tenant-1',
      projectId: 'project-1',
      createdBy: 'user-1',
      provider: 'github',
      authType: 'pat',
      secretRef: 'shared-secret-old',
      providerLogin: 'octocat',
      status: 'connected',
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    };
    secretsUpdate.mockResolvedValue(undefined);

    const { connectSharedGitHubPat } = await import('../actions');
    const formData = new FormData();
    formData.set('token', 'ghp_rotated_shared_value');

    await connectSharedGitHubPat('project-1', formData);

    expect(secretsCreate).not.toHaveBeenCalled();
    expect(secretsUpdate).toHaveBeenCalledWith('shared-secret-old', 'ghp_rotated_shared_value');
    expect(updatedSharedCredentials.at(0)?.secretRef).toBe('shared-secret-old');
  });
});

describe('disconnectSharedGitHubCredential', () => {
  it('marks the shared credential disconnected even when the vault secret is already gone', async () => {
    sharedCredentialRow = {
      tenantId: 'tenant-1',
      projectId: 'project-1',
      createdBy: 'user-1',
      provider: 'github',
      authType: 'pat',
      secretRef: 'shared-secret-gone',
      providerLogin: 'octocat',
      status: 'connected',
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    };
    secretsDelete.mockRejectedValue(new Error('secret not found'));

    const { disconnectSharedGitHubCredential } = await import('../actions');
    await expect(disconnectSharedGitHubCredential('project-1')).resolves.toBeUndefined();

    expect(updatedSharedCredentials.at(0)?.status).toBe('disconnected');
  });

  it('rejects a non-owner trying to disconnect the shared credential', async () => {
    membershipRow = { role: 'editor' };
    const { disconnectSharedGitHubCredential } = await import('../actions');

    await expect(disconnectSharedGitHubCredential('project-1')).rejects.toThrow();
  });
});

describe('resolveGitHubCredential fallback — a member with no personal credential', () => {
  it('falls back to a working shared credential to view cached metadata on a private repo', async () => {
    membershipRow = { role: 'viewer' };
    personalCredentialRow = null;
    sharedCredentialRow = {
      tenantId: 'tenant-1',
      projectId: 'project-1',
      createdBy: 'owner-1',
      provider: 'github',
      authType: 'pat',
      secretRef: 'shared-secret-live',
      providerLogin: 'octocat',
      status: 'connected',
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    };
    secretsGet.mockResolvedValue('ghp_shared_live_token');

    const { listContentFiles } = await import('../actions');
    const result = await listContentFiles('project-1');

    // No "connect a token" local-only fallback message — the shared
    // credential made the real (empty, in this fake) file listing visible.
    expect(result.syncError).toBeNull();
    expect(secretsGet).toHaveBeenCalledWith('shared-secret-live');
  });

  it('does not fall back to a disconnected shared credential', async () => {
    membershipRow = { role: 'viewer' };
    personalCredentialRow = null;
    sharedCredentialRow = {
      tenantId: 'tenant-1',
      projectId: 'project-1',
      createdBy: 'owner-1',
      provider: 'github',
      authType: 'pat',
      secretRef: 'shared-secret-off',
      providerLogin: 'octocat',
      status: 'disconnected',
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    };

    const { listContentFiles } = await import('../actions');
    const result = await listContentFiles('project-1');

    expect(secretsGet).not.toHaveBeenCalled();
    expect(result.syncError).toMatch(/Connect a GitHub token/);
  });

  it('prefers a working personal credential over the shared one', async () => {
    membershipRow = { role: 'editor' };
    personalCredentialRow = {
      tenantId: 'tenant-1',
      projectId: 'project-1',
      userId: 'user-1',
      provider: 'github',
      authType: 'pat',
      connectionId: null,
      secretRef: 'personal-secret',
      tokenExpiresAt: null,
      providerLogin: 'user-one',
      status: 'connected',
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    };
    sharedCredentialRow = {
      tenantId: 'tenant-1',
      projectId: 'project-1',
      createdBy: 'owner-1',
      provider: 'github',
      authType: 'pat',
      secretRef: 'shared-secret-live',
      providerLogin: 'octocat',
      status: 'connected',
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    };
    secretsGet.mockResolvedValue('ghp_personal_live_token');

    const { listContentFiles } = await import('../actions');
    await listContentFiles('project-1');

    expect(secretsGet).toHaveBeenCalledWith('personal-secret');
    expect(secretsGet).not.toHaveBeenCalledWith('shared-secret-live');
  });
});
