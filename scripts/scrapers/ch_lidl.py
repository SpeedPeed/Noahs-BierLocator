"""Lidl Schweiz: Bier-Angebote (lidl.ch).

Lidl Schweiz zeigt online kein festes Lebensmittel-Sortiment, sondern nur die Wochen-
Aktionen. Erfasst werden alle laufenden (bereits gestarteten) Angebote der Kategorie
"Wein, Bier und Spirituosen/Bier & Cider" über die Such-API, die die Website selbst nutzt.
Zukünftige Aktionen (Start nach heute) werden übersprungen.
"""
import datetime
import re
import time

from .common import get_json, parse_pack, entry

BASE = 'https://www.lidl.ch'
API = f'{BASE}/q/api/search'
HEADERS = {'Accept': 'application/mindshift.search+json;version=2', 'Referer': f'{BASE}/q/de-CH/search?q=bier'}
QUERIES = ['bier', 'panache', 'radler', 'lager', 'pils', 'ale', 'weizen', 'alkoholfrei']
NOT_BEER = re.compile(r'cider|ginger beer|moscht', re.I)


def _search(q):
    items, offset = [], 0
    while True:
        d = get_json(f'{API}?q={q}&locale=de_CH&assortment=CH&version=2.1.0&fetchsize=100&offset={offset}', HEADERS)
        items += d.get('items', [])
        offset += 100
        if offset >= d.get('numFound', 0):
            return items
        time.sleep(0.6)


def _date(ts):
    return datetime.datetime.fromtimestamp(ts).date().isoformat() if ts else None


def scrape():
    now = time.time()
    out, seen = [], set()
    for q in QUERIES:
        for it in _search(q):
            g = (it.get('gridbox') or {}).get('data') or {}
            pid = g.get('productId')
            kf = g.get('keyfacts') or {}
            leaf = (kf.get('wonCategoryPrimary') or '').rsplit('/', 1)[-1].lower()  # z.B. "Bier & Cider"
            if pid in seen or 'bier' not in leaf:
                continue
            seen.add(pid)
            title = g.get('fullTitle') or ''
            if NOT_BEER.search(title):
                continue
            start, end = g.get('storeStartDate'), g.get('storeEndDate')
            if start and start > now:
                continue  # Aktion noch nicht gestartet
            if end and end < now:
                continue
            desc = re.sub(r'<[^>]+>', ' ', kf.get('description') or '')
            pack = parse_pack(desc) or parse_pack(title)
            if not pack:
                continue
            n, l = pack
            pr = g.get('price') or {}
            price = pr.get('price')
            disc = pr.get('discount') or {}
            was = disc.get('deletedPrice')
            # Hinweise wie "(Aktion nur im Tessin gültig)" aus dem Namen in die Notiz verschieben
            m = re.search(r'\(([^)]*Aktion[^)]*)\)', title)
            beer = re.sub(r'\s*\([^)]*\)', '', title).strip()
            brand = ((g.get('brand') or {}).get('name') or '')
            if brand and beer.upper().startswith(brand.upper()):
                beer = brand.title() + beer[len(brand):]
            notes = [f'Aktion, statt CHF {was:.2f}' if was and was > (price or 0) else 'Aktion']
            if disc.get('discountText') and not re.match(r'^(Aktion|-\d+%)$', disc['discountText'].strip()):
                notes.append(disc['discountText'].replace('\xa0', ' ').strip())
            if m:
                notes.append(m.group(1))
            src = BASE + (g.get('canonicalUrl') or g.get('canonicalPath') or '')
            e = entry('CH', 'lidl', beer, n, l, price, src, promo=True, currency='CHF',
                      note='; '.join(notes), valid_until=_date(end))
            if e:
                out.append(e)
        time.sleep(0.6)
    return out
