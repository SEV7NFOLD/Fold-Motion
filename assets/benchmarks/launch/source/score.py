"""Score and sound design for the golden film v2.

Real recorded instruments (CC0: VCSL / VSCO 2 CE, bundled with FOLD Score) for
everything tonal and percussive; synthesized noise for whooshes, risers and UI
clicks, where synthesis sounds natural. Every effect sits on the frame of its
visual event. 120 BPM: one beat = 0.5 s.
"""
import json, subprocess
from fractions import Fraction
import numpy as np
from scipy.signal import resample_poly, butter, sosfilt, fftconvolve

SR = 48000
DUR = 15.0
N = int(SR * DUR)
B = 0.5
PACK = __import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..', '..', '..', 'samples')
MAN = json.load(open(f'{PACK}/manifest.json'))
rng = np.random.default_rng(7)
b = lambda n: n * B

_cache = {}
def load(rel):
    if rel not in _cache:
        p = subprocess.run(['ffmpeg', '-v', 'error', '-i', f'{PACK}/{rel}', '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True)
        _cache[rel] = np.frombuffer(p.stdout, np.float32).copy()
    return _cache[rel]

def note(inst, midi):
    zones = MAN['instruments'][inst]['zones']
    z = min(zones, key=lambda z: abs(z['midi'] - midi))
    x = load(z['file'])
    ratio = Fraction(2 ** ((midi - z['midi']) / 12)).limit_denominator(400)
    return resample_poly(x, ratio.denominator, ratio.numerator).astype(np.float32) if ratio != 1 else x

def hit(name): return load(MAN['hits'][name]['file'])

# ---------- buses (stereo) and reverb sends
def bus(): return np.zeros((2, N), np.float32)
music, drums, sfx, verb = bus(), bus(), bus(), bus()

def place(dst, y, t, gain=1.0, pan=0.0, length=None, attack=0.0, release=0.08, send=0.0, width=0.0):
    """Mix mono y at time t (s). pan -1..1 (constant power). width adds a Haas copy for stereo spread."""
    y = np.asarray(y, np.float32)
    if length is not None:
        n = int(length * SR)
        if len(y) > n:
            y = y[:n].copy(); r = min(int(release * SR), n)
            y[-r:] *= np.linspace(1, 0, r) ** 2
    else:
        y = y.copy()
    if attack > 0:
        a = min(int(attack * SR), len(y)); y[:a] *= np.linspace(0, 1, a) ** 1.5
    i0 = int(round(t * SR))
    if i0 >= N: return
    if i0 < 0: y = y[-i0:]; i0 = 0
    y = y[: N - i0] * gain
    th = (pan + 1) * np.pi / 4
    gl, gr = np.cos(th), np.sin(th)
    d = int(0.011 * SR * width)
    for ch, g, off in ((0, gl, 0), (1, gr, d)):
        seg = y[: max(0, len(y) - off)]
        dst[ch, i0 + off: i0 + off + len(seg)] += g * seg
        if send:
            verb[ch, i0 + off: i0 + off + len(seg)] += g * seg * send

def filt(x, kind, f, order=2):
    if isinstance(f, (list, tuple)): f = [min(v, SR / 2 - 100) for v in f]
    else: f = min(f, SR / 2 - 100)
    return sosfilt(butter(order, f, kind, fs=SR, output='sos'), x).astype(np.float32)

def env_exp(n, tau): return np.exp(-np.arange(n) / (tau * SR)).astype(np.float32)

# ---------- synthesized elements
def sweep_noise(dur, f0, f1, q=1.6, shape=1.0):
    """Noise through a band-pass whose centre glides f0 -> f1 (state-variable filter)."""
    n = int(dur * SR); x = rng.standard_normal(n).astype(np.float32)
    fc = f0 * (f1 / f0) ** (np.linspace(0, 1, n) ** shape)
    out = np.zeros(n, np.float32); low = band = 0.0; damp = 1 / q
    g = 2 * np.sin(np.pi * np.minimum(fc, SR / 6) / SR)
    for i in range(n):
        high = x[i] - low - damp * band
        band += g[i] * high; low += g[i] * band
        out[i] = band
    return out / (np.abs(out).max() + 1e-9)

def whoosh(dur, f0=300, f1=4000, peak=0.6):
    y = sweep_noise(dur, f0, f1)
    tt = np.linspace(0, 1, len(y)); e = np.where(tt < peak, (tt / peak) ** 2, ((1 - tt) / (1 - peak)) ** 1.6)
    return y * e

def kick():
    n = int(0.45 * SR); t = np.arange(n) / SR
    f = 46 + 90 * np.exp(-t / 0.035); ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.22)
    click = filt(rng.standard_normal(n).astype(np.float32), 'bandpass', [1500, 5000]) * np.exp(-t / 0.004) * 0.35
    real = hit('bass-drum')[:n]; real = filt(np.pad(real, (0, max(0, n - len(real)))), 'lowpass', 900) * 0.5
    return (body + click + real).astype(np.float32)

def click(bright=1.0):
    n = int(0.06 * SR); t = np.arange(n) / SR
    snap = filt(rng.standard_normal(n).astype(np.float32), 'bandpass', [2000 * bright, 7000 * bright]) * np.exp(-t / 0.0025)
    thump = np.sin(2 * np.pi * 170 * t) * np.exp(-t / 0.018) * 0.5
    return (snap + thump).astype(np.float32)

def tick():
    n = int(0.03 * SR); t = np.arange(n) / SR
    lo, hi = 1200 + rng.random() * 900, 3500 + rng.random() * 2500
    snap = filt(rng.standard_normal(n).astype(np.float32), 'bandpass', [lo, hi]) * np.exp(-t / (0.0018 + rng.random() * 0.0015))
    body = np.sin(2 * np.pi * (280 + rng.random() * 160) * t) * np.exp(-t / 0.008) * 0.3
    return (snap + body).astype(np.float32)

def thump(f=90):
    n = int(0.3 * SR); t = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(f + 60 * np.exp(-t / 0.02)) / SR
    return (np.sin(ph) * np.exp(-t / 0.09)).astype(np.float32)

def swell_ending_at(name, t_peak, gain, length=None):
    y = hit(name); e = np.abs(y); k = int(0.05 * SR)
    sm = np.convolve(e, np.ones(k) / k, 'same'); peak = int(np.argmax(sm))
    y = y[: peak + int(0.15 * SR)].copy(); y[-int(0.15 * SR):] *= np.linspace(1, 0, int(0.15 * SR))
    if length: y = y[-int(length * SR):]
    place(drums, y, t_peak - len(y) / SR + 0.15, gain, 0, width=1, send=0.25)

H = lambda s=0.006: (rng.random() * 2 - 1) * s           # timing humanize (s)
V = lambda a=0.15: 1 + (rng.random() * 2 - 1) * a        # velocity humanize

# ============ HARMONY: chords per scene (beats), voicings in MIDI
CH = [
    (0, 5, 'Bm', [47, 54], [62, 66, 71], 35),
    (5, 10, 'G', [43, 50], [62, 67, 71], 31),
    (10, 12.85, 'D/F#', [42, 50], [62, 66, 69], 30),
    (12.85, 15.25, 'Asus', [45, 52], [62, 64, 69], 33),
    (15.25, 19.75, 'Em7', [40, 47], [62, 67, 71], 28),
    (19.75, 22, 'G', [43, 50], [62, 67, 71], 31),
    (22, 24, 'A', [45, 52], [61, 64, 69], 33),
    (24, 30, 'D', [38, 45], [62, 66, 69, 74], 38),
]
def chord_at(beat):
    for c in CH:
        if c[0] <= beat < c[1]: return c
    return CH[-1]

# ---------- string bed: continuous, wide, swelling
for (a, z, name, cel, vio, bass_root) in CH:
    t0, dur = b(a) - 0.12, b(z - a) + 0.7
    for m in cel: place(music, note('cellos', m), t0 + H(0.02), 0.32 * V(0.08), -0.35, length=dur, attack=0.35, release=0.7, send=0.35, width=1)
    for k, m in enumerate(vio): place(music, note('violins', m), t0 + H(0.02), 0.22 * V(0.08), 0.15 + 0.25 * (k - 1), length=dur, attack=0.4, release=0.7, send=0.4, width=1)

# ---------- piano: sparse in the intro, an arpeggio pulse from the white scene on
def piano(m, t, g, pan=0.0): place(music, note('piano', m), t + H(), g * V(), pan, length=1.6, release=0.5, send=0.3)
for beat in np.arange(5, 24, 0.5):
    if 13.9 <= beat < 15.25 or 23.2 <= beat: continue
    c = chord_at(beat); tones = sorted(set([m % 12 for m in c[3] + c[4]]))
    pattern = [0, 2, 1, 2, 0, 2, 1, 3]
    step = int((beat * 2) % 8)
    m = 64 + ((tones[pattern[step] % len(tones)] - 64) % 12)
    accent = 1.0 if beat % 1 == 0 else 0.7
    soft = 0.6 if 10.6 <= beat < 12.85 else 1.0
    piano(m, b(beat), 0.16 * accent * soft, 0.25 if step % 2 else -0.15)
# lockup chord and a short melodic resolution
for m in [50, 54, 57, 62]: piano(m, b(24) + H(0.01), 0.3, -0.2)
for i, m in enumerate([69, 66, 74]): piano(m, b(26 + i * 1.5), 0.2, 0.2)

# ---------- bass: pulsing eighths, ducked under the kick
for beat in np.arange(5, 23.2, 0.5):
    if 13.9 <= beat < 15.25: continue
    root = chord_at(beat)[5]
    place(music, note('bass', root + 12 if root < 34 else root), b(beat), 0.34 * (1.0 if beat % 1 == 0 else 0.75) * V(0.06), 0, length=0.42, release=0.06)
place(music, note('bass', 38), b(24), 0.45, 0, length=3.2, release=1.2, send=0.1)

# ---------- drums
K = kick()
kicks = [5, 6, 7, 8, 9, 10, 11, 12, 16, 17, 18, 19, 20, 21, 22, 23, 24]
for k in kicks: place(drums, K, b(k), 0.8 if k != 24 else 1.0)
place(drums, K, b(15.25), 1.0)                                   # the dark scene lands
for k in [6, 8, 17, 19, 21, 23]: place(drums, hit('clap'), b(k) + H(0.004), 0.42 * V(0.08), 0.05, send=0.25)
for beat in list(np.arange(2, 13.9, 0.5)) + list(np.arange(15.25, 23.2, 0.5)):
    g = (0.10 if beat < 5 else 0.16) * (1.0 if beat % 1 else 0.6)
    place(drums, hit('shaker'), b(beat) + H(0.008), g * V(0.2), 0.35, send=0.1)
for i, beat in enumerate(np.arange(12.85, 13.9, 0.125)):            # build into the click
    place(drums, hit('snare'), b(beat) + H(0.003), 0.05 + 0.25 * (i / 8) ** 1.5, -0.05, length=0.25, send=0.2)
place(drums, hit('crash'), b(5), 0.25, 0.2, send=0.3, width=1)
place(drums, hit('crash'), b(15.25), 0.4, -0.2, send=0.35, width=1)
place(drums, hit('crash'), b(24), 0.5, 0.1, send=0.4, width=1)
place(drums, hit('timpani'), b(24), 0.45, 0, send=0.3)
swell_ending_at('cymbal-swell', b(5), 0.35, length=2.2)
swell_ending_at('cymbal-swell', b(15.25), 0.3, length=0.9)
swell_ending_at('cymbal-swell-long', b(24), 0.45, length=2.0)
place(drums, hit('timpani-roll'), b(22.6), 0.18, 0, length=0.7 + 0.0, attack=0.6, release=0.05, send=0.2)

# ---------- sound design on the picture
def harp(m, t, g, pan=0.0): place(sfx, note('harp', m), t, g, pan, length=1.8, release=0.6, send=0.45)
def pizz(m, t, g, pan=0.0): place(sfx, note('pizz', m), t, g, pan, length=0.9, release=0.3, send=0.3)
def glock(m, t, g, pan=0.0): place(sfx, note('glock', m), t, g, pan, length=1.8, release=0.6, send=0.5)

# A: words pop (Bm tones), dot, push into the period
for beat, m, p in [(0.25, 59, -0.3), (1.25, 62, -0.1), (2.25, 66, 0.1), (3.25, 71, 0.25)]:
    harp(m, b(beat), 0.5, p); place(sfx, thump(110), b(beat), 0.25)
place(sfx, whoosh(0.5, 2500, 400, 0.15), b(0.25) - 0.02, 0.18, 0, send=0.3)     # the big zoom-out
glock(83, b(3.5), 0.22, 0.3)
place(sfx, whoosh(1.05, 200, 6000, 0.92), b(4.0) - 0.03, 0.42, 0, width=1, send=0.3)
# B: words, swaps, selection, morph, card lands, typing, whip-zoom, click, expand
for beat, m, p in [(5.25, 55, -0.3), (5.5, 59, -0.15), (5.75, 62, 0.0), (6.0, 67, 0.15), (6.25, 71, 0.3)]:
    pizz(m, b(beat), 0.38, p)
for beat, m in [(7, 74), (8, 76), (9, 79)]:
    place(sfx, whoosh(0.14, 1500, 5000, 0.3), b(beat) - 0.02, 0.22, 0.1); pizz(m, b(beat), 0.3, 0.1)
place(sfx, click(1.3), b(9.25), 0.25, 0.1); glock(91, b(9.25), 0.12, 0.1)
place(sfx, whoosh(0.45, 600, 3000, 0.5), b(9.8), 0.32, 0, width=1, send=0.2)
place(sfx, thump(75), b(10.5), 0.35, 0)
text_len = 38
for i in range(text_len):
    tt = b(10.75) + (b(12.75) - b(10.75)) * (i + 0.5) / text_len + H(0.008)
    place(sfx, tick(), tt, 0.22 * V(0.3), 0.15 + (rng.random() - .5) * 0.2)
place(sfx, whoosh(0.32, 800, 7000, 0.75), b(12.85) - 0.02, 0.35, 0.2, send=0.2)
place(sfx, whoosh(0.4, 3000, 900, 0.3), b(13.2), 0.07, 0.6)                       # cursor glide
place(sfx, click(1.0), b(14), 0.8, 0.05, send=0.15)
place(sfx, click(1.5), b(14) + 0.11, 0.35, 0.05, send=0.15)
glock(96, b(14) + 0.02, 0.1, 0.05)
place(sfx, whoosh(0.85, 120, 2500, 0.95), b(14.45), 0.45, 0, width=1, send=0.25)
place(sfx, thump(55), b(15.25), 0.55, 0, send=0.2)
# C: checks (spin, then a ding), zoom out, whip-pan, formats pop, caption, converge
for i, beat in enumerate([16, 17, 18]):
    place(sfx, whoosh(0.28, 900, 3500, 0.7), b(beat), 0.08, -0.2)
    glock([86, 90, 93][i], b(beat + 0.5), 0.3, -0.2 + i * 0.1)
    place(sfx, click(1.6), b(beat + 0.5), 0.12, -0.2)
place(sfx, whoosh(0.5, 1200, 300, 0.4), b(19), 0.12, 0, width=1)
w = whoosh(0.42, 400, 5000, 0.55); n = len(w)
pan_sweep = np.linspace(0.8, -0.8, n)                                       # content travels right to left
for ch in (0, 1):
    th = (pan_sweep + 1) * np.pi / 4; g = np.cos(th) if ch == 0 else np.sin(th)
    i0 = int(b(19.75) * SR); sfx[ch, i0:i0 + n] += 0.5 * w * g; verb[ch, i0:i0 + n] += 0.1 * w * g
for i, beat in enumerate([20.5, 21, 21.5]):
    place(sfx, thump(85), b(beat), 0.4, -0.4 + 0.4 * i); pizz([55, 59, 62][i], b(beat), 0.35, -0.4 + 0.4 * i)
for beat in [22, 22.5]: place(sfx, click(1.2), b(beat), 0.12, 0); harp(74 if beat == 22 else 78, b(beat), 0.2)
rev = whoosh(0.75, 5000, 300, 0.9)
place(sfx, rev, b(23.2), 0.38, 0, width=1, send=0.2)
glock(98, b(24) - 0.01, 0.22, 0)
# D: mark draws (harp arpeggio up), dot, letters fly in, tagline, light sweep
for i, m in enumerate([50, 54, 57, 62, 66, 69]): harp(m, b(24.1) + i * 0.1, 0.32, -0.3 + i * 0.12)
glock(93, b(25.3), 0.24, 0)
for i in range(10):
    place(sfx, whoosh(0.3, 3000, 900, 0.35), b(25.4 + i * 0.07), 0.05 * V(0.3), -0.5 + i * 0.1)
place(sfx, hit('triangle'), b(26.75), 0.1, 0.3, send=0.4)
glock(98, b(26.9), 0.1, 0.3)
place(sfx, whoosh(0.9, 2000, 9000, 0.5), b(28.2), 0.08, 0, width=1, send=0.5)
glock(103, b(28.55), 0.12, 0.2); glock(108, b(28.8), 0.08, -0.2)

# ============ MIX
t = np.arange(N) / SR
duck = np.ones(N, np.float32)
for k in kicks + [15.25]:
    tk = b(k); m = t >= tk
    duck[m] -= 0.45 * np.exp(-(t[m] - tk) / 0.13)
duck = np.clip(duck, 0.4, 1)
music *= duck

def ir(seconds=1.9, decay=0.42, seed=3):
    r = np.random.default_rng(seed); n = int(seconds * SR); tt = np.arange(n) / SR
    out = []
    for ch in (0, 1):
        x = r.standard_normal(n).astype(np.float32) * np.exp(-tt / decay)
        x = filt(x, 'lowpass', 6500); x[: int(0.018 * SR)] = 0
        out.append(x / np.sqrt((x ** 2).sum()))
    return out
I = ir()
wet = np.stack([fftconvolve(verb[ch], I[ch])[:N] for ch in (0, 1)]).astype(np.float32)

mix = music * 1.0 + drums * 0.95 + sfx * 1.0 + wet * 0.55
mix = np.stack([filt(mix[ch], 'highpass', 30) for ch in (0, 1)])
fade = np.ones(N, np.float32); f0 = int(14.2 * SR); fade[f0:] = np.linspace(1, 0, N - f0) ** 2
mix *= fade
mix /= np.abs(mix).max() + 1e-9
mix *= 0.7
stereo = mix.T.astype(np.float32)
stereo.tofile(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'score.f32'))
print('ok', stereo.shape, float(np.abs(stereo).max()))
