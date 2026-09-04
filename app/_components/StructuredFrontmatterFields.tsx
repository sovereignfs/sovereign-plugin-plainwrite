'use client';

import { Checkbox, FormField, Input, TagInput } from '@sovereignfs/ui';
import type { CollectionSchemaField } from '../_lib/schema-rules';

interface StructuredFrontmatterFieldsProps {
  fields: CollectionSchemaField[];
  data: Record<string, unknown>;
  onFieldChange: (name: string, value: unknown) => void;
  disabled: boolean;
}

/**
 * Renders one form control per collection schema field, typed to match
 * CollectionSchemaField['type']. Fields not covered by the schema stay in
 * `data` untouched — this component only ever reads/writes the keys it
 * knows about, so unrecognized frontmatter round-trips unchanged.
 */
export function StructuredFrontmatterFields({
  fields,
  data,
  onFieldChange,
  disabled,
}: StructuredFrontmatterFieldsProps) {
  return (
    <>
      {fields.map((field) => (
        <FieldControl
          key={field.name}
          field={field}
          value={data[field.name]}
          onChange={(value) => onFieldChange(field.name, value)}
          disabled={disabled}
        />
      ))}
    </>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: CollectionSchemaField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}) {
  if (field.type === 'boolean') {
    return (
      <Checkbox
        label={field.name}
        checked={Boolean(value)}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  if (field.type === 'array') {
    const tags = Array.isArray(value) ? value.map(String) : [];
    return (
      <FormField label={field.name} required={field.required}>
        {(fieldProps) => (
          <TagInput {...fieldProps} value={tags} onChange={onChange} disabled={disabled} />
        )}
      </FormField>
    );
  }

  if (field.type === 'date') {
    return (
      <FormField label={field.name} required={field.required}>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="date"
            value={toDateInputValue(value)}
            onChange={(event) => onChange(fromDateInputValue(event.currentTarget.value))}
            disabled={disabled}
          />
        )}
      </FormField>
    );
  }

  if (field.type === 'number') {
    return (
      <FormField label={field.name} required={field.required}>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="number"
            value={typeof value === 'number' ? String(value) : ''}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              onChange(raw === '' ? undefined : Number(raw));
            }}
            disabled={disabled}
          />
        )}
      </FormField>
    );
  }

  return (
    <FormField label={field.name} required={field.required}>
      {(fieldProps) => (
        <Input
          {...fieldProps}
          type="text"
          value={typeof value === 'string' ? value : (value ?? '') === '' ? '' : String(value)}
          onChange={(event) => onChange(event.currentTarget.value)}
          disabled={disabled}
        />
      )}
    </FormField>
  );
}

// YAML timestamps parse to Date instances (js-yaml's !!timestamp tag);
// plain frontmatter strings stay strings. Either way the <input type="date">
// value must be a bare "YYYY-MM-DD".
//
// UTC throughout, deliberately: a date-only YAML scalar parses to UTC
// midnight, so reading the UTC calendar day round-trips it exactly. Reading
// the *local* day instead would shift the date by one for anyone west of
// UTC (2024-07-15T00:00:00Z renders as 2024-07-14 in UTC-5).
function toDateInputValue(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') return value.slice(0, 10);
  return '';
}

/**
 * Hands the picked day back as a UTC-midnight Date rather than a
 * "YYYY-MM-DD" string, so it serializes as an unquoted YAML timestamp
 * (`pubDate: 2024-07-15`) instead of a quoted string (`pubDate:
 * '2024-07-15'`). The quoted form changes the field's YAML *type* from
 * timestamp to string, which fails an SSG schema that expects a real date
 * (e.g. Astro's `z.date()`).
 *
 * Returning a Date rather than normalizing date-shaped strings at
 * serialization time also leaves a genuinely string-typed field whose value
 * merely looks like a date (`version: '2024-07-15'`) correctly quoted.
 */
function fromDateInputValue(raw: string): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
