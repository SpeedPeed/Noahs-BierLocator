"""ALDI SUISSE: Kategorie "Bier" + alkoholfreie Biere/Panachés (Produkt-API der Website aldi-suisse.ch).

Die Website lädt ihre Produktlisten von asl.api.aldi-suisse.ch (öffentlich, ohne Login).
Preise gelten für die Standard-Filiale der Website (servicePoint E172); ALDI SUISSE hat
landesweit einheitliche Preise.
"""
import re
import time

from .common import get_json, parse_pack, entry

API = 'https://asl.api.aldi-suisse.ch/commerce/v3/product-search'
HEADERS = {'Origin': 'https://www.aldi-suisse.ch', 'Referer': 'https://www.aldi-suisse.ch/'}
CATEGORIES = {
    '158816141843303602': None,  # Alkohol & Tabakwaren > Bier
    '158816141843303501': re.compile(r'bier|panach|radler|lager|pils', re.I),  # Alkoholfreie Weine, Spirituosen & Biere
}
AKTIONEN = '1588161418433031'
NOT_BEER = re.compile(r'cider|somersby|apple|hugo|wein|sparkling|spritz', re.I)


def _chf(display):
    m = re.search(r'(\d+(?:\.\d+)?)', (display or '').replace("'", ''))
    return float(m.group(1)) if m else None


def _search(cat):
    offset, out = 0, []
    while True:
        url = (f'{API}?currency=CHF&serviceType=walk-in&categoryKey={cat}&limit=60&offset={offset}'
               f'&sort=relevance&servicePoint=E172')
        d = get_json(url, HEADERS)
        out += d.get('data', [])
        total = d.get('meta', {}).get('pagination', {}).get('totalCount', 0)
        offset += 60
        if offset >= total:
            return out
        time.sleep(0.6)


def scrape():
    out, seen = [], set()
    for cat, name_filter in CATEGORIES.items():
        for p in _search(cat):
            if p['sku'] in seen:
                continue
            seen.add(p['sku'])
            brand, title = (p.get('brandName') or '').strip(), (p.get('name') or '').strip()
            full = f'{brand} {title}'
            if NOT_BEER.search(full) or (name_filter and not name_filter.search(title)):
                continue
            pack = parse_pack(p.get('sellingSize') or '') or parse_pack(title)
            if not pack:
                continue
            n, l = pack
            # Gebinde ("pac") mit Einzelvolumen, aber ohne Stückzahl (z.B. Dosen-Tray) → nicht auswertbar
            if p.get('quantityUnit') == 'pac' and n == 1 and l < 1:
                continue
            title = re.sub(r'^Bier,\s*', '', title)
            if brand and title.lower().startswith(brand.lower()):
                title = title[len(brand):].strip(' ,')
            beer = f'{brand.title()} {title}'.strip()
            src = f"https://www.aldi-suisse.ch/de/produkt/{p['urlSlugText']}-{p['sku']}"
            price = (p.get('price') or {}).get('amountRelevant') or (p.get('price') or {}).get('amount')
            if not price:
                continue
            price /= 100
            was = _chf((p.get('price') or {}).get('wasPriceDisplay'))
            in_aktion = any(c.get('id') == AKTIONEN for c in p.get('categories') or [])
            if in_aktion and was and was > price + 0.001:
                # befristete Aktion: Normalpreis + Aktionspreis
                e = entry('CH', 'aldi', beer, n, l, was, src, currency='CHF')
                a = entry('CH', 'aldi', beer, n, l, price, src, promo=True, currency='CHF',
                          note=f'Aktion, statt CHF {was:.2f}')
                out += [x for x in (e, a) if x]
            elif in_aktion:
                # Aktionsartikel ohne Dauersortiment-Preis (nur solange Vorrat)
                a = entry('CH', 'aldi', beer, n, l, price, src, promo=True, currency='CHF',
                          note='Aktionsartikel, solange Vorrat')
                if a:
                    out.append(a)
            else:
                # Dauersortiment; "Tiefpreis" (dauerhafte Preissenkung) gilt als Normalpreis
                e = entry('CH', 'aldi', beer, n, l, price, src, currency='CHF')
                if e:
                    out.append(e)
        time.sleep(0.6)
    return out
