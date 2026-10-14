import { execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { generateFrameManifest } from './qa/generate-frame-hashes.mjs';
import { evaluateCreativeQA, validateTimeline } from '../src/production/production.mjs';

const execFileAsync = promisify(execFile);

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrapText(content, maximumCharacters) {
  const lines = [];
  let line = '';
  for (const word of String(content).trim().split(/\s+/)) {
    if ([...word].length > maximumCharacters) {
      if (line) lines.push(line);
      line = '';
      const characters = [...word];
      while (characters.length > maximumCharacters) {
        lines.push(characters.splice(0, maximumCharacters).join(''));
      }
      line = characters.join('');
    } else if (!line) {
      line = word;
    } else if ([...line].length + word.length + 1 <= maximumCharacters) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function renderShotSvg(shot, progress, width, height) {
  const fade = 0.18 + 0.82 * clamp(progress * 5, 0, 1);
  const elements = shot.spec.elements.map((element) => {
    const fill = escapeXml(element.fill || '#F8FAFC');
    if (element.type === 'rect') {
      const animatedWidth = element.id.endsWith('-accent')
        ? Math.max(1, element.width * clamp(progress * 2.2, 0.05, 1))
        : element.width;
      return `<rect x="${element.x}" y="${element.y}" width="${animatedWidth}" height="${element.height}" fill="${fill}" opacity="${element.id.endsWith('-background') ? 1 : fade}"/>`;
    }
    if (element.type === 'circle') {
      return `<circle cx="${element.x}" cy="${element.y}" r="${element.radius ?? 12}" fill="${fill}" opacity="${fade}"/>`;
    }
    if (element.type === 'text') {
      const requestedSize = Number.isFinite(element.fontSize) ? element.fontSize : 32;
      const fittedSize = Math.min(requestedSize, height * 0.15);
      const lines = wrapText(
        element.content,
        Math.max(1, Math.floor(width * 0.76 / (fittedSize * 0.58))),
      );
      const anchor = element.anchor === 'middle' ? 'middle' : element.anchor === 'end' ? 'end' : 'start';
      const y = element.y - ((lines.length - 1) * fittedSize * 0.62) / 2 - (1 - fade) * height * 0.035;
      const textLines = lines.map((line, index) => (
        `<tspan x="${element.x}" dy="${index === 0 ? 0 : fittedSize * 1.2}">${escapeXml(line)}</tspan>`
      )).join('');
      return `<text x="${element.x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.max(16, fittedSize)}" font-weight="700" opacity="${fade}">${textLines}</text>`;
    }
    return '';
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${elements}
</svg>`;
}

async function runCommand(command, args) {
  try {
    return await execFileAsync(command, args, {
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const details = [error.message, error.stdout, error.stderr].filter(Boolean).join('\n');
    throw new Error(`${command} failed.\n${details}`);
  }
}

function parseFrameRate(value) {
  const [numerator, denominator = '1'] = String(value || '').split('/');
  const rate = Number(numerator) / Number(denominator);
  return Number.isFinite(rate) ? rate : NaN;
}

export async function renderProductionProject({
  timeline,
  storyboard,
  acceptance,
  context,
  outputRoot = path.resolve('output'),
}) {
  const validation = validateTimeline(timeline);
  if (!validation.valid) throw new Error(`Timeline validation failed: ${validation.errors.join(' ')}`);

  const projectId = timeline.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDirectory = path.join(outputRoot, projectId, runId);
  const framesDirectory = path.join(outputDirectory, 'frames');
  try {
    await access(outputDirectory);
    throw new Error(`Render output already exists: ${outputDirectory}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(framesDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, 'storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, 'acceptance.json'), `${JSON.stringify(acceptance, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, 'source-project.json'), `${JSON.stringify({
    schemaVersion: '1.0',
    storyboard,
    acceptance,
    timeline,
  }, null, 2)}\n`);

  let shotIndex = 0;
  for (let frameIndex = 0; frameIndex < timeline.totalFrames; frameIndex += 1) {
    while (frameIndex > timeline.shots[shotIndex].endFrame) shotIndex += 1;
    const shot = timeline.shots[shotIndex];
    const frameProgress = (frameIndex - shot.startFrame) / Math.max(1, shot.durationFrames - 1);
    const svg = renderShotSvg(shot, frameProgress, timeline.width, timeline.height);
    const frameName = `frame-${String(frameIndex).padStart(6, '0')}`;
    const svgPath = path.join(framesDirectory, `${frameName}.svg`);
    const pngPath = path.join(framesDirectory, `${frameName}.png`);
    await writeFile(svgPath, svg);
    const rasterizer = new Resvg(svg, {
      fitTo: { mode: 'width', value: timeline.width },
      font: { defaultFontFamily: 'Segoe UI', loadSystemFonts: true },
    });
    await writeFile(pngPath, rasterizer.render().asPng());
  }

  const manifest = generateFrameManifest(framesDirectory);
  await writeFile(path.join(framesDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const isWindows = process.platform === 'win32';
  const ffmpeg = isWindows ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobe = isWindows ? 'ffprobe.exe' : 'ffprobe';
  const videoPath = path.join(outputDirectory, 'production.mp4');
  await runCommand(ffmpeg, [
    '-y',
    '-framerate', String(timeline.fps),
    '-i', path.join(framesDirectory, 'frame-%06d.png'),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    videoPath,
  ]);
  const probe = await runCommand(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'format=duration:stream=width,height,avg_frame_rate,nb_frames',
    '-of', 'json',
    videoPath,
  ]);
  const metadata = JSON.parse(probe.stdout);
  const stream = metadata.streams?.[0];
  const expectedRate = timeline.fps;
  const actualRate = parseFrameRate(stream?.avg_frame_rate);
  const actualDuration = Number.parseFloat(metadata.format?.duration ?? 'NaN');
  const encodedFrameCount = Number.parseInt(stream?.nb_frames ?? 'NaN', 10);
  const frameIntegrityPass = manifest.totalFrames === timeline.totalFrames * 2
    && manifest.frames.length === timeline.totalFrames * 2
    && encodedFrameCount === timeline.totalFrames
    && manifest.frames.every((frame) => /^[a-f\d]{64}$/i.test(frame.sha256) && frame.sizeBytes > 0);
  const productionQA = {
    pass: stream?.width === timeline.width
      && stream?.height === timeline.height
      && Math.abs(actualRate - expectedRate) < 0.01
      && Math.abs(actualDuration - timeline.durationInSeconds) <= 1 / timeline.fps
      && frameIntegrityPass,
    dimensions: {
      pass: stream?.width === timeline.width && stream?.height === timeline.height,
      expected: { width: timeline.width, height: timeline.height },
      actual: { width: stream?.width, height: stream?.height },
    },
    fps: {
      pass: Math.abs(actualRate - expectedRate) < 0.01,
      expected: expectedRate,
      actual: actualRate,
    },
    frameIntegrity: {
      pass: frameIntegrityPass,
      expectedFrames: timeline.totalFrames,
      encodedVideoFrames: encodedFrameCount,
      hashedFrameFiles: manifest.totalFrames,
    },
    duration: {
      pass: Number.isFinite(actualDuration)
        && Math.abs(actualDuration - timeline.durationInSeconds) <= 1 / timeline.fps,
      expected: timeline.durationInSeconds,
      actual: actualDuration,
    },
  };
  const creativeQA = evaluateCreativeQA(timeline, context);
  const baseUrl = `/output/${projectId}/${runId}`;
  const report = {
    schemaVersion: '1.0',
    projectId,
    runId,
    verified: true,
    renderedAt: new Date().toISOString(),
    renderer: 'resvg + ffmpeg',
    productionQA,
    creativeQA,
    videoMetadata: metadata,
    artifacts: {
      video: `${baseUrl}/production.mp4`,
      timeline: `${baseUrl}/timeline.json`,
      storyboard: `${baseUrl}/storyboard.json`,
      acceptance: `${baseUrl}/acceptance.json`,
      source: `${baseUrl}/source-project.json`,
      qa: `${baseUrl}/production-qa.json`,
      frameManifest: `${baseUrl}/frames/manifest.json`,
    },
  };
  const reportPath = path.join(outputDirectory, 'production-qa.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, reportPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputIndex = process.argv.indexOf('--input');
  const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
  if (!inputPath) {
    throw new Error('Usage: npm run render -- --input <render-request.json>');
  }
  const { readFile } = await import('node:fs/promises');
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const result = await renderProductionProject(input);
  console.log(`RENDER_REPORT:${result.reportPath}`);
  console.log(JSON.stringify(result.report));
}
