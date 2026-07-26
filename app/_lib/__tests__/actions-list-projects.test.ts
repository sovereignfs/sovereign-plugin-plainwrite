import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    auth: { requireSession: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1' } })) },
    db: { getClient: vi.fn(async () => fakeDb) },
    secrets: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), get: vi.fn() },
    connections: { disconnect: vi.fn() },
  },
}));

let membershipRows: Record<string, unknown>[] = [];
let projectRows: Record<string, unknown>[] = [];
let draftRows: Record<string, unknown>[] = [];
let credentialRows: Record<string, unknown>[] = [];
let sharedCredentialRows: Record<string, unknown>[] = [];
let fileCacheRows: Record<string, unknown>[] = [];

const fakeDb = {
  select() {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        const builder = {
          where() {
            return builder;
          },
          orderBy: async () => {
            if (tableName === 'plainwrite_projects') return projectRows;
            return [];
          },
          then(resolve: (rows: unknown[]) => void) {
            if (tableName === 'plainwrite_project_members') return resolve(membershipRows);
            if (tableName === 'plainwrite_drafts') return resolve(draftRows);
            if (tableName === 'plainwrite_credentials') return resolve(credentialRows);
            if (tableName === 'plainwrite_project_credentials') return resolve(sharedCredentialRows);
            if (tableName === 'plainwrite_file_cache') return resolve(fileCacheRows);
            resolve([]);
          },
        };
        return builder;
      },
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  membershipRows = [
    { projectId: 'project-1', role: 'owner' },
    { projectId: 'project-2', role: 'viewer' },
  ];
  projectRows = [
    {
      id: 'project-1',
      tenantId: 'tenant-1',
      name: 'Blog',
      repoOwner: 'octo',
      repoName: 'blog',
      branch: 'main',
      pathPrefix: 'src/content',
      ssgType: 'astro',
      isPrivate: true,
      archivedAt: null,
    },
    {
      id: 'project-2',
      tenantId: 'tenant-1',
      name: 'Docs',
      repoOwner: 'octo',
      repoName: 'docs',
      branch: 'main',
      pathPrefix: 'src/content',
      ssgType: 'astro',
      isPrivate: false,
      archivedAt: null,
    },
  ];
  draftRows = [
    { projectId: 'project-1', status: 'draft', content: 'a' },
    { projectId: 'project-1', status: 'draft', content: 'b' },
    { projectId: 'project-1', status: 'committed', content: 'c' },
  ];
  credentialRows = [{ projectId: 'project-1', status: 'needs_reauth' }];
  sharedCredentialRows = [];
  fileCacheRows = [
    { projectId: 'project-1' },
    { projectId: 'project-1' },
    { projectId: 'project-1' },
    { projectId: 'project-2' },
  ];
});

describe('listProjects — per-site pipeline counts and attention flag', () => {
  it('summarizes writing/ready/live counts and a needs-attention flag per project', async () => {
    const { listProjects } = await import('../actions');

    const result = await listProjects();

    const blog = result.find((project) => project.id === 'project-1');
    const docs = result.find((project) => project.id === 'project-2');

    expect(blog).toMatchObject({
      writingCount: 2,
      readyCount: 1,
      liveCount: 3,
      needsAttention: true,
      currentUserRole: 'owner',
    });
    expect(docs).toMatchObject({
      writingCount: 0,
      readyCount: 0,
      liveCount: 1,
      needsAttention: false,
      currentUserRole: 'viewer',
    });
  });

  it('returns an empty list when the user has no memberships', async () => {
    membershipRows = [];
    const { listProjects } = await import('../actions');

    const result = await listProjects();

    expect(result).toEqual([]);
  });

  it('flags hasSharedCredential only for a project with a connected shared credential', async () => {
    sharedCredentialRows = [
      { projectId: 'project-1', status: 'connected' },
      { projectId: 'project-2', status: 'disconnected' },
    ];
    const { listProjects } = await import('../actions');

    const result = await listProjects();

    expect(result.find((p) => p.id === 'project-1')).toMatchObject({ hasSharedCredential: true });
    expect(result.find((p) => p.id === 'project-2')).toMatchObject({ hasSharedCredential: false });
  });

  it('suppresses needsAttention when a broken personal credential has a working shared fallback', async () => {
    // project-1's personal credential is 'needs_reauth' (see beforeEach) —
    // without a working shared credential that alone drives needsAttention
    // (asserted above); a connected shared credential should suppress it.
    sharedCredentialRows = [{ projectId: 'project-1', status: 'connected' }];
    const { listProjects } = await import('../actions');

    const result = await listProjects();

    expect(result.find((p) => p.id === 'project-1')).toMatchObject({
      needsAttention: false,
      hasSharedCredential: true,
    });
  });
});
