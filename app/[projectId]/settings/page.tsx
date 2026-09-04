import { notFound } from 'next/navigation';
import {
  Badge,
  Button,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
} from '@sovereignfs/ui';
import {
  archiveProject,
  connectGitHubPat,
  connectSharedGitHubPat,
  disconnectGitHubCredential,
  disconnectSharedGitHubCredential,
  getGitHubOAuthStatus,
  getProject,
  hardDeleteProject,
  inviteProjectMember,
  listCollectionSchemas,
  listPublishEvents,
  removeProjectMember,
  resetCollectionSchema,
  restoreProject,
  startGitHubOAuth,
  updateCollectionSchema,
  updateProjectSettings,
} from '../../_lib/actions';
import { formatProjectRole } from '../../_lib/copy';
import { canEditProject, canManageProject } from '../../_lib/project-rules';
import { BackLink } from '../../_components/BackLink';
import { FormCheckbox } from '../../_components/FormCheckbox';
import { InviteMemberForm } from '../../_components/InviteMemberForm';
import styles from './settings.module.css';

interface SettingsPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectSettingsPage({ params }: SettingsPageProps) {
  const { projectId } = await params;
  const [project, schemas, oauthStatus, publishEvents] = await Promise.all([
    getProject(projectId).catch(() => null),
    listCollectionSchemas(projectId).catch(() => []),
    getGitHubOAuthStatus(projectId).catch(() => null),
    listPublishEvents(projectId).catch(() => []),
  ]);
  if (!project) notFound();
  const userCanEdit = canEditProject(project.currentUserRole);
  const userCanManage = canManageProject(project.currentUserRole);

