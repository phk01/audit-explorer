-- Search vector: tokenise text as-is AND split on punctuation, so partial identifiers (gmail.com, anna.holm,
-- a GUID fragment) match through the GIN index instead of falling back to ILIKE scans.
create or replace function ae_search_vector(t text) returns tsvector
language sql immutable parallel safe as $$
  select to_tsvector('simple', left(t, 200000))
      || to_tsvector('simple', left(translate(t, '@./:_-\,;()[]{}"''<>=', '                     '), 200000))
$$;

-- Re-index existing rows in batches (keeps the lock short on large tables).
do $$
declare lo bigint := 0; hi bigint; step int := 20000;
begin
  select coalesce(max(id), 0) into hi from events;
  while lo <= hi loop
    update events e set search = ae_search_vector(concat_ws(' ', e.user_upn, e.operation, e.item, e.detail, e.client_ip, e.object_id, e.counterpart, e.user_agent, e.message_id, e.raw::text))
     where e.id > lo and e.id <= lo + step;
    lo := lo + step;
  end loop;
end $$;
