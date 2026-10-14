import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Calculates SHA-256 hash for a given file buffer or string.
 * @param {Buffer|string} content
 * @returns {string} SHA-256 hex string
 */
export function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Scans a render output directory and generates a SHA-256 frame manifest.
 * @param {string} renderDir Path to the render output folder containing frames
 * @returns {Object} Manifest object containing frame hashes and metadata
 */
export function generateFrameManifest(renderDir) {
  if (!fs.existsSync(renderDir)) {
    throw new Error(`Directory does not exist: ${renderDir}`);
  }

  const files = fs.readdirSync(renderDir);
  const frameFiles = files.filter((file) => file.endsWith('.svg') || file.endsWith('.png')).sort();
  const frames = [];

  for (const file of frameFiles) {
    const filePath = path.join(renderDir, file);
    const buffer = fs.readFileSync(filePath);
    const hash = hashContent(buffer);

    frames.push({
      file,
      sizeBytes: buffer.length,
      sha256: hash,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    totalFrames: frames.length,
    renderDir: path.basename(renderDir),
    frames,
  };
}

if (process.argv[1] && path.basename(process.argv[1]) === 'generate-frame-hashes.mjs') {
  const targetDir = process.argv[2];

  if (!targetDir) {
    console.error('❌ Usage: node scripts/qa/generate-frame-hashes.mjs <path-to-render-dir>');
    process.exit(1);
  }

  try {
    const fullPath = path.resolve(targetDir);
    const manifest = generateFrameManifest(fullPath);
    const manifestPath = path.join(fullPath, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    console.log('✅ Frame manifest successfully generated!');
    console.log(`   - Target: ${fullPath}`);
    console.log(`   - Processed frames: ${manifest.totalFrames}`);
    console.log(`   - Saved to: ${manifestPath}`);
    process.exit(0);
  } catch (error) {
    console.error(`❌ Hash generation failed: ${error.message}`);
    process.exit(1);
  }
}
