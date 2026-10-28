const assert = require('node:assert/strict');
const test = require('node:test');
const { createFixture } = require('./helpers/chrome-fixture.cjs');
function setup(url = 'https://example.test/new') {
  const f = createFixture();
  f.chrome.tabs.query = (_, cb) => cb([{ id: 5, title: 'Synthetic page', url }]);
  return f;
}
test('popup saves once to native Other bookmarks even with concurrent openings', async () => {
  const f = setup();
  const [a, b] = await Promise.all([f.context.beginPopupSave(), f.context.beginPopupSave()]);
  assert.equal(a.bookmark.parentId, '2'); assert.equal(b.bookmark.id, a.bookmark.id);
  assert.equal(f.mutations.filter(m => m.type === 'create').length, 1);
});
test('folder changes move the same bookmark and reject stale parent or read-only destinations', async () => {
  const f = setup(); const { bookmark } = await f.context.beginPopupSave();
  const p = { id: bookmark.id, url: bookmark.url, expectedParentId: '2', folderId: '400' };
  await assert.rejects(f.context.movePopupBookmark(p), /read-only/);
  const result = await f.context.movePopupBookmark({ ...p, folderId: '102' });
  assert.equal(result.bookmark.id, bookmark.id); assert.equal(f.find(bookmark.id).parentId, '102');
  await assert.rejects(f.context.movePopupBookmark({ ...p, folderId: '101' }), /moved in Chrome/);
});
test('existing bookmarks outside Library are reused without moving', async () => {
  const f = setup('https://example.test/210'); const r = await f.context.beginPopupSave();
  assert.equal(r.bookmark.id, '210'); assert.equal(r.bookmark.parentId, '110'); assert.equal(f.mutations.length, 0);
});
test('localized native roots work and unsupported pages never mutate', async () => {
  const f = setup(); f.find('2').title = 'Otros marcadores';
  assert.equal((await f.context.beginPopupSave()).bookmark.parentId, '2');
  const blocked = setup('chrome://extensions');
  assert.equal((await blocked.context.beginPopupSave()).bookmark, null); assert.equal(blocked.mutations.length, 0);
});
test('managed bookmarks are reused read-only', async () => {
  const f = setup('https://example.test/401');
  assert.equal((await f.context.beginPopupSave()).readOnly, true); assert.equal(f.mutations.length, 0);
});
test('distinct fragments and query strings save the requested full URL', async () => {
  for (const url of ['https://example.test/210#/different-route', 'https://example.test/210?view=other']) {
    const f = setup(url); const result = await f.context.beginPopupSave();
    assert.equal(result.bookmark.url, url); assert.equal(result.bookmark.parentId, '2');
    assert.notEqual(result.bookmark.id, '210');
  }
});
