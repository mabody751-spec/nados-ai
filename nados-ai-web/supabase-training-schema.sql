-- Nados AI · Training system schema
-- Run in the Supabase SQL Editor (or via the Management API).

create table if not exists public.teacher_outputs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  input_hash text not null,
  output_hash text not null,
  task_types text[] not null default '{}',
  provider text not null default '',
  provider_model text not null default '',
  message text not null default '',
  output text not null default '',
  tokens_prompt int,
  tokens_completion int,
  latency_ms int,
  quality_score numeric(4,3),
  agreement_score numeric(4,3),
  accepted boolean not null default false,
  reasons text[] not null default '{}'
);

create table if not exists public.training_examples (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  input_hash text not null unique,
  messages jsonb not null,
  task_types text[] not null default '{}',
  teacher_count int not null default 1,
  teacher_models text[] not null default '{}',
  agreement_score numeric(4,3),
  quality_score numeric(4,3),
  dataset_version text not null default 'NADOS-DATASET-001',
  consent_ok boolean not null default true,
  privacy_ok boolean not null default true
);

create table if not exists public.dataset_versions (
  id text primary key,
  created_at timestamptz not null default now(),
  examples_count int not null default 0,
  notes text not null default ''
);

create table if not exists public.training_jobs (
  id text primary key,
  created_at timestamptz not null default now(),
  base_model text not null default '',
  dataset_version text not null default '',
  method text not null default 'qlora',
  state text not null default 'waiting_for_gpu',
  reason text not null default '',
  benchmark jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id text not null default '',
  rating text not null default '',
  note text not null default ''
);

alter table public.teacher_outputs enable row level security;
alter table public.training_examples enable row level security;
alter table public.dataset_versions enable row level security;
alter table public.training_jobs enable row level security;
alter table public.feedback enable row level security;

drop policy if exists "allow anon inserts" on public.teacher_outputs;
create policy "allow anon inserts" on public.teacher_outputs for insert to anon, authenticated with check (true);
drop policy if exists "allow anon selects" on public.teacher_outputs;
create policy "allow anon selects" on public.teacher_outputs for select to anon, authenticated using (true);

drop policy if exists "allow anon inserts" on public.training_examples;
create policy "allow anon inserts" on public.training_examples for insert to anon, authenticated with check (true);
drop policy if exists "allow anon selects" on public.training_examples;
create policy "allow anon selects" on public.training_examples for select to anon, authenticated using (true);

drop policy if exists "allow anon inserts" on public.dataset_versions;
create policy "allow anon inserts" on public.dataset_versions for insert to anon, authenticated with check (true);
drop policy if exists "allow anon selects" on public.dataset_versions;
create policy "allow anon selects" on public.dataset_versions for select to anon, authenticated using (true);

drop policy if exists "allow anon inserts" on public.training_jobs;
create policy "allow anon inserts" on public.training_jobs for insert to anon, authenticated with check (true);
drop policy if exists "allow anon selects" on public.training_jobs;
create policy "allow anon selects" on public.training_jobs for select to anon, authenticated using (true);

drop policy if exists "allow anon inserts" on public.feedback;
create policy "allow anon inserts" on public.feedback for insert to anon, authenticated with check (true);
drop policy if exists "allow anon selects" on public.feedback;
create policy "allow anon selects" on public.feedback for select to anon, authenticated using (true);
