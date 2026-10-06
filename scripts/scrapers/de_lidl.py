"""Lidl Deutschland: Bier aus dem Lidl-Onlineshop (lidl.de), praktisch nur Partyfässer.

Nutzt die Such-API, die lidl.de selbst aufruft (/q/api/search, Accept-Header
application/mindshift.search+json). Filial-Lebensmittelangebote stehen bei Lidl DE nur im
Online-Prospekt (Blätterkatalog) und nicht als Produktdaten → nicht erfasst.
Preise = Onlineshop-Preise (zzgl. Versand, ohne Pfand).
"""
import re
import time

from .common import get_json, parse_pack, entry, TODAY

BASE = 'https://www.lidl.de'
API = f'{BASE}/q/api/search?assortment=DE&locale=de_DE&version=v2.0.0&q={{q}}&offset={{off}}&fetchsize=100'
HEADERS = {'Accept': 'application/mindshift.search+json;version=2', 'Referer': f'{BASE}/q/search?q=bier'}
QUERIES = ['bierfass', 'bier']
EXCLUDE = re.compile(r'glas|gläser|whisk|korn\b|likör|zapfanlage|kühler|tisch|bank|garnitur', re.I)


def _items(q):
    off, out = 0, []
    while True:
        d = get_json(API.format(q=q, off=off), HEADERS)
        items = d.get('items') or []
        out += items
        off += len(items)
        if not items or off >= d.get('numFound', 0) or off >= 3000:
            return out
        time.sleep(0.5)


def _pack(title, packaging):
    t = re.sub(r'liter', 'l', title.replace('-', ' '), flags=re.I)
    t = re.sub(r',?\s*\d+(?:[.,]\d+)?\s*%\s*vol', '', t, flags=re.I)
    p = parse_pack(t)
    if p:
        return p
    if packaging and packaging.get('unit') == 'l' and packaging.get('amount'):
        return 1, float(packaging['amount'])
    return None


def _name(title):
    t = re.sub(r',?\s*\d+(?:[.,]\d+)?\s*%\s*vol', '', title, flags=re.I)
    t = re.sub(r'\b\d+\s*x\s*', '', t)
    t = re.sub(r'\b\d+(?:[.,]\d+)?[\s-]*(l|liter)\b-?', '', t, flags=re.I)
    keg = re.search(r'bierf[aä]ss', t, re.I)
    t = re.sub(r'\b(bierfass|bierfässer)\b|\bmit zapfhahn\b', '', t, flags=re.I)
    t = re.sub(r'\s{2,}', ' ', t).strip(' ,-') + (' Partyfass' if keg else '')
    return ' '.join(w.capitalize() if len(w) > 2 and w.isupper() else w for w in t.split())


def _eur(v):
    return f'{v:.2f}'.replace('.', ',')


def scrape():
    out, seen = [], set()
    for q in QUERIES:
        for it in _items(q):
            g = (it.get('gridbox') or {}).get('data') or {}
            pid = g.get('productId')
            title = g.get('fullTitle') or ''
            cat = g.get('category') or ''
            if pid in seen or not g.get('havingPrice', True):
                continue
            if not (re.search(r'bier', title, re.I) or cat.endswith('/Bier')) or EXCLUDE.search(title):
                continue
            seen.add(pid)
            p = g.get('price') or {}
            pack = _pack(title, p.get('packaging'))
            if not pack:
                continue
            n, l = pack
            name = _name(title)
            src = BASE + (g.get('canonicalUrl') or g.get('canonicalPath') or '')
            price, old = p.get('price'), p.get('oldPrice')
            disc = p.get('discount') or {}
            end = (p.get('endDate') or '')[:10] or None
            if old and old > price and not disc.get('fromRecommendedPrice'):
                e = entry('DE', 'lidl', name, n, l, old, src, note='Onlineshop')
                if e:
                    out.append(e)
                e = entry('DE', 'lidl', name, n, l, price, src, promo=True,
                          note=f'Aktion (Onlineshop), statt {_eur(old)} €',
                          valid_until=end if end and end >= TODAY else None)
            else:
                note = 'Onlineshop' + (f', UVP {_eur(old)} €' if old and old > price else '')
                e = entry('DE', 'lidl', name, n, l, price, src, note=note)
            if e:
                out.append(e)
        time.sleep(0.5)
    return out
