"""Denner: aktuelle Bier-Aktionen (denner.ch).

Denner zeigt online kein Bier-Sortiment mit Normalpreisen (der Weinshop führt nur Wein,
Bier-Produktseiten existieren nur während einer Aktion). Erfasst werden deshalb die
Aktionen der laufenden Woche aus dem Facettenfilter "Bier" – über denselben Endpunkt,
den die Seite /de/aktionen/aktuelle-aktionen nutzt (/nuxt-api/promotions).
"""
import re
import time

from .common import get_json, parse_pack, entry

BASE = 'https://www.denner.ch'
API = f'{BASE}/nuxt-api/promotions'
HEADERS = {'Origin': BASE, 'Referer': f'{BASE}/de/aktionen/aktuelle-aktionen'}
NOT_BEER = re.compile(r'cider|ginger beer|moscht', re.I)


def _attrs(item):
    a = {}
    for x in item.get('attributeInfo', []):
        vals = [v.get('value') for v in x.get('vals', []) if v.get('value') not in (None, '')]
        if vals:
            a[x['attributeName']] = vals[0] if len(vals) == 1 else vals
    return a


def _num(s):
    m = re.search(r'(\d+)\.(\d+|–|-)', s or '')
    if not m:
        return None
    return float(m.group(1) + '.' + (m.group(2) if m.group(2).isdigit() else '0'))


def _until(label):
    # "01.10.–07.10.2026" → "2026-10-07"
    m = re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$', label or '')
    return f'{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}' if m else None


def _bier_facet():
    d = get_json(API, HEADERS, {'lang': 'de', 'promoFlag': 'promo_current_week', 'page': 1,
                                'hitsPerPage': 1, 'sort': None, 'includeHighlights': False})
    for f in d.get('facets', []):
        for o in f.get('options', []):
            if o.get('label', '').strip().lower() == 'bier':
                return f['attributeName'], o['value']
    return 'type_beverages', '1144374'


def scrape():
    facet, value = _bier_facet()
    out, page = [], 1
    while True:
        time.sleep(0.6)
        d = get_json(API, HEADERS, {'lang': 'de', 'promoFlag': 'promo_current_week', 'facetName': facet,
                                    'facetValue': int(value), 'page': page, 'hitsPerPage': 24,
                                    'sort': None, 'includeHighlights': True})
        for it in d.get('items', []):
            a = _attrs(it)
            name, sub = a.get('name', ''), a.get('nameSubline', '')
            if NOT_BEER.search(name):
                continue
            pack = parse_pack(sub.replace('\xa0', ' ')) or parse_pack(name)
            if not pack:
                continue
            n, l = pack
            price = float(a.get('price') or it.get('price') or 0)
            was = _num(a.get('insteadPriceText'))
            notes = [f'Aktion, statt CHF {was:.2f}' if was else 'Aktion']
            if a.get('footnote'):
                notes.append(a['footnote'])  # z.B. "Nur in der französischen Schweiz erhältlich"
            src = BASE + (a.get('itemUrl') or a.get('canonical') or '/de/aktionen/aktuelle-aktionen').split('?')[0]
            e = entry('CH', 'denner', name, n, l, price, src, promo=True, currency='CHF',
                      note='; '.join(notes), valid_until=_until(a.get('promotionLabel')))
            if e:
                out.append(e)
        if page >= d.get('stats', {}).get('totalPages', 1):
            break
        page += 1
    return out
