"""Soundtrack für den Werbespot: kleiner Blasmusik-Beat (Umpa-Umpa, 120 BPM, F-Dur)
plus Geräusche (Kronkorken, Kasse, Wischer, Tipps, Einschenken, Anstoßen).
Alles wird hier synthetisiert — keine fremden Samples, also lizenzfrei.

    python promo/audio.py [build/sfx.json] [build/audio.wav]

sfx.json (schreibt promo/render.js) enthält die Zeitpunkte der Finger-Tipps im Video.
"""
import json
import os
import sys
import wave

import numpy as np

SR = 44100
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT
LENGTH = 24.0
rng = np.random.default_rng(7)

HERE = os.path.dirname(os.path.abspath(__file__))
SFX_JSON = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'build', 'sfx.json')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'build', 'audio.wav')

mix = np.zeros((int(SR * (LENGTH + 1)), 2))


def t_(dur):
    return np.arange(int(SR * dur)) / SR


def env(dur, a=0.005, d=0.2, sustain=0.0, r=0.05):
    """Hüllkurve: Attack, exponentieller Decay Richtung Sustain, kurzer Release am Ende."""
    t = t_(dur)
    e = sustain + (1 - sustain) * np.exp(-t / max(d, 1e-4))
    e *= np.clip(t / a, 0, 1)
    rel = int(SR * r)
    if rel and len(e) > rel:
        e[-rel:] *= np.linspace(1, 0, rel)
    return e


def lowpass(x, cutoff):
    """Einfacher Tiefpass erster Ordnung (cutoff darf ein Array sein)."""
    cutoff = np.broadcast_to(cutoff, x.shape)
    a = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def add(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= len(mix):
        return
    sig = sig[: len(mix) - i] * gain
    mix[i:i + len(sig), 0] += sig * np.sqrt(0.5 * (1 - pan))
    mix[i:i + len(sig), 1] += sig * np.sqrt(0.5 * (1 + pan))


def note(name):
    names = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11}
    n, octave = name[:-1], int(name[-1])
    return 440 * 2 ** ((names[n] + 12 * (octave + 1) - 69) / 12)


# ---------- Instrumente ----------
def tuba(freq, dur=0.32):
    t = t_(dur)
    f = freq * (1 + 0.04 * np.exp(-t / 0.02))  # leichtes Anblasen
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) + 0.45 * np.sin(2 * ph) + 0.2 * np.sin(3 * ph)
    return np.tanh(1.4 * x) * env(dur, a=0.012, d=0.22, r=0.06)


def accordion(freqs, dur=0.2):
    t = t_(dur)
    x = np.zeros_like(t)
    trem = 1 + 0.12 * np.sin(2 * np.pi * 6 * t)
    for f in freqs:
        for det in (0.997, 1.003):
            ph = (f * det * t) % 1
            x += (2 * ph - 1) * 0.5
    x = lowpass(x / len(freqs), 2600)
    return x * trem * env(dur, a=0.008, d=0.12, sustain=0.35, r=0.05)


def glock(freq, dur=0.9):
    t = t_(dur)
    x = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t / 0.08)
    return x * env(dur, a=0.002, d=0.35, r=0.1)


def kick():
    t = t_(0.35)
    f = 45 + 85 * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(0.35, a=0.001, d=0.14)


def noise(dur):
    return rng.uniform(-1, 1, int(SR * dur))


def clap():
    x = np.zeros(int(SR * 0.22))
    for off in (0.0, 0.011, 0.022):
        n = highpass(noise(0.2), 900) * env(0.2, a=0.001, d=0.05 if off < 0.02 else 0.09)
        i = int(off * SR)
        x[i:i + len(n)] += n[: len(x) - i]
    return lowpass(x, 5000) * 0.8


def hat(open_=False):
    d = 0.18 if open_ else 0.045
    return highpass(noise(d + 0.05), 7000) * env(d + 0.05, a=0.001, d=d / 2)


def snare():
    return 0.7 * highpass(noise(0.18), 1200) * env(0.18, a=0.001, d=0.05) + 0.4 * np.sin(2 * np.pi * 190 * t_(0.18)) * env(0.18, a=0.001, d=0.03)


# ---------- Geräusche ----------
def cap_pop():
    t = t_(0.12)
    f = 1100 * np.exp(-t / 0.025) + 280
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(0.12, a=0.001, d=0.03)
    click = highpass(noise(0.12), 2500) * env(0.12, a=0.0005, d=0.004)
    return 0.8 * tone + 0.6 * click


def ding():
    t = t_(1.4)
    x = sum(a * np.sin(2 * np.pi * 2093 * m * t) * np.exp(-t / d) for m, a, d in ((1, 1, 0.5), (2.76, 0.5, 0.2), (5.4, 0.25, 0.08)))
    return x * env(1.4, a=0.001, d=10, sustain=1, r=0.2) * 0.6


def whoosh(dur=0.45):
    t = t_(dur)
    cutoff = 400 + 5000 * (t / dur) ** 2
    x = lowpass(noise(dur), cutoff)
    shape = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    return x * shape * 1.6


