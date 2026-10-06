"""PENNY Österreich: Bier-Angebote aus der Kategorie "Bier & Radler" von penny.at.

penny.at führt online KEIN Gesamtsortiment, nur die aktuellen Angebote (Wochenangebote, Wochenstarter,
Wochenend-Kick). Diese liefert dieselbe JSON-API wie der BILLA-Shop. Erfasst werden laufende und angekündigte
Angebote (promo=True, valid_until = Angebotsende, bei künftigen "gültig ab" in der Notiz). Weist die API zusätzlich einen Standardpreis aus
(price.standard), wird dieser als Normalpreis (promo=False) übernommen.
"""
import re

from .common import get_json, entry, TODAY

BASE = 'https://www.penny.at'
CATEGORY = 'bier-und-radler-13026'
HEADERS = {'Referer': f'{BASE}/kategorie/{CATEGORY}'}
SKIP_NAME = re.compile(r'cider|\bmost\b|ginger beer', re.I)


def _pack(p):
    try:
        amount = float(str(p.get('amount', '')).replace(',', '.'))
    except ValueError:
        return None
    if p.get('volumeLabelShort') != 'liter' or amount <= 0:
        return None
    m = re.search(r'\b(\d+)er\b', f"{p.get('bundleInfo', '')} {p.get('name', '')}")
    if m:
        n = int(m.group(1))
        return (n, round(amount / n, 3)) if p.get('packageLabel') in ('Packung', 'Kiste', 'Tray') else (n, amount)
    if p.get('packageLabel') == 'Kiste':
        # Kisten nennt PENNY nur mit Gesamtmenge; Standardkisten zurückrechnen.
        if abs(amount - 10) < 0.01:
            return 20, 0.5
        if abs(amount - 7.92) < 0.01:
            return 24, 0.33
    return 1, amount


def _names(p):
    brand = (p.get('brand') or {}).get('name', '')
    n = re.sub(r'[¹²³*]+', '', p.get('name', '')).strip()
    n = re.sub(r'\s*div\.\s*sorten', '', n, flags=re.I)
    parts = [s.strip() for s in re.split(r'\s+od(?:er|\.)\s+', n)] if ' od' in n else [n]
    out = []
    for s in parts:
        if brand and not s.lower().startswith(brand.lower()):
            s = f'{brand} {s}' if s.lower() not in ('bier',) else f'{brand} Bier'
        out.append(re.sub(r'\s{2,}', ' ', s).strip())
    return out


def scrape():
    d = get_json(f'{BASE}/api/product-discovery/categories/{CATEGORY}/products?page=0&pageSize=500', HEADERS)
    out = []
    for p in d.get('results', []):
        if SKIP_NAME.search(p.get('name', '')):
            continue
        price = p.get('price') or {}
        start, end = price.get('validityStart'), price.get('validityEnd')
        if end and end < TODAY:
            continue  # Angebot abgelaufen
        pk = _pack(p)
        if not pk:
            continue
        n, l = pk
        reg = price.get('regular') or {}
        cur = reg.get('value')
        std = (price.get('standard') or {}).get('value')
        if not cur:
            continue
        src = f"{BASE}/produkte/{p.get('slug', '')}"
        for name in _names(p):
            if std and std > cur:
                e = entry('AT', 'penny', name, n, l, std / 100, src)
                if e:
                    out.append(e)
                note = f'Aktion, statt {std / 100:.2f} €'.replace('.', ',')
            else:
                note = 'Aktion'
            extra = []
            if reg.get('promotionText'):
                extra.append(reg['promotionText'])
            elif reg.get('promotionType') == 'FROM' and reg.get('promotionQuantity'):
                extra.append(f"ab {int(reg['promotionQuantity'])} Stück")
            if start and start > TODAY:
                extra.append(f'gültig ab {start[8:10]}.{start[5:7]}.')
            if extra:
                note += f" ({', '.join(extra)})"
            e = entry('AT', 'penny', name, n, l, cur / 100, src, promo=True, note=note, valid_until=end, valid_from=(start[:10] if start else None))
            if e:
                out.append(e)
    return out
