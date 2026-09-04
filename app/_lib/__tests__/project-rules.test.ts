import { describe, expect, it } from 'vitest';
import {
  assertProjectRole,
  canEditProject,
  canManageProject,
  defaultMetadataVisibility,
  hasProjectRole,
  normalizeImageUploadPath,
  normalizePathPrefix,
  parseGitHubRepositoryUrl,
  projectInputDefaults,
} from '../project-rules';

describe('parseGitHubRepositoryUrl', () => {
  it('parses HTTPS GitHub repository URLs', () => {
    expect(
      parseGitHubRepositoryUrl('https://github.com/sovereignfs/sovereignfs-plainwrite'),
    ).toEqual({
      owner: 'sovereignfs',
      name: 'sovereignfs-plainwrite',
    });
  });

  it('parses SSH GitHub repository URLs', () => {
    expect(parseGitHubRepositoryUrl('git@github.com:sovereignfs/site.git')).toEqual({
      owner: 'sovereignfs',
      name: 'site',
    });
  });

  it('rejects non-GitHub and nested GitHub URLs', () => {
    expect(() => parseGitHubRepositoryUrl('https://gitlab.com/acme/site')).toThrow(
      'Only github.com repositories',
    );
    expect(() => parseGitHubRepositoryUrl('https://github.com/acme/site/tree/main')).toThrow(
      'repository root URL',
    );
  });
});

describe('project defaults', () => {
  it('uses credential-gated metadata for private repos and all members for public repos', () => {
    expect(defaultMetadataVisibility(true)).toBe('members_with_credentials');
    expect(defaultMetadataVisibility(false)).toBe('all_members');
  });

  it('normalizes empty and slash-wrapped path prefixes', () => {
    expect(normalizePathPrefix('')).toBe('src/content');
    expect(normalizePathPrefix('/content/blog/')).toBe('content/blog');
  });

  it('treats "." as an explicit repository-root convention', () => {
    expect(normalizePathPrefix('.')).toBe('');
    expect(normalizePathPrefix(' . ')).toBe('');
  });

  // These prefixes are interpolated into a GitHub contents API URL, where
  // `..` survives encodeURIComponent and is then resolved away by URL
  // parsing — retargeting the write at another repository.
  it('strips traversal segments from path prefixes', () => {
    expect(normalizePathPrefix('../../../etc')).toBe('etc');
    expect(normalizePathPrefix('src/../content')).toBe('src/content');
    expect(normalizePathPrefix('../..')).toBe('src/content');
  });

  it('strips traversal segments from image upload paths', () => {
    expect(normalizeImageUploadPath('../../../../repos/attacker/evil/contents')).toBe(
      'repos/attacker/evil/contents',
    );
    expect(normalizeImageUploadPath('public/../images')).toBe('public/images');
    expect(normalizeImageUploadPath('..')).toBe('public/images');
    expect(normalizeImageUploadPath('public//images')).toBe('public/images');
  });

  it('accepts jekyll as a supported SSG type', () => {
    expect(
      projectInputDefaults({
        branch: '',
        pathPrefix: '.',
        ssgType: 'jekyll',
        metadataVisibility: '',
        isPrivate: false,
      }),
    ).toEqual({
      branch: 'main',
      pathPrefix: '',
      ssgType: 'jekyll',
      metadataVisibility: 'all_members',
    });
  });

  it('normalizes create and update input defaults', () => {
    expect(
      projectInputDefaults({
        branch: '',
        pathPrefix: '',
        ssgType: '',
        metadataVisibility: '',
        isPrivate: true,
      }),
    ).toEqual({
      branch: 'main',
      pathPrefix: 'src/content',
      ssgType: 'astro',
      metadataVisibility: 'members_with_credentials',
    });
  });

  it('rejects unsupported SSG and metadata values', () => {
    expect(() =>
      projectInputDefaults({
        ssgType: 'hugo',
        metadataVisibility: '',
        isPrivate: false,
      }),
    ).toThrow('Unsupported SSG type');
    expect(() =>
      projectInputDefaults({
        ssgType: 'astro',
        metadataVisibility: 'public',
        isPrivate: false,
      }),
    ).toThrow('Unsupported metadata visibility');
  });
});

describe('project roles', () => {
  it('orders owner, editor, and viewer permissions', () => {
    expect(hasProjectRole('owner', 'viewer')).toBe(true);
    expect(hasProjectRole('editor', 'viewer')).toBe(true);
    expect(hasProjectRole('viewer', 'editor')).toBe(false);
    expect(canEditProject('editor')).toBe(true);
    expect(canEditProject('viewer')).toBe(false);
    expect(canManageProject('owner')).toBe(true);
    expect(canManageProject('editor')).toBe(false);
  });

  it('throws when a role cannot satisfy the required permission', () => {
    expect(() => assertProjectRole('viewer', 'owner')).toThrow('Not authorized');
    expect(() => assertProjectRole('owner', 'owner')).not.toThrow();
  });
});
