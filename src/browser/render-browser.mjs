/**
 * FOLD Motion experimental browser renderer.
 *
 * Renders a validated timeline in headless Chromium (src/browser/scene-runtime.js)
 * instead of SVG + Resvg. Each frame is captured as several sub-frame samples
 * across a 180-degree shutter and averaged by FFmpeg (tmix) for real motion blur,
 * then encoded to H.264 with the same FOLD Score soundtrack as the SVG engine
 * and checked with FFprobe. Output lands beside normal renders, in a run folder
 * ending in "-browser", with a production-qa.json that npm run qa:validate reads.
 *
 * This renderer is opt-in and never replaces the SVG engine silently.
 */
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCreativeQA, validateTimeline } from '../production/production.mjs';
import { beatGrid, measureBeatSync, timelineBeatEvents } from '../production/beat-clock.mjs';
import { composeScore, encodeWav, masterScore } from '../audio/fold-score.mjs';
import { instrumentBand } from '../audio/band.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(HERE, '../../assets/fonts');
export const BROWSER_RENDERER = 'chromium + ffmpeg (experimental browser renderer)';

async function loadPlaywright() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    throw new Error('The browser renderer needs Playwright. Run: npm install && npx playwright install chromium');
  }
}

/** Font id (as stored on elements) → { family, file } for every font the timeline uses. */
export async function timelineFonts(timeline) {
  const base = JSON.parse(await readFile(path.join(FONTS_DIR, 'metrics.json'), 'utf8'));
  const paired = JSON.parse(await readFile(path.join(FONTS_DIR, 'pairings', 'metrics.json'), 'utf8'));
  const ids = new Set(['display']);
  for (const shot of timeline.shots) for (const el of shot.spec.elements || []) if (el.font) ids.add(el.font);
  const fonts = {};
  const missing = [];
  for (const id of ids) {
    const metrics = id === '_note' ? null : base[id] || paired[id];
    if (!metrics?.file) { missing.push(id); continue; }
    fonts[id] = { family: `fold-${id}`, file: path.join(FONTS_DIR, metrics.file) };
  }
  return { fonts, missing };
}

/** The self-contained page: fonts inlined, data in a global, runtime added after fonts load. */
export async function buildScenePage(timeline, fonts) {
  const faces = await Promise.all(Object.values(fonts).map(async ({ family, file }) => {
    const data = (await readFile(file)).toString('base64');
    const format = file.endsWith('.otf') ? 'opentype' : 'truetype';
    return `@font-face{font-family:"${family}";src:url(data:font/${format === 'opentype' ? 'otf' : 'ttf'};base64,${data}) format("${format}");font-display:block}`;
  }));
  const data = {
    width: timeline.width,
    height: timeline.height,
    fps: timeline.fps,
    totalFrames: timeline.totalFrames,
    palette: timeline.palette,
    fonts: Object.fromEntries(Object.entries(fonts).map(([id, { family }]) => [id, `"${family}"`])),
    shots: timeline.shots.map((shot) => ({
      shotId: shot.shotId, startFrame: shot.startFrame, endFrame: shot.endFrame,
      durationFrames: shot.durationFrames, palette: shot.palette, spec: shot.spec,
    })),
  };
  const { width: W, height: H } = timeline;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${faces.join('\n')}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#000}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden}
.fill{position:absolute;left:0;top:0;width:${W}px;height:${H}px}
.stage{perspective-origin:50% 50%;overflow:hidden}
.world,.layer{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-style:preserve-3d;transform-origin:50% 50%}
.sheet{position:absolute;left:0;top:0;transform-style:preserve-3d}
.strip{position:absolute;top:0;transform-origin:0 50%;transform-style:preserve-3d}
.face{position:absolute;inset:0;overflow:hidden}
.inner{position:absolute;top:0}
.plate{position:absolute;left:0;top:0;overflow:visible}
.sheen{mix-blend-mode:screen}
.vignette{background:radial-gradient(ellipse at 50% 48%,transparent 55%,rgba(0,0,0,.55) 100%)}
</style></head><body><div id="root"></div>
<script>window.FOLD_DATA=${JSON.stringify(data).replace(/</g, '\\u003c')};</script>
</body></html>`;
}

function run(command, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited with ${code}: ${stderr.slice(-800)}`))));
    if (input !== undefined) child.stdin.end(input);
  });
}

