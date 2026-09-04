'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button, FormField, Input, Select } from '@sovereignfs/ui';
import type { DirectoryUser } from '@sovereignfs/sdk';
import type { ActionResult } from '../_lib/actions';
import { searchProjectDirectoryUsers } from '../_lib/actions';
import styles from '../[projectId]/settings/settings.module.css';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

/**
 * Replaces a raw "paste a user ID" text field — nobody knows their own
 * internal user id — with a name/email typeahead backed by
 * `sdk.directory.searchUsers`, resolving to an id only once a real
 * directory match is picked.
 */
export function InviteMemberForm({
  projectId,
  action,
}: {
  projectId: string;
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<DirectoryUser | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (selected || query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchProjectDirectoryUsers(projectId, query.trim())
        .then((users) => {
          if (!cancelled) setResults(users);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selected, projectId]);

  useEffect(() => {
    if (state?.ok) {
      setSelected(null);
      setQuery('');
      setResults([]);
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={styles.inlineForm}>
      <input type="hidden" name="userId" value={selected?.id ?? ''} />
      <FormField label="Person" hint={selected ? undefined : 'Search by name or email'}>
        {(field) => (
          <div className={styles.memberPicker}>
            <Input
              {...field}
              value={selected ? (selected.name ?? selected.email) : query}
              onChange={(event) => {
                setSelected(null);
                setQuery(event.currentTarget.value);
              }}
              placeholder="Search by name or email"
              autoComplete="off"
              disabled={pending}
            />
            {results.length > 0 && !selected ? (
              <ul className={styles.memberResults}>
                {results.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(user);
                        setResults([]);
                      }}
                    >
                      {user.name ?? user.email}
                      {user.name ? ` (${user.email})` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </FormField>
      <FormField label="Role">
        {(field) => (
          <Select {...field} name="role" defaultValue="viewer" disabled={pending}>
            <option value="viewer">Reader</option>
            <option value="editor">Writer</option>
            <option value="owner">Owner</option>
          </Select>
        )}
      </FormField>
      {state && !state.ok ? (
        <p className={styles.feedbackError} role="status" aria-live="polite">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={!selected || pending}>
        {pending ? 'Adding…' : 'Add person'}
      </Button>
    </form>
  );
}
