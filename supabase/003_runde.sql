-- Bier-Locator: Erweiterung für Gruppen-Touren ("Meine Runde").
-- Einmal komplett im Supabase-Dashboard unter "SQL Editor" ausführen
-- (nach schema.sql und 002_features.sql). Kann gefahrlos mehrfach ausgeführt werden.
--
--   * Live-Standort während der Tour (nur wenn man ihn selbst einschaltet,
--     verfällt nach 15 Minuten ohne Update)
--   * Bestenliste (Abzeichen, gemeldete Preise, Tour-km)
--   * Runden & Abrechnung (wer hat gezahlt, wer schuldet wem)
--   * Abstimmung über den nächsten Stopp
--
-- Gleiches Sicherheitsmodell wie bisher: Tabellen per RLS gesperrt, Zugriff nur
-- über die Funktionen unten, Geräte-IDs nur als Hash. Nach außen geht nur eine
-- kurze, nicht umkehrbare Mitglieds-ID (die ersten 10 Zeichen des Hashes).

alter table public.group_members add column if not exists lat double precision;
alter table public.group_members add column if not exists lon double precision;
alter table public.group_members add column if not exists pos_at timestamptz;
alter table public.group_members add column if not exists stats jsonb not null default '{}';
alter table public.groups add column if not exists poll jsonb;

create table if not exists public.group_rounds (
  id           bigserial primary key,
  code         text references public.groups(code) on delete cascade,
  created_by   text not null,
  payer        text not null,                      -- kurze Mitglieds-ID
  participants text[] not null,                    -- kurze Mitglieds-IDs
  amount       numeric(7,2) not null check (amount > 0 and amount <= 1000),
  beers        int not null check (beers between 1 and 60),
  place_name   text check (char_length(place_name) <= 80),
  created_at   timestamptz not null default now()
);
create index if not exists group_rounds_code on public.group_rounds(code);

create table if not exists public.group_poll_votes (
  code      text references public.groups(code) on delete cascade,
  member    text not null,
  option_id text not null check (option_id ~ '^(node|way|relation)/[0-9]+$'),
  primary key (code, member)
);

alter table public.group_rounds enable row level security;
alter table public.group_poll_votes enable row level security;
revoke all on public.group_rounds, public.group_poll_votes from anon, authenticated;

create or replace function public._group_member(p_code text, p_secret text)
returns text language sql stable security definer set search_path = public as $$
  select member from group_members where code = upper(p_code) and member = bl_author(p_secret)
$$;

