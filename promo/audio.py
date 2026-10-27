"""Tonspur für den Werbespot: Musik (frei lizenziert, siehe timeline.json → music) plus
Soundeffekte, die hier synthetisiert werden. Den Fahrplan der Effekte (Zeit, Art, Lautstärke,
Panorama) erzeugt promo/spot.html, render.js schreibt ihn nach build/sfx.json.

    python promo/audio.py build/sfx.json build/audio.wav
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
SFX_JSON = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'build', 'sfx.json')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'build', 'audio.wav')
plan = json.load(open(SFX_JSON))
LENGTH = plan['duration']
rng = np.random.default_rng(11)


# ---------- Bausteine ----------
def t_(dur):
    return np.arange(int(SR * dur)) / SR


def noise(dur):
    return rng.uniform(-1, 1, int(SR * dur))


def env(dur, a=0.005, d=0.2, r=0.02):
    t = t_(dur)
    e = np.exp(-t / max(d, 1e-4)) * np.clip(t / max(a, 1e-5), 0, 1)
    n = int(SR * r)
    if n and len(e) > n:
        e[-n:] *= np.linspace(1, 0, n)
    return e


def svf(x, cutoff, q=0.7, mode='bp'):
    """State-Variable-Filter (Chamberlin). cutoff/q dürfen Arrays sein (Sweeps)."""
    cutoff = np.broadcast_to(np.asarray(cutoff, float), x.shape)
    q = np.broadcast_to(np.asarray(q, float), x.shape)
    f = 2 * np.sin(np.pi * np.clip(cutoff, 20, SR / 6) / SR)
    damp = 1 / q
    lo = bp = 0.0
    out = np.empty_like(x)
    for i in range(len(x)):
        hi = x[i] - lo - damp[i] * bp
        bp += f[i] * hi
        lo += f[i] * bp
        out[i] = bp if mode == 'bp' else lo if mode == 'lp' else hi
    return out


def chirp(f0, f1, dur, curve=3.0):
    t = t_(dur)
    f = f0 + (f1 - f0) * (1 - np.exp(-curve * t / dur)) / (1 - np.exp(-curve))
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def stereo(x, pan=0.0, sweep=0.0):
    """Mono → Stereo; sweep bewegt das Panorama über die Dauer (Vorbeiflug)."""
    p = np.clip(pan + sweep * np.linspace(-1, 1, len(x)), -1, 1)
    return np.stack([x * np.sqrt(0.5 * (1 - p)), x * np.sqrt(0.5 * (1 + p))], 1)


def norm(x, peak=1.0):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


# ---------- Effekte ----------
def whoosh(dur=0.6, f0=300, f1=4000, q=1.4, sweep=0.9):
    t = t_(dur)
    k = (t / dur)
    cut = f0 * (f1 / f0) ** k
    x = svf(noise(dur), cut, q)
    x += 0.25 * svf(noise(dur), cut * 2.1, 3)
    shape = np.sin(np.pi * np.clip(k, 0, 1) ** 0.7) ** 2
    return stereo(norm(x * shape), sweep=sweep)


def whip():
    return whoosh(0.32, 600, 7000, 2.0, 1.0)


def swoosh():
    return whoosh(0.45, 400, 3500, 1.2, -0.8)


def riser(dur=1.2):
    t = t_(dur)
    k = t / dur
    x = svf(noise(dur), 300 * (25 ** k), 2.5) * 0.7
    x += 0.35 * chirp(180, 900, dur, 1.5) * (0.5 + 0.5 * np.sin(2 * np.pi * (4 + 18 * k) * t))
    return stereo(norm(x * k ** 1.6), sweep=0.2)


def boom(dur=2.2):
    t = t_(dur)
    sub = np.tanh(2.2 * chirp(78, 32, dur, 4)) * env(dur, 0.004, 0.55)
    body = svf(noise(dur), 160, 0.8, 'lp') * env(dur, 0.002, 0.18) * 1.6
    crack = svf(noise(0.25), 2500, 0.7, 'hp') * env(0.25, 0.0005, 0.03)
    x = sub + body
    x[: len(crack)] += crack * 0.5
    return stereo(norm(x))


def impact():
    t = t_(1.2)
    x = np.tanh(2 * chirp(110, 45, 1.2, 5)) * env(1.2, 0.002, 0.22)
    x += svf(noise(1.2), 900, 0.6, 'lp') * env(1.2, 0.001, 0.07)
    x += 0.4 * svf(noise(1.2), 6000, 0.7, 'hp') * env(1.2, 0.001, 0.25)  # Becken-Hauch
    return stereo(norm(x))


def bubble_pop(f0=420, f1=1400, dur=0.07):
    x = chirp(f0, f1, dur, 2) * env(dur, 0.001, dur / 3)
    return x


def pop():
    x = np.zeros(int(SR * 0.16))
    b = bubble_pop(380, 1500, 0.07)
    x[: len(b)] += b
    x += svf(noise(0.16), 3000, 1.5) * env(0.16, 0.0005, 0.008) * 0.5
    return stereo(norm(x))


def plip():
    x = 0.7 * np.sin(2 * np.pi * 190 * t_(0.25)) * env(0.25, 0.001, 0.05)
    x += svf(noise(0.25), 1800, 2.0) * env(0.25, 0.0005, 0.012)
    b = bubble_pop(600, 1800, 0.05) * 0.5
    x[200:200 + len(b)] += b
    return stereo(norm(x))


def tick():
    x = svf(noise(0.05), 5200, 3) * env(0.05, 0.0003, 0.006)
    x += 0.4 * np.sin(2 * np.pi * 2400 * t_(0.05)) * env(0.05, 0.0003, 0.01)
    return stereo(norm(x))


def tap():
    return stereo(norm(svf(noise(0.04), 2600, 1.2) * env(0.04, 0.0003, 0.005)))


def card():
    x = np.zeros(int(SR * 0.5))
    p = pop()[:, 0]
    x[: len(p)] += p
    s = whoosh(0.3, 1500, 6000, 0.9, 0)[:, 0] * 0.35
    x[: len(s)] += s
    return stereo(norm(x))


def coin():
    t = t_(0.7)
    x = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, a, d in ((2637, 1, 0.12), (3520, 0.7, 0.09), (5274, 0.4, 0.05)))
    y = np.zeros(int(SR * 0.8))
    y[: len(x)] += x
    y[int(0.07 * SR): int(0.07 * SR) + len(x)] += 0.6 * x
    return stereo(norm(y * 1.0))


def ding():
    t = t_(1.5)
    x = sum(a * np.sin(2 * np.pi * 1568 * m * t) * np.exp(-t / d) for m, a, d in ((1, 1, 0.6), (2.0, 0.35, 0.3), (3.01, 0.2, 0.12), (4.2, 0.1, 0.06)))
    return stereo(norm(x * env(1.5, 0.001, 10)))


def dash():
    x = whoosh(1.0, 200, 6000, 0.9, 0.0)[:, 0]
    x += 0.3 * chirp(120, 520, 1.0, 1.0) * np.sin(np.pi * np.linspace(0, 1, int(SR * 1.0)))
    return stereo(norm(x), sweep=0.3)


def brake():
    t = t_(0.5)
    x = svf(noise(0.5), 2400 - 1400 * t / 0.5, 6) * env(0.5, 0.01, 0.15) * 0.6
    x += np.sin(2 * np.pi * 70 * t) * env(0.5, 0.002, 0.08)
    return stereo(norm(x))


def morph():
    t = t_(0.7)
    x = np.sin(2 * np.pi * np.cumsum(220 + 160 * np.sin(np.pi * t / 0.7)) / SR) * np.sin(np.pi * t / 0.7) ** 2
    x += 0.3 * svf(noise(0.7), 800, 1.0) * np.sin(np.pi * t / 0.7)
    return stereo(norm(x))


def bubbles(dur, n, f_lo, f_hi, falling=False):
    x = np.zeros(int(SR * dur))
    for k in range(n):
        at = rng.uniform(0, dur - 0.08)
        f0 = rng.uniform(f_lo, f_hi) * ((1 - 0.5 * at / dur) if falling else 1)
        b = bubble_pop(f0, f0 * rng.uniform(2, 3.2), rng.uniform(0.03, 0.07)) * rng.uniform(0.25, 1)
        i = int(at * SR)
        x[i: i + len(b)] += b
    return x


def drain():
    x = bubbles(0.8, 26, 250, 700, falling=True)
    x += 0.4 * svf(noise(0.8), 500, 1.5) * np.linspace(1, 0, int(SR * 0.8))
    return stereo(norm(x))


def pour():
    dur = 1.3
    t = t_(dur)
    x = svf(noise(dur), 900 + 500 * np.sin(2 * np.pi * 2.3 * t), 1.0) * 0.6
    x += bubbles(dur, 90, 500, 1600)
    shape = np.clip(t / 0.08, 0, 1) * np.clip((dur - t) / 0.35, 0, 1)
    return stereo(norm(x * shape))


def clink():
    t = t_(1.6)
    one = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, a, d in ((2380, 1, 0.5), (3610, 0.7, 0.35), (5230, 0.45, 0.18), (6890, 0.25, 0.09)))
    two = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, a, d in ((2610, 1, 0.45), (3990, 0.6, 0.3), (5790, 0.35, 0.15)))
    x = np.zeros(int(SR * 1.7))
    x[: len(one)] += one
    x[int(0.035 * SR): int(0.035 * SR) + len(two)] += 0.8 * two
    x[: 300] += svf(noise(300 / SR), 4000, 1)[:300] * 0.6
    return np.stack([x * 0.8, np.roll(x, 40) * 0.8], 1) / np.max(np.abs(x))


def drop():
    return stereo(norm(np.tanh(1.5 * chirp(160, 50, 0.4, 4)) * env(0.4, 0.002, 0.1) + 0.3 * svf(noise(0.4), 1200, 1) * env(0.4, 0.001, 0.02)))


FX = {
    'whoosh': swoosh, 'swoosh': swoosh, 'whip': whip, 'riser': riser, 'boom': boom, 'impact': impact,
    'pop': pop, 'plip': plip, 'tick': tick, 'tap': tap, 'card': card, 'coin': coin, 'ding': ding,
    'dash': dash, 'brake': brake, 'morph': morph, 'drain': drain, 'pour': pour, 'clink': clink, 'drop': drop,
}


def reverb(x, secs=0.9, wet=0.18):
    """Kleiner Hall: Faltung mit abklingendem, gefiltertem Rauschen (FFT)."""
    n = int(SR * secs)
    ir = rng.normal(0, 1, (n, 2)) * np.exp(-np.arange(n) / (SR * secs / 5))[:, None]
    ir[:, 0] = svf(ir[:, 0], 5000, 0.7, 'lp')
    ir[:, 1] = svf(ir[:, 1], 5000, 0.7, 'lp')
    ir /= np.sqrt((ir ** 2).sum(0))
    m = len(x) + n
    size = 1 << (m - 1).bit_length()
    y = np.stack([np.fft.irfft(np.fft.rfft(x[:, c], size) * np.fft.rfft(ir[:, c], size), size)[: len(x)] for c in range(2)], 1)
    return x + wet * y


# ---------- Mischen ----------
total = int(SR * LENGTH)
fx_bus = np.zeros((total + SR * 3, 2))
cache = {}
for ev in plan['events']:
    kind = ev['type']
    if kind not in cache:
        cache[kind] = FX[kind]()
    s = cache[kind]
    if ev.get('pan'):
        p = ev['pan']
        s = s * np.array([np.sqrt(1 - max(0, p)), np.sqrt(1 + min(0, p))])
    i = int(ev['t'] * SR)
    fx_bus[i: i + len(s)] += s * ev.get('gain', 1) * 0.7
fx_bus = reverb(fx_bus)[:total]

music = np.zeros((total, 2))
m = plan.get('music')
if m:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(m.get('start', 0)), '-i', os.path.join(HERE, m['file']),
                          '-t', str(LENGTH + 1), '-f', 's16le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    a = np.frombuffer(raw, '<i2').reshape(-1, 2) / 32768.0
    a = a[:total]
    music[: len(a)] = a * m.get('gain', 1.0)
    fi, fo = int(SR * m.get('fadeIn', 0.05)), int(SR * m.get('fadeOut', 1.5))
    music[:fi] *= np.linspace(0, 1, fi)[:, None]
    end = min(len(a), total)
    music[end - fo:end] *= np.linspace(1, 0, fo)[:, None]
    # Ducking: Musik bei großen Effekten kurz leiser
    duck = np.ones(total)
    for ev in plan['events']:
        if ev['type'] in ('boom', 'impact', 'dash'):
            i = int(ev['t'] * SR)
            n = int(SR * 0.6)
            seg = duck[i:i + n]
            seg[:] = np.minimum(seg, 1 - 0.35 * np.exp(-np.arange(len(seg)) / (SR * 0.25)))
    music *= duck[:, None]

out = music + fx_bus
out = np.tanh(out * 1.05)
out /= max(1e-9, np.max(np.abs(out))) / 0.95
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out * 32767).astype('<i2').tobytes())
print('wrote', OUT)
