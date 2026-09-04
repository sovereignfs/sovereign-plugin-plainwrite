import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    auth: { requireSession: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1' } })) },
    db: { getClient: vi.fn(async () => fakeDb) },
    secrets: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(async () => 'test-token'),
    },
    connections: { disconnect: vi.fn() },
    notifications: { send: vi.fn() },
    activity: { log: vi.fn() },
  },
}));

const getFileContent = vi.fn();
const publishFile = vi.fn();

vi.mock('../git-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git-providers')>();
  return {
    ...actual,
    getGitProvider: vi.fn(() => ({ getFileContent, publishFile })),
  };
});

const PATH = 'src/content/hello.md';

let membershipRow: { role: string; userId: string } | null = { role: 'editor', userId: 'user-1' };
let projectRow: Record<string, unknown> | null = null;
let credentialRow: Record<string, unknown> | null = null;
let draftRow: Record<string, unknown> | null = null;
const insertedPublishEvents: Record<string, unknown>[] = [];

const fakeDb = {
  select() {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        const builder = {
          where() {
            return builder;
          },
          orderBy() {
            return builder;
          },
          limit: async () => {
            if (tableName === 'plainwrite_project_members')
              return membershipRow ? [membershipRow] : [];
            if (tableName === 'plainwrite_projects') return projectRow ? [projectRow] : [];
            if (tableName === 'plainwrite_credentials') return credentialRow ? [credentialRow] : [];
            if (tableName === 'plainwrite_drafts') return draftRow ? [draftRow] : [];
            return [];
          },
          // notifyAndLogPublish awaits select(...).from(members).where(...)
          // directly with no .limit()/.orderBy() — this resolves that form.
          then(resolve: (rows: unknown[]) => void) {
            if (tableName === 'plainwrite_project_members') {
              return resolve(membershipRow ? [membershipRow] : []);
            }
            resolve([]);
          },
        };
        return builder;
      },
    };
  },
  insert(table: Table) {
    const tableName = getTableName(table);
    return {
      values: async (row: Record<string, unknown>) => {
        if (tableName === 'plainwrite_publish_events') insertedPublishEvents.push(row);
      },
    };
  },
  update(table: Table) {
    const tableName = getTableName(table);
    return {
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          if (tableName === 'plainwrite_drafts' && draftRow) {
            draftRow = { ...draftRow, ...patch };
          }
        },
      }),
    };
  },
  delete() {
    return { where: async () => {} };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  insertedPublishEvents.length = 0;
  membershipRow = { role: 'editor', userId: 'user-1' };
  projectRow = {
    id: 'project-1',
    tenantId: 'tenant-1',
    repoOwner: 'octo',
    repoName: 'docs',
    provider: 'github',
    branch: 'main',
    pathPrefix: 'src/content',
    ssgType: 'astro',
    isPrivate: false,
  };
  credentialRow = {
    tenantId: 'tenant-1',
    projectId: 'project-1',
    userId: 'user-1',
    provider: 'github',
    authType: 'pat',
    connectionId: null,
    secretRef: 'secret-1',
    tokenExpiresAt: null,
    providerLogin: 'octo',
    status: 'connected',
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
  };
  draftRow = {
    id: 'draft-1',
    tenantId: 'tenant-1',
    projectId: 'project-1',
    filePath: PATH,
    userId: 'user-1',
    content: '---\ntitle: Local\n---\n\nLocal body.',
    status: 'committed',
    commitMessage: 'Local edit',
    baseSha: 'stale-sha',
    committedAt: 1,
    publishedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
});

describe('getConflictComparison', () => {
  it('returns both versions when the remote file exists', async () => {
    getFileContent.mockResolvedValue({
      content: '---\ntitle: Remote\n---\n\nRemote body.',
      sha: 'fresh-sha',
    });
    const { getConflictComparison } = await import('../actions');

    const result = await getConflictComparison('project-1', PATH);

    expect(result).toEqual({
      localContent: '---\ntitle: Local\n---\n\nLocal body.',
      remoteContent: '---\ntitle: Remote\n---\n\nRemote body.',
      remoteMissing: false,
    });
  });

  it('reports remoteMissing when the site no longer has the file', async () => {
    const { GitProviderError } = await import('../git-providers');
    getFileContent.mockRejectedValue(new GitProviderError('Not found', 404));
    const { getConflictComparison } = await import('../actions');

    const result = await getConflictComparison('project-1', PATH);

    expect(result).toEqual({
      localContent: '---\ntitle: Local\n---\n\nLocal body.',
      remoteContent: null,
      remoteMissing: true,
    });
  });

  it('throws when there is no local draft to compare', async () => {
    draftRow = null;
    const { getConflictComparison } = await import('../actions');

    await expect(getConflictComparison('project-1', PATH)).rejects.toThrow(
      'No local draft to compare.',
    );
  });
});

