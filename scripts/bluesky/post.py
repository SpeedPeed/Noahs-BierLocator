"""Veröffentlicht Posts (optional mit Bildern und als Thread) auf dem Bluesky-Konto.

    python scripts/bluesky/post.py thread.json            # echt posten
    python scripts/bluesky/post.py thread.json --dry-run  # nur prüfen, nichts senden

thread.json ist eine Liste. Jeder Eintrag wird ein Post, die folgenden antworten auf den ersten:
    [
      {"text": "…", "images": [{"path": "/…/route.jpg", "alt": "Beschreibung"}]},
      {"text": "…"}
    ]

Das Passwort kommt aus der Umgebungsvariable app_passwort_bluesky (App-Passwort).
Es wird nie ausgegeben. Ausgabe nur: URLs der Posts oder Fehlermeldungen.
"""
import datetime
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

PDS = 'https://bsky.social/xrpc/'
HANDLE = 'bierlocator.bsky.social'
MAX_GRAPHEMES = 300
MAX_IMAGE_BYTES = 950_000
URL_RE = re.compile(r'https?://[^\s)]+')


def call(method, body=None, token=None, raw=None, mime=None):
    url = PDS + method
    headers = {}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if raw is not None:
        data, headers['Content-Type'] = raw, mime
    elif body is not None:
        data, headers['Content-Type'] = json.dumps(body).encode(), 'application/json'
    else:
        data = None
    req = urllib.request.Request(url, data=data, headers=headers, method='POST' if data is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        raise SystemExit(f'API-Fehler bei {method}: HTTP {e.code} {e.read()[:200].decode(errors="replace")}')


def login():
    pw = os.environ.get('app_passwort_bluesky')
    if not pw:
        raise SystemExit('Umgebungsvariable app_passwort_bluesky fehlt.')
    return call('com.atproto.server.createSession', {'identifier': HANDLE, 'password': pw})


TAG_RE = re.compile(r'(?<!\w)#(\w{2,64})')


def facets(text):
    """Link- und Hashtag-Facets mit UTF-8-Byte-Positionen, damit URLs und Tags klickbar sind."""
    out = []
    for m in URL_RE.finditer(text):
        start = len(text[:m.start()].encode())
        end = start + len(m.group().encode())
        out.append({'index': {'byteStart': start, 'byteEnd': end},
                    'features': [{'$type': 'app.bsky.richtext.facet#link', 'uri': m.group()}]})
    for m in TAG_RE.finditer(text):
        start = len(text[:m.start()].encode())
        end = start + len(m.group().encode())
        out.append({'index': {'byteStart': start, 'byteEnd': end},
                    'features': [{'$type': 'app.bsky.richtext.facet#tag', 'tag': m.group(1)}]})
    return out


def graphemes(text):
    # Näherung: Bluesky zählt Grapheme. Für deutschen Text mit Emoji reicht die Anzahl der Zeichen.
    return len(text)


def smaller_jpeg(path):
    """Verkleinert ein Bild unter MAX_IMAGE_BYTES, falls nötig (JPEG)."""
    raw = open(path, 'rb').read()
    if len(raw) <= MAX_IMAGE_BYTES:
        return raw, 'image/gif' if path.lower().endswith('.gif') else 'image/jpeg'
    if path.lower().endswith('.gif'):
        raise SystemExit(f'GIF zu groß ({len(raw)} Byte): {path}')
    img = Image.open(path).convert('RGB')
    for scale, quality in [(1.0, 80), (0.85, 78), (0.7, 75), (0.6, 70)]:
        w, h = int(img.width * scale), int(img.height * scale)
        buf = io.BytesIO()
        img.resize((w, h), Image.LANCZOS).save(buf, 'JPEG', quality=quality, optimize=True)
        if buf.tell() <= MAX_IMAGE_BYTES:
            return buf.getvalue(), 'image/jpeg'
    raise SystemExit(f'Bild auch verkleinert zu groß: {path}')


def upload(session, path):
    data, mime = smaller_jpeg(path)
    res = call('com.atproto.repo.uploadBlob', token=session['accessJwt'], raw=data, mime=mime)
    return res['blob']


VIDEO = 'https://video.bsky.app/xrpc/'


def gif_to_mp4(gif_path):
    """Bluesky spielt GIFs nur animiert, wenn sie als Video hochgeladen werden. Hier konvertieren wir."""
    mp4 = gif_path[:-4] + '.mp4'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', gif_path,
                    '-movflags', 'faststart', '-pix_fmt', 'yuv420p',
                    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', mp4], check=True)
    return mp4


def upload_video(session, path):
    """Lädt ein MP4 über den Bluesky-Videodienst hoch und wartet, bis es verarbeitet ist."""
    did = session['did']
    # Service-Token für den Videodienst, Audience ist die PDS-DID des Kontos (aus dem DID-Dokument).
    pds_host = urllib.parse.urlparse(session['didDoc']['service'][0]['serviceEndpoint']).hostname
    svc = call('com.atproto.server.getServiceAuth?' + urllib.parse.urlencode({
        'aud': 'did:web:' + pds_host, 'lxm': 'com.atproto.repo.uploadBlob'}), token=session['accessJwt'])['token']
    data = open(path, 'rb').read()
    job = _vreq(VIDEO + 'app.bsky.video.uploadVideo?' + urllib.parse.urlencode(
        {'did': did, 'name': os.path.basename(path)}), svc, data, 'video/mp4')
    job_id = job['jobId']
    for _ in range(60):
        status = _vreq(VIDEO + 'app.bsky.video.getJobStatus?' + urllib.parse.urlencode({'jobId': job_id}), svc)
        js = status.get('jobStatus', {})
        if js.get('state') == 'JOB_STATE_COMPLETED':
            return js['blob']
        if js.get('state') == 'JOB_STATE_FAILED':
            raise SystemExit(f'Videoverarbeitung fehlgeschlagen: {js.get("error", "unbekannt")}')
        time.sleep(3)
    raise SystemExit('Videoverarbeitung dauert zu lange.')


def _vreq(url, token, data=None, mime=None):
    headers = {'Authorization': 'Bearer ' + token}
    if data is not None:
        headers['Content-Type'] = mime
    req = urllib.request.Request(url, data=data, headers=headers, method='POST' if data is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        body = json.loads(e.read() or b'{}')
        # 409 „already_exists“: dieselbe Datei ist schon verarbeitet, der Job liefert den Blob.
        if e.code == 409 and body.get('jobId'):
            return body
        raise SystemExit(f'Videodienst-Fehler: HTTP {e.code} {json.dumps(body)[:200]}')


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    thread = json.load(open(sys.argv[1], encoding='utf-8'))
    dry = '--dry-run' in sys.argv

    for i, post in enumerate(thread, start=1):
        if graphemes(post['text']) > MAX_GRAPHEMES:
            raise SystemExit(f'Post {i} ist zu lang ({graphemes(post["text"])} Zeichen, max. {MAX_GRAPHEMES}).')
        if len(post.get('images', [])) > 4:
            raise SystemExit(f'Post {i} hat mehr als vier Bilder.')
        for img in post.get('images', []):
            if not img.get('alt'):
                raise SystemExit(f'Bild in Post {i} hat keinen Alt-Text.')

    if dry:
        print(f'Trockenlauf: {len(thread)} Post(s), keine Verbindung zum Netz.')
        return

    session = login()
    root = parent = None
    for i, post in enumerate(thread, start=1):
        record = {
            '$type': 'app.bsky.feed.post',
            'text': post['text'],
            'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        }
        f = facets(post['text'])
        if f:
            record['facets'] = f
        imgs = post.get('images', [])
        videos = [im for im in imgs if im['path'].lower().endswith('.mp4')]
        gifs = [im for im in imgs if im['path'].lower().endswith('.gif')]
        if videos:
            # Ein echtes Video (MP4) direkt hochladen, nur allein im Post.
            if len(imgs) != 1:
                raise SystemExit(f'Post {i}: ein Video darf nur allein im Post stehen.')
            vid = videos[0]
            record['embed'] = {'$type': 'app.bsky.embed.video',
                               'video': upload_video(session, vid['path']),
                               'alt': vid['alt']}
        elif gifs:
            # GIFs als Video, sonst werden sie nicht animiert. Pro Post nur ein Video.
            if len(imgs) != 1:
                raise SystemExit(f'Post {i}: ein GIF darf nur allein im Post stehen.')
            gif = gifs[0]
            record['embed'] = {'$type': 'app.bsky.embed.video',
                               'video': upload_video(session, gif_to_mp4(gif['path'])),
                               'alt': gif['alt']}
        elif imgs:
            record['embed'] = {'$type': 'app.bsky.embed.images', 'images': [
                {'image': upload(session, im['path']), 'alt': im['alt']} for im in imgs]}
        if root:
            record['reply'] = {'root': root, 'parent': parent}
        res = call('com.atproto.repo.createRecord', {
            'repo': session['did'], 'collection': 'app.bsky.feed.post', 'record': record,
        }, token=session['accessJwt'])
        ref = {'uri': res['uri'], 'cid': res['cid']}
        root = root or ref
        parent = ref
        print(f'https://bsky.app/profile/{HANDLE}/post/{res["uri"].split("/")[-1]}')


if __name__ == '__main__':
    main()
