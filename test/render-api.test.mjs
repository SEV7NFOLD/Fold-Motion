import assert from 'node:assert/strict';
import test from 'node:test';
import render from '../api/render.js';

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
    end() {
      return this;
    },
  };
}

test('Vercel render endpoint explicitly reports local renderer unavailability', () => {
  const response = createResponse();
  render({ method: 'POST' }, response);

  assert.equal(response.statusCode, 501);
  assert.equal(response.body.success, false);
  assert.match(response.body.error, /local FOLD Motion renderer/);
});

test('Vercel render endpoint preserves method checks and CORS preflight', () => {
  const wrongMethod = createResponse();
  render({ method: 'GET' }, wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.Allow, 'POST');

  const preflight = createResponse();
  render({ method: 'OPTIONS' }, preflight);
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], '*');
});
