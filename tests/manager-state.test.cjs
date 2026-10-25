const assert = require("node:assert/strict");
const test = require("node:test");
const { createFixture, copy } = require("./helpers/chrome-fixture.cjs");

test("manager state covers all roots and discovers captures on both bookmarks bars without migrating data", async () => {
  const fixture = createFixture();
  const before = copy(fixture.root);
  const state = await fixture.context.getManagerState();
  assert.deepEqual(copy(state.savedWindowFolderIds), ["110", "120"]);
  assert.equal(state.bookmarks.length, 10);
  assert.equal(new Set(state.bookmarks.map((node) => node.id)).size, 10);
  assert.ok(state.bookmarks.some((node) => node.id === "216"));
  assert.ok(state.bookmarks.some((node) => node.id === "401"));
  assert.deepEqual(fixture.root, before);
  assert.deepEqual(fixture.mutations, []);
  assert.equal(fixture.storage.settings.lastSavedFolderId, "102");
  const popupState = await fixture.context.getManagedState();
  assert.deepEqual(copy(popupState.bookmarks.map((node) => node.id)), ["200", "201"]);
});

test("external bookmarks support rename, create, move, delete, and undo using native IDs", async () => {
  const fixture = createFixture();
  await fixture.context.renameNode({ id: "210", title: "Renamed tab" });
  assert.equal(fixture.find("210").title, "Renamed tab");
  await fixture.context.undoLast();
  assert.equal(fixture.find("210").title, "Window tab one");
  const result = await fixture.context.createFolder({ parentId: "110", title: "Child folder" });
  assert.equal(result.folder.parentId, "110");
  await fixture.context.bulkMove({ ids: ["210"], folderId: "102" });
  assert.equal(fixture.find("210").parentId, "102");
  await fixture.context.undoLast();
  assert.equal(fixture.find("210").parentId, "110");
  await fixture.context.bulkDelete({ ids: ["120"] });
  assert.equal(fixture.find("120"), undefined);
  await fixture.context.undoLast();
  assert.ok(fixture.root.children.find((node) => node.id === "10").children.some((node) => node.title === "nuevo 10"));
});

test("protects native roots, library defaults, and inherited read-only bookmarks", async () => {
  const fixture = createFixture();
  const state = await fixture.context.getManagerState();
  assert.ok(state.protectedNodeIds.includes("1"));
  assert.ok(state.protectedNodeIds.includes("100"));
  assert.ok(state.readOnlyNodeIds.includes("401"));
  for (const id of ["0", "1", "2", "100", "101", "400", "401"]) {
    await assert.rejects(fixture.context.renameNode({ id, title: "Forbidden" }));
    await assert.rejects(fixture.context.bulkDelete({ ids: [id] }));
    await assert.rejects(fixture.context.bulkMove({ ids: [id], folderId: "102" }));
  }
  assert.deepEqual(fixture.mutations, []);
});

test("missing and read-only targets never redirect actions into the library default", async () => {
  const fixture = createFixture();
  for (const folderId of ["missing", "0", "400", "401"]) {
    await assert.rejects(fixture.context.createFolder({ parentId: folderId, title: "New" }));
    await assert.rejects(fixture.context.bulkMove({ ids: ["210"], folderId }));
    await assert.rejects(fixture.context.sortFolder({ folderId }));
  }
  assert.deepEqual(fixture.mutations, []);
});

test("empty scoped actions cannot accidentally scan every bookmark", async () => {
  const fixture = createFixture();
  assert.equal((await fixture.context.refreshIndex({ ids: [] })).indexed, 0);
  assert.equal((await fixture.context.checkLinks({ ids: [] })).checked, 0);
  assert.deepEqual(fixture.mutations, []);
});

test("a fresh manager state reflects external changes and preserves bookmark identity", async () => {
  const fixture = createFixture();
  await fixture.context.getManagerState();
  fixture.find("110").title = "nuevo7";
  fixture.find("210").title = "Changed in Chrome";
  const state = await fixture.context.getManagerState();
  assert.equal(state.bookmarks.find((node) => node.id === "210").title, "Changed in Chrome");
  assert.ok(state.savedWindowFolderIds.includes("110"));
  assert.deepEqual(fixture.mutations, []);
});

