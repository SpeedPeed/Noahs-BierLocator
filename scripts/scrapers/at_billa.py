"""BILLA Österreich: Kategorien "Bier" und "Radler & Cider" des BILLA Online Shops (gilt für BILLA und BILLA PLUS).

Nutzt die JSON-API, die shop.billa.at selbst aufruft (ohne Markt-/Lieferadresse → Standard-Onlinepreise).
Preise ohne Pfand (die API weist das Pfand getrennt als depositPrice aus).
"""
import re
import time

from .common import get_json, parse_pack, entry, strip_pack

BASE = 'https://shop.billa.at'
CATEGORIES = ['bier-13796', 'radler-und-cider-15618']
SKIP_CATEGORIES = {'Cider', 'Dessertwein & Portwein'}
SKIP_NAME = re.compile(r'cider|\bmost\b|ginger beer|matcha|^hops\b', re.I)
HEADERS = {'Referer': f'{BASE}/kategorie/bier-13796'}


def _pack(p):
    """→ (anzahl, liter_pro_stück) aus Name, Gebinde-Info und Füllmenge."""
    name, bundle = p.get('name', ''), p.get('bundleInfo', '') or ''
    try:
        amount = float(str(p.get('amount', '')).replace(',', '.'))
    except ValueError:
        return None
    pk = parse_pack(name)
    if pk and pk[0] > 1:
        return pk
    m = re.search(r'(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\b', name, re.I)  # "6x0,5" ohne Einheit
    if m:
        return int(m.group(1)), float(m.group(2).replace(',', '.'))
    m = re.search(r'\b(\d+)er\b', name) or re.search(r'\b(\d+)er\b', bundle)
    if m:
        n = int(m.group(1))
        # Bei "Packung" ist amount die Gesamtmenge, bei Kiste/Tray die Menge pro Flasche.
        per = amount / n if p.get('packageLabel') == 'Packung' else amount
        return n, round(per, 3)
    return 1, amount


def _name(p):
    n = (p.get('name') or '').replace('\xa0', ' ')
    n = re.sub(r'\b\d+\s*x\s*\d+(?:[.,]\d+)?\s*l?\b', '', n, flags=re.I)
    n = re.sub(r'\b\d+er\b', '', strip_pack(n))
    n = n.replace("'", '')
    return re.sub(r'\s{2,}', ' ', n).strip(' ,-')


def _fetch(slug):
    d = get_json(f'{BASE}/api/product-discovery/categories/{slug}/products?page=0&pageSize=500', HEADERS)
    res = list(d.get('results', []))
    page = 1
    while len(res) < d.get('total', 0) and page < 20:
        time.sleep(0.6)
        d = get_json(f'{BASE}/api/product-discovery/categories/{slug}/products?page={page}&pageSize=500', HEADERS)
        if not d.get('results'):
            break
        res += d['results']
        page += 1
    return res


def scrape():
    out, seen = [], set()
    for i, slug in enumerate(CATEGORIES):
        if i:
            time.sleep(0.6)
        for p in _fetch(slug):
            sku = p.get('sku')
            if sku in seen or p.get('category') in SKIP_CATEGORIES:
                continue
            seen.add(sku)
            if p.get('volumeLabelShort') != 'liter' or SKIP_NAME.search(p.get('name', '')):
                continue
            pk = _pack(p)
            if not pk:
                continue
            n, l = pk
            name = _name(p)
            src = f"{BASE}/produkte/{p.get('slug', '')}"
            price = p.get('price') or {}
            cur = (price.get('regular') or {}).get('value')
            std = (price.get('standard') or {}).get('value')
            if not cur:
                continue
            promo = bool(p.get('inPromotion') and std and std > cur)
            base = std if promo else cur
            e = entry('AT', 'billa', name, n, l, base / 100, src)
            if e:
                out.append(e)
            if promo:
                note = f'Aktion, statt {std / 100:.2f} €'.replace('.', ',')
                txt = (price.get('regular') or {}).get('promotionText')
                if txt:
                    note += f' ({txt})'
                e = entry('AT', 'billa', name, n, l, cur / 100, src, promo=True, note=note)
                if e:
                    out.append(e)
    return out
