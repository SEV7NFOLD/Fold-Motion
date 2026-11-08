/**
 * SVG logo sanitizer, shared by the studio (instant feedback on upload) and the
 * server (the authoritative check before anything renders).
 *
 * It rebuilds rather than filters: the SVG is parsed into a tree, and only
 * whitelisted shapes, attributes and local references are copied into a new
 * tree that our own code serializes. Scripts, event handlers, external links,
 * embedded HTML, images, <use> and animation are never copied. Simple
 * <style> class rules (as exported by Illustrator) become plain attributes.
 * Each drawable shape also gets its length measured, for the draw-on effect.
 */

export const SVG_LIMITS = Object.freeze({ maxBytes: 200_000, maxNodes: 4000 });

const CONTAINERS = new Set(['svg', 'g', 'defs', 'clipPath', 'linearGradient', 'radialGradient', 'text', 'tspan']);
const DRAWABLE = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const LEAVES = new Set(['stop']);
const ALLOWED = new Set([...CONTAINERS, ...DRAWABLE, ...LEAVES]);

const NUMERIC = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:px|%)?$/i;
const NUMBER_LIST = /^[-+0-9.,eE\s]*$/;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,eE+\-\s]*$/;
const TRANSFORM = /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([-+0-9.,eE\s]*\)\s*,?)*\s*$/;
const ID = /^[A-Za-z][\w.-]{0,63}$/;
const LOCAL_URL = /^url\(\s*['"]?#([A-Za-z][\w.-]{0,63})['"]?\s*\)$/;
const COLOR = /^(?:#[\da-f]{3,8}|[a-z]{3,20}|rgba?\(\s*[\d.%\s,]+\))$/i;

const PAINT = new Set(['fill', 'stroke', 'stop-color']);
const ATTRIBUTES = {
  id: (v) => ID.test(v),
  d: (v) => PATH_DATA.test(v),
  points: (v) => NUMBER_LIST.test(v),
  viewBox: (v) => NUMBER_LIST.test(v),
  transform: (v) => TRANSFORM.test(v),
  gradientTransform: (v) => TRANSFORM.test(v),
  'fill-rule': (v) => /^(?:nonzero|evenodd)$/.test(v),
  'clip-rule': (v) => /^(?:nonzero|evenodd)$/.test(v),
  'stroke-linecap': (v) => /^(?:butt|round|square)$/.test(v),
  'stroke-linejoin': (v) => /^(?:miter|round|bevel)$/.test(v),
  gradientUnits: (v) => /^(?:userSpaceOnUse|objectBoundingBox)$/.test(v),
  clipPathUnits: (v) => /^(?:userSpaceOnUse|objectBoundingBox)$/.test(v),
  'text-anchor': (v) => /^(?:start|middle|end)$/.test(v),
  'font-weight': (v) => /^(?:normal|bold|[1-9]00)$/.test(v),
  preserveAspectRatio: (v) => /^[a-zA-Z\s]{1,30}$/.test(v),
  'clip-path': (v) => LOCAL_URL.test(v),
};
for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'offset',
  'stroke-width', 'stroke-miterlimit', 'opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'font-size', 'letter-spacing']) {
  ATTRIBUTES[key] = (v) => NUMERIC.test(v.trim());
}
for (const key of PAINT) ATTRIBUTES[key] = (v) => v === 'none' || v === 'currentColor' || COLOR.test(v) || LOCAL_URL.test(v);
const STYLE_PROPERTIES = new Set(['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stop-color', 'stop-opacity', 'font-size', 'font-weight', 'letter-spacing']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// Only the five XML entities and numeric references are decoded. Custom entities
// (the XXE attack) are never expanded: they're removed.
const decode = (text) => String(text)
  .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => (
    e[0] === '#' ? String.fromCodePoint(Math.min(0x10ffff, e[1].toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)))) : `\u0000${ENTITIES[e.toLowerCase()]}`
  ))
  .replace(/&[A-Za-z_][\w.-]*;/g, '')
  .replace(/\u0000/g, '');
