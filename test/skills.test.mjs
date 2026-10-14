import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skills = [
  ['brief-to-criteria', 'Brief-to-Criteria'],
  ['creative-director', 'Creative Director'],
  ['storyboard-architect', 'Storyboard Architect'],
  ['typography-and-layout', 'Typography and Layout'],
  ['svg-illustration', 'SVG Illustration'],
  ['motion-engineer', 'Motion Engineer'],
  ['product-animation', 'Product Animation'],
  ['render-engineer', 'Render Engineer'],
  ['visual-critic', 'Visual Critic'],
  ['motion-critic', 'Motion Critic'],
  ['revision-engineer', 'Revision Engineer'],
  ['audio-and-assembly', 'Audio and Assembly'],
  ['delivery-and-verification', 'Delivery and Verification'],
];

const skillFile = (slug) => path.join(repositoryRoot, 'skills', slug, 'SKILL.md');

test('master and all 13 canonical specialist skills exist with matching titles', async () => {
  const master = await readFile(path.join(repositoryRoot, 'skills', 'master', 'SKILL.md'), 'utf8');
  assert.match(master, /^# FOLD Motion Master Skill/m);

  for (const [slug, title] of skills) {
    const contents = await readFile(skillFile(slug), 'utf8');
    assert.match(contents, new RegExp(`^# ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.ok(contents.length > 200, `${title} should contain focused working instructions`);
  }
});

test('master routes to every specialist and preserves book-wide operating constraints', async () => {
  const master = await readFile(path.join(repositoryRoot, 'skills', 'master', 'SKILL.md'), 'utf8');
  const normalizedMaster = master.replace(/\s+/g, ' ');

  for (const [slug, title] of skills) {
    assert.ok(master.includes(`[${title}](../${slug}/SKILL.md)`), `master link missing for ${title}`);
    await access(skillFile(slug));
  }

  assert.match(normalizedMaster, /seek\(tLocalSeconds\)/);
  assert.match(normalizedMaster, /Production QA verifies .* Creative QA evaluates/);
  assert.match(normalizedMaster, /Never claim a render, inspection, test/);
  assert.match(normalizedMaster, /two attempts per failure/);
  assert.match(normalizedMaster, /three rounds per shot/);
});
