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

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
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
  const progressValue = clamp(progress, 0, 1);
  const reveal = easeOutCubic(clamp(progressValue * 4, 0, 1));
  const fade = 0.16 + 0.84 * reveal;
  const primary = shot.palette?.primary
    || shot.spec.elements.find((element) => element.type === 'rect')?.fill
    || '#0B0F19';
  const accent = shot.palette?.accent
    || shot.spec.elements.find((element) => element.id.endsWith('-accent'))?.fill
    || '#00F0FF';
  const backgroundElements = [];
  const foregroundElements = [];
  for (const element of shot.spec.elements) {
    const fill = escapeXml(element.fill || '#F8FAFC');
    if (element.type === 'rect') {
      const animatedWidth = element.id.endsWith('-accent')
        ? Math.max(1, element.width * easeOutCubic(clamp(progressValue * 2.2, 0.05, 1)))
        : element.width;
      const markup = `<rect x="${element.x}" y="${element.y}" width="${animatedWidth}" height="${element.height}" fill="${fill}" opacity="${element.id.endsWith('-background') ? 1 : fade}"/>`;
      const isBackground = element.x === 0 && element.y === 0 && element.width === width && element.height === height;
      (isBackground ? backgroundElements : foregroundElements).push(markup);
    } else if (element.type === 'circle') {
      foregroundElements.push(`<circle cx="${element.x}" cy="${element.y}" r="${element.radius ?? 12}" fill="${fill}" opacity="${fade}"/>`);
    } else if (element.type === 'text') {
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
      const glitchStrength = clamp((0.24 - progressValue) / 0.24, 0, 1);
      const glitchLayers = glitchStrength > 0
        ? `<text x="${element.x}" y="${y}" text-anchor="${anchor}" fill="#FF0055" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.max(16, fittedSize)}" font-weight="700" opacity="${glitchStrength * 0.48}" transform="translate(${Math.round(7 * glitchStrength)} ${Math.round(-2 * glitchStrength)}) skewX(-4)" clip-path="url(#glitch-slice)">${textLines}</text><text x="${element.x}" y="${y}" text-anchor="${anchor}" fill="${escapeXml(accent)}" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.max(16, fittedSize)}" font-weight="700" opacity="${glitchStrength * 0.38}" transform="translate(${Math.round(-5 * glitchStrength)} ${Math.round(2 * glitchStrength)})">${textLines}</text>`
        : '';
      foregroundElements.push(`${glitchLayers}<text x="${element.x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.max(16, fittedSize)}" font-weight="700" letter-spacing="${Math.max(0.4, fittedSize * 0.025)}" opacity="${fade}" filter="url(#text-glow)" style="font-kerning:normal">${textLines}</text>`);
    }
  }
  const atmosphere = `<rect width="${width}" height="${height}" fill="url(#ambient)" opacity=".7"/><rect width="${width}" height="${height}" fill="url(#grid)" opacity=".28"/><circle cx="${width * 0.76}" cy="${height * 0.48}" r="${Math.min(width, height) * 0.26}" fill="none" stroke="${escapeXml(accent)}" stroke-width="1" opacity=".42" transform="rotate(${-18 + progressValue * 7} ${width * 0.76} ${height * 0.48})"/><circle cx="${width * 0.76}" cy="${height * 0.48}" r="${Math.min(width, height) * 0.31}" fill="none" stroke="#FF0055" stroke-width="1" stroke-dasharray="3 12" opacity=".34" transform="rotate(${22 - progressValue * 11} ${width * 0.76} ${height * 0.48})"/><path d="M ${width * 0.08} ${height * 0.78} H ${width * (0.08 + 0.34 * reveal)}" fill="none" stroke="${escapeXml(accent)}" stroke-width="2" opacity=".78" filter="url(#accent-glow)"/><path d="M ${width * 0.08} ${height * 0.795} H ${width * (0.08 + 0.15 * reveal)}" fill="none" stroke="#FF0055" stroke-width="1" opacity=".72"/>`;
  const metadata = escapeXml(JSON.stringify({
    palette: shot.palette ?? { primary, accent },
    hardConstraints: shot.hardConstraints ?? [],
    copy: shot.spec.elements.filter((element) => element.type === 'text').map((element) => element.content),
  }));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
  <radialGradient id="ambient" cx="74%" cy="46%" r="68%"><stop offset="0" stop-color="${escapeXml(accent)}" stop-opacity=".22"/><stop offset=".42" stop-color="#FF0055" stop-opacity=".07"/><stop offset="1" stop-color="${escapeXml(primary)}" stop-opacity="0"/></radialGradient>
  <pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse"><path d="M 42 0 L 0 0 0 42" fill="none" stroke="${escapeXml(accent)}" stroke-width=".5" opacity=".42"/></pattern>
  <filter id="text-glow" x="-30%" y="-50%" width="160%" height="200%"><feGaussianBlur stdDeviation="5" result="blur"/><feFlood flood-color="${escapeXml(accent)}" flood-opacity=".34"/><feComposite in2="blur" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="accent-glow" x="-30%" y="-300%" width="160%" height="700%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <clipPath id="glitch-slice"><rect x="0" y="${height * 0.42}" width="${width}" height="${height * 0.2}"/></clipPath>
</defs>
<metadata>${metadata}</metadata>
${backgroundElements.join('\n')}
${atmosphere}
${foregroundElements.join('\n')}
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
