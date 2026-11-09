import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createStaticServer } from '../src/runtime/static-server.mjs';
import { buildAcceptanceSpec, compileCreativePlan, createCreativePlan } from '../src/production/production.mjs';

async function shortFilm(title) {
  const context = { primaryColor: '#0E0E11', accentColor: '#7C3AED', durationInSeconds: 2 };
  const { storyboard } = await createCreativePlan(title, context, null);
  const { timeline } = await compileCreativePlan(storyboard, context, null);
  return { timeline, storyboard, acceptance: buildAcceptanceSpec(storyboard, context), context, music: 'off' };
}

test('renders queue one at a time, report progress, and finish like a direct render', { timeout: 240_000 }, async () => {
  const server = await createStaticServer({ root: path.resolve('public') });
  const base = `http://${server.host}:${server.port}`;
  const post = async (body) => (await fetch(`${base}/api/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  try {
    const first = await post({ ...(await shortFilm('Queue test one')), async: true });
    const second = await post({ ...(await shortFilm('Queue test two')), async: true });
    assert.ok(first.jobId && second.jobId);
    assert.equal(second.position, 2, 'the second film waits behind the first');
    const stages = new Set();
    let sawFrames = false;
    const results = {};
    for (let i = 0; i < 400 && Object.keys(results).length < 2; i += 1) {
      for (const job of [first, second]) {
        if (results[job.jobId]) continue;
        const status = await (await fetch(`${base}/api/render/jobs/${job.jobId}`)).json();
        stages.add(status.progress?.stage);
        if (status.progress?.stage === 'drawing' && status.progress.done > 0) sawFrames = true;
        if (status.status === 'done' || status.status === 'failed') results[job.jobId] = status;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    for (const job of [first, second]) {
      const status = results[job.jobId];
      assert.equal(status.status, 'done', JSON.stringify(status.result?.error));
      assert.equal(status.result.success, true);
      assert.equal(status.result.report.productionQA.pass, true);
    }
    assert.ok(sawFrames, 'frames are reported as they are drawn');
    assert.ok(stages.has('queued') || stages.has('preparing'));
    const missing = await fetch(`${base}/api/render/jobs/not-a-job`);
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});