-- Erweiterter Gruppenstatus (Obermenge der alten Antwort — ältere App-Versionen laufen weiter).
create or replace function public.group_state(p_code text, p_secret text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me text := bl_author(p_secret); v_code text := upper(p_code);
begin
  if not _group_live(v_code) then raise exception 'group not found'; end if;
  update group_members set last_seen = now() where code = v_code and member = v_me;
  return json_build_object(
    'code', v_code,
    'v', 3,
    'me_id', left(v_me, 10),
    'title', (select title from groups where code = v_code),
    'tour', (select tour from groups where code = v_code),
    'is_owner', (select owner = v_me from groups where code = v_code),
    'members', coalesce((select json_agg(json_build_object(
                           'id', left(member, 10), 'name', name, 'drinks', drinks, 'last_seen', last_seen, 'me', member = v_me,
                           'stats', stats,
                           'lat', case when pos_at > now() - interval '15 minutes' then lat end,
                           'lon', case when pos_at > now() - interval '15 minutes' then lon end,
                           'pos_at', case when pos_at > now() - interval '15 minutes' then pos_at end) order by name)
                         from group_members where code = v_code), '[]'::json),
    'votes', coalesce((select json_agg(json_build_object('stop_id', stop_id, 'up', up, 'down', down, 'mine', mine)) from (
                         select stop_id, count(*) filter (where vote = 1) up, count(*) filter (where vote = -1) down,
                                max(case when member = v_me then vote end) mine
                         from group_votes where code = v_code group by stop_id) v), '[]'::json),
    'rounds', coalesce((select json_agg(json_build_object('id', id, 'payer', payer, 'participants', participants, 'amount', amount,
                           'beers', beers, 'place_name', place_name, 'created_at', created_at, 'mine', created_by = v_me) order by created_at)
                         from group_rounds where code = v_code), '[]'::json),
    'poll', (select case when poll is null then null else poll || jsonb_build_object(
               'counts', coalesce((select jsonb_object_agg(option_id, n) from (select option_id, count(*) n from group_poll_votes where code = v_code group by option_id) c), '{}'::jsonb),
               'mine', (select option_id from group_poll_votes where code = v_code and member = v_me)) end
             from groups where code = v_code)
  );
end $$;

-- Standort (null = nicht mehr teilen) und Zahlen für die Bestenliste.
create or replace function public.group_ping(p_code text, p_secret text, p_lat double precision, p_lon double precision, p_stats jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_stats is not null and pg_column_size(p_stats) > 2000 then raise exception 'too large'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lon not between -180 and 180) then raise exception 'invalid position'; end if;
  update group_members set
    lat = p_lat, lon = p_lon, pos_at = case when p_lat is null then null else now() end,
    stats = coalesce(p_stats, stats), last_seen = now()
  where code = upper(p_code) and member = bl_author(p_secret);
  if not found then raise exception 'not a member'; end if;
  return true;
end $$;

create or replace function public.group_round_add(p_code text, p_secret text, p_payer text, p_participants text[], p_amount numeric, p_beers int, p_place_name text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_me text := _group_member(p_code, p_secret); v_id bigint; v_ids text[];
begin
  if v_me is null then raise exception 'not a member'; end if;
  select array_agg(left(member, 10)) into v_ids from group_members where code = upper(p_code);
  if not (p_payer = any(v_ids)) then raise exception 'unknown payer'; end if;
  if coalesce(array_length(p_participants, 1), 0) = 0 or not (p_participants <@ v_ids) then raise exception 'unknown participant'; end if;
  if (select count(*) from group_rounds where code = upper(p_code)) >= 300 then raise exception 'too many rounds'; end if;
  -- gleiche Plausibilität wie bei Preisen: 0,30–15 € pro Bier
  if p_amount / greatest(p_beers, 1) < 0.3 or p_amount / greatest(p_beers, 1) > 15 then raise exception 'implausible'; end if;
  insert into group_rounds (code, created_by, payer, participants, amount, beers, place_name)
  values (upper(p_code), v_me, p_payer, p_participants, round(p_amount, 2), p_beers, nullif(btrim(left(p_place_name, 80)), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.group_round_del(p_code text, p_secret text, p_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me text := bl_author(p_secret);
begin
  delete from group_rounds r where r.id = p_id and r.code = upper(p_code)
    and (r.created_by = v_me or exists (select 1 from groups g where g.code = r.code and g.owner = v_me));
  return found;
end $$;

-- Abstimmung über den nächsten Stopp: { stop: Index, options: [{ id, name }] } oder null.
create or replace function public.group_poll_set(p_code text, p_secret text, p_poll jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if _group_member(p_code, p_secret) is null then raise exception 'not a member'; end if;
  if p_poll is not null and (pg_column_size(p_poll) > 4000 or jsonb_array_length(coalesce(p_poll->'options', '[]')) not between 2 and 4) then raise exception 'invalid poll'; end if;
  update groups set poll = case when p_poll is null then null else p_poll || jsonb_build_object('at', now()) end where code = upper(p_code);
  delete from group_poll_votes where code = upper(p_code);
  return true;
end $$;

create or replace function public.group_poll_vote(p_code text, p_secret text, p_option text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me text := _group_member(p_code, p_secret);
begin
  if v_me is null then raise exception 'not a member'; end if;
  if not exists (select 1 from groups g, jsonb_array_elements(g.poll->'options') o where g.code = upper(p_code) and o->>'id' = p_option) then raise exception 'invalid option'; end if;
  insert into group_poll_votes (code, member, option_id) values (upper(p_code), v_me, p_option)
  on conflict (code, member) do update set option_id = excluded.option_id;
  return true;
end $$;

grant execute on function public.group_state(text, text),
  public.group_ping(text, text, double precision, double precision, jsonb),
  public.group_round_add(text, text, text, text[], numeric, int, text),
  public.group_round_del(text, text, bigint),
  public.group_poll_set(text, text, jsonb),
  public.group_poll_vote(text, text, text)
to anon, authenticated;
