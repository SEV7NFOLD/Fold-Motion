import assert from 'node:assert/strict';
import test from 'node:test';
import generate from '../api/generate.js';

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('Vercel generation function returns a validated scene spec', async () => {
  const response = createResponse();
  await generate({
    method: 'POST',
    body: {
      prompt: 'Kinetic typography intro',
      context: { width: 1920, height: 1080 },
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.provider, 'mock-provider');
  assert.equal(response.body.spec.promptSource, 'Kinetic typography intro');
  assert.equal(response.body.spec.width, 1920);
  assert.equal(response.body.spec.height, 1080);
  assert.ok(Number.isFinite(Date.parse(response.body.validatedAt)));
});

test('Vercel generation function rejects invalid prompts and request methods', async () => {
  const invalidPromptResponse = createResponse();
  await generate({ method: 'POST', body: { prompt: ' ' } }, invalidPromptResponse);
  assert.equal(invalidPromptResponse.statusCode, 400);
  assert.match(invalidPromptResponse.body.error, /valid text prompt/);

  const invalidContextResponse = createResponse();
  await generate({
    method: 'POST',
    body: { prompt: 'A scene', context: 'invalid' },
  }, invalidContextResponse);
  assert.equal(invalidContextResponse.statusCode, 400);
  assert.match(invalidContextResponse.body.error, /Context must be a JSON object/);

  const methodResponse = createResponse();
  await generate({ method: 'GET', body: {} }, methodResponse);
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.Allow, 'POST');
});