/** Opens the scene in Chromium and returns helpers to draw and capture it. */
export async function openScene(timeline, { launch } = {}) {
  const chromium = launch ? null : await loadPlaywright();
  const browser = launch ? await launch() : await chromium.launch({ args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: timeline.width, height: timeline.height }, deviceScaleFactor: 1 });
  const { fonts, missing } = await timelineFonts(timeline);
  await page.setContent(await buildScenePage(timeline, fonts), { waitUntil: 'load' });
  // Fonts must be ready before the runtime measures any text.
  await page.evaluate(async (families) => {
    await Promise.all(families.map((family) => document.fonts.load(`100px "${family}"`, 'AaBb')));
  }, Object.values(fonts).map((f) => f.family));
  await page.addScriptTag({ content: await readFile(path.join(HERE, 'scene-runtime.js'), 'utf8') });
  const unsupported = [
    ...missing.map((id) => ({ element: `font:${id}`, reason: 'This font (an uploaded brand font) is not loaded by the browser renderer yet; the display font is used.' })),
    ...(await page.evaluate(() => window.FOLD_RENDER.unsupported)),
  ];
  // Chrome's fast lossless PNG path (DevTools protocol) is about 5x quicker than the default.
  const cdp = await page.context().newCDPSession(page);
  return {
    page,
    unsupported,
    draw: (seconds) => page.evaluate((t) => window.FOLD_RENDER.frame(t), seconds),
    capture: async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })).data, 'base64'),
    check: () => page.evaluate(() => window.FOLD_RENDER.check()),
    close: () => browser.close(),
  };
}

/** Sub-frame sample times for one frame: centred on it, spread across the shutter. */
export function sampleTimes(frameIndex, fps, samples, shutter, totalFrames) {
  const last = (totalFrames - 1) / fps;
  return Array.from({ length: samples }, (_, j) => {
    const offset = samples === 1 ? 0 : ((j + 0.5) / samples - 0.5) * (shutter / fps);
    return Math.min(last, Math.max(0, frameIndex / fps + offset));
  });
}

