-- Detections ("signals") produce findings per workspace. Recomputed after every import.
alter table workspaces add column if not exists settings jsonb not null default '{}';

create table if not exists findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  signal text not null,                 -- brute, spray, rule, fwd, consent, travel, session, ...
  fingerprint text not null,            -- stable id for the same finding across recomputes (signal|entity|...)
  severity text not null check (severity in ('high','medium','low')),
  category text not null,               -- Identity, Mailbox, Sharing, Email, Applications, Compliance, Location, Teams
  title text not null,
  text text not null,
  facts jsonb not null default '[]',    -- [[label, value], ...]
  entity_type text,                     -- user | ip | session | message | app
  entity_value text,
  users text[] not null default '{}',   -- every UPN the finding touches (for the per-user verdict)
  event_count int not null default 0,
  event_ids bigint[] not null default '{}',   -- first 500 evidence rows
  evidence_query jsonb,                 -- EventQuery that reproduces the whole evidence set
  first_ts timestamptz,
  last_ts timestamptz,
  status text not null default 'open' check (status in ('open','dismissed','confirmed')),
  note text,
  computed_at timestamptz not null default now(),
  unique (workspace_id, fingerprint)
);
create index if not exists findings_ws_sev_idx on findings(workspace_id, severity, last_ts desc);
create index if not exists findings_users_idx on findings using gin (users);

create table if not exists signal_runs (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms int,
  findings int,
  error text
);

-- Concatenating array aggregate used by the burst detector.
do $$ begin
  create aggregate array_cat_agg(anycompatiblearray) (sfunc = array_cat, stype = anycompatiblearray);
exception when duplicate_function then null; end $$;
