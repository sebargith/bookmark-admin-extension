const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createFixture, copy } = require("./helpers/chrome-fixture.cjs");
const { chromium } = require(process.env.BOOKMARK_TEST_PLAYWRIGHT || "playwright");

(async () => {
  const fixture = createFixture();
  fixture.find("214").title = "";
  fixture.storage.metadataByUrl = {
    "https://example.test/200": {
      notes: "Synthetic notes retained outside the compact list", useCount: 12,
      autoTags: ["autokeywordforsearch", "a-long-generated-keyword-that-must-not-enlarge-the-bookmark-row"],
      deadStatus: { state: "warning", code: 403, message: "Reachable but restricted" }
    },
    "https://example.test/201": { deadStatus: { state: "ok", code: 200 } },
    "https://example.test/210": { deadStatus: { state: "dead", message: "Timed out" } }
  };
  const artifacts = process.env.BOOKMARK_TEST_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), "bookmark-admin-ui-"));
  fs.mkdirSync(artifacts, { recursive: true });
  const repo = path.resolve(__dirname, "..");
  const baseUrl = pathToFileURL(`${repo}${path.sep}`).href;
  const browser = await chromium.launch({ channel: process.env.BOOKMARK_TEST_CHANNEL || "chrome", headless: true });
  const errors = [];
  let rejectNotes = false;
  let holdNotes = null;
  let holdManagerRead = null;
  let managerReads = 0;
  let assertions = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: "reduce" });
    await context.exposeBinding("__bookmarkRequest", async (source, type, payload) => {
      if (type === "getCurrentTab") return { ok: true, result: { title: "Sample page", url: "https://example.test" } };
      const commands = { getManagerState: "getManagerState", saveManagerNavigation: "saveManagerNavigation", getState: "getManagedState", createFolder: "createFolder",
        renameNode: "renameNode", bulkMove: "bulkMove", bulkDelete: "bulkDelete", openBookmark: "openBookmark",
        updateMetadata: "updateMetadata", checkLinks: "checkLinks", refreshIndex: "refreshIndex", sortFolder: "sortFolder",
        buildExport: "buildExport", openExportPage: "openExportPage" };
      Object.assign(commands, { reopenSavedWindow: "reopenSavedWindow", moveSavedItemsToLibrary: "moveSavedItemsToLibrary", undoLast: "undoLast" });
      try {
        if (type === "updateMetadata") {
          if (rejectNotes) throw new Error("Simulated storage failure");
          const gate = holdNotes;
          if (gate) await gate;
        }
        const result = copy(await fixture.context[commands[type]](payload));
        if (type === "getManagerState") {
          managerReads += 1;
          const gate = holdManagerRead;
          if (gate) {
            await source.frame.evaluate(() => { globalThis.__managerReadHeld = true; });
            await gate;
          }
        }
        return { ok: true, result };
      }
      catch (error) { return { ok: false, error: error.message }; }
    });
    await context.addInitScript(({ baseUrl }) => {
      const storageListeners = [];
      Object.assign(globalThis.chrome || (globalThis.chrome = {}), {
        runtime: {
          getURL: (asset) => new URL(asset, baseUrl).href,
          sendMessage: (message, reply) => {
            if (message.type === "updateMetadata") globalThis.__noteRequestCount = (globalThis.__noteRequestCount || 0) + 1;
            return globalThis.__bookmarkRequest(message.type, message.payload).then((response) => {
              reply(response);
              if (message.type === "getManagerState") globalThis.__managerReplies = (globalThis.__managerReplies || 0) + 1;
              if (message.type === "updateMetadata") globalThis.__noteReplies = (globalThis.__noteReplies || 0) + 1;
              if (message.type === "saveManagerNavigation") globalThis.__navigationReplies = (globalThis.__navigationReplies || 0) + 1;
            });
          }
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
    const quickSaveSettings = copy(fixture.storage.settings);
    const navigate = async (action) => {
      const replies = await page.evaluate(() => globalThis.__navigationReplies || 0);
      await action();
      await page.waitForFunction((before) => (globalThis.__navigationReplies || 0) > before, replies);
    };
    await navigate(() => page.locator('[data-folder-id="102"] .ba-name').click());
    await waitRows(1);
    assert.equal(await page.locator('.ba-breadcrumbs [aria-current="location"]').innerText(), "Research");
    await navigate(() => page.locator('[data-folder-id="101"] .ba-disclosure').click());
    assert.equal(await page.locator(".ba-list-title").innerText(), "Research");
    assert.equal(await page.locator('[data-folder-id="101"] .ba-disclosure').evaluate((node) => node === document.activeElement), true);
    await navigate(() => view("Saved Windows"));
    await navigate(() => page.locator('[data-folder-id="110"] .ba-name').click());
    const branch = { id: "nav-0", parentId: "111", title: "Archive", children: [] };
    fixture.find("111").children.push(branch);
    let leaf = branch;
    for (let depth = 1; depth <= 8; depth += 1) {
      const child = { id: `nav-${depth}`, parentId: leaf.id, title: `Deep folder ${depth} with a long descriptive name`, children: [] };
      leaf.children.push(child);
      leaf = child;
    }
    await page.evaluate(() => globalThis.__bookmarkChange());
    await page.waitForFunction(() => globalThis.__managerReplies >= 2);
    await navigate(() => view("All Bookmarks"));
    await navigate(() => page.getByRole("button", { name: "Expand all folders", exact: true }).click());
    await page.locator('[data-folder-id="nav-8"]').waitFor();
    assert.equal(await page.locator('[data-folder-id="nav-8"] .ba-disclosure').isDisabled(), true);
    await navigate(() => page.locator('[data-folder-id="nav-8"] .ba-name').click());
    assert.equal(await page.locator(".ba-breadcrumbs button").count(), 12);
    const crumbBounds = await page.locator(".ba-breadcrumbs > button").boundingBox();
    const trailBounds = await page.locator(".ba-breadcrumb-trail").boundingBox();
    assert.ok(crumbBounds.x + crumbBounds.width <= trailBounds.x);
    assert.ok(await page.locator(".ba-breadcrumb-trail").evaluate((node) => node.scrollWidth > node.clientWidth && node.scrollLeft > 0));
    assert.ok(await page.locator('[data-folder-id="nav-8"] .ba-name').evaluate((node) => node.getBoundingClientRect().width > 70));
    assert.equal(await page.locator(".ba-layout").evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
    await page.screenshot({ path: path.join(artifacts, "hierarchy-deep.png"), animations: "disabled" });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.ba-breadcrumbs [aria-current="location"]')?.textContent.startsWith("Deep folder 8"));
    assert.equal(await page.getByRole("tab", { name: /^All Bookmarks/ }).getAttribute("aria-selected"), "true");
    assert.equal(await page.locator('[data-folder-id="nav-0"] .ba-disclosure').getAttribute("aria-expanded"), "true");
    assert.equal(fixture.storage.managerNavigation.selectedByView.library, "102");
    assert.equal(fixture.storage.managerNavigation.selectedByView.windows, "110");
    await page.locator('.ba-breadcrumbs [aria-current="location"]').focus();
    leaf.title = "Renamed externally, same folder";
    await page.evaluate(() => globalThis.__bookmarkChange());
    await page.locator('.ba-breadcrumbs [aria-current="location"]').filter({ hasText: /^Renamed externally/ }).waitFor();
    assert.equal(await page.locator('.ba-breadcrumbs [aria-current="location"]').evaluate((node) => node === document.activeElement), true);
    assert.equal(fixture.storage.managerNavigation.selectedByView.all, "nav-8");
    await navigate(() => page.getByRole("button", { name: "Collapse all folders", exact: true }).click());
    assert.equal(await page.locator(".ba-folder-line").count(), 5);
    assert.equal(await page.locator(".ba-list-title").innerText(), leaf.title);
    await navigate(() => page.locator(".ba-breadcrumbs button").filter({ hasText: /^Archive$/ }).click());
    assert.equal(await page.locator(".ba-list-title").innerText(), "Archive");
    assert.equal(await page.locator('.ba-breadcrumbs [aria-current="location"]').evaluate((node) => node === document.activeElement), true);
    await page.locator('[data-folder-id="nav-0"] .ba-name').focus();
    fixture.find("111").children = fixture.find("111").children.filter((node) => node.id !== "nav-0");
    await page.evaluate(() => globalThis.__bookmarkChange());
    await waitRows(10);
    assert.equal(await page.locator(".ba-list-title").innerText(), "All Bookmarks");
    assert.equal(await page.locator('[data-folder-id="111"] .ba-name').evaluate((node) => node === document.activeElement), true);
    assert.equal(fixture.storage.managerNavigation.expanded.some((id) => id.startsWith("nav-")), false);
    assert.deepEqual(fixture.storage.settings, quickSaveSettings);
    await navigate(() => view("Library"));
    await waitRows(1);
    assert.equal(await page.locator(".ba-list-title").innerText(), "Research");
    await navigate(() => page.getByRole("button", { name: /^All in Library/ }).click());
    await navigate(() => page.getByRole("button", { name: "Collapse all folders", exact: true }).click());
    await navigate(() => view("Saved Windows"));
    await navigate(() => page.getByRole("button", { name: /^All saved windows/ }).click());
    await navigate(() => view("Library"));
    await waitRows(2);
    assertions += 25;
    fixture.storage.managerNavigation = { view: "windows", selectedByView: { library: "200", windows: "130", all: "missing" }, expanded: ["200", "missing", "1"] };
    await page.reload();
    await waitRows(3);
    assert.equal(await page.locator(".ba-list-title").innerText(), "Saved Windows");
    assert.equal(await page.locator(".ba-overview").getAttribute("aria-pressed"), "true");
    await navigate(() => view("Library"));
    await waitRows(2);
    await navigate(() => page.locator('[data-folder-id="102"] .ba-name').click());
    assert.equal(await page.locator('[data-folder-id="102"] .ba-name').evaluate((node) => node === document.activeElement), true);
    const research = fixture.find("102");
    fixture.find("100").children = fixture.find("100").children.filter((node) => node.id !== "102");
    fixture.find("111").children.push(research);
    research.parentId = "111";
    await page.evaluate(() => globalThis.__bookmarkChange());
    await page.waitForFunction(() => document.querySelector(".ba-list-title").textContent === "Library");
    await waitRows(1);
    assert.equal(fixture.storage.managerNavigation.selectedByView.library, null);
    assert.equal(await page.locator(".ba-overview").evaluate((node) => node === document.activeElement), true);
    await navigate(() => view("All Bookmarks"));
    await navigate(() => page.getByRole("button", { name: "Expand all folders", exact: true }).click());
    await navigate(() => page.locator('[data-folder-id="102"] .ba-name').click());
    assert.match(await page.locator(".ba-breadcrumbs").innerText(), /Reference/);
    fixture.find("111").children = fixture.find("111").children.filter((node) => node.id !== "102");
    fixture.find("100").children.push(research);
    research.parentId = "100";
    await page.evaluate(() => globalThis.__bookmarkChange());
    await page.locator(".ba-breadcrumbs button").filter({ hasText: /^Other bookmarks$/ }).waitFor();
    assert.doesNotMatch(await page.locator(".ba-breadcrumbs").innerText(), /Reference/);
    assert.equal(fixture.storage.managerNavigation.selectedByView.all, "102");
    await navigate(() => page.locator(".ba-breadcrumbs button").filter({ hasText: /^All Bookmarks$/ }).click());
    await navigate(() => view("Library"));
    await navigate(() => page.getByRole("button", { name: "Collapse all folders", exact: true }).click());
    await waitRows(2);
    assertions += 8;
    const beforeCaptureWorkflows = copy(fixture.root);
    const captureSaveSettings = copy(fixture.storage.settings);
    await view("Saved Windows");
    await waitRows(3);
    assert.match(await page.locator('[data-folder-id="110"] .ba-folder-meta').innerText(), /2 tabs.*Folder created/);
    await page.locator('[data-folder-id="110"] .ba-name').click();
    await waitRows(2);
    assert.match(await page.locator(".ba-capture-bar").innerText(), /2 tabs/);
    const actionDialog = page.locator(".ba-action-dialog");
    const openCapture = () => page.locator(".ba-capture-bar").getByRole("button", { name: "Open window", exact: true }).click();
    await openCapture();
    await actionDialog.waitFor();
    assert.equal(await actionDialog.getAttribute("aria-modal"), "true");
    assert.equal(await page.locator(".ba-layout").evaluate((node) => node.inert), true);
    for (const key of ["Tab", "Shift+Tab"]) for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press(key);
      assert.equal(await actionDialog.evaluate((node) => node.contains(document.activeElement)), true);
    }
    await actionDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await actionDialog.waitFor({ state: "hidden" });
    assert.equal(fixture.windowsCreated.length, 0);
    const createWindow = fixture.chrome.windows.create;
    fixture.chrome.windows.create = () => { throw new Error("Simulated window failure"); };
    await openCapture();
    await actionDialog.getByRole("button", { name: "Open window", exact: true }).click();
    await actionDialog.locator(".ba-action-error").filter({ hasText: /Simulated window failure/ }).waitFor();
    fixture.chrome.windows.create = createWindow;
    await actionDialog.getByRole("button", { name: "Open window", exact: true }).click();
    await actionDialog.waitFor({ state: "hidden" });
    assert.deepEqual(fixture.windowsCreated[0].url, ["https://example.test/210", "https://example.test/211"]);
    await page.locator('[data-folder-id="110"] .ba-icon-btn').click();
    await page.locator(".ba-menu button", { hasText: /^Rename$/ }).click();
    await actionDialog.getByRole("textbox", { name: "Capture name", exact: true }).fill("Design research session");
    await page.screenshot({ path: path.join(artifacts, "capture-rename.png"), animations: "disabled" });
    await actionDialog.getByRole("button", { name: "Rename", exact: true }).click();
    await actionDialog.waitFor({ state: "hidden" });
    await page.locator(".ba-list-title").filter({ hasText: /^Design research session$/ }).waitFor();
    assert.equal(await page.getByRole("tab", { name: /^Saved Windows/ }).getAttribute("aria-selected"), "true");
    await page.locator(".ba-undo").click();
    await page.locator(".ba-list-title").filter({ hasText: /^nuevo6$/ }).waitFor();
    await page.locator('.ba-bookmark-list [data-bookmark-id="210"] .ba-icon-btn').click();
    await page.locator(".ba-menu button", { hasText: /^Move to Library$/ }).click();
    await actionDialog.getByRole("combobox", { name: "Destination folder", exact: true }).selectOption("102");
    assert.deepEqual(await actionDialog.locator("select option").evaluateAll((items) => items.map((item) => item.value)), ["100", "101", "102"]);
    await actionDialog.getByRole("button", { name: "Move", exact: true }).click();
    await actionDialog.waitFor({ state: "hidden" });
    await waitRows(1);
    assert.equal(fixture.find("210").parentId, "102");
    assert.equal(fixture.find("211").parentId, "110");
    await page.locator(".ba-undo").click();
    await waitRows(2);
    await page.locator(".ba-capture-bar").getByRole("button", { name: "Move to Library", exact: true }).click();
    await actionDialog.getByRole("combobox", { name: "Destination folder", exact: true }).selectOption("102");
    await page.screenshot({ path: path.join(artifacts, "capture-move.png"), animations: "disabled" });
    await actionDialog.getByRole("button", { name: "Move", exact: true }).click();
    await actionDialog.waitFor({ state: "hidden" });
    await waitRows(0);
    assert.equal(fixture.find("110").children.length, 0);
    assert.match(await page.locator(".ba-capture-bar").innerText(), /0 tabs/);
    await page.locator(".ba-undo").click();
    await waitRows(2);
    await openCapture();
    const oldUrl = fixture.find("211").url;
    fixture.find("211").url = "https://example.test/changed-before-confirmation";
    await page.evaluate(() => globalThis.__bookmarkChange());
    await actionDialog.getByRole("button", { name: "Open window", exact: true }).click();
    await actionDialog.locator(".ba-action-error").filter({ hasText: /capture changed/ }).waitFor();
    assert.equal(fixture.windowsCreated.length, 1);
    await page.keyboard.press("Escape");
    await actionDialog.waitFor({ state: "hidden" });
    assert.equal(await page.locator(".ba-layout").evaluate((node) => node.inert), false);
    fixture.find("211").url = oldUrl;
    fixture.storage.savedWindows["110"] = { capturedAt: Date.UTC(2026, 9, 25, 12), originalTabCount: 2 };
    await page.evaluate(() => globalThis.__bookmarkChange());
    await page.locator('[data-folder-id="110"] .ba-folder-meta').filter({ hasText: /Captured/ }).waitFor();
    await page.screenshot({ path: path.join(artifacts, "capture-desktop.png"), animations: "disabled" });
    assert.deepEqual(fixture.root, beforeCaptureWorkflows);
    assert.deepEqual(fixture.storage.settings, captureSaveSettings);
    fixture.mutations.length = 0;
    await page.getByRole("button", { name: /^All saved windows/ }).click();
    await waitRows(3);
    await view("Library");
    await waitRows(2);
    assertions += 26;
    assert.equal(await page.locator(".ba-detail").isVisible(), false);
    const fullListWidth = (await page.locator(".ba-bookmark-list").boundingBox()).width;
    const before = copy(fixture.root);
    assert.equal(await rows.locator(".ba-pill").count(), 0);
    assert.equal(await rows.locator('.ba-row-status[role="img"]').count(), 1);
    assert.match(await rows.first().locator(".ba-bookmark-title").getAttribute("title"), /https:\/\/example.test\/200/);
    assert.equal(await rows.first().locator("time").getAttribute("datetime"), new Date(fixture.find("200").dateAdded).toISOString());
    assert.ok((await rows.first().locator("time").getAttribute("title")).length > 15);
    const initialGeometry = await rows.evaluateAll((items) => items.map((row) => ({
      height: row.getBoundingClientRect().height,
      titleWidth: row.querySelector(".ba-bookmark-title").getBoundingClientRect().width,
      width: row.getBoundingClientRect().width
    })));
    assert.ok(initialGeometry.every((row) => row.height === 40 && row.titleWidth > row.width * 0.6));
    await page.getByRole("button", { name: "Options for Library saved page", exact: true }).click();
    await page.locator(".ba-menu button", { hasText: /^Notes$/ }).click();
    assert.equal(await page.locator(".ba-detail textarea").inputValue(), "Synthetic notes retained outside the compact list");
    assert.ok((await page.locator(".ba-bookmark-list").boundingBox()).width < fullListWidth - 200);
    await page.screenshot({ path: path.join(artifacts, "notes-desktop.png"), animations: "disabled" });
    await page.locator(".ba-detail").getByRole("tab", { name: "Properties", exact: true }).click();
    assert.match(await page.locator(".ba-detail").innerText(), /12 opens/);
    assert.match(await page.locator(".ba-detail").innerText(), /autokeywordforsearch/);
    assert.match(await page.locator(".ba-detail").innerText(), /https:\/\/example.test\/200/);
    await page.screenshot({ path: path.join(artifacts, "properties-desktop.png"), animations: "disabled" });
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await page.locator(".ba-detail").waitFor({ state: "hidden" });
    assert.equal((await page.locator(".ba-bookmark-list").boundingBox()).width, fullListWidth);
    const openNotes = async (title) => {
      await page.locator(".ba-bookmark-list").getByRole("button", { name: `Options for ${title}`, exact: true }).click();
      await page.locator(".ba-menu button", { hasText: /^Notes$/ }).click();
      await page.locator(".ba-detail textarea").waitFor();
    };
    await openNotes("Library saved page");
    await page.locator(".ba-detail textarea").fill("Saved on immediate panel close");
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await page.locator(".ba-detail").waitFor({ state: "hidden" });
    assert.equal(fixture.storage.metadataByUrl["https://example.test/200"].notes, "Saved on immediate panel close");
    await openNotes("Library saved page");
    let releaseRead;
    holdManagerRead = new Promise((resolve) => { releaseRead = resolve; });
    const readsBefore = managerReads;
    const repliesBefore = await page.evaluate(() => globalThis.__managerReplies);
    await page.evaluate(() => globalThis.__bookmarkChange());
    await page.waitForFunction(() => globalThis.__managerReadHeld === true);
    assert.ok(managerReads > readsBefore);
    await page.locator(".ba-detail textarea").fill("Saved after an older read began");
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await page.locator(".ba-detail").waitFor({ state: "hidden" });
    holdManagerRead = null;
    releaseRead();
    await page.waitForFunction((previous) => globalThis.__managerReplies >= previous + 2, repliesBefore);
    await openNotes("Library saved page");
    assert.equal(await page.locator(".ba-detail textarea").inputValue(), "Saved after an older read began");
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await page.locator(".ba-detail").waitFor({ state: "hidden" });
    assertions += 2;
    await openNotes("Library saved page");
    await page.locator(".ba-detail textarea").fill("First bookmark draft");
    await openNotes("Library research page");
    assert.equal(fixture.storage.metadataByUrl["https://example.test/200"].notes, "First bookmark draft");
    await page.locator(".ba-detail textarea").fill("Second bookmark draft");
    await page.getByRole("tab", { name: /^Saved Windows/ }).click();
    await page.locator(".ba-detail").waitFor({ state: "hidden" });
    assert.equal(fixture.storage.metadataByUrl["https://example.test/201"].notes, "Second bookmark draft");
    await view("Library");
    await waitRows(2);
    await openNotes("Library saved page");
    let releaseNotes;
    holdNotes = new Promise((resolve) => { releaseNotes = resolve; });
    const sent = await page.evaluate(() => globalThis.__noteRequestCount || 0);
    await page.locator(".ba-detail textarea").fill("Older request in flight");
    await page.waitForFunction((count) => globalThis.__noteRequestCount > count, sent);
    await page.locator(".ba-detail textarea").fill("Latest draft wins");
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    assert.equal(await page.locator(".ba-detail").isVisible(), true);
    holdNotes = null;
    releaseNotes();
    await page.locator(".ba-detail").waitFor({ state: "hidden" });
    assert.equal(fixture.storage.metadataByUrl["https://example.test/200"].notes, "Latest draft wins");
    await openNotes("Library saved page");
    rejectNotes = true;
    await page.locator(".ba-detail textarea").fill("Keep this draft after a failure");
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await page.locator(".ba-note-retry:not([hidden])").waitFor();
    assert.equal(await page.locator(".ba-detail textarea").inputValue(), "Keep this draft after a failure");
    assert.match(await page.locator(".ba-note-status").innerText(), /Could not save/);
    await page.screenshot({ path: path.join(artifacts, "notes-error.png"), animations: "disabled" });
    rejectNotes = false;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".ba-note-status").textContent === "Saved");
    assert.equal(fixture.storage.metadataByUrl["https://example.test/200"].notes, "Keep this draft after a failure");
    await page.locator(".ba-detail textarea").fill("Survives bookmark refresh");
    await page.evaluate(() => globalThis.__bookmarkChange());
    await page.waitForFunction(() => document.querySelector(".ba-note-status").textContent === "Saved");
    assert.equal(await page.locator(".ba-detail textarea").inputValue(), "Survives bookmark refresh");
    await page.locator(".ba-detail textarea").fill("");
    await page.keyboard.press("Escape");
    await page.locator(".ba-detail").waitFor({ state: "hidden" });
    assert.equal(fixture.storage.metadataByUrl["https://example.test/200"].notes, "");
    assert.equal(await page.locator("#bookmark-admin-overlay").count(), 1);
    assert.equal(await page.locator(".ba-bookmark-list").getByRole("button", { name: "Options for Library saved page", exact: true }).evaluate((node) => node === document.activeElement), true);
    assertions += 16;
    await openNotes("Library saved page");
    const noteReplies = await page.evaluate(() => globalThis.__noteReplies || 0);
    await page.locator(".ba-detail textarea").fill("Latest draft sent on page exit");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.waitForFunction((previous) => globalThis.__noteReplies > previous, noteReplies);
    assert.equal(fixture.storage.metadataByUrl["https://example.test/200"].notes, "Latest draft sent on page exit");
    await page.locator(".ba-detail").getByRole("tab", { name: "Notes", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector('.ba-detail-tab[data-mode="properties"]').getAttribute("aria-selected") === "true");
    assert.equal(await page.locator(".ba-detail").getByRole("tab", { name: "Properties", exact: true }).evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press("ArrowLeft");
    await page.locator(".ba-detail textarea").waitFor();
    assert.equal(await page.locator(".ba-detail textarea").inputValue(), "Latest draft sent on page exit");
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await page.locator(".ba-detail").waitFor({ state: "hidden" });
    assertions += 3;
    fixture.find("101").children.push({ id: "temp-details", parentId: "101", title: "Temporary details bookmark",
      url: "https://example.test/temp-details", dateAdded: Date.now() });
    await page.evaluate(() => globalThis.__bookmarkChange());
    await waitRows(3);
    await openNotes("Temporary details bookmark");
    await page.locator(".ba-detail textarea").fill("Draft belongs to the original URL");
    fixture.find("temp-details").url = "https://example.test/temp-details-updated";
    await page.evaluate(() => globalThis.__bookmarkChange());
    await page.waitForFunction(() => document.querySelector(".ba-status").textContent === "Bookmark URL changed. Details refreshed.");
    assert.equal(fixture.storage.metadataByUrl["https://example.test/temp-details"].notes, "Draft belongs to the original URL");
    assert.equal(await page.locator(".ba-detail textarea").inputValue(), "");
    await page.locator(".ba-detail textarea").fill("New note belongs to the updated URL");
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await page.locator(".ba-detail").waitFor({ state: "hidden" });
    assert.equal(fixture.storage.metadataByUrl["https://example.test/temp-details-updated"].notes, "New note belongs to the updated URL");
    await openNotes("Temporary details bookmark");
    await page.locator(".ba-detail textarea").fill("Pending note when bookmark is removed");
    fixture.find("101").children = fixture.find("101").children.filter((node) => node.id !== "temp-details");
    await page.evaluate(() => globalThis.__bookmarkChange());
    await page.locator(".ba-detail").waitFor({ state: "hidden" });
    await waitRows(2);
    assert.equal(fixture.storage.metadataByUrl["https://example.test/temp-details-updated"].notes, "Pending note when bookmark is removed");
    assertions += 4;
    await page.locator(".ba-search").fill("autokeywordforsearch");
    await waitRows(1);
    await page.locator(".ba-search").fill("");
    await waitRows(2);
    await page.locator(".ba-folder-tree .ba-name", { hasText: /^All$/ }).click();
    await waitRows(1);
    assert.equal((await page.locator(".ba-tree-bookmark").first().boundingBox()).height, 32);
    await page.getByRole("button", { name: /^All in Library/ }).click();
    await waitRows(2);
    assertions += 11;
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
    const untitled = page.locator(".ba-bookmark-list .ba-bookmark-row").filter({ has: page.getByRole("button", { name: "Untitled bookmark", exact: true }) });
    assert.equal(await untitled.count(), 1);
    assert.doesNotMatch(await untitled.innerText(), /https?:\/\//);
    assertions += 2;
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
    for (const viewport of [{ width: 1440, height: 1000, resize: true }, { width: 1000, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const manager = page.locator(".ba-window");
      if (viewport.resize) {
        const initial = await manager.boundingBox();
        await page.mouse.move(initial.x + initial.width - 3, initial.y + initial.height - 3);
        await page.mouse.down();
        await page.mouse.move(initial.x + 980, initial.y + 650, { steps: 10 });
        await page.mouse.up();
        await page.waitForFunction(() => document.querySelector(".ba-window").getBoundingClientRect().width < 1100);
        const resized = await manager.boundingBox();
        assert.ok(resized.width < initial.width - 100 && resized.height < initial.height - 50);
        assertions += 1;
      } else {
        await manager.evaluate((node) => { node.style.width = ""; node.style.height = ""; });
      }
      await page.screenshot({ path: path.join(artifacts, viewport.resize ? "all-resized.png" : `all-${viewport.width}.png`), animations: "disabled" });
      const layout = await page.evaluate(() => {
        const win = document.querySelector(".ba-window").getBoundingClientRect();
        const rowRects = [...document.querySelectorAll(".ba-bookmark-list .ba-bookmark-row")].map((node) => node.getBoundingClientRect());
        return {
          inViewport: win.left >= 0 && win.right <= innerWidth && win.bottom <= innerHeight,
          rowOverlap: rowRects.some((rect, index) => index > 0 && rect.top < rowRects[index - 1].bottom),
          horizontalOverflow: [...document.querySelectorAll(".ba-navigation, .ba-toolbar, .ba-bookmark-list")]
            .some((node) => node.scrollWidth > node.clientWidth + 1),
          uniformRows: rowRects.every((rect) => rect.height === 40),
          assetsLoaded: [...document.querySelectorAll("img")].every((node) => node.complete && node.naturalWidth > 0)
        };
      });
      assert.deepEqual(layout, { inViewport: true, rowOverlap: false, horizontalOverflow: false, uniformRows: true, assetsLoaded: true });
      assertions += 5;
      if (viewport.width === 390) {
        const treeHeight = (await page.locator(".ba-folder-tree").boundingBox()).height;
        const folderHeight = (await page.locator(".ba-folder-line").first().boundingBox()).height;
        assert.ok(treeHeight >= folderHeight * 2, `Tree ${treeHeight}px must fit two folder rows of ${folderHeight}px`);
        assertions += 1;
        await view("Saved Windows");
        await page.locator('[data-folder-id="110"] .ba-name').click();
        await waitRows(2);
        await page.screenshot({ path: path.join(artifacts, "capture-390.png"), animations: "disabled" });
        await openCapture();
        await actionDialog.waitFor();
        const actionGeometry = await actionDialog.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return { inside: rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
            overflow: node.scrollWidth > node.clientWidth + 1 };
        });
        assert.deepEqual(actionGeometry, { inside: true, overflow: false });
        await page.screenshot({ path: path.join(artifacts, "capture-confirm-390.png"), animations: "disabled" });
        await page.keyboard.press("Escape");
        await actionDialog.waitFor({ state: "hidden" });
        assert.equal(await page.locator("#bookmark-admin-overlay").count(), 1);
        await view("All Bookmarks");
        await waitRows(51);
        assertions += 2;
      }
      if (viewport.resize || viewport.width === 390) {
        const priorWidth = (await page.locator(".ba-bookmark-list").boundingBox()).width;
        const firstRow = page.locator(".ba-bookmark-list .ba-bookmark-row").first();
        const id = await firstRow.getAttribute("data-bookmark-id");
        await firstRow.locator(".ba-icon-btn").click();
        await page.locator(".ba-menu button", { hasText: /^Properties$/ }).click();
        assert.equal(await page.locator(".ba-detail").isVisible(), true);
        assert.equal(await page.locator(".ba-detail-scrim").isVisible(), true);
        assert.equal(await page.locator(".ba-library-panel").evaluate((node) => node.inert), true);
        assert.equal(await page.locator(".ba-list-panel").evaluate((node) => node.inert), true);
        assert.equal(await page.locator(".ba-detail").getAttribute("aria-modal"), "true");
        for (const key of ["Tab", "Shift+Tab"]) {
          for (let count = 0; count < 12; count += 1) {
            await page.keyboard.press(key);
            assert.equal(await page.evaluate(() => document.querySelector(".ba-detail").contains(document.activeElement)), true);
          }
        }
        const drawerGeometry = await page.locator(".ba-detail").evaluate((node) => {
          const panel = node.getBoundingClientRect();
          const win = node.closest(".ba-window").getBoundingClientRect();
          return { inside: panel.left >= win.left && panel.right <= win.right && panel.top >= win.top && panel.bottom <= win.bottom,
            overflow: node.scrollWidth > node.clientWidth + 1 };
        });
        assert.deepEqual(drawerGeometry, { inside: true, overflow: false });
        assert.equal((await page.locator(".ba-bookmark-list").boundingBox()).width, priorWidth);
        await page.screenshot({ path: path.join(artifacts, viewport.resize ? "properties-resized.png" : "properties-390.png"), animations: "disabled" });
        await page.locator(".ba-detail").getByRole("tab", { name: "Notes", exact: true }).click();
        await page.locator(".ba-detail textarea").fill(`Drawer note ${viewport.width}`);
        await page.screenshot({ path: path.join(artifacts, viewport.resize ? "notes-resized.png" : "notes-390.png"), animations: "disabled" });
        await page.locator(".ba-detail-scrim").click({ position: { x: 2, y: 2 } });
        await page.locator(".ba-detail").waitFor({ state: "hidden" });
        assert.equal(fixture.storage.metadataByUrl[fixture.find(id).url].notes, `Drawer note ${viewport.width}`);
        assert.equal(await page.locator(`[data-bookmark-id="${id}"] .ba-icon-btn`).evaluate((node) => node === document.activeElement), true);
        assertions += 33;
      }
    }

    const overlay = await context.newPage();
    overlay.on("pageerror", (error) => errors.push(error.message));
    await overlay.goto(new URL("popup.html", baseUrl).href);
    await overlay.evaluate(() => {
      globalThis.__hostDownloadLinks = [];
      globalThis.__hostBlobUrls = [];
      new MutationObserver((changes) => changes.forEach((change) => change.addedNodes.forEach((node) => {
        if (node instanceof HTMLAnchorElement && node.download) globalThis.__hostDownloadLinks.push(node.href);
      }))).observe(document.documentElement, { childList: true, subtree: true });
      const original = URL.createObjectURL;
      URL.createObjectURL = (...args) => {
        const url = original.apply(URL, args);
        globalThis.__hostBlobUrls.push(url);
        return url;
      };
    });
    await overlay.evaluate(() => { document.documentElement.dataset.bookmarkAdminMode = "standalone"; });
    await overlay.addStyleTag({ path: path.join(repo, "overlay-manager.css") });
    await overlay.addScriptTag({ path: path.join(repo, "overlay-manager.js") });
    await overlay.waitForFunction(() => getComputedStyle(document.getElementById("bookmark-admin-overlay")).visibility === "visible");
    assert.equal(await overlay.locator(".ba-view-tab").count(), 0);
    assert.equal(await overlay.evaluate(() => document.getElementById("bookmark-admin-overlay").shadowRoot), null);
    await overlay.screenshot({ path: path.join(artifacts, "overlay-desktop.png"), animations: "disabled" });
    const cdp = await context.newCDPSession(overlay);
    const clickClosedControl = async (role, name) => {
      const tree = await cdp.send("Accessibility.getFullAXTree");
      const node = tree.nodes.find((item) => item.role?.value === role && new RegExp(name).test(item.name?.value || ""));
      assert.ok(node, `Missing accessible control: ${name}`);
      const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId: node.backendDOMNodeId });
      await overlay.mouse.click((model.content[0] + model.content[4]) / 2, (model.content[1] + model.content[5]) / 2);
    };
    await clickClosedControl("tab", "^All Bookmarks");
    await clickClosedControl("button", "^Export$");
    await clickClosedControl("button", "^Export JSON$");
    await overlay.waitForFunction(() => globalThis.__bookmarkListenerCount() === 1);
    assert.match(fixture.tabsCreated.at(-1).url, /^chrome-extension:\/\/fixture\/export.html\?format=json&view=all$/);
    assert.deepEqual(await overlay.evaluate(() => globalThis.__hostDownloadLinks), []);
    assert.deepEqual(await overlay.evaluate(() => globalThis.__hostBlobUrls), []);
    const exportPage = await context.newPage();
    const ownedDownloadPromise = exportPage.waitForEvent("download");
    await exportPage.goto(`${new URL("export.html", baseUrl).href}?format=json&view=all`);
    const ownedDownload = await ownedDownloadPromise;
    const privatePath = path.join(artifacts, "private-export.json");
    await ownedDownload.saveAs(privatePath);
    const privateData = JSON.parse(fs.readFileSync(privatePath));
    let exportedCount = 0;
    const countExported = (node) => { if (node.url) exportedCount += 1; (node.children || []).forEach(countExported); };
    countExported(privateData.root);
    assert.equal(exportedCount, 51);
    await exportPage.getByText("Download started.", { exact: true }).waitFor();
    await exportPage.close();
    assertions += 5;
    await clickClosedControl("tab", "^Library");
    await clickClosedControl("button", "^Options for Library saved page$");
    await clickClosedControl("button", "^Notes$");
    await clickClosedControl("textbox", "^Notes$");
    await overlay.keyboard.press("Control+A");
    await overlay.keyboard.type("Overlay draft saved on close");
    await overlay.screenshot({ path: path.join(artifacts, "overlay-notes.png"), animations: "disabled" });
    await overlay.mouse.click(5, 5);
    await overlay.locator("#bookmark-admin-overlay").waitFor({ state: "detached" });
    assert.equal(await overlay.locator("#bookmark-admin-overlay").count(), 0);
    assert.equal(fixture.storage.metadataByUrl["https://example.test/200"].notes, "Overlay draft saved on close");
    assert.equal(await overlay.evaluate(() => globalThis.__bookmarkListenerCount()), 0);
    await overlay.addScriptTag({ path: path.join(repo, "overlay-manager.js") });
    await overlay.waitForFunction(() => getComputedStyle(document.getElementById("bookmark-admin-overlay")).visibility === "visible");
    await overlay.addScriptTag({ path: path.join(repo, "overlay-manager.js") });
    await overlay.locator("#bookmark-admin-overlay").waitFor({ state: "detached" });
    assert.equal(await overlay.locator("#bookmark-admin-overlay").count(), 0);
    assert.equal(await overlay.evaluate(() => globalThis.__bookmarkListenerCount()), 0);
    assertions += 7;
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ assertions, artifacts, errors, note: "Real Chrome rendering; synthetic Chrome API fixture, isolated from personal data." }));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
