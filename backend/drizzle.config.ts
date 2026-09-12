import {defineConfig} from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  // Supabase owns the `auth` schema and the `anon`/`authenticated`/`service_role`
  // roles. Without these two settings drizzle-kit treats them as ours and tries
  // to create — or worse, drop — them.
  schemaFilter: ['public'],
  entities: {
    roles: {provider: 'supabase'},
  },
});
