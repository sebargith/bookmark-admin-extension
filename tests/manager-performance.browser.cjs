const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createFixture, copy } = require('./helpers/chrome-fixture.cjs');
const { chromium } = require(process.env.BOOKMARK_TEST_PLAYWRIGHT || 'playwright');

(async () => {
  const fixture = createFixture();
  for (let group = 0; group < 60; group++) {
    const id = `perf-folder-${group}`;
    fixture.find('1').children.push({ id, parentId: '1', title: `Reference ${group}`, children: Array.from({ length: 50 }, (_, index) => ({
      id: `perf-${group * 50 + index}`, parentId: id, title: `Reference article ${group * 50 + index}`,
      url: `https://example.test/article/${group * 50 + index}`, dateAdded: Date.UTC(2026, 9, 1) + group * 50 + index
    })) });
  }
  const repo = path.resolve(__dirname, '..');
  const baseUrl = pathToFileURL(`${repo}${path.sep}`).href;
  const artifacts = process.env.BOOKMARK_TEST_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), 'bookmark-perf-'));
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  let faviconRequests = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const icon = `data:image/png;base64,${fs.readFileSync(path.join(repo, 'assets/app-icon/icon16.png')).toString('base64')}`;
    await context.exposeBinding('__bookmarkRequest', async (_, type, payload) => {
      if (type === 'getBookmarkFavicon') { faviconRequests++; return { ok: true, result: icon }; }
      return { ok: true, result: copy(await fixture.context[type](payload)) };
    });
    await context.addInitScript(({ baseUrl }) => {
      globalThis.chrome = {
        runtime: {
          getURL: asset => new URL(asset, baseUrl).href,
          sendMessage: (message, reply) => globalThis.__bookmarkRequest(message.type, message.payload).then(reply)
        },
        storage: { onChanged: { addListener() {}, removeListener() {} } }
      };
    }, { baseUrl });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const started = performance.now();
    await page.goto(new URL('manager.html', baseUrl).href);
    await page.waitForFunction(() => document.querySelector('.ba-list-count')?.textContent === '3010 shown');
    await page.locator('.ba-bookmark-list .ba-bookmark-title').first().waitFor();
    const startupMs = performance.now() - started;
    await page.waitForTimeout(500);
    if (!process.env.BOOKMARK_PERF_BASELINE) assert.equal(await page.locator('.ba-window').evaluate(node => {
      const bounds = node.getBoundingClientRect();
      return bounds.left >= 12 && bounds.top >= 12 && bounds.right <= innerWidth - 12 && bounds.bottom <= innerHeight - 12;
    }), true, 'Opening animation must not shift the manager outside the viewport');
    const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    if (process.env.BOOKMARK_PERF_TRACE) await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReturnAsStream' });
    await page.evaluate(() => {
      globalThis.__frames = [];
      globalThis.__recordFrames = true;
      let last = performance.now();
      const sample = now => { globalThis.__frames.push(now - last); last = now; if (globalThis.__recordFrames) requestAnimationFrame(sample); };
      requestAnimationFrame(sample);
    });
    const bounds = await page.locator('.ba-bookmark-list').boundingBox();
    for (let index = 0; index < 100; index++) await page.mouse.move(bounds.x + 160, bounds.y + 15 + (index % 25) * 30);
    const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    if (process.env.BOOKMARK_PERF_TRACE) {
      const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
      await cdp.send('Tracing.end');
      const { stream } = await complete;
      let data = '';
      while (true) { const chunk = await cdp.send('IO.read', { handle: stream }); data += chunk.data; if (chunk.eof) break; }
      await cdp.send('IO.close', { handle: stream });
      fs.writeFileSync(path.join(artifacts, 'hover-trace.json'), data);
      const durations = new Map();
      for (const event of JSON.parse(data).traceEvents) if (event.ph === 'X') durations.set(event.name, (durations.get(event.name) || 0) + (event.dur || 0) / 1000);
      console.log(JSON.stringify({ trace: [...durations].sort((a, b) => b[1] - a[1]).slice(0, 15) }));
    }
    const hover = await page.evaluate(() => {
      globalThis.__recordFrames = false;
      const frames = globalThis.__frames.slice(1).sort((a, b) => a - b);
      return { frameP95Ms: frames[Math.floor(frames.length * 0.95)], maxFrameMs: Math.max(...frames) };
    });
    const iconRequestsBeforeSelection = faviconRequests;
    const selection = await page.evaluate(async () => {
      const list = document.querySelector('.ba-bookmark-list');
      const row = list.querySelector('.ba-bookmark-row');
      let replaced = 0;
      const observer = new MutationObserver(records => { replaced += records.filter(record => record.type === 'childList').length; });
      observer.observe(list, { childList: true, subtree: true });
      const start = performance.now();
      row.querySelector('.ba-select-bookmark').click();
      const syncMs = performance.now() - start;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      observer.disconnect();
      return { syncMs, toFrameMs: performance.now() - start, rowReused: row === list.querySelector('.ba-bookmark-row'), replaced,
        checked: list.querySelector('.ba-select-bookmark').checked };
    });
    if (!process.env.BOOKMARK_PERF_BASELINE) {
      assert.equal(selection.rowReused, true);
      assert.equal(selection.replaced, 0);
      assert.equal(selection.checked, true);
      assert.ok(faviconRequests <= iconRequestsBeforeSelection + 2);
    }
    await page.locator('.ba-selection-clear').click();
    await page.locator('.ba-select-all').check();
    assert.equal(await page.locator('.ba-select-bookmark:checked').count(), 3010);
    assert.equal(await page.getByRole('button', { name: 'Delete', exact: true }).isDisabled(), true);
    await page.locator('.ba-selection-clear').click();
    assert.equal(await page.locator('.ba-select-bookmark:checked').count(), 0);
    await page.locator('.ba-search').fill('Reference article 2999');
    await page.waitForFunction(() => document.querySelectorAll('.ba-bookmark-row').length === 1);
    assert.equal(await page.locator('.ba-bookmark-row').getAttribute('data-bookmark-id'), 'perf-2999');
    await page.locator('.ba-search').fill('');
    await page.waitForFunction(() => document.querySelectorAll('.ba-bookmark-row').length === 3010);
    const totalHeight = await page.locator('.ba-bookmark-list').evaluate(list => list.scrollHeight);
    for (const fraction of [0.25, 0.5, 0.75, 1, 0]) {
      await page.locator('.ba-bookmark-list').evaluate((list, fraction) => {
        list.scrollTop = (list.scrollHeight - list.clientHeight) * fraction;
      }, fraction);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('.ba-bookmark-list').evaluate(list => list.scrollHeight), totalHeight);
      assert.equal(await page.locator('.ba-bookmark-list').evaluate(list => {
        const bounds = list.getBoundingClientRect();
        const row = document.elementFromPoint(bounds.left + 150, bounds.top + 60)?.closest('.ba-bookmark-row');
        return Boolean(row?.querySelector('.ba-bookmark-title')?.getBoundingClientRect().width);
      }), true);
    }
    await page.locator('.ba-bookmark-title').last().focus();
    assert.equal(await page.locator('.ba-bookmark-title').last().evaluate(node => {
      const row = node.getBoundingClientRect(), list = node.closest('.ba-bookmark-list').getBoundingClientRect();
      return row.top >= list.top && row.bottom <= list.bottom;
    }), true);
    await page.screenshot({ path: path.join(artifacts, 'large-library-bottom.png') });
    assert.deepEqual(errors, []);
    const result = { startupMs, hover: { ...hover, taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
      styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000, layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000 }, selection };
    fs.writeFileSync(path.join(artifacts, process.env.BOOKMARK_PERF_BASELINE ? 'baseline.json' : 'optimized.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
