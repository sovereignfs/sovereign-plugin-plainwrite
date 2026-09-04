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
    connections: { disconnect: vi.fn(), markUsed: vi.fn(), markError: vi.fn() },
    notifications: { send: vi.fn() },
    activity: { log: vi.fn() },
  },
}));

const publishFile = vi.fn();

vi.mock('../git-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git-providers')>();
  return {
    ...actual,
    getGitProvider: vi.fn(() => ({ publishFile })),
  };
});

let membershipRow: { role: string; userId: string } | null = { role: 'editor', userId: 'user-1' };
let projectRow: Record<string, unknown> | null = null;
let credentialRow: Record<string, unknown> | null = null;
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
};

function pngFile(name = 'photo.png', size = 1024) {
  return new File([new Uint8Array(size)], name, { type: 'image/png' });
}

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
    imageUploadPath: 'public/images',
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
});

describe('uploadProjectImage', () => {
  it('uploads a valid image and returns its Markdown reference', async () => {
    publishFile.mockResolvedValue({ commitSha: 'commit-1', contentSha: 'blob-1' });
    const { uploadProjectImage } = await import('../actions');
    const formData = new FormData();
    formData.set('image', pngFile('Sunset Photo.png'));

    const result = await uploadProjectImage('project-1', null, formData);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toMatch(/^public\/images\/sunset-photo-[0-9a-f]{8}\.png$/);
    expect(result.url).toBe(`/images/${result.path.split('/').at(-1)}`);
    expect(result.markdown).toBe(`![Sunset Photo](${result.url})`);
    expect(publishFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contentEncoding: 'base64', baseSha: null }),
      { token: 'test-token' },
    );
    expect(insertedPublishEvents).toHaveLength(1);
    expect(insertedPublishEvents[0]).toMatchObject({ status: 'success', commitSha: 'commit-1' });
  });

  // `..` survives encodeURIComponent (dots are unreserved) and WHATWG URL
  // parsing collapses the dot segments before the request is sent, so an
  // unguarded prefix silently retargeted the write at another repository.
  // A row persisted before normalizeImageUploadPath stripped traversal can
  // still hold one, so the assembled path must stay inside the repository.
  it('contains an upload whose stored image path contains traversal segments', async () => {
    projectRow = {
      ...(projectRow as Record<string, unknown>),
      imageUploadPath: '../../../../repos/attacker/evil/contents',
    };
    publishFile.mockResolvedValue({ commitSha: 'commit-1', contentSha: 'blob-1' });
    const { uploadProjectImage } = await import('../actions');
    const formData = new FormData();
    formData.set('image', pngFile());

    const result = await uploadProjectImage('project-1', null, formData);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).not.toContain('..');
    expect(result.path).toBe(`repos/attacker/evil/contents/${result.path.split('/').at(-1) ?? ''}`);
    // The decisive check: the URL the provider would build no longer walks
    // out of the project's own repository.
    const published = publishFile.mock.calls[0]?.[1] as { path: string };
    const resolved = new URL(
      `https://api.github.com/repos/acme/site/contents/${published.path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`,
    ).pathname;
    expect(resolved.startsWith('/repos/acme/site/contents/')).toBe(true);
  });

  it('rejects an unsupported file type without calling the provider', async () => {
    const { uploadProjectImage } = await import('../actions');
    const formData = new FormData();
    formData.set('image', new File(['<svg></svg>'], 'icon.svg', { type: 'image/svg+xml' }));

    const result = await uploadProjectImage('project-1', null, formData);

    expect(result).toEqual({
      ok: false,
      error: 'Unsupported image type. Use JPEG, PNG, WebP, or GIF.',
    });
    expect(publishFile).not.toHaveBeenCalled();
  });

  it('rejects an oversized file without calling the provider', async () => {
    const { uploadProjectImage } = await import('../actions');
    const formData = new FormData();
    formData.set('image', pngFile('big.png', 6 * 1024 * 1024));

    const result = await uploadProjectImage('project-1', null, formData);

    expect(result).toEqual({ ok: false, error: 'Image is larger than 5 MB.' });
    expect(publishFile).not.toHaveBeenCalled();
  });

  it('returns an inline error without a connected credential', async () => {
    credentialRow = null;
    const { uploadProjectImage } = await import('../actions');
    const formData = new FormData();
    formData.set('image', pngFile());

    const result = await uploadProjectImage('project-1', null, formData);

    expect(result).toEqual({ ok: false, error: 'Connect a GitHub token before uploading images.' });
    expect(publishFile).not.toHaveBeenCalled();
  });

  it('records a failed publish event and returns the classified error on provider failure', async () => {
    const { GitProviderError } = await import('../git-providers');
    publishFile.mockRejectedValue(
      new GitProviderError('GitHub rejected the publish request for this branch or file.', 422),
    );
    const { uploadProjectImage } = await import('../actions');
    const formData = new FormData();
    formData.set('image', pngFile());

    const result = await uploadProjectImage('project-1', null, formData);

    expect(result.ok).toBe(false);
    expect(insertedPublishEvents).toHaveLength(1);
    expect(insertedPublishEvents[0]).toMatchObject({ status: 'failed' });
  });

  it('requires no file to be a clear inline error, not a throw', async () => {
    const { uploadProjectImage } = await import('../actions');
    const formData = new FormData();

    const result = await uploadProjectImage('project-1', null, formData);

    expect(result).toEqual({ ok: false, error: 'No image selected.' });
  });
});
