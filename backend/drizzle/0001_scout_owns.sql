-- The ownership predicate every row-level security policy in this database
-- calls. Written by hand: drizzle-kit does not generate functions.
--
-- It lives in its own migration, ahead of the one that creates the policies,
-- so that regenerating the schema migration cannot drop it. Do not fold it
-- into a generated file.
--
-- Tenancy is keyed on user_id today. Roommates -- a shared search with several
-- members -- will change the predicate to a membership lookup. Routing every
-- policy through this function makes that a new migration containing one
-- CREATE OR REPLACE, rather than a rewrite of every policy in the schema and
-- the frontend queries sitting behind them.
--
-- `search_path = ''` forces fully-qualified names inside the body, so a table
-- planted in a caller-controlled schema cannot shadow anything it reads.
-- `security invoker` keeps it running as the caller. The scalar subquery around
-- auth.uid() lets Postgres hoist it to an initPlan instead of re-evaluating it
-- once per row.
create or replace function public.scout_owns(owner_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select owner_id = (select auth.uid()) $$;
