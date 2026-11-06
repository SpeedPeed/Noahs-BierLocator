-- Bier-Locator: "Meine Daten löschen" (Datenschutz / Google-Play-Anforderung).
-- Einmal im Supabase-Dashboard unter "SQL Editor" ausführen (nach schema.sql,
-- 002_features.sql und 003_runde.sql). Kann gefahrlos mehrfach ausgeführt werden.
-- Ohne dieses Update läuft die App weiter, nur das Löschen am Server meldet einen Fehler.
--
-- Löscht alles, was zur geheimen Geräte-ID gehört: Preise, Bewertungen, Push-Abo,
-- Gruppen-Mitgliedschaften und Stimmen. Mit Sync-Code zusätzlich das Sync-Profil.
-- Runden, die man in einer Gruppe eingetragen hat, bleiben für die Abrechnung der
-- anderen erhalten, verlieren aber den Bezug zum Gerät.

create or replace function public.delete_my_data(p_secret text, p_sync_code text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_me text := bl_author(p_secret);
  v_prices int; v_ratings int; v_groups int; v_sync int := 0;
begin
  if char_length(coalesce(p_secret, '')) < 16 then raise exception 'invalid secret'; end if;

  delete from prices where author = v_me;
  get diagnostics v_prices = row_count;
  delete from ratings where author = v_me;
  get diagnostics v_ratings = row_count;
  delete from push_subs where id = v_me;

  -- Gruppen: eigene Gruppen ohne andere Mitglieder ganz löschen, sonst übernimmt
  -- ein anderes Mitglied die Leitung.
  delete from groups g where g.owner = v_me
    and not exists (select 1 from group_members m where m.code = g.code and m.member <> v_me);
  update groups g set owner = (select m.member from group_members m where m.code = g.code and m.member <> v_me
                               order by m.member limit 1)
  where g.owner = v_me;
  update group_rounds set created_by = 'geloescht' where created_by = v_me;
  delete from group_poll_votes where member = v_me;
  delete from group_votes where member = v_me;
  delete from group_members where member = v_me;
  get diagnostics v_groups = row_count;

  if char_length(coalesce(p_sync_code, '')) >= 20 then
    delete from sync_profiles where id = bl_author(p_sync_code);
    get diagnostics v_sync = row_count;
  end if;

  return json_build_object('prices', v_prices, 'ratings', v_ratings, 'groups', v_groups, 'sync', v_sync);
end $$;

grant execute on function public.delete_my_data(text, text) to anon, authenticated;
