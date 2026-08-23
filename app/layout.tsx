import type { ReactNode } from 'react';
import { registerDataContracts } from './_lib/data-contracts';
import { registerPortabilityHandlers } from './_lib/portability';
import styles from './layout.module.css';

export default async function PlainwriteLayout({ children }: { children: ReactNode }) {
  // Both registries are in-process and reset on restart — the platform SDK
  // requires re-registering from a request-scoped plugin route, so this runs
  // on every request to any Plainwrite page. Never let a registration
  // failure take down the whole plugin shell.
  try {
    registerDataContracts();
    await registerPortabilityHandlers();
  } catch {
    // Data contracts / portability are best-effort platform integrations —
    // a registration failure here must not block Plainwrite's own UI.
  }

  // No plugin-local sidebar: the runtime shell already provides the top-level
  // app rail, and per-screen back navigation is a plain breadcrumb (BackLink)
  // rather than a persistent second side rail. The shell applies no gutter of
  // its own (task 9.25) — each page wraps itself in @sovereignfs/ui's
  // PageContainer for its own padding/max-width, since pages need different
  // widths (the home screen is full-bleed, project/settings/editor screens
  // are narrower reading columns).
  return <main className={styles.content}>{children}</main>;
}
