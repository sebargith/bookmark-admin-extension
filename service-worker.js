const MANAGED_ROOT_TITLE = "Bookmark Admin";
const DEFAULT_FOLDER_TITLE = "All";

const STORAGE_KEYS = {
  SETTINGS: "settings",
  METADATA: "metadataByUrl",
  UNDO: "lastUndo",
  CHANGE_FEED: "changeFeed",
  REVISION: "bookmarkRevision",
  PENDING_POPUP_MODE: "pendingPopupMode"
};

let suppressEventsUntil = 0;

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "because", "before", "being",
  "between", "both", "could", "does", "doing", "down", "during", "each",
  "from", "further", "here", "hers", "himself", "into", "itself", "just",
  "more", "most", "other", "ours", "over", "same", "should", "some",
  "such", "than", "that", "their", "them", "then", "there", "these",
  "they", "this", "those", "through", "under", "until", "very", "what",
  "when", "where", "which", "while", "with", "would", "your", "para",
  "como", "esta", "este", "esto", "estos", "esas", "esos", "desde",
  "donde", "cuando", "porque", "sobre", "entre", "tambien", "pero",
  "todo", "todos", "todas", "cada", "mucho", "muchos", "hacer", "hace"
]);

function chromeCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    try {
      fn(...args, (...callbackArgs) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(callbackArgs.length <= 1 ? callbackArgs[0] : callbackArgs);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function stamp() {
  return new Date().toISOString();
}

function safeTitle(value) {
  return String(value || "").trim();
}

function normalizeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if ((parsed.protocol === "http:" && parsed.port === "80") ||
        (parsed.protocol === "https:" && parsed.port === "443")) {
      parsed.port = "";
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

function normalizeTags(tags) {
  const values = Array.isArray(tags)
    ? tags
    : String(tags || "").split(",");
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const tag = String(value || "").trim();
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }

  return result;
}

function uniqueValues(values, limit = 100) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const clean = String(value || "").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= limit) break;
  }

  return result;
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, " ");
}

