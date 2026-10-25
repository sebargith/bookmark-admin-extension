const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createFixture, copy } = require("./helpers/chrome-fixture.cjs");
const { chromium } = require(process.env.BOOKMARK_TEST_PLAYWRIGHT || "playwright");

(async () => {
  const fixture = createFixture();
  const artifacts = process.env.BOOKMARK_TEST_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), "bookmark-admin-ui-"));
  fs.mkdirSync(artifacts, { recursive: true });
  const repo = path.resolve(__dirname, "..");
  const baseUrl = pathToFileURL(`${repo}${path.sep}`).href;
  const browser = await chromium.launch({ channel: process.env.BOOKMARK_TEST_CHANNEL || "chrome", headless: true });
  const errors = [];
  let assertions = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: "reduce" });
    await context.exposeBinding("__bookmarkRequest", async (source, type, payload) => {
      if (type === "getCurrentTab") return { ok: true, result: { title: "Sample page", url: "https://example.test" } };
      const commands = { getManagerState: "getManagerState", getState: "getManagedState", createFolder: "createFolder",
        renameNode: "renameNode", bulkMove: "bulkMove", bulkDelete: "bulkDelete", openBookmark: "openBookmark",
        updateMetadata: "updateMetadata", checkLinks: "checkLinks", refreshIndex: "refreshIndex", sortFolder: "sortFolder" };
      try { return { ok: true, result: copy(await fixture.context[commands[type]](payload)) }; }
      catch (error) { return { ok: false, error: error.message }; }
    });
    await context.addInitScript(({ baseUrl }) => {
      const storageListeners = [];
      Object.assign(globalThis.chrome || (globalThis.chrome = {}), {
        runtime: {
          getURL: (asset) => new URL(asset, baseUrl).href,
          sendMessage: (message, reply) => globalThis.__bookmarkRequest(message.type, message.payload).then(reply)
        },
        storage: { onChanged: {
          addListener: (fn) => storageListeners.push(fn),
          removeListener: (fn) => { const index = storageListeners.indexOf(fn); if (index >= 0) storageListeners.splice(index, 1); }
        } }
      });
      globalThis.__bookmarkChange = () => storageListeners.forEach((fn) => fn({ bookmarkRevision: { newValue: Date.now() } }, "local"));
      globalThis.__bookmarkListenerCount = () => storageListeners.length;
    }, { baseUrl });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(new URL("manager.html", baseUrl).href);
    const rows = page.locator(".ba-bookmark-list .ba-bookmark-row");
    const waitRows = (count) => page.waitForFunction((expected) =>
      document.querySelectorAll(".ba-bookmark-list .ba-bookmark-row").length === expected, count);
    const view = async (name) => {
      await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
      assert.equal(await page.getByRole("tab", { name: new RegExp(`^${name}`) }).getAttribute("aria-selected"), "true");
      assertions += 1;
    };
    await waitRows(2);
    const before = copy(fixture.root);
    await page.screenshot({ path: path.join(artifacts, "library-desktop.png"), animations: "disabled" });
    await view("Saved Windows");
    await waitRows(3);
    assert.equal(await page.locator(".ba-folder-tree > li").count(), 2);
    assert.equal(await page.getByRole("button", { name: "New folder", exact: true }).isDisabled(), true);
    await page.screenshot({ path: path.join(artifacts, "windows-desktop.png"), animations: "disabled" });
    await page.locator(".ba-folder-tree .ba-name", { hasText: /^nuevo6$/ }).click();
    await waitRows(2);
    await view("Library");
    await waitRows(2);
    await view("Saved Windows");
    await waitRows(2);
    assert.equal(await page.locator(".ba-list-title").innerText(), "nuevo6");
    await view("All Bookmarks");
    await waitRows(10);
    await page.locator(".ba-search").fill("Mobile page");
    await waitRows(1);
    await view("Library");
    await waitRows(0);
    await page.locator(".ba-search").fill("");
    await waitRows(2);
    await view("All Bookmarks");
    await waitRows(10);
    assert.deepEqual(fixture.root, before);
    assert.deepEqual(fixture.mutations, []);
    assertions += 7;

    await page.getByRole("button", { name: "Options for Managed bookmarks", exact: true }).click();
    assert.equal(await page.locator(".ba-menu button", { hasText: /Delete|Rename|New subfolder|Sort/ }).count(), 0);
    await page.locator(".ba-search").click();
    assertions += 1;
    await page.getByRole("tab", { name: /^Library/ }).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.getByRole("tab", { name: /^Saved Windows/ }).getAttribute("aria-selected"), "true");
    assertions += 1;

    fixture.find("210").title = "Renamed externally";
    await page.evaluate(() => globalThis.__bookmarkChange());
    await page.getByRole("button", { name: "Renamed externally", exact: true }).first().waitFor();
    assert.equal(await page.getByRole("tab", { name: /^Saved Windows/ }).getAttribute("aria-selected"), "true");
    await page.getByRole("button", { name: "All saved windows", exact: false }).click();
    await waitRows(3);
    fixture.find("1").children.push({ id: "140", parentId: "1", title: "nuevo11", children: [
      { id: "240", parentId: "140", title: "New captured tab", url: "https://example.test/new", dateAdded: Date.now() }
    ] });
    await page.evaluate(() => globalThis.__bookmarkChange());
    await waitRows(4);
    assert.equal(await page.locator(".ba-folder-tree > li").count(), 3);
    assertions += 2;

    await page.locator(".ba-folder-tree .ba-name", { hasText: /^nuevo6$/ }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.locator(".ba-menu button", { hasText: /^Export JSON$/ }).click();
    const download = await downloadPromise;
    const downloadedPath = path.join(artifacts, "scoped-export.json");
    await download.saveAs(downloadedPath);
    const exported = JSON.parse(fs.readFileSync(downloadedPath));
    assert.equal(exported.root.id, "110");
    assert.equal(exported.root.children.length, 2);
    assertions += 1;

    page.once("dialog", (dialog) => dialog.accept("Session child"));
    await page.getByRole("button", { name: "New folder", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".ba-list-title").textContent === "Session child");
    assert.equal(fixture.mutations.at(-1).parentId, "110");
    assertions += 1;
    const child = fixture.find("110").children.find((node) => node.title === "Session child");
    fixture.find("110").children = fixture.find("110").children.filter((node) => node.id !== child.id);
    await page.evaluate(() => globalThis.__bookmarkChange());
    await waitRows(4);
    assert.equal(await page.locator(".ba-list-title").innerText(), "Saved Windows");
    assertions += 1;

    for (let index = 0; index < 40; index += 1) {
      fixture.find("111").children.push({ id: `stress-${index}`, parentId: "111", title: `A long bookmark title for checking list readability and safe truncation ${index}`,
        url: `https://example.test/stress/${index}`, dateAdded: Date.now() });
    }
    await page.evaluate(() => globalThis.__bookmarkChange());
    await view("All Bookmarks");
    await waitRows(51);
    await page.screenshot({ path: path.join(artifacts, "all-desktop.png"), animations: "disabled" });
    for (const viewport of [{ width: 1000, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: path.join(artifacts, `all-${viewport.width}.png`), animations: "disabled" });
      const layout = await page.evaluate(() => {
        const win = document.querySelector(".ba-window").getBoundingClientRect();
        const rowRects = [...document.querySelectorAll(".ba-bookmark-list .ba-bookmark-row")].map((node) => node.getBoundingClientRect());
        return {
          inViewport: win.left >= 0 && win.right <= innerWidth && win.bottom <= innerHeight,
          rowOverlap: rowRects.some((rect, index) => index > 0 && rect.top < rowRects[index - 1].bottom),
          horizontalOverflow: [...document.querySelectorAll(".ba-navigation, .ba-toolbar, .ba-bookmark-list")]
            .some((node) => node.scrollWidth > node.clientWidth + 1),
          assetsLoaded: [...document.querySelectorAll("img")].every((node) => node.complete && node.naturalWidth > 0)
        };
      });
      assert.deepEqual(layout, { inViewport: true, rowOverlap: false, horizontalOverflow: false, assetsLoaded: true });
      assertions += 4;
    }

    const overlay = await context.newPage();
    overlay.on("pageerror", (error) => errors.push(error.message));
    await overlay.goto(new URL("popup.html", baseUrl).href);
    await overlay.evaluate(() => { document.documentElement.dataset.bookmarkAdminMode = "standalone"; });
    await overlay.addStyleTag({ path: path.join(repo, "overlay-manager.css") });
    await overlay.addScriptTag({ path: path.join(repo, "overlay-manager.js") });
    await overlay.waitForFunction(() => getComputedStyle(document.getElementById("bookmark-admin-overlay")).visibility === "visible");
    assert.equal(await overlay.locator(".ba-view-tab").count(), 0);
    assert.equal(await overlay.evaluate(() => document.getElementById("bookmark-admin-overlay").shadowRoot), null);
    await overlay.screenshot({ path: path.join(artifacts, "overlay-desktop.png"), animations: "disabled" });
    await overlay.mouse.click(5, 5);
    assert.equal(await overlay.locator("#bookmark-admin-overlay").count(), 0);
    assert.equal(await overlay.evaluate(() => globalThis.__bookmarkListenerCount()), 0);
    await overlay.addScriptTag({ path: path.join(repo, "overlay-manager.js") });
    await overlay.waitForFunction(() => getComputedStyle(document.getElementById("bookmark-admin-overlay")).visibility === "visible");
    await overlay.addScriptTag({ path: path.join(repo, "overlay-manager.js") });
    assert.equal(await overlay.locator("#bookmark-admin-overlay").count(), 0);
    assert.equal(await overlay.evaluate(() => globalThis.__bookmarkListenerCount()), 0);
    assertions += 6;
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ assertions, artifacts, errors, note: "Real Chrome rendering; synthetic Chrome API fixture, isolated from personal data." }));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
