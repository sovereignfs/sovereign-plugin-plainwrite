import { PageContainer, Spinner } from '@sovereignfs/ui';
import styles from './loading.module.css';

/**
 * The home screen awaits `listProjects()` twice before it can render — this
 * matches its own `PageContainer maxWidth="full"` so the frame doesn't jump
 * once the real content arrives.
 */
export default function PlainwriteLoading() {
  return (
    <PageContainer maxWidth="full">
      <div className={styles.root} role="status" aria-live="polite">
        <Spinner />
        <span>Loading…</span>
      </div>
    </PageContainer>
  );
}
