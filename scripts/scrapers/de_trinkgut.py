"""trinkgut (Getränkemarkt): Bier aus den aktuellen Angeboten (trinkgut.de/angebote/).

Ohne gewählten Heimatmarkt zeigt die (serverseitig gerenderte, Shopware) Angebotsseite die
nationalen Wochenangebote, gruppiert nach Abschnitten ("Bier", "Wein", …). Für jedes
Bier-Angebot wird die Detailseite gelesen (vollständige Gebindeangabe + Gültigkeit).
Kein Online-Sortiment mit Normalpreisen. Preise ohne Pfand.
"""
import html as htmllib
import re
import time

from .common import get_text, parse_pack, entry, TODAY

PAGE = 'https://www.trinkgut.de/angebote/'
NOT_BEER = re.compile(r'karamalz|vitamalz|malzbier|malztrunk|\bmalz\b', re.I)
PACKS = re.compile(r'(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(ml|cl|l)\b', re.I)


def _clean(s):
    s = re.sub(r'<[^>]+>', ' ', s)
    return re.sub(r'\s+', ' ', htmllib.unescape(s)).strip()


def _packs(desc):
    """Alle Gebinde einer Beschreibung ("Kasten = 20 x 0,5 l / 24 x 0,33 l")."""
    found = []
    for m in PACKS.finditer(desc):
        p = parse_pack(m.group(0))
        if p and p not in found:
            found.append(p)
    if not found:
        p = parse_pack(re.sub(r'\(1\s*l\s*=.*?\)', '', desc))
        if p:
            found.append(p)
    return found


def _iso(d):
    dd, mm, yy = d.split('.')
    return f'{yy}-{mm}-{dd}'


def scrape():
    page = re.sub(r'<svg.*?</svg>', '', get_text(PAGE), flags=re.S)
    parts = re.split(r'<h3 class="h3">([^<]*)</h3>', page)
    m = re.search(r'Gültig vom (\d\d\.\d\d\.\d{4}) bis (\d\d\.\d\d\.\d{4})', page)
    page_until = _iso(m.group(2)) if m else None
    out = []
    for k in range(1, len(parts), 2):
        if _clean(parts[k]).lower() != 'bier':
            continue
        for box in parts[k + 1].split('class="product-box')[1:]:
            href = re.search(r'href="([^"]+)"', box)
            name = re.search(r'product-name">(.*?)</p>', box, re.S)
            if not href or not name:
                continue
            src, name = href.group(1), _clean(name.group(1))
            if NOT_BEER.search(name):
                continue
            regular = re.search(r'<p class="product-price">\s*<span>\s*([\d.,]+)', box)
            app = re.search(r'product-price--app">\s*<span>\s*([\d.,]+)', box)
            if not regular:
                continue
            price = float(regular.group(1).replace(',', '.'))
            desc = _clean(re.search(r'product-description">(.*?)</p>', box, re.S).group(1))
            until = page_until
            time.sleep(0.5)
            try:
                detail = _clean(re.sub(r'<script.*?</script>|<style.*?</style>|<svg.*?</svg>', '',
                                       get_text(src), flags=re.S))
                dm = re.search(r'Beschreibung (.*?)(?: Du bist hier:|$)', detail)
                if dm:
                    desc = dm.group(1)
                vm = re.search(r'Gültig vom (\d\d\.\d\d\.\d{4}) bis (\d\d\.\d\d\.\d{4})', detail)
                if vm:
                    until = _iso(vm.group(2))
            except Exception:
                pass
            if NOT_BEER.search(desc) and not re.search(r'bier|pils', desc, re.I):
                continue
            if until and until < TODAY:
                continue
            note = 'Aktion (nationales Angebot, je nach Markt)'
            if app:
                note += f"; mit App {app.group(1).replace('.', ',')} €"
            for n, l in _packs(desc):
                e = entry('DE', 'trinkgut', name, n, l, price, src, promo=True, note=note, valid_until=until)
                if e:
                    out.append(e)
    return out
