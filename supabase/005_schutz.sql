-- Bier-Locator: Schutz für die öffentliche App (Google Play).
-- Einmal im Supabase-Dashboard unter "SQL Editor" ausführen (nach 001–004).
-- Kann gefahrlos mehrfach ausgeführt werden. Ohne dieses Update läuft die App wie bisher.
--
-- 1. Spam-Schutz pro Internet-Anschluss: Geräte-IDs kann jeder neu erzeugen, deshalb
--    zusätzlich ein großzügiges Tageslimit pro IP-Adresse. Gespeichert wird nur ein
--    Hash der IP (mit geheimem Zufallswert) und nach 48 Stunden gelöscht.
--    Großzügig, weil sich Handys im Mobilfunk oft eine IP teilen.
-- 2. Gruppencodes mit 8 statt 6 Zeichen (alte 6er-Codes bleiben gültig).
-- 3. Gruppenansicht (Namen, Live-Standort, Runden) nur noch für Mitglieder.

/* =========================================================================
   1. Tageslimit pro IP-Adresse
   ========================================================================= */
create table if not exists public.rate_hits (
  ip_hash  text        not null,
  kind     text        not null,
  at       timestamptz not null default now()
);
create index if not exists rate_hits_idx on public.rate_hits (ip_hash, kind, at);
alter table public.rate_hits enable row level security;
revoke all on public.rate_hits from anon, authenticated;

-- Geheimer Zufallswert, damit sich IP-Hashes nicht zurückrechnen lassen.
insert into public.app_secrets (name, value) values ('ip_pepper', gen_random_uuid()::text)
on conflict (name) do nothing;

create or replace function public._bl_ip_hash()
returns text language plpgsql stable security definer set search_path = public as $$
declare v_ip text; v_h json;
begin
  begin
    v_h := current_setting('request.headers', true)::json;
    v_ip := btrim(coalesce(v_h ->> 'cf-connecting-ip', split_part(v_h ->> 'x-forwarded-for', ',', 1)));
  exception when others then v_ip := null;
  end;
  if coalesce(v_ip, '') = '' then return null; end if;  -- z.B. SQL-Editor, GitHub-Job
  return bl_author(v_ip || '|' || (select value from app_secrets where name = 'ip_pepper'));
end $$;

-- Trigger: zählt Einträge pro IP und Tag, bricht über dem Limit mit 'rate limit' ab.
create or replace function public._bl_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ip text := _bl_ip_hash();
  v_kind text := TG_TABLE_NAME;
  v_limit int := case TG_TABLE_NAME when 'prices' then 120 when 'ratings' then 200 when 'groups' then 30 else 100 end;
begin
  if v_ip is null then return new; end if;
  if random() < 0.02 then delete from rate_hits where at < now() - interval '48 hours'; end if;
  if (select count(*) from rate_hits where ip_hash = v_ip and kind = v_kind and at > now() - interval '1 day') >= v_limit then
    raise exception 'rate limit';
  end if;
  insert into rate_hits (ip_hash, kind) values (v_ip, v_kind);
  return new;
end $$;

drop trigger if exists bl_rate_prices on public.prices;
create trigger bl_rate_prices before insert on public.prices for each row execute function public._bl_rate_limit();
drop trigger if exists bl_rate_ratings on public.ratings;
create trigger bl_rate_ratings before insert on public.ratings for each row execute function public._bl_rate_limit();
drop trigger if exists bl_rate_groups on public.groups;
create trigger bl_rate_groups before insert on public.groups for each row execute function public._bl_rate_limit();

/* =========================================================================
   2. Gruppencodes mit 8 Zeichen
   ========================================================================= */
create or replace function public.group_create(p_secret text, p_name text, p_title text, p_tour jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_me text := bl_author(p_secret);
begin
  if char_length(coalesce(p_secret, '')) < 20 then raise exception 'invalid secret'; end if;
  if (select count(*) from groups where owner = v_me and created_at > now() - interval '1 day') >= 10 then raise exception 'rate limit'; end if;
  if pg_column_size(p_tour) > 60000 then raise exception 'too large'; end if;
  loop
    v_code := '';
    for i in 1..8 loop  -- ohne verwechselbare Zeichen (0/O, 1/I/L)
      v_code := v_code || substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1);
    end loop;
    exit when not exists (select 1 from groups where code = v_code);
  end loop;
  delete from groups where created_at < now() - interval '7 days';
  insert into groups (code, owner, title, tour) values (v_code, v_me, btrim(p_title), p_tour);
  insert into group_members (code, member, name) values (v_code, v_me, btrim(p_name));
  return v_code;
end $$;

/* =========================================================================
   3. Gruppenansicht nur für Mitglieder (wie 003_runde.sql, plus Prüfung)
   ========================================================================= */
create or replace function public.group_state(p_code text, p_secret text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me text := bl_author(p_secret); v_code text := upper(p_code);
begin
  if not _group_live(v_code) then raise exception 'group not found'; end if;
  if not exists (select 1 from group_members where code = v_code and member = v_me) then raise exception 'group not found'; end if;
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

grant execute on function public.group_create(text, text, text, jsonb), public.group_state(text, text) to anon, authenticated;
