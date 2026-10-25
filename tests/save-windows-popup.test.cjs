const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "popup.js"), "utf8");

function setup() {
  let reply;
  let requestCount = 0;
  const label = { textContent: "Save all windows" };
  const button = { disabled: false, querySelector: () => label };
  const status = { hidden: true, textContent: "" };
  const elements = { saveAllWindows: button, windowSaveStatus: status };
  const context = vm.createContext({
    document: { addEventListener() {}, getElementById: (id) => elements[id] },
    chrome: { runtime: { sendMessage: (message, callback) => {
      assert.equal(message.type, "saveAllWindows");
      requestCount += 1;
      reply = callback;
    } } },
    window: { close: () => { throw new Error("Capture must leave the popup open for its result"); } }
  });
  vm.runInContext(source, context);
  context.cacheElements();
  return { context, label, button, status, reply: (value) => reply(value), requestCount: () => requestCount };
}

test("popup prevents a second click and reports saved folders without needing the current page state", async () => {
  const fixture = setup();
  const pending = fixture.context.saveWindowTabs();
  assert.equal(fixture.button.disabled, true);
  assert.equal(fixture.label.textContent, "Saving windows...");
  await fixture.context.saveWindowTabs();
  assert.equal(fixture.requestCount(), 1);
  fixture.reply({ ok: true, result: {
    folders: [{ title: "nuevo7" }, { title: "nuevo8" }], savedTabCount: 5,
    skippedTabCount: 1, failedTabCount: 0, failedWindowCount: 0
  } });
  await pending;
  assert.equal(fixture.status.hidden, false);
  assert.equal(fixture.status.textContent, "Saved 5 tabs in 2 folders: nuevo7, nuevo8. 1 unsupported tab skipped.");
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.label.textContent, "Save all windows");
});

test("popup reports partial failures rather than claiming every tab was saved", async () => {
  const fixture = setup();
  const pending = fixture.context.saveWindowTabs();
  fixture.reply({ ok: true, result: {
    folders: [{ title: "nuevo7" }], savedTabCount: 2,
    skippedTabCount: 0, failedTabCount: 1, failedWindowCount: 1
  } });
  await pending;
  assert.equal(fixture.status.textContent,
    "Saved 2 tabs in 1 folder: nuevo7. 1 tab could not be saved. 1 window folder could not be created.");
});

test("popup shows a background error and enables a retry", async () => {
  const fixture = setup();
  const pending = fixture.context.saveWindowTabs();
  fixture.reply({ ok: false, error: "Chrome's bookmarks bar is unavailable or read-only." });
  await pending;
  assert.match(fixture.status.textContent, /unavailable or read-only/);
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.status.hidden, false);
});

test("popup distinguishes saved bookmarks from capture metadata storage failure", async () => {
  const fixture = setup();
  const pending = fixture.context.saveWindowTabs();
  fixture.reply({ ok: true, result: { folders: [{ title: "nuevo7" }], savedTabCount: 1, metadataFailedWindowCount: 1 } });
  await pending;
  assert.match(fixture.status.textContent, /Saved 1 tab/);
  assert.match(fixture.status.textContent, /capture details could not be stored/);
  assert.equal(fixture.button.disabled, false);
});
