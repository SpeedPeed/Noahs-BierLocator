"""Migros: alkoholfreie Biere, Panachés und Radler (migros.ch, Filial-Sortiment national).

Die Migros verkauft (bis auf Cider) kein alkoholhaltiges Bier; erfasst wird die Kategorie
"Wein, Bier & Spirituosen > Alkoholfreie Getränke > Biere & Cider" (ID 10614101) sowie zur
Sicherheit "Bier & Cider" (ID 7494789).

Ablauf wie auf der Website: anonymes Gast-Token (Header "leshopch") holen, Produkt-IDs der
Kategorie abfragen, dann die Produktkarten (Preis, Gebinde, Aktion) laden.
"""
import os
import re
import subprocess
import time

from .common import UA, get_json, parse_pack, entry

BASE = 'https://www.migros.ch'
CATEGORIES = ['10614101', '7494789']
NOT_BEER = re.compile(r'ginger beer|cider|moscht|\bmost\b|saft vom fass|apple|apfel|stellare|chill & relax', re.I)


def _guest_token():
    # Das Token steht nur im Antwort-Header, daher direkt per curl (wie common._curl).
    r = subprocess.run(['curl', '-sS', '--max-time', '30', '-D', '-', '-o', os.devnull,
                        '-A', UA, '-H', 'Peer-Id: website-js-1272.0.0',
                        f'{BASE}/authentication/public/v1/api/guest?authorizationNotRequired=true'],
                       capture_output=True)
    m = re.search(r'^leshopch:\s*(\S+)', r.stdout.decode('utf-8', 'replace'), re.I | re.M)
    if not m:
        raise RuntimeError('Migros: kein Gast-Token erhalten')
    return m.group(1)


def scrape():
    h = {'leshopch': _guest_token(), 'Peer-Id': 'website-js-1272.0.0', 'migros-language': 'de',
         'accept-language': 'de', 'Origin': BASE, 'Referer': f'{BASE}/de'}
    ids = []
    for cat in CATEGORIES:
        offset = 0
        while True:
            time.sleep(0.6)
            d = get_json(f'{BASE}/product-display/public/web/v1/products/category/{cat}/search', h, {
                'regionId': 'national', 'language': 'de', 'sortFields': [], 'sortOrder': 'asc',
                'from': offset, 'limit': 100, 'filters': {}, 'searchAlgorithm': 'DEFAULT',
                'enabledSponsoredProducts': False})
            batch = d.get('productIds') or [i['id'] for i in d.get('items', [])]
            ids += [i for i in batch if i not in ids]
            offset += 100
            if not batch or offset >= d.get('numberOfProducts', 0):
                break

    today = time.strftime('%Y-%m-%dT00:00:00')
    out = []
    for i in range(0, len(ids), 50):
        time.sleep(0.6)
        cards = get_json(f'{BASE}/product-display/public/v4/product-cards', h, {
            'offerFilter': {'storeType': 'OFFLINE', 'region': 'national', 'ongoingOfferDate': today},
            'productFilter': {'uids': ids[i:i + 50]}})
        for p in cards:
            title = p.get('title') or p.get('description') or ''
            if NOT_BEER.search(title):
                continue
            o = p.get('offer') or {}
            pack = parse_pack(o.get('quantity') or '') or parse_pack(title)
            tp = parse_pack(title)
            if pack and tp and tp[0] > pack[0]:
                pack = tp  # z.B. Titel "6x33 cl", Mengenfeld nur "330 ml"
            if not pack:
                continue
            n, l = pack
            # "Marke · Name · Zusatz" → "Marke Name Zusatz" (ohne Gebindeangabe)
            beer = ' '.join(s.strip() for s in title.split('·') if s.strip())
            beer = re.sub(r'\s*\d+\s*x\s*\d+\s*(cl|ml)\b', '', beer, flags=re.I).strip()
            src = p.get('productUrls') or f"{BASE}/de/product/{p.get('migrosId')}"
            price = (o.get('price') or {}).get('effectiveValue')
            e = entry('CH', 'migros', beer, n, l, price, src, currency='CHF')
            if e:
                out.append(e)
            promo = (o.get('promotionPrice') or {}).get('effectiveValue')
            badges = {b.get('type') for b in o.get('badges') or []}
            if promo and price and promo < price - 0.001 and 'MINIMUM_PIECES' not in badges:
                end = (o.get('promotionDateRange') or {}).get('endDate')
                a = entry('CH', 'migros', beer, n, l, promo, src, promo=True, currency='CHF',
                          note=f'Aktion, statt CHF {price:.2f}', valid_until=end)
                if a:
                    out.append(a)
    return out
