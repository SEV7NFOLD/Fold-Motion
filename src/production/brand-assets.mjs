/**
 * Brand assets (the client's logo) on the server side.
 *
 * The studio sends logo metadata with planning requests (so recipes can lay the
 * logo out) and the logo itself only with render requests. Everything is checked
 * here before use: SVGs are rebuilt by the shared sanitizer, PNGs are checked for
 * format, size and their real dimensions read from the file header.
 */
import { sanitizeSvg } from '../../public/svg-sanitize.mjs';

export const LOGO_LIMITS = Object.freeze({ maxPngBytes: 1_500_000, maxDimension: 10_000 });
// No practical limit on photos; the ceiling only protects a small server's memory.
export const PRODUCT_LIMITS = Object.freeze({ maxBytes: 3_000_000, count: 40 });

/** Logo metadata from a planning context: { kind, width, height } or undefined. */
export function normalizeLogoMeta(logo) {
  if (!logo || typeof logo !== 'object') return undefined;
  const kind = logo.kind === 'svg' || logo.kind === 'png' ? logo.kind : undefined;
  const width = Number(logo.width);
  const height = Number(logo.height);
  const valid = (value) => Number.isFinite(value) && value > 0 && value <= LOGO_LIMITS.maxDimension;
  return kind && valid(width) && valid(height) ? { kind, width, height } : undefined;
}

/** Width and height from a JPEG's start-of-frame marker. */
function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return undefined;
}

/**
 * A brand font's metrics from a planning context (measured in the studio by
 * public/font-metrics.mjs), checked so layout can trust them.
 */
export function normalizeBrandFont(font) {
  if (!font || typeof font !== 'object') return undefined;
  const number = (value, low, high) => (Number.isFinite(Number(value)) && Number(value) >= low && Number(value) <= high ? Number(value) : undefined);
  const family = typeof font.family === 'string' ? font.family.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) : '';
  const capHeight = number(font.capHeight, 0.3, 1.2);
  const ascender = number(font.ascender, 0.3, 2);
  const descender = number(font.descender, 0, 1);
  const fallbackAdvance = number(font.fallbackAdvance, 0.1, 2);
  if (!family || capHeight === undefined || ascender === undefined || descender === undefined || fallbackAdvance === undefined) return undefined;
  const advance = {};
  for (const [character, width] of Object.entries(font.advance || {}).slice(0, 600)) {
    if ([...character].length === 1 && number(width, 0, 3) !== undefined) advance[character] = Number(width);
  }
  if (!advance.H || advance[' '] === undefined) return undefined;
  return { family, weight: number(font.weight, 100, 1000) || 400, capHeight, ascender, descender, fallbackAdvance, advance };
}

/** A brand font file from a render request ({ dataUri }), checked as a TTF or OTF. */
export function resolveFont(font) {
  if (!font?.dataUri) return null;
  const match = /^data:(?:font\/(?:ttf|otf|sfnt)|application\/(?:font-sfnt|x-font-ttf|x-font-otf|octet-stream));base64,/.exec(font.dataUri);
  if (!match) throw new Error('The brand font must be a TTF or OTF file.');
  const buffer = Buffer.from(font.dataUri.slice(match[0].length), 'base64');
  if (buffer.length > 3_000_000) throw new Error('The brand font is larger than 3 MB.');
  const tag = buffer.subarray(0, 4).toString('latin1');
  if (!(buffer.readUInt32BE(0) === 0x00010000 || tag === 'OTTO' || tag === 'true')) throw new Error('The brand font isn’t a TTF or OTF file.');
  return { buffer, extension: tag === 'OTTO' ? 'otf' : 'ttf' };
}

/** Product photo metadata from a planning context: [{ width, height }], at most three. */
export function normalizeProductsMeta(products) {
  if (!Array.isArray(products)) return undefined;
  const valid = (value) => Number.isFinite(value) && value > 0 && value <= LOGO_LIMITS.maxDimension;
  // A small thumbnail lets the model see the photo when it directs the shots.
  const thumbOf = (item) => (typeof item?.thumb === 'string' && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(item.thumb) && item.thumb.length <= 120_000 ? item.thumb : undefined);
  const list = products.slice(0, PRODUCT_LIMITS.count)
    .map((item) => ({
      width: Number(item?.width),
      height: Number(item?.height),
      ...(thumbOf(item) ? { thumb: thumbOf(item) } : {}),
      // The file name ("side-view") lets a brief say which photo goes where.
      ...(typeof item?.name === 'string' && item.name.trim() ? { name: item.name.trim().replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^\p{L}\p{N} ._-]/gu, ' ').slice(0, 40).trim() } : {}),
    }))
    .filter((item) => valid(item.width) && valid(item.height));
  return list.length ? list : undefined;
}

/** Turns product photos from a render request ({ dataUri }) into checked images. */
export function resolveProducts(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  // Photos the film doesn't use arrive as null, keeping every photo's number.
  return list.slice(0, PRODUCT_LIMITS.count).map((item, index) => {
    if (item === null) return null;
    const match = /^data:image\/(jpeg|png);base64,/.exec(item?.dataUri || '');
    if (!match) throw new Error(`Product photo ${index + 1} must be a JPEG or PNG image.`);
    const buffer = Buffer.from(item.dataUri.slice(match[0].length), 'base64');
    if (buffer.length > PRODUCT_LIMITS.maxBytes) throw new Error(`Product photo ${index + 1} is larger than ${PRODUCT_LIMITS.maxBytes / 1_000_000} MB.`);
    const size = match[1] === 'png' ? pngDimensions(buffer) : jpegDimensions(buffer);
    if (!size?.width || !size?.height) throw new Error(`Product photo ${index + 1} could not be read.`);
    return { dataUri: item.dataUri, width: size.width, height: size.height };
  });
}

function pngDimensions(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < 24 || signature.some((byte, index) => buffer[index] !== byte)) return undefined;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Turns a logo from a render request into something the renderer can draw, or
 * throws an Error whose message a person can act on.
 * Input: { kind: 'svg', svg } or { kind: 'png', dataUri }.
 */
export function resolveLogo(asset) {
  if (!asset) return undefined;
  if (asset.kind === 'svg') {
    const result = sanitizeSvg(asset.svg);
    if (!result.ok) throw new Error(`The logo SVG can't be used: ${result.error}`);
    return { kind: 'svg', tree: result.tree, viewBox: result.viewBox, width: result.width, height: result.height };
  }
  if (asset.kind === 'png') {
    const prefix = 'data:image/png;base64,';
    if (typeof asset.dataUri !== 'string' || !asset.dataUri.startsWith(prefix)) throw new Error('The logo must be a PNG image.');
    const buffer = Buffer.from(asset.dataUri.slice(prefix.length), 'base64');
    if (buffer.length > LOGO_LIMITS.maxPngBytes) throw new Error(`The logo PNG is larger than ${LOGO_LIMITS.maxPngBytes / 1_000_000} MB.`);
    const size = pngDimensions(buffer);
    if (!size || !size.width || !size.height || size.width > LOGO_LIMITS.maxDimension || size.height > LOGO_LIMITS.maxDimension) {
      throw new Error('The logo PNG could not be read.');
    }
    return { kind: 'png', dataUri: asset.dataUri, width: size.width, height: size.height };
  }
  throw new Error('The logo must be an SVG or a PNG.');
}

/** Resolves every brand asset in a render request ({ logo, products }). */
export function resolveBrandAssets(assets = {}) {
  return { logo: resolveLogo(assets?.logo), products: resolveProducts(assets?.products), font: resolveFont(assets?.font) };
}
