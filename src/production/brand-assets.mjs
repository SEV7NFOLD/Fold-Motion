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
export const PRODUCT_LIMITS = Object.freeze({ maxBytes: 3_000_000, count: 3 });

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

/** Product photo metadata from a planning context: [{ width, height }], at most three. */
export function normalizeProductsMeta(products) {
  if (!Array.isArray(products)) return undefined;
  const valid = (value) => Number.isFinite(value) && value > 0 && value <= LOGO_LIMITS.maxDimension;
  // A small thumbnail lets the model see the photo when it directs the shots.
  const thumbOf = (item) => (typeof item?.thumb === 'string' && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(item.thumb) && item.thumb.length <= 120_000 ? item.thumb : undefined);
  const list = products.slice(0, PRODUCT_LIMITS.count)
    .map((item) => ({ width: Number(item?.width), height: Number(item?.height), ...(thumbOf(item) ? { thumb: thumbOf(item) } : {}) }))
    .filter((item) => valid(item.width) && valid(item.height));
  return list.length ? list : undefined;
}

/** Turns product photos from a render request ({ dataUri }) into checked images. */
export function resolveProducts(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  return list.slice(0, PRODUCT_LIMITS.count).map((item, index) => {
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
  return { logo: resolveLogo(assets?.logo), products: resolveProducts(assets?.products) };
}
