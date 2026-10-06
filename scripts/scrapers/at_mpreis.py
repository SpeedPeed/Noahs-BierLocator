"""MPREIS: komplette Kategorie "Bier" (Bier, alkoholfreies Bier, Radler) des MPREIS-Onlinesortiments.

Nutzt den Algolia-Proxy, den mpreis.at/shop selbst aufruft, mit dem Standard-Preisgebiet 8450,
das die Seite ohne Marktauswahl verwendet. Preise ohne Pfand (Pfand wird getrennt ausgewiesen).
"""
import re
import time

from .common import get_json, parse_pack, entry, strip_pack

API = 'https://algolia-webhook.mpreis.at/algolia-proxy/1/indexes/*/queries?X-Algolia-Application-Id=UZXORS8TL2&X-Algolia-Agent=Vue.js'
HEADERS = {'Origin': 'https://www.mpreis.at', 'Referer': 'https://www.mpreis.at/'}
CATEGORY = '42784307'  # Getränke > Bier
SITE = '8450'          # Standard-Preisgebiet ohne gewählten Markt
SKIP_NAME = re.compile(r'cider|\bmost\b|ginger beer|spritzer|kandi malz', re.I)

_UML = str.maketrans({'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', 'Ä': 'ae', 'Ö': 'oe', 'Ü': 'ue'})


def _slug(s):
    s = s.translate(_UML).lower()
    s = re.sub(r"[.,'´`%]", '', s)
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def _ml(s):
    m = re.match(r'\s*(\d+(?:[.,]\d+)?)\s*(ml|cl|l)\b', s or '', re.I)
    if not m:
        return None
    v = float(m.group(1).replace(',', '.'))
    u = m.group(2).lower()
    return v / 1000 if u == 'ml' else v / 100 if u == 'cl' else v


def _pack(prod, desc, unit):
    """→ (anzahl, liter_pro_stück). Gesamtmenge aus packagingUnit, Einzelmenge aus dem Namen."""
    total = _ml(unit)
    pk = parse_pack(prod) or parse_pack(desc)
    if pk and pk[0] > 1:
        return pk
    pd = parse_pack(desc)
    if pk and pd and total and pd != pk and abs(pd[0] * pd[1] - total) < 0.005:
        pk = pd  # Name und Beschreibung widersprechen sich → die zur Füllmenge passende Angabe
        if pk[0] > 1:
            return pk
    if pk and total and total > pk[1] * 1.5:
        n = round(total / pk[1])
        if abs(n * pk[1] - total) < 0.02:
            return n, pk[1]
    if pk:
        return pk
    if total:
        m = re.search(r'\b(\d+)\s*(?:er|x)\b', f'{prod} {desc}', re.I)
        if m and int(m.group(1)) > 1:
            n = int(m.group(1))
            return n, round(total / n, 3)
        return 1, total
    return None


def _name(brand, prod):
    n = prod
    n = re.sub(r'\d+\s*x\s*\d+(?:[.,]\d+)?\s*(liter|lt\.?|l|ml)?\b', '', n, flags=re.I)
    n = re.sub(r'(?<![\d.,])[.,]?\d*[.,]\d+\s*(lt\.?|liter|l)(?!\w)', '', n, flags=re.I)
    n = strip_pack(n)
    n = re.sub(r'\b(tray|kiste|\d+er|mehrweg-flasche|einweg-flasche|mehrweg|einweg|dose|flasche|'
               r'einzelflasche|einzelfl\.?|packung|pack)(?!\w)', '', n, flags=re.I)
    n = re.sub(r'\(\s*\)|\s-(?=\s|$)', ' ', n)
    n = re.sub(r'\s{2,}', ' ', n).strip(' ,.-')
    if brand:
        bw = [w.lower() for w in brand.split()]
        words = n.split()
        while words and words[0].lower() in bw:
            words.pop(0)
        n = ' '.join(words)
        if bw[0][:6] not in n.lower():
            n = f'{brand} {n}'
    return n.strip()


def _query(page):
    return {'requests': [{
        'indexName': 'main', 'query': '', 'hitsPerPage': 1000, 'page': page,
        'facetFilters': [[f'category_ids:{CATEGORY}']],
        'attributesToRetrieve': ['code', 'name', 'description', 'categories',
                                 'mixins.markantAttributes.data.description.brandName',
                                 'mixins.mpreisAttributes.productName',
                                 'mixins.productCustomAttributes.packagingUnit',
                                 'prices', f'sitePrices.{SITE}'],
        'attributesToHighlight': [],
        'filters': f'available:true AND priceMissing:false AND categoriesMissing:false AND sitePrices.{SITE}.effective > 0',
    }]}


def _hits():
    hits, page = [], 0
    while True:
        r = get_json(API, HEADERS, _query(page))['results'][0]
        hits += r.get('hits', [])
        page += 1
        if page >= r.get('nbPages', 1):
            return hits
        time.sleep(0.6)


def scrape():
    out = []
    for h in _hits():
        mx = h.get('mixins') or {}
        brand = (((mx.get('markantAttributes') or {}).get('data') or {}).get('description') or {}).get('brandName', '')
        prod = (mx.get('mpreisAttributes') or {}).get('productName') or h.get('name', '')
        desc = h.get('description', '')
        if SKIP_NAME.search(f'{brand} {prod} {desc}'):
            continue
        pk = _pack(prod, desc, (mx.get('productCustomAttributes') or {}).get('packagingUnit'))
        if not pk:
            continue
        n, l = pk
        name = _name(brand, prod)
        src = f"https://www.mpreis.at/shop/p/{_slug(f'{brand} {prod}')}-{h.get('code')}"
        sp = (h.get('sitePrices') or {}).get(SITE) or {}
        eff, orig = sp.get('effective'), sp.get('original')
        ptype = sp.get('promotionType') or ''
        is_promo = bool(eff and orig and eff < orig - 0.001 and
                        (ptype or (sp.get('attributes') or {}).get('type') != 'REGULAR_PRICE'))
        base = orig if is_promo else eff
        e = entry('AT', 'mpreis', name, n, l, base, src)
        if e:
            out.append(e)
        if is_promo:
            note = f'Aktion, statt {orig:.2f} €'.replace('.', ',')
            disc = sp.get('discounts') or {}
            whole = sp.get('wholesale') or {}
            if disc.get('forQuantity'):
                note += f" ({ptype}, bei {disc['forQuantity']} Stk. je)"
            elif whole.get('minQuantity'):
                note += f" (ab {whole['minQuantity']} Stk. je)"
            p = entry('AT', 'mpreis', name, n, l, eff, src, promo=True, note=note)
            if p:
                out.append(p)
    return out
