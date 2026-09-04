'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@sovereignfs/ui';

/**
 * A submit button that disables itself while its own form is submitting.
 *
 * For a form wired to a server action directly (`<form action={...}>`) rather
 * than through `useActionState`, `useFormStatus` is the only way to observe
 * pending state — and it only reports the status of the form it is rendered
 * inside, so this has to be its own component rather than a hook call in the
 * form's parent.
 *
 * Without it, an action that writes before redirecting (createProject inserts
 * a project and a membership row; createContentFile builds a path) can be
 * fired twice by an impatient double-click, creating duplicates.
 */
export function SubmitButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={disabled}>
      {children}
    </Button>
  );
}
