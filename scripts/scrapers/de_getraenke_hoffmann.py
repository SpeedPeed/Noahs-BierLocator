"""Getränke Hoffmann: Bier aus den "Highlight"-Angeboten der Angebotsseite (ohne PLZ).

Ohne Postleitzahl zeigt getraenke-hoffmann.de/angebote nur die überregionalen Highlight-
Angebote dieser und der nächsten Woche (serverseitig gerendert, Drupal-Slider). Das volle
regionale Angebot gibt es nur nach PLZ-Eingabe → nicht verwendet. Preise ohne Pfand.
"""
import datetime
import html as htmllib
import re

from .common import get_text, parse_pack, entry, TODAY

PAGE = 'https://www.getraenke-hoffmann.de/angebote'
BEER = re.compile(
    r'bier|pils|radler|weizen|weiß|weiss|helles|\bhell\b|\blager\b|\bexport\b|\bbock\b|märzen|alster|kölsch|'
    r'\balt\b|\bipa\b|\bale\b|stout|porter|dunkel|kellerbier|landbier|urtyp|zwickl', re.I)
NOT_BEER = re.compile(r'whisk|vodka|wodka|likör|rum\b|gin\b|wein|riesling|burgunder|rosé|rose\b|blanc|batida|sekt|% vol', re.I)


def _clean(s):
    s = re.sub(r'<br\s*/?>|</p>', '\n', s)
    return htmllib.unescape(re.sub(r'<[^>]+>', '', s)).replace('\xa0', ' ')


def scrape():
    page = get_text(PAGE)
    out = []
    for sec in page.split('<section id="p-sliderelement-')[1:]:
        head = re.search(r'p-sliderelement__headline">(.*?)</h3>', sec, re.S)
        text = re.search(r'p-sliderelement__text">(.*?)</div>', sec, re.S)
        dates = re.findall(r'<time datetime="(\d{4}-\d\d-\d\d)', sec)
        alt = re.search(r'alt="([^"]*)"', sec)
        if not head or not text:
            continue
        head = _clean(head.group(1)).strip(' *')
        alt = htmllib.unescape(alt.group(1)).strip() if alt else ''
        body = _clean(text.group(1))
        if not BEER.search(f'{head} {alt} {body}') or NOT_BEER.search(f'{head} {alt} {body}'):
            continue
        pm = re.search(r'(\d+,\d{2})\s*EUR', body)
        if not pm:
            continue
        price = float(pm.group(1).replace(',', '.'))
        lines = [l.strip() for l in body.split('\n') if l.strip()]
        pack_line = next((l for l in lines if parse_pack(l) and not l.lower().startswith('liter')), '')
        pack = parse_pack(pack_line)
        if not pack:
            continue
        n, l = pack
        start, end = (dates + [None, None])[:2]
        if end and end < TODAY:
            continue
        name = alt or head.title()
        variants = lines[0] if lines and not re.search(r'EUR', lines[0]) else ''
        note = 'Aktion'
        if start and start > TODAY:
            d = datetime.date.fromisoformat(start)
            note += f' ab {d.day:02d}.{d.month:02d}.'
        if variants and variants.lower() not in name.lower():
            note += f' ({variants})'
        if 'nicht in allen filialen' in body.lower():
            note += '; nicht in allen Filialen'
        e = entry('DE', 'getraenke_hoffmann', name, n, l, price, PAGE, promo=True, note=note, valid_until=end, valid_from=start)
        if e:
            out.append(e)
    return out
