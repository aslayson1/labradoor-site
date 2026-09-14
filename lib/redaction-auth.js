'use strict';

const crypto = require('node:crypto');

const TOKEN_VERSION = 'v1';
const TOKEN_AUDIENCE = 'labradoor-redaction';
const MAX_BROWSER_TOKEN_SECONDS = 4 * 60 * 60;

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeTextEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left)).digest();
  const rightDigest = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function mintBrowserToken(
  secret,
  {
    ttlSeconds = MAX_BROWSER_TOKEN_SECONDS,
    now = Math.floor(Date.now() / 1000),
    nonce = crypto.randomBytes(18).toString('base64url'),
  } = {},
) {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('A valid signing secret is required');
  }
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 60 ||
    ttlSeconds > MAX_BROWSER_TOKEN_SECONDS
  ) {
    throw new Error('Browser token lifetime is invalid');
  }
  if (typeof nonce !== 'string' || nonce.length === 0 || nonce.length > 128) {
    throw new Error('Browser token nonce is invalid');
  }

  const issuedAt = Math.trunc(now);
  const payload = JSON.stringify({
    aud: TOKEN_AUDIENCE,
    exp: issuedAt + ttlSeconds,
    iat: issuedAt,
    nonce,
  });
  const payloadSegment = encodeBase64Url(payload);
  const signedValue = `${TOKEN_VERSION}.${payloadSegment}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedValue, 'ascii')
    .digest('base64url');

  return {
    token: `${signedValue}.${signature}`,
    expiresAt: (issuedAt + ttlSeconds) * 1000,
  };
}

module.exports = {
  MAX_BROWSER_TOKEN_SECONDS,
  TOKEN_AUDIENCE,
  TOKEN_VERSION,
  mintBrowserToken,
  safeTextEqual,
};
