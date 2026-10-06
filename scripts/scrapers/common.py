"""Gemeinsame Helfer für die Preis-Scraper.

Jeder Scraper (scripts/scrapers/<kette>.py) stellt `scrape()` bereit und liefert
eine Liste von Einträgen im Format von data/sources/*.json (siehe entry()).
"""
import datetime
import json
import re
import subprocess
import time

TODAY = datetime.date.today().isoformat()
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'


def _curl(url, headers, body=None):
    # curl statt urllib: nutzt den Zertifikatsspeicher des Systems (Python bringt
    # teils veraltete Zertifikate mit) und ist auf Windows 10+ vorinstalliert.
    cmd = ['curl', '-sS', '--compressed', '-L', '--max-time', '40', '-w', '\n%{http_code}']
    for k, v in headers.items():
        cmd += ['-H', f'{k}: {v}']
    if body is not None:
        cmd += ['--data-binary', '@-']
    cmd.append(url)
    r = subprocess.run(cmd, input=body, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f'curl {r.returncode}: {r.stderr.decode(errors="replace")[:200]}')
    text, _, code = r.stdout.decode('utf-8', 'replace').rpartition('\n')
    if not code.startswith('2'):
        raise RuntimeError(f'HTTP {code} für {url}')
    return text


def get_json(url, headers=None, data=None, retries=3):
    h = {'User-Agent': UA, 'Accept': 'application/json'}
    h.update(headers or {})
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        h.setdefault('Content-Type', 'application/json')
    for attempt in range(retries):
        try:
            return json.loads(_curl(url, h, body))
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))


def get_text(url, headers=None):
    h = {'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml'}
    h.update(headers or {})
    return _curl(url, h)


_NUM = r'(\d+(?:[.,]\d+)?)'


def _f(s):
    return float(s.replace(',', '.'))


def parse_pack(text):
    """Erkennt Gebinde in Produkttexten. → (anzahl, liter_pro_stück) oder None.

    Beispiele: "6x0,33l", "20 x 0,5 l", "Kiste 24x0,33 l", "0,5l", "500 ml", "5 l Fass", "1,5 l".
    """
    t = text.lower().replace('×', 'x')
    m = re.search(_NUM + r'\s*x\s*' + _NUM + r'\s*(ml|cl|l)\b', t)
    if m:
        n, v, u = int(float(m.group(1).replace(',', '.'))), _f(m.group(2)), m.group(3)
        return n, _to_l(v, u)
    m = re.search(_NUM + r'\s*(ml|cl|l|liter)\b', t)
    if m:
        return 1, _to_l(_f(m.group(1)), m.group(2))
    return None


def _to_l(v, unit):
    return v / 1000 if unit == 'ml' else v / 100 if unit == 'cl' else v


def unit_for(count, liters):
    """Ordnet ein Gebinde einem App-Gebinde zu, sonst ('other', gesamt_liter)."""
    if count == 1 and abs(liters - 0.5) < 0.01:
        return '0.5l', None
    if count == 1 and abs(liters - 0.33) < 0.006:
        return '0.33l', None
    if count == 1 and abs(liters - 1.0) < 0.01:
        return '1l', None
    if count == 20 and abs(liters - 0.5) < 0.01:
        return 'kasten20x0.5l', None
    if count == 24 and abs(liters - 0.33) < 0.006:
        return 'kasten24x0.33l', None
    return 'other', round(count * liters, 3)


def pack_label(count, liters):
    v = f'{liters:.3f}'.rstrip('0').rstrip('.').replace('.', ',')
    return f'{count}×{v} l' if count > 1 else f'{v} l'


NOT_BEER = re.compile(
    r'glas|gläser|krug|schinken|senf|brot|wurst|würstel|käse|essig|chips|gewürz|marinade|sauce|soße|'
    r'zapfanlage|öffner|untersetzer|geschenk(?!.*bier\s)|kerze|seife|shampoo|duschgel|bierteig|kuchen|'
    r'bierhefe|tablette|kapsel|keks|praline|schokolade|gummi|bonbon|mehl|backmischung',
    re.I)


def entry(country, chain, beer, count, liters, price, source, promo=False, currency=None, note=None, valid_until=None, valid_from=None):
    """Baut einen geprüften Eintrag oder gibt None zurück (unplausibel/kein Bier)."""
    if not price or price <= 0 or not liters or liters <= 0 or NOT_BEER.search(beer):
        return None
    total = count * liters
    if total < 0.2 or total > 60:
        return None
    per05 = price / (total * 2)
    if not (0.2 <= per05 <= 15):
        return None
    # Einzelgebinde mit Packungspreis (Shop-Daten widersprüchlich): eine einzelne
    # Dose/Flasche ≤ 0,5 l über 5 € bzw. 1 l über 8 € gibt es im Supermarkt praktisch nicht.
    if count == 1 and ((liters <= 0.5 and price > 5) or (liters >= 0.99 and price > 8)):
        return None
    unit, vol = unit_for(count, liters)
    e = {
        'country': country, 'chain': chain, 'beer': re.sub(r'\s+', ' ', beer).strip(),
        'unit': unit, 'package': pack_label(count, liters), 'price': round(price, 2),
        'promo': bool(promo), 'source': source, 'seen': TODAY,
    }
    if vol:
        e['volume_l'] = vol
    if currency:
        e['currency'] = currency
    if note:
        e['note'] = note
    if valid_until:
        e['valid_until'] = valid_until
    if valid_from and valid_from > TODAY:
        e['valid_from'] = valid_from
    return e


def strip_pack(name):
    """Entfernt Gebindeangaben aus dem Produktnamen ("Gösser Märzen 6x0,5l" → "Gösser Märzen")."""
    n = re.sub(r'\b\d+\s*[x×]\s*\d+(?:[.,]\d+)?\s*(ml|cl|l)\b', '', name, flags=re.I)
    n = re.sub(r'\b\d+(?:[.,]\d+)?\s*(ml|cl|l|liter)\b', '', n, flags=re.I)
    n = re.sub(r'\b(dose|flasche|fl\.|mw|ew|mehrweg|einweg|kiste|tray|pet)\b\.?', '', n, flags=re.I)
    return re.sub(r'\s{2,}', ' ', n).strip(' ,-')
