const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.BOOKMARK_TEST_PLAYWRIGHT || 'playwright');

(async () => {
  const repo = path.resolve(__dirname, '..');
  const png = fs.readFileSync(path.join(repo, 'assets/app-icon/icon16.png'));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/favicon.ico' ? 'image/png' : 'text/html');
    res.end(req.url === '/favicon.ico' ? png : '<link rel="icon" href="/favicon.ico"><title>Synthetic favicon test</title>Favicon test');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'bookmark-native-favicon-')), {
      ...(process.env.BOOKMARK_NATIVE_CHROME ? { executablePath: process.env.BOOKMARK_NATIVE_CHROME } : { channel: 'chrome' }), headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging']
    });
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: repo });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
    const url = `http://127.0.0.1:${server.address().port}/`;
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForTimeout(1000);
    const result = await worker.evaluate(async (url) => {
      const bookmark = await chrome.bookmarks.create({ title: 'Synthetic favicon test', url });
      const source = await getBookmarkFavicon({ id: bookmark.id });
      const endpoint = new URL(chrome.runtime.getURL('_favicon/'));
      endpoint.searchParams.set('pageUrl', url); endpoint.searchParams.set('size', '32');
      let diagnostic;
      try {
        const response = await fetch(endpoint);
        diagnostic = { ok: response.ok, type: response.headers.get('content-type'), size: (await response.arrayBuffer()).byteLength };
      } catch (error) { diagnostic = { error: error.message }; }
      return { iconLoaded: Boolean(source), diagnostic, extensionId: chrome.runtime.id, bookmarkId: bookmark.id };
    }, url);
    console.log(JSON.stringify(result));
    assert.equal(result.iconLoaded, true);
    const manager = await context.newPage();
    await manager.goto(`chrome-extension://${result.extensionId}/manager.html`);
    await manager.waitForFunction(id => {
      const icon = document.querySelector(`[data-favicon-id="${id}"]`);
      return icon?.src.startsWith('data:image/png;base64,') && icon.complete && icon.naturalWidth > 0;
    }, result.bookmarkId);
    console.log('Loaded extension manager renders the native favicon.');
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
    await worker.evaluate(async tabId => {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['overlay-manager.css'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay-manager.js'] });
    }, tabId);
    const dom = await context.newCDPSession(page);
    const findIcon = node => {
      const attrs = Object.fromEntries(Array.from({ length: (node.attributes || []).length / 2 }, (_, i) => [node.attributes[i * 2], node.attributes[i * 2 + 1]]));
      if (attrs['data-favicon-id'] === result.bookmarkId) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const found = findIcon(child); if (found) return found; }
    };
    let rendered = false;
    for (let attempt = 0; attempt < 30 && !rendered; attempt++) {
      const tree = await dom.send('DOM.getDocument', { depth: -1, pierce: true });
      const icon = findIcon(tree.root);
      if (icon) {
        const object = await dom.send('DOM.resolveNode', { nodeId: icon.nodeId });
        const probe = await dom.send('Runtime.callFunctionOn', { objectId: object.object.objectId,
          functionDeclaration: 'function() { return this.src.startsWith("data:image/png;base64,") && this.complete && this.naturalWidth > 0; }', returnByValue: true });
        rendered = probe.result.value;
      }
      if (!rendered) await page.waitForTimeout(100);
    }
    assert.equal(rendered, true);
    console.log('Loaded extension overlay renders the native favicon inside its closed shadow root.');
    if (process.env.BOOKMARK_TEST_ARTIFACTS) {
      fs.mkdirSync(process.env.BOOKMARK_TEST_ARTIFACTS, { recursive: true });
      await manager.screenshot({ path: path.join(process.env.BOOKMARK_TEST_ARTIFACTS, 'native-favicon-manager.png') });
      await page.screenshot({ path: path.join(process.env.BOOKMARK_TEST_ARTIFACTS, 'native-favicon-overlay.png') });
    }
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
