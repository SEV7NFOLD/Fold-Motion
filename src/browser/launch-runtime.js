/*
 * FOLD Motion launch runtime (docs/LAUNCH-STYLE-BUILD-PLAN.md, Phases 3–4b).
 *
 * Draws a beat-timed launch timeline in headless Chromium. Every shot is its own
 * scene (backdrop, soft light, camera); the camera does the animating (opening
 * zoom-out, chasing the newest words, drift and roll) and words pop in place.
 * Shots join through continuity transitions planned in src/production/launch.mjs:
 *   fly-into  the camera dives into the line's closing dot until it becomes the
 *             next scene's background (each theme's ink is the other's paper)
 *   flip      the next scene opens from the last word as a feathered circle
 *   whip      a fast push from one scene to the next
 *   collapse  the words converge into a point; the lockup bursts out of it
 *
 * Determinism: frame(t) is a pure function of t; randomness is seeded.
 */
(() => {
  const D = window.FOLD_DATA;
  const W = D.width, H = D.height, FPS = D.fps;
  const BEAT = 60 / D.beat.bpm;
  const k = W / 1920;
  const OUT_BEATS = { 'fly-into': 1, collapse: 0.75, flip: 0.5, whip: 0.25 };

  // ---------- math
  const clamp = (x, a = 0, c = 1) => Math.min(c, Math.max(a, x));
  const prog = (t, a, c) => (c <= a ? (t >= a ? 1 : 0) : clamp((t - a) / (c - a)));
  const lerp = (a, c, x) => a + (c - a) * x;
  const outExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
  const io = (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const ioQuint = (x) => (x < .5 ? 16 * x ** 5 : 1 - Math.pow(-2 * x + 2, 5) / 2);
  const inCubic = (x) => x * x * x;
  function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const hex = (h) => { const v = String(h).replace('#', ''); const f = v.length === 3 ? [...v].map((c) => c + c).join('') : v; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
  const toHex = (rgb) => `#${rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, x) => toHex(hex(a).map((c, i) => lerp(c, hex(b)[i], x)));
  const lum = (h) => { const [r, g, b] = hex(h).map((c) => { const s = c / 255; return s <= .03928 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  function hueShift(h, deg) {
    const [r, g, b] = hex(h).map((c) => c / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let hh = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; }
    hh = (hh + deg + 360) % 360; const c = (1 - Math.abs(2 * l - 1)) * Math.max(s, .55), x = c * (1 - Math.abs((hh / 60) % 2 - 1)), m = l - c / 2;
    const [rr, gg, bb] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
    return [rr + m, gg + m, bb + m].map((v) => Math.round(clamp(v) * 255));
  }
  const el = (tag, css, parent, text) => { const n = document.createElement(tag); n.style.cssText = css; if (text !== undefined) n.textContent = text; parent.appendChild(n); return n; };

  // ---------- themes: brand colour and paper; each one's ink is the other's background
  const accent = D.palette.accent;
  const brandBg = D.palette.primary;
  const brandIsDark = lum(brandBg) < 0.35;
  const paperBg = brandIsDark ? mix('#F6F7FB', accent, 0.04) : mix(brandBg, '#000000', 0.86);
  const THEME = {
    brand: { bg: brandBg, ink: paperBg, dark: brandIsDark },
    paper: { bg: paperBg, ink: brandBg, dark: !brandIsDark },
  };
  // a light brand colour can't be ink on paper: use a deep ink instead
  if (!THEME.paper.dark && lum(THEME.paper.ink) > 0.2) THEME.paper.ink = '#0B0F19';
  const tones = [hex(accent), hueShift(accent, 32), hueShift(accent, 68)];
  const accentGradient = `linear-gradient(100deg, ${accent}, rgb(${tones[2]}))`;
  const SANS = D.fonts.sans, SERIF = D.fonts.serif;
  const root = document.getElementById('root');
  root.style.background = THEME.brand.bg;

  function wordSpan(parent, text, size, ink, { serif = false } = {}) {
    const css = serif
      ? `position:absolute;left:0;top:0;white-space:pre;line-height:1;font-family:${SERIF};font-style:italic;font-weight:400;font-size:${size}px;background:${accentGradient};-webkit-background-clip:text;background-clip:text;color:transparent;padding:0 .06em;transform-origin:50% 60%`
      : `position:absolute;left:0;top:0;white-space:pre;line-height:1;font-family:${SANS};font-weight:600;font-size:${size}px;letter-spacing:-.034em;color:${ink};transform-origin:50% 60%`;
    return el('span', css, parent, text);
  }
  function tryLayout(parent, words, { size, maxW, lines: maxLines, floor, cx, cy, ink, serifLast, force }) {
    for (let fs = size; fs >= floor; fs *= 0.92) {
      const spans = words.map((w, i) => wordSpan(parent, w, fs, ink, { serif: serifLast && i === words.length - 1 }));
      const widths = spans.map((s) => s.getBoundingClientRect().width);
      const gap = fs * 0.26; const lines = [[]]; let lw = 0;
      widths.forEach((w, i) => { if (lines[lines.length - 1].length && lw + gap + w > maxW) { lines.push([]); lw = 0; } lw += (lines[lines.length - 1].length ? gap : 0) + w; lines[lines.length - 1].push(i); });
      if (lines.length <= maxLines || (force && fs * 0.92 < floor)) {
        const lh = fs * 1.12; const top = cy - (lines.length * lh) / 2; const pos = [];
        lines.forEach((line, li) => {
          const total = line.reduce((s, i, j) => s + widths[i] + (j ? gap : 0), 0); let x = cx - total / 2;
          line.forEach((i) => { pos[i] = { x, y: top + li * lh, w: widths[i], h: fs }; x += widths[i] + gap; });
        });
        spans.forEach((s, i) => { s.style.left = `${pos[i].x}px`; s.style.top = `${pos[i].y}px`; });
        return { spans, pos, size: fs };
      }
      spans.forEach((s) => s.remove());
    }
    return null;
  }
  const layoutWords = (parent, words, o) => tryLayout(parent, words, { ...o, lines: 1, floor: 96 * k }) || tryLayout(parent, words, { ...o, lines: o.maxLines, floor: 56 * k, force: true });
  // where the baseline sits in a line box (line-height 1), as a fraction of the size, measured once per face
  const baselineCache = {};
  function baseline(fs, serif) {
    const key = String(serif);
    if (baselineCache[key] === undefined) {
      const probe = el('div', `position:absolute;left:0;top:0;line-height:1;font-size:100px;white-space:pre;font-family:${serif ? SERIF : SANS};${serif ? 'font-style:italic' : 'font-weight:600'}`, root, 'x');
      const mark = el('span', 'display:inline-block;width:0;height:0;vertical-align:baseline', probe);
      baselineCache[key] = (mark.getBoundingClientRect().top - probe.getBoundingClientRect().top) / 100; probe.remove();
    }
    return baselineCache[key] * fs;
  }

  // ---------- scenes
  const shots = D.shots.map((shot, index) => {
    const L = shot.launch; const theme = THEME[L.theme || 'brand'];
    const scene = el('div', `position:absolute;inset:0;overflow:hidden;background:${theme.bg};visibility:hidden`, root);
    const lights = tones.map((c, i) => {
      const a = (theme.dark ? [.30, .38, .28] : [.20, .16, .19])[i];
      return el('div', `position:absolute;left:0;top:0;width:${1500 * k}px;height:${1500 * k}px;border-radius:50%;background:radial-gradient(closest-side,rgba(${c},${a}),rgba(${c},${a * .45}) 45%,rgba(${c},0))`, scene);
    });
    const world = el('div', `position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0`, scene);
    const S = { index, shot, L, theme, scene, lights, world, cx: W / 2, cy: H / 2, start: shot.startFrame / FPS, end: (shot.endFrame + 1) / FPS, seed: index * 7.3 };
    S.outBeats = L.out ? OUT_BEATS[L.out] : 0;
    if (L.device === 'build') {
      const words = []; const chunkOf = [];
      L.beats.forEach((chunk, c) => chunk.split(/\s+/).filter(Boolean).forEach((w) => { words.push(w); chunkOf.push(c); }));
      const lastWord = words[words.length - 1] || '';
      const serifLast = index === 0 && words.length > 1 && lastWord.replace(/[^\p{L}]/gu, '').length >= 3;
      Object.assign(S, layoutWords(world, words, { size: 128 * k, maxW: 1500 * k, maxLines: 2, cx: S.cx, cy: S.cy, ink: theme.ink, serifLast }), { words, chunkOf, serifLast });
    } else if (L.device === 'swap') {
      const size = 104 * k;
      S.lead = L.lead ? wordSpan(world, L.lead, size, theme.ink) : null;
      S.items = L.items.map((it) => wordSpan(world, it, size, theme.ink, { serif: true }));
      S.leadW = S.lead ? S.lead.getBoundingClientRect().width : 0;
      S.itemW = S.items.map((s) => s.getBoundingClientRect().width);
      S.size = size; S.gap = size * 0.28;
    } else if (L.device === 'punch') {
      let fs = 300 * k; const span = wordSpan(world, L.copy, fs, theme.ink);
      const w = span.getBoundingClientRect().width; if (w > 1600 * k) { fs *= (1600 * k) / w; span.style.fontSize = `${fs}px`; }
      const pw = span.getBoundingClientRect().width;
      span.style.left = `${S.cx - pw / 2}px`; span.style.top = `${S.cy - fs * 0.55}px`;
      S.spans = [span]; S.pos = [{ x: S.cx - pw / 2, y: S.cy - fs * 0.55, w: pw, h: fs }]; S.size = fs;
    } else if (L.device === 'lockup') {
      let fs = 132 * k; const probe = wordSpan(world, L.copy, fs, theme.ink);
      const w0 = probe.getBoundingClientRect().width; if (w0 > 1500 * k) fs *= (1500 * k) / w0; probe.remove();
      const chars = [...L.copy]; const R = rng(9 + index);
      const tmp = chars.map((ch) => wordSpan(world, ch === ' ' ? '\u00a0' : ch, fs, theme.ink));
      const widths = tmp.map((s) => s.getBoundingClientRect().width); const total = widths.reduce((a, b) => a + b, 0);
      let x = S.cx - total / 2;
      S.letters = tmp.map((s, i) => { s.style.left = `${x}px`; s.style.top = `${S.cy - fs * 0.55}px`; const Lt = { s, x, w: widths[i], rot: (R() - .5) * 40, z: 0.1 + R() * 0.3, d: i * Math.min(0.06, 1.0 / chars.length) }; x += widths[i]; return Lt; });
      S.spans = tmp; S.size = fs;
    }
    // fly-into: the line's closing period becomes a true circle the camera can dive into
    if (L.out === 'fly-into' && S.spans && S.pos) {
      const i = S.spans.length - 1; const span = S.spans[i]; const text = span.textContent;
      if (/\.$/.test(text)) {
        const serif = Boolean(S.serifLast);
        span.textContent = '';
        span.appendChild(document.createTextNode(text.slice(0, -1)));
        const dot = el('span', 'visibility:hidden', span, '.');   // still part of the copy; the circle is drawn instead
        const fs = S.size; const sr = span.getBoundingClientRect(), dr = dot.getBoundingClientRect();
        const r = fs * (serif ? 0.07 : 0.075);
        const p = S.pos[i];
        S.dot = { x: p.x + (dr.left - sr.left) + dr.width / 2, y: p.y + baseline(fs, serif) - r, r };
        S.dotEl = el('div', `position:absolute;left:${S.dot.x - r}px;top:${S.dot.y - r}px;width:${2 * r}px;height:${2 * r}px;border-radius:50%;background:${serif ? `rgb(${tones[2]})` : theme.ink}`, world);
      }
    }
    return S;
  });

  // ---------- camera per scene: the world point at screen centre, scale, roll
  function cameraFor(S, lt) {
    const b = lt / BEAT; const L = S.L; const length = S.end - S.start;
    const drift = Math.sin(lt * 1.1 + S.seed) * 12 * k + (lt - length / 2) * 22 * k;
    const roll = Math.sin(lt * 0.7 + S.seed) * 0.8;
    if (L.device === 'build') {
      const centers = L.beats.map((_, c) => {
        const idx = S.chunkOf.map((cc, i) => (cc === c ? i : -1)).filter((i) => i >= 0);
        const xs = idx.map((i) => S.pos[i].x + S.pos[i].w / 2), ys = idx.map((i) => S.pos[i].y + S.pos[i].h * 0.55);
        return { x: xs.reduce((a, v) => a + v, 0) / xs.length, y: ys.reduce((a, v) => a + v, 0) / ys.length };
      });
      let x = centers[0].x, y = centers[0].y;
      L.at.forEach((a, c) => { if (c === 0) return; const e = outExpo(prog(b, a, a + 0.75)); x = lerp(x, centers[c].x, e); y = lerp(y, centers[c].y, e); });
      const lastAt = L.at[L.at.length - 1];
      const settle = io(prog(b, lastAt + 0.8, lastAt + 2));
      x = lerp(x, S.cx, settle); y = lerp(y, S.cy, settle);
      let logS = S.index === 0 ? lerp(Math.log(2.6), Math.log(1.15), io(prog(b, 0, 1.4))) : lerp(Math.log(1.45), Math.log(1.12), outExpo(prog(b, 0, 1.2)));
      logS = lerp(logS, Math.log(1.0 + 0.05 * Math.sin(lt * 0.9)), settle);
      return { x: x + drift, y, s: Math.exp(logS), r: roll };
    }
    if (L.device === 'swap') return { x: S.cx + drift, y: S.cy, s: lerp(1.25, 1.06, outExpo(prog(b, 0, 1.2))) * lerp(1, 1.1, io(prog(lt, 0, length))), r: roll };
    if (L.device === 'punch') return { x: S.cx + drift * 0.6, y: S.cy, s: lerp(1.0, 1.22, io(prog(lt, 0, length))), r: roll * 1.4 };
    return { x: S.cx + drift * 0.4, y: S.cy, s: lerp(1.0, 1.1, io(prog(lt, 0, length))), r: roll * 0.5 };
  }

  // ---------- devices
  const pop = (t0, t, from = 0.9) => ({ o: t >= t0 ? clamp((t - t0) / 0.07) : 0, s: lerp(from, 1, outExpo(prog(t, t0, t0 + 0.4 * BEAT))) });
  function draw(S, lt, collapse = 0) {
    const b = lt / BEAT; const L = S.L;
    const toward = (x, y) => (collapse > 0 ? { dx: (S.cx - x) * collapse, dy: (S.cy - y) * collapse, s: 1 - collapse * 0.97 } : { dx: 0, dy: 0, s: 1 });
    if (L.device === 'build') {
      const lastAt = L.at[L.at.length - 1];
      const restore = outExpo(prog(b, lastAt + 1, lastAt + 1.6));
      S.spans.forEach((s, i) => {
        const c = S.chunkOf[i]; const within = S.chunkOf.slice(0, i).filter((cc) => cc === c).length;
        const p = pop((L.at[c] + within * 0.12) * BEAT, lt);
        const next = L.at[c + 1];
        const dim = next !== undefined ? lerp(1, 0.42, outExpo(prog(b, next, next + 0.6))) : 1;
        const m = toward(S.pos[i].x + S.pos[i].w / 2, S.pos[i].y + S.pos[i].h / 2);
        s.style.opacity = p.o * lerp(dim, 1, restore); s.style.transform = `translate(${m.dx}px,${m.dy}px) scale(${(p.s * m.s).toFixed(4)})`;
        if (S.dotEl && i === S.spans.length - 1) { S.dotEl.style.opacity = s.style.opacity; S.dotEl.style.transform = `translate(${m.dx}px,${m.dy}px)`; }
      });
    } else if (L.device === 'swap') {
      let k2 = 0; L.at.forEach((a, i) => { if (b >= a) k2 = i; });
      const sw = k2 === 0 ? S.itemW[0] : lerp(S.itemW[k2 - 1], S.itemW[k2], outExpo(prog(b, L.at[k2], L.at[k2] + 0.6)));
      const total = S.leadW + (S.lead ? S.gap : 0) + sw; const x0 = S.cx - total / 2; const y = S.cy - S.size * 0.55;
      const m = toward(S.cx, S.cy);
      if (S.lead) { const p = pop(L.leadAt * BEAT, lt); S.lead.style.left = `${x0}px`; S.lead.style.top = `${y}px`; S.lead.style.opacity = p.o; S.lead.style.transform = `translate(${m.dx}px,${m.dy}px) scale(${p.s * m.s})`; }
      const sx = x0 + S.leadW + (S.lead ? S.gap : 0);
      S.items.forEach((n, i) => {
        const inP = outExpo(prog(b, L.at[i], L.at[i] + 0.5)); const outP = i < S.items.length - 1 ? inCubic(prog(b, L.at[i + 1], L.at[i + 1] + 0.3)) : 0;
        n.style.left = `${sx}px`; n.style.top = `${y + (1 - inP) * 0.8 * S.size - outP * 0.8 * S.size}px`;
        n.style.opacity = b >= L.at[i] && outP < 1 ? clamp(inP * 2) * (1 - outP) : 0;
        n.style.filter = inP < .97 && b >= L.at[i] ? `blur(${((1 - inP) * 8 * k).toFixed(1)}px)` : 'none';
        n.style.transform = `translate(${m.dx}px,${m.dy}px) scale(${m.s})`;
      });
    } else if (L.device === 'punch') {
      const v = outExpo(prog(b, L.at, L.at + 0.7)); const s = S.spans[0]; const m = toward(S.cx, S.cy);
      s.style.opacity = b >= L.at ? clamp((b - L.at) * BEAT / 0.06) : 0;
      s.style.transform = `translate(${m.dx}px,${m.dy}px) scale(${(lerp(2.2, 1, v) * m.s).toFixed(4)})`; s.style.filter = v < .97 ? `blur(${((1 - v) * 20 * k).toFixed(1)}px)` : 'none';
      if (S.dotEl) {
        // the dot sits outside the span, so it follows the punch's scale about the span's centre
        const sc = lerp(2.2, 1, v); S.dotEl.style.opacity = s.style.opacity;
        S.dotEl.style.transform = `translate(${((S.dot.x - S.cx) * (sc - 1)).toFixed(1)}px,${((S.dot.y - (S.pos[0].y + S.size * 0.6)) * (sc - 1)).toFixed(1)}px) scale(${sc})`;
      }
    } else if (L.device === 'lockup') {
      // letters burst out of the centre (where a collapse left its point) and fly to their places
      S.letters.forEach((Lt) => {
        const t0 = L.at * BEAT + Lt.d; const v = outExpo(prog(lt, t0, t0 + 0.8));
        const fromX = S.cx - (Lt.x + Lt.w / 2), fromY = S.size * 0.05;
        Lt.s.style.opacity = lt >= t0 ? clamp(v * 2) : 0; Lt.s.style.filter = v < .98 ? `blur(${((1 - v) * 14 * k).toFixed(1)}px)` : 'none';
        Lt.s.style.transform = `translate(${(fromX * (1 - v)).toFixed(1)}px,${(fromY * (1 - v)).toFixed(1)}px) rotate(${(Lt.rot * (1 - v)).toFixed(2)}deg) scale(${lerp(Lt.z, 1, v).toFixed(3)})`;
      });
    }
  }

  function placeScene(S, time, { cam, x = 0, mask = null, collapse = 0, z = 1 } = {}) {
    const lt = time - S.start; const c = cam || cameraFor(S, lt);
    S.scene.style.visibility = 'visible'; S.scene.style.zIndex = z;
    S.scene.style.transform = x ? `translateX(${x}px)` : 'none';
    const m = mask || 'none'; S.scene.style.webkitMaskImage = m; S.scene.style.maskImage = m;
    S.world.style.transform = `translate(${W / 2}px,${H / 2}px) rotate(${c.r || 0}deg) scale(${c.s}) translate(${-c.x}px,${-c.y}px)`;
    draw(S, lt, collapse);
    const dx = c.x - S.cx;
    S.lights.forEach((d, j) => {
      const ph = j * 2.1 + S.seed; const lx = W * (.5 + [-.2, .17, .03][j]) + Math.sin(time * 1.5 + ph) * 240 * k - dx * (.06 + j * .03) - 750 * k;
      const ly = H * (.52 + [.12, -.14, .3][j]) + Math.cos(time * 1.25 + ph) * 170 * k - 750 * k;
      d.style.transform = `translate(${lx.toFixed(1)}px,${ly.toFixed(1)}px) scale(${(.9 + .18 * Math.sin(time * 1.2 + ph)).toFixed(3)})`;
    });
    return c;
  }
  const toScreen = (c, x, y) => {
    const r = (c.r || 0) * Math.PI / 180; const px = (x - c.x) * c.s, py = (y - c.y) * c.s;
    return { x: W / 2 + px * Math.cos(r) - py * Math.sin(r), y: H / 2 + px * Math.sin(r) + py * Math.cos(r) };
  };
  const feather = (x, y, r, f = 240 * k) => `radial-gradient(circle at ${x.toFixed(1)}px ${y.toFixed(1)}px, #000 ${Math.max(0, r - f).toFixed(1)}px, transparent ${r.toFixed(1)}px)`;

  function frame(time) {
    const f = clamp(Math.floor(time * FPS + 1e-6), 0, D.totalFrames - 1);
    shots.forEach((S) => { S.scene.style.visibility = 'hidden'; });
    let i = shots.findIndex((S) => f >= S.shot.startFrame && f <= S.shot.endFrame); if (i < 0) i = shots.length - 1;
    const S = shots[i]; const N = shots[i + 1];
    if (S.dotEl) S.dotEl.style.background = S.serifLast ? `rgb(${tones[2]})` : S.theme.ink;
    const q = N ? prog(time, N.start - S.outBeats * BEAT, N.start) : 0;
    if (!N || q <= 0) { placeScene(S, time); return f; }
    const t = S.L.out;
    if (t === 'whip') {
      const e = ioQuint(q);
      placeScene(S, time, { x: -e * W * 1.15 });
      placeScene(N, N.start, { x: (1 - e) * W * 1.15, cam: cameraFor(N, 0), z: 2 });
    } else if (t === 'flip') {
      const c = placeScene(S, time);
      const last = S.pos ? S.pos[S.pos.length - 1] : { x: S.cx, y: S.cy, w: 0, h: 0 };
      const o = toScreen(c, last.x + last.w / 2, last.y + last.h / 2);
      placeScene(N, N.start, { cam: cameraFor(N, 0), mask: feather(o.x, o.y, io(q) * Math.hypot(W, H) * 1.15 + 1), z: 2 });
    } else if (t === 'fly-into' && S.dot) {
      // dive into the dot: the scale grows until the dot covers the frame, then the next scene is there
      const base = cameraFor(S, time - S.start);
      const e = Math.pow(q, 2.1); const aim = ioQuint(clamp(q * 1.5));
      const need = (Math.hypot(W, H) / (S.dot.r * 2)) * 1.6;
      const cam = { x: lerp(base.x, S.dot.x, aim), y: lerp(base.y, S.dot.y, aim), s: Math.exp(lerp(Math.log(base.s), Math.log(need), e)), r: lerp(base.r, 0, aim) };
      if (S.dotEl && q > 0.5) S.dotEl.style.background = N.theme.bg;
      placeScene(S, time, { cam });
      const reveal = prog(q, 0.85, 1);
      if (reveal > 0) placeScene(N, N.start, { cam: cameraFor(N, 0), mask: feather(W / 2, H / 2, io(reveal) * Math.hypot(W, H) + 1, 420 * k), z: 2 });
    } else if (t === 'collapse') {
      placeScene(S, time, { collapse: io(q) });
    } else placeScene(S, time);
    return f;
  }

  // ---------- QA: exact copy per device, and everything inside the safe area once settled
  function check() {
    const mx = W * 0.03, my = H * 0.03;
    const outside = (spans) => spans.filter((s) => { const r = s.getBoundingClientRect(); return r.width > 0 && Number(s.style.opacity || 1) > 0.5 && (r.left < mx || r.top < my || r.right > W - mx || r.bottom > H - my); }).length;
    const norm = (t) => String(t).replace(/\s+/g, ' ').trim();
    return shots.map((S) => {
      const L = S.L; const settle = Math.max(S.start, S.end - (S.outBeats + 0.5) * BEAT);
      let drawn, bad = 0;
      if (L.device === 'build') { frame(settle); drawn = S.spans.map((s) => s.textContent).join(' '); bad = outside(S.spans); }
      else if (L.device === 'swap') {
        drawn = [L.lead, ...S.items.map((n) => n.textContent)].filter(Boolean).join(' ');
        L.at.forEach((a, j) => { frame(S.start + Math.min((a + 0.6) * BEAT, S.end - S.start - (S.outBeats + 0.1) * BEAT)); bad += outside([S.lead, S.items[j]].filter(Boolean)); });
      } else if (L.device === 'punch') { frame(settle); drawn = S.spans[0].textContent; bad = outside(S.spans); }
      else { frame(settle); drawn = S.letters.map((Lt) => Lt.s.textContent.replace('\u00a0', ' ')).join(''); bad = outside(S.spans); }
      const copyMatches = norm(drawn) === norm(L.copy);
      return { shotId: S.shot.shotId, device: L.device, transition: L.out, theme: L.theme, copyMatches, lettersOutsideSafeArea: bad, pass: copyMatches && bad === 0 };
    });
  }

  window.FOLD_RENDER = { frame, check, unsupported: [] };
})();
