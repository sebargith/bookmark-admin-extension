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
