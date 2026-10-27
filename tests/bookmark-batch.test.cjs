const assert = require("node:assert/strict");
const test = require("node:test");
const { createFixture, copy } = require("./helpers/chrome-fixture.cjs");

function request(fixture, action, ids, extra = {}) {
  const payload = { action, ids, confirmed: true, expected: ids.map((id) => copy(fixture.context.bookmarkSelectionSnapshot(fixture.find(id)))), ...extra };
  if (payload.folderId) {
    payload.destinationPath = [];
    let node = fixture.find(payload.folderId);
    while (node && node.id !== "0") { payload.destinationPath.unshift(node.id); node = fixture.find(node.parentId); }
  }
  return payload;
}

test("batch rename previews changes without mutation and preserves identity and notes on apply/undo", async () => {
  const fixture = createFixture();
  const before = copy(fixture.root);
  fixture.storage.metadataByUrl = { "https://example.test/210": { notes: "Retained" } };
  const payload = request(fixture, "rename", ["211", "210"], { mode: "prefix", text: "Read: " });
  const preview = await fixture.context.previewBookmarkBatch(payload);
  assert.equal(preview.count, 2);
  assert.equal(preview.examples[0].after, "Read: Window tab two");
  assert.deepEqual(fixture.mutations, []);
  assert.equal((await fixture.context.applyBookmarkBatch(payload)).changed, 2);
  assert.equal(fixture.find("210").title, "Read: Window tab one");
  assert.equal(fixture.storage.metadataByUrl["https://example.test/210"].notes, "Retained");
  await fixture.context.undoLast();
  assert.deepEqual(fixture.root, before);
});

test("rename suffix/replace previews report unmatched titles and reject empty results or missing text", async () => {
  const fixture = createFixture();
  assert.equal((await fixture.context.previewBookmarkBatch(request(fixture, "rename", ["210"], { mode: "suffix", text: " [later]" }))).examples[0].after, "Window tab one [later]");
  const replacement = request(fixture, "rename", ["210", "201"], { mode: "replace", find: "Window", text: "Saved" });
  const preview = await fixture.context.previewBookmarkBatch(replacement);
  assert.equal(preview.count, 1);
  assert.equal(preview.unchanged, 1);
  assert.equal((await fixture.context.applyBookmarkBatch(replacement)).changed, 1);
  for (const extra of [{ mode: "prefix", text: "" }, { mode: "replace", find: "", text: "X" }, { mode: "set", text: "X" }, { mode: "replace", find: "Saved tab one", text: "" }]) {
    await assert.rejects(fixture.context.previewBookmarkBatch(request(fixture, "rename", ["210"], extra)));
  }
});

test("batch move skips bookmarks already at the destination and undo restores native order across folders", async () => {
  const fixture = createFixture();
  const before = copy(fixture.root);
  const payload = request(fixture, "move", ["211", "201", "210", "200"], { folderId: "102" });
  const result = await fixture.context.applyBookmarkBatch(payload);
  assert.equal(result.changed, 3);
  assert.equal(result.unchanged, 1);
  assert.equal(fixture.find("210").parentId, "102");
  await fixture.context.undoLast();
  assert.deepEqual(fixture.root, before);
});

test("batch delete and undo preserve bookmark contents and order using only selected bookmarks", async () => {
  const fixture = createFixture();
  const original = [copy(fixture.find("210")), copy(fixture.find("211"))];
  await fixture.context.applyBookmarkBatch(request(fixture, "delete", ["211", "210"]));
  assert.equal(fixture.find("110").children.length, 0);
  assert.ok(fixture.find("200"));
  await fixture.context.undoLast();
  assert.deepEqual(fixture.find("110").children.map(({ title, url }) => ({ title, url })), original.map(({ title, url }) => ({ title, url })));
});

