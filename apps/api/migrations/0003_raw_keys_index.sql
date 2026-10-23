-- Lower-cased top-level keys of each raw record, indexed with GIN so raw-path searches
-- (Parameters.ForwardTo:*, LogonError:Invalid*) only touch records that have the key at all.
create or replace function ae_keys(doc jsonb) returns text[]
language sql immutable parallel safe as $$
  select case when jsonb_typeof(doc) = 'object' then coalesce(array(select lower(k) from jsonb_object_keys(doc) k), '{}') else '{}' end
$$;
create index if not exists events_raw_keys_idx on events using gin (ae_keys(raw));
