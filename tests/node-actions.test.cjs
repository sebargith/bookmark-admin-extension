const assert = require("node:assert/strict");
const test = require("node:test");
const { createFixture, copy } = require("./helpers/chrome-fixture.cjs");

function request(fixture, action, id, extra = {}) {
  const expected = [];
  fixture.context.walk(fixture.find(id), (node) => expected.push({
    id: node.id, parentId: node.parentId, title: node.title, url: node.url ?? null, index: node.index
  }));
  const payload = { action, id, expected, confirmed: true, ...extra };
  if (payload.folderId) {
    payload.destinationPath = [];
    let node = fixture.find(payload.folderId);
    while (node && node.id !== "0") {
      payload.destinationPath.unshift(node.id);
      node = fixture.find(node.parentId);
    }
  }
  return payload;
}

function priorUndo(fixture) {
  const prior = { action: "rename", label: "Previous", renames: [] };
  fixture.storage.lastUndo = copy(prior);
  return prior;
}

test("single bookmark and folder rename/move retain identity and native order through undo", async () => {
  for (const id of ["210", "111"]) {
    for (const action of ["rename", "move"]) {
      const fixture = createFixture();
      const before = copy(fixture.root);
      fixture.storage.metadataByUrl = { "https://example.test/210": { notes: "Keep" } };
      const payload = request(fixture, action, id, action === "rename" ? { title: "Updated" } : { folderId: "102" });
      assert.equal((await fixture.context.applyNodeAction(payload)).changed, 1);
      assert.equal(fixture.find(id)[action === "rename" ? "title" : "parentId"], action === "rename" ? "Updated" : "102");
      assert.equal(fixture.storage.metadataByUrl["https://example.test/210"].notes, "Keep");
      await fixture.context.undoLast();
      assert.deepEqual(fixture.root, before);
    }
  }
});

test("delete/undo restores native nested contents, order and saved-window metadata under new IDs", async () => {
  const fixture = createFixture();
  const record = { capturedAt: Date.UTC(2026, 1, 1), originalTabCount: 1 };
  fixture.storage.savedWindows = { "112": record };
  const original = copy(fixture.find("111"));
  await fixture.context.applyNodeAction(request(fixture, "delete", "111"));
  assert.equal(fixture.find("111"), undefined);
  assert.deepEqual(fixture.storage.lastUndo.snapshots[0].savedWindows, { "112": record });
  await fixture.context.undoLast();
  const restored = fixture.find("1").children[original.index];
  assert.equal(restored.title, original.title);
  assert.notEqual(restored.id, original.id);
  assert.equal(restored.children[0].title, original.children[0].title);
  assert.equal(restored.children[0].children[0].url, original.children[0].children[0].url);
  assert.equal(restored.children[0].children[0].index, 0);
  assert.deepEqual(fixture.storage.savedWindows[restored.children[0].id], record);
});

test("bookmark delete/undo restores title, URL and sibling position", async () => {
  const fixture = createFixture();
  const original = copy(fixture.find("210"));
  await fixture.context.applyNodeAction(request(fixture, "delete", "210"));
  assert.equal(fixture.find("210"), undefined);
  await fixture.context.undoLast();
  const restored = fixture.find("110").children[0];
  assert.equal(restored.title, original.title);
  assert.equal(restored.url, original.url);
  assert.equal(restored.index, original.index);
});

test("complete subtree comparison rejects every changed field, membership and preorder", async () => {
  for (const change of [
    (p) => { p.expected[1].id = "other"; },
    (p) => { p.expected[1].parentId = "other"; },
    (p) => { p.expected[1].title = "Old"; },
    (p) => { p.expected[1].url = "https://old.test/"; },
    (p) => { p.expected[1].index += 1; },
    (p) => { delete p.expected[1].index; },
    (p) => { delete p.expected[0].url; },
    (p) => { p.expected.pop(); },
    (p) => { p.expected.push(copy(p.expected[1])); },
    (p) => { [p.expected[1], p.expected[2]] = [p.expected[2], p.expected[1]]; }
  ]) {
    const fixture = createFixture();
    const prior = priorUndo(fixture);
    const payload = request(fixture, "delete", "110");
    change(payload);
    await assert.rejects(fixture.context.applyNodeAction(payload), /changed/);
    assert.deepEqual(fixture.mutations, []);
    assert.deepEqual(fixture.storage.lastUndo, prior);
  }
});

test("protected and inherited read-only subtrees are rejected for every action", async () => {
  for (const action of ["rename", "move", "delete"]) {
    for (const id of ["0", "1", "100", "101", "400", "401"]) {
      const fixture = createFixture();
      await assert.rejects(fixture.context.applyNodeAction(request(fixture, action, id, { title: "Changed", folderId: "102" })), /protected or read-only/);
      assert.deepEqual(fixture.mutations, []);
    }
    const fixture = createFixture();
    const payload = request(fixture, action, "111", { title: "Changed", folderId: "102" });
    fixture.find("112").unmodifiable = "managed";
    await assert.rejects(fixture.context.applyNodeAction(payload), /protected or read-only/);
    assert.deepEqual(fixture.mutations, []);
  }
});

