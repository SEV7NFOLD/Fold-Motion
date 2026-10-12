import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveStaticPath } from '../src/runtime/static-server.mjs';

test('maps preview URLs beneath the configured root and rejects traversal', () => {
  const root = path.resolve('public');

  assert.equal(resolveStaticPath(root, '/'), path.join(root, 'index.html'));
  assert.equal(resolveStaticPath(root, '/scene-01.html'), path.join(root, 'scene-01.html'));
  assert.equal(resolveStaticPath(root, '/..%2Fpackage.json'), null);
});
