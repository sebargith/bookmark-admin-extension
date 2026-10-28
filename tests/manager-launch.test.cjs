const assert = require('node:assert/strict');
const test = require('node:test');
const { createFixture } = require('./helpers/chrome-fixture.cjs');

test('manager menu explicitly covers the toolbar action context', async () => {
  const f = createFixture(); const menus = [];
  f.chrome.contextMenus.removeAll = cb => cb();
  f.chrome.contextMenus.create = item => menus.push(item);
  await f.context.initializeExtension();
  const manager = menus.find(item => item.id === 'openBookmarkAdmin');
  assert.ok(manager.contexts.includes('action'));
});

test('toolbar context without a tab still opens the standalone manager', async () => {
  const f = createFixture();
  const opened = new Promise(resolve => {
    f.chrome.tabs.create = (details, cb) => { cb({ id: 9 }); resolve(details); };
  });
  f.listeners.contextMenu[0]({ menuItemId: 'openBookmarkAdmin' });
  assert.equal((await opened).url, 'chrome-extension://fixture/manager.html');
});
