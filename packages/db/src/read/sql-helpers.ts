import { sql, type SQL } from 'drizzle-orm';

/**
 * Bind a JS string array as a PG text[] for use in `ANY(...)` predicates.
 * Drizzle's `sql\`\`` template wraps a JS array in parens (`($1, $2, $3)`),
 * which is a row constructor, not an array. `sql.join` flattens to
 * `$1, $2, $3` and the surrounding `ARRAY[...]::text[]` makes it a real array.
 */
export function pgTextArray(values: string[]): SQL {
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}
