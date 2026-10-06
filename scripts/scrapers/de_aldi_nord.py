"""ALDI Nord Deutschland: Sortimentskategorie "Bier" + Bier-Artikel aus den aktuellen Angeboten.

Die Seiten sind serverseitig gerendert (Next.js); die Produktdaten (Algolia-Treffer) stecken
als JSON in <script id="__NEXT_DATA__">. Es gibt keinen Online-Shop, die Preise sind die
bundesweiten Filialpreise (ohne Pfand).
"""
import datetime
import json
import re
import time

from .common import get_text, parse_pack, entry, TODAY

BASE = 'https://www.aldi-nord.de'
CATEGORY = f'{BASE}/sortiment/alkoholische-getraenke/bier.html'
OFFERS = f'{BASE}/angebote.html'

BEER = re.compile(r'bier|pils|radler|weizen|helles|\blager\b|\bexport\b|\bbock\b|\bipa\b|\bale\b|kellerbier|märzen|alster|diesel', re.I)


def _next_data(url):
    html = get_text(url)
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    return json.loads(m.group(1)) if m else {}


def _products(x, out):
    """Sucht rekursiv alle Algolia-Produktobjekte (auch in JSON-Strings verpackt)."""
    if isinstance(x, dict):
        if 'objectID' in x and 'currentPrice' in x:
            out[x['objectID']] = x
            return out
        for v in x.values():
            _products(v, out)
    elif isinstance(x, list):
        for v in x:
            _products(v, out)
    elif isinstance(x, str) and len(x) > 50 and x[:1] in '[{' and 'objectID' in x:
        try:
            _products(json.loads(x), out)
        except ValueError:
            pass
    return out


def _pack(sales_unit):
    # "0,5-L-Dose", "6x0,5-Liter-Flasche", "20x0,5-L-Kasten"
    t = re.sub(r'liter', 'l', sales_unit.replace('-', ' '), flags=re.I)
    return parse_pack(t)


def _eur(v):
    return f'{v:.2f}'.replace('.', ',')


def _entries(p, promo_only=False):
    out = []
    pack = _pack(p.get('salesUnit') or '')
    if not pack:
        return out
    n, l = pack
    name = ' '.join(s for s in [(p.get('brandName') or '').title(), p.get('name') or ''] if s).strip()
    src = f"{BASE}/produkt/{p.get('productSlug')}.html" if p.get('productSlug') else CATEGORY
    cur = p.get('currentPrice') or {}
    price = cur.get('priceValue')
    strike = (cur.get('strikePrice') or {}).get('strikePriceValue')
    uvp = (cur.get('strikePrice') or {}).get('strikePriceLabel') == 'UVP'
    promos = p.get('promotionPrices') or []
    promo = next((pp for pp in promos if (pp.get('validUntilLocalDate') or '9999') >= TODAY), None)
    if promo and not promo_only and not strike:
        # Aktionspreis ohne Streichpreis: Normalpreis unbekannt → nur als Aktion führen
        promo_only = True
    if not promo_only and not promo:
        e = entry('DE', 'aldi_nord', name, n, l, price, src)
        if e:
            out.append(e)
        return out
    if promo:
        pprice = promo.get('priceValue') or price
        if strike and not uvp and not promo_only:
            e = entry('DE', 'aldi_nord', name, n, l, strike, src)
            if e:
                out.append(e)
        start = promo.get('validFromLocalDate')
        note = 'Aktion'
        if start and start > TODAY:
            d = datetime.date.fromisoformat(start)
            note += f' ab {d.day:02d}.{d.month:02d}.'
        if strike:
            note += f", statt {'UVP ' if uvp else ''}{_eur(strike)} €"
        e = entry('DE', 'aldi_nord', name, n, l, pprice, src, promo=True, note=note,
                  valid_until=promo.get('validUntilLocalDate'), valid_from=start)
        if e:
            out.append(e)
    return out


def scrape():
    out, seen = [], set()
    cat = _products(_next_data(CATEGORY), {})
    for p in cat.values():
        out += _entries(p)
        seen.add(p['objectID'])
    time.sleep(0.5)
    offers = _products(_next_data(OFFERS), {})
    for oid, p in offers.items():
        if oid in seen:
            continue
        text = f"{p.get('name', '')} {p.get('shortDescription', '')}"
        if not BEER.search(text) or not re.search(r'\d\s*-?\s*(l|liter|ml)\b', p.get('salesUnit') or '', re.I):
            continue
        out += _entries(p, promo_only=True)
    return out
