// The browser's publishable key reaches Postgres as anon or authenticated through the Data API. Everything the app
// stores must stay closed to both (docs/PERMISSIONS.md "Database"); this checks every object, so a migration that
// forgets its RLS or revoke fails here whatever it adds. Local only: it reads the catalogs.
import { describe, expect, it } from 'vitest';
import { localSql } from '../setup/helpers';

const LEAKS = `
select 'table ' || c.oid::regclass::text as leak
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'p')
   and (not c.relrowsecurity
        or has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
        or has_table_privilege('authenticated', c.oid, 'select, insert, update, delete, truncate, references, trigger'))
union all
select 'function ' || p.oid::regprocedure::text
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
union all
-- pgmq's own functions are executable by PUBLIC; the closed schema is what keeps the browser out of them.
select 'schema ' || s
  from unnest(array['pgmq', 'cron']) as s
 where has_schema_privilege('anon', s, 'usage') or has_schema_privilege('authenticated', s, 'usage')
`;

describe('database lockdown', () => {
  it('no table, function or queue schema is open to anon or authenticated, and every table has RLS on', () => {
    expect(localSql<{ leak: string }>(LEAKS)).toEqual([]);
  });
});
