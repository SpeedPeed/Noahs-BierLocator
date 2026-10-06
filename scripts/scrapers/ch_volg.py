"""Volg: Kategorie "Getränke > Bier" des Volg Shops (volgshop.ch, WooCommerce Store-API).

Der Volg Shop ist ein WooCommerce-Shop; die öffentliche Store-API liefert Produkte mit
Normal- und ggf. Aktionspreis (sale_price). Einige Produktnamen nennen ein Gebinde
("6x50cl"), obwohl der Preis für eine Einzeldose gilt – das wird über den angegebenen
100-ml-Preis geprüft und korrigiert.
"""
import html
import re
import time

from .common import get_json, parse_pack, entry, strip_pack

BASE = 'https://www.volgshop.ch'
API = f'{BASE}/wp-json/wc/store/v1/products'
NOT_BEER = re.compile(r'somersby|cider|ginger beer|moscht', re.I)


def _category_ids():
    cats = get_json(f'{API}/categories?per_page=100')
    ids = [c['id'] for c in cats if c.get('slug') == 'bier']
    return ids or [184]


def _attr(p, key):
    for a in p.get('attributes') or []:
        if key in (a.get('name') or '') and a.get('terms'):
            return a['terms'][0].get('name')
    return None


def _check_pack(n, l, price, unit_txt):
    """Gleicht das Gebinde mit dem 100-ml-Preis ab ("100ml = 0,26")."""
    m = re.search(r'100\s*ml\s*=\s*(\d+[.,]\d+)', unit_txt or '')
    if not m or not price:
        return n, l
    per100 = float(m.group(1).replace(',', '.'))
    if per100 <= 0:
        return n, l
    vol = price / per100 * 0.1
    if abs(n * l - vol) / vol > 0.15 and abs(l - vol) / vol <= 0.15:
        return 1, l
    return n, l


def scrape():
    out = []
    for cat in _category_ids():
        page = 1
        while True:
            time.sleep(0.6)
            prods = get_json(f'{API}?category={cat}&per_page=100&page={page}')
            for p in prods:
                name = html.unescape(p.get('name') or '')
                if NOT_BEER.search(name):
                    continue
                pack = parse_pack(_attr(p, 'Mengeneinheit') or '') or parse_pack(name)
                if not pack:
                    continue
                pr = p.get('prices') or {}
                div = 10 ** int(pr.get('currency_minor_unit', 2))
                regular = int(pr.get('regular_price') or 0) / div
                current = int(pr.get('price') or 0) / div
                n, l = _check_pack(*pack, current, _attr(p, '100ml'))
                beer = re.sub(r'\b(alk\.?\s*frei)\b', 'alkoholfrei', strip_pack(name), flags=re.I)
                beer = beer.replace('Orignal', 'Original')
                src = p.get('permalink') or f'{BASE}/produkt-kategorie/getraenke/bier/'
                e = entry('CH', 'volg', beer, n, l, regular or current, src, currency='CHF')
                if e:
                    out.append(e)
                if p.get('on_sale') and regular and current < regular - 0.001:
                    a = entry('CH', 'volg', beer, n, l, current, src, promo=True, currency='CHF',
                              note=f'Aktion, statt CHF {regular:.2f}')
                    if a:
                        out.append(a)
            if len(prods) < 100:
                break
            page += 1
    return out
