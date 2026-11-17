-- Bier-Locator: Währung pro gemeldetem Preis.
-- Einmal im Supabase-Dashboard unter "SQL Editor" ausführen (nach 001–005).
-- Kann gefahrlos mehrfach ausgeführt werden. Ohne dieses Update läuft die App wie bisher:
-- sie meldet dann ohne Währung, und angezeigt wird die Währung des Landes, in dem der Ort liegt.
--
-- 1. Neue Spalte prices.currency. Leer (NULL) heißt "Währung des Ortes": so bleiben alle
--    bisherigen Meldungen richtig, auch die aus der Schweiz.
-- 2. submit_price nimmt die Währung mit (p_currency, optional) und prüft die Grenzen pro Währung.
--    Gleiche Werte wie CURRENCIES in js/countries.js und PLAUSIBLE in js/prices.js.
-- 3. place_data liefert die Währung mit aus.

alter table public.prices add column if not exists currency text;

-- Grenzen werden in Euro gedacht; der Faktor rechnet sie in die Landeswährung um. Unbekannt = NULL.
create or replace function public.bl_per_euro(p_currency text)
returns numeric language sql immutable as $$
  select case coalesce(p_currency, 'EUR')
    when 'EUR' then 1
    when 'CHF' then 1
  end
$$;

-- Die alte Fassung ohne Währung muss weg, sonst kann der Server die beiden nicht unterscheiden.
-- Ältere App-Versionen rufen weiter mit fünf Werten auf und landen bei p_currency = NULL.
drop function if exists public.submit_price(text, text, numeric, text, text);

create or replace function public.submit_price(p_place_id text, p_beer text, p_price numeric, p_unit text, p_secret text, p_currency text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_author text := bl_author(p_secret);
  v_per05 numeric := bl_per05(p_price, p_unit);
  v_f numeric := bl_per_euro(p_currency);
  v_id bigint;
begin
  if char_length(coalesce(p_secret, '')) < 20 then raise exception 'invalid secret'; end if;
  if v_per05 is null then raise exception 'invalid unit'; end if;
  if v_f is null then raise exception 'invalid currency'; end if;
  if p_unit like 'kasten%' then
    if v_per05 < 0.25 * v_f or v_per05 > 4 * v_f then raise exception 'implausible price'; end if;
  elsif v_per05 < 0.30 * v_f or v_per05 > 15 * v_f then
    raise exception 'implausible price';
  end if;
  if (select count(*) from prices where author = v_author and created_at > now() - interval '1 day') >= 30 then
    raise exception 'rate limit';
  end if;
  insert into prices (place_id, beer, price, unit, author, currency)
  values (p_place_id, btrim(p_beer), round(p_price, 2), p_unit, v_author, p_currency)
  returning id into v_id;
  return v_id;
end $$;

grant execute on function public.submit_price(text, text, numeric, text, text, text) to anon, authenticated;

-- Wie in schema.sql, nur mit 'currency'.
create or replace function public.place_data(p_ids text[], p_secret text default '')
returns json language sql stable security definer set search_path = public as $$
  with me as (select bl_author(p_secret) as a),
  ids as (select unnest(p_ids[1:500]) as id)
  select json_build_object(
    'prices', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'place_id', p.place_id, 'beer', p.beer, 'price', p.price, 'unit', p.unit, 'currency', p.currency,
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
