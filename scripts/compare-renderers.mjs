#!/usr/bin/env node
/**
 * Renders the same timeline with the SVG engine and the experimental browser
 * renderer, then stacks the two films into one labelled comparison video.
 *
 *   npm run compare -- --brief "A sneaker drop called Volt Runner" [--seconds 6]
 *   npm run compare -- --input <render-request.json> [--look paper]
 *
 * A brief is planned with the offline planner (no AI keys needed), so the
 * comparison is about rendering, not about what the model wrote.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCreativePlan, createCreativePlan } from '../src/production/production.mjs';
import { renderProductionProject } from './render-production.mjs';
import { renderBrowserProject } from '../src/browser/render-browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

let request;
if (arg('--input')) {
  request = JSON.parse(await readFile(arg('--input'), 'utf8'));
} else {
  const brief = arg('--brief') || 'Ideas into motion. FOLD Motion turns a brief into a finished film.';
  const context = { width: 1920, height: 1080, fps: 30, ...(arg('--seconds') ? { durationInSeconds: Number(arg('--seconds')) } : {}), primaryColor: arg('--primary') || '#0B0F19', accentColor: arg('--accent') || '#00F0FF' };
  const { storyboard, acceptance } = await createCreativePlan(brief, context, null);
  const { timeline } = await compileCreativePlan(storyboard, context, null);
  request = { timeline, storyboard, acceptance, context };
}
const samples = arg('--samples') ? Number(arg('--samples')) : undefined;

console.log('Rendering with the SVG engine…');
const svg = await renderProductionProject({ ...request, resolution: 'hd' });
console.log('Rendering with the browser renderer…');
const look = arg('--look') || 'default';
const browser = await renderBrowserProject({ ...request, look, ...(samples ? { samples } : {}) });

const svgVideo = path.join(path.dirname(svg.reportPath), 'production.mp4');
const outDir = path.join(ROOT, 'output', 'compare');
await mkdir(outDir, { recursive: true });
const out = path.join(outDir, `${request.timeline.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-${Date.now()}.mp4`);
const font = path.join(ROOT, 'assets', 'fonts', 'Montserrat-SemiBold.ttf').replace(/:/g, '\\:');
const label = (text) => `drawtext=fontfile='${font}':text='${text}':x=36:y=30:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=14`;
const filter = [
  `[0:v]scale=1280:-2,${label('SVG engine (current)')}[a]`,
  `[1:v]scale=1280:-2,${label(`Browser renderer, ${look} look (experimental)`)}[b]`,
  '[a][b]vstack=inputs=2[v]',
].join(';');
await new Promise((resolve, reject) => {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', svgVideo, '-i', browser.videoPath, '-filter_complex', filter, '-map', '[v]', '-map', '1:a?', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out], { stdio: 'inherit' });
  ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
});
console.log(`SVG engine report:       ${svg.reportPath}`);
console.log(`Browser renderer report: ${browser.reportPath}`);
console.log(`COMPARE_VIDEO:${out}`);
