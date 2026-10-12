import { execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Resvg } from '@resvg/resvg-js';
import { SCENE_01_META, canonicalTimestamp, sceneState } from '../public/scene-01-core.js';
import { renderSceneSvg } from '../public/scene-01-svg.mjs';

const execFileAsync = promisify(execFile);
const captureFramesPerSecond = 24;
const outputFramesPerSecond = 24;

function runId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function runCommand(command, args) {
  try {
    return await execFileAsync(command, args, {
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const details = [error.message, error.stdout, error.stderr].filter(Boolean).join('\n');
    throw new Error(`${command} failed.\n${details}`);
  }
}

async function createEmptyDirectory(directory) {
  try {
    await access(directory);
  } catch {
    await mkdir(directory, { recursive: true });
    return;
  }

  throw new Error(`Render directory already exists: ${directory}`);
}

const root = process.cwd();
const currentRunId = process.argv[2] ?? runId();
if (!/^[a-zA-Z0-9-]+$/.test(currentRunId)) {
  throw new Error('Run identifier may contain only letters, numbers, and hyphens.');
}

// choose platform-appropriate FFmpeg/FFprobe executable names
const isWindows = process.platform === 'win32';
const ffmpegCmd = isWindows ? 'ffmpeg.exe' : 'ffmpeg';
const ffprobeCmd = isWindows ? 'ffprobe.exe' : 'ffprobe';

const outputDirectory = path.join(root, 'output', SCENE_01_META.id, currentRunId);
const framesDirectory = path.join(outputDirectory, 'frames');
await createEmptyDirectory(outputDirectory);
await mkdir(framesDirectory);

const frameCount = SCENE_01_META.durationSeconds * captureFramesPerSecond;
const capturedFrames = [];

for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
  const timestamp = canonicalTimestamp(frameIndex, captureFramesPerSecond);
  const frameName = `frame-${String(frameIndex).padStart(4, '0')}`;
  const svgFile = path.join(framesDirectory, `${frameName}.svg`);
  const frameFile = path.join(framesDirectory, `${frameName}.png`);
  const sceneSvg = renderSceneSvg(sceneState(timestamp));
  await writeFile(svgFile, sceneSvg);
  const rasterizer = new Resvg(sceneSvg, {
    fitTo: { mode: 'width', value: SCENE_01_META.width },
    font: { defaultFontFamily: 'Segoe UI', loadSystemFonts: true },
  });
  await writeFile(frameFile, rasterizer.render().asPng());
  capturedFrames.push({
    frameIndex,
    timestamp,
    sourceSvg: path.relative(outputDirectory, svgFile),
    file: path.relative(outputDirectory, frameFile),
  });
  console.log(`Rendered frame ${frameIndex + 1}/${frameCount} at ${timestamp.toFixed(3)}s`);
}

const videoFile = path.join(outputDirectory, `${SCENE_01_META.id}.mp4`);
await runCommand(ffmpegCmd, [
  '-y',
  '-framerate', String(captureFramesPerSecond),
  '-i', path.join(framesDirectory, 'frame-%04d.png'),
  '-vf', `fps=${outputFramesPerSecond}`,
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  videoFile,
]);

const inspectionFrameIndexes = [
  0,
  Math.floor((frameCount - 1) / 3),
  Math.floor((frameCount - 1) * 2 / 3),
  frameCount - 1,
];
const contactSheetFile = path.join(outputDirectory, 'contact-sheet.png');
const contactSheetInputs = inspectionFrameIndexes.flatMap((frameIndex) => [
  '-i',
  path.join(framesDirectory, `frame-${String(frameIndex).padStart(4, '0')}.png`),
]);
await runCommand(ffmpegCmd, [
  '-y',
  ...contactSheetInputs,
  '-filter_complex', '[0:v]scale=640:360[a];[1:v]scale=640:360[b];[2:v]scale=640:360[c];[3:v]scale=640:360[d];[a][b]hstack=inputs=2[top];[c][d]hstack=inputs=2[bottom];[top][bottom]vstack=inputs=2',
  '-frames:v', '1',
  contactSheetFile,
]);

const probe = await runCommand(ffprobeCmd, [
  '-v', 'error',
  '-select_streams', 'v:0',
  '-show_entries', 'format=duration:stream=width,height,avg_frame_rate',
  '-of', 'json',
  videoFile,
]);
const metadata = JSON.parse(probe.stdout);
const stream = metadata.streams?.[0];
const duration = Number.parseFloat(metadata.format?.duration ?? 'NaN');
const videoIsValid = stream?.width === SCENE_01_META.width
  && stream?.height === SCENE_01_META.height
  && Number.isFinite(duration)
  && Math.abs(duration - SCENE_01_META.durationSeconds) < 0.1;

if (!videoIsValid) {
  throw new Error(`FFprobe metadata did not match the requested output: ${JSON.stringify(metadata)}`);
}

const report = {
  scene: SCENE_01_META,
  renderer: {
    backend: 'resvg-plus-ffmpeg',
    captureFramesPerSecond,
    outputFramesPerSecond,
    frameCount,
    viewport: { width: SCENE_01_META.width, height: SCENE_01_META.height },
  },
  capturedFrames,
  inspection: {
    file: path.basename(contactSheetFile),
    frameIndexes: inspectionFrameIndexes,
  },
  video: {
    file: path.basename(videoFile),
    metadata,
    verified: videoIsValid,
  },
};
await writeFile(path.join(outputDirectory, 'render-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Verified MP4: ${videoFile}`);
