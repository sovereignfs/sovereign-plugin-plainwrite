import type { ProjectRole } from './project-rules';

/**
 * Plain-language translations for internal/git vocabulary — the jargon
 * table in docs/adhoc/plainwrite-ui-redesign.md §3. Centralized here so the
 * mapping stays consistent across the dashboard, editor, and settings
 * screens instead of drifting per-file. These only change what's displayed;
 * the underlying stored values (role strings, status strings, visibility
 * enum) are unchanged.
 */

const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: 'Owner',
  editor: 'Writer',
  viewer: 'Reader',
};

export function formatProjectRole(role: ProjectRole | string): string {
  return ROLE_LABELS[role as ProjectRole] ?? role;
}

export function formatMetadataVisibility(value: string): string {
  if (value === 'members_with_credentials') return 'People with publishing access';
  if (value === 'all_members') return 'Everyone with access';
  return value;
}

export function formatPostStatus(status: string): string {
  if (status === 'unmodified') return 'Live on site';
  if (status === 'draft') return 'Writing';
  if (status === 'committed') return 'Ready to publish';
  if (status === 'pending-delete') return 'Removing on next publish';
  if (status === 'conflict') return 'Needs review';
  return status;
}

/** One-line pipeline summary for a site card, e.g. "2 writing · 1 ready · 12 live". */
const SSG_LABELS: Record<string, string> = {
  astro: 'Astro',
  jekyll: 'Jekyll',
  custom: 'Custom',
};

export function formatSsgType(ssgType: string): string {
  return SSG_LABELS[ssgType] ?? ssgType;
}

export function formatPipelineSummary(counts: {
  writingCount: number;
  readyCount: number;
  liveCount: number;
}): string {
  const parts: string[] = [];
  if (counts.writingCount > 0) parts.push(`${counts.writingCount} writing`);
  if (counts.readyCount > 0) parts.push(`${counts.readyCount} ready`);
  if (counts.liveCount > 0) parts.push(`${counts.liveCount} live`);
  return parts.length > 0 ? parts.join(' · ') : 'No posts yet';
}