test("deleting a folder cannot remove a protected Library or read-only descendant", async () => {
  const fixture = createFixture();
  const other = fixture.find("2");
  const library = fixture.find("100");
  other.children = other.children.filter((node) => node.id !== library.id);
  other.children.push({ id: "archive", parentId: "2", title: "Archive", children: [library] });
  library.parentId = "archive";
  await assert.rejects(fixture.context.bulkDelete({ ids: ["archive"] }), /No removable/);
  fixture.find("111").children.push({ id: "readonly-child", parentId: "111", title: "Read-only", unmodifiable: "managed", children: [] });
  await assert.rejects(fixture.context.bulkDelete({ ids: ["111"] }), /No removable/);
  assert.deepEqual(fixture.mutations, []);
  assert.ok(fixture.find("100"));
  assert.equal(fixture.storage.lastUndo, undefined);
});

test("restoring a legacy delete snapshot restores Library before initialization, without duplicates", async () => {
  const fixture = createFixture();
  const library = copy(fixture.find("100"));
  const archive = { id: "archive", parentId: "2", title: "Archive", children: [library] };
  library.parentId = "archive";
  fixture.find("2").children = fixture.find("2").children.filter((node) => node.id !== "100");
  fixture.storage.lastUndo = { action: "delete", snapshots: [{ node: archive, parentId: "2", index: 0 }] };
  await fixture.context.undoLast();
  const restored = await fixture.context.getManagerState();
  assert.equal(restored.folders.filter((node) => node.title === "Bookmark Admin").length, 1);
  assert.equal(restored.bookmarks.filter((node) => node.title === "Library saved page").length, 1);
});

test("exports validate scope and include only the selected native tree and its metadata", async () => {
  const fixture = createFixture();
  fixture.storage.metadataByUrl = {
    "https://example.test/210": { notes: "Selected note" },
    "https://example.test/200": { notes: "Unrelated note" }
  };
  const exported = await fixture.context.buildExport({ format: "json", view: "windows", folderId: "110" });
  const data = JSON.parse(exported.content);
  assert.equal(data.root.id, "110");
  assert.deepEqual(Object.keys(data.metadataByUrl), ["https://example.test/210"]);
  assert.equal(data.root.children.length, 2);
  await assert.rejects(fixture.context.buildExport({ format: "json", view: "library", folderId: "110" }), /no longer in this view/);
  await assert.rejects(fixture.context.buildExport({ format: "json", view: "windows", folderId: "missing" }));
  await assert.rejects(fixture.context.buildExport({ format: "script", view: "all" }));
  assert.deepEqual(fixture.mutations, []);
});

test("HTML exports escape bookmark titles, URLs and notes", async () => {
  const fixture = createFixture();
  fixture.find("210").title = '<script>alert("test")</script>';
  fixture.find("210").url = 'https://example.test/?a=1&b="quoted"';
  fixture.storage.metadataByUrl = {
    [fixture.context.normalizeUrl(fixture.find("210").url)]: { notes: "<private>&note" }
  };
  const result = await fixture.context.buildExport({ format: "html", view: "windows", folderId: "110" });
  assert.match(result.content, /&lt;script&gt;/);
  assert.match(result.content, /&amp;b=&quot;quoted&quot;/);
  assert.match(result.content, /&lt;private&gt;&amp;note/);
  assert.doesNotMatch(result.content, /<script>/);
});

test("overlay export opens a private extension page with no bookmark contents in the URL", async () => {
  const fixture = createFixture();
  await fixture.context.openExportPage({ format: "json", view: "windows", folderId: "110" });
  assert.deepEqual(fixture.tabsCreated, [{ url: "chrome-extension://fixture/export.html?format=json&view=windows&folder=110" }]);
  const manifest = require("../manifest.json");
  assert.ok(manifest.web_accessible_resources.every((entry) =>
    !entry.resources.some((resource) => resource === "export.html" || resource === "*.html" || resource === "*")));
});
