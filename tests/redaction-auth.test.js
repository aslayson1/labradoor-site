'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_BROWSER_TOKEN_SECONDS,
  mintBrowserToken,
  safeTextEqual,
  verifyBrowserToken,
} = require('../lib/redaction-auth');
const sessionHandler = require('../api/redaction-session');
const verificationHandler = require('../api/redaction-token-verification');

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

function invokeVerification({
  token = mintBrowserToken(SECRET).token,
  method = 'POST',
} = {}) {
  const previousKey = process.env.REDACTION_API_KEY;
  process.env.REDACTION_API_KEY = SECRET;

  const response = {
    headers: {},
    statusCode: 200,
    body: null,
    ended: false,
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
    end() {
      this.ended = true;
      return this;
    },
  };

  try {
    verificationHandler(
      {
        method,
        headers: { authorization: `Bearer ${token}` },
      },
      response,
    );
    return response;
  } finally {
    if (previousKey === undefined) delete process.env.REDACTION_API_KEY;
    else process.env.REDACTION_API_KEY = previousKey;
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

test('token verifier accepts current tokens and rejects invalid values', () => {
  assert.equal(verifyBrowserToken(KNOWN_TOKEN, SECRET, { now: 1_000_001 }), true);
  assert.equal(verifyBrowserToken(KNOWN_TOKEN, SECRET, { now: 1_000_300 }), false);
  assert.equal(
    verifyBrowserToken(KNOWN_TOKEN, 'different-secret-that-is-long-enough', {
      now: 1_000_001,
    }),
    false,
  );
  assert.equal(verifyBrowserToken('not-a-token', SECRET), false);
});

test('worker token verification endpoint fails closed', () => {
  const accepted = invokeVerification();
  assert.equal(accepted.statusCode, 204);
  assert.equal(accepted.ended, true);
  assert.equal(accepted.headers['Cache-Control'], 'no-store, max-age=0');

  assert.equal(invokeVerification({ token: 'invalid' }).statusCode, 401);
  assert.equal(invokeVerification({ method: 'GET' }).statusCode, 405);
});

test('constant-time text comparison returns the right result', () => {
  assert.equal(safeTextEqual('same value', 'same value'), true);
  assert.equal(safeTextEqual('same value', 'different value'), false);
});

test('session endpoint rejects missing origins and bad passwords', () => {
  assert.equal(invokeSession({ origin: null }).statusCode, 403);
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

test('admin editor assets compile and use the server worker', () => {
  const editorPath = path.join(
    __dirname,
    '..',
    'admin',
    'video-redaction',
    'editor.js',
  );
  const htmlPath = path.join(
    __dirname,
    '..',
    'admin',
    'video-redaction',
    'index.html',
  );
  const editor = fs.readFileSync(editorPath, 'utf8');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.doesNotThrow(() => new Function(editor));
  assert.match(editor, /ocr_every_n_frames:\s*1/);
  assert.match(editor, /Authorization/);
  assert.match(editor, /\/v1\/uploads/);
  assert.match(editor, /sourceFile\.slice/);
  assert.match(editor, /retryDelays/);
  assert.doesNotMatch(editor, /new FormData/);
  assert.match(editor, /server connection problem/i);
  assert.match(html, /automatic deletion within 24 hours/i);
  assert.doesNotMatch(html, /never uploaded|stay on this device/i);
});

test('redaction routes use restrictive response headers', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'),
  );
  const editorHeaders = config.headers.find(
    (item) => item.source === '/admin/video-redaction/:path*',
  );
  const values = new Map(
    editorHeaders.headers.map((header) => [header.key, header.value]),
  );

  assert.match(values.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(values.get('Referrer-Policy'), 'no-referrer');
  assert.equal(values.get('X-Frame-Options'), 'DENY');
});
