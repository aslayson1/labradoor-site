'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_BROWSER_TOKEN_SECONDS,
  mintBrowserToken,
  safeTextEqual,
} = require('../lib/redaction-auth');
const sessionHandler = require('../api/redaction-session');

const SECRET = 'redaction-test-secret-that-is-long-enough';
const PASSWORD = 'correct-horse-battery-staple';
const KNOWN_TOKEN =
  'v1.eyJhdWQiOiJsYWJyYWRvb3ItcmVkYWN0aW9uIiwiZXhwIjoxMDAwMzAwLCJpYXQiOjEwMDAwMDAsIm5vbmNlIjoidGVzdC1ub25jZSJ9.spBLGiza9OmynfYF6eUDdJIqMBh7x_ghJLsCbRgYvkg';

function invokeSession({ password = PASSWORD, origin = 'https://labradoor.ai' } = {}) {
  const previousKey = process.env.REDACTION_API_KEY;
  const previousPassword = process.env.REDACTION_ADMIN_PASSWORD;
  process.env.REDACTION_API_KEY = SECRET;
  process.env.REDACTION_ADMIN_PASSWORD = PASSWORD;

  const response = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };

  try {
    sessionHandler(
      {
        method: 'POST',
        headers: { host: 'labradoor.ai', origin },
        body: { password },
      },
      response,
    );
    return response;
  } finally {
    if (previousKey === undefined) delete process.env.REDACTION_API_KEY;
    else process.env.REDACTION_API_KEY = previousKey;
    if (previousPassword === undefined) delete process.env.REDACTION_ADMIN_PASSWORD;
    else process.env.REDACTION_ADMIN_PASSWORD = previousPassword;
  }
}

test('token signer matches the worker token format', () => {
  const session = mintBrowserToken(SECRET, {
    ttlSeconds: 300,
    now: 1_000_000,
    nonce: 'test-nonce',
  });

  assert.equal(session.token, KNOWN_TOKEN);
  assert.equal(session.expiresAt, 1_000_300_000);
});

test('constant-time text comparison returns the right result', () => {
  assert.equal(safeTextEqual('same value', 'same value'), true);
  assert.equal(safeTextEqual('same value', 'different value'), false);
});

test('session endpoint rejects missing origins and bad passwords', () => {
  assert.equal(invokeSession({ origin: undefined }).statusCode, 403);
  assert.equal(invokeSession({ password: 'wrong-password' }).statusCode, 401);
});

test('session endpoint returns an in-memory bearer session', () => {
  const response = invokeSession();

  assert.equal(response.statusCode, 200);
  assert.equal(typeof response.body.token, 'string');
  assert.match(response.body.token, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(
    response.body.apiBaseUrl,
    'https://scott-24377--labradoor-video-redaction-redaction-api.modal.run',
  );
  assert.equal(response.headers['Cache-Control'], 'no-store, max-age=0');

  const lifetime =
    new Date(response.body.expiresAt).getTime() - Date.now();
  assert.ok(lifetime > (MAX_BROWSER_TOKEN_SECONDS - 5) * 1000);
  assert.ok(lifetime <= (MAX_BROWSER_TOKEN_SECONDS + 1) * 1000);
});
