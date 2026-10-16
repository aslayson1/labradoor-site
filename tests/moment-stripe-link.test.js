const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('business.html', 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
const UUID = '13a57885-8709-44d8-9de1-b3d0d4b4f167';
const POST = '3a7c45e2-b48b-4f20-9b40-1b30d8f1cf53';
const token = `v1.${UUID}.${POST}.${'A'.repeat(43)}`;
const link = 'https://buy.stripe.com/00wfZi93f2Pc4Zx6ZE9Ve01';

function runOnSite(search) {
  const store = new Map();
  const anchors = [
    { href: link },
    { href: 'https://app.labradoor.ai/signup' },
    { href: 'https://evil.example/' },
  ];
  const window = {
    location: { search, origin: 'https://labradoor.ai' },
    sessionStorage: {
      setItem: (k,v) => store.set(k,v),
      getItem: k => store.get(k)||null,
      removeItem: k => store.delete(k),
    },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
  };
  const context = { window, document: { querySelectorAll: () => anchors },
    URL, URLSearchParams, Date };
  vm.runInNewContext(script, context, { timeout: 1000 });
  return { anchors, store };
}
test('signed-looking Moment referral is preserved in a Stripe-compatible URL', () => {
  const result = runOnSite('?mref='+encodeURIComponent(token));
  const stripe = new URL(result.anchors[0].href);
  const value = stripe.searchParams.get('client_reference_id');
  assert.ok(value.startsWith('mref_'));
  assert.ok(value.length <= 200);
  assert.match(value, /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(value.slice(5), 'base64url').toString('ascii'), token);
  assert.equal(new URL(result.anchors[1].href).searchParams.get('mref'), token);
  assert.equal(result.anchors[2].href, 'https://evil.example/');
});
test('invalid inbound referral does not modify checkout URL', () => {
  const result = runOnSite('?mref='+encodeURIComponent('v1.forged.evil'));
  assert.equal(result.anchors[0].href, link);
  assert.equal(result.anchors[1].href, 'https://app.labradoor.ai/signup');
});


test('Business recovery link points to first-party activation without payment identifiers', () => {
  assert.match(html, /href="https:\/\/api\.labradoor\.ai\/subscription\/claim"/);
  assert.match(html, /Activate your Business access/);
  assert.doesNotMatch(html, /api\.labradoor\.ai\/subscription\/claim\?[^"']+(?:session|token|password|mref)=/);
});
