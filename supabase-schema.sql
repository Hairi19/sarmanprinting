-- ============================================================
-- ORBIT v2.0 — Sarman Printing Job Tracking
-- Supabase schema. Run this once in:
--   Supabase Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

-- ---------- 1. PROFILES (staff accounts & roles) ----------
create table if not exists public.profiles (
  emp_id     serial primary key,
  user_uuid  uuid unique,                       -- links to auth.users.id (set on first login)
  email      text unique not null,              -- matches the Supabase Auth login email
  name       text not null default '',
  surname    text not null default '',
  initials   text not null default '??',
  role       text not null default 'Staff',
  dept       text not null default 'General',
  landing    text not null default 'dashboard.html',
  pages      jsonb not null default '["dashboard.html"]',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- 2. JOBS (orders / production jobs) ----------
create table if not exists public.jobs (
  job_id     text primary key,                  -- e.g. JOB-0001
  client     text,
  stage      int  not null default 0,
  status     text not null default 'waiting',
  urgent     text not null default 'normal',
  created_at text,                              -- "DD Mon YYYY, HH:MM" as used by the app
  updated_at timestamptz not null default now(),
  data       jsonb not null default '{}'        -- full job object (salesData, designData, plannerData, productionHistory, deliveryData, ...)
);

-- ---------- 3. NOTIFICATIONS (cross-department alerts) ----------
create table if not exists public.notifications (
  id         bigserial primary key,
  notif_id   text unique not null,              -- client-generated id (Date.now based) for dedupe
  data       jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security (RLS)
--  - Jobs: ANYONE (anon) may READ for public QR / order tracking.
--          Only logged-in staff may INSERT / UPDATE / DELETE.
--  - Profiles & Notifications: only logged-in staff.
-- ============================================================
alter table public.profiles      enable row level security;
alter table public.jobs          enable row level security;
alter table public.notifications enable row level security;

-- jobs: public read (anon + authenticated)
drop policy if exists "jobs_public_read" on public.jobs;
create policy "jobs_public_read" on public.jobs
  for select using (true);

-- jobs: authenticated write
drop policy if exists "jobs_auth_write" on public.jobs;
create policy "jobs_auth_write" on public.jobs
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- profiles: authenticated only
drop policy if exists "profiles_auth_all" on public.profiles;
create policy "profiles_auth_all" on public.profiles
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- notifications: authenticated only
drop policy if exists "notif_auth_all" on public.notifications;
create policy "notif_auth_all" on public.notifications
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- updated_at trigger helper (optional, keeps timestamps fresh)
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_jobs_updated on public.jobs;
create trigger trg_jobs_updated before update on public.jobs
  for each row execute function public.set_updated_at();
