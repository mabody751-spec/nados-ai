-- Nados AI — Work mode project persistence.
-- Projects live in Supabase; file contents live in the isolated workspace disk.
-- Run this in the Supabase SQL editor (or `supabase db push`).

create table if not exists public.work_projects (
  project_id   text primary key,
  user_id      text not null default 'local-user',
  name         text not null,
  stack        text not null default 'static',
  status       text not null default 'created',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists work_projects_user_idx on public.work_projects (user_id, updated_at desc);

-- Optional: structured agent steps for audit/history (append-only).
create table if not exists public.work_steps (
  id             bigserial primary key,
  project_id     text not null references public.work_projects (project_id) on delete cascade,
  task_id        text not null,
  step_id        text not null,
  type           text not null,
  status         text not null,
  description    text,
  tool           text,
  arguments      jsonb,
  result         jsonb,
  error          text,
  started_at     timestamptz,
  completed_at   timestamptz,
  duration_ms    integer,
  created_at     timestamptz not null default now()
);

create index if not exists work_steps_project_idx on public.work_steps (project_id, created_at desc);

-- Service-role access only: the Express server writes with the service role key.
alter table public.work_projects enable row level security;
alter table public.work_steps enable row level security;
