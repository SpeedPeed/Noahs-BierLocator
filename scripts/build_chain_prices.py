"""Fasst die recherchierten Kettenpreise (data/sources/*.json) zu data/chain-prices.json zusammen.

    python scripts/build_chain_prices.py

Jeder Eintrag wird geprüft (Pflichtfelder, Gebinde, Plausibilität pro 0,5 l). Neue
Recherchen einfach als weitere Datei in data/sources/ ablegen; bei gleicher Kette +
Bier + Gebinde + Aktion gewinnt der neueste Stand ("seen").
"""
import datetime
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


def update_history(prices):
    """Preisverlauf: pro Produkt (Kette+Bier+Gebinde) Punkte [Datum, Normalpreis, Aktionspreis].
    Ein neuer Punkt entsteht nur, wenn sich etwas ändert — plus einer pro Woche als Lebenszeichen."""
    path = os.path.join(ROOT, 'data', 'price-history.json')
    try:
        with open(path, encoding='utf-8') as f:
            hist = json.load(f)
    except (OSError, ValueError):
        hist = {'since': None, 'items': {}}
    today = max(p['seen'] for p in prices)
    hist['since'] = hist.get('since') or today
    cur = {}
    for p in prices:
        k = '|'.join([p['country'], p['chain'], p['beer'], p.get('package', '')])
        reg, promo = cur.get(k, (None, None))
        if p.get('promo'):
            if not p.get('valid_from') or p['valid_from'] <= today:
                promo = p['price'] if promo is None else min(promo, p['price'])
        else:
            reg = p['price']
        cur[k] = (reg, promo)
    items = hist['items']
    for k, (reg, promo) in cur.items():
        pts = items.setdefault(k, [])
        last = pts[-1] if pts else None
        if last and last[0] == today:
            pts[-1] = [today, reg, promo]
        elif not last or last[1] != reg or last[2] != promo or (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(last[0])).days >= 7:
            pts.append([today, reg, promo])
    hist['updated'] = today
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(hist, f, ensure_ascii=False, separators=(',', ':'))


def main():
    entries, problems = {}, []
    paths = sorted(glob.glob(os.path.join(ROOT, 'data', 'sources', '*.json')))
    # Automatisch gescrapte Sortimente (auto-*.json) ersetzen händische Recherchen derselben Kette.
    auto_chains = set()
    for path in paths:
        if os.path.basename(path).startswith('auto-'):
            with open(path, encoding='utf-8') as f:
                auto_chains |= {(p['country'], p['chain']) for p in json.load(f)}
    for path in paths:
        is_auto = os.path.basename(path).startswith('auto-')
        with open(path, encoding='utf-8') as f:
            for i, p in enumerate(json.load(f)):
                if not is_auto and (p.get('country'), p.get('chain')) in auto_chains:
                    continue
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
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    update_history(prices)
    by = {}
    for p in prices:
        by.setdefault(f"{p['country']} {p['chain']}", 0)
        by[f"{p['country']} {p['chain']}"] += 1
    print(f'{len(prices)} Preise geschrieben:', ', '.join(f'{k} ({n})' for k, n in by.items()))
    for msg in problems[:30]:
        print('  übersprungen:', msg)
    if len(problems) > 30:
        print(f'  … und {len(problems) - 30} weitere')
    return 0


if __name__ == '__main__':
    sys.exit(main())
