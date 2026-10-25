const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "service-worker.js"), "utf8");
const copy = (value) => JSON.parse(JSON.stringify(value));
const bar = (children = [], extra = {}) => ({
  id: "bar", title: "Barra de favoritos", folderType: "bookmarks-bar", children, ...extra
});
const folder = (title) => ({ id: title, title, children: [] });
const tab = (index, url = `https://example.test/${index}`) => ({ index, url, title: `Tab ${index}` });

function setup({ bars = [bar()], windows = [], failCreate, beforeChildren } = {}) {
  const root = { id: "0", children: copy(bars) };
  const calls = [];
  const listeners = {};
  const storage = {};
  let nextId = 100;
  let windowsReads = 0;
  const event = (name) => ({ addListener: (listener) => { listeners[name] = listener; } });
  const find = (id, node = root) => node.id === id
    ? node : (node.children || []).map((child) => find(id, child)).find(Boolean);
  const runtime = {
    onInstalled: event("installed"), onStartup: event("startup"), onMessage: event("message")
  };
  const callback = (done, value, error) => setImmediate(() => {
    if (error) runtime.lastError = { message: error };
    try { done(copy(value)); } finally { delete runtime.lastError; }
  });
  const bookmarks = {
    getTree: (done) => callback(done, [root]),
    getChildren: (id, done) => {
      if (beforeChildren) beforeChildren(find(id));
      callback(done, find(id).children);
    },
    create: (details, done) => {
      calls.push(copy(details));
      if (failCreate && failCreate(details)) return callback(done, null, "Simulated Chrome failure");
      const parent = find(details.parentId);
      const node = { id: String(nextId++), index: parent.children.length, ...details };
      if (!details.url) node.children = [];
      parent.children.push(node);
      callback(done, node);
    }
  };
  for (const name of ["onCreated", "onChanged", "onMoved", "onRemoved", "onChildrenReordered", "onImportEnded"]) {
    bookmarks[name] = event(name);
  }
  const context = vm.createContext({
    URL, console, setTimeout, clearTimeout,
    chrome: {
      runtime, bookmarks,
      storage: { local: {
        get: (defaults, done) => callback(done, { ...defaults, ...storage }),
        set: (values, done) => { Object.assign(storage, copy(values)); done(); }
      } },
      windows: { getAll: (options, done) => {
        assert.deepEqual(copy(options), { populate: true, windowTypes: ["normal", "popup"] });
        windowsReads += 1;
        callback(done, windows);
      } },
      contextMenus: { onClicked: event("contextMenu") },
      commands: { onCommand: event("command") }
    },
    fetch: () => { throw new Error("Window capture must not fetch pages"); }
  });
  vm.runInContext(source, context);
  return { context, root, calls, listeners, storage, windowsReads: () => windowsReads };
}

test("captures each window on the bar after the highest number, preserving tab order and duplicates", async () => {
  const fixture = setup({
    bars: [bar([folder("nuevo4"), folder("nuevo5"), folder("nuevo6"),
      folder("nuevo text"), { id: "link", title: "nuevo99", url: "https://example.test" }])],
    windows: [
      { id: 1, tabs: [tab(2), tab(0), tab(1, "https://example.test/0")] },
      { id: 2, tabs: [tab(0, "chrome://settings/")] }
    ]
  });
  const result = await fixture.context.saveAllWindows();
  assert.deepEqual(copy(result.folders.map((node) => node.title)), ["nuevo7", "nuevo8"]);
  assert.equal(result.savedTabCount, 4);
  const createdFolders = fixture.root.children[0].children.slice(-2);
  assert.deepEqual(createdFolders[0].children.map((node) => node.title), ["Tab 0", "Tab 1", "Tab 2"]);
  assert.equal(createdFolders[0].children[0].url, createdFolders[0].children[1].url);
  assert.equal(createdFolders[1].children[0].url, "chrome://settings/");
  assert.ok(fixture.calls.filter((node) => !node.url).every((node) => node.parentId === "bar"));
  assert.equal(Object.values(fixture.storage.savedWindows).filter((record) => record.capturedAt).length, 2);
});