describe('refreshDraftBase — "Keep editing mine"', () => {
  it('moves the draft base sha forward without touching its content', async () => {
    getFileContent.mockResolvedValue({ content: 'remote content', sha: 'fresh-sha' });
    const { refreshDraftBase } = await import('../actions');

    const result = await refreshDraftBase('project-1', PATH, null, new FormData());

    expect(result.ok).toBe(true);
    expect(draftRow?.baseSha).toBe('fresh-sha');
    expect(draftRow?.content).toBe('---\ntitle: Local\n---\n\nLocal body.');
  });

  it('sets base sha to null when the remote file no longer exists', async () => {
    const { GitProviderError } = await import('../git-providers');
    getFileContent.mockRejectedValue(new GitProviderError('Not found', 404));
    const { refreshDraftBase } = await import('../actions');

    const result = await refreshDraftBase('project-1', PATH, null, new FormData());

    expect(result.ok).toBe(true);
    expect(draftRow?.baseSha).toBeNull();
  });

  it('returns an inline error without a connected credential', async () => {
    credentialRow = null;
    const { refreshDraftBase } = await import('../actions');

    const result = await refreshDraftBase('project-1', PATH, null, new FormData());

    expect(result).toEqual({ ok: false, error: 'Connect a GitHub token to check the site.' });
  });
});

describe('publishCommittedDraft — conflict detection and force override', () => {
  it('returns a Conflict error when the remote sha no longer matches the draft base', async () => {
    getFileContent.mockResolvedValue({ content: 'remote content', sha: 'new-remote-sha' });
    const { publishCommittedDraft } = await import('../actions');

    const result = await publishCommittedDraft('project-1', PATH, null, new FormData());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Conflict:');
    expect(publishFile).not.toHaveBeenCalled();
  });

  it('publishes normally when the remote sha still matches the draft base', async () => {
    getFileContent.mockResolvedValue({ content: 'remote content', sha: 'stale-sha' });
    publishFile.mockResolvedValue({ commitSha: 'commit-1', contentSha: 'new-content-sha' });
    const { publishCommittedDraft } = await import('../actions');

    const result = await publishCommittedDraft('project-1', PATH, null, new FormData());

    expect(result).toEqual({ ok: true });
    expect(publishFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ baseSha: 'stale-sha' }),
      expect.anything(),
    );
  });

  it('"Publish mine anyway" (force) skips the conflict check and adopts the current remote sha', async () => {
    getFileContent.mockResolvedValue({ content: 'remote content', sha: 'new-remote-sha' });
    publishFile.mockResolvedValue({ commitSha: 'commit-1', contentSha: 'new-content-sha' });
    const { publishCommittedDraft } = await import('../actions');
    const formData = new FormData();
    formData.set('force', 'true');

    const result = await publishCommittedDraft('project-1', PATH, null, formData);

    expect(result).toEqual({ ok: true });
    expect(publishFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ baseSha: 'new-remote-sha' }),
      expect.anything(),
    );
  });

  // The non-force conflict check classifies "no such file" off
  // GitProviderError.notFound. It previously matched on the sanitized
  // message text instead, which is user-facing copy with no contract — and
  // case-sensitively, so this very mock ('Not found') would not have matched
  // it. Neither branch below had any coverage.
  it('publishes a brand-new file when the site has nothing at that path', async () => {
    const { GitProviderError } = await import('../git-providers');
    draftRow = { ...(draftRow as Record<string, unknown>), baseSha: null };
    getFileContent.mockRejectedValue(new GitProviderError('Not found', 404));
    publishFile.mockResolvedValue({ commitSha: 'commit-1', contentSha: 'new-content-sha' });
    const { publishCommittedDraft } = await import('../actions');

    const result = await publishCommittedDraft('project-1', PATH, null, new FormData());

    expect(result).toEqual({ ok: true });
    expect(publishFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ baseSha: null }),
      expect.anything(),
    );
  });

  it('reports a conflict when the file the draft was opened from has been deleted', async () => {
    const { GitProviderError } = await import('../git-providers');
    getFileContent.mockRejectedValue(new GitProviderError('Not found', 404));
    const { publishCommittedDraft } = await import('../actions');

    const result = await publishCommittedDraft('project-1', PATH, null, new FormData());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('no longer exists');
    expect(publishFile).not.toHaveBeenCalled();
  });

  it('does not swallow a non-404 provider failure as a missing file', async () => {
    const { GitProviderError } = await import('../git-providers');
    getFileContent.mockRejectedValue(
      new GitProviderError('GitHub token is missing repository permissions.', 403),
    );
    const { publishCommittedDraft } = await import('../actions');

    const result = await publishCommittedDraft('project-1', PATH, null, new FormData());

    expect(result.ok).toBe(false);
    expect(publishFile).not.toHaveBeenCalled();
  });

  it('force publish treats a since-deleted remote file as a fresh create (null base sha)', async () => {
    const { GitProviderError } = await import('../git-providers');
    getFileContent.mockRejectedValue(new GitProviderError('Not found', 404));
    publishFile.mockResolvedValue({ commitSha: 'commit-1', contentSha: 'new-content-sha' });
    const { publishCommittedDraft } = await import('../actions');
    const formData = new FormData();
    formData.set('force', 'true');

    const result = await publishCommittedDraft('project-1', PATH, null, formData);

    expect(result).toEqual({ ok: true });
    expect(publishFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ baseSha: null }),
      expect.anything(),
    );
  });
});
