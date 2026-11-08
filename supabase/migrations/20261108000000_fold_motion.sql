-- FOLD Motion: projects, brand kits and films, private to each signed-in user.
--
-- Run once in the Supabase dashboard: SQL Editor > New query > paste > Run.
-- Safe to run again: everything is created only if it doesn't exist yet.
--
-- Privacy is enforced by Postgres itself (row level security): a signed-in user
-- can only read and write their own rows, and only files inside their own folder
-- (the first folder of every path is their user id). The FOLD Motion server uses
-- a secret key, which bypasses these rules, and checks ownership in code instead.

-- ------------------------------------------------------------------ projects
create table if not exists public.projects (
  id text primary key,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_owner_updated on public.projects (owner, updated_at desc);
alter table public.projects enable row level security;

drop policy if exists "projects: read own" on public.projects;
create policy "projects: read own" on public.projects for select to authenticated using (owner = (select auth.uid()));
drop policy if exists "projects: insert own" on public.projects;
create policy "projects: insert own" on public.projects for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists "projects: update own" on public.projects;
create policy "projects: update own" on public.projects for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists "projects: delete own" on public.projects;
create policy "projects: delete own" on public.projects for delete to authenticated using (owner = (select auth.uid()));

-- ------------------------------------------------------------------ brand kits
-- One per user: the logo and product photos (files live in the brand-assets bucket).
create table if not exists public.brand_kits (
  owner uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  logo jsonb,
  products jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.brand_kits enable row level security;

drop policy if exists "brand kits: read own" on public.brand_kits;
create policy "brand kits: read own" on public.brand_kits for select to authenticated using (owner = (select auth.uid()));
drop policy if exists "brand kits: insert own" on public.brand_kits;
create policy "brand kits: insert own" on public.brand_kits for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists "brand kits: update own" on public.brand_kits;
create policy "brand kits: update own" on public.brand_kits for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists "brand kits: delete own" on public.brand_kits;
create policy "brand kits: delete own" on public.brand_kits for delete to authenticated using (owner = (select auth.uid()));

-- ------------------------------------------------------------------ films
-- Written only by the FOLD Motion server after a render; users can read their own.
create table if not exists public.films (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  project_id text not null,
  storage_path text not null unique,
  duration_seconds numeric,
  created_at timestamptz not null default now()
);
create index if not exists films_owner_created on public.films (owner, created_at desc);
alter table public.films enable row level security;

drop policy if exists "films: read own" on public.films;
create policy "films: read own" on public.films for select to authenticated using (owner = (select auth.uid()));

-- ------------------------------------------------------------------ storage
-- Both buckets are private: files are reached through signed, expiring links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('brand-assets', 'brand-assets', false, 5242880, array['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp']),
  ('films', 'films', false, 209715200, array['video/mp4'])
on conflict (id) do nothing;

drop policy if exists "brand assets: read own" on storage.objects;
create policy "brand assets: read own" on storage.objects for select to authenticated
  using (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "brand assets: upload own" on storage.objects;
create policy "brand assets: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "brand assets: replace own" on storage.objects;
create policy "brand assets: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "brand assets: delete own" on storage.objects;
create policy "brand assets: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Films are uploaded by the server; users may read (and so sign links to) their own.
drop policy if exists "films: read own files" on storage.objects;
create policy "films: read own files" on storage.objects for select to authenticated
  using (bucket_id = 'films' and (storage.foldername(name))[1] = (select auth.uid())::text);
