-- Bier-Locator: geteilte Preise & Bewertungen
-- Einmal komplett im Supabase-Dashboard unter "SQL Editor" ausführen.
--
-- Sicherheitsmodell (ohne Login): Jedes Gerät schickt ein zufälliges Geheimnis mit;
-- gespeichert wird nur dessen SHA-256-Hash. Die Tabellen sind per Row Level
-- Security komplett gesperrt — gelesen und geschrieben wird ausschließlich über
-- die Funktionen unten, die Eingaben prüfen (Plausibilität, Länge, Rate-Limit).

create table if not exists public.prices (
  id          bigint generated always as identity primary key,
  place_id    text        not null check (place_id ~ '^(node|way|relation)/[0-9]+$'),
  beer        text        not null check (char_length(btrim(beer)) between 1 and 40),
  price       numeric(6,2) not null check (price > 0),
  unit        text        not null check (unit in ('0.33l','0.5l','1l','kasten20x0.5l','kasten24x0.33l')),
  author      text        not null,
  created_at  timestamptz not null default now()
);
create index if not exists prices_place_idx  on public.prices (place_id, created_at desc);
create index if not exists prices_author_idx on public.prices (author, created_at desc);

create table if not exists public.ratings (
  place_id    text        not null check (place_id ~ '^(node|way|relation)/[0-9]+$'),
  author      text        not null,
  stars       smallint    not null check (stars between 1 and 5),
  updated_at  timestamptz not null default now(),
  primary key (place_id, author)
);

alter table public.prices  enable row level security;
alter table public.ratings enable row level security;
revoke all on public.prices, public.ratings from anon, authenticated;

-- Hilfsfunktionen -----------------------------------------------------------
create or replace function public.bl_author(p_secret text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex')
$$;

-- Preis auf 0,5 l umgerechnet (gleiche Faktoren wie js/prices.js)
create or replace function public.bl_per05(p_price numeric, p_unit text)
returns numeric language sql immutable as $$
  select case p_unit
    when '0.5l' then p_price
    when '0.33l' then p_price / 0.66
    when '1l' then p_price / 2
    when 'kasten20x0.5l' then p_price / 20
    when 'kasten24x0.33l' then p_price / 15.84
  end
$$;

-- Lesen ------------------------------------------------------------------------
create or replace function public.place_data(p_ids text[], p_secret text default '')
returns json language sql stable security definer set search_path = public as $$
  with me as (select bl_author(p_secret) as a),
  ids as (select unnest(p_ids[1:500]) as id)
  select json_build_object(
    'prices', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'place_id', p.place_id, 'beer', p.beer, 'price', p.price, 'unit', p.unit,
        'created_at', p.created_at, 'mine', p.author = (select a from me)
      ) order by p.created_at desc)
      from prices p
      where p.place_id in (select id from ids) and p.created_at > now() - interval '2 years'
    ), '[]'::json),
    'ratings', coalesce((
      select json_agg(json_build_object('place_id', r.place_id, 'avg', r.avg, 'count', r.cnt, 'mine', r.mine))
      from (
        select place_id, round(avg(stars), 2) as avg, count(*) as cnt,
               max(case when author = (select a from me) then stars end) as mine
        from ratings where place_id in (select id from ids)
        group by place_id
      ) r
    ), '[]'::json)
  )
$$;

-- Schreiben --------------------------------------------------------------------
create or replace function public.submit_price(p_place_id text, p_beer text, p_price numeric, p_unit text, p_secret text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_author text := bl_author(p_secret);
  v_per05 numeric := bl_per05(p_price, p_unit);
  v_id bigint;
begin
  if char_length(coalesce(p_secret, '')) < 20 then raise exception 'invalid secret'; end if;
  if v_per05 is null then raise exception 'invalid unit'; end if;
  if p_unit like 'kasten%' then
    if v_per05 < 0.25 or v_per05 > 4 then raise exception 'implausible price'; end if;
  elsif v_per05 < 0.30 or v_per05 > 15 then
    raise exception 'implausible price';
  end if;
  if (select count(*) from prices where author = v_author and created_at > now() - interval '1 day') >= 30 then
    raise exception 'rate limit';
  end if;
  insert into prices (place_id, beer, price, unit, author)
  values (p_place_id, btrim(p_beer), round(p_price, 2), p_unit, v_author)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_price(p_id bigint, p_secret text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from prices where id = p_id and author = bl_author(p_secret);
  return found;
end $$;

create or replace function public.set_rating(p_place_id text, p_stars int, p_secret text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_author text := bl_author(p_secret);
begin
  if char_length(coalesce(p_secret, '')) < 20 then raise exception 'invalid secret'; end if;
  if p_stars is null then
    delete from ratings where place_id = p_place_id and author = v_author;
  else
    insert into ratings (place_id, author, stars) values (p_place_id, v_author, p_stars)
    on conflict (place_id, author) do update set stars = excluded.stars, updated_at = now();
  end if;
  return true;
end $$;

grant execute on function public.place_data(text[], text) to anon, authenticated;
grant execute on function public.submit_price(text, text, numeric, text, text) to anon, authenticated;
grant execute on function public.delete_price(bigint, text) to anon, authenticated;
grant execute on function public.set_rating(text, int, text) to anon, authenticated;
