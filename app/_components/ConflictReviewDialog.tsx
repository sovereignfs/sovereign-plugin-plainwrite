'use client';

import { useActionState, useEffect, useState } from 'react';
import { Button, Dialog } from '@sovereignfs/ui';
import { getConflictComparison, type ActionResult } from '../_lib/actions';
import { diffParagraphs } from '../_lib/conflict-rules';
import { parseMarkdownDocument } from '../_lib/editor-rules';
import styles from './ConflictReviewDialog.module.css';

type PublishResult = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface ConflictReviewDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  path: string;
  discardAction: () => void | Promise<void>;
  refreshBaseAction: PublishResult;
  forcePublishAction: PublishResult;
}

/**
 * The "Review changes" destination for a publish conflict — shows the
 * writer's local draft next to what's currently on the site, with the
 * paragraphs that differ highlighted (see conflict-rules.ts for why the
 * diff is intentionally crude), and three actions mapped to real
 * operations: discard, refresh-and-keep-editing, or force-publish.
 */
export function ConflictReviewDialog({
  open,
  onClose,
  projectId,
  path,
  discardAction,
  refreshBaseAction,
  forcePublishAction,
}: ConflictReviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{
    localContent: string;
    remoteContent: string | null;
    remoteMissing: boolean;
  } | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const [refreshState, refreshFormAction, refreshPending] = useActionState<
    ActionResult | null,
    FormData
  >(refreshBaseAction, null);
  const [forceState, forceFormAction, forcePending] = useActionState<ActionResult | null, FormData>(
    forcePublishAction,
    null,
  );

  useEffect(() => {
    if (!open) {
      setComparison(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getConflictComparison(projectId, path)
      .then((result) => {
        if (!cancelled) setComparison(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Couldn't load the site's version.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, path]);

  useEffect(() => {
    if (refreshState?.ok || forceState?.ok) onClose();
  }, [refreshState, forceState, onClose]);

  const localDocument = comparison ? parseMarkdownDocument(comparison.localContent) : null;
  const remoteDocument = comparison?.remoteContent
    ? parseMarkdownDocument(comparison.remoteContent)
    : null;
  const diff =
    comparison && !comparison.remoteMissing
      ? diffParagraphs(localDocument?.body ?? '', remoteDocument?.body ?? '')
      : null;
  const changedCount = diff?.local.filter((p) => p.changed).length ?? 0;
  // A conflict is a whole-file mismatch, but the two columns below only
  // compare body paragraphs. Without this, a remote edit that touched only
  // the post's details showed "no differences" — reading as safe to
  // overwrite — and "Publish mine anyway" then discarded it silently.
  const detailsDiffer =
    diff !== null && localDocument?.frontmatterYaml !== remoteDocument?.frontmatterYaml;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="This post changed on your site while you were editing"
    >
      <div className={styles.body}>
        {loading ? <p className={styles.hint}>Loading the site&apos;s current version…</p> : null}
        {loadError ? (
          <p className={styles.feedbackError} role="status" aria-live="polite">
            {loadError}
          </p>
        ) : null}

        {comparison?.remoteMissing ? (
          <p className={styles.hint}>
            This post was removed from the site since you started editing.
          </p>
        ) : null}

        {diff ? (
          <>
            <div className={styles.columns}>
              <div className={styles.column}>
                <p className={styles.columnLabel}>Version on the site · newer</p>
                {diff.remote.map((paragraph, index) => (
                  <p
                    key={index}
                    className={paragraph.changed ? styles.paragraphChanged : styles.paragraph}
                  >
                    {paragraph.text}
                  </p>
                ))}
              </div>
              <div className={styles.column}>
                <p className={styles.columnLabel}>Your version · draft</p>
                {diff.local.map((paragraph, index) => (
                  <p
                    key={index}
                    className={paragraph.changed ? styles.paragraphChanged : styles.paragraph}
                  >
                    {paragraph.text}
                  </p>
                ))}
              </div>
            </div>
            <p className={styles.hint}>
              {changedCount > 0
                ? `${changedCount} ${changedCount === 1 ? 'paragraph differs' : 'paragraphs differ'} in the writing above.`
                : 'The writing above is the same in both versions.'}
            </p>
            {detailsDiffer ? (
              <p className={styles.hint}>
                The post&apos;s details (title, date, tags and so on) also differ between the two
                versions. Those aren&apos;t shown side by side above — publishing yours will replace
                the site&apos;s.
              </p>
            ) : null}
          </>
        ) : null}

        {refreshState && !refreshState.ok ? (
          <p className={styles.feedbackError} role="status" aria-live="polite">
            {refreshState.error}
          </p>
        ) : null}
        {forceState && !forceState.ok ? (
          <p className={styles.feedbackError} role="status" aria-live="polite">
            {forceState.error}
          </p>
        ) : null}

        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            disabled={discarding}
            onClick={() => {
              setDiscarding(true);
              Promise.resolve(discardAction()).finally(() => {
                setDiscarding(false);
                onClose();
              });
            }}
          >
            {discarding ? 'Using the site…' : "Use the site's version"}
          </Button>
          <form action={refreshFormAction}>
            <Button type="submit" variant="secondary" disabled={refreshPending}>
              {refreshPending ? 'Updating…' : 'Keep editing mine'}
            </Button>
          </form>
          <form action={forceFormAction}>
            <input type="hidden" name="force" value="true" />
            <Button type="submit" disabled={forcePending}>
              {forcePending ? 'Publishing…' : 'Publish mine anyway'}
            </Button>
          </form>
        </div>
      </div>
    </Dialog>
  );
}
