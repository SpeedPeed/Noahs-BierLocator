"""EDEKA (edeka24.de, bundesweiter Versandshop): komplette Kategorie "Getränke > Bier".

OXID-Shop, die Produktliste ist serverseitig gerendert und wird über ?pgNr=N paginiert
(30 Artikel pro Seite). Reduzierte Artikel tragen die Klasse "price salesprice" und
"Niedrigster Preis: X €" (niedrigster Preis der letzten 30 Tage).
"""
import html as htmllib
import re
import time

from .common import get_text, parse_pack, entry, strip_pack

CATEGORY = 'https://www.edeka24.de/Getraenke-2/Bier/'  # bis 11/2026: /Getraenke/Bier/

ITEM = re.compile(r'<div class="product-details">(.*?)<div class="product-action', re.S)
# id bis 11/2026 "listitem_<n>", seitdem "productList_<Artikelnr>"; ?force_sid=… (Sitzung) fällt weg
LINK = re.compile(r'<a id="(?:listitem|productList)_\w+" href="([^"?]+)[^"]*" class="title" title="([^"]*)"')
PRICE = re.compile(r'<div class="price( salesprice)?">\s*([\d.]+,\d{2})')
LOWEST = re.compile(r'Niedrigster Preis:\s*([\d.]+,\d{2})')


def _num(s):
    return float(s.replace('.', '').replace(',', '.'))


def scrape():
    out, seen, page = [], set(), 0
    while page < 20:
        url = CATEGORY if page == 0 else f'{CATEGORY}?pgNr={page}'
        html = get_text(url)
        items = ITEM.findall(html)
        new = 0
        for it in items:
            m = LINK.search(it)
            p = PRICE.search(it)
            if not m or not p:
                continue
            src, title = m.group(1), htmllib.unescape(m.group(2)).strip()
            if src in seen:
                continue
            seen.add(src)
            new += 1
            pack = parse_pack(title)
            if not pack:
                continue
            n, l = pack
            name = strip_pack(title)
            price = _num(p.group(2))
            if p.group(1):  # reduziert
                low = LOWEST.search(it)
                note = f'Aktion, statt {low.group(1)} €' if low else 'Aktion'
                e = entry('DE', 'edeka', name, n, l, price, src, promo=True, note=note)
            else:
                e = entry('DE', 'edeka', name, n, l, price, src)
            if e:
                out.append(e)
        if not new:
            break
        page += 1
        time.sleep(2)  # robots.txt: Crawl-delay 2
    return out
