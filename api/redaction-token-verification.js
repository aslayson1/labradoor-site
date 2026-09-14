'use strict';

const { verifyBrowserToken } = require('../lib/redaction-auth');

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

function bearerToken(req) {
  const authorization = firstHeader(req.headers.authorization);
  if (typeof authorization !== 'string') return '';

  const [scheme, token, ...extra] = authorization.trim().split(/\s+/);
  if (
    extra.length > 0 ||
    !scheme ||
    scheme.toLowerCase() !== 'bearer' ||
    !token
  ) {
    return '';
  }
  return token;
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signingKey = process.env.REDACTION_API_KEY || '';
  if (signingKey.length < 16) {
    return res.status(503).json({
      error: 'Redaction session verification is not configured',
    });
  }

  if (!verifyBrowserToken(bearerToken(req), signingKey)) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  return res.status(204).end();
};
