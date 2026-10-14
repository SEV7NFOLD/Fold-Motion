import path from 'node:path';
import { generateFrameManifest } from './generate-frame-hashes.mjs';

/**
 * Compares two render directories and reports frame hash deltas.
 * @param {string} dirA Path to original render directory
 * @param {string} dirB Path to new render directory
 * @returns {Object} Diff summary report
 */
export function diffRenderDirectories(dirA, dirB) {
  const manifestA = generateFrameManifest(dirA);
  const manifestB = generateFrameManifest(dirB);

  const mapA = new Map(manifestA.frames.map((frame) => [frame.file, frame]));
  const mapB = new Map(manifestB.frames.map((frame) => [frame.file, frame]));
  const matchingFrames = [];
  const modifiedFrames = [];
  const addedFrames = [];
  const missingFrames = [];

  for (const [file, frameA] of mapA.entries()) {
    if (!mapB.has(file)) {
      missingFrames.push(file);
      continue;
    }

    const frameB = mapB.get(file);
    if (frameA.sha256 === frameB.sha256) {
      matchingFrames.push(file);
    } else {
      modifiedFrames.push({
        file,
        sha256A: frameA.sha256,
        sha256B: frameB.sha256,
        sizeDiffBytes: frameB.sizeBytes - frameA.sizeBytes,
      });
    }
  }

  for (const file of mapB.keys()) {
    if (!mapA.has(file)) {
      addedFrames.push(file);
    }
  }

  const totalFrames = Math.max(manifestA.totalFrames, manifestB.totalFrames);
  const matchPercentage = totalFrames > 0
    ? ((matchingFrames.length / totalFrames) * 100).toFixed(2)
    : '0.00';

  return {
    identical: matchingFrames.length === totalFrames,
    matchPercentage: `${matchPercentage}%`,
    summary: {
      totalFrames,
      matching: matchingFrames.length,
      modified: modifiedFrames.length,
      added: addedFrames.length,
      missing: missingFrames.length,
    },
    modifiedFrames,
  };
}

if (process.argv[1] && path.basename(process.argv[1]) === 'diff-frames.mjs') {
  const dirA = process.argv[2];
  const dirB = process.argv[3];

  if (!dirA || !dirB) {
    console.error('❌ Usage: node scripts/qa/diff-frames.mjs <render-dir-A> <render-dir-B>');
    process.exit(1);
  }

  try {
    const report = diffRenderDirectories(path.resolve(dirA), path.resolve(dirB));

    console.log('\n🔍 FOLD Motion Frame Diff Report');
    console.log('=================================');
    console.log(`Match Rate: ${report.matchPercentage}`);
    console.log(`- Matching Frames:  ${report.summary.matching}`);
    console.log(`- Modified Frames:  ${report.summary.modified}`);
    console.log(`- Added Frames:     ${report.summary.added}`);
    console.log(`- Missing Frames:   ${report.summary.missing}`);

    if (report.modifiedFrames.length > 0) {
      console.log('\nModified Frames Detail (Top 5):');
      report.modifiedFrames.slice(0, 5).forEach((frame) => {
        const sign = frame.sizeDiffBytes > 0 ? '+' : '';
        console.log(`  • ${frame.file}: Size diff ${sign}${frame.sizeDiffBytes}B`);
      });
    }

    process.exit(report.identical ? 0 : 1);
  } catch (error) {
    console.error(`❌ Diff execution failed: ${error.message}`);
    process.exit(1);
  }
}
