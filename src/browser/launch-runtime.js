/*
 * FOLD Motion launch runtime (docs/LAUNCH-STYLE-BUILD-PLAN.md, Phases 3–4).
 *
 * Draws a beat-timed launch timeline in headless Chromium: the camera does the
 * animating (opening zoom-out, chasing the newest words, continuous drift, a
 * whip-pan onto every cut), words pop in place, older words step back, soft
 * light drifts behind. Devices: build, swap, punch, lockup (src/production/
 * launch.mjs plans them).
 *
 * Determinism: frame(t) is a pure function of t; randomness is seeded.
 */
(() => {
  const D = window.FOLD_DATA;
  const W = D.width, H = D.height, FPS = D.fps;
  const BEAT = 60 / D.beat.bpm;
  const SLOT = W * 1.4;                                    // shots sit side by side in one world
  const k = W / 1920;                                       // scale every size to the frame

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
  const lum = (h) => { const [r, g, b] = hex(h).map((c) => { const s = c / 255; return s <= .03928 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  function hueShift(h, deg) {
    let [r, g, b] = hex(h).map((c) => c / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let hh = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; }
    hh = (hh + deg + 360) % 360; const c = (1 - Math.abs(2 * l - 1)) * Math.max(s, .55), x = c * (1 - Math.abs((hh / 60) % 2 - 1)), m = l - c / 2;
    const [rr, gg, bb] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
    return [rr + m, gg + m, bb + m].map((v) => Math.round(clamp(v) * 255));
  }
  const el = (tag, css, parent, text) => { const n = document.createElement(tag); n.style.cssText = css; if (text !== undefined) n.textContent = text; parent.appendChild(n); return n; };

  // ---------- theme from the brand
  const bg = D.palette.primary, accent = D.palette.accent;
  const darkBg = lum(bg) < 0.35;
  const ink = darkBg ? '#F5F7FB' : '#0B0F19';
  const SANS = D.fonts.sans, SERIF = D.fonts.serif;
  const root = document.getElementById('root');
  root.style.background = bg;
  const light = el('div', `position:absolute;inset:0;overflow:hidden`, root);
  const lights = [hex(accent), hueShift(accent, 32), hueShift(accent, 68)].map((c, i) => {
    const a = (darkBg ? [.30, .38, .28] : [.20, .16, .18])[i];
    return el('div', `position:absolute;left:0;top:0;width:${1500 * k}px;height:${1500 * k}px;border-radius:50%;background:radial-gradient(closest-side,rgba(${c},${a}),rgba(${c},${a * .45}) 45%,rgba(${c},0))`, light);
  });
  const stage = el('div', 'position:absolute;inset:0;overflow:hidden', root);
  const world = el('div', `position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0`, stage);
  const accentGradient = `linear-gradient(100deg, ${accent}, rgb(${hueShift(accent, 68)}))`;

  const fit = (spans) => spans.map((s) => s.getBoundingClientRect().width);
  function wordSpan(parent, text, size, { serif = false } = {}) {
    const css = serif
      ? `position:absolute;left:0;top:0;white-space:pre;line-height:1;font-family:${SERIF};font-style:italic;font-weight:400;font-size:${size}px;background:${accentGradient};-webkit-background-clip:text;background-clip:text;color:transparent;padding:0 .06em;transform-origin:50% 60%`
      : `position:absolute;left:0;top:0;white-space:pre;line-height:1;font-family:${SANS};font-weight:600;font-size:${size}px;letter-spacing:-.034em;color:${ink};transform-origin:50% 60%`;
    return el('span', css, parent, text);
  }
  // lays words out in up to `maxLines` centred lines inside `maxW`, shrinking the size until it fits
  function layoutWords(parent, words, { size, maxW, maxLines, cx, cy, serifLast }) {
    // one line first (down to 96 px), so the camera can chase along it; then up to maxLines
    const one = tryLayout(parent, words, { size, maxW, lines: 1, floor: 96 * k, cx, cy, serifLast });
    return one || tryLayout(parent, words, { size, maxW, lines: maxLines, floor: 56 * k, cx, cy, serifLast, force: true });
  }
  function tryLayout(parent, words, { size, maxW, lines: maxLines, floor, cx, cy, serifLast, force }) {
    for (let fs = size; fs >= floor; fs *= 0.92) {
      const spans = words.map((w, i) => wordSpan(parent, w, fs, { serif: serifLast && i === words.length - 1 }));
      const widths = fit(spans);
      const gap = fs * 0.26; const lines = [[]]; let lw = 0;
      widths.forEach((w, i) => { if (lines[lines.length - 1].length && lw + gap + w > maxW) { lines.push([]); lw = 0; } lw += (lines[lines.length - 1].length ? gap : 0) + w; lines[lines.length - 1].push(i); });
      if (lines.length <= maxLines || (force && fs * 0.92 < floor)) {
        const lh = fs * 1.12; const top = cy - (lines.length * lh) / 2;
        const pos = [];
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

  // ---------- shots
  const shots = D.shots.map((shot, index) => {
    const L = shot.launch; const cx = index * SLOT + W / 2, cy = H / 2;
    const S = { index, shot, L, cx, cy, start: shot.startFrame / FPS, end: (shot.endFrame + 1) / FPS, layer: el('div', `position:absolute;left:0;top:0;width:${W}px;height:${H}px`, world) };
    if (L.device === 'build') {
      const words = []; const chunkOf = [];
      L.beats.forEach((chunk, c) => chunk.split(/\s+/).filter(Boolean).forEach((w) => { words.push(w); chunkOf.push(c); }));
      const lastWord = words[words.length - 1] || '';
      const serifLast = index === 0 && words.length > 1 && lastWord.replace(/[^\p{L}]/gu, '').length >= 3;
      Object.assign(S, layoutWords(S.layer, words, { size: 128 * k, maxW: 1500 * k, maxLines: 2, cx, cy, serifLast }), { words, chunkOf });
    } else if (L.device === 'swap') {
      const size = 104 * k;
      S.lead = L.lead ? wordSpan(S.layer, L.lead, size) : null;
      S.items = L.items.map((it) => { const s = wordSpan(S.layer, it, size, { serif: true }); return s; });
      S.leadW = S.lead ? S.lead.getBoundingClientRect().width : 0;
      S.itemW = S.items.map((s) => s.getBoundingClientRect().width);
      S.size = size; S.gap = size * 0.28;
    } else if (L.device === 'punch') {
      let fs = 300 * k; const probe = wordSpan(S.layer, L.copy, fs);
      const w = probe.getBoundingClientRect().width; if (w > 1600 * k) { fs *= (1600 * k) / w; probe.style.fontSize = `${fs}px`; }
      const pw = probe.getBoundingClientRect().width;
      probe.style.left = `${cx - pw / 2}px`; probe.style.top = `${cy - fs * 0.55}px`;
      S.spans = [probe]; S.size = fs;
    } else if (L.device === 'lockup') {
      let fs = 132 * k; const probe = wordSpan(S.layer, L.copy, fs);
      const w0 = probe.getBoundingClientRect().width; if (w0 > 1500 * k) fs *= (1500 * k) / w0; probe.remove();
      const chars = [...L.copy]; const R = rng(9 + index);
      const tmp = chars.map((ch) => wordSpan(S.layer, ch === ' ' ? '\u00a0' : ch, fs));
      const widths = tmp.map((s) => s.getBoundingClientRect().width); const total = widths.reduce((a, b) => a + b, 0);
      let x = cx - total / 2;
      S.letters = tmp.map((s, i) => { s.style.left = `${x}px`; s.style.top = `${cy - fs * 0.55}px`; const Lt = { s, x, w: widths[i], dx: (R() - .5) * 360 * k, dy: (R() - .5) * 220 * k, z: 1.8 + R() * 1.5, rot: (R() - .5) * 30, d: i * Math.min(0.07, 1.2 / chars.length) }; x += widths[i]; return Lt; });
      S.spans = tmp; S.size = fs;
    }
    return S;
  });

  // ---------- camera per device, as a function of the shot's local time
  function cameraFor(S, lt) {
    const b = lt / BEAT; const L = S.L; const drift = Math.sin(lt * 1.1 + S.index) * 10 * k + lt * 14 * k;
    if (L.device === 'build') {
      const centers = L.beats.map((_, c) => {
        const idx = S.chunkOf.map((cc, i) => (cc === c ? i : -1)).filter((i) => i >= 0);
        const xs = idx.map((i) => S.pos[i].x + S.pos[i].w / 2), ys = idx.map((i) => S.pos[i].y + S.pos[i].h * 0.55);
        return { x: xs.reduce((a, v) => a + v, 0) / xs.length, y: ys.reduce((a, v) => a + v, 0) / ys.length };
      });
      let x = centers[0].x, y = centers[0].y;
      L.at.forEach((a, c) => { if (c === 0) return; const e = outExpo(prog(b, a, a + 0.75)); x = lerp(x, centers[c].x, e); y = lerp(y, centers[c].y, e); });
      const settle = io(prog(b, L.at[L.at.length - 1] + 1, L.at[L.at.length - 1] + 2.2));
      x = lerp(x, S.cx, settle); y = lerp(y, S.cy, settle);
      let logS = S.index === 0 ? lerp(Math.log(2.4), Math.log(1.12), io(prog(b, 0, 1.4))) : Math.log(1.08);
      logS = lerp(logS, Math.log(1.0), settle);
      return { x: x + drift, y, s: Math.exp(logS) };
    }
    if (L.device === 'swap') return { x: S.cx + drift, y: S.cy, s: lerp(1.0, 1.12, io(prog(lt, 0, S.end - S.start))) };
    if (L.device === 'punch') return { x: S.cx + drift, y: S.cy, s: lerp(1.04, 1.16, io(prog(lt, 0, S.end - S.start))) };
    return { x: S.cx + drift * 0.5, y: S.cy, s: lerp(1.0, 1.08, io(prog(lt, 0, S.end - S.start))) };
  }

  // ---------- devices as a function of local time
  function pop(t0, t, from = 0.9) { return { o: t >= t0 ? clamp((t - t0) / 0.07) : 0, s: lerp(from, 1, outExpo(prog(t, t0, t0 + 0.4 * BEAT))) }; }
  function draw(S, lt) {
    const b = lt / BEAT; const L = S.L;
    if (L.device === 'build') {
      const lastAt = L.at[L.at.length - 1];
      const restore = outExpo(prog(b, lastAt + 1, lastAt + 1.6));
      S.spans.forEach((s, i) => {
        const c = S.chunkOf[i]; const within = S.chunkOf.slice(0, i).filter((cc) => cc === c).length;
        const p = pop((L.at[c] + within * 0.12) * BEAT, lt);
        const next = L.at[c + 1];
        const dim = next !== undefined ? lerp(1, 0.42, outExpo(prog(b, next, next + 0.6))) : 1;
        s.style.opacity = p.o * lerp(dim, 1, restore); s.style.transform = `scale(${p.s.toFixed(4)})`;
      });
    } else if (L.device === 'swap') {
      let k2 = 0; L.at.forEach((a, i) => { if (b >= a) k2 = i; });
      const sw = k2 === 0 ? S.itemW[0] : lerp(S.itemW[k2 - 1], S.itemW[k2], outExpo(prog(b, L.at[k2], L.at[k2] + 0.6)));
      const total = S.leadW + (S.lead ? S.gap : 0) + sw; const x0 = S.cx - total / 2; const y = S.cy - S.size * 0.55;
      if (S.lead) { const p = pop(L.leadAt * BEAT, lt); S.lead.style.left = `${x0}px`; S.lead.style.top = `${y}px`; S.lead.style.opacity = p.o; S.lead.style.transform = `scale(${p.s})`; }
      const sx = x0 + S.leadW + (S.lead ? S.gap : 0);
      S.items.forEach((n, i) => {
        const inP = outExpo(prog(b, L.at[i], L.at[i] + 0.5)); const outP = i < S.items.length - 1 ? inCubic(prog(b, L.at[i + 1], L.at[i + 1] + 0.3)) : 0;
        n.style.left = `${sx}px`; n.style.top = `${y + (1 - inP) * 0.8 * S.size - outP * 0.8 * S.size}px`;
        n.style.opacity = b >= L.at[i] && outP < 1 ? clamp(inP * 2) * (1 - outP) : 0;
        n.style.filter = inP < .97 && b >= L.at[i] ? `blur(${((1 - inP) * 8 * k).toFixed(1)}px)` : 'none';
      });
    } else if (L.device === 'punch') {
      const v = outExpo(prog(b, L.at, L.at + 0.7)); const s = S.spans[0];
      s.style.opacity = b >= L.at ? clamp((b - L.at) * BEAT / 0.06) : 0;
      s.style.transform = `scale(${lerp(1.7, 1, v).toFixed(4)})`; s.style.filter = v < .97 ? `blur(${((1 - v) * 18 * k).toFixed(1)}px)` : 'none';
    } else if (L.device === 'lockup') {
      S.letters.forEach((Lt) => {
        const t0 = L.at * BEAT + Lt.d; const v = outExpo(prog(lt, t0, t0 + 0.9));   // d is a delay in seconds
        Lt.s.style.opacity = lt >= t0 ? clamp(v * 1.6) : 0; Lt.s.style.filter = v < .98 ? `blur(${((1 - v) * 16 * k).toFixed(1)}px)` : 'none';
        Lt.s.style.transform = `translate(${(Lt.dx * (1 - v)).toFixed(1)}px,${(Lt.dy * (1 - v)).toFixed(1)}px) rotate(${(Lt.rot * (1 - v)).toFixed(2)}deg) scale(${lerp(Lt.z, 1, v).toFixed(3)})`;
      });
    }
  }

  function frame(time) {
    const f = clamp(Math.floor(time * FPS + 1e-6), 0, D.totalFrames - 1);
    const i = shots.findIndex((S) => f >= S.shot.startFrame && f <= S.shot.endFrame);
    const S = shots[i < 0 ? shots.length - 1 : i];
    const lt = time - S.start;
    let cam = cameraFor(S, lt);
    // whip-pan onto the next shot, landing exactly on the cut
    const next = shots[S.index + 1];
    if (next) {
      const q = ioQuint(prog(time, next.start - 0.5 * BEAT, next.start));
      if (q > 0) { const to = cameraFor(next, 0); cam = { x: lerp(cam.x, to.x, q), y: lerp(cam.y, to.y, q), s: Math.exp(lerp(Math.log(cam.s), Math.log(to.s), q)) }; }
    }
    world.style.transform = `translate(${W / 2}px,${H / 2}px) scale(${cam.s}) translate(${-cam.x}px,${-cam.y}px)`;
    shots.forEach((Sh) => { const near = Math.abs(Sh.index - S.index) <= 1; Sh.layer.style.visibility = near ? 'visible' : 'hidden'; if (near) draw(Sh, time - Sh.start); });
    const dx = cam.x - S.cx;
    lights.forEach((d, j) => {
      const ph = j * 2.1; const x = W * (.5 + [-.2, .17, .03][j]) + Math.sin(time * 1.3 + ph) * 220 * k - dx * (.06 + j * .03) - 750 * k;
      const y = H * (.52 + [.12, -.14, .3][j]) + Math.cos(time * 1.1 + ph) * 150 * k - 750 * k;
      d.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${(.9 + .15 * Math.sin(time + ph)).toFixed(3)})`;
    });
    return f;
  }

  // ---------- QA: exact copy per device, and everything inside the safe area when it has settled
  function check() {
    const mx = W * 0.03, my = H * 0.03;
    const inside = (spans) => spans.filter((s) => { const r = s.getBoundingClientRect(); return r.width > 0 && Number(s.style.opacity || 1) > 0.5 && (r.left < mx || r.top < my || r.right > W - mx || r.bottom > H - my); }).length;
    const norm = (t) => String(t).replace(/\s+/g, ' ').trim();
    return shots.map((S) => {
      const L = S.L; const settle = Math.max(S.start, S.end - 0.6 * BEAT);
      let drawn, outside = 0;
      if (L.device === 'build') { frame(settle); drawn = S.spans.map((s) => s.textContent).join(' '); outside = inside(S.spans); }
      else if (L.device === 'swap') {
        drawn = [L.lead, ...S.items.map((n) => n.textContent)].filter(Boolean).join(' ');
        L.at.forEach((a, i) => { frame(S.start + Math.min((a + 0.6) * BEAT, S.end - S.start - 1 / FPS)); outside += inside([S.lead, S.items[i]].filter(Boolean)); });
      } else if (L.device === 'punch') { frame(settle); drawn = S.spans[0].textContent; outside = inside(S.spans); }
      else { frame(settle); drawn = S.letters.map((Lt) => Lt.s.textContent.replace('\u00a0', ' ')).join(''); outside = inside(S.spans); }
      const copyMatches = norm(drawn) === norm(L.copy);
      return { shotId: S.shot.shotId, device: L.device, copyMatches, lettersOutsideSafeArea: outside, pass: copyMatches && outside === 0 };
    });
  }

  window.FOLD_RENDER = { frame, check, unsupported: [] };
})();
