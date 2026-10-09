-- Bier-Locator: Erweiterung für Geräte-Sync, Preisalarm (Push) und Gruppen-Touren.
-- Einmal komplett im Supabase-Dashboard unter "SQL Editor" ausführen
-- (nach schema.sql). Kann gefahrlos mehrfach ausgeführt werden.
--
-- Gleiches Sicherheitsmodell wie schema.sql: Tabellen per RLS komplett gesperrt,
-- Zugriff nur über die Funktionen unten. Geheimnisse (Sync-Code, Geräte-ID)
-- werden nur als SHA-256-Hash gespeichert (bl_author aus schema.sql).

/* =========================================================================
   1. Geräte-Sync — Favoriten, Vorlieben, Promille-Log, Tagebuch …
   Wer den Sync-Code kennt (QR-Code/Link), teilt dieselben Daten.
   ========================================================================= */
create table if not exists public.sync_profiles (
  id          text primary key,              -- Hash des Sync-Codes
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.sync_profiles enable row level security;
revoke all on public.sync_profiles from anon, authenticated;

create or replace function public.sync_pull(p_code text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('data', data, 'updated_at', updated_at)
  from sync_profiles
  where char_length(coalesce(p_code, '')) >= 20 and id = bl_author(p_code)
$$;

create or replace function public.sync_push(p_code text, p_data jsonb)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_t timestamptz := now();
begin
  if char_length(coalesce(p_code, '')) < 20 then raise exception 'invalid code'; end if;
  if pg_column_size(p_data) > 400000 then raise exception 'too large'; end if;
  insert into sync_profiles (id, data, updated_at) values (bl_author(p_code), p_data, v_t)
  on conflict (id) do update set data = excluded.data, updated_at = v_t;
  return v_t;
end $$;

/* =========================================================================
   2. Preisalarm — Push-Abos + Wunschpreise. Der wöchentliche GitHub-Job liest
   sie mit einem geheimen Token (alerts_token) und verschickt Benachrichtigungen.
   ========================================================================= */
create table if not exists public.push_subs (
  id            text primary key,            -- Hash der Geräte-ID
  subscription  jsonb not null,              -- Web-Push-Endpunkt + Schlüssel
  watches       jsonb not null default '[]', -- [{q, max05, country}]
  notified      jsonb not null default '{}', -- bereits gemeldete Treffer
  updated_at    timestamptz not null default now()
);
alter table public.push_subs enable row level security;
revoke all on public.push_subs from anon, authenticated;

create table if not exists public.app_secrets (name text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- Einmalig: legt den Token für den GitHub-Job fest (wer zuerst kommt; danach gesperrt).
create or replace function public.alerts_init_token(p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(p_token, '')) < 32 then raise exception 'token too short'; end if;
  insert into app_secrets (name, value) values ('alerts_token', bl_author(p_token))
  on conflict (name) do nothing;
  return found;
end $$;

create or replace function public._alerts_ok(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_secrets where name = 'alerts_token' and value = bl_author(p_token))
$$;

create or replace function public.alerts_save(p_secret text, p_subscription jsonb, p_watches jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(p_secret, '')) < 20 then raise exception 'invalid secret'; end if;
  if jsonb_array_length(coalesce(p_watches, '[]')) > 30 then raise exception 'too many watches'; end if;
  if p_subscription is null or jsonb_array_length(coalesce(p_watches, '[]')) = 0 then
    delete from push_subs where id = bl_author(p_secret);
  else
    insert into push_subs (id, subscription, watches) values (bl_author(p_secret), p_subscription, p_watches)
    on conflict (id) do update set subscription = excluded.subscription, watches = excluded.watches, updated_at = now();
  end if;
  return true;
end $$;

create or replace function public.alerts_export(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not _alerts_ok(p_token) then raise exception 'forbidden'; end if;
  return coalesce((select json_agg(json_build_object('id', id, 'subscription', subscription, 'watches', watches, 'notified', notified)) from push_subs), '[]'::json);
end $$;

create or replace function public.alerts_mark(p_token text, p_id text, p_notified jsonb, p_drop boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not _alerts_ok(p_token) then raise exception 'forbidden'; end if;
  if p_drop then delete from push_subs where id = p_id;            -- Abo abgelaufen
  else update push_subs set notified = p_notified where id = p_id; end if;
  return true;
end $$;

/* =========================================================================
   3. Gruppen-Touren — gemeinsam planen, abstimmen, mitzählen.
   Gruppen verfallen nach 7 Tagen.
   ========================================================================= */
create table if not exists public.groups (
  code        text primary key,
  owner       text not null,
  title       text not null check (char_length(title) between 1 and 60),
  tour        jsonb,
  created_at  timestamptz not null default now()
);
create table if not exists public.group_members (
  code      text references public.groups(code) on delete cascade,
  member    text not null,
  name      text not null check (char_length(name) between 1 and 24),
  drinks    int not null default 0 check (drinks between 0 and 99),
  last_seen timestamptz not null default now(),
  primary key (code, member)
);
create table if not exists public.group_votes (
  code     text references public.groups(code) on delete cascade,
  member   text not null,
  stop_id  text not null check (stop_id ~ '^(node|way|relation)/[0-9]+$'),
  vote     smallint not null check (vote in (-1, 1)),
  primary key (code, member, stop_id)
);
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_votes enable row level security;
revoke all on public.groups, public.group_members, public.group_votes from anon, authenticated;

create or replace function public._group_live(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from groups where code = upper(p_code) and created_at > now() - interval '7 days')
$$;

create or replace function public.group_create(p_secret text, p_name text, p_title text, p_tour jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_me text := bl_author(p_secret);
begin
  if char_length(coalesce(p_secret, '')) < 20 then raise exception 'invalid secret'; end if;
  if (select count(*) from groups where owner = v_me and created_at > now() - interval '1 day') >= 10 then raise exception 'rate limit'; end if;
  if pg_column_size(p_tour) > 60000 then raise exception 'too large'; end if;
  loop
    v_code := '';
    for i in 1..6 loop  -- ohne verwechselbare Zeichen (0/O, 1/I/L)
      v_code := v_code || substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1);
    end loop;
    exit when not exists (select 1 from groups where code = v_code);
  end loop;
  delete from groups where created_at < now() - interval '7 days';
  insert into groups (code, owner, title, tour) values (v_code, v_me, btrim(p_title), p_tour);
  insert into group_members (code, member, name) values (v_code, v_me, btrim(p_name));
  return v_code;
end $$;

create or replace function public.group_join(p_code text, p_secret text, p_name text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(p_secret, '')) < 20 then raise exception 'invalid secret'; end if;
  if not _group_live(p_code) then raise exception 'group not found'; end if;
  if (select count(*) from group_members where code = upper(p_code)) >= 30 then raise exception 'group full'; end if;
  insert into group_members (code, member, name) values (upper(p_code), bl_author(p_secret), btrim(p_name))
  on conflict (code, member) do update set name = excluded.name, last_seen = now();
  return true;
end $$;

create or replace function public.group_state(p_code text, p_secret text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me text := bl_author(p_secret); v_code text := upper(p_code);
begin
  if not _group_live(v_code) then raise exception 'group not found'; end if;
  update group_members set last_seen = now() where code = v_code and member = v_me;
  return json_build_object(
    'code', v_code,
    'title', (select title from groups where code = v_code),
    'tour', (select tour from groups where code = v_code),
    'is_owner', (select owner = v_me from groups where code = v_code),
    'members', coalesce((select json_agg(json_build_object('name', name, 'drinks', drinks, 'last_seen', last_seen, 'me', member = v_me) order by name)
                         from group_members where code = v_code), '[]'::json),
    'votes', coalesce((select json_agg(json_build_object('stop_id', stop_id, 'up', up, 'down', down, 'mine', mine)) from (
                         select stop_id, count(*) filter (where vote = 1) up, count(*) filter (where vote = -1) down,
                                max(case when member = v_me then vote end) mine
                         from group_votes where code = v_code group by stop_id) v), '[]'::json)
  );
end $$;

create or replace function public.group_vote(p_code text, p_secret text, p_stop_id text, p_vote int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me text := bl_author(p_secret);
begin
  if not exists (select 1 from group_members where code = upper(p_code) and member = v_me) then raise exception 'not a member'; end if;
  if p_vote = 0 then
    delete from group_votes where code = upper(p_code) and member = v_me and stop_id = p_stop_id;
  else
    insert into group_votes (code, member, stop_id, vote) values (upper(p_code), v_me, p_stop_id, sign(p_vote))
    on conflict (code, member, stop_id) do update set vote = excluded.vote;
  end if;
  return true;
end $$;

create or replace function public.group_drink(p_code text, p_secret text, p_delta int)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update group_members set drinks = greatest(0, least(99, drinks + sign(p_delta))), last_seen = now()
  where code = upper(p_code) and member = bl_author(p_secret) returning drinks into v;
  if v is null then raise exception 'not a member'; end if;
  return v;
end $$;

create or replace function public.group_set_tour(p_code text, p_secret text, p_tour jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if pg_column_size(p_tour) > 60000 then raise exception 'too large'; end if;
  update groups set tour = p_tour where code = upper(p_code) and owner = bl_author(p_secret);
  if not found then raise exception 'only owner'; end if;
  return true;
end $$;

grant execute on function public.sync_pull(text), public.sync_push(text, jsonb),
  public.alerts_init_token(text), public.alerts_save(text, jsonb, jsonb),
  public.alerts_export(text), public.alerts_mark(text, text, jsonb, boolean),
  public.group_create(text, text, text, jsonb), public.group_join(text, text, text),
  public.group_state(text, text), public.group_vote(text, text, text, int),
  public.group_drink(text, text, int), public.group_set_tour(text, text, jsonb)
to anon, authenticated;
