const assert = require("node:assert/strict");
const test = require("node:test");
const { createFixture, copy } = require("./helpers/chrome-fixture.cjs");

test("legacy captures keep identity after external rename and move without duplicating nested captures", async () => {
  const fixture = createFixture();
  const before = copy(fixture.root);
  const initial = await fixture.context.getManagerState();
  assert.equal(initial.savedWindows.find((item) => item.folderId === "110").capturedAt, null);
  assert.equal(initial.savedWindows.find((item) => item.folderId === "110").tabCount, 2);
  fixture.find("110").title = "Reading session";
  await fixture.context.bulkMove({ ids: ["110"], folderId: "120" });
  const state = await fixture.context.getManagerState();
  assert.deepEqual(copy(state.savedWindowFolderIds), ["120"]);
  assert.equal(state.savedWindows.find((item) => item.folderId === "110").tabCount, 2);
  assert.equal(state.savedWindows.find((item) => item.folderId === "120").tabCount, 3);
  const exported = JSON.parse((await fixture.context.buildExport({ format: "json", view: "windows" })).content);
  const ids = [];
  const visit = (node) => { if (node.url) ids.push(node.id); (node.children || []).forEach(visit); };
  visit(exported.root);
  assert.deepEqual(ids, ["212", "210", "211"]);
  assert.equal(initial.root.children.length, before.children.length);
});

test("reopening requires confirmation, keeps tab order and duplicates, and skips unsafe or malformed URLs", async () => {
  const fixture = createFixture();
  fixture.find("211").url = fixture.find("210").url;
  fixture.find("110").children.push(...["javascript:alert(1)", "chrome://settings", "https://", "file:///test"].map((url, i) => ({ id: `bad-${i}`, parentId: "110", title: "Unsupported", url })));
  const before = copy(fixture.root);
  await assert.rejects(fixture.context.reopenSavedWindow({ folderId: "110" }), /Confirm/);
  const result = await fixture.context.reopenSavedWindow({ folderId: "110", confirmed: true });
  assert.equal(result.opened, 2);
  assert.equal(result.skipped, 4);
  assert.deepEqual(fixture.windowsCreated, [{ url: ["https://example.test/210", "https://example.test/210"], type: "normal", incognito: false }]);
  assert.deepEqual(fixture.root, before);
  assert.deepEqual(fixture.mutations, []);
  assert.equal(fixture.storage.settings.lastSavedFolderId, "102");
});

test("reopening rejects missing, non-capture, empty and oversized folders without opening a window", async () => {
  const fixture = createFixture();
  for (const folderId of ["missing", "111", "210", "0"]) {
    await assert.rejects(fixture.context.reopenSavedWindow({ folderId, confirmed: true }), /not found/);
  }
  fixture.find("110").children = [];
  await assert.rejects(fixture.context.reopenSavedWindow({ folderId: "110", confirmed: true }), /no http/);
  fixture.find("110").children = Array.from({ length: 101 }, (_, i) => ({ id: `many-${i}`, parentId: "110", title: "Page", url: `https://example.test/${i}` }));
  await assert.rejects(fixture.context.reopenSavedWindow({ folderId: "110", confirmed: true }), /at most 100/);
  assert.deepEqual(fixture.windowsCreated, []);
});

test("overlapping reopen requests share one window creation and can retry a failed creation", async () => {
  const fixture = createFixture();
  let createCalls = 0;
  fixture.chrome.windows.create = (options, callback) => {
    createCalls += 1;
    if (createCalls === 1) throw new Error("Window creation failed");
    callback({ id: 1 });
  };
  const first = fixture.context.reopenSavedWindow({ folderId: "110", confirmed: true });
  const second = fixture.context.reopenSavedWindow({ folderId: "110", confirmed: true });
  assert.equal(first, second);
  await assert.rejects(first, /Window creation failed/);
  await fixture.context.reopenSavedWindow({ folderId: "110", confirmed: true });
  assert.equal(createCalls, 2);
});

test("confirmation snapshots reject changed captures before opening or moving pages", async () => {
  const fixture = createFixture();
  await assert.rejects(fixture.context.reopenSavedWindow({ folderId: "110", confirmed: true, expectedUrls: ["https://example.test/outdated"] }), /capture changed/);
  await assert.rejects(fixture.context.moveSavedItemsToLibrary({ captureId: "110", folderId: "101", expectedIds: ["210"] }), /capture changed/);
  await assert.rejects(fixture.context.moveSavedItemsToLibrary({ captureId: "110", folderId: "101", expectedContents: [] }), /capture changed/);
  assert.deepEqual(fixture.windowsCreated, []);
  assert.deepEqual(fixture.mutations, []);
});

test("a stale tree snapshot cannot erase a newly registered capture", async () => {
  const fixture = createFixture();
  const stale = copy(fixture.root);
  fixture.find("1").children.push({ id: "fresh", parentId: "1", title: "nuevo11", children: [] });
  await fixture.context.updateSavedWindowRecords(fixture.root, { fresh: { capturedAt: 12345, originalTabCount: 0 } });
  const records = await fixture.context.updateSavedWindowRecords(stale);
  assert.equal(fixture.storage.savedWindows.fresh.capturedAt, 12345);
  assert.equal(records.fresh, undefined);
});