test("noops, invalid confirmation/titles, cycles and root/read-only destinations preserve prior undo", async () => {
  const fixture = createFixture();
  const prior = priorUndo(fixture);
  const rename = request(fixture, "rename", "111", { title: "Reference" });
  const requests = [rename, { ...rename, confirmed: false }, { ...rename, action: "other" },
    { ...rename, title: " " }, { ...rename, title: "x".repeat(1001) },
    ...["1", "111", "112", "0", "400", "missing", "210"].map((folderId) => request(fixture, "move", "111", { folderId }))];
  for (const payload of requests) await assert.rejects(fixture.context.applyNodeAction(payload));
  assert.deepEqual(fixture.mutations, []);
  assert.deepEqual(fixture.storage.lastUndo, prior);
});

test("destination paths are checked before intent storage and rechecked afterward, even when omitted", async () => {
  for (const omitPath of [false, true]) {
    const fixture = createFixture();
    const prior = priorUndo(fixture);
    const payload = request(fixture, "move", "210", { folderId: "102" });
    await assert.rejects(fixture.context.applyNodeAction({ ...payload, destinationPath: ["102"] }), /Destination moved/);
    if (omitPath) delete payload.destinationPath;
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
    await assert.rejects(fixture.context.applyNodeAction(payload), /Destination moved/);
    assert.deepEqual(fixture.mutations, []);
    assert.deepEqual(fixture.storage.lastUndo, prior);
  }
});

test("subtree changes during intent storage prevent native mutation", async () => {
  const fixture = createFixture();
  const prior = priorUndo(fixture);
  const payload = request(fixture, "rename", "111", { title: "Updated" });
  const set = fixture.chrome.storage.local.set;
  fixture.chrome.storage.local.set = (values, callback) => {
    if (values.lastUndo?.operationId) fixture.find("213").title = "External edit";
    set(values, callback);
  };
  await assert.rejects(fixture.context.applyNodeAction(payload), /changed/);
  assert.deepEqual(fixture.mutations, []);
  assert.deepEqual(fixture.storage.lastUndo, prior);
});

test("native operation failures propagate and restore prior undo for every action", async () => {
  for (const [action, method, id] of [["rename", "update", "111"], ["move", "move", "111"],
    ["delete", "removeTree", "111"], ["delete", "remove", "210"]]) {
    const fixture = createFixture();
    const prior = priorUndo(fixture);
    const before = copy(fixture.root);
    fixture.chrome.bookmarks[method] = (...args) => {
      fixture.chrome.runtime.lastError = { message: "Native denied" };
      args.at(-1)();
      delete fixture.chrome.runtime.lastError;
    };
    await assert.rejects(fixture.context.applyNodeAction(request(fixture, action, id, { title: "Updated", folderId: "102" })), /Native denied/);
    assert.deepEqual(fixture.root, before);
    assert.deepEqual(fixture.storage.lastUndo, prior);
  }
});

test("storage failure prevents mutation, reports recovery errors and permits queued retries", async () => {
  const fixture = createFixture();
  const prior = priorUndo(fixture);
  const payload = request(fixture, "rename", "210", { title: "Updated" });
  const set = fixture.chrome.storage.local.set;
  fixture.chrome.storage.local.set = (values, callback) => {
    if (values.lastUndo) throw new Error("Storage unavailable");
    set(values, callback);
  };
  await assert.rejects(fixture.context.applyNodeAction(payload), /Storage unavailable/);
  assert.deepEqual(fixture.mutations, []);
  assert.deepEqual(fixture.storage.lastUndo, prior);
  fixture.chrome.storage.local.set = set;
  assert.equal((await fixture.context.applyNodeAction(payload)).changed, 1);

  const failed = createFixture();
  priorUndo(failed);
  const failedSet = failed.chrome.storage.local.set;
  failed.chrome.storage.local.set = (values, callback) => {
    if (values.lastUndo?.label === "Previous") throw new Error("Recovery storage unavailable");
    failedSet(values, callback);
  };
  failed.chrome.bookmarks.update = () => { throw new Error("Native denied"); };
  await assert.rejects(failed.context.applyNodeAction(request(failed, "rename", "210", { title: "Updated" })), /Native denied.*Undo recovery failed.*Recovery storage unavailable/);
});

test("persisted subtree-delete intent does not duplicate a surviving original tree", async () => {
  const fixture = createFixture();
  const before = copy(fixture.root);
  fixture.chrome.bookmarks.removeTree = () => new Promise(() => {});
  // Simulate worker shutdown after durable intent but before the native delete callback.
  fixture.context.applyNodeAction(request(fixture, "delete", "111"));
  for (let i = 0; i < 20 && !fixture.storage.lastUndo; i += 1) await new Promise(setImmediate);
  assert.equal(fixture.storage.lastUndo.verifyDeletedIds, true);
  await fixture.context.undoLast();
  assert.deepEqual(fixture.root, before);
  assert.deepEqual(fixture.mutations, []);
});

test("node actions share batch serialization and runtime exposes the command", async () => {
  const fixture = createFixture();
  const payload = request(fixture, "rename", "210", { title: "Updated" });
  const batch = { action: "rename", ids: ["210"], expected: copy(payload.expected), confirmed: true, mode: "prefix", text: "Read " };
  const results = await Promise.allSettled([fixture.context.applyNodeAction(payload), fixture.context.applyBookmarkBatch(batch)]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(fixture.find("210").title, "Updated");
  const response = await new Promise((resolve) => fixture.listeners.message[0]({ type: "applyNodeAction",
    payload: request(fixture, "rename", "211", { title: "Runtime title" }) }, {}, resolve));
  assert.equal(response.ok, true);
  assert.equal(fixture.find("211").title, "Runtime title");
});
