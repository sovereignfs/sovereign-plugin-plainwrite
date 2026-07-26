# Plainwrite

Plainwrite is a Sovereign plugin for editing Markdown content in git-backed
static sites. The v0.1 foundation is complete: project management, project
membership, GitHub content sync, local draft editing with structured
frontmatter fields and autosave, single-file and publish-all GitHub
publishing, staged deletion, schema tools, GitHub OAuth, GitHub personal
access token storage through the Sovereign secret vault, and the platform
data contract, portability, notification, and activity integrations.

## Local development

To test this standalone checkout against the platform, clone or copy it into a
platform workspace as a local plugin checkout:

```bash
plugins/sovereign-plainwrite.local
```

Then run the platform generate/dev workflow from the platform repository:

```bash
pnpm generate
pnpm dev
```

The app is served at `/plainwrite` once composed by the platform.

## Current scope

Implemented now:

- Sovereign manifest with data contracts, external GitHub provider declaration,
  portability permissions, and `0.18.2` platform compatibility.
- Project CRUD, settings, archive/delete, and member roles.
- GitHub sync for Astro Markdown/MDX content under the configured path prefix,
  using anonymous reads for public repositories and the current user's connected
  OAuth or PAT credential for private repositories.
- Local editor workflow for opening remote content, creating new files, editing
  raw YAML frontmatter and Markdown body, previewing escaped Markdown, saving
  drafts, marking drafts ready to commit, publishing one committed file, and
  discarding drafts. Frontmatter can be edited as structured, schema-typed
  fields (with a raw YAML toggle) when the file's collection has a schema, and
  edits autosave after two seconds idle.
- GitHub OAuth connection UI backed by manifest-declared `sdk.connections`
  provider config, with PAT fallback when OAuth is not configured. Tokens are
  stored with `sdk.secrets`; Plainwrite stores only `connection_id`,
  `secret_ref`, provider, auth type, account login, status, and sanitized
  metadata.
- Single-file publish uses the current user's GitHub token, checks the remote
  blob SHA before writing, preserves committed drafts on conflict or provider
  failure, updates the local file cache after success, and records
  `plainwrite_publish_events` rows for both success and failure.
- Publish-all creates one GitHub commit for committed edits and staged
  deletions after conflict checks. Users can abort on conflicts or explicitly
  skip conflicted files.
- Collection schema inference samples synced files and gives owners editable
  schema controls with reset-to-inferred behavior.
- Three read-only data contracts (`plainwrite.projects`, `.content-index`,
  `.drafts`), export/import/delete portability participation, notifications
  on being added to a project and on publish, and activity records for
  project and publish events. See `roadmap.md`'s PLW-010 entry for the exact
  scope (e.g. content-index has no body snippets — Plainwrite never caches
  file bodies).

Not implemented yet:

- Pull-request publishing and structured conflict-resolution UI.

## Deployment requirements

Plainwrite stores connected GitHub credentials (both OAuth tokens and
personal access tokens) through the platform's plugin secret vault
(`sdk.secrets`), never in its own tables. That vault requires the platform
operator to set **`SOVEREIGN_VAULT_KEY`** (a 32-byte key, `openssl rand
-base64 32`) in the Sovereign instance's environment.

**Without it, connecting a site fails** at "Connect using a token" /
"Connect GitHub" with:

```
SOVEREIGN_VAULT_KEY is required before sdk.secrets can store or read secret values.
```

This surfaces as a runtime error on first use, not as a startup failure —
the instance boots and runs fine without `SOVEREIGN_VAULT_KEY` set; only the
credential-connect flow breaks, which makes it easy to miss until a user
hits it live. See the platform's `docs/self-hosting.md` (`SOVEREIGN_VAULT_KEY`
row) and `.env.example` for the full variable reference. If you're
self-hosting via `sovereign-infra`/`openfs-infra`, add `SOVEREIGN_VAULT_KEY`
to `apps/sovereign/.env` alongside `AUTH_SECRET`/`SOVEREIGN_ADMIN_KEY` before
your first deploy — **and check that infra repo's "Known sovereign compose
gaps" section**: as of platform `v0.19.3`, `SOVEREIGN_VAULT_KEY` is still
missing from `docker-compose.prod.yml`'s `environment:` block upstream, so
setting it in `.env` alone isn't enough yet — it needs the documented
compose patch/override too, until a platform release ships with the fix.

## GitHub credentials

Each user connects their own GitHub credential per project from **Project
settings → GitHub credential**. If the Sovereign instance has GitHub OAuth
provider config, Plainwrite starts the hosted OAuth flow through
`sdk.connections`. Otherwise, users can enter a fine-grained GitHub token scoped
to the selected repository:

- Contents read access is required for private repository sync.
- Contents write access is required for publishing committed drafts.

Plainwrite validates the credential against GitHub before storing it. The token
value is never persisted in Plainwrite tables, exported, or rendered back to the
client. Disconnecting a credential disconnects the platform connection or deletes
the platform vault secret, then marks the Plainwrite credential metadata as
disconnected without deleting project drafts.

### Shared connection

A project owner can optionally turn on a **shared connection** (**Project
settings → Shared connection**) — a single GitHub token any member of the
project can publish and sync with, without connecting their own. This is
aimed at non-technical writers who don't have (or want) a GitHub account of
their own. It's stored as a `scope: 'plugin'` `sdk.secrets` entry, readable by
any user of the Plainwrite plugin, separate from the per-user `scope: 'user'`
secrets behind personal credentials; only the project owner can turn it on,
rotate it, or turn it off.

A member's own connected credential always takes priority over the shared
one when both exist. Because a shared token is one GitHub identity, every
commit published through it — regardless of which Sovereign user clicked
Publish — shows up on GitHub under the connecting owner's account; the
settings page states this plainly before an owner turns it on. If the owner
who connected it is later removed from Sovereign, the shared connection is
automatically revoked rather than left dangling on a deleted account.