test("transfer confirmation validates changed URLs against the execution tree, not its earlier capture snapshot", async () => {
  const fixture = createFixture();
  const expectedContents = fixture.find("110").children.map((item) => [item.id, item.parentId, item.url]);
  const getSavedWindow = fixture.context.getSavedWindow;
  fixture.context.getSavedWindow = async (id) => {
    const result = await getSavedWindow(id);
    fixture.find("210").url = "https://example.test/changed-during-transfer";
    return result;
  };
  await assert.rejects(fixture.context.moveSavedItemsToLibrary({ captureId: "110", folderId: "102", expectedContents }), /capture changed/);
  assert.deepEqual(fixture.mutations, []);
});

test("transfer rejects a destination moved outside Library while the undo write is pending", async () => {
  const fixture = createFixture();
  const previousUndo = { action: "rename", label: "Previous action", renames: [] };
  fixture.storage.lastUndo = copy(previousUndo);
  const set = fixture.chrome.storage.local.set;
  let changed = false;
  fixture.chrome.storage.local.set = (values, callback) => {
    if (values.lastUndo?.transferId && !changed) {
      changed = true;
      const destination = fixture.find("102");
      fixture.find("100").children = fixture.find("100").children.filter((item) => item.id !== "102");
      fixture.find("111").children.push(destination);
      destination.parentId = "111";
    }
    set(values, callback);
  };
  await assert.rejects(fixture.context.moveSavedItemsToLibrary({ captureId: "110", folderId: "102" }), /inside Library/);
  assert.deepEqual(fixture.mutations, []);
  assert.deepEqual(fixture.storage.lastUndo, previousUndo);
});

test("transfer stops if destination changes between native moves and undo only includes successful items", async () => {
  const fixture = createFixture();
  const move = fixture.chrome.bookmarks.move;
  fixture.chrome.bookmarks.move = (id, destination, callback) => move(id, destination, (result) => {
    if (id === "210" && destination.parentId === "102") {
      const folder = fixture.find("102");
      fixture.find("100").children = fixture.find("100").children.filter((item) => item.id !== "102");
      fixture.find("111").children.push(folder);
      folder.parentId = "111";
    }
    callback(result);
  });
  await assert.rejects(fixture.context.moveSavedItemsToLibrary({ captureId: "110", folderId: "102" }), /Moved 1 items before stopping/);
  assert.equal(fixture.find("210").parentId, "102");
  assert.equal(fixture.find("211").parentId, "110");
  assert.deepEqual(fixture.storage.lastUndo.moves.map((item) => item.id), ["210"]);
  await fixture.context.undoLast();
  assert.equal(fixture.find("210").parentId, "110");
  assert.equal(fixture.find("102").parentId, "111");
});

test("moving capture contents into Library preserves native IDs, notes and undo", async () => {
  const fixture = createFixture();
  const before = copy(fixture.root);
  fixture.storage.metadataByUrl = { "https://example.test/210": { notes: "Retained note" } };
  const result = await fixture.context.moveSavedItemsToLibrary({ captureId: "110", folderId: "102" });
  assert.equal(result.moved, 2);
  assert.equal(fixture.find("110").children.length, 0);
  assert.equal(fixture.find("210").parentId, "102");
  assert.equal(fixture.storage.metadataByUrl["https://example.test/210"].notes, "Retained note");
  await fixture.context.undoLast();
  assert.deepEqual(fixture.root, before);
  await fixture.context.moveSavedItemsToLibrary({ captureId: "110", bookmarkId: "210", folderId: "101" });
  assert.equal(fixture.find("210").parentId, "101");
  assert.equal(fixture.find("211").parentId, "110");
});

test("capture transfer validates scope, destination, protection and empty folders", async () => {
  const fixture = createFixture();
  for (const payload of [
    { captureId: "111", folderId: "101" }, { captureId: "110", folderId: "111" },
    { captureId: "110", bookmarkId: "201", folderId: "101" }, { captureId: "110", bookmarkId: "120", folderId: "101" }
  ]) await assert.rejects(fixture.context.moveSavedItemsToLibrary(payload));
  fixture.find("211").unmodifiable = "managed";
  await assert.rejects(fixture.context.moveSavedItemsToLibrary({ captureId: "110", folderId: "101" }), /cannot be moved/);
  assert.deepEqual(fixture.mutations, []);
  fixture.find("110").children = [];
  await assert.rejects(fixture.context.moveSavedItemsToLibrary({ captureId: "110", folderId: "101" }), /empty/);
});

test("undoing deletion restores a renamed capture's local identity with its new native ID", async () => {
  const fixture = createFixture();
  await fixture.context.getManagerState();
  fixture.find("110").title = "Renamed session";
  await fixture.context.bulkDelete({ ids: ["110"] });
  assert.equal((await fixture.context.getManagerState()).savedWindows.some((item) => item.folderId === "110"), false);
  await fixture.context.undoLast();
  const folder = fixture.find("1").children.find((item) => item.title === "Renamed session");
  assert.notEqual(folder.id, "110");
  assert.equal((await fixture.context.getManagerState()).savedWindows.find((item) => item.folderId === folder.id).tabCount, 2);
});
