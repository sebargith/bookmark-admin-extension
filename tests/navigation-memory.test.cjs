const assert = require("node:assert/strict");
const test = require("node:test");
const { createFixture, copy } = require("./helpers/chrome-fixture.cjs");

test("manager navigation persists native IDs without changing bookmarks or quick-save settings", async () => {
  const fixture = createFixture();
  const before = copy(fixture.root);
  const settings = copy(fixture.storage.settings);
  const navigation = { view: "all", selectedByView: { library: "102", windows: "110", all: "112" }, expanded: ["1", "111", "112"] };
  await fixture.context.saveManagerNavigation(navigation);
  assert.deepEqual(copy((await fixture.context.getManagerState()).navigation), navigation);
  assert.deepEqual(fixture.storage.settings, settings);
  assert.deepEqual(fixture.root, before);
  assert.deepEqual(fixture.mutations, []);
});

test("navigation normalizes corrupt storage and bounds persisted IDs without retaining unrelated data", async () => {
  const fixture = createFixture();
  fixture.storage.managerNavigation = { view: "invalid", selectedByView: { library: 100, all: "x".repeat(129) }, expanded: "broken", notes: "not navigation" };
  assert.deepEqual(copy((await fixture.context.getManagerState()).navigation), {
    view: "library", selectedByView: { library: null, windows: null, all: null }, expanded: []
  });
  await fixture.context.saveManagerNavigation({ view: "windows", expanded: [null, {}, "110", "110", ...Array.from({ length: 6000 }, (_, i) => String(i))] });
  assert.equal(fixture.storage.managerNavigation.expanded.length, 5000);
  assert.equal(fixture.storage.managerNavigation.expanded[0], "110");
  assert.equal(Object.hasOwn(fixture.storage.managerNavigation, "notes"), false);
});

test("concurrent navigation writes finish in arrival order and recover after storage failure", async () => {
  const fixture = createFixture();
  const originalSet = fixture.chrome.storage.local.set;
  let fail = true;
  fixture.chrome.storage.local.set = (value, callback) => {
    if (fail) { fail = false; throw new Error("Storage unavailable"); }
    originalSet(value, callback);
  };
  await assert.rejects(fixture.context.saveManagerNavigation({ view: "all" }), /Storage unavailable/);
  await Promise.all([
    fixture.context.saveManagerNavigation({ view: "windows" }),
    fixture.context.saveManagerNavigation({ view: "library" })
  ]);
  assert.equal(fixture.storage.managerNavigation.view, "library");
});
