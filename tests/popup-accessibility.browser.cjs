const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { chromium } = require(process.env.BOOKMARK_TEST_PLAYWRIGHT || 'playwright');
const { createFixture } = require('./helpers/chrome-fixture.cjs');

test('real popup saves, moves and creates folders through the actual worker with synthetic Chrome data', async () => {
  const f = createFixture();
  let url = 'https://example.test/popup-new';
  f.chrome.tabs.query = (_, cb) => cb([{ id: 5, title: 'A long synthetic page title '.repeat(20), url }]);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 360, height: 600 } });
    await context.exposeFunction('requestBookmarkWorker', (message) => new Promise((resolve) => {
      f.listeners.message[0](message, { url: 'chrome-extension://fixture/popup.html' }, resolve);
    }));
    await context.addInitScript(() => {
      Object.assign(globalThis.chrome || (globalThis.chrome = {}), { runtime: {
        sendMessage: (message, cb) => requestBookmarkWorker(message).then(cb)
      } });
    });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const popup = pathToFileURL(path.resolve(__dirname, '..', 'popup.html')).href;
    await page.goto(popup);
    await page.waitForFunction(() => document.querySelector('#saveFeedback').textContent === 'Bookmark saved');
    assert.equal(await page.locator('#saveFolder').inputValue(), '2');
    const created = f.mutations.find(m => m.type === 'create' && m.url === url);
    assert.ok(created); const bookmark = f.find('1000');
    assert.equal(await page.locator('#folderPicker').isVisible(), false);
    await page.click('#chooseFolder');
    await page.fill('#folderSearch', 'Research');
    assert.equal(await page.locator('#saveFolder option').count(), 1);
    await page.selectOption('#saveFolder', '102');
    await page.waitForFunction(() => document.querySelector('#saveFeedback').textContent === 'Bookmark moved');
    assert.equal(f.find(bookmark.id).parentId, '102');
    assert.equal(await page.locator('#folderPicker').isVisible(), false);
    assert.equal(await page.locator('#chooseFolder').evaluate(el => el === document.activeElement), true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#saveFeedback').textContent === 'Already bookmarked');
    assert.equal(await page.locator('#saveFolder').inputValue(), '102');
    assert.equal(f.mutations.filter(m => m.type === 'create' && m.url === url).length, 1);
    await page.click('#chooseFolder');
    assert.match(await page.locator('#recentFolderList').innerText(), /Research/);
    await page.fill('#folderSearch', 'NoSuchFolder');
    assert.equal(await page.locator('#folderEmpty').isVisible(), true);
    assert.equal(await page.locator('#saveFolder option').count(), 0);
    await page.click('#createFolderMini'); await page.fill('#folderName', 'Synthetic child');
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#folderForm').hidden);
    assert.equal(f.find(f.find(bookmark.id).parentId).title, 'Synthetic child');
    await page.click('#chooseFolder');
    await page.locator('#recentFolderList').getByRole('button', { name: 'Research', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#folderPicker').hidden);
    assert.equal(f.find(bookmark.id).parentId, '102');
    await page.click('#chooseFolder');
    await page.locator('#saveFolder').focus();
    const movesBeforeKeys = f.mutations.filter(m => m.type === 'move').length;
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#folderPicker').isVisible(), true);
    assert.equal(f.mutations.filter(m => m.type === 'move').length, movesBeforeKeys);
    const keyboardDestination = await page.locator('#saveFolder').inputValue();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#folderPicker').hidden);
    assert.equal(f.find(bookmark.id).parentId, keyboardDestination);
    await page.click('#chooseFolder');
    await page.locator('#saveFolder').focus();
    await page.keyboard.press('Home');
    const mouseDestination = await page.locator('#saveFolder').inputValue();
    await page.locator(`#saveFolder option[value="${mouseDestination}"]`).click();
    await page.waitForFunction(() => document.querySelector('#folderPicker').hidden);
    assert.equal(f.find(bookmark.id).parentId, mouseDestination);
    assert.equal(await page.locator('img').evaluateAll(imgs => imgs.every(im => im.complete && im.naturalWidth > 0)), true);
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    for (const id of ['chooseFolder', 'saveAllWindows', 'openManager']) {
      await page.locator(`#${id}`).focus();
      assert.equal(await page.locator(`#${id}`).evaluate(el => getComputedStyle(el).outlineWidth), '3px');
    }
    const artifacts = process.env.BOOKMARK_TEST_ARTIFACTS;
    if (artifacts) {
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ path: path.join(artifacts, 'popup-one-click.png') });
      await page.click('#chooseFolder');
      await page.screenshot({ path: path.join(artifacts, 'popup-folder-picker.png') });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#folderPicker').isVisible(), false);
    }
    await page.setViewportSize({ width: 180, height: 600 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 360);
    await page.setViewportSize({ width: 360, height: 600 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok(await page.locator('.mini-shell').evaluate(el => el.getBoundingClientRect().height < 600));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('#openManager').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    url = 'chrome://extensions'; await page.reload();
    await page.waitForFunction(() => document.querySelector('#currentPageMini').textContent.includes('cannot be saved'));
    assert.equal(await page.locator('#saveFolder').isDisabled(), true);
    assert.equal(await page.locator('#createFolderMini').isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