const escapeXml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

function parseDeclarations(text) {
  const out = {};
  for (const part of String(text).split(';')) {
    const index = part.indexOf(':');
    if (index < 0) continue;
    const key = part.slice(0, index).trim().toLowerCase();
    const value = part.slice(index + 1).trim();
    if (STYLE_PROPERTIES.has(key)) out[key] = value;
  }
  return out;
}

/** Simple class rules only (".a{...}" and ".a,.b{...}"); anything else is ignored. */
function parseStyleSheet(css) {
  const rules = {};
  const cleaned = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of cleaned.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = parseDeclarations(match[2]);
    for (const selector of match[1].split(',')) {
      const name = selector.trim().match(/^\.([A-Za-z_-][\w-]*)$/)?.[1];
      if (name) rules[name] = { ...(rules[name] || {}), ...declarations };
    }
  }
  return rules;
}

/** Splits markup into tags and text. Comments, CDATA (except inside <style>), PIs and doctypes are dropped. */
function tokenize(source) {
  const tokens = [];
  const pattern = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/\s*([A-Za-z][\w:-]*)\s*>|<\s*([A-Za-z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  for (const m of source.matchAll(pattern)) {
    if (m[1] !== undefined) tokens.push({ type: 'cdata', text: m[1] });
    else if (m[2]) tokens.push({ type: 'close', name: m[2] });
    else if (m[3]) {
      const attributes = {};
      for (const a of (m[4] || '').matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        attributes[a[1]] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      }
      tokens.push({ type: 'open', name: m[3], attributes, selfClosing: m[5] === '/' });
    } else if (m[6]) tokens.push({ type: 'text', text: m[6] });
  }
  return tokens;
}

function buildTree(tokens) {
  const root = { name: '#root', attributes: {}, children: [] };
  const stack = [root];
  let skipDepth = 0;
  let styleText = '';
  let inStyle = false;
  let nodes = 0;
  for (const token of tokens) {
    if (inStyle) {
      if (token.type === 'close' && token.name.toLowerCase() === 'style') inStyle = false;
      else if (token.type === 'text' || token.type === 'cdata') styleText += token.text;
      continue;
    }
    if (skipDepth > 0) {
      if (token.type === 'open' && !token.selfClosing) skipDepth += 1;
      if (token.type === 'close') skipDepth -= 1;
      continue;
    }
    if (token.type === 'open') {
      const name = token.name.replace(/^svg:/, '');
      if (name.toLowerCase() === 'style') { if (!token.selfClosing) inStyle = true; continue; }
      if (!ALLOWED.has(name)) { if (!token.selfClosing) skipDepth = 1; continue; }
      nodes += 1;
      if (nodes > SVG_LIMITS.maxNodes) throw new Error(`The SVG has more than ${SVG_LIMITS.maxNodes} elements.`);
      const node = { name, attributes: token.attributes, children: [] };
      stack.at(-1).children.push(node);
      if (!token.selfClosing) stack.push(node);
    } else if (token.type === 'close') {
      const name = token.name.replace(/^svg:/, '');
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
    } else if (token.type === 'text' && ['text', 'tspan'].includes(stack.at(-1).name)) {
      stack.at(-1).children.push({ name: '#text', text: decode(token.text) });
    }
  }
  return { root, styleText };
}

function cleanNode(node, classRules) {
  if (node.name === '#text') return node.text.trim() ? { name: '#text', text: node.text } : null;
  const raw = { ...node.attributes };
  const merged = {};
  for (const name of String(raw.class || '').split(/\s+/).filter(Boolean)) Object.assign(merged, classRules[name] || {});
  Object.assign(merged, raw);
  if (raw.style) Object.assign(merged, parseDeclarations(raw.style));
  const attributes = {};
  for (const [key, value] of Object.entries(merged)) {
    const check = ATTRIBUTES[key];
    if (check && typeof value === 'string' && value.length <= 20000 && check(value.trim())) attributes[key] = value.trim();
  }
  const children = node.children.map((child) => cleanNode(child, classRules)).filter(Boolean);
  const out = { name: node.name, attributes, children };
  if (DRAWABLE.has(node.name)) out.length = shapeLength(node.name, attributes);
  return out;
}

// ---------------------------------------------------------------- lengths
const num = (v, fallback = 0) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : fallback; };
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function polylineLength(points, closed) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += dist(points[i - 1], points[i]);
  if (closed && points.length > 2) total += dist(points.at(-1), points[0]);
  return total;
}

