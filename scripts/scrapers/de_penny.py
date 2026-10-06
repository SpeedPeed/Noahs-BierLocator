"""PENNY Deutschland: Bier aus den Wochenangeboten (penny.de/angebote).

PENNY hat kein Online-Sortiment. Die Angebotsseite lädt pro Kategorie JSON von
/.rest/offers/by-category/<JJJJ-WW>/<kategorie> (ohne ?region=… = überregionale Angebote,
regionale Angebote gibt es nur mit gewähltem Markt → nicht verwendet).
Kategorienamen und Wochen werden aus der Angebotsseite gelesen. Die Kategorie
"dauerhaft-im-preis-gesenkt" enthält dauerhafte Preissenkungen → promo=False.
Preise ohne Pfand.
"""
import datetime
import re
import time

from .common import get_json, get_text, parse_pack, entry, TODAY

BASE = 'https://www.penny.de'
PAGE = f'{BASE}/angebote'
API = f'{BASE}/.rest/offers/by-category'

BEER = re.compile(
    r'bier|pils|radler|weizen|weißbier|helles|\bhell\b|\blager\b|\bexport\b|\bbock\b|märzen|alster|kölsch|'
    r'\bipa\b|\bale\b|stout|desperados|cerveza|estrella|mahou|kellerbier|landbier|urtyp|zwickl', re.I)
NOT_BEER = re.compile(r'couscous|ebly|mehl|brot|nudel|grieß|flocken|schinken|wurst|senf', re.I)
PERMANENT = {'dauerhaft-im-preis-gesenkt'}


def _price(v):
    m = re.search(r'\d+(?:[.,]\d+)?', str(v or ''))
    return float(m.group(0).replace(',', '.')) if m else None


def _eur(v):
    return f'{v:.2f}'.replace('.', ',')


def _week_range(week):
    y, w = (int(x) for x in week.split('-'))
    mon = datetime.date.fromisocalendar(y, w, 1)
    return mon, mon + datetime.timedelta(days=5)  # Mo–Sa


def _name(title):
    t = re.sub(r'[*¹²³⁴]+', '', title).strip()
    return ' '.join(w.capitalize() if len(w) > 1 and w.isupper() else w for w in t.split())


def scrape():
    html = get_text(PAGE)
    cats = sorted(set(re.findall(r'data-category-name="([^"]+)"', html)))
    weeks = [w for w in re.findall(r'data-(?:current|next)-week="([\d-]+)"', html)]
    out, seen = [], set()
    for week in dict.fromkeys(weeks):
        start, end = _week_range(week)
        if end.isoformat() < TODAY:
            continue
        for cat in cats:
            try:
                d = get_json(f'{API}/{week}/{cat}', retries=1)
            except Exception:
                continue  # Woche (noch) nicht veröffentlicht → 404
            finally:
                time.sleep(0.5)
            for t in d.get('offerTiles', []):
                title = t.get('title') or ''
                if not BEER.search(title) or NOT_BEER.search(title):
                    continue
                pack = parse_pack(t.get('quantity') or '') or parse_pack(title)
                if not pack:
                    continue
                n, l = pack
                price = _price(t.get('price'))
                name = _name(title)
                src = BASE + t['linkHref'] if t.get('linkHref') else PAGE
                key = (name, n, l, price, week)
                if key in seen:
                    continue
                seen.add(key)
                if cat in PERMANENT:
                    e = entry('DE', 'penny', name, n, l, price, src)
                else:
                    note = 'Aktion'
                    if start.isoformat() > TODAY:
                        note += f' ab {start.day:02d}.{start.month:02d}.'
                    orig = _price(t.get('originalPrice'))
                    if orig and t.get('showOriginalPrice', True):
                        note += f", statt {'UVP ' if t.get('originalPriceType') == 'uvp' else ''}{_eur(orig)} €"
                    if t.get('multiBuy'):
                        note += ' (Mehrfachkauf)'
                    e = entry('DE', 'penny', name, n, l, price, src, promo=True, note=note,
                              valid_until=end.isoformat(), valid_from=start.isoformat())
                if e:
                    out.append(e)
    return out