  return (
    <PageContainer maxWidth="lg" className={styles.page}>
      <BackLink href={`/plainwrite/${projectId}`}>Back to posts</BackLink>
      <PageHeader
        title="Site settings"
        description={`People and site settings for ${project.name}.`}
        action={
          <Badge variant="status" status={userCanManage ? 'active' : 'neutral'}>
            {formatProjectRole(project.currentUserRole)}
          </Badge>
        }
      />

      <section className={styles.panel} aria-labelledby="repository-settings">
        <h2 id="repository-settings">Where your site lives</h2>
        <form action={updateProjectSettings.bind(null, project.id)} className={styles.form}>
          <FormField label="Name">
            {(field) => (
              <Input
                {...field}
                name="name"
                required
                defaultValue={project.name}
                disabled={!userCanManage}
              />
            )}
          </FormField>
          <FormField label="Description">
            {(field) => (
              <Textarea
                {...field}
                name="description"
                rows={2}
                defaultValue={project.description ?? ''}
                disabled={!userCanManage}
              />
            )}
          </FormField>
          <div className={styles.grid}>
            <FormField label="Branch">
              {(field) => (
                <Input {...field} name="branch" defaultValue={project.branch} disabled={!userCanManage} />
              )}
            </FormField>
            <FormField label="Path prefix" hint="Use . if your posts live at the repository root.">
              {(field) => (
                <Input
                  {...field}
                  name="pathPrefix"
                  defaultValue={project.pathPrefix}
                  disabled={!userCanManage}
                />
              )}
            </FormField>
            <FormField label="SSG">
              {(field) => (
                <Select {...field} name="ssgType" defaultValue={project.ssgType} disabled={!userCanManage}>
                  <option value="astro">Astro</option>
                  <option value="jekyll">Jekyll</option>
                </Select>
              )}
            </FormField>
            <FormField label="Image upload path" hint="Where uploaded images are committed in your repo.">
              {(field) => (
                <Input
                  {...field}
                  name="imageUploadPath"
                  defaultValue={project.imageUploadPath}
                  disabled={!userCanManage}
                />
              )}
            </FormField>
            <FormField label="Who can see this info">
              {(field) => (
                <Select
                  {...field}
                  name="metadataVisibility"
                  defaultValue={project.metadataVisibility}
                  disabled={!userCanManage}
                >
                  <option value="members_with_credentials">People with publishing access</option>
                  <option value="all_members">Everyone with access</option>
                </Select>
              )}
            </FormField>
          </div>
          <FormCheckbox
            name="isPrivate"
            defaultChecked={project.isPrivate}
            disabled={!userCanManage}
            label="Private site"
          />
          {userCanManage ? <Button type="submit">Save settings</Button> : null}
        </form>
      </section>

      <section className={styles.panel} aria-labelledby="github-credential">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="github-credential">Publishing access</h2>
            <p className={styles.panelDescription}>
              Connect access so Plainwrite can publish to your site.
            </p>
          </div>
          <StatusBadge status={project.credential?.status === 'connected' ? 'synced' : 'warning'}>
            {project.credential?.status === 'connected' ? 'Connected' : 'Not connected'}
          </StatusBadge>
        </div>

        {!project.credential && project.activeCredentialSource === 'shared' ? (
          <p className={styles.helpText}>
            You&apos;re publishing using {project.sharedCredential?.createdByDisplayName ?? 'the site owner'}
            &apos;s shared connection below — you don&apos;t need to connect your own token unless you want
            publishes to show up as you on GitHub.
          </p>
        ) : null}

        {project.credential ? (
          <dl className={styles.credentialDetails}>
            <div>
              <dt>Provider</dt>
              <dd>GitHub</dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>{project.credential.providerLogin ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Auth type</dt>
              <dd>{project.credential.authType.toUpperCase()}</dd>
            </div>
            <div>
              <dt>Connection</dt>
              <dd>{project.credential.connectionId ? 'Platform-managed' : 'Plainwrite token'}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatTimestamp(project.credential.updatedAt)}</dd>
            </div>
          </dl>
        ) : null}

        {project.credential?.lastError ? (
          <p className={styles.errorText}>{project.credential.lastError}</p>
        ) : null}

        {userCanEdit ? (
          <div className={styles.credentialForms}>
            {oauthStatus?.configured ? (
              <form action={startGitHubOAuth.bind(null, project.id)} className={styles.form}>
                <p className={styles.helpText}>
                  GitHub OAuth is configured for this instance. Authorization opens GitHub and
                  stores the returned token in the platform secret vault.
                </p>
                <Button type="submit">
                  {project.credential?.authType === 'oauth' ? 'Reconnect GitHub' : 'Connect GitHub'}
                </Button>
              </form>
            ) : (
              <p className={styles.helpText}>
                GitHub OAuth is not configured for this instance. PAT fallback remains available.
              </p>
            )}

            <form action={connectGitHubPat.bind(null, project.id)} className={styles.form}>
              <FormField label="Personal access token">
                {(field) => (
                  <Input
                    {...field}
                    name="token"
                    type="password"
                    required
                    autoComplete="off"
                    placeholder="github_pat_..."
                  />
                )}
              </FormField>
              <p className={styles.helpText}>
                Use a fine-grained token with contents read/write access for
                {` ${project.repoOwner}/${project.repoName}`}. The token is stored in the platform
                secret vault and is never saved in Plainwrite tables.
              </p>
              <Button type="submit">
                {project.credential?.status === 'connected'
                  ? 'Reconnect using a token'
                  : 'Connect using a token'}
              </Button>
            </form>

            {project.credential?.status === 'connected' ? (
              <form action={disconnectGitHubCredential.bind(null, project.id)}>
                <Button type="submit" variant="secondary">
                  Disconnect
                </Button>
              </form>
            ) : null}
          </div>
        ) : (
          <p className={styles.helpText}>Readers can&apos;t connect publishing access.</p>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="shared-credential">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="shared-credential">Shared connection</h2>
            <p className={styles.panelDescription}>
              Let everyone on this site publish without connecting their own GitHub token —
              handy for people who don&apos;t use GitHub day to day.
            </p>
          </div>
          <StatusBadge status={project.sharedCredential?.status === 'connected' ? 'synced' : 'warning'}>
            {project.sharedCredential?.status === 'connected' ? 'On' : 'Off'}
          </StatusBadge>
        </div>

        {project.sharedCredential ? (
          <dl className={styles.credentialDetails}>
            <div>
              <dt>Connected by</dt>
              <dd>{project.sharedCredential.createdByDisplayName ?? project.sharedCredential.createdByUserId}</dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>{project.sharedCredential.providerLogin ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatTimestamp(project.sharedCredential.updatedAt)}</dd>
            </div>
          </dl>
        ) : null}

        {project.sharedCredential?.lastError ? (
          <p className={styles.errorText}>{project.sharedCredential.lastError}</p>
        ) : null}

        {userCanManage ? (
          <div className={styles.credentialForms}>
            <p className={styles.helpText}>
              Posts published this way are committed under <strong>your</strong> GitHub account, no matter
              who in Plainwrite actually clicked publish — so only turn this on with a token you&apos;re
              comfortable sharing that way. Anyone can still connect their own token instead, under
              Publishing access above.
            </p>
            <form action={connectSharedGitHubPat.bind(null, project.id)} className={styles.form}>
              <FormField label="Personal access token to share">
                {(field) => (
                  <Input
                    {...field}
                    name="token"
                    type="password"
                    required
                    autoComplete="off"
                    placeholder="github_pat_..."
                  />
                )}
              </FormField>
              <Button type="submit">
                {project.sharedCredential?.status === 'connected'
                  ? 'Reconnect shared token'
                  : 'Turn on shared connection'}
              </Button>
            </form>
            {project.sharedCredential?.status === 'connected' ? (
              <form action={disconnectSharedGitHubCredential.bind(null, project.id)}>
                <Button type="submit" variant="secondary">
                  Turn off shared connection
                </Button>
              </form>
            ) : null}
          </div>
        ) : (
          <p className={styles.helpText}>Only owners can turn the shared connection on or off.</p>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="collection-schemas">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="collection-schemas">Content fields</h2>
            <p className={styles.panelDescription}>
              Fields detected in your posts — owners can edit them.
            </p>
          </div>
          <StatusBadge status={schemas.length > 0 ? 'synced' : 'warning'}>
            {schemas.length > 0 ? `${schemas.length} sections` : 'Not detected yet'}
          </StatusBadge>
        </div>

        {schemas.length > 0 ? (
          <div className={styles.schemaList}>
            {schemas.map((schema) => (
              <form
                key={schema.collection}
                action={updateCollectionSchema.bind(null, project.id, schema.collection)}
                className={styles.schemaCard}
              >
                <div className={styles.panelHeader}>
                  <div>
                    <h3>{schema.collection}</h3>
                    <p className={styles.panelDescription}>
                      {schema.isManual ? 'Set manually' : 'Detected automatically'}
                    </p>
                  </div>
                  {userCanManage ? (
                    <Button
                      type="submit"
                      formAction={resetCollectionSchema.bind(null, project.id, schema.collection)}
                      variant="secondary"
                    >
                      Reset
                    </Button>
                  ) : null}
                </div>
                <div className={styles.schemaFields}>
                  {[...schema.fields, { name: '', type: 'string' as const, required: false }].map(
                    (field, index) => (
                      <div key={`${schema.collection}-${index}`} className={styles.schemaField}>
                        <FormField label="Name">
                          {(fieldProps) => (
                            <Input
                              {...fieldProps}
                              name="fieldName"
                              defaultValue={field.name}
                              disabled={!userCanManage}
                            />
                          )}
                        </FormField>
                        <FormField label="Type">
                          {(fieldProps) => (
                            <Select
                              {...fieldProps}
                              name="fieldType"
                              defaultValue={field.type}
                              disabled={!userCanManage}
                            >
                              <option value="string">Text</option>
                              <option value="date">Date</option>
                              <option value="number">Number</option>
                              <option value="boolean">Toggle</option>
                              <option value="array">Tags</option>
                            </Select>
                          )}
                        </FormField>
                        <FormCheckbox
                          name="fieldRequired"
                          value={String(index)}
                          defaultChecked={field.required}
                          disabled={!userCanManage}
                          label="Required"
                        />
                      </div>
                    ),
                  )}
                </div>
                {userCanManage ? <Button type="submit">Save schema</Button> : null}
              </form>
            ))}
          </div>
        ) : (
          <p className={styles.helpText}>
            Check for site updates to detect fields from existing posts.
          </p>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="members">
        <div className={styles.panelHeader}>
          <h2 id="members">People</h2>
          <StatusBadge status="unmodified">{project.members.length} total</StatusBadge>
        </div>
        {project.directoryLookupFailed ? (
          <p className={styles.errorText}>
            Couldn&apos;t load names and emails right now. Showing IDs only.
          </p>
        ) : null}
        <div className={styles.members}>
          {project.members.map((member) => (
            <div key={member.userId} className={styles.member}>
              <div className={styles.memberIdentity}>
                <strong>{member.displayName ?? member.email ?? member.userId}</strong>
                <p>{member.email ?? member.userId}</p>
              </div>
              <StatusBadge status="unmodified">{formatProjectRole(member.role)}</StatusBadge>
              {userCanManage ? (
                <form action={removeProjectMember.bind(null, project.id, member.userId)}>
                  <Button type="submit">Remove</Button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
        {userCanManage ? (
          <InviteMemberForm projectId={project.id} action={inviteProjectMember.bind(null, project.id)} />
        ) : null}
      </section>

      <section className={styles.panel} aria-labelledby="publish-history">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="publish-history">Publish history</h2>
            <p className={styles.panelDescription}>Recent times posts went live on your site.</p>
          </div>
          <StatusBadge status={publishEvents.length > 0 ? 'synced' : 'unmodified'}>
            {publishEvents.length > 0 ? `${publishEvents.length} recent` : 'No history yet'}
          </StatusBadge>
        </div>
        {publishEvents.length > 0 ? (
          <div className={styles.eventList}>
            {publishEvents.map((event) => (
              <article key={event.id} className={styles.eventRow}>
                <div>
                  <h3>{event.message}</h3>
                  <p>{event.files.join(', ') || 'No posts recorded'}</p>
                  {event.errorSummary ? <p>{event.errorSummary}</p> : null}
                </div>
                <div className={styles.eventMeta}>
                  <StatusBadge status={event.status === 'success' ? 'synced' : 'error'}>
                    {event.status === 'success' ? 'Live' : event.errorCode || 'Failed'}
                  </StatusBadge>
                  <span>{formatTimestamp(event.createdAt)}</span>
                  {event.commitSha ? <code>{event.commitSha.slice(0, 7)}</code> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.helpText}>Publish a ready post to see history here.</p>
        )}
      </section>

      {userCanManage ? (
        <section className={styles.panel} aria-labelledby="danger-zone">
          <h2 id="danger-zone">Site status</h2>
          <div className={styles.actions}>
            {project.archivedAt ? (
              <form action={restoreProject.bind(null, project.id)}>
                <Button type="submit">Restore site</Button>
              </form>
            ) : (
              <form action={archiveProject.bind(null, project.id)}>
                <Button type="submit">Archive site</Button>
              </form>
            )}
            <form action={hardDeleteProject.bind(null, project.id)} className={styles.deleteForm}>
              <FormField label="Type DELETE to permanently delete">
                {(field) => <Input {...field} name="confirm" />}
              </FormField>
              <Button type="submit">Delete permanently</Button>
            </form>
          </div>
        </section>
      ) : null}
    </PageContainer>
  );
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value * 1000));
}
