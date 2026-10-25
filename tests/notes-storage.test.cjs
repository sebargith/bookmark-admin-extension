const assert = require("node:assert/strict");
const test = require("node:test");
const { createFixture, copy } = require("./helpers/chrome-fixture.cjs");

test("concurrent metadata writes retain notes for separate bookmarks", async () => {
  const fixture = createFixture();
  fixture.chrome.storage.local.get = (defaults, callback) => {
    const snapshot = copy({ ...defaults, ...fixture.storage });
    setImmediate(() => callback(snapshot));
  };
  fixture.chrome.storage.local.set = (values, callback) => setImmediate(() => {
    Object.assign(fixture.storage, copy(values)); callback();
  });
  await Promise.all([
    fixture.context.updateMetadata({ id: "200", notes: "First note" }),
    fixture.context.updateMetadata({ id: "201", notes: "Second note" })
  ]);
  assert.equal(fixture.storage.metadataByUrl["https://example.test/200"].notes, "First note");
  assert.equal(fixture.storage.metadataByUrl["https://example.test/201"].notes, "Second note");
});

test("indexing and link checking merge their results without overwriting notes saved while they run", async () => {
  for (const operation of ["refreshIndex", "checkLinks"]) {
    const fixture = createFixture();
    let release;
    let started;
    const gate = new Promise((resolve) => { release = resolve; });
    const request = new Promise((resolve) => { started = resolve; });
    const work = async () => {
      started(); await gate;
      return operation === "refreshIndex" ? { autoTags: ["sample"], indexedAt: "2026-01-01" }
        : { state: "ok", code: 200 };
    };
    if (operation === "refreshIndex") fixture.context.buildPageIndex = work;
    else fixture.context.checkUrl = work;
    const running = fixture.context[operation]({ ids: ["200"] });
    await request;
    await fixture.context.updateMetadata({ id: "200", notes: "New note on checked page" });
    await fixture.context.updateMetadata({ id: "201", notes: "New note on another page" });
    release();
    await running;
    assert.equal(fixture.storage.metadataByUrl["https://example.test/200"].notes, "New note on checked page");
    assert.equal(fixture.storage.metadataByUrl["https://example.test/201"].notes, "New note on another page");
  }
});

test("a failed write does not block later saves and URL-based exit saves retain the latest note", async () => {
  const fixture = createFixture();
  const originalSet = fixture.chrome.storage.local.set;
  fixture.chrome.storage.local.set = (values, callback) => {
    fixture.chrome.runtime.lastError = { message: "Storage unavailable" };
    callback();
    delete fixture.chrome.runtime.lastError;
  };
  await assert.rejects(fixture.context.updateMetadata({ url: "https://example.test/200", notes: "Retry me" }), /Storage unavailable/);
  fixture.chrome.storage.local.set = originalSet;
  await fixture.context.updateMetadata({ url: "https://example.test/200", notes: "Latest note" });
  assert.equal(fixture.storage.metadataByUrl["https://example.test/200"].notes, "Latest note");
});
