const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const copy = (value) => JSON.parse(JSON.stringify(value));

function createFixture() {
  const dateAdded = Date.UTC(2026, 0, 1);
  const bookmark = (id, title, url = `https://example.test/${id}`) => ({ id, title, url, dateAdded });
  const folder = (id, title, children, extra = {}) => ({ id, title, children, dateAdded, ...extra });
  const root = folder("0", "", [
    folder("1", "Bookmarks bar", [
      folder("110", "nuevo6", [bookmark("210", "Window tab one"), bookmark("211", "Window tab two")]),
      folder("111", "Reference", [folder("112", "nuevo99", [bookmark("213", "Nested lookalike")])]),
      bookmark("214", "nuevo200")
    ], { folderType: "bookmarks-bar" }),
    folder("10", "Account bookmarks bar", [
      folder("120", "nuevo 10", [bookmark("212", "Account window tab")])
    ], { folderType: "bookmarks-bar", syncing: true }),
    folder("2", "Other bookmarks", [
      folder("100", "Bookmark Admin", [
        folder("101", "All", [bookmark("200", "Library saved page")]),
        folder("102", "Research", [bookmark("201", "Library research page")])
      ]),
      folder("130", "nuevo55", [bookmark("215", "Outside library page")])
    ], { folderType: "other" }),
    folder("3", "Mobile bookmarks", [bookmark("216", "Mobile page")], { folderType: "mobile" }),
    folder("4", "Managed bookmarks", [
      folder("400", "Company", [bookmark("401", "Company page")])
    ], { folderType: "managed", unmodifiable: "managed" })
  ]);
  function reindex(node = root, parent) {
    if (parent) node.parentId = parent.id;
    (node.children || []).forEach((child, index) => { child.index = index; reindex(child, node); });
  }
  reindex();
  const find = (id, node = root) => node.id === id ? node
    : (node.children || []).map((child) => find(id, child)).find(Boolean);
  const storage = { settings: { managedRootId: "100", defaultFolderId: "101", lastSavedFolderId: "102" } };
  const mutations = [];
  const tabsCreated = [];
  const windowsCreated = [];
  const listeners = {};
  let nextId = 1000;
  const event = (name) => ({
    addListener(fn) { (listeners[name] ||= []).push(fn); },
    removeListener(fn) { listeners[name] = (listeners[name] || []).filter((item) => item !== fn); }
  });
  const done = (callback, result) => callback(copy(result));
  const chrome = {
    runtime: { getURL: (file) => `chrome-extension://fixture/${file}`, onInstalled: event("installed"), onStartup: event("startup"), onMessage: event("message") },
    bookmarks: {
      getTree: (callback) => done(callback, [root]),
      getSubTree: (id, callback) => done(callback, find(id) ? [find(id)] : []),
      get: (id, callback) => done(callback, find(id) ? [find(id)] : []),
      getChildren: (id, callback) => done(callback, find(id).children),
      create(details, callback) {
        mutations.push({ type: "create", ...copy(details) });
        const node = { id: String(nextId++), dateAdded, ...details };
        if (!node.url) node.children = [];
        find(details.parentId).children.splice(details.index ?? find(details.parentId).children.length, 0, node);
        reindex();
        done(callback, node);
      },
      update(id, changes, callback) {
        mutations.push({ type: "update", id, ...copy(changes) });
        Object.assign(find(id), changes);
        done(callback, find(id));
      },
      move(id, destination, callback) {
        mutations.push({ type: "move", id, ...copy(destination) });
        const node = find(id);
        const oldParent = find(node.parentId);
        oldParent.children = oldParent.children.filter((child) => child.id !== id);
        const parent = find(destination.parentId || node.parentId);
        parent.children.splice(destination.index ?? parent.children.length, 0, node);
        reindex();
        done(callback, node);
      },
      remove(id, callback) {
        mutations.push({ type: "remove", id });
        const node = find(id);
        const parent = find(node.parentId);
        parent.children = parent.children.filter((child) => child.id !== id);
        reindex();
        callback();
      }
    },
    storage: { local: {
      get(defaults, callback) { done(callback, { ...defaults, ...copy(storage) }); },
      set(values, callback) { Object.assign(storage, copy(values)); callback(); },
      remove(key, callback) { delete storage[key]; callback(); }
    } },
    contextMenus: { onClicked: event("contextMenu") }, commands: { onCommand: event("command") },
    tabs: { create: (details, callback) => { tabsCreated.push(copy(details)); done(callback, { id: 1, ...details }); } },
    windows: { create: (details, callback) => { windowsCreated.push(copy(details)); done(callback, { id: 10, ...details }); } }
  };
  chrome.bookmarks.removeTree = chrome.bookmarks.remove;
  for (const name of ["onCreated", "onChanged", "onMoved", "onRemoved", "onChildrenReordered", "onImportEnded"]) {
    chrome.bookmarks[name] = event(name);
  }
  const context = vm.createContext({ chrome, URL, console, setTimeout, clearTimeout,
    fetch: () => { throw new Error("Navigation must not fetch pages"); } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "service-worker.js"), "utf8"), context);
  return { context, root, find, storage, mutations, tabsCreated, windowsCreated, chrome, listeners };
}

module.exports = { createFixture, copy };
