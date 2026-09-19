-- Nados v1.0 · Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor).

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  mode text not null default 'create',
  provider text not null default '',
  message text not null default '',
  reply text not null default '',
  sources_count int not null default 0
);

alter table public.conversations enable row level security;

drop policy if exists "allow anon inserts"
  on public.conversations;
create policy "allow anon inserts"
  on public.conversations for insert to anon, authenticated with check (true);

drop policy if exists "allow anon selects"
  on public.conversations;
create policy "allow anon selects"
  on public.conversations for select to anon, authenticated using (true);

create index if not exists conversations_created_at_idx
  on public.conversations (created_at desc);
