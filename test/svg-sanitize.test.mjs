import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { pathLength, sanitizeSvg, serializeSvgTree } from '../public/svg-sanitize.mjs';

const ATTACKS = {
  script: '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>',
  'event handlers': '<svg viewBox="0 0 10 10" onload="alert(1)"><rect width="10" height="10" onclick="x()"/></svg>',
  'external image': '<svg viewBox="0 0 10 10"><image href="http://evil.example/x.png"/><rect width="10" height="10"/></svg>',
  foreignObject: '<svg viewBox="0 0 10 10"><foreignObject><iframe src="http://evil"></iframe></foreignObject><rect width="10" height="10"/></svg>',
  'external url in fill': '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="url(http://evil.example/#g)"/></svg>',
  'url in css': '<svg viewBox="0 0 10 10"><style>.a{fill:url(http://evil)}</style><rect class="a" style="fill:url(https://evil)" width="10" height="10"/></svg>',
  'use href': '<svg viewBox="0 0 10 10"><use href="http://evil.example/sprite.svg#a"/><rect width="10" height="10"/></svg>',
  'xxe entity': '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg viewBox="0 0 10 10"><text>&xxe;</text><rect width="10" height="10"/></svg>',
  animate: '<svg viewBox="0 0 10 10"><rect width="10" height="10"><animate attributeName="href" to="javascript:alert(1)"/></rect></svg>',
  'transform injection': '<svg viewBox="0 0 10 10"><rect width="10" height="10" transform="url(javascript:alert(1))"/></svg>',
  'quote breakout': '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="red&quot; onload=&quot;alert(1)"/></svg>',
};

test('attack SVGs are rebuilt without anything executable or external', () => {
  for (const [name, svg] of Object.entries(ATTACKS)) {
    const result = sanitizeSvg(svg);
    const out = result.ok ? serializeSvgTree(result.tree) : '';
    assert.doesNotMatch(out, /script|onload|onclick|javascript|evil|iframe|foreignObject|<image|<use|animate|passwd|xxe|http/i, name);
  }
});

test('real logos survive with their colors and shapes', () => {
  const mark = sanitizeSvg(readFileSync(new URL('../public/brand/sev7n-fold-mark.svg', import.meta.url), 'utf8'));
  assert.equal(mark.ok, true);
  assert.deepEqual(mark.viewBox, [0, 0, 412, 512]);
  assert.equal(mark.shapes, 3);
  const illustrator = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><defs><style>.cls-1{fill:#e63946;}.cls-2{fill:none;stroke:#1d3557;stroke-width:2px}</style></defs><title>Acme</title><rect class="cls-1" width="36" height="36"/><circle class="cls-2" cx="70" cy="20" r="16"/></svg>');
  const out = serializeSvgTree(illustrator.tree);
  assert.match(out, /<rect fill="#e63946"/);
  assert.match(out, /<circle fill="none" stroke="#1d3557" stroke-width="2px"/);
  assert.doesNotMatch(out, /class=|<title|<style/);
});

test('shape lengths are measured for the draw-on, curves and arcs included', () => {
  assert.ok(Math.abs(pathLength('M0 0 H100 V100 H0 Z') - 400) < 0.01);
  assert.ok(Math.abs(pathLength('M0 0 A50 50 0 0 1 100 0') - Math.PI * 50) < 0.5, 'a half circle');
  assert.ok(Math.abs(pathLength('M0 0 C 0 0, 100 0, 100 0') - 100) < 0.5, 'a straight cubic');
  assert.ok(Math.abs(pathLength('m0 0 l10 0 l0 10') - 20) < 0.01, 'relative commands');
  const circle = sanitizeSvg('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
  assert.ok(Math.abs(circle.tree.children[0].length - 2 * Math.PI * 4) < 0.01);
});

test('unusable files get a reason a person can act on', () => {
  assert.match(sanitizeSvg('').error, /empty/);
  assert.match(sanitizeSvg('<html><body>hi</body></html>').error, /isn’t an SVG/);
  assert.match(sanitizeSvg('<svg><rect width="1" height="1"/></svg>').error, /viewBox/);
  assert.match(sanitizeSvg('<svg viewBox="0 0 1 1"><script/></svg>').error, /no shapes/);
  assert.match(sanitizeSvg(`<svg viewBox="0 0 1 1">${' '.repeat(210000)}</svg>`).error, /larger than 200 KB/);
});

test('ids get a prefix so several copies of a logo can share a frame', () => {
  const result = sanitizeSvg('<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>');
  const out = serializeSvgTree(result.tree, { idPrefix: 'logo1-' });
  assert.match(out, /id="logo1-g"/);
  assert.match(out, /fill="url\(#logo1-g\)"/);
});