function sampleLength(fn, steps = 24) {
  let total = 0;
  let previous = fn(0);
  for (let i = 1; i <= steps; i += 1) {
    const point = fn(i / steps);
    total += dist(previous, point);
    previous = point;
  }
  return total;
}

function arcLength(p0, rx, ry, angle, largeArc, sweep, p1) {
  if (rx === 0 || ry === 0) return dist(p0, p1);
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi); const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2; const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy; const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const coef = sign * Math.sqrt(Math.max(0, numerator / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = coef * ((rx * y1) / ry); const cy1 = coef * (-(ry * x1) / rx);
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2; const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const angleOf = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angleOf(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angleOf((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  return sampleLength((t) => {
    const a = theta + delta * t;
    return [cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos];
  }, 32);
}

/** Length of SVG path data, with curves and arcs sampled. */
export function pathLength(d) {
  const tokens = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  let i = 0;
  let command = '';
  let current = [0, 0];
  let start = [0, 0];
  let control = null;
  let total = 0;
  const next = () => Number(tokens[i++]);
  const hasNumber = () => i < tokens.length && !/[A-Za-z]/.test(tokens[i]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) command = tokens[i++];
    else if (!command) break;
    const rel = command === command.toLowerCase();
    const at = (x, y) => (rel ? [current[0] + x, current[1] + y] : [x, y]);
    switch (command.toUpperCase()) {
      case 'M': { if (!hasNumber()) break; current = at(next(), next()); start = current; command = rel ? 'l' : 'L'; control = null; break; }
      case 'L': { if (!hasNumber()) break; const p = at(next(), next()); total += dist(current, p); current = p; control = null; break; }
      case 'H': { if (!hasNumber()) break; const x = next(); const p = [rel ? current[0] + x : x, current[1]]; total += dist(current, p); current = p; control = null; break; }
      case 'V': { if (!hasNumber()) break; const y = next(); const p = [current[0], rel ? current[1] + y : y]; total += dist(current, p); current = p; control = null; break; }
      case 'C': case 'S': {
        if (!hasNumber()) break;
        const c1 = command.toUpperCase() === 'S' ? (control ? [2 * current[0] - control[0], 2 * current[1] - control[1]] : current) : at(next(), next());
        const c2 = at(next(), next()); const p = at(next(), next()); const p0 = current;
        total += sampleLength((t) => { const u = 1 - t; return [u ** 3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p[0], u ** 3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p[1]]; });
        control = c2; current = p; break;
      }
      case 'Q': case 'T': {
        if (!hasNumber()) break;
        const c = command.toUpperCase() === 'T' ? (control ? [2 * current[0] - control[0], 2 * current[1] - control[1]] : current) : at(next(), next());
        const p = at(next(), next()); const p0 = current;
        total += sampleLength((t) => { const u = 1 - t; return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p[1]]; });
        control = c; current = p; break;
      }
      case 'A': {
        if (!hasNumber()) break;
        const rx = next(); const ry = next(); const angle = next(); const large = next(); const sweep = next(); const p = at(next(), next());
        total += arcLength(current, rx, ry, angle, Boolean(large), Boolean(sweep), p);
        current = p; control = null; break;
      }
      case 'Z': { total += dist(current, start); current = start; control = null; command = ''; break; }
      default: i += 1;
    }
    if (!Number.isFinite(total)) return 0;
  }
  return total;
}

function shapeLength(name, a) {
  switch (name) {
    case 'path': return pathLength(a.d || '');
    case 'rect': return 2 * (num(a.width) + num(a.height));
    case 'circle': return 2 * Math.PI * num(a.r);
    case 'ellipse': { const rx = num(a.rx); const ry = num(a.ry); const h = ((rx - ry) ** 2) / ((rx + ry) ** 2 || 1); return Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))); }
    case 'line': return dist([num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)]);
    case 'polyline': case 'polygon': {
      const values = String(a.points || '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      const points = []; for (let i = 0; i + 1 < values.length; i += 2) points.push([values[i], values[i + 1]]);
      return polylineLength(points, name === 'polygon');
    }
    default: return 0;
  }
}