function getMetaContent(html, name) {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  const reversed = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["'][^>]*>`, "i");
  const match = html.match(pattern) || html.match(reversed);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function stripHtml(html) {
  return decodeHtmlEntities(String(html || "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "));
}

function keywordTerms(text, limit = 80) {
  const counts = new Map();
  const words = String(text || "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || [];

  for (const word of words) {
    const clean = word.replace(/^-+|-+$/g, "");
    if (clean.length < 3 || clean.length > 32) continue;
    if (STOP_WORDS.has(clean)) continue;
    if (/^\d+$/.test(clean)) continue;
    counts.set(clean, (counts.get(clean) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

function domainTerms(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname
      .replace(/^www\./, "")
      .split(/[.-]/)
      .filter((part) => part.length > 2);
  } catch {
    return [];
  }
}

async function buildPageIndex(url, title) {
  const fallbackTerms = uniqueValues([
    ...keywordTerms(title, 20),
    ...domainTerms(url)
  ], 30);

  if (!/^https?:\/\//i.test(url)) {
    return {
      autoTags: fallbackTerms.slice(0, 8),
      indexTerms: fallbackTerms,
      indexedAt: stamp(),
      indexStatus: {
        state: "warning",
        message: "Unsupported URL scheme",
        checkedAt: stamp()
      }
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return {
        autoTags: fallbackTerms.slice(0, 8),
        indexTerms: fallbackTerms,
        indexedAt: stamp(),
        indexStatus: {
          state: "warning",
          message: `Skipped ${contentType || "non-text content"}`,
          checkedAt: stamp()
        }
      };
    }

    const html = (await response.text()).slice(0, 450000);
    const pageTitle = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
    const description = getMetaContent(html, "description") || getMetaContent(html, "og:description");
    const keywords = getMetaContent(html, "keywords");
    const body = stripHtml(html).slice(0, 120000);
    const combined = [
      title,
      pageTitle,
      description,
      keywords,
      body,
      ...domainTerms(url)
    ].join(" ");
    const terms = uniqueValues([...keywordTerms(combined, 100), ...fallbackTerms], 100);

    return {
      autoTags: terms.slice(0, 8),
      indexTerms: terms,
      indexedAt: stamp(),
      indexStatus: {
        state: response.ok ? "ok" : "warning",
        code: response.status,
        message: response.ok ? "Indexed" : `Indexed with HTTP ${response.status}`,
        checkedAt: stamp()
      }
    };
  } catch (error) {
    return {
      autoTags: fallbackTerms.slice(0, 8),
      indexTerms: fallbackTerms,
      indexedAt: stamp(),
      indexStatus: {
        state: "warning",
        message: error.name === "AbortError" ? "Indexing timed out" : error.message,
        checkedAt: stamp()
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function storageGet(keys) {
  return chromeCall(chrome.storage.local.get.bind(chrome.storage.local), keys);
}

async function storageSet(values) {
  return chromeCall(chrome.storage.local.set.bind(chrome.storage.local), values);
}

async function storageRemove(keys) {
  return chromeCall(chrome.storage.local.remove.bind(chrome.storage.local), keys);
}

async function getSettings() {
  const data = await storageGet({ [STORAGE_KEYS.SETTINGS]: {} });
  return data[STORAGE_KEYS.SETTINGS] || {};
}

async function saveSettings(settings) {
  await storageSet({ [STORAGE_KEYS.SETTINGS]: settings });
}

async function getMetadataMap() {
  const data = await storageGet({ [STORAGE_KEYS.METADATA]: {} });
  return data[STORAGE_KEYS.METADATA] || {};
}

async function saveMetadataMap(metadata) {
  await storageSet({ [STORAGE_KEYS.METADATA]: metadata });
}

async function getNode(id) {
  if (!id) return null;
  try {
    const nodes = await chromeCall(chrome.bookmarks.get.bind(chrome.bookmarks), id);
    return nodes && nodes[0] ? nodes[0] : null;
  } catch {
    return null;
  }
}

async function getSubTree(id) {
  const nodes = await chromeCall(chrome.bookmarks.getSubTree.bind(chrome.bookmarks), id);
  return nodes && nodes[0] ? nodes[0] : null;
}

function walk(node, visitor, parent = null) {
  visitor(node, parent);
  for (const child of node.children || []) {
    walk(child, visitor, node);
  }
}

function findFolderByTitle(root, title) {
  let match = null;
  walk(root, (node) => {
    if (!match && !node.url && node.title === title) {
      match = node;
    }
  });
  return match;
}

function findWritableRoot(treeRoot) {
  const children = treeRoot.children || [];
  const other = children.find((node) => !node.url && !node.unmodifiable && /other bookmarks/i.test(node.title || ""));
  if (other) return other;

  const bookmarksBar = children.find((node) => !node.url && !node.unmodifiable && /bookmarks bar/i.test(node.title || ""));
  if (bookmarksBar) return bookmarksBar;

  return children.find((node) => !node.url && !node.unmodifiable) || children.find((node) => !node.url);
}

function buildNodeMap(root) {
  const map = new Map();
  walk(root, (node) => map.set(node.id, node));
  return map;
}

function isDescendantOrSelf(id, ancestorId, nodeMap) {
  let currentId = id;
  while (currentId) {
    if (currentId === ancestorId) return true;
    const current = nodeMap.get(currentId);
    currentId = current && current.parentId;
  }
  return false;
}

function isFolder(node) {
  return node && !node.url;
}

async function ensureManagedArea() {
  const tree = await chromeCall(chrome.bookmarks.getTree.bind(chrome.bookmarks));
  const browserRoot = tree[0];
  const settings = await getSettings();

  let managedRoot = await getNode(settings.managedRootId);
  if (!isFolder(managedRoot)) {
    managedRoot = findFolderByTitle(browserRoot, MANAGED_ROOT_TITLE);
  }

  if (!isFolder(managedRoot)) {
    const parent = findWritableRoot(browserRoot);
    if (!parent) {
      throw new Error("Could not find a writable Chrome bookmark folder.");
    }
    managedRoot = await withInternalMutation(() =>
      chromeCall(chrome.bookmarks.create.bind(chrome.bookmarks), {
        parentId: parent.id,
        title: MANAGED_ROOT_TITLE
      })
    );
  }

  const rootTree = await getSubTree(managedRoot.id);
  const nodeMap = buildNodeMap(rootTree);

  let defaultFolder = await getNode(settings.defaultFolderId);
  if (!isFolder(defaultFolder) || !isDescendantOrSelf(defaultFolder.id, managedRoot.id, nodeMap)) {
    defaultFolder = (rootTree.children || []).find((node) => !node.url && node.title === DEFAULT_FOLDER_TITLE);
  }

  if (!isFolder(defaultFolder)) {
    defaultFolder = await withInternalMutation(() =>
      chromeCall(chrome.bookmarks.create.bind(chrome.bookmarks), {
        parentId: managedRoot.id,
        title: DEFAULT_FOLDER_TITLE
      })
    );
  }

  const nextSettings = {
    ...settings,
    managedRootId: managedRoot.id,
    defaultFolderId: defaultFolder.id
  };

  if (nextSettings.selectedFolderId) {
    const selected = await getNode(nextSettings.selectedFolderId);
    const latestRoot = await getSubTree(managedRoot.id);
    const latestMap = buildNodeMap(latestRoot);
    if (!isFolder(selected) || !isDescendantOrSelf(selected.id, managedRoot.id, latestMap)) {
      nextSettings.selectedFolderId = defaultFolder.id;
    }
  }

  await saveSettings(nextSettings);
  return {
    managedRoot,
    defaultFolder,
    settings: nextSettings
  };
}

async function withInternalMutation(work) {
  suppressEventsUntil = Math.max(suppressEventsUntil, Date.now() + 2500);
  try {
    return await work();
  } finally {
    suppressEventsUntil = Math.max(suppressEventsUntil, Date.now() + 1200);
  }
}

function flattenManagedData(root, metadataByUrl) {
  const folders = [];
  const bookmarks = [];
  const byUrl = new Map();

  function visit(node, path, ancestors) {
    if (!node.url) {
      if (node.id !== root.id) {
        const folderPath = [...path, node.title].join(" / ");
        folders.push({
          id: node.id,
          parentId: node.parentId,
          title: node.title,
          index: node.index,
          dateAdded: node.dateAdded,
          depth: path.length,
          path: folderPath
        });
      }

      const nextPath = node.id === root.id ? [] : [...path, node.title];
      const nextAncestors = node.id === root.id ? [] : [...ancestors, node.id];
      for (const child of node.children || []) {
        visit(child, nextPath, nextAncestors);
      }
      return;
    }

    const normalizedUrl = normalizeUrl(node.url);
    const metadata = metadataByUrl[normalizedUrl] || {};
    const bookmark = {
      id: node.id,
      parentId: node.parentId,
      title: node.title,
      url: node.url,
      normalizedUrl,
      index: node.index,
      dateAdded: node.dateAdded,
      dateLastUsed: node.dateLastUsed,
      folderId: node.parentId,
      folderAncestors: ancestors,
      folderPath: path.join(" / ") || DEFAULT_FOLDER_TITLE,
      metadata
    };
    bookmarks.push(bookmark);

    if (!byUrl.has(normalizedUrl)) byUrl.set(normalizedUrl, []);
    byUrl.get(normalizedUrl).push(bookmark);
  }

  visit(root, [], []);

  const duplicateGroups = Array.from(byUrl.values())
    .filter((group) => group.length > 1)
    .map((group) => ({
      normalizedUrl: group[0].normalizedUrl,
      count: group.length,
      bookmarks: group.map((item) => ({
        id: item.id,
        title: item.title,
        folderPath: item.folderPath,
        url: item.url
      }))
    }));

  return { folders, bookmarks, duplicateGroups };
}

async function getManagedState() {
  const area = await ensureManagedArea();
  const root = await getSubTree(area.managedRoot.id);
  const metadataByUrl = await getMetadataMap();
  const undoData = await storageGet({ [STORAGE_KEYS.UNDO]: null });
  const changeData = await storageGet({
    [STORAGE_KEYS.CHANGE_FEED]: [],
    [STORAGE_KEYS.REVISION]: 0
  });
  const flat = flattenManagedData(root, metadataByUrl);

  return {
    root,
    managedRoot: area.managedRoot,
    defaultFolder: area.defaultFolder,
    settings: area.settings,
    metadataByUrl,
    folders: flat.folders,
    bookmarks: flat.bookmarks,
    duplicateGroups: flat.duplicateGroups,
    lastUndo: undoData[STORAGE_KEYS.UNDO],
    changeFeed: changeData[STORAGE_KEYS.CHANGE_FEED] || [],
    bookmarkRevision: changeData[STORAGE_KEYS.REVISION] || 0
  };
}

function findBookmarksByUrl(root, normalizedUrl) {
  const matches = [];
  walk(root, (node) => {
    if (node.url && normalizeUrl(node.url) === normalizedUrl) {
      matches.push(node);
    }
  });
  return matches;
}

async function getValidFolderOrDefault(folderId, area) {
  const root = await getSubTree(area.managedRoot.id);
  const nodeMap = buildNodeMap(root);
  const candidate = await getNode(folderId);

  if (isFolder(candidate) && isDescendantOrSelf(candidate.id, area.managedRoot.id, nodeMap)) {
    return candidate;
  }

  return area.defaultFolder;
}

async function updateMetadataForUrl(normalizedUrl, patch) {
  const metadataByUrl = await getMetadataMap();
  const previous = metadataByUrl[normalizedUrl] || {};
  const next = {
    ...previous,
    updatedAt: stamp()
  };

  if (patch.createdAt && !next.createdAt) next.createdAt = patch.createdAt;
  if (patch.savedAt) next.savedAt = patch.savedAt;
  if (patch.notes !== undefined) next.notes = String(patch.notes || "");
  if (patch.tags !== undefined) {
    const existing = Array.isArray(next.tags) ? next.tags : [];
    const merged = normalizeTags([...existing, ...normalizeTags(patch.tags)]);
    next.tags = merged;
  }
  if (patch.replaceTags !== undefined) next.tags = normalizeTags(patch.replaceTags);
  if (patch.deadStatus !== undefined) next.deadStatus = patch.deadStatus;
  if (patch.autoTags !== undefined) next.autoTags = normalizeTags(patch.autoTags);
  if (patch.indexTerms !== undefined) next.indexTerms = uniqueValues(patch.indexTerms, 100);
  if (patch.indexedAt !== undefined) next.indexedAt = patch.indexedAt;
  if (patch.indexStatus !== undefined) next.indexStatus = patch.indexStatus;
  if (patch.lastOpenedAt !== undefined) next.lastOpenedAt = patch.lastOpenedAt;
  if (patch.useCount !== undefined) next.useCount = patch.useCount;

  metadataByUrl[normalizedUrl] = next;
  await saveMetadataMap(metadataByUrl);
  return next;
}

async function saveBookmark(payload = {}) {
  const area = await ensureManagedArea();
  const root = await getSubTree(area.managedRoot.id);
  const title = safeTitle(payload.title) || payload.url;
  const url = String(payload.url || "").trim();
  const normalizedUrl = normalizeUrl(url);

  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("Only http and https URLs can be saved.");
  }

  const existing = findBookmarksByUrl(root, normalizedUrl);
  const targetFolder = await getValidFolderOrDefault(payload.folderId, area);
  const now = stamp();
  const pageIndex = await buildPageIndex(url, title);

  if (existing.length && !payload.allowDuplicate) {
    await updateMetadataForUrl(normalizedUrl, {
      tags: payload.tags,
      notes: payload.notes,
      savedAt: now,
      ...pageIndex
    });
    return {
      duplicate: true,
      created: false,
      bookmark: existing[0],
      duplicates: existing
    };
  }

  const bookmark = await withInternalMutation(() =>
    chromeCall(chrome.bookmarks.create.bind(chrome.bookmarks), {
      parentId: targetFolder.id,
      title,
      url
    })
  );

  await updateMetadataForUrl(normalizedUrl, {
    tags: payload.tags,
    notes: payload.notes,
    createdAt: now,
    savedAt: now,
    ...pageIndex
  });

  return {
    duplicate: false,
    created: true,
    bookmark,
    folder: targetFolder
  };
}

async function getCurrentTab() {
  const tabs = await chromeCall(chrome.tabs.query.bind(chrome.tabs), {
    active: true,
    lastFocusedWindow: true
  });
  const tab = tabs && tabs[0];
  if (!tab || !tab.url) {
    throw new Error("No active tab with a URL was found.");
  }
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || tab.url,
    url: tab.url
  };
}

async function quickSaveCurrentPage(payload = {}) {
  const tab = await getCurrentTab();
  if (!isHttpUrl(payload.url || tab.url)) {
    throw new Error("Only normal http and https pages can be saved.");
  }
  return saveBookmark({
    ...payload,
    title: payload.title || tab.title,
    url: payload.url || tab.url
  });
}

async function createFolder(payload = {}) {
  const title = safeTitle(payload.title);
  if (!title) throw new Error("Folder title is required.");

  const area = await ensureManagedArea();
  let parent = area.managedRoot;
  if (payload.parentId) {
    parent = await getValidFolderOrDefault(payload.parentId, area);
    if (parent.id === area.defaultFolder.id && payload.parentId !== area.defaultFolder.id) {
      parent = area.managedRoot;
    }
  }

  const parentTree = await getSubTree(parent.id);
  const existing = (parentTree.children || []).find((node) => !node.url && node.title === title);
  if (existing) {
    return { folder: existing, existed: true };
  }

  const folder = await withInternalMutation(() =>
    chromeCall(chrome.bookmarks.create.bind(chrome.bookmarks), {
      parentId: parent.id,
      title
    })
  );

  return { folder, existed: false };
}

function filterTopLevelSelection(ids, nodeMap) {
  const selected = new Set(ids);
  return ids.filter((id) => {
    let parentId = nodeMap.get(id) && nodeMap.get(id).parentId;
    while (parentId) {
      if (selected.has(parentId)) return false;
      parentId = nodeMap.get(parentId) && nodeMap.get(parentId).parentId;
    }
    return true;
  });
}

async function setUndoSnapshot(snapshot) {
  await storageSet({
    [STORAGE_KEYS.UNDO]: {
      ...snapshot,
      createdAt: stamp()
    }
  });
}

async function bulkDelete(payload = {}) {
  const area = await ensureManagedArea();
  const root = await getSubTree(area.managedRoot.id);
  const nodeMap = buildNodeMap(root);
  const rawIds = Array.from(new Set(payload.ids || []));
  const ids = filterTopLevelSelection(rawIds, nodeMap)
    .filter((id) => id !== area.managedRoot.id && id !== area.defaultFolder.id)
    .filter((id) => nodeMap.has(id));

  if (!ids.length) throw new Error("No removable bookmarks or folders were selected.");

  const snapshots = [];
  for (const id of ids) {
    const node = nodeMap.get(id);
    snapshots.push({
      node: clone(await getSubTree(id)),
      parentId: node.parentId,
      index: node.index
    });
  }

  await setUndoSnapshot({
    action: "delete",
    label: `Deleted ${ids.length} item${ids.length === 1 ? "" : "s"}`,
    snapshots
  });

  await withInternalMutation(async () => {
    for (const id of ids) {
      const node = nodeMap.get(id);
      if (!node) continue;
      try {
        if (node.url) {
          await chromeCall(chrome.bookmarks.remove.bind(chrome.bookmarks), id);
        } else {
          await chromeCall(chrome.bookmarks.removeTree.bind(chrome.bookmarks), id);
        }
      } catch {
        // The node may already be gone if its parent folder was removed.
      }
    }
  });

  return { deleted: ids.length };
}

async function bulkMove(payload = {}) {
  const area = await ensureManagedArea();
  const root = await getSubTree(area.managedRoot.id);
  const nodeMap = buildNodeMap(root);
  const targetFolder = await getValidFolderOrDefault(payload.folderId, area);
  const rawIds = Array.from(new Set(payload.ids || []));
  const ids = filterTopLevelSelection(rawIds, nodeMap)
    .filter((id) => id !== area.managedRoot.id && id !== area.defaultFolder.id)
    .filter((id) => nodeMap.has(id));

  if (!ids.length) throw new Error("No movable bookmarks or folders were selected.");

  const moves = [];
  for (const id of ids) {
    const node = nodeMap.get(id);
    if (!node) continue;
    if (!node.url && isDescendantOrSelf(targetFolder.id, id, nodeMap)) continue;
    moves.push({
      id,
      oldParentId: node.parentId,
      oldIndex: node.index
    });
  }

  if (!moves.length) throw new Error("The selected items cannot be moved there.");

  await setUndoSnapshot({
    action: "move",
    label: `Moved ${moves.length} item${moves.length === 1 ? "" : "s"}`,
    moves
  });

  await withInternalMutation(async () => {
    for (const move of moves) {
      await chromeCall(chrome.bookmarks.move.bind(chrome.bookmarks), move.id, {
        parentId: targetFolder.id
      });
    }
  });

  return { moved: moves.length, folder: targetFolder };
}

async function moveNode(payload = {}) {
  return bulkMove({
    ids: [payload.id],
    folderId: payload.parentId
  });
}

async function renameNode(payload = {}) {
  const title = safeTitle(payload.title);
  if (!title) throw new Error("New title is required.");

  const area = await ensureManagedArea();
  const root = await getSubTree(area.managedRoot.id);
  const nodeMap = buildNodeMap(root);
  const node = nodeMap.get(payload.id);

  if (!node) throw new Error("Bookmark or folder was not found.");
  if (node.id === area.managedRoot.id || node.id === area.defaultFolder.id) {
    throw new Error("The managed root and All folder cannot be renamed.");
  }

  await setUndoSnapshot({
    action: "rename",
    label: "Renamed item",
    renames: [{
      id: node.id,
      oldTitle: node.title,
      newTitle: title
    }]
  });

  const updated = await withInternalMutation(() =>
    chromeCall(chrome.bookmarks.update.bind(chrome.bookmarks), node.id, { title })
  );

  return { node: updated };
}

async function bulkRename(payload = {}) {
  const area = await ensureManagedArea();
  const root = await getSubTree(area.managedRoot.id);
  const nodeMap = buildNodeMap(root);
  const ids = Array.from(new Set(payload.ids || []))
    .filter((id) => id !== area.managedRoot.id && id !== area.defaultFolder.id)
    .filter((id) => nodeMap.has(id));

  if (!ids.length) throw new Error("No renameable bookmarks or folders were selected.");

  const renames = [];
  for (const id of ids) {
    const node = nodeMap.get(id);
    const oldTitle = node.title || "";
    let newTitle = oldTitle;

    if (payload.mode === "set") {
      newTitle = safeTitle(payload.title);
    } else if (payload.mode === "replace") {
      const find = String(payload.find || "");
      if (!find) continue;
      newTitle = oldTitle.split(find).join(String(payload.replacement || ""));
    } else if (payload.mode === "prefix") {
      newTitle = `${String(payload.prefix || "")}${oldTitle}`;
    } else if (payload.mode === "suffix") {
      newTitle = `${oldTitle}${String(payload.suffix || "")}`;
    }

    newTitle = safeTitle(newTitle);
    if (!newTitle || newTitle === oldTitle) continue;

    renames.push({
      id,
      oldTitle,
      newTitle
    });
  }

  if (!renames.length) throw new Error("No titles would change.");

  await setUndoSnapshot({
    action: "rename",
    label: `Renamed ${renames.length} item${renames.length === 1 ? "" : "s"}`,
    renames
  });

  await withInternalMutation(async () => {
    for (const rename of renames) {
      await chromeCall(chrome.bookmarks.update.bind(chrome.bookmarks), rename.id, {
        title: rename.newTitle
      });
    }
  });

  return { renamed: renames.length };
}

async function sortFolder(payload = {}) {
  const area = await ensureManagedArea();
  const folder = await getValidFolderOrDefault(payload.folderId || area.managedRoot.id, area);
  const folderTree = await getSubTree(folder.id);
  const children = folderTree.children || [];
  const metadataByUrl = await getMetadataMap();

  if (children.length < 2) {
    return { sorted: 0 };
  }

  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  const mode = payload.mode || "title-asc";
  const sorted = [...children].sort((a, b) => {
    if (mode === "newest") return (b.dateAdded || 0) - (a.dateAdded || 0);
    if (mode === "oldest") return (a.dateAdded || 0) - (b.dateAdded || 0);
    if (mode === "most-used") {
      const aUses = a.url ? (metadataByUrl[normalizeUrl(a.url)] || {}).useCount || 0 : 0;
      const bUses = b.url ? (metadataByUrl[normalizeUrl(b.url)] || {}).useCount || 0 : 0;
      return bUses - aUses || collator.compare(a.title || "", b.title || "");
    }
    if (mode === "title-desc") return collator.compare(b.title || "", a.title || "");
    if (!a.url && b.url) return -1;
    if (a.url && !b.url) return 1;
    return collator.compare(a.title || "", b.title || "");
  });

  await setUndoSnapshot({
    action: "sort",
    label: `Sorted ${folder.title}`,
    folders: [{
      id: folder.id,
      childOrder: children.map((child) => child.id)
    }]
  });

  await withInternalMutation(async () => {
    for (let index = 0; index < sorted.length; index += 1) {
      await chromeCall(chrome.bookmarks.move.bind(chrome.bookmarks), sorted[index].id, {
        parentId: folder.id,
        index
      });
    }
  });

  return { sorted: sorted.length, folder };
}

async function updateMetadata(payload = {}) {
  let url = payload.url;
  if (!url && payload.id) {
    const node = await getNode(payload.id);
    url = node && node.url;
  }

  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) throw new Error("Metadata update needs a URL.");

  const metadata = await updateMetadataForUrl(normalizedUrl, {
    notes: payload.notes,
    replaceTags: payload.tags
  });

  return { metadata };
}

async function refreshIndex(payload = {}) {
  const state = await getManagedState();
  const selected = new Set(payload.ids || []);
  const bookmarks = state.bookmarks.filter((bookmark) => {
    if (!selected.size) return !bookmark.metadata.indexedAt;
    if (selected.has(bookmark.id)) return true;
    return bookmark.folderAncestors.some((folderId) => selected.has(folderId));
  });

  const unique = new Map();
  for (const bookmark of bookmarks) {
    if (!unique.has(bookmark.normalizedUrl)) {
      unique.set(bookmark.normalizedUrl, bookmark);
    }
  }

  const metadataByUrl = await getMetadataMap();
  let indexed = 0;
  for (const bookmark of unique.values()) {
    const pageIndex = await buildPageIndex(bookmark.url, bookmark.title);
    metadataByUrl[bookmark.normalizedUrl] = {
      ...(metadataByUrl[bookmark.normalizedUrl] || {}),
      ...pageIndex,
      updatedAt: stamp()
    };
    indexed += 1;
  }

  await saveMetadataMap(metadataByUrl);
  return { indexed };
}

async function openBookmark(payload = {}) {
  const node = await getNode(payload.id);
  if (!node || !node.url) throw new Error("Bookmark was not found.");

  const normalizedUrl = normalizeUrl(node.url);
  const metadataByUrl = await getMetadataMap();
  const previous = metadataByUrl[normalizedUrl] || {};
  await updateMetadataForUrl(normalizedUrl, {
    useCount: (previous.useCount || 0) + 1,
    lastOpenedAt: stamp()
  });

  const tab = await chromeCall(chrome.tabs.create.bind(chrome.tabs), { url: node.url });
  return { tab };
}

async function setSelectedFolder(payload = {}) {
  const area = await ensureManagedArea();
  const folder = await getValidFolderOrDefault(payload.folderId, area);
  const settings = {
    ...area.settings,
    selectedFolderId: folder.id
  };
  await saveSettings(settings);
  return { folder };
}

async function checkUrl(url) {
  if (!/^https?:\/\//i.test(url)) {
    return {
      state: "warning",
      code: null,
      message: "Unsupported URL scheme",
      checkedAt: stamp()
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  async function request(method) {
    return fetch(url, {
      method,
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: method === "GET" ? { Range: "bytes=0-0" } : undefined
    });
  }

  try {
    let response = await request("HEAD");
    if (response.status === 405 || response.status === 501) {
      response = await request("GET");
    }

    const code = response.status || 0;
    let state = "dead";
    let message = response.statusText || "No status text";

    if (code >= 200 && code < 400) {
      state = "ok";
      message = "Reachable";
    } else if (code === 401 || code === 403 || code === 429) {
      state = "warning";
      message = "Reachable but restricted";
    }

    return { state, code, message, checkedAt: stamp() };
  } catch (error) {
    return {
      state: "dead",
      code: null,
      message: error.name === "AbortError" ? "Timed out" : error.message,
      checkedAt: stamp()
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkLinks(payload = {}) {
  const state = await getManagedState();
  const nodeMap = buildNodeMap(state.root);
  const selected = new Set(payload.ids || []);
  const bookmarks = state.bookmarks.filter((bookmark) => {
    if (!selected.size) return true;
    if (selected.has(bookmark.id)) return true;
    return bookmark.folderAncestors.some((folderId) => selected.has(folderId));
  });

  const unique = new Map();
  for (const bookmark of bookmarks) {
    if (!unique.has(bookmark.normalizedUrl)) {
      unique.set(bookmark.normalizedUrl, {
        url: bookmark.url,
        bookmarks: []
      });
    }
    unique.get(bookmark.normalizedUrl).bookmarks.push(bookmark);
  }

  const metadataByUrl = await getMetadataMap();
  const entries = Array.from(unique.entries());
  const results = [];
  let cursor = 0;
  const concurrency = Math.min(4, entries.length || 1);

  async function worker() {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      const [normalizedUrl, entry] = entries[index];
      const deadStatus = await checkUrl(entry.url);
      metadataByUrl[normalizedUrl] = {
        ...(metadataByUrl[normalizedUrl] || {}),
        deadStatus,
        updatedAt: stamp()
      };
      results.push({
        normalizedUrl,
        url: entry.url,
        deadStatus,
        bookmarks: entry.bookmarks.map((bookmark) => ({
          id: bookmark.id,
          title: bookmark.title,
          folderPath: bookmark.folderPath
        }))
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  await saveMetadataMap(metadataByUrl);

  return {
    checked: results.length,
    results,
    ignoredMissing: Array.from(selected).filter((id) => !nodeMap.has(id)).length
  };
}

async function restoreDeletedNode(snapshot, fallbackParentId) {
  const parent = await getNode(snapshot.parentId);
  const parentId = isFolder(parent) ? parent.id : fallbackParentId;
  const node = snapshot.node;

  if (node.url) {
    return chromeCall(chrome.bookmarks.create.bind(chrome.bookmarks), {
      parentId,
      index: snapshot.index,
      title: node.title,
      url: node.url
    });
  }

  const folder = await chromeCall(chrome.bookmarks.create.bind(chrome.bookmarks), {
    parentId,
    index: snapshot.index,
    title: node.title
  });

  const children = [...(node.children || [])].sort((a, b) => (a.index || 0) - (b.index || 0));
  for (const child of children) {
    await restoreDeletedNode({
      node: child,
      parentId: folder.id,
      index: child.index
    }, folder.id);
  }

  return folder;
}

async function undoLast() {
  const data = await storageGet({ [STORAGE_KEYS.UNDO]: null });
  const undo = data[STORAGE_KEYS.UNDO];
  if (!undo) throw new Error("There is no undo action available.");

  const area = await ensureManagedArea();

  await withInternalMutation(async () => {
    if (undo.action === "delete") {
      for (const snapshot of undo.snapshots || []) {
        await restoreDeletedNode(snapshot, area.defaultFolder.id);
      }
    }

    if (undo.action === "move") {
      for (const move of undo.moves || []) {
        const parent = await getNode(move.oldParentId);
        if (!isFolder(parent)) continue;
        const node = await getNode(move.id);
        if (!node) continue;
        await chromeCall(chrome.bookmarks.move.bind(chrome.bookmarks), move.id, {
          parentId: parent.id,
          index: move.oldIndex
        });
      }
    }

    if (undo.action === "rename") {
      for (const rename of undo.renames || []) {
        const node = await getNode(rename.id);
        if (!node) continue;
        await chromeCall(chrome.bookmarks.update.bind(chrome.bookmarks), rename.id, {
          title: rename.oldTitle
        });
      }
    }

    if (undo.action === "sort") {
      for (const folder of undo.folders || []) {
        for (let index = 0; index < folder.childOrder.length; index += 1) {
          const childId = folder.childOrder[index];
          const child = await getNode(childId);
          if (!child || child.parentId !== folder.id) continue;
          await chromeCall(chrome.bookmarks.move.bind(chrome.bookmarks), childId, {
            parentId: folder.id,
            index
          });
        }
      }
    }
  });

  await storageRemove(STORAGE_KEYS.UNDO);
  return { undone: undo.label || undo.action };
}

async function recordExternalChange(type, summary) {
  if (Date.now() < suppressEventsUntil) return;

  const data = await storageGet({
    [STORAGE_KEYS.CHANGE_FEED]: [],
    [STORAGE_KEYS.REVISION]: 0
  });
  const feed = data[STORAGE_KEYS.CHANGE_FEED] || [];
  feed.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    summary,
    at: stamp()
  });

  await storageSet({
    [STORAGE_KEYS.CHANGE_FEED]: feed.slice(0, 30),
    [STORAGE_KEYS.REVISION]: Date.now()
  });
}

async function initializeExtension() {
  await ensureManagedArea();

  await chromeCall(chrome.contextMenus.removeAll.bind(chrome.contextMenus));
  chrome.contextMenus.create({
    id: "quickSavePage",
    title: "Save page",
    contexts: ["page"]
  });
  chrome.contextMenus.create({
    id: "quickSaveLink",
    title: "Save link",
    contexts: ["link"]
  });
  chrome.contextMenus.create({
    id: "openBookmarkAdmin",
    title: "Open bookmark manager",
    contexts: ["all"]
  });
}

async function setActionBadge(text, color) {
  if (!chrome.action) return;
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
  }, 1800);
}

async function injectManagerOverlay(tabId) {
  if (!tabId) {
    throw new Error("No active tab is available for the manager overlay.");
  }

  await chromeCall(chrome.scripting.insertCSS.bind(chrome.scripting), {
    target: { tabId },
    files: ["overlay-manager.css"]
  });
  await chromeCall(chrome.scripting.executeScript.bind(chrome.scripting), {
    target: { tabId },
    files: ["overlay-manager.js"]
  });
}

async function openManagerSurface(tabId) {
  try {
    await injectManagerOverlay(tabId);
  } catch (error) {
    console.error(error);
    await chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup",
      width: 390,
      height: 300
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension().catch((error) => console.error(error));
});

chrome.runtime.onStartup.addListener(() => {
  initializeExtension().catch((error) => console.error(error));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  (async () => {
    if (info.menuItemId === "openBookmarkAdmin") {
      if (tab && tab.id !== undefined) {
        await openManagerSurface(tab.id);
      }
      return;
    }

    if (info.menuItemId === "quickSaveLink") {
      if (!isHttpUrl(info.linkUrl)) {
        await setActionBadge("NO", "#9b6500");
        return;
      }
      const result = await saveBookmark({
        url: info.linkUrl,
        title: info.linkUrl
      });
      await setActionBadge(result.duplicate ? "DUP" : "OK", result.duplicate ? "#9b6500" : "#276c56");
      return;
    }

    if (info.menuItemId === "quickSavePage" && tab) {
      if (!isHttpUrl(tab.url)) {
        await setActionBadge("NO", "#9b6500");
        return;
      }
      const result = await saveBookmark({
        url: tab.url,
        title: tab.title
      });
      await setActionBadge(result.duplicate ? "DUP" : "OK", result.duplicate ? "#9b6500" : "#276c56");
    }
  })().catch((error) => console.error(error));
});

chrome.commands.onCommand.addListener((command) => {
  (async () => {
    if (command === "quick-save-current-page") {
      const result = await quickSaveCurrentPage();
      await setActionBadge(result.duplicate ? "DUP" : "OK", result.duplicate ? "#9b6500" : "#276c56");
      return;
    }

    if (command === "open-bookmark-admin") {
      const tab = await getCurrentTab();
      await openManagerSurface(tab.id);
    }
  })().catch((error) => console.error(error));
});

chrome.bookmarks.onCreated.addListener((id, node) => {
  recordExternalChange("created", `${node.title || "Untitled"} was created`).catch(console.error);
});

chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
  recordExternalChange("changed", `${changeInfo.title || id} was changed`).catch(console.error);
});

chrome.bookmarks.onMoved.addListener((id) => {
  recordExternalChange("moved", `${id} was moved`).catch(console.error);
});

chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
  const title = removeInfo && removeInfo.node && removeInfo.node.title;
  recordExternalChange("removed", `${title || id} was removed`).catch(console.error);
});

chrome.bookmarks.onChildrenReordered.addListener((id) => {
  recordExternalChange("reordered", `${id} was reordered`).catch(console.error);
});

chrome.bookmarks.onImportEnded.addListener(() => {
  recordExternalChange("imported", "Chrome bookmark import ended").catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const payload = message && message.payload ? message.payload : {};
    let result;

    switch (message && message.type) {
      case "getState":
        result = await getManagedState();
        break;
      case "getCurrentTab":
        result = await getCurrentTab();
        break;
      case "quickSaveCurrentPage":
        result = await quickSaveCurrentPage(payload);
        break;
      case "saveBookmark":
        result = await saveBookmark(payload);
        break;
      case "createFolder":
        result = await createFolder(payload);
        break;
      case "setSelectedFolder":
        result = await setSelectedFolder(payload);
        break;
      case "bulkDelete":
        result = await bulkDelete(payload);
        break;
      case "bulkMove":
        result = await bulkMove(payload);
        break;
      case "moveNode":
        result = await moveNode(payload);
        break;
      case "renameNode":
        result = await renameNode(payload);
        break;
      case "bulkRename":
        result = await bulkRename(payload);
        break;
      case "sortFolder":
        result = await sortFolder(payload);
        break;
      case "updateMetadata":
        result = await updateMetadata(payload);
        break;
      case "refreshIndex":
        result = await refreshIndex(payload);
        break;
      case "openBookmark":
        result = await openBookmark(payload);
        break;
      case "checkLinks":
        result = await checkLinks(payload);
        break;
      case "undoLast":
        result = await undoLast(payload);
        break;
      default:
        throw new Error(`Unknown message type: ${message && message.type}`);
    }

    sendResponse({ ok: true, result });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });

  return true;
});
