/**
 * Reads the layout metrics FOLD Motion needs from a TrueType or OpenType font:
 * family name, weight, cap height, ascender, descender and each character's
 * advance width (in ems). Shared by the studio (at upload) and the server (to
 * check files), with no dependencies. WOFF and WOFF2 web fonts are not read: the
 * renderer needs the TTF or OTF file.
 */

// Characters the engine lays out: printable ASCII, Latin-1, and common punctuation.
const CHARACTERS = [
  ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
  ...Array.from({ length: 96 }, (_, i) => String.fromCharCode(160 + i)),
  ...'‘’“”–—…•€™'.split(''),
];

function tableDirectory(view) {
  const tables = {};
  const count = view.getUint16(4);
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
    tables[tag] = { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) };
  }
  return tables;
}

/** Code point → glyph id, from the best Unicode cmap subtable (format 12 or 4). */
function readCmap(view, cmap) {
  const subtables = [];
  const count = view.getUint16(cmap.offset + 2);
  for (let i = 0; i < count; i += 1) {
    const at = cmap.offset + 4 + i * 8;
    subtables.push({ platform: view.getUint16(at), encoding: view.getUint16(at + 2), offset: cmap.offset + view.getUint32(at + 4) });
  }
  const pick = subtables.find((t) => view.getUint16(t.offset) === 12)
    || subtables.find((t) => t.platform === 3 && t.encoding === 1 && view.getUint16(t.offset) === 4)
    || subtables.find((t) => t.platform === 0 && view.getUint16(t.offset) === 4);
  if (!pick) throw new Error('This font has no Unicode character map.');
  const format = view.getUint16(pick.offset);
  return (code) => {
    if (format === 12) {
      const groups = view.getUint32(pick.offset + 12);
      for (let g = 0; g < groups; g += 1) {
        const at = pick.offset + 16 + g * 12;
        const start = view.getUint32(at);
        const end = view.getUint32(at + 4);
        if (code >= start && code <= end) return view.getUint32(at + 8) + (code - start);
      }
      return 0;
    }
    const segX2 = view.getUint16(pick.offset + 6);
    const ends = pick.offset + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s += 1) {
      const end = view.getUint16(ends + s * 2);
      if (code > end) continue;
      const start = view.getUint16(starts + s * 2);
      if (code < start) return 0;
      const delta = view.getInt16(deltas + s * 2);
      const rangeOffset = view.getUint16(ranges + s * 2);
      if (rangeOffset === 0) return (code + delta) & 0xffff;
      const glyph = view.getUint16(ranges + s * 2 + rangeOffset + (code - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

function readName(view, name) {
  const count = view.getUint16(name.offset + 2);
  const strings = name.offset + view.getUint16(name.offset + 4);
  const found = {};
  for (let i = 0; i < count; i += 1) {
    const at = name.offset + 6 + i * 12;
    const platform = view.getUint16(at);
    const nameId = view.getUint16(at + 6);
    if (![1, 16].includes(nameId)) continue;
    const length = view.getUint16(at + 8);
    const offset = strings + view.getUint16(at + 10);
    let text = '';
    if (platform === 3 || platform === 0) for (let c = 0; c < length; c += 2) text += String.fromCharCode(view.getUint16(offset + c));
    else if (platform === 1) for (let c = 0; c < length; c += 1) text += String.fromCharCode(view.getUint8(offset + c));
    if (text && (!found[nameId] || platform === 3)) found[nameId] = text;
  }
  return (found[16] || found[1] || '').trim();
}

/** Metrics from a TTF/OTF file (ArrayBuffer or Uint8Array). Throws with a clear reason. */
export function readFontMetrics(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 12) throw new Error('That file is too small to be a font.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = view.getUint32(0);
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === 'wOFF' || tag === 'wOF2') throw new Error('That’s a web font (WOFF). Upload the TTF or OTF version of the font.');
  if (tag === 'ttcf') throw new Error('That’s a font collection (TTC). Upload a single TTF or OTF font.');
  if (signature !== 0x00010000 && tag !== 'OTTO' && tag !== 'true') throw new Error('That file isn’t a TTF or OTF font.');
  const tables = tableDirectory(view);
  for (const required of ['head', 'hhea', 'hmtx', 'cmap']) {
    if (!tables[required]) throw new Error(`That font is missing its "${required}" table.`);
  }
  const unitsPerEm = view.getUint16(tables.head.offset + 18) || 1000;
  const ascender = view.getInt16(tables.hhea.offset + 4);
  const descender = view.getInt16(tables.hhea.offset + 6);
  const metricsCount = view.getUint16(tables.hhea.offset + 34);
  const width = (glyph) => view.getUint16(tables.hmtx.offset + Math.min(glyph, metricsCount - 1) * 4);
  const glyphOf = readCmap(view, tables.cmap);
  let weight = 400;
  let capHeight = 0.7 * unitsPerEm;
  if (tables['OS/2']) {
    const os2 = tables['OS/2'].offset;
    weight = view.getUint16(os2 + 4) || 400;
    if (view.getUint16(os2) >= 2 && tables['OS/2'].length >= 90) capHeight = view.getInt16(os2 + 88) || capHeight;
  }
  const advance = {};
  for (const character of CHARACTERS) {
    const glyph = glyphOf(character.codePointAt(0));
    if (glyph) advance[character] = Number((width(glyph) / unitsPerEm).toFixed(4));
  }
  if (!advance.H || !advance[' ']) throw new Error('That font doesn’t cover basic Latin letters.');
  const widths = Object.values(advance);
  return {
    family: tables.name ? readName(view, tables.name) || 'Brand font' : 'Brand font',
    weight,
    capHeight: Number((capHeight / unitsPerEm).toFixed(4)),
    ascender: Number((ascender / unitsPerEm).toFixed(4)),
    descender: Number((Math.abs(descender) / unitsPerEm).toFixed(4)),
    fallbackAdvance: Number((widths.reduce((a, b) => a + b, 0) / widths.length).toFixed(4)),
    advance,
  };
}
