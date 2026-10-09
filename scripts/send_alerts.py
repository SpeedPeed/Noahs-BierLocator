"""Verschickt Preisalarme als Web-Push (läuft im GitHub-Job nach dem Preis-Update).

Benötigt die Umgebungsvariablen SUPABASE_URL, SUPABASE_ANON_KEY, ALERTS_TOKEN,
VAPID_PRIVATE_KEY (PEM) und das Paket pywebpush. Jeder Treffer (Kette, Bier,
Gebinde, Preis) wird pro Gerät nur einmal gemeldet. Gleiche Logik wie js/alerts.js.
"""
import datetime
import json
import os
import sys
import urllib.request

from pywebpush import webpush, WebPushException

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TODAY = datetime.date.today().isoformat()
LABELS = {'billa': 'BILLA', 'spar': 'SPAR', 'mpreis': 'MPREIS', 'hofer': 'HOFER', 'lidl': 'Lidl', 'penny': 'PENNY',
          'rewe': 'REWE', 'edeka': 'EDEKA', 'aldi_sued': 'ALDI SÜD', 'aldi_nord': 'ALDI NORD', 'kaufland': 'Kaufland',
          'netto': 'Netto', 'trinkgut': 'trinkgut', 'getraenke_hoffmann': 'Getränke Hoffmann', 'coop': 'Coop',
          'migros': 'Migros', 'denner': 'Denner', 'aldi': 'ALDI', 'volg': 'Volg'}
APP_URL = 'https://speedpeed.github.io/Noahs-BierLocator/#alarme'


def rpc(fn, body):
    url = os.environ['SUPABASE_URL'].rstrip('/') + f'/rest/v1/rpc/{fn}'
    key = os.environ['SUPABASE_ANON_KEY']
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST', headers={
        'Content-Type': 'application/json', 'apikey': key, 'Authorization': f'Bearer {key}'})
    with urllib.request.urlopen(req, timeout=30) as r:
        text = r.read().decode()
        return json.loads(text) if text else None


def kind_of(p):
    if p['unit'].startswith('kasten'):
        return 'crate'
    if p['unit'] != 'other':
        return 'single'
    v = p.get('volume_l') or 0
    return 'crate' if v >= 6 else 'pack' if v >= 1.5 else 'single'


def active(p):
    return (not p.get('valid_until') or p['valid_until'] >= TODAY) and (not p.get('valid_from') or p['valid_from'] <= TODAY)


def matches(w, p):
    if w.get('country') and p['country'] != w['country']:
        return False
    if w.get('kind') not in (None, 'any') and kind_of(p) != w['kind']:
        return False
    if w.get('max') and p['price'] > w['max']:
        return False
    hay = f"{p['beer']} {p.get('package', '')}".lower()
    return all(word in hay for word in w['q'].lower().split())


def key(p):
    return f"{p['country']}|{p['chain']}|{p['beer']}|{p.get('package')}|{p['price']}"


def money(p):
    return f"CHF {p['price']:.2f}" if p.get('currency') == 'CHF' else f"{p['price']:.2f} €".replace('.', ',')


def main():
    with open(os.path.join(ROOT, 'data', 'chain-prices.json'), encoding='utf-8') as f:
        prices = [p for p in json.load(f)['prices'] if active(p)]
    subs = rpc('alerts_export', {'p_token': os.environ['ALERTS_TOKEN']}) or []
    sent = 0
    for s in subs:
        notified = s.get('notified') or {}
        fresh = []
        for w in s.get('watches') or []:
            for p in sorted((p for p in prices if matches(w, p)), key=lambda p: p['price']):
                if key(p) not in notified:
                    fresh.append(p)
        if not fresh:
            continue
        fresh.sort(key=lambda p: p['price'])
        best = fresh[0]
        body = f"{best['beer']} {best.get('package', '')}: {money(best)} bei {LABELS.get(best['chain'], best['chain'])}"
        if len(fresh) > 1:
            body += f" (+{len(fresh) - 1} weitere)"
        try:
            webpush(subscription_info=s['subscription'],
                    data=json.dumps({'title': 'Preisalarm 🍺', 'body': body, 'url': APP_URL, 'tag': 'preisalarm'}),
                    vapid_private_key=os.environ['VAPID_PRIVATE_KEY'],
                    vapid_claims={'sub': 'mailto:bierlocator@users.noreply.github.com'})
        except WebPushException as e:
            gone = e.response is not None and e.response.status_code in (404, 410)
            print(f'Push an {s["id"][:8]} fehlgeschlagen ({e}){" — Abo entfernt" if gone else ""}')
            if gone:
                rpc('alerts_mark', {'p_token': os.environ['ALERTS_TOKEN'], 'p_id': s['id'], 'p_notified': {}, 'p_drop': True})
            continue
        # Nur aktuelle Treffer merken (alte fallen raus, damit das JSON klein bleibt)
        current = {key(p) for w in s.get('watches') or [] for p in prices if matches(w, p)}
        notified = {k: TODAY for k in current}
        rpc('alerts_mark', {'p_token': os.environ['ALERTS_TOKEN'], 'p_id': s['id'], 'p_notified': notified})
        sent += 1
    print(f'{len(subs)} Abos geprüft, {sent} Benachrichtigungen verschickt.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
