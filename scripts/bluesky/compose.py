"""Baut die Bilder für den Bluesky-Account aus den Aufnahmen von capture.mjs.

    python scripts/bluesky/compose.py bamberg /tmp/bl-out/bamberg

Erzeugt im Zielordner:
  route.jpg          Routenkarte: BRouter-Strecke auf Kartenkacheln, mit Bierorten aus OSM
  finden-annot.jpg   Ortsliste mit Kreisen und Beschriftung
  tour-annot.jpg     Tourplan mit Kreisen und Beschriftung
  surprise.gif       Glücksrad als kurze Bildfolge
  assets.json        Liste der Bilder mit Alt-Text, damit der Post sie richtig beschreibt

Nur Standardbibliotheken plus Pillow. Kartenkacheln: CARTO (Namensnennung im Bild).
"""
import io
import json
import math
import os
import sys
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SPOTS = json.load(open(os.path.join(HERE, 'spots.json'), encoding='utf-8'))
UA = 'Bier-Locator-Bluesky/1.0 (https://speedpeed.github.io/Noahs-BierLocator)'
TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
OVERPASS = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter',
            'https://z.overpass-api.de/api/interpreter']
ORANGE = (243, 156, 18)
ROUTE = (181, 64, 42)
FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def fetch(url, data=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# ---------- Web-Mercator ----------

def lonlat_to_px(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n * 256
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n * 256
    return x, y


def fit_zoom(lons, lats, width, height, pad=90):
    for z in range(16, 3, -1):
        xs, ys = zip(*(lonlat_to_px(lo, la, z) for lo, la in zip(lons, lats)))
        if max(xs) - min(xs) <= width - 2 * pad and max(ys) - min(ys) <= height - 2 * pad:
            return z
    return 4


def route_card(spot_key, out_path):
    spot = SPOTS[spot_key]
    lonlats = '|'.join(f'{lo},{la}' for la, lo in spot['loop'])
    # BRouter nimmt das Trennzeichen | unkodiert an, urlencode würde es zu %7C machen und ablehnen.
    url = (f'https://brouter.de/brouter?lonlats={lonlats}'
           '&profile=trekking&alternativeidx=0&format=geojson')
    feature = json.loads(fetch(url, timeout=90))['features'][0]
    track = feature['geometry']['coordinates']
    props = feature['properties']
    km = float(props.get('track-length', 0)) / 1000
    ascend = int(float(props.get('filtered ascend', 0)))
    lons = [p[0] for p in track]
    lats = [p[1] for p in track]

    W = H = 1080
    z = fit_zoom(lons, lats, W, H)
    pts = [lonlat_to_px(lo, la, z) for lo, la in zip(lons, lats)]
    cx = (min(p[0] for p in pts) + max(p[0] for p in pts)) / 2
    cy = (min(p[1] for p in pts) + max(p[1] for p in pts)) / 2
    ox, oy = cx - W / 2, cy - H / 2  # linke obere Ecke im Weltpixel-Raster

    canvas = Image.new('RGB', (W, H), (240, 236, 228))
    for tx in range(int(ox // 256), int((ox + W) // 256) + 1):
        for ty in range(int(oy // 256), int((oy + H) // 256) + 1):
            s = 'abc'[(tx + ty) % 3]
            try:
                tile = Image.open(io.BytesIO(fetch(TILE_URL.format(s=s, z=z, x=tx, y=ty)))).convert('RGB')
                canvas.paste(tile, (int(tx * 256 - ox), int(ty * 256 - oy)))
            except OSError:
                pass

    draw = ImageDraw.Draw(canvas, 'RGBA')
    screen = [(x - ox, y - oy) for x, y in pts]
    draw.line(screen, fill=ROUTE + (255,), width=12, joint='curve')

    # Bierorte entlang der Route (OSM über Overpass, Ausfall ist nicht schlimm)
    beer = fetch_beer_places(track)
    for lo, la, name in beer:
        x, y = lonlat_to_px(lo, la, z)
        x, y = x - ox, y - oy
        draw.ellipse([x - 13, y - 13, x + 13, y + 13], fill=ORANGE + (255,), outline=(255, 255, 255), width=4)

    # Start-Markierung
    sx, sy = screen[0]
    draw.ellipse([sx - 18, sy - 18, sx + 18, sy + 18], fill=(255, 255, 255), outline=ROUTE, width=8)

    # Kopfzeile und Quellenangabe
    draw.rectangle([0, 0, W, 150], fill=(255, 250, 240, 235))
    draw.text((50, 28), f'Bier-Radtour · {spot["name"]}', font=font(FONT_BOLD, 56), fill=(60, 36, 20))
    # Nur behaupten, was auf dem Bild steht: Bierorte nur nennen, wenn die Abfrage welche geliefert hat.
    stats = f'{km:.0f} km · {ascend} Hm' + (' · Bierorte an der Strecke markiert' if beer else '')
    draw.text((50, 98), stats, font=font(FONT, 36), fill=(110, 80, 60))
    attrib = '© OpenStreetMap-Mitwirkende'
    f_att = font(FONT, 24)
    tw = draw.textlength(attrib, font=f_att)
    draw.rectangle([W - tw - 40, H - 48, W, H], fill=(255, 255, 255, 220))
    draw.text((W - tw - 20, H - 40), attrib, font=f_att, fill=(60, 60, 60))

    canvas.save(out_path, 'JPEG', quality=88)
    return {'km': round(km, 1), 'ascend': ascend, 'beer_places': len(beer)}


def fetch_beer_places(track, limit=12):
    step = max(1, len(track) // limit)
    samples = track[::step][:limit]
    parts = ''.join(f'node(around:350,{p[1]},{p[0]})[amenity~"^(pub|biergarten|brewery)$"];' for p in samples)
    query = f'[out:json][timeout:25];({parts});out 60;'
    body = urllib.parse.urlencode({'data': query}).encode()
    for attempt in range(2):
        for ep in OVERPASS:
            try:
                data = json.loads(fetch(ep, data=body, timeout=40))
                seen, out = set(), []
                for el in data.get('elements', []):
                    if el['id'] not in seen:
                        seen.add(el['id'])
                        out.append((el['lon'], el['lat'], el.get('tags', {}).get('name', '')))
                return out
            except (OSError, ValueError):
                continue
    return []


# ---------- Kreise mit Beschriftung auf Screenshots ----------

LABELS = {
    'finden': {
        '#typeChips': 'Ortstypen filtern: Kneipe, Biergarten …',
        '#fOpen': 'Nur Orte, die gerade offen haben',
        '#btnLocate': 'Dein Standort, mit einem Tipp',
    },
    'tour': {
        '#tourResult': 'Tour mit gleichmäßigen Stopps',
        '#tourElev': 'Höhenprofil, zeigt die Stelle auf der Karte',
        '#tourTimeline': 'Zeitplan mit Ankunft',
    },
}


def annotate(shot_path, boxes, labels, out_path, scale):
    """Kreise mit Nummern auf den Bildschirmelementen, Erklärung unten als Legende."""
    img = Image.open(shot_path).convert('RGB')
    draw = ImageDraw.Draw(img, 'RGBA')
    f_num = font(FONT_BOLD, 34)
    f_txt = font(FONT_BOLD, 27)
    items = [(sel, text) for sel, text in labels.items() if boxes.get(sel)]
    for n, (sel, _) in enumerate(items, start=1):
        b = boxes[sel]
        pad = 8
        x0, y0 = (b['x'] - pad) * scale, (b['y'] - pad) * scale
        x1, y1 = (b['x'] + b['width'] + pad) * scale, (b['y'] + b['height'] + pad) * scale
        draw.rounded_rectangle([x0, y0, x1, y1], radius=24, outline=ORANGE + (255,), width=10)
        cx, cy, r = x0 + 4, y0 + 4, 26
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ORANGE + (255,), outline=(255, 255, 255), width=4)
        draw.text((cx, cy), str(n), font=f_num, fill=(255, 255, 255), anchor='mm')
    # Legende am unteren Rand, gut lesbar auf weißem Grund
    lines = [f'{n}  {text}' for n, (_, text) in enumerate(items, start=1)]
    line_h = 52
    box_h = line_h * len(lines) + 30
    top = img.height - box_h - 20
    draw.rounded_rectangle([20, top, img.width - 20, img.height - 20], radius=24, fill=(255, 255, 255, 245))
    for i, line in enumerate(lines):
        draw.text((48, top + 18 + i * line_h), line, font=f_txt, fill=(60, 36, 20))
    img.save(out_path, 'JPEG', quality=90)


def make_gif(frame_dir, out_path):
    names = sorted(n for n in os.listdir(frame_dir) if n.startswith('surprise-'))
    frames = []
    for n in names:
        im = Image.open(os.path.join(frame_dir, n)).convert('RGB')
        im = im.resize((390, 844), Image.LANCZOS)
        frames.append(im.quantize(colors=128, method=Image.MEDIANCUT))
    if not frames:
        return False
    frames[0].save(out_path, save_all=True, append_images=frames[1:], duration=170, loop=0, optimize=True)
    return os.path.getsize(out_path) < 950_000

TUTORIAL_STEPS = [
    ('finden-annot.jpg',
     'So findest du Bier in deiner Nähe: Standort erlauben, dann zeigt die Karte Orte im Umkreis. '
     'Mit den Typ-Filtern wird es genauer.'),
    ('tour-annot.jpg',
     'Bier-Radtour planen: Länge, Stopps und Startzeit wählen. Die Stopps verteilt der Planer '
     'gleichmäßig, und nur Lokale, die bei der Ankunft offen haben.'),
    ('route.jpg',
     'Die fertige Strecke kannst du als GPX-Datei exportieren oder per Link teilen. '
     'https://speedpeed.github.io/Noahs-BierLocator'),
]


def tutorial_thread(out):
    """Schreibt thread.json: ein Post pro Schritt, jeweils mit dem passenden Bild aus assets.json."""
    assets = {a['file']: a['alt'] for a in json.load(open(os.path.join(out, 'assets.json'), encoding='utf-8'))['assets']}
    thread = []
    for n, (file, text) in enumerate(TUTORIAL_STEPS, start=1):
        if file not in assets or not os.path.exists(os.path.join(out, file)):
            continue
        thread.append({'text': f'Tutorial {n}/{len(TUTORIAL_STEPS)}: {text}',
                       'images': [{'path': os.path.join(out, file), 'alt': assets[file]}]})
    if not thread:
        raise SystemExit('Keine Bilder für das Tutorial vorhanden.')
    path = os.path.join(out, 'thread.json')
    json.dump(thread, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    return path



def main():
    if '--tutorial' in sys.argv:
        sys.argv.remove('--tutorial')
        print(tutorial_thread(sys.argv[2]))
        return
    if len(sys.argv) != 3 or sys.argv[1] not in SPOTS:
        print(__doc__)
        sys.exit(2)
    spot_key, out = sys.argv[1], sys.argv[2]
    manifest = json.load(open(os.path.join(out, 'manifest.json'), encoding='utf-8'))
    assets = []

    stats = route_card(spot_key, os.path.join(out, 'route.jpg'))
    assets.append({'file': 'route.jpg', 'alt': f'Karte: Bier-Radtour bei {SPOTS[spot_key]["name"]}, '
                   f'{stats["km"]} km, {stats["ascend"]} Höhenmeter, Bierorte entlang der Strecke markiert.'})

    for shot, name, alt in [('finden', 'finden.png', 'Ortsliste der App mit Kreisen um Filter und Standort.'),
                            ('tour', 'tour.png', 'Tourplan der App mit Strecke, Stopps und Zeitplan.')]:
        src = os.path.join(out, name)
        if not os.path.exists(src) or shot not in manifest.get('shots', {}):
            continue
        dst = f'{shot}-annot.jpg'
        annotate(src, manifest['shots'][shot], LABELS[shot], os.path.join(out, dst), scale=2)
        assets.append({'file': dst, 'alt': alt})

    if os.path.exists(os.path.join(out, 'surprise-00.png')):
        if make_gif(out, os.path.join(out, 'surprise.gif')):
            assets.append({'file': 'surprise.gif', 'alt': 'Glücksrad „Überrasch mich“ dreht sich und wählt ein Lokal.'})

    json.dump({'spot': spot_key, 'route': stats, 'assets': assets}, open(os.path.join(out, 'assets.json'), 'w'),
              ensure_ascii=False, indent=2)
    print(json.dumps({'spot': spot_key, 'assets': [a['file'] for a in assets], 'route': stats}, ensure_ascii=False))


if __name__ == '__main__':
    main()
