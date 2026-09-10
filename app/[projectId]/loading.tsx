import { PageContainer, Spinner } from '@sovereignfs/ui';
import styles from '../loading.module.css';

/**
 * Covers the project overview, settings, and editor screens — all three
 * fetch project data server-side and all three use `PageContainer
 * maxWidth="lg"`, so this matches their width to avoid a layout jump.
 */
export default function PlainwriteProjectLoading() {
  return (
    <PageContainer maxWidth="lg">
      <div className={styles.root} role="status" aria-live="polite">
        <Spinner />
        <span>Loading…</span>
      </div>
    </PageContainer>
  );
}
