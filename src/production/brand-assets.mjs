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

/** Logo metadata from a planning context: { kind, width, height } or undefined. */
export function normalizeLogoMeta(logo) {
  if (!logo || typeof logo !== 'object') return undefined;
  const kind = logo.kind === 'svg' || logo.kind === 'png' ? logo.kind : undefined;
  const width = Number(logo.width);
  const height = Number(logo.height);
  const valid = (value) => Number.isFinite(value) && value > 0 && value <= LOGO_LIMITS.maxDimension;
  return kind && valid(width) && valid(height) ? { kind, width, height } : undefined;
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

/** Resolves every brand asset in a render request ({ logo }). */
export function resolveBrandAssets(assets = {}) {
  return { logo: resolveLogo(assets?.logo) };
}
