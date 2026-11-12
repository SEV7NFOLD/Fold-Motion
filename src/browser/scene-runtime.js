/*
 * FOLD Motion experimental browser renderer: the in-page runtime.
 *
 * Runs inside headless Chromium. It draws any moment of a timeline from the
 * engine's own layout (lines, sizes, positions and emphasis measured by
 * src/render/typography.mjs), so copy and placement match the SVG engine, and
 * adds what a browser does well: per-letter motion, a 3D camera, layered depth,
 * light, glow, atmosphere, grain and transitions such as a real accordion fold.
 *
 * Determinism: frame(t) is a pure function of t. No timers, no Date, and every
 * random value comes from a seeded generator.
 */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const DATA = window.FOLD_DATA;
  const W = DATA.width;
  const H = DATA.height;
  const FPS = DATA.fps;
  const PERSPECTIVE = Math.round(W * 0.85);
  const STRIPS = 4;
  // Looks: 'default' keeps the SVG engine's appearance; 'paper' prints each shot's
  // type on a sheet of paper that unfolds in 3D under a raking light.
  const PAPER = DATA.look === 'paper';
  const PAPER_COLOR = '#EDE7DC';

  // ---------- math
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const prog = (t, a, b) => (b <= a ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)));
  const lerp = (a, b, x) => a + (b - a) * x;
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const easeOut = (x) => 1 - Math.pow(1 - x, 4);
  const easeIn = (x) => x * x * x;
  function spring(t, w = 11, z = 0.55) {
    if (t <= 0) return 0;
    if (t > 4) return 1; // settled: land exactly on the engine's layout
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
  }
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hexRgb(hex) {
    const h = String(hex || '#000000').replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0);
  }
  const rgba = (hex, a) => `rgba(${hexRgb(hex).join(',')},${a})`;
  function mixHex(a, b, amount) {
    const [x, y] = [hexRgb(a), hexRgb(b)];
    return `#${x.map((c, i) => Math.round(lerp(c, y[i], amount)).toString(16).padStart(2, '0')).join('')}`;
  }
  const luminance = (hex) => {
    const [r, g, b] = hexRgb(hex).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const svg = (name, attrs = {}, parent) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  };
  const div = (cls, parent, style = '') => {
    const node = document.createElement('div');
    node.className = cls;
    if (style) node.style.cssText = style;
    if (parent) parent.appendChild(node);
    return node;
  };

  // ---------- page skeleton
  const root = document.getElementById('root');
  const bg = document.createElement('canvas');
  bg.width = W; bg.height = H; bg.className = 'fill';
  root.appendChild(bg);
  const bx = bg.getContext('2d');
  const stage = div('fill stage', root, `perspective:${PERSPECTIVE}px`);
  const overlay = div('fill', root);
  // Film grain is added by FFmpeg after the motion-blur blend (render-browser.mjs):
  // per-sample grain would average away and makes every capture slow to encode.
  div('fill vignette', root);

  const unsupported = [];
  let instanceCount = 0;

  // ---------- one drawable copy of a shot's typography (the "plate")
  function buildPlate(shot, holder) {
    const id = `p${instanceCount += 1}`;
    const primary = shot.palette?.primary || '#0B0F19';
    const ink = luminance(primary) < 0.2 ? primary : '#14161C';
    const deepAccent = mixHex(shot.palette?.accent || '#00F0FF', '#000000', 0.45);
    const plate = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'plate' }, holder);
    const defs = svg('defs', {}, plate);
    const glow = svg('filter', { id: `${id}-glow`, x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    svg('feGaussianBlur', { stdDeviation: Math.max(2, W / 640), result: 'b' }, glow);
    const merge = svg('feMerge', {}, glow);
    svg('feMergeNode', { in: 'b' }, merge); svg('feMergeNode', { in: 'SourceGraphic' }, merge);
    const sheen = svg('linearGradient', { id: `${id}-sheen`, gradientUnits: 'userSpaceOnUse', x1: -400, y1: 0, x2: -100, y2: 0 }, defs);
    for (const [o, a] of [[0, 0], [0.45, 0.25], [0.5, 0.9], [0.55, 0.25], [1, 0]]) {
      svg('stop', { offset: o, 'stop-color': '#ffffff', 'stop-opacity': a }, sheen);
    }

    const letters = [];
    const accents = [];
    const extras = [];
    const sheenLetters = [];
    const sheenGroup = svg('g', { class: 'sheen' });
    let gradientCount = 0;

    for (const el of shot.spec.elements || []) {
      if (el.type === 'text' && el.role !== 'decor') {
        const text = String(el.shown ?? el.content ?? '');
        const lines = Array.isArray(el.lines) && el.lines.length ? el.lines : [text];
        const size = Number(el.fontSize) || 80;
        const lineHeight = Number(el.lineHeight) || size * 1.05;
        const family = DATA.fonts[el.font] || DATA.fonts.display;
        const anchor = el.anchor === 'start' ? 'start' : el.anchor === 'end' ? 'end' : 'middle';
        const emphasized = new Set(el.emphasis?.words || []);
        let emphasisFill = null;
        if (emphasized.size) {
          gradientCount += 1;
          const gid = `${id}-em${gradientCount}`;
          const g = svg('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
          svg('stop', { offset: 0, 'stop-color': PAPER ? deepAccent : el.emphasis.from || el.fill }, g);
          svg('stop', { offset: 1, 'stop-color': PAPER ? mixHex(deepAccent, '#000000', 0.25) : el.emphasis.to || el.fill }, g);
          emphasisFill = `url(#${gid})`;
        }
        const group = svg('g', {}, plate);
        let wordIndex = 0;
        let order = 0;
        lines.forEach((line, lineIndex) => {
          const baseline = Number(el.y) + lineIndex * lineHeight;
          // Measure the whole line as the engine lays it out, then draw each letter
          // on its own at the measured position, so letters can move independently.
          const probe = svg('text', {
            x: el.x, y: baseline, 'text-anchor': anchor, 'font-size': size,
            'letter-spacing': `${(Number(el.tracking) || 0) * size}px`, style: `font-family:${family}`,
          }, plate);
          probe.textContent = line;
          const chars = [...line];
          const positions = chars.map((_, k) => {
            try { return probe.getStartPositionOfChar(k).x; } catch { return NaN; }
          });
          if (positions.some((x) => !Number.isFinite(x))) unsupported.push({ shotId: shot.shotId, element: el.id, reason: `Letter positions for "${line}" could not be measured.` });
          probe.remove();
          chars.forEach((ch, k) => {
            if (ch === ' ') { wordIndex += 1; return; }
            const isEmphasis = emphasized.has(wordIndex);
            const attrs = { x: positions[k], y: baseline, 'font-size': size, style: `font-family:${family}`, fill: isEmphasis && emphasisFill ? emphasisFill : (PAPER ? ink : el.fill || '#ffffff') };
            const node = svg('text', attrs, group);
            node.textContent = ch;
            if (isEmphasis && !PAPER) node.setAttribute('filter', `url(#${id}-glow)`);
            letters.push({ node, el, role: el.role, ch, x: positions[k], baseline, size, order: order++, word: wordIndex, line: lineIndex, emphasis: isEmphasis });
            if (el.role === 'title' && shot.spec.sweep) {
              const s = svg('text', { ...attrs, fill: `url(#${id}-sheen)` }, sheenGroup);
              s.textContent = ch;
              sheenLetters.push(s);
            }
          });
          wordIndex += 1;
        });
      } else if (el.type === 'line' || (el.type === 'rect' && !String(el.id || '').endsWith('-background'))) {
        const w = Number(el.width) || 0;
        const h = Math.max(1, Number(el.height) || 1);
        const x = el.type === 'line' ? Number(el.x) - w / 2 : Number(el.x);
        const r = svg('rect', { x, y: Number(el.y) - (el.type === 'line' ? h / 2 : 0), width: w, height: h, fill: PAPER ? deepAccent : el.fill || shot.palette.accent, filter: el.type === 'line' && !PAPER ? `url(#${id}-glow)` : '' }, plate);
        if (el.opacity !== undefined) r.setAttribute('opacity', el.opacity);
        accents.push({ node: r, el, cx: x + w / 2, cy: Number(el.y) });
      } else if (el.type === 'circle') {
        const c = svg('circle', { cx: el.cx ?? el.x, cy: el.cy ?? el.y, r: el.r ?? el.radius ?? 4, fill: el.fill || shot.palette.accent }, plate);
        extras.push({ node: c, el });
      } else if (el.type === 'image') {
        unsupported.push({ shotId: shot.shotId, element: el.id, reason: 'Images (product photos) are not drawn by the experimental browser renderer yet.' });
      }
    }
    if (sheenLetters.length) plate.appendChild(sheenGroup);
    return { plate, letters, accents, extras, sheen, sheenGroup, sheenLetters, titleLetters: letters.filter((L) => L.role === 'title') };
  }

  // ---------- one shot: deep echo layer, flat plate, accordion copies, overlays
  const shots = DATA.shots.map((shot, index) => {
    const primary = shot.palette?.primary || DATA.palette?.primary || '#0B0F19';
    const accent = shot.palette?.accent || DATA.palette?.accent || '#00F0FF';
    const light = luminance(primary) > 0.4;
    // Built visible: hidden text has no layout, so it can't be measured.
    const world = div('world', stage);

    // The giant outlined echo word sits deep behind the type, for parallax.
    const echo = (shot.spec.elements || []).find((el) => el.type === 'text' && el.role === 'decor');
    let echoLayer = null;
    if (echo) {
      const depth = W * 0.4;
      const scale = (PERSPECTIVE + depth) / PERSPECTIVE;
      echoLayer = div('layer', world, `transform:translateZ(${-depth}px) scale(${scale})`);
      const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H }, echoLayer);
      const t = svg('text', {
        x: W / 2, y: H / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': Number(echo.fontSize) || H * 0.6, fill: 'none', stroke: accent, 'stroke-width': Math.max(1.5, W / 900),
        'stroke-opacity': light ? 0.35 : 0.22, style: `font-family:${DATA.fonts[echo.font] || DATA.fonts.display}`,
      }, s);
      t.textContent = String(echo.shown ?? echo.content ?? '');
      echoLayer.echoText = t;
    }

    const flatLayer = div('layer', world);
    const flat = buildPlate(shot, flatLayer);

    // Accordion: strips nested in one another, each showing its slice of a plate copy.
    const fold = div('layer fold', world);
    // A soft shadow under the paper sheet.
    const sheetShadow = PAPER ? div('fill', fold, `background:rgba(0,0,0,.55);filter:blur(${Math.round(W / 40)}px);transform:translate3d(0,${Math.round(H * 0.03)}px,-60px)`) : null;
    const sheet = div('sheet', fold, `width:${W}px;height:${H}px`);
    const strips = [];
    let parent = sheet;
    const sw = W / STRIPS;
    for (let k = 0; k < STRIPS; k++) {
      const strip = div('strip', parent, `left:${k ? sw : 0}px;width:${sw}px;height:${H}px`);
      const face = div('face', strip);
      const inner = div('inner', face, `left:${-k * sw}px;width:${W}px;height:${H}px`);
      const plate = buildPlate(shot, inner);
      const shade = div('fill', face);
      const glint = div('fill', face, 'mix-blend-mode:screen');
      strips.push({ strip, plate, shade, inner, glint });
      parent = strip;
    }
    fold.style.display = 'none';
    world.style.display = 'none';

    const revealEnd = Math.max(0.6, ...(shot.spec.elements || []).map((el) => (el.reveal ? (Number(el.reveal.start) || 0) + (Number(el.reveal.duration) || 0.8) : 0)));
    const duration = shot.durationFrames / FPS;
    return {
      shot, index, primary, accent, light, world, echoLayer, flatLayer, flat, fold, sheet, sheetShadow, strips,
      start: shot.startFrame / FPS, duration, revealEnd,
      transitionWindow: Math.min(0.5, duration * 0.25),
      seed: 101 + index * 7919,
      card: mixHex(primary, light ? '#ffffff' : accent, light ? 0.5 : 0.07),
      panel: mixHex(accent, primary, 0.55),
    };
  });
  const veil = div('fill', overlay);
  const wipe = div('fill', overlay);

  // ---------- per-letter motion
  function letterOffset(L, t, motion, shotIndex) {
    const reveal = L.el.reveal || {};
    const start = Number(reveal.start) || 0;
    const span = Math.max(0.5, Number(reveal.duration) || 0.9);
    const count = L.role === 'title' ? 1 : 0.5;
    const stagger = Math.min(0.045, (span * 0.55) / Math.max(8, 30 * count));
    const local = t - start - (motion === 'split' ? L.word * 0.09 : L.order * stagger);
    const s = L.size;
    const p = local <= 0 ? 0 : 1;
    if (L.role !== 'title') {
      const v = spring(local, 9, 0.8);
      return { dx: 0, dy: (1 - v) * s * 0.6, scale: 1, rot: 0, opacity: clamp(local / 0.25) * p };
    }
    switch (motion) {
      case 'slam': {
        const v = spring(local, 13, 0.42);
        return { dx: 0, dy: 0, scale: lerp(2.3, 1, v), rot: 0, opacity: clamp(local / 0.08) };
      }
      case 'drop': {
        const v = spring(local, 10, 0.38);
        return { dx: 0, dy: (v - 1) * s * 0.9, scale: 1, rot: (1 - v) * (L.order % 2 ? 9 : -9), opacity: clamp(local / 0.12) };
      }
      case 'split': {
        const v = spring(local, 8, 0.7);
        const dir = L.word % 2 ? 1 : -1;
        return { dx: (1 - v) * dir * W * 0.35, dy: 0, scale: 1, rot: 0, opacity: clamp(local / 0.2) };
      }
      default: { // rise
        const v = spring(local, 9, 0.62);
        return { dx: 0, dy: (1 - v) * s * 0.75, scale: lerp(0.6, 1, Math.min(1, v)), rot: (1 - v) * -6, opacity: clamp(local / 0.18) };
      }
    }
  }

  function updatePlate(S, P, t) {
    const motion = S.shot.spec.textMotion || 'rise';
    for (const L of P.letters) {
      const o = letterOffset(L, t, motion, S.index);
      const cx = L.x + L.size * 0.25;
      const cy = L.baseline - L.size * 0.35;
      L.node.setAttribute('transform', `translate(${o.dx.toFixed(2)} ${o.dy.toFixed(2)}) translate(${cx} ${cy}) rotate(${o.rot.toFixed(3)}) scale(${o.scale.toFixed(4)}) translate(${-cx} ${-cy})`);
      L.node.setAttribute('opacity', o.opacity.toFixed(3));
    }
    P.sheenLetters.forEach((n, i) => {
      const src = P.titleLetters[i];
      if (src) n.setAttribute('transform', src.node.getAttribute('transform'));
    });
    if (P.sheenLetters.length) {
      const sp = easeIO(prog(t, S.revealEnd - 0.1, S.revealEnd + 1.2));
      const x = lerp(-W * 0.3, W * 1.3, sp);
      P.sheen.setAttribute('x1', x - W * 0.18); P.sheen.setAttribute('x2', x + W * 0.18);
      P.sheenGroup.setAttribute('opacity', (Math.sin(Math.PI * sp) * 0.9).toFixed(3));
    }
    for (const A of P.accents) {
      const r = A.el.reveal || {};
      const v = easeOut(prog(t, Number(r.start) || 0, (Number(r.start) || 0) + (Number(r.duration) || 0.8)));
      const from = r.from === 'left' ? A.cx - Number(A.el.width) / 2 : A.cx;
      A.node.setAttribute('transform', `translate(${from} 0) scale(${v.toFixed(4)} 1) translate(${-from} 0)`);
      const flash = S.shot.spec.beam ? 1 + 2.5 * Math.max(0, 1 - Math.abs(t - ((Number(r.start) || 0) + (Number(r.duration) || 0.8))) / 0.35) : 1;
      A.node.setAttribute('opacity', clamp((A.el.opacity ?? 1) * Math.min(flash, 1.0)).toFixed(3));
      A.node.style.filter = flash > 1 ? `brightness(${flash.toFixed(2)})` : '';
    }
  }

  // ---------- camera from the planned move
  function camera(S, t) {
    const u = easeIO(prog(t, 0, S.duration));
    const k = W / 1920;
    switch (S.shot.spec.motion?.camera) {
      case 'push-in': return { rx: lerp(4, 1, u), ry: 0, z: lerp(-40, 170, u) * k, x: 0 };
      case 'pull-out': return { rx: lerp(1, 4, u), ry: 0, z: lerp(170, -40, u) * k, x: 0 };
      case 'drift-left': return { rx: 2, ry: lerp(7, -7, u), z: 40 * k, x: lerp(30, -30, u) * k };
      case 'drift-right': return { rx: 2, ry: lerp(-7, 7, u), z: 40 * k, x: lerp(-30, 30, u) * k };
      case 'static': return { rx: 0, ry: 0, z: Math.sin(t * 0.9) * 8 * k, x: 0 };
      default: return { rx: lerp(5, 2, u), ry: lerp(-5, 5, u), z: lerp(0, 90, u) * k, x: 0 };
    }
  }

  // ---------- atmosphere on the background canvas
  function drawBackground(S, t, intensity) {
    const { primary, accent, light } = S;
    bx.globalAlpha = 1;
    bx.fillStyle = primary; bx.fillRect(0, 0, W, H);
    const g = bx.createRadialGradient(W / 2, H * 0.52, 0, W / 2, H * 0.52, W * 0.55);
    const atmosphere = S.shot.spec.motion?.atmosphere || 'dots';
    const bloom = (atmosphere === 'spotlight' ? 0.26 : 0.14) * (light ? 0.5 : 1) * intensity;
    g.addColorStop(0, rgba(accent, bloom)); g.addColorStop(0.5, rgba(mixHex(primary, accent, 0.12), 0.35)); g.addColorStop(1, rgba(primary, 0));
    bx.fillStyle = g; bx.fillRect(0, 0, W, H);
    const R = rng(S.seed);
    const ink = light ? mixHex(primary, '#000000', 0.5) : accent;
    if (atmosphere === 'lines' || atmosphere === 'grid') {
      bx.strokeStyle = rgba(ink, 0.10); bx.lineWidth = Math.max(1, W / 1600);
      const horizon = H * 0.58;
      for (let i = -12; i <= 12; i++) { bx.beginPath(); bx.moveTo(W / 2 + i * W * 0.02, horizon); bx.lineTo(W / 2 + i * W * 0.22, H * 1.05); bx.stroke(); }
      for (let i = 0; i < 9; i++) {
        const f = ((i + (t * 0.6) % 1) / 9); const y = horizon + Math.pow(f, 2.2) * (H * 0.5);
        bx.globalAlpha = f; bx.beginPath(); bx.moveTo(0, y); bx.lineTo(W, y); bx.stroke();
      }
      if (atmosphere === 'grid') for (let i = 0; i < 9; i++) { const f = ((i + (t * 0.6) % 1) / 9); const y = horizon - Math.pow(f, 2.2) * (H * 0.55); bx.globalAlpha = f * 0.6; bx.beginPath(); bx.moveTo(0, y); bx.lineTo(W, y); bx.stroke(); }
      bx.globalAlpha = 1;
    } else if (atmosphere === 'planes') {
      for (let i = 0; i < 5; i++) {
        const w = W * (0.25 + R() * 0.35); const x0 = R() * W - w / 2 + Math.sin(t * 0.4 + i) * W * 0.03; const y0 = R() * H;
        bx.save(); bx.translate(x0, y0); bx.rotate(-0.5 + R() * 0.2);
        const pg = bx.createLinearGradient(0, 0, w, 0); pg.addColorStop(0, rgba(ink, 0)); pg.addColorStop(0.5, rgba(ink, 0.07)); pg.addColorStop(1, rgba(ink, 0));
        bx.fillStyle = pg; bx.fillRect(-w / 2, -H * 0.08, w, H * 0.16); bx.restore();
      }
    }
    const count = atmosphere === 'dots' || atmosphere === 'orbit' ? 150 : 70;
    for (let i = 0; i < count; i++) {
      const z = 0.2 + R() * 0.8; const r0 = (0.6 + R() * 2.2) * z * (W / 1920);
      let x = R() * W * 1.2 - W * 0.1; let y = R() * H * 1.2 - H * 0.1;
      if (atmosphere === 'orbit') { const a = R() * 6.283 + t * 0.25 * z; const rad = (0.15 + R() * 0.5) * W; x = W / 2 + Math.cos(a) * rad; y = H / 2 + Math.sin(a) * rad * 0.45; }
      else { x += t * 16 * z * (W / 1920); y -= t * 9 * z * (W / 1920); }
      bx.globalAlpha = (0.12 + 0.5 * z) * (0.6 + 0.4 * Math.sin(t * 2 + i));
      bx.fillStyle = z > 0.75 ? ink : (light ? '#55555a' : '#9aa3b8');
      bx.beginPath(); bx.arc(x, y, r0, 0, 6.283); bx.fill();
    }
    bx.globalAlpha = 1;
  }

  // ---------- transitions
  function transitionState(S, t) {
    const prev = shots[S.index - 1];
    const tin = prev ? prev.shot.spec.transitionOut || 'cut' : 'cut';
    const tout = S.shot.spec.transitionOut || 'cut';
    const winIn = prev ? prev.transitionWindow : 0.4;
    const r = prev ? prog(t, 0, winIn) : 1;
    const q = S.index < shots.length - 1 ? prog(t, S.duration - S.transitionWindow, S.duration) : 0;
    return { tin, tout, r, q };
  }

  let current = null;
  function showShot(S) {
    if (current === S) return;
    if (current) current.world.style.display = 'none';
    S.world.style.display = '';
    current = S;
  }

  function frame(time) {
    const f = clamp(Math.floor(time * FPS + 1e-6), 0, DATA.totalFrames - 1);
    const S = shots.find((s) => f >= s.shot.startFrame && f <= s.shot.endFrame) || shots[shots.length - 1];
    const t = time - S.start;
    showShot(S);
    const cam = camera(S, t);
    const { tin, tout, r, q } = transitionState(S, t);

    let z = cam.z; let scale = 1; let opacity = 1; let foldAngle = 0;
    let veilOpacity = 0; let wipeX = null;
    // incoming
    if (r < 1) {
      if (tin === 'fade') veilOpacity = Math.max(veilOpacity, 1 - easeOut(r));
      if (tin === 'wipe') wipeX = lerp(0, W * 1.15, easeOut(r));
      if (tin === 'push') { z += lerp(-W * 0.35, 0, easeOut(r)); opacity *= clamp(r * 2.5); }
      if (tin === 'zoom') { scale *= lerp(0.55, 1, easeOut(r)); opacity *= clamp(r * 3); }
      if (tin === 'fold') foldAngle = Math.max(foldAngle, lerp(86, 0, spring(r * S.transitionWindow * 2.2, 5, 0.75)));
    }
    // outgoing
    if (q > 0) {
      if (tout === 'fade') veilOpacity = Math.max(veilOpacity, easeIn(q));
      if (tout === 'wipe') wipeX = lerp(-W * 1.15, 0, easeIn(q));
      if (tout === 'push') { z += easeIn(q) * W * 0.5; opacity *= 1 - prog(q, 0.7, 1); }
      if (tout === 'zoom') { scale *= lerp(1, 3.2, easeIn(q)); opacity *= 1 - prog(q, 0.65, 1); }
      if (tout === 'fold') { foldAngle = Math.max(foldAngle, easeIO(q) * 88); opacity *= 1 - prog(q, 0.8, 1); }
    }
    if (PAPER) {
      // Every shot's sheet unfolds in, and sits a little back so its edges show.
      scale *= 0.8;
      foldAngle = Math.max(foldAngle, lerp(82, 0, spring(t - 0.04, 4.4, 0.72)));
    }

    drawBackground(S, t, 1);
    S.world.style.transform = `translateX(${cam.x}px) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg) translateZ(${z}px) scale(${scale})`;
    S.world.style.opacity = opacity;
    if (S.echoLayer) S.echoLayer.echoText.setAttribute('transform', `translate(${lerp(W * 0.04, -W * 0.04, prog(t, 0, S.duration))} 0)`);
    if (S.echoLayer) S.echoLayer.style.opacity = (1 - foldAngle / 88) * clamp(t / 0.6);

    if (foldAngle > 0.05 || PAPER) {
      S.flatLayer.style.display = 'none';
      S.fold.style.display = '';
      const a = foldAngle; const ar = (a * Math.PI) / 180;
      // The sheet materialises as it folds, so the flat frame looks unchanged.
      const solid = PAPER ? 1 : easeOut(clamp(a / 30));
      // The raking light pass, once the type has landed.
      const lp = easeIO(prog(t, S.revealEnd - 0.3, S.revealEnd + 1.3));
      const lx = lerp(-W * 0.3, W * 1.3, lp);
      const li = Math.sin(Math.PI * lp) * (PAPER ? 1 : 0);
      S.strips.forEach((st, k) => {
        st.strip.style.transform = `rotateY(${k === 0 ? a : k % 2 ? -2 * a : 2 * a}deg)`;
        const facing = k % 2 === 0;
        st.inner.style.background = PAPER ? PAPER_COLOR : rgba(S.card, solid);
        st.inner.style.boxShadow = PAPER ? '' : `inset ${facing ? 2 : -2}px 0 0 ${rgba(S.accent, 0.35 * solid)}`;
        if (PAPER) {
          const x = lx - k * (W / STRIPS); const band = W * 0.14;
          st.glint.style.background = li > 0.01 ? `linear-gradient(100deg,transparent ${x - band * 1.6}px,${rgba(S.accent, 0.22 * li)} ${x - band * 0.5}px,rgba(235,255,255,${0.7 * li}) ${x}px,${rgba(S.accent, 0.22 * li)} ${x + band * 0.5}px,transparent ${x + band * 1.6}px)` : 'none';
        }
        const dark = Math.sin(ar) * (facing ? (PAPER ? 0.18 : 0.15) : 0.6) * solid;
        st.shade.style.background = `linear-gradient(90deg,rgba(0,0,0,${dark * (facing ? 0.5 : 1)}),rgba(0,0,0,${dark * (facing ? 1 : 0.6)}))`;
        updatePlate(S, st.plate, t);
      });
      S.sheet.style.transform = `translateX(${(W - W * Math.cos(ar)) / 2}px)`;
      if (S.sheetShadow) {
        S.sheetShadow.style.width = `${W * Math.cos(ar)}px`;
        S.sheetShadow.style.left = `${(W - W * Math.cos(ar)) / 2}px`;
      }
    } else {
      S.fold.style.display = 'none';
      S.flatLayer.style.display = '';
      updatePlate(S, S.flat, t);
    }

    veil.style.background = S.primary;
    veil.style.opacity = veilOpacity;
    if (wipeX === null) { wipe.style.display = 'none'; } else {
      wipe.style.display = '';
      wipe.style.background = `linear-gradient(90deg, ${S.panel} 0%, ${S.panel} 92%, ${mixHex(S.panel, '#ffffff', 0.25)} 92%, ${mixHex(S.panel, '#ffffff', 0.25)} 100%)`;
      wipe.style.transform = `translateX(${wipeX}px) skewX(-8deg) scaleX(1.12)`;
    }

    return f;
  }

  // ---------- QA: the copy reads exactly as written and every title letter is in frame
  function check() {
    const marginX = W * 0.02; const marginY = H * 0.02;
    return shots.map((S) => {
      const settle = clamp(S.revealEnd + 0.6, 0, Math.max(0, S.duration - S.transitionWindow - 0.05));
      frame(S.start + settle);
      // Measure the flat layer: in the paper look the strips are what's visible, and
      // hidden letters have no geometry. At the settled moment the sheet is flat, so
      // the flat layer sits exactly where the strips do.
      const foldShown = S.fold.style.display !== 'none';
      if (foldShown) { updatePlate(S, S.flat, settle); S.flatLayer.style.display = ''; S.fold.style.display = 'none'; }
      const titles = S.flat.letters.filter((L) => L.role === 'title');
      const expected = (S.shot.spec.elements || []).filter((el) => el.type === 'text' && el.role === 'title').map((el) => String(el.shown ?? el.content ?? '')).join('');
      const drawn = titles.map((L) => L.ch).join('');
      // Letters on a line must advance left to right at their settled positions.
      let collapsed = 0;
      for (let i = 1; i < titles.length; i++) {
        const [a, b] = [titles[i - 1], titles[i]];
        if (a.el === b.el && a.line === b.line) {
          const [ra, rb] = [a.node.getBoundingClientRect(), b.node.getBoundingClientRect()];
          if (!(rb.left > ra.left + ra.width * 0.3)) collapsed += 1;
        }
      }
      const outside = titles.filter((L) => {
        const b = L.node.getBoundingClientRect();
        return b.width > 0 && (b.left < marginX || b.top < marginY || b.right > W - marginX || b.bottom > H - marginY);
      }).length;
      if (foldShown) { S.flatLayer.style.display = 'none'; S.fold.style.display = ''; }
      return {
        shotId: S.shot.shotId,
        settledAt: Number(settle.toFixed(3)),
        copyMatches: drawn === expected.replace(/\s+/g, ''),
        lettersOutsideSafeArea: outside,
        collapsedLetters: collapsed,
        pass: drawn === expected.replace(/\s+/g, '') && outside === 0 && collapsed === 0,
      };
    });
  }

  window.FOLD_RENDER = { frame, check, unsupported };
})();
