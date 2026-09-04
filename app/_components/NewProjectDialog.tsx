'use client';

import { useRef, useState } from 'react';
import { Button, Checkbox, Dialog, FormField, Input, Select, Textarea } from '@sovereignfs/ui';
import { createProject, detectRepository, type RepositoryDetectionResult } from '../_lib/actions';
import { ConfirmDialog } from './ConfirmDialog';
import { SubmitButton } from './SubmitButton';
import styles from './NewProjectDialog.module.css';

function humanizeRepoName(slug: string) {
  const words = slug.split(/[-_]+/).filter(Boolean);
  if (words.length === 0) return slug;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

type WizardStep = 'detect' | 'confirm';

/**
 * "Connect a site" wizard — step 1 is an unauthenticated GitHub lookup
 * (detectRepository) that suggests branch/content-folder/name so a public
 * repo needs confirming rather than typing from scratch. A private repo (or
 * any lookup failure) falls back to the same manual fields this dialog
 * always had — connecting access happens afterward in settings, since
 * credentials are stored per-project and there's no project row yet at
 * this point in the flow.
 */
export function NewProjectDialog() {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const [step, setStep] = useState<WizardStep>('detect');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [detection, setDetection] = useState<RepositoryDetectionResult | null>(null);

  const [name, setName] = useState('');
  const [branch, setBranch] = useState('main');
  const [pathPrefix, setPathPrefix] = useState('src/content');
  const [isPrivate, setIsPrivate] = useState(false);

  function resetAndClose() {
    formRef.current?.reset();
    setStep('detect');
    setRepositoryUrl('');
    setDetecting(false);
    setDetection(null);
    setName('');
    setBranch('main');
    setPathPrefix('src/content');
    setIsPrivate(false);
    setDirty(false);
    setDiscardConfirmOpen(false);
    setOpen(false);
  }

  // Dialog focuses the first form field on open, so without a dirty check
  // Esc/scrim-click would need to fight past "is focus inside the form" —
  // that used to just silently swallow the dismissal instead. Now: close
  // immediately when nothing's been entered, confirm before discarding
  // entered input otherwise.
  function handleDismissRequest() {
    if (!dirty) {
      resetAndClose();
      return;
    }
    setDiscardConfirmOpen(true);
  }

  async function runDetection() {
    setDetecting(true);
    setDetection(null);
    try {
      const result = await detectRepository(repositoryUrl);
      setDetection(result);
      if (result.ok) {
        setName(humanizeRepoName(result.name));
        setBranch(result.branch);
        setPathPrefix(result.pathPrefix);
        setStep('confirm');
      }
    } finally {
      setDetecting(false);
    }
  }

  function proceedManually() {
    setStep('confirm');
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        + Connect a site
      </Button>
      <Dialog open={open} onClose={handleDismissRequest} size="md" title="Connect a site">
        {step === 'detect' ? (
          <div className={styles.form}>
            <div className={styles.header}>
              <h2>Where does your site live?</h2>
              <p>
                Paste the GitHub address of your site&apos;s code. We&apos;ll look inside and
                suggest the rest.
              </p>
            </div>
            <FormField
              label="Site address"
              required
              hint="Supports GitHub HTTPS and SSH repository URLs."
            >
              {(field) => (
                <Input
                  {...field}
                  required
                  placeholder="https://github.com/acme/site"
                  value={repositoryUrl}
                  onChange={(event) => {
                    setRepositoryUrl(event.currentTarget.value);
                    setDetection(null);
                    setDirty(true);
                  }}
                />
              )}
            </FormField>
            {detection && !detection.ok ? (
              <p className={styles.feedbackError} role="status" aria-live="polite">
                {detection.error}
              </p>
            ) : null}
            <div className={styles.actions}>
              <Button type="button" variant="secondary" onClick={handleDismissRequest}>
                Cancel
              </Button>
              {detection && !detection.ok ? (
                <Button type="button" variant="secondary" onClick={proceedManually}>
                  Continue manually
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={!repositoryUrl.trim() || detecting}
                onClick={runDetection}
              >
                {detecting ? 'Looking…' : 'Continue'}
              </Button>
            </div>
          </div>
        ) : (
          <form
            ref={formRef}
            action={createProject}
            className={styles.form}
            onChange={() => setDirty(true)}
          >
            <div className={styles.header}>
              <h2>Confirm your site&apos;s details</h2>
              {detection?.ok ? (
                <p className={styles.detectionNote}>
                  Found it — {detection.postCount} post{detection.postCount === 1 ? '' : 's'} in{' '}
                  <code>{detection.pathPrefix}</code>. We&apos;ve filled these in; change anything
                  you need to.
                </p>
              ) : (
                <p>
                  Point Plainwrite at the GitHub repository that stores your site&apos;s content.
                </p>
              )}
            </div>
            <input type="hidden" name="repositoryUrl" value={repositoryUrl} />
            <FormField label="Site name" required>
              {(field) => (
                <Input
                  {...field}
                  name="name"
                  required
                  placeholder="Company blog"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
              )}
            </FormField>
            <FormField label="Description">
              {(field) => (
                <Textarea
                  {...field}
                  name="description"
                  rows={3}
                  placeholder="Internal notes for this content project"
                />
              )}
            </FormField>
            <h3 className={styles.sectionTitle}>Where your content lives</h3>
            <div className={styles.grid}>
              <FormField label="Branch">
                {(field) => (
                  <Input
                    {...field}
                    name="branch"
                    value={branch}
                    onChange={(event) => setBranch(event.currentTarget.value)}
                  />
                )}
              </FormField>
              <FormField
                label="Content folder"
                hint="Use . if your posts live at the repository root."
              >
                {(field) => (
                  <Input
                    {...field}
                    name="pathPrefix"
                    value={pathPrefix}
                    onChange={(event) => setPathPrefix(event.currentTarget.value)}
                  />
                )}
              </FormField>
            </div>
            <FormField label="Static site generator">
              {(field) => (
                <Select {...field} name="ssgType" defaultValue="astro">
                  <option value="astro">Astro</option>
                  <option value="jekyll">Jekyll</option>
                </Select>
              )}
            </FormField>
            <FormField
              label="Who can see this info"
              hint="Private sites default to people with publishing access."
            >
              {(field) => (
                <Select {...field} name="metadataVisibility" defaultValue="">
                  <option value="">Default based on privacy</option>
                  <option value="members_with_credentials">People with publishing access</option>
                  <option value="all_members">Everyone with access</option>
                </Select>
              )}
            </FormField>
            <Checkbox
              name="isPrivate"
              checked={isPrivate}
              onChange={setIsPrivate}
              label="Private site"
            />
            <div className={styles.actions}>
              <Button type="button" variant="secondary" onClick={() => setStep('detect')}>
                Back
              </Button>
              <Button type="button" variant="secondary" onClick={handleDismissRequest}>
                Cancel
              </Button>
              <SubmitButton>Connect site</SubmitButton>
            </div>
          </form>
        )}
      </Dialog>
      <ConfirmDialog
        open={discardConfirmOpen}
        title="Discard this site?"
        message="The details you've entered will be lost."
        confirmLabel="Discard"
        onCancel={() => setDiscardConfirmOpen(false)}
        onConfirm={resetAndClose}
      />
    </>
  );
}
