#!/usr/bin/env node
// Experimental: render a timeline in headless Chromium instead of SVG + Resvg.
// Usage: npm run render:browser -- --input <render-request.json> [--samples 4]
import { readFile } from 'node:fs/promises';
import { renderBrowserProject } from '../src/browser/render-browser.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const inputPath = arg('--input');
if (!inputPath) {
  console.error('Usage: npm run render:browser -- --input <render-request.json> [--samples 4]');
  process.exit(1);
}
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const samples = arg('--samples') ? Number(arg('--samples')) : undefined;
const result = await renderBrowserProject({ ...input, ...(samples ? { samples } : {}) });
console.log(`RENDER_REPORT:${result.reportPath}`);
console.log(JSON.stringify({ renderer: result.report.renderer, productionQA: result.report.productionQA.pass, creativeQA: result.report.creativeQA.pass, unsupported: result.report.unsupported || [] }));