export async function renderBrowserProject({
  timeline,
  storyboard,
  acceptance,
  context,
  music = 'auto',
  samples = Number(process.env.BROWSER_RENDER_SAMPLES) || 4,
  shutter = 0.5,
  outputRoot = path.resolve('output'),
  launch,
}) {
  const validation = validateTimeline(timeline);
  if (!validation.valid) throw new Error(`Timeline validation failed: ${validation.errors.join(' ')}`);
  const S = Math.max(1, Math.min(8, Math.round(samples)));
  const projectId = timeline.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-browser`;
  const outputDirectory = path.join(outputRoot, projectId, runId);
  const stillsDirectory = path.join(outputDirectory, 'frames');
  try {
    await access(outputDirectory);
    throw new Error(`Render output already exists: ${outputDirectory}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(stillsDirectory, { recursive: true });
  for (const [name, value] of [['timeline', timeline], ['storyboard', storyboard], ['acceptance', acceptance]]) {
    await writeFile(path.join(outputDirectory, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  }
  await writeFile(path.join(outputDirectory, 'source-project.json'), `${JSON.stringify({ schemaVersion: '1.0', storyboard, acceptance, timeline }, null, 2)}\n`);

  const progress = (stage, done, total) => process.stdout.write(`FOLD_PROGRESS ${JSON.stringify({ stage, ...(total ? { done, total } : {}) })}\n`);

  // The same soundtrack the SVG engine would give this film, so comparisons are fair.
  let scorePath = null;
  let score = null;
  if (music !== 'off') {
    progress('scoring');
    const { scoreMood } = await import('../../scripts/render-production.mjs');
    let band;
    if (process.env.FOLD_SCORE !== 'synth') {
      try { band = instrumentBand(); } catch (error) { console.warn(`Real instruments unavailable, using the synth score: ${error.message}`); }
    }
    score = composeScore(timeline, {
      mood: scoreMood(music, storyboard),
      text: [storyboard?.title, storyboard?.narrativeConcept, storyboard?.creativeDirection].filter(Boolean).join(' '),
      band,
    });
    masterScore(score, { target: -14, ceiling: -2 });
    scorePath = path.join(outputDirectory, 'score.wav');
    await writeFile(scorePath, encodeWav(score));
  }

  const isWindows = process.platform === 'win32';
  const ffmpeg = isWindows ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobe = isWindows ? 'ffprobe.exe' : 'ffprobe';
  const videoPath = path.join(outputDirectory, 'production.mp4');
  const blend = S > 1 ? [`tmix=frames=${S}`, `select='eq(mod(n+1\\,${S})\\,0)'`] : [];
  const encoder = spawn(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(timeline.fps * S), '-i', '-',
    ...(scorePath ? ['-i', scorePath] : []),
    // Grain once per finished frame, after the blend; the noise filter's seed is fixed, so it repeats exactly.
    '-vf', [...blend, `setpts=N/(${timeline.fps}*TB)`, 'noise=c0s=7:c0f=t:allf=u', 'format=yuv420p'].join(','),
    '-r', String(timeline.fps),
    ...(scorePath ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest'] : []),
    '-c:v', 'libx264', '-preset', process.env.RENDER_X264_PRESET || 'medium', '-crf', '17',
    '-movflags', '+faststart', videoPath,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let encoderError = '';
  encoder.stderr.on('data', (d) => { encoderError += d; });
  const encoded = new Promise((resolve, reject) => {
    encoder.on('error', reject);
    encoder.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg failed (${code}): ${encoderError.slice(-800)}`))));
  });
  let pipeError = null;
  encoder.stdin.on('error', (error) => { pipeError = error; });
  const write = (buffer) => new Promise((resolve, reject) => {
    if (pipeError) return reject(new Error(`FFmpeg stopped accepting frames: ${pipeError.message}. ${encoderError.slice(-400)}`));
    if (encoder.stdin.write(buffer)) resolve();
    else encoder.stdin.once('drain', resolve);
  });

  const scene = await openScene(timeline, { launch });
  let browserQA;
  const stills = [];
  try {
    progress('drawing', 0, timeline.totalFrames);
    for (let f = 0; f < timeline.totalFrames; f += 1) {
      for (const t of sampleTimes(f, timeline.fps, S, shutter, timeline.totalFrames)) {
        await scene.draw(t);
        await write(await scene.capture());
      }
      if (f % 6 === 5 || f === timeline.totalFrames - 1) progress('drawing', f + 1, timeline.totalFrames);
    }
    encoder.stdin.end();
    progress('encoding');
    await encoded;
    progress('validating');
    // Copy and safe-area checks at each shot's settled moment, plus a still of it for review.
    browserQA = await scene.check();
    for (const [index, shotCheck] of browserQA.entries()) {
      const shot = timeline.shots[index];
      await scene.draw(shot.startFrame / timeline.fps + shotCheck.settledAt);
      const file = `${shot.shotId}.png`;
      await writeFile(path.join(stillsDirectory, file), await scene.capture());
      stills.push(`/output/${projectId}/${runId}/frames/${file}`);
    }
  } finally {
    if (!encoder.stdin.writableEnded) encoder.stdin.end();
    await scene.close();
  }

  const probe = JSON.parse((await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=duration:stream=width,height,avg_frame_rate,nb_frames', '-of', 'json', videoPath])).stdout);
  const stream = probe.streams?.[0] || {};
  const [num, den] = String(stream.avg_frame_rate || '0/1').split('/').map(Number);
  const actualRate = den ? num / den : NaN;
  const actualDuration = Number.parseFloat(probe.format?.duration ?? 'NaN');
  const encodedFrames = Number.parseInt(stream.nb_frames ?? 'NaN', 10);
  let audio = null;
  if (scorePath) {
    const audioProbe = JSON.parse((await run(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels,duration', '-of', 'json', videoPath])).stdout);
    const a = audioProbe.streams?.[0];
    const d = Number.parseFloat(a?.duration ?? 'NaN');
    audio = { pass: Boolean(a) && Math.abs(d - timeline.durationInSeconds) <= 1 / timeline.fps + 0.03, codec: a?.codec_name, duration: d };
  }
  let silentExport = null;
  if (scorePath) {
    await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', videoPath, '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', path.join(outputDirectory, 'production-silent.mp4')]);
    silentExport = { file: 'production-silent.mp4', bpm: score.bpm, label: `${score.bpm} BPM` };
  }
  const productionQA = {
    dimensions: { pass: stream.width === timeline.width && stream.height === timeline.height, expected: { width: timeline.width, height: timeline.height }, actual: { width: stream.width, height: stream.height } },
    fps: { pass: Math.abs(actualRate - timeline.fps) < 0.01, expected: timeline.fps, actual: actualRate },
    frameIntegrity: { pass: encodedFrames === timeline.totalFrames, expectedFrames: timeline.totalFrames, encodedVideoFrames: encodedFrames, samplesPerFrame: S },
    duration: { pass: Number.isFinite(actualDuration) && Math.abs(actualDuration - timeline.durationInSeconds) <= 1 / timeline.fps, expected: timeline.durationInSeconds, actual: actualDuration },
    ...(audio ? { audio } : {}),
  };
  if (timeline.beat) {
    productionQA.beatSync = {
      ...measureBeatSync(beatGrid({ bpm: timeline.beat.bpm, fps: timeline.fps, durationInSeconds: timeline.durationInSeconds }), timelineBeatEvents(timeline)),
      bpm: timeline.beat.bpm,
      ...(score ? { scoreBpm: score.bpm } : {}),
    };
    if (score && score.bpm !== timeline.beat.bpm) productionQA.beatSync.pass = false;
  }
  productionQA.pass = Object.values(productionQA).every((check) => check.pass);

  // Layout QA is shared with the SVG engine (the browser draws the engine's layout);
  // the browser adds its own checks on what it actually drew.
  const layoutQA = evaluateCreativeQA(timeline, context);
  const creativeQA = { ...layoutQA, browser: browserQA, pass: Boolean(layoutQA.pass) && browserQA.every((shot) => shot.pass) };

  const unsupported = scene.unsupported;
  const report = {
    schemaVersion: '1.0',
    projectId,
    runId,
    verified: true,
    experimental: true,
    renderedAt: new Date().toISOString(),
    renderer: BROWSER_RENDERER,
    motionBlur: { samplesPerFrame: S, shutterDegrees: Math.round(shutter * 360) },
    productionQA,
    creativeQA,
    audio: score ? { engine: 'FOLD Score', mood: score.mood, bpm: score.bpm } : { engine: 'none' },
    ...(silentExport ? { silentExport } : {}),
    ...(unsupported.length ? { unsupported } : {}),
    videoMetadata: probe,
    artifacts: {
      video: `/output/${projectId}/${runId}/production.mp4`,
      ...(silentExport ? { silentVideo: `/output/${projectId}/${runId}/production-silent.mp4` } : {}),
      stills,
      timeline: `/output/${projectId}/${runId}/timeline.json`,
      storyboard: `/output/${projectId}/${runId}/storyboard.json`,
      acceptance: `/output/${projectId}/${runId}/acceptance.json`,
      source: `/output/${projectId}/${runId}/source-project.json`,
      qa: `/output/${projectId}/${runId}/production-qa.json`,
    },
  };
  const reportPath = path.join(outputDirectory, 'production-qa.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, reportPath, videoPath };
}
