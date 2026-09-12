import {sql, type SQL} from 'drizzle-orm';
import type {AnyPgColumn} from 'drizzle-orm/pg-core';

/**
 * Every tenant policy routes its ownership test through one SQL function,
 * `scout_owns(uuid)`, defined in the migration rather than here.
 *
 * The indirection is deliberate. Tenancy is keyed on `user_id` today, but
 * roommates (a shared search with several members) are a planned change. When
 * that lands, the predicate becomes a membership lookup — and routing through
 * a function means redefining one function instead of rewriting every policy
 * on every table, invalidating frontend queries as it goes.
 *
 * The function wraps `auth.uid()` in a scalar subquery so Postgres caches it
 * as an initPlan instead of re-evaluating it per row.
 */
export function ownedBy(userIdColumn: AnyPgColumn): SQL {
  return sql`scout_owns(${userIdColumn})`;
}

/**
 * The function's definition, kept beside the helper that calls it.
 *
 * drizzle-kit does not generate functions, so this is applied by hand at the
 * top of the migration that first creates the policies — they reference it, so
 * it has to exist before they are created. Reproduced here so the definition
 * lives with the code that depends on it, and so `schema.test.ts` can assert
 * the migration still contains it.
 */
export const SCOUT_OWNS_FUNCTION = `create or replace function public.scout_owns(owner_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select owner_id = (select auth.uid()) $$;`;
