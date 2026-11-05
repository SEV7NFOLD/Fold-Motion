/**
 * Drift tests for skills/fold-motion.
 *
 * The skill tells agents what the engine does; the prompts tell Gemini. These
 * tests fail when either drifts from the code, so a capability change and its
 * documentation ship together.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROJECT_STATES } from '../src/orchestrator/project-state.mjs';
import {
  buildAcceptanceSpec,
  buildTimeline,
  compileCreativePlan,
  evaluateCreativeQA,
  validateStoryboard,
} from '../src/production/production.mjs';
import { GeminiAIProvider } from '../src/ai/provider.mjs';
import { SHOT_COMPILER, STORYBOARD_DIRECTOR } from '../src/ai/prompts/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = path.join(root, 'skills', 'fold-motion');
const read = (...parts) => readFileSync(path.join(...parts), 'utf8');
const skill = read(skillDir, 'SKILL.md');
const engine = read(skillDir, 'references', 'engine.md');
const sceneSpec = read(skillDir, 'references', 'scene-spec.md');
const exampleStoryboard = JSON.parse(read(skillDir, 'templates', 'storyboard.example.json'));
const renderer = read(root, 'scripts', 'render-production.mjs');

test('the skill has frontmatter that lets agents discover it', () => {
  const match = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'SKILL.md must start with a YAML frontmatter block');
  assert.match(match[1], /^name: fold-motion$/m);
  const description = match[1].match(/^description: (.+)$/m)?.[1] ?? '';
  assert.ok(description.length > 200, 'description should say what the skill does and when to use it');
  assert.ok(description.length <= 1024, 'description must stay within the 1024-character limit');
});

test('only the fold-motion skill and one canonical skill book exist', () => {
  assert.deepEqual(readdirSync(path.join(root, 'skills')), ['fold-motion']);
  const books = readdirSync(path.join(root, 'docs')).filter((name) => /SKILL-BOOK/i.test(name));
  assert.deepEqual(books, ['FOLD-MOTION-SKILL-BOOK.md']);
});

test('every relative link in the skill resolves', () => {
  const files = [
    path.join(skillDir, 'SKILL.md'),
    ...readdirSync(path.join(skillDir, 'references')).map((name) => path.join(skillDir, 'references', name)),
  ];
  for (const file of files) {
    for (const [, target] of readFileSync(file, 'utf8').matchAll(/\]\(((?!https?:)[^)#]+)\)/g)) {
      assert.ok(existsSync(path.resolve(path.dirname(file), target)), `${path.relative(root, file)} links to missing ${target}`);
    }
  }
});

test('documented project states and transitions match the state machine', () => {
  const sentence = skill.match(/The project states are exactly ([\s\S]+?), enforced/)?.[1] ?? '';
  const documented = [...sentence.matchAll(/`([A-Z_]+)`/g)].map(([, state]) => state);
  assert.deepEqual(documented, [...PROJECT_STATES]);

  const transitions = [...engine.matchAll(/`([A-Z_]+)` → `([A-Z_]+)`/g)].map(([, from, to]) => `${from}>${to}`);
  const expected = PROJECT_STATES.slice(0, -1).map((state, index) => `${state}>${PROJECT_STATES[index + 1]}`);
  assert.deepEqual(transitions, expected);
});

test('documented element types and anchors match what the engine accepts', async () => {
  const table = sceneSpec.split('Only three element types render:')[1].split('Every `fill`')[0];
  const documentedTypes = [...table.matchAll(/^\| `([a-z]+)` \|/gm)].map(([, type]) => type);
  assert.deepEqual(documentedTypes, ['rect', 'circle', 'text']);
  assert.match(sceneSpec, /`anchor` is `start`, `middle` or `end`/);

  const context = { primaryColor: '#0B0B10', accentColor: '#C9A86A' };
  const { timeline } = await compileCreativePlan(exampleStoryboard, context, null);
  const specsWith = (element) => timeline.shots.map((shot, index) => ({
    ...shot.spec,
    elements: index === 0 ? [...shot.spec.elements, element] : shot.spec.elements,
  }));
  const extras = {
    rect: { id: 'extra', type: 'rect', x: 10, y: 10, width: 20, height: 20, fill: '#C9A86A' },
    circle: { id: 'extra', type: 'circle', x: 30, y: 30, radius: 8, fill: '#C9A86A' },
    text: { id: 'extra', type: 'text', content: 'Extra', x: 640, y: 600, fill: '#F8FAFC', fontSize: 20, anchor: 'end' },
  };
  for (const type of documentedTypes) {
    assert.doesNotThrow(() => buildTimeline(exampleStoryboard, specsWith(extras[type]), context), `${type} should render`);
  }
  assert.throws(() => buildTimeline(exampleStoryboard, specsWith({ id: 'extra', type: 'path', fill: '#C9A86A' }), context));

  let schema;
  const provider = new GeminiAIProvider({
    apiKey: 'k',
    fetchImpl: async (_url, options) => {
      schema = JSON.parse(options.body).generationConfig.responseSchema;
      return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: '[]' }] } }] }; } };
    },
  });
  await provider.compileStoryboard(exampleStoryboard, context);
  const elementProperties = schema.items.properties.elements.items.properties;
  assert.deepEqual(elementProperties.type.enum, documentedTypes);
  assert.deepEqual(elementProperties.anchor.enum, ['start', 'middle', 'end']);
});

test('documented creative QA thresholds match evaluateCreativeQA', async () => {
  const context = { primaryColor: '#0B0B10', accentColor: '#C9A86A' };
  const { timeline } = await compileCreativePlan(exampleStoryboard, context, null);
  const qa = evaluateCreativeQA(timeline, context);
  assert.equal(qa.contrast.requiredRatio, 4.5);
  assert.equal(qa.legibility.minimumFontSize, 16);
  assert.match(sceneSpec, /at least 4\.5:1/);
  assert.match(sceneSpec, /`fontSize` of at least 16/);
});

test('every documented npm command exists', () => {
  const scripts = JSON.parse(read(root, 'package.json')).scripts;
  const commands = [...engine.matchAll(/`npm (?:run )?([a-z0-9:-]+)/g)].map(([, name]) => name);
  assert.ok(commands.length >= 5);
  for (const name of commands) assert.ok(scripts[name], `engine.md documents "npm ${name}" but package.json has no such script`);
});

test('templates are valid and match the code that produces them', () => {
  assert.deepEqual(validateStoryboard(exampleStoryboard), { valid: true, errors: [] });
  const acceptance = JSON.parse(read(skillDir, 'templates', 'acceptance.example.json'));
  assert.deepEqual(acceptance, buildAcceptanceSpec(exampleStoryboard, {}));
  const defect = read(skillDir, 'templates', 'defect-report.md');
  for (const field of ['Shot', 'When', 'Gate', 'Severity', 'Evidence', 'Observation', 'Why it matters', 'Proposed change', 'Expected result', 'Verification', 'Status']) {
    assert.ok(defect.includes(`**${field}:**`), `defect template is missing ${field}`);
  }
});

test('Gemini prompts describe the renderer as it actually behaves', () => {
  assert.match(renderer, /animatedWidth = element\.id\.endsWith\('-accent'\)/, 'renderer no longer draws on "-accent" rects: update shot-compiler.mjs, scene-spec.md and engine.md');
  assert.match(renderer, /opacity="\$\{element\.id\.endsWith\('-background'\) \? 1 : fade\}"/, 'renderer no longer keeps "-background" rects opaque: update shot-compiler.mjs, scene-spec.md, engine.md and repair.mjs');
  assert.match(renderer, /width \* 0\.76/, 'renderer wrap width changed: update shot-compiler.mjs and engine.md');
  assert.match(renderer, /height \* 0\.15/, 'renderer text size cap changed: update shot-compiler.mjs and engine.md');
  assert.match(SHOT_COMPILER, /"-background"/);
  assert.match(SHOT_COMPILER, /"-accent"/);
  assert.match(SHOT_COMPILER, /76%/);
  assert.match(STORYBOARD_DIRECTOR, /Shots cut directly/);
  assert.match(STORYBOARD_DIRECTOR, /character for character/);
});

test('capabilities documented as "not yet" are still missing from the renderer', () => {
  // When one of these fails, the capability shipped: update engine.md, the
  // storyboard-director prompt and this test in the same change.
  assert.doesNotMatch(renderer, /audio/i, 'audio reached the renderer');
  assert.doesNotMatch(renderer, /render-cache/, 'the render cache is now wired in');
  assert.doesNotMatch(renderer, /<image|<path d="M .* fill="(?!none)/, 'the renderer can now draw images or filled paths');
  assert.match(engine, /Nothing muxes audio into the MP4/);
});

test('eval cases follow the skill-creator test-case format', () => {
  const evalsDir = path.join(skillDir, 'evals');
  const cases = readdirSync(evalsDir);
  assert.ok(cases.length >= 5, 'keep at least five behavior cases');
  for (const name of cases) {
    const dir = path.join(evalsDir, name);
    assert.match(name, /^[a-z][a-z0-9-]*$/);
    const prompt = read(dir, 'prompt.md');
    const settings = prompt.match(/^---\n([\s\S]*?)\n---\n\n\S/)?.[1];
    assert.ok(settings, `${name}/prompt.md needs a settings block followed by the prompt`);
    for (const line of settings.split('\n')) {
      assert.match(line, /^(tags|max_turns|timeout_seconds|allowed_tools): /, `${name}: unknown setting "${line}"`);
    }
    const caseYaml = read(dir, 'case.yaml');
    assert.match(caseYaml, /^schema_version: "1\.1"$/m);
    assert.match(caseYaml, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(caseYaml, /^expected_outcome: \|$/m);
    const graders = readdirSync(path.join(dir, 'graders'));
    assert.ok(graders.length > 0, `${name} needs at least one grader`);
    for (const grader of graders) {
      assert.match(grader, /^\d{2}-[a-z0-9-]+\.md$/);
      assert.match(read(dir, 'graders', grader), /^---\ntype: llm\nfocus: trace\nweight: 1\n---\n\n\S/);
    }
    if (existsSync(path.join(dir, 'files'))) {
      assert.ok(existsSync(path.join(dir, 'place-files.sh')), `${name} has files/ but no place-files.sh`);
      assert.match(caseYaml, /scaffold_script: place-files\.sh/);
      for (const file of readdirSync(path.join(dir, 'files'))) assert.match(prompt, new RegExp(`Input files: .*${file.replace('.', '\\.')}`));
    }
  }
});
