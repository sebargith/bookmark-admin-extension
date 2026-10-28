const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createFixture } = require('./helpers/chrome-fixture.cjs');

test('favicon lookup stays on the extension origin and returns bounded image data', async () => {
  const f = createFixture(); const requests = [];
  f.context.btoa = text => Buffer.from(text, 'binary').toString('base64');
  f.find('200').url = 'https://user:secret@example.test/page?q=1#section';
  const png = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-icon', 'icon16.png'));
  f.context.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => png };
  };
  assert.equal(await f.context.getBookmarkFavicon({ id: '200' }), `data:image/png;base64,${png.toString('base64')}`);
  await f.context.getBookmarkFavicon({ id: '200' });
  assert.equal(requests.length, 1);
  const url = new URL(requests[0].url);
  assert.equal(url.origin, 'null');
  assert.equal(url.protocol, 'chrome-extension:');
  assert.equal(url.host, 'fixture');
  assert.equal(url.pathname, '/_favicon/');
  assert.equal(url.searchParams.get('pageUrl'), 'https://example.test/page?q=1');
  assert.equal(url.searchParams.get('size'), '32');
  assert.equal(requests[0].options.credentials, 'omit');
});

test('missing, internal, failed, invalid-type and oversized icons fall back without page requests', async () => {
  for (const mode of ['missing', 'internal', 'malformed', 'failure', 'type', 'oversized']) {
    const f = createFixture(); let requests = 0;
    if (mode === 'internal') f.find('200').url = 'chrome://settings';
    if (mode === 'malformed') f.find('200').url = 'https://%';
    f.context.fetch = async () => {
      requests++;
      if (mode === 'failure') throw new Error('No icon');
      return { ok: true, headers: { get: () => mode === 'type' ? 'text/html' : 'image/png' }, arrayBuffer: async () => new Uint8Array(65537) };
    };
    assert.equal(await f.context.getBookmarkFavicon({ id: mode === 'missing' ? 'missing' : '200' }), null);
    if (['missing', 'internal', 'malformed'].includes(mode)) assert.equal(requests, 0);
  }
});

test('manifest grants favicon lookup without making Chrome favicon history web-accessible', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json')));
  assert.ok(manifest.permissions.includes('favicon'));
  assert.equal(manifest.web_accessible_resources.some(entry => entry.resources.some(resource => resource.includes('_favicon'))), false);
});
