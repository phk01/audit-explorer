-- Audit Explorer — initial schema
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role text not null default 'analyst' check (role in ('admin','analyst')),
  password_hash text not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text,
  ip text
);
create index sessions_user_idx on sessions(user_id);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tenant_domains text[] not null default '{}',
  expected_countries text[] not null default '{}',
  notes text not null default '',
  excluded_ips text not null default '',
  exclude_microsoft_ips boolean not null default false,
  exclude_keepit_ips boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_size bigint not null,
  sha256 text not null,
  source text,
  format_label text,
  format_columns jsonb,
  status text not null default 'queued' check (status in ('queued','detecting','running','completed','failed','cancelled','skipped')),
  rows_total bigint,
  rows_processed bigint not null default 0,
  events_inserted bigint not null default 0,
  events_duplicate bigint not null default 0,
  rows_failed bigint not null default 0,
  bytes_processed bigint not null default 0,
  checkpoint_row bigint not null default 0,
  min_ts timestamptz,
  max_ts timestamptz,
  error text,
  warnings jsonb not null default '[]',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index imports_ws_idx on imports(workspace_id, created_at desc);
create index imports_status_idx on imports(status) where status in ('queued','detecting','running');

-- The normalised event index. `raw` holds the complete original record; nothing is dropped.
create table events (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  import_id uuid not null references imports(id) on delete cascade,
  source text not null,
  layer char(1) not null,
  source_record_id text not null,
  ts timestamptz,
  workload text,
  workload_group text not null,
  record_type text,
  record_type_id int,
  operation text not null,
  operation_key text not null,
  kind text not null,
  user_upn text,
  user_type text,
  object_id text,
  item text,
  detail text,
  client_ip text,
  ip_country char(2),
  ip_owner text,
  ip_owner_name text,
  user_agent text,
  result text,
  failed boolean not null default false,
  session_id text,
  correlation_id text,
  message_id text,
  network_message_id text,
  counterpart text,
  sensitive_family text,
  raw jsonb not null,
  envelope jsonb,
  search tsvector,
  unique (workspace_id, source_record_id)
);
create index events_ws_ts_idx on events(workspace_id, ts desc, id desc);
create index events_ws_user_ts_idx on events(workspace_id, user_upn, ts desc);
create index events_ws_op_idx on events(workspace_id, operation_key);
create index events_ws_ip_idx on events(workspace_id, client_ip) where client_ip is not null;
create index events_ws_source_idx on events(workspace_id, source);
create index events_ws_group_idx on events(workspace_id, workload_group);
create index events_ws_import_idx on events(import_id);
create index events_ws_session_idx on events(workspace_id, session_id) where session_id is not null;
create index events_ws_mid_idx on events(workspace_id, message_id) where message_id is not null;
create index events_ws_nmid_idx on events(workspace_id, network_message_id) where network_message_id is not null;
create index events_ws_counterpart_idx on events(workspace_id, counterpart) where counterpart is not null;
create index events_search_idx on events using gin(search);
create index events_raw_idx on events using gin(raw jsonb_path_ops);

-- Materialised per-person summary, refreshed after each import.
create table identities (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  upn text not null,
  display_name text,
  kind text not null default 'member',
  first_seen timestamptz,
  last_seen timestamptz,
  events bigint not null default 0,
  failed bigint not null default 0,
  sign_ins bigint not null default 0,
  sensitive_events bigint not null default 0,
  ip_count int not null default 0,
  countries text[] not null default '{}',
  sources text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (workspace_id, upn)
);
create index identities_ws_events_idx on identities(workspace_id, events desc);
create index identities_upn_trgm_idx on identities using gin (upn gin_trgm_ops);

-- Operations seen in the data (catalog-independent), for coverage and autocomplete.
create table discovered_operations (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null,
  workload text,
  record_type text,
  operation text not null,
  operation_key text not null,
  events bigint not null default 0,
  first_seen timestamptz,
  last_seen timestamptz,
  record_type_key text generated always as (coalesce(record_type, '')) stored,
  primary key (workspace_id, source, operation_key, record_type_key)
);

create table saved_searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  name text not null,
  query jsonb not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- Case-insensitive property lookup inside raw records, walking Name/Value arrays:
--   ae_prop(raw, '{Parameters,ForwardTo}') -> 'evil@gmail.com'
create or replace function ae_prop(doc jsonb, path text[]) returns text
language plpgsql immutable as $$
declare
  cur jsonb := doc;
  seg text;
  k text;
  found jsonb;
  el jsonb;
begin
  foreach seg in array path loop
    if cur is null then return null; end if;
    if jsonb_typeof(cur) = 'object' then
      found := cur -> seg;
      if found is null then
        for k in select jsonb_object_keys(cur) loop
          if lower(k) = lower(seg) then found := cur -> k; exit; end if;
        end loop;
      end if;
      cur := found;
    elsif jsonb_typeof(cur) = 'array' then
      found := null;
      if seg ~ '^\d+$' then
        found := cur -> seg::int;
      else
        for el in select * from jsonb_array_elements(cur) loop
          if jsonb_typeof(el) = 'object' and lower(coalesce(el->>'Name', el->>'name', el->>'key', el->>'Key', el->>'displayName', '')) = lower(seg) then
            found := coalesce(el->'Value', el->'value', el->'NewValue', el->'newValue');
            exit;
          end if;
        end loop;
      end if;
      cur := found;
    else
      return null;
    end if;
  end loop;
  if cur is null then return null; end if;
  if jsonb_typeof(cur) = 'string' then return cur #>> '{}'; end if;
  return cur::text;
end $$;
