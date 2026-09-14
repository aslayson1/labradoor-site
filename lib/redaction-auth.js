'use strict';

const crypto = require('node:crypto');

const TOKEN_VERSION = 'v1';
const TOKEN_AUDIENCE = 'labradoor-redaction';
const MAX_BROWSER_TOKEN_SECONDS = 4 * 60 * 60;
const CLOCK_SKEW_SECONDS = 60;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new Error('Invalid base64url value');
  }

  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new Error('Non-canonical base64url value');
  }
  return decoded;
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

function verifyBrowserToken(
  token,
  secret,
  { now = Math.floor(Date.now() / 1000) } = {},
) {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 4096 ||
    typeof secret !== 'string' ||
    secret.length < 16
  ) {
    return false;
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return false;

    const [version, payloadSegment, signatureSegment] = parts;
    const suppliedSignature = decodeBase64Url(signatureSegment);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${version}.${payloadSegment}`, 'ascii')
      .digest();
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return false;
    }

    const payload = JSON.parse(decodeBase64Url(payloadSegment).toString('utf8'));
    if (
      !payload ||
      typeof payload !== 'object' ||
      payload.aud !== TOKEN_AUDIENCE ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      typeof payload.nonce !== 'string' ||
      payload.nonce.length === 0 ||
      payload.nonce.length > 128
    ) {
      return false;
    }
    if (
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > MAX_BROWSER_TOKEN_SECONDS ||
      payload.iat > now + CLOCK_SKEW_SECONDS
    ) {
      return false;
    }
    return payload.exp > now;
  } catch {
    return false;
  }
}

module.exports = {
  CLOCK_SKEW_SECONDS,
  MAX_BROWSER_TOKEN_SECONDS,
  TOKEN_AUDIENCE,
  TOKEN_VERSION,
  mintBrowserToken,
  safeTextEqual,
  verifyBrowserToken,
};