def tap():
    return lowpass(highpass(noise(0.03), 1500), 6000) * env(0.03, a=0.0005, d=0.006) * 0.9


def pour(dur=1.3):
    t = t_(dur)
    x = lowpass(noise(dur), 1200 + 600 * np.sin(2 * np.pi * 3 * t)) * 0.5
    for _ in range(70):  # Bläschen
        at = rng.uniform(0, dur - 0.05)
        f = rng.uniform(900, 2600)
        b = np.sin(2 * np.pi * f * (1 + 0.6 * t_(0.04) / 0.04) * t_(0.04)) * env(0.04, a=0.002, d=0.01)
        i = int(at * SR)
        x[i:i + len(b)] += b * rng.uniform(0.05, 0.18)
    shape = np.clip(t / 0.15, 0, 1) * np.clip((dur - t) / 0.4, 0, 1)
    return x * shape


def clink():
    t = t_(1.2)
    x = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, a, d in ((2637, 1, 0.35), (3951, 0.6, 0.25), (6100, 0.35, 0.1), (1760, 0.3, 0.4)))
    return x * env(1.2, a=0.0008, d=10, sustain=1, r=0.2) * 0.5


def crash():
    return highpass(noise(1.6), 4000) * env(1.6, a=0.001, d=0.45) * 0.5


# ---------- Arrangement ----------
CHORDS = {
    'F': (['F2', 'C2'], ['A3', 'C4', 'F4']),
    'C7': (['C2', 'G1'], ['Bb3', 'C4', 'E4']),
    'Bb': (['Bb1', 'F2'], ['Bb3', 'D4', 'F4']),
}
# Takt 1 = Einstieg (0–2 s), Takte 2–10 = Groove, Takte 11–12 = Logo
PROGRESSION = ['F', 'F', 'C7', 'F', 'Bb', 'F', 'C7', 'F', 'C7']

# Einstieg: Kronkorken, Kasse, Trommelwirbel in den ersten Groove-Takt
add(cap_pop(), 0.02, 0.9)
add(ding(), 0.32, 0.55, pan=0.2)
add(tuba(note('F1'), 0.5), 0.32, 0.7)
for i in range(8):
    add(snare(), 1.0 + i * BEAT / 4, 0.25 + 0.06 * i)

for b, name in enumerate(PROGRESSION):
    bar0 = BAR * (b + 1)
    bass, chord = CHORDS[name]
    freqs = [note(n) for n in chord]
    for beat in range(4):
        at = bar0 + beat * BEAT
        if beat % 2 == 0:
            add(kick(), at, 0.7)
            add(tuba(note(bass[beat // 2])), at, 0.75)
        else:
            add(clap(), at, 0.35)
            add(accordion(freqs), at, 0.5, pan=0.15)
            add(accordion(freqs, 0.12), at + BEAT / 2, 0.25, pan=0.15)  # Nachschlag
        add(hat(), at + BEAT / 2, 0.22, pan=-0.3)
        add(hat(), at, 0.12, pan=-0.3)
    if b == len(PROGRESSION) - 1:  # Wirbel ins Finale
        for i in range(8):
            add(snare(), bar0 + 2 * BEAT + i * BEAT / 4, 0.25 + 0.05 * i)

# Glockenspiel-Motiv zu jedem Szenenstart (2 s, 8 s, 14 s)
for start in (2.0, 8.0, 14.0):
    for i, n in enumerate(['C5', 'F5', 'A5', 'C6']):
        add(glock(note(n)), start + i * BEAT / 2, 0.22, pan=-0.2 + 0.13 * i)

# Wischer vor jedem Szenenwechsel
for at in (1.62, 7.62, 13.62, 19.62):
    add(whoosh(), at, 0.35)

# Finale: Akkord + Becken, Einschenken, Anstoßen, Umpa-Schluss
end = BAR * 10
add(crash(), end, 0.6)
add(kick(), end, 1.0)
add(tuba(note('F1'), 1.0), end, 0.8)
add(accordion([note(n) for n in ['F3', 'A3', 'C4', 'F4']], 1.1), end, 0.38)
add(pour(), end + 0.3, 0.5)
add(clink(), end + 1.55, 0.7, pan=-0.15)
add(clink(), end + 1.62, 0.5, pan=0.2)
add(tuba(note('C2'), 0.4), end + 2.5, 0.6)
add(kick(), end + 2.5, 0.7)
add(tuba(note('F1'), 1.0), end + 3.0, 0.7)
add(kick(), end + 3.0, 0.9)
add(accordion([note(n) for n in ['A3', 'C4', 'F4']], 0.6), end + 3.0, 0.3)

# Finger-Tipps aus dem Video
if os.path.exists(SFX_JSON):
    for at in json.load(open(SFX_JSON)).get('taps', []):
        add(tap(), at, 0.45)

# ---------- Ausgabe ----------
out = mix[: int(SR * LENGTH)]
fade = int(SR * 0.6)
out[-fade:] *= np.linspace(1, 0, fade)[:, None]
out = np.tanh(out * 1.1)  # sanft begrenzen
out /= np.max(np.abs(out)) / 0.89
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out * 32767).astype('<i2').tobytes())
print('wrote', OUT)
