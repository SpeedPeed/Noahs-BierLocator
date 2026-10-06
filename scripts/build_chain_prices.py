"""Fasst die recherchierten Kettenpreise (data/sources/*.json) zu data/chain-prices.json zusammen.

    python scripts/build_chain_prices.py

Jeder Eintrag wird geprüft (Pflichtfelder, Gebinde, Plausibilität pro 0,5 l). Neue
Recherchen einfach als weitere Datei in data/sources/ ablegen; bei gleicher Kette +
Bier + Gebinde + Aktion gewinnt der neueste Stand ("seen").
"""
import glob
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
HALVES = {'0.5l': 1, '0.33l': 0.66, '1l': 2, 'kasten20x0.5l': 20, 'kasten24x0.33l': 15.84}
REQUIRED = ('country', 'chain', 'beer', 'unit', 'price', 'source', 'seen')


def per05(p):
    if p['unit'] in HALVES:
        return p['price'] / HALVES[p['unit']]
    if p.get('volume_l'):
        return p['price'] / (p['volume_l'] * 2)
    return None


def main():
    entries, problems = {}, []
    for path in sorted(glob.glob(os.path.join(ROOT, 'data', 'sources', '*.json'))):
        with open(path, encoding='utf-8') as f:
            for i, p in enumerate(json.load(f)):
                where = f'{os.path.basename(path)}#{i}'
                missing = [k for k in REQUIRED if p.get(k) in (None, '')]
                if missing:
                    problems.append(f'{where}: fehlt {missing}'); continue
                if p['unit'] not in HALVES and p['unit'] != 'other':
                    problems.append(f'{where}: unbekanntes Gebinde {p["unit"]}'); continue
                if p['unit'] == 'other' and not p.get('volume_l'):
                    problems.append(f'{where}: "other" ohne volume_l'); continue
                v = per05(p)
                if not (0.2 <= v <= 15):
                    problems.append(f'{where}: unplausibel {v:.2f}/0,5 l'); continue
                key = (p['country'], p['chain'], p['beer'].lower(), p['unit'], p.get('package', ''), bool(p.get('promo')))
                if key not in entries or entries[key]['seen'] <= p['seen']:
                    entries[key] = p
    prices = sorted(entries.values(), key=lambda p: (p['country'], p['chain'], p['beer']))
    out = {'updated': max(p['seen'] for p in prices), 'prices': prices}
    with open(os.path.join(ROOT, 'data', 'chain-prices.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    by = {}
    for p in prices:
        by.setdefault(f"{p['country']} {p['chain']}", 0)
        by[f"{p['country']} {p['chain']}"] += 1
    print(f'{len(prices)} Preise geschrieben:', ', '.join(f'{k} ({n})' for k, n in by.items()))
    for msg in problems:
        print('  übersprungen:', msg)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
