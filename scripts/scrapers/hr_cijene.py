"""Kroatien: Bierpreise aus den gesetzlich veröffentlichten Preislisten aller Händler.

Seit 2025 müssen Händler in Kroatien ihre Preise täglich pro Filiale öffentlich machen.
Das offene Projekt cijene.dev sammelt sie und stellt sie als Tagesarchiv bereit
(https://api.cijene.dev/v0/list, ohne Anmeldung): pro Kette products.csv, stores.csv, prices.csv.
Die Preise sind fast überall in allen Filialen gleich; wir nehmen pro Produkt den Median.
Konzum und Lidl fehlen in den Archiven (Stand 11/2026).
"""
import csv
import io
import os
import re
import statistics
import subprocess
import tempfile
import zipfile

from .common import UA, get_json, parse_pack, entry, strip_pack

LIST = 'https://api.cijene.dev/v0/list'
# Archiv-Ordner -> Kettenschlüssel in js/chainPrices.js (HR)
CHAINS = {'spar': 'spar', 'kaufland': 'kaufland', 'plodine': 'plodine', 'tommy': 'tommy', 'ribola': 'ribola', 'eurospin': 'eurospin'}
BEER = re.compile(r'\bpivo\b|\bpiva\b|ožujsko|ozujsko|karlovačko|karlovacko|tomislav|velebitsko|radler', re.I)
# depozit = Flaschenpfand, kein Bier
NOT_BEER = re.compile(r'depozit|čaša|casa\b|gajba|ambala|kvasac|octa|ocat|kruh|keks|čips|cips', re.I)
# Kürzel aus den Kassensystemen, die im Namen nur stören
NOISE = re.compile(r'^(pivo|svijetlo pivo|tamno pivo)\s+|\b(lim|limenka|boca|pov|nb|lt|bez povratne)\b\.?|\d+[.,]?\d*\s*%', re.I)


def _name(raw):
    n = NOISE.sub(' ', strip_pack(raw))
    n = re.sub(r'\s+', ' ', n).strip(' .,-')
    return n.title() if n.isupper() else n


def _median(rs, key):
    vals = [float(r[key]) for r in rs if (r.get(key) or '').strip() not in ('', '0', '0.00')]
    return statistics.median(vals) if vals else None


def check(pack, rs):
    """Median-Preis eines Produkts über alle Filialen -> (Preis, None) oder (None, Grund), wenn er nicht stimmen kann."""
    price = _median(rs, 'price')
    anchor = _median(rs, 'anchor_price')   # gesetzlich auszuweisender Normalpreis
    per_l = _median(rs, 'unit_price')      # Preis pro Liter laut Händler
    liters = pack[0] * pack[1]
    if not price:
        return None, 'kein Preis'
    if anchor and price < anchor * 0.5:
        return None, 'Abverkauf weit unter Normalpreis'
    if per_l and abs(price / per_l - liters) > liters * 0.3:
        return None, 'Menge im Namen passt nicht zum Literpreis'
    return round(price, 2), None


def _latest_zip():
    d = get_json(LIST)
    return max(d['archives'], key=lambda a: a['date'])['url']


def scrape():
    url = _latest_zip()
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'cijene.zip')
        # curl wie in common.py (Systemzertifikate); ~130 MB, einmal pro Woche
        subprocess.run(['curl', '-sS', '-L', '--max-time', '600', '-A', UA, '-o', path, url], check=True)
        with zipfile.ZipFile(path) as z:  # vor dem Aufräumen schließen (Windows sperrt offene Dateien)
            return _read(z)


def _read(z):
    out = []
    for folder, chain in CHAINS.items():
        rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(f'{folder}/{n}'), 'utf-8', errors='replace'))
        prods = {r['product_id']: r for r in rd('products.csv')
                 if BEER.search(f"{r['name']} {r.get('category') or ''}") and not NOT_BEER.search(r['name'])}
        rows = {}
        for r in rd('prices.csv'):
            if r['product_id'] in prods and r['price']:
                rows.setdefault(r['product_id'], []).append(r)
        for pid, rs in rows.items():
            raw = prods[pid]['name']
            pack = parse_pack(raw)
            if not pack:
                continue
            price, why = check(pack, rs)
            if why:
                continue
            e = entry('HR', chain, _name(raw), *pack, price, 'https://cijene.dev/', currency='EUR')
            if e:
                out.append(e)
    return out


if __name__ == '__main__':  # Selbsttest der Prüfregeln: python -m scrapers.hr_cijene (aus scripts/)
    r = lambda price, anchor='', per_l='': {'price': price, 'anchor_price': anchor, 'unit_price': per_l}
    assert check((1, 0.5), [r('1.19', '1.19', '2.38')]) == (1.19, None)
    assert check((1, 0.5), [r('0.13', '1.25', '0.26')])[1], 'Abverkauf'
    assert check((6, 0.33), [r('0.82', '0.82', '2.48')])[1], 'Preis gilt nur für eine Dose'
    assert check((6, 0.5), [r('7.99', '', '2.66'), r('8.25', '', '2.75')]) == (8.12, None)
    print('ok')
