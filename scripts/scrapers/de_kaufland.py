"""Kaufland Deutschland: Bier aus den Filial-Angeboten (filiale.kaufland.de).

Kaufland hat online kein Lebensmittel-Sortiment mit Normalpreisen (www.kaufland.de ist der
Marktplatz und steckt zudem hinter einer Cloudflare-Prüfung). Die Angebotsübersicht ist
serverseitig gerendert; alle Angebote der aktuellen und nächsten Woche stecken als JSON in
window.SSR[...] = {"component":"OfferTemplate", ...}. Ohne gewählte Filiale zeigt die Seite
die Standard-Angebote (bundesweite Werbung). Preise ohne Pfand.
"""
import datetime
import html as htmllib
import json
import re

from .common import get_text, parse_pack, entry, TODAY

URL = 'https://filiale.kaufland.de/angebote/uebersicht.html'

BEER = re.compile(
    r'bier|pils|radler|weizen|weißbier|weissbier|helles|\bhell\b|lager|export|\bbock\b|\bipa\b|\bale\b|märzen|'
    r'alster|kölsch|\balt\b|zwickl|kellerbier|landbier|schankbier|urtyp|stout|porter|desperados|cerveza|'
    r'budvar|\bcorona\b|tyskie|guinness|edelbräu', re.I)
NOT_DRINK = re.compile(r'wein\b|sekt|likör|whisk|wodka|vodka|gin\b|rum\b|limo|cola|saft|wasser|mehl|brot|brötchen', re.I)


def _eur(s):
    return s.replace('.', ',')


def _ddmm(iso):
    d = datetime.date.fromisoformat(iso)
    return f'{d.day:02d}.{d.month:02d}.'


def scrape():
    html = get_text(URL)
    m = re.search(r"window\.SSR\['[^']+'\]\s*=\s*(\{\"component\":\"OfferTemplate\".*?\});?\s*</script>", html, re.S)
    if not m:
        raise RuntimeError('Kaufland: Angebotsdaten (OfferTemplate) nicht gefunden')
    data = json.loads(m.group(1))
    out, seen = [], set()
    for cycle in data['props']['offerData']['cycles']:
        for cat in cycle.get('categories', []):
            for o in cat.get('offers', []):
                title = htmllib.unescape(o.get('title') or '').strip()
                sub = htmllib.unescape(o.get('subtitle') or '').strip()
                desc = htmllib.unescape(o.get('detailDescription') or '')
                unit = o.get('unit') or ''
                text = f'{title} {sub} {desc}'
                if not BEER.search(text) or NOT_DRINK.search(f'{sub} {desc}'.replace('Weizen', '')):
                    continue
                pack = parse_pack(re.sub(r'liter', 'l', unit.replace('-', ' '), flags=re.I))
                if not pack:
                    continue
                n, l = pack
                start = cat.get('salesFrom') or o.get('dateFrom')
                end = cat.get('salesTo') or o.get('dateTo')
                if end and end < TODAY:
                    continue
                brand = title.title().replace("'S ", "'s ").replace("'S", "'s") if title.isupper() else title
                name = f'{brand} {sub}'.strip()
                art = (o.get('offerId') or '').split('_')[0] or name
                key = (art, n, l, o.get('price'), end)
                if key in seen:
                    continue
                seen.add(key)
                note = 'Aktion'
                if start and start > TODAY:
                    note += f' ab {_ddmm(start)}'
                old = (o.get('formattedOldPrice') or '').strip()
                if old:
                    note += f', statt {_eur(old)} €'
                lp = (o.get('loyaltyFormattedPrice') or '').rstrip('*').strip()
                if lp:
                    note += f'; mit Kaufland Card XTRA {_eur(lp)} €'
                src = f"{URL}?kloffer-category={cat.get('name', '')}"
                e = entry('DE', 'kaufland', name, n, l, o.get('price'), src, promo=True, note=note, valid_until=end, valid_from=(str(start)[:10] if start else None))
                if e:
                    out.append(e)
    return out
