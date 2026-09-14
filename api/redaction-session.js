'use strict';

const {
  MAX_BROWSER_TOKEN_SECONDS,
  mintBrowserToken,
  safeTextEqual,
} = require('../lib/redaction-auth');

const DEFAULT_API_BASE_URL =
  'https://scott-24377--labradoor-video-redaction-redaction-api.modal.run';
const TRUSTED_ORIGINS = new Set([
  'https://labradoor.ai',
  'https://www.labradoor.ai',
  'http://localhost:3000',
  'http://localhost:8080',
]);

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

function isTrustedOrigin(req) {
  const origin = firstHeader(req.headers.origin);
  if (!origin) return false;
  if (TRUSTED_ORIGINS.has(origin)) return true;

  try {
    const parsed = new URL(origin);
    const forwardedHost = firstHeader(req.headers['x-forwarded-host']);
    const requestHost = forwardedHost || firstHeader(req.headers.host);
    return (
      parsed.protocol === 'https:' &&
      parsed.host === requestHost &&
      parsed.hostname.endsWith('.vercel.app')
    );
  } catch {
    return false;
  }
}

function requestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.length <= 2048) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isTrustedOrigin(req)) {
    return res.status(403).json({ error: 'Untrusted request origin' });
  }

  const signingKey = process.env.REDACTION_API_KEY || '';
  const adminPassword = process.env.REDACTION_ADMIN_PASSWORD || '';
  if (signingKey.length < 16 || adminPassword.length < 12) {
    return res.status(503).json({
      error: 'Redaction administration is not configured',
    });
  }

  const suppliedPassword = requestBody(req).password;
  if (
    typeof suppliedPassword !== 'string' ||
    suppliedPassword.length > 512 ||
    !safeTextEqual(suppliedPassword, adminPassword)
  ) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }

  const session = mintBrowserToken(signingKey, {
    ttlSeconds: MAX_BROWSER_TOKEN_SECONDS,
  });
  const apiBaseUrl = (
    process.env.REDACTION_API_BASE_URL || DEFAULT_API_BASE_URL
  ).replace(/\/+$/, '');

  return res.status(200).json({
    token: session.token,
    expiresAt: new Date(session.expiresAt).toISOString(),
    apiBaseUrl,
  });
};