test("invalid, oversized, folder, missing, readonly and stale selections never partially mutate native bookmarks", async () => {
  const fixture = createFixture();
  const good = request(fixture, "delete", ["210"]);
  for (const payload of [
    { ...good, confirmed: false }, { ...good, ids: [] }, { ...good, ids: ["210", "210"] },
    { ...good, ids: Array.from({ length: 1001 }, (_, index) => String(index)) },
    { ...good, expected: [] }, { ...good, ids: ["missing"] },
    request(fixture, "delete", ["110"]), request(fixture, "delete", ["210", "401"]),
    { ...good, expected: [{ ...good.expected[0], url: "https://example.test/stale" }] }
  ]) await assert.rejects(fixture.context.applyBookmarkBatch(payload));
  assert.deepEqual(fixture.mutations, []);
});

test("a destination moved during undo storage is rejected without changing the prior undo", async () => {
  const fixture = createFixture();
  fixture.storage.lastUndo = { action: "rename", label: "Previous", renames: [] };
  const prior = copy(fixture.storage.lastUndo);
  const set = fixture.chrome.storage.local.set;
  fixture.chrome.storage.local.set = (values, callback) => {
    if (values.lastUndo?.operationId) {
      const destination = fixture.find("102");
      fixture.find("100").children = fixture.find("100").children.filter((node) => node.id !== "102");
      fixture.find("111").children.push(destination);
      destination.parentId = "111";
    }
    set(values, callback);
  };
  await assert.rejects(fixture.context.applyBookmarkBatch(request(fixture, "move", ["210"], { folderId: "102" })), /Destination moved/);
  assert.deepEqual(fixture.mutations, []);
  assert.deepEqual(fixture.storage.lastUndo, prior);
});

test("a partial native delete failure retains undo for successful deletions only", async () => {
  const fixture = createFixture();
  const remove = fixture.chrome.bookmarks.remove;
  fixture.chrome.bookmarks.remove = (id, callback) => { if (id === "211") throw new Error("Deletion denied"); remove(id, callback); };
  await assert.rejects(fixture.context.applyBookmarkBatch(request(fixture, "delete", ["211", "210"])), /Completed 1.*Deletion denied/);
  assert.equal(fixture.find("210"), undefined);
  assert.ok(fixture.find("211"));
  assert.equal(fixture.storage.lastUndo.snapshots.length, 1);
  await fixture.context.undoLast();
  assert.deepEqual(fixture.find("110").children.map((node) => node.title), ["Window tab one", "Window tab two"]);
});

test("changes to a remaining selected title stop a batch and preserve only successful rename undo", async () => {
  const fixture = createFixture();
  const update = fixture.chrome.bookmarks.update;
  fixture.chrome.bookmarks.update = (id, changes, callback) => update(id, changes, (result) => {
    if (id === "210") fixture.find("211").title = "Manual edit";
    callback(result);
  });
  await assert.rejects(fixture.context.applyBookmarkBatch(request(fixture, "rename", ["210", "211"], { mode: "prefix", text: "Read " })), /Completed 1.*changed/);
  assert.equal(fixture.find("211").title, "Manual edit");
  assert.deepEqual(fixture.storage.lastUndo.renames.map((item) => item.id), ["210"]);
});

test("queued overlapping batches cannot apply the same stale rename twice", async () => {
  const fixture = createFixture();
  const payload = request(fixture, "rename", ["210"], { mode: "prefix", text: "Read " });
  const results = await Promise.allSettled([fixture.context.applyBookmarkBatch(payload), fixture.context.applyBookmarkBatch(payload)]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(fixture.find("210").title, "Read Window tab one");
  assert.equal(fixture.storage.lastUndo.renames[0].oldTitle, "Window tab one");
});

test("undo storage failure prevents mutation and a later batch can retry", async () => {
  const fixture = createFixture();
  const set = fixture.chrome.storage.local.set;
  fixture.chrome.storage.local.set = (values, callback) => {
    if (values.lastUndo?.operationId) throw new Error("Undo storage unavailable");
    set(values, callback);
  };
  const payload = request(fixture, "rename", ["210"], { mode: "prefix", text: "Read " });
  await assert.rejects(fixture.context.applyBookmarkBatch(payload), /Undo storage unavailable/);
  assert.deepEqual(fixture.mutations, []);
  fixture.chrome.storage.local.set = set;
  assert.equal((await fixture.context.applyBookmarkBatch(payload)).changed, 1);
});
