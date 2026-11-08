/**
 * Checks a raster logo for a solid background, and removes a plain one.
 * Pure functions over RGBA pixels, shared by the studio and tests.
 *
 * A logo needs a transparent background; a photo of a card or a logo on a white
 * square shows up in films as a box. Plain backgrounds are removed by flood-filling
 * inward from the image's edges (so matching colors inside the logo are kept),
 * with a soft edge. Photo backgrounds can't be removed reliably, so they're flagged.
 */

function colorAt(data, index) {
  return [data[index], data[index + 1], data[index + 2], data[index + 3]];
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** { transparent, uniformEdges, edgeColor } for an RGBA image. */
export function analyzeLogoPixels(data, width, height) {
  const border = [];
  const ring = Math.max(1, Math.round(Math.min(width, height) * 0.01));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= ring && y >= ring && x < width - ring && y < height - ring) continue;
      border.push(colorAt(data, (y * width + x) * 4));
    }
  }
  const transparentEdges = border.filter((pixel) => pixel[3] < 200).length / border.length;
  const opaque = border.filter((pixel) => pixel[3] >= 200);
  const edgeColor = [0, 1, 2].map((channel) => opaque.reduce((sum, pixel) => sum + pixel[channel], 0) / Math.max(1, opaque.length));
  const spread = opaque.reduce((sum, pixel) => sum + distance(pixel, edgeColor), 0) / Math.max(1, opaque.length);
  return { transparent: transparentEdges > 0.5, uniformEdges: spread < 14, edgeColor: edgeColor.map(Math.round) };
}

/**
 * Removes a plain background in place by flood-filling from the edges. Returns
 * the share of pixels made transparent.
 */
export function removePlainBackground(data, width, height, { edgeColor, tolerance = 30 } = {}) {
  const key = edgeColor || analyzeLogoPixels(data, width, height).edgeColor;
  const soft = tolerance * 1.6;
  const seen = new Uint8Array(width * height);
  const queue = [];
  const push = (x, y) => {
    const position = y * width + x;
    if (seen[position]) return;
    if (distance(colorAt(data, position * 4), key) > soft) return;
    seen[position] = 1;
    queue.push(position);
  };
  for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }
  let cleared = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const position = queue[head];
    const index = position * 4;
    const d = distance(colorAt(data, index), key);
    data[index + 3] = d <= tolerance ? 0 : Math.round(Math.min(data[index + 3], 255 * ((d - tolerance) / (soft - tolerance))));
    if (d <= tolerance) cleared += 1;
    else continue; // soft edge pixels don't spread the fill further
    const x = position % width;
    const y = (position - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  return cleared / (width * height);
}
