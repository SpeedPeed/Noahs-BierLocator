"""Lidl Österreich: Bier-Angebote von lidl.at.

lidl.at führt online KEIN Lebensmittel-Gesamtsortiment, nur die Flugblatt-Aktionen. Diese liefert die Such-API,
die lidl.at selbst nutzt (/q/api/search). Erfasst werden laufende und angekündigte Aktionen der Kategorie
"Bier & Cider" (promo=True, valid_until = Aktionsende, bei künftigen Aktionen "gültig ab" in der Notiz).
Steht in den Produktfakten ein Einzelpreis ("Einzeln = 1.29"), wird er zusätzlich als Normalpreis für die
Einzelflasche/-dose übernommen (promo=False). Reine Lidl-Plus-Aktionen ohne Preis werden übersprungen.
"""
import datetime
import re
import time
import urllib.parse

from .common import get_json, entry, strip_pack, TODAY

BASE = 'https://www.lidl.at'
API = f'{BASE}/q/api/search?assortment=AT&locale=de_AT&version=v2.0.0&fetchsize=100&offset=0&q='
QUERIES = ['bier', 'radler', 'märzen', 'pils', 'weizen', 'lager', 'zwickl', 'alkoholfrei']
HEADERS = {'Referer': f'{BASE}/', 'Accept': 'application/json, text/plain, */*'}  # nur "application/json" → HTTP 406
SKIP_NAME = re.compile(r'cider|\bmost\b|ginger beer|leggings|damen|herren|kinder', re.I)


def _f(s):
    return float(s.replace(',', '.'))


def _pack(text):
    """'Je 20x 0,5 l (…)' → (20, 0.5); 'Ab 24 Stk. je 0,5 l (…)' → (1, 0.5) + Mindestmenge 24."""
    t = text or ''
    m = re.search(r'(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(ml|l)\b', t, re.I)
    if m:
        v = _f(m.group(2))
        return int(m.group(1)), v / 1000 if m.group(3).lower() == 'ml' else v, None
    m = re.search(r'(?:ab\s+(\d+)\s*stk\.?\s*)?je\s+(\d+(?:[.,]\d+)?)\s*(ml|l)\b', t, re.I)
    if m:
        v = _f(m.group(2))
        return 1, v / 1000 if m.group(3).lower() == 'ml' else v, (int(m.group(1)) if m.group(1) else None)
    return None


try:
    from zoneinfo import ZoneInfo
    _TZ = ZoneInfo('Europe/Vienna')
except Exception:  # z. B. Windows ohne tzdata → Ortszeit
    _TZ = None


def _date(ts):
    return datetime.datetime.fromtimestamp(ts, _TZ).date().isoformat() if ts else None


def _names(g):
    brand = ((g.get('brand') or {}).get('name') or '').title()
    title = (g.get('keyfacts') or {}).get('title') or g.get('fullTitle', '')
    title = strip_pack(title)
    parts = re.split(r',\s*|\s+oder\s+', title)
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        out.append(f'{brand} {p}'.strip() if brand and not p.lower().startswith(brand.lower()) else p)
    return out or [g.get('fullTitle', '')]


def _items():
    seen = {}
    for i, q in enumerate(QUERIES):
        if i:
            time.sleep(0.6)
        d = get_json(API + urllib.parse.quote(q), HEADERS)
        for it in d.get('items', []):
            g = (it.get('gridbox') or {}).get('data') or {}
            cat = (g.get('keyfacts') or {}).get('wonCategoryPrimary', '')
            if re.search(r'/Bier\b', cat) and g.get('erpNumber') not in seen:  # "…/Bier & Cider", nicht "Wein, Bier und …"
                seen[g['erpNumber']] = g
    return list(seen.values())


def scrape():
    out = []
    for g in _items():
        if SKIP_NAME.search(g.get('fullTitle', '')):
            continue
        price = g.get('price') or {}
        cur = price.get('price')
        pk = _pack((price.get('basePrice') or {}).get('text'))
        if not cur or not pk:
            continue  # z. B. reine Lidl-Plus-Aktion ohne ausgewiesenen Preis
        n, l, min_qty = pk
        start, end = _date(g.get('storeStartDate')), _date(g.get('storeEndDate'))
        if end and end < TODAY:
            continue
        src = BASE + g.get('canonicalUrl', '')
        old = price.get('oldPrice') or (price.get('discount') or {}).get('deletedPrice')
        facts = (g.get('keyfacts') or {}).get('description') or ''
        single = re.search(r'Einzeln\s*=\s*(\d+(?:[.,]\d+)?)', facts)
        note = 'Aktion'
        if old and old > cur:
            note += f', statt {old:.2f} €'.replace('.', ',')
        extra = []
        if min_qty:
            extra.append(f'ab {min_qty} Stück')
        if start and start > TODAY:
            extra.append(f'gültig ab {start[8:10]}.{start[5:7]}.')
        if 'Lidl Plus' in facts:
            extra.append('mit Lidl Plus')
        if extra:
            note += f" ({', '.join(extra)})"
        for name in _names(g):
            e = entry('AT', 'lidl', name, n, l, cur, src, promo=True, note=note, valid_until=end, valid_from=(start[:10] if start else None))
            if e:
                out.append(e)
            if single:
                e = entry('AT', 'lidl', name, 1, l, _f(single.group(1)), src)
                if e:
                    out.append(e)
    return out