test("starts at nuevo1, accepts spaced names, and continues above gaps and very large numbers", async () => {
  for (const [existing, expected] of [
    [[], "nuevo1"],
    [[folder("nuevo 6"), folder("nuevo2")], "nuevo7"],
    [[folder("nuevo99999999999999999999")], "nuevo100000000000000000000"]
  ]) {
    const fixture = setup({ bars: [bar(existing)], windows: [{ tabs: [tab(0)] }] });
    assert.equal((await fixture.context.saveAllWindows()).folders[0].title, expected);
  }
});

test("finds the correct localized account/local bar and supports older Chrome", async () => {
  for (const bars of [
    [bar([folder("nuevo6")], { id: "local" }), bar([], { id: "account", syncing: true })],
    [bar([], { id: "local", folderType: undefined }), bar([folder("nuevo6")], { id: "account" })],
    [bar([folder("nuevo6")], { id: "1", folderType: undefined })]
  ]) {
    const fixture = setup({ bars, windows: [{ tabs: [tab(0)] }] });
    const result = await fixture.context.saveAllWindows();
    assert.equal(result.folders[0].title, "nuevo7");
    assert.equal(fixture.calls[0].parentId, bars.find((node) => node.children.length).id);
  }
});

test("shares overlapping requests but creates a new numbered set for a later click", async () => {
  const fixture = setup({ windows: [{ tabs: [tab(0)] }] });
  const [first, second] = await Promise.all([
    fixture.context.saveAllWindows(), fixture.context.saveAllWindows()
  ]);
  assert.equal(first, second);
  assert.equal(fixture.windowsReads(), 1);
  assert.equal((await fixture.context.saveAllWindows()).folders[0].title, "nuevo2");
});

test("includes folders created manually between window saves", async () => {
  let reads = 0;
  const fixture = setup({
    windows: [{ tabs: [tab(0)] }, { tabs: [tab(0)] }],
    beforeChildren: (parent) => { if (++reads === 2) parent.children.push(folder("nuevo20")); }
  });
  assert.deepEqual(copy((await fixture.context.saveAllWindows()).folders.map((node) => node.title)), ["nuevo1", "nuevo21"]);
});

test("skips incognito and unsupported URLs, saves pending and discarded tabs without opening them", async () => {
  const fixture = setup({ windows: [
    { incognito: true, tabs: [tab(0)] },
    { tabs: [tab(0, "javascript:alert(1)"), tab(1, "blob:https://example.test/temporary")] },
    { tabs: [
      { index: 0, pendingUrl: "https://example.test/loading", url: "about:blank" },
      { ...tab(1), discarded: true }, tab(2, "file:///sample.pdf"), tab(3, "")
    ] }
  ] });
  const result = await fixture.context.saveAllWindows();
  assert.equal(result.folders.length, 1);
  assert.equal(result.savedTabCount, 3);
  assert.equal(result.skippedTabCount, 3);
  assert.equal(fixture.calls[1].url, "https://example.test/loading");
});

test("reports individual failures while completing the remaining windows", async () => {
  let folderAttempts = 0;
  const fixture = setup({
    windows: [{ tabs: [tab(0)] }, { tabs: [tab(0), tab(1)] }, { tabs: [tab(2)] }],
    failCreate: (details) => !details.url ? ++folderAttempts === 1 : details.title === "Tab 1"
  });
  const result = await fixture.context.saveAllWindows();
  assert.equal(result.failedWindowCount, 1);
  assert.equal(result.failedTabCount, 1);
  assert.equal(result.savedTabCount, 2);
  assert.equal(result.folders.length, 2);
});

test("rejects an unavailable/read-only bar without touching other bookmarks and allows retry", async () => {
  const fixture = setup({ bars: [bar([], { unmodifiable: "managed" })], windows: [{ tabs: [tab(0)] }] });
  await assert.rejects(fixture.context.saveAllWindows(), /unavailable or read-only/);
  assert.equal(fixture.calls.length, 0);
  delete fixture.root.children[0].unmodifiable;
  assert.equal((await fixture.context.saveAllWindows()).savedTabCount, 1);
});

test("routes the popup message to the background capture", async () => {
  const fixture = setup({ windows: [{ tabs: [tab(0)] }] });
  const response = await new Promise((resolve) => {
    assert.equal(fixture.listeners.message({ type: "saveAllWindows" }, {}, resolve), true);
  });
  assert.equal(response.ok, true);
  assert.equal(response.result.savedTabCount, 1);
});