// ---------------------------------------------------------------- public API

/**
 * Sanitizes SVG text. Returns { ok: true, tree, viewBox: [x, y, w, h], width,
 * height, shapes } or { ok: false, error } with a reason a person can act on.
 */
export function sanitizeSvg(source) {
  try {
    const text = String(source || '');
    if (text.length === 0) return { ok: false, error: 'The file is empty.' };
    if (text.length > SVG_LIMITS.maxBytes) return { ok: false, error: `The SVG is larger than ${Math.round(SVG_LIMITS.maxBytes / 1000)} KB.` };
    const { root, styleText } = buildTree(tokenize(text));
    const svg = root.children.find((child) => child.name === 'svg');
    if (!svg) return { ok: false, error: 'This isn’t an SVG file.' };
    const tree = cleanNode(svg, parseStyleSheet(styleText));
    let viewBox = String(tree.attributes.viewBox || '').trim().split(/[\s,]+/).map(Number);
    if (viewBox.length !== 4 || viewBox.some((v) => !Number.isFinite(v)) || viewBox[2] <= 0 || viewBox[3] <= 0) {
      const w = num(tree.attributes.width); const h = num(tree.attributes.height);
      if (!(w > 0 && h > 0)) return { ok: false, error: 'The SVG needs a viewBox or a width and height.' };
      viewBox = [0, 0, w, h];
    }
    const shapes = countShapes(tree);
    if (shapes === 0) return { ok: false, error: 'The SVG has no shapes FOLD Motion can draw.' };
    tree.attributes = Object.fromEntries(Object.entries(tree.attributes).filter(([key]) => !['width', 'height', 'viewBox', 'x', 'y'].includes(key)));
    return { ok: true, tree, viewBox, width: viewBox[2], height: viewBox[3], shapes };
  } catch (error) {
    return { ok: false, error: error.message || 'The SVG could not be read.' };
  }
}

function countShapes(node) {
  return (DRAWABLE.has(node.name) ? 1 : 0) + (node.children || []).reduce((sum, child) => sum + countShapes(child), 0);
}

/**
 * Serializes a sanitized tree. `override(node)` may return extra attributes for a
 * node (used for draw-on strokes and tints); ids get `idPrefix` so several copies
 * of a logo can share one frame.
 */
export function serializeSvgTree(node, { override, idPrefix = '' } = {}) {
  if (node.name === '#text') return escapeXml(node.text);
  const attributes = { ...node.attributes, ...(override ? override(node) || {} : {}) };
  if (idPrefix) {
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'id') attributes[key] = `${idPrefix}${value}`;
      else if (typeof value === 'string' && LOCAL_URL.test(value)) attributes[key] = value.replace(LOCAL_URL, (_, id) => `url(#${idPrefix}${id})`);
    }
  }
  const attrs = Object.entries(attributes).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('');
  const children = (node.children || []).map((child) => serializeSvgTree(child, { override, idPrefix })).join('');
  // The root's own attributes (a logo-wide fill, say) move to a wrapping group.
  return node.name === 'svg' ? `<g${attrs}>${children}</g>` : `<${node.name}${attrs}>${children}</${node.name}>`;
}

export const isDrawable = (node) => DRAWABLE.has(node.name);
