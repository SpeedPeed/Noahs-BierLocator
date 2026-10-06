"""SPAR Österreich: komplette Kategorie "Bier" der SPAR-Produktwelt (gilt für SPAR, EUROSPAR, INTERSPAR)."""
from .common import get_json, parse_pack, entry, strip_pack

API = 'https://api-scp.spar-ics.com/ecom/pw/v1/search/v1/navigation'
HEADERS = {'Origin': 'https://www.spar.at', 'Referer': 'https://www.spar.at/'}


def scrape():
    out, page = [], 1
    while True:
        url = f'{API}?query=*&sort=Relevancy:asc&page={page}&marketId=8999&filter=pwCategoryIds%3Abier&hitsPerPage=100'
        d = get_json(url, HEADERS)
        for hit in d.get('hits', []):
            mv = hit['masterValues']
            geo = next((g['geoValues'] for g in mv.get('geoInformation', []) if g.get('market') == '8999'), None)
            if not geo:
                continue
            text = f"{mv.get('name2', '')} {mv.get('name3', '')}"
            pack = parse_pack(mv.get('name2', '')) or parse_pack(mv.get('name3', ''))
            if not pack:
                continue
            n, l = pack
            name = f"{mv.get('name1', '')} {strip_pack(mv.get('name2', ''))}".strip()
            src = f"https://www.spar.at/produktwelt/{mv.get('slug', '')}"
            base, cur = geo.get('basePrice'), geo.get('calculatedPrice')
            e = entry('AT', 'spar', name, n, l, base or cur, src)
            if e:
                out.append(e)
            if geo.get('inAngebot') and cur and base and cur < base - 0.001:
                p = entry('AT', 'spar', name, n, l, cur, src, promo=True, note=f'Aktion, statt {base:.2f} €'.replace('.', ','))
                if p:
                    out.append(p)
        if page >= d.get('paging', {}).get('pageCount', 1):
            break
        page += 1
    return out
