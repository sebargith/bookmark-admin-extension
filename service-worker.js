const MANAGED_ROOT_TITLE = "Bookmark Admin";
const DEFAULT_FOLDER_TITLE = "All";

const STORAGE_KEYS = {
  SETTINGS: "settings",
  METADATA: "metadataByUrl",
  UNDO: "lastUndo",
  CHANGE_FEED: "changeFeed",
  REVISION: "bookmarkRevision",
  NAVIGATION: "managerNavigation",
  SAVED_WINDOWS: "savedWindows",
  PENDING_POPUP_MODE: "pendingPopupMode"
};

let suppressEventsUntil = 0;
let saveAllWindowsPromise = null;
let bookmarkRefreshTimer = null;
let metadataWriteQueue = Promise.resolve();
let navigationWriteQueue = Promise.resolve();
let savedWindowWriteQueue = Promise.resolve();
let bookmarkBatchQueue = Promise.resolve();
const reopeningWindows = new Map();

function updateSavedWindowRecords(root, patches = {}) {
  const task = savedWindowWriteQueue.then(async () => {
    const stored = await storageGet({ [STORAGE_KEYS.SAVED_WINDOWS]: {} });
    const previous = stored[STORAGE_KEYS.SAVED_WINDOWS] || {};
    const tree = await chromeCall(chrome.bookmarks.getTree.bind(chrome.bookmarks));
    const liveRoot = tree[0];
    const nodeMap = buildNodeMap(liveRoot);
    const records = {};
    for (const [id, record] of Object.entries({ ...previous, ...patches })) {
      const node = nodeMap.get(id);
      if (!isFolder(node) || node.id === liveRoot.id || node.folderType || !record) continue;
      records[id] = {
        capturedAt: Number.isFinite(record.capturedAt) && record.capturedAt > 0 && Number.isFinite(new Date(record.capturedAt).getTime()) ? record.capturedAt : null,
        originalTabCount: Number.isInteger(record.originalTabCount) && record.originalTabCount >= 0 ? record.originalTabCount : null
      };
    }
    for (const bar of liveRoot.children || []) {
      if (bar.folderType !== "bookmarks-bar" && !(bar.id === "1" && !bar.folderType)) continue;
      for (const node of bar.children || []) {
        if (isFolder(node) && /^nuevo\s*\d+$/i.test(safeTitle(node.title)) && !records[node.id]) {
          records[node.id] = { capturedAt: null, originalTabCount: null };
        }
      }
    }
    if (JSON.stringify(previous) !== JSON.stringify(records)) await storageSet({ [STORAGE_KEYS.SAVED_WINDOWS]: records });
    const snapshotIds = buildNodeMap(root);
    return Object.fromEntries(Object.entries(records).filter(([id]) => isFolder(snapshotIds.get(id))));
  });
  savedWindowWriteQueue = task.catch(() => {});
  return task;
}

function savedWindowUrls(folder) {
  const urls = [];
  let skipped = 0;
  walk(folder, (node) => {
    if (!node.url) return;
    try {
      if (!["http:", "https:"].includes(new URL(node.url).protocol)) throw new Error("Unsupported URL");
      urls.push(node.url);
    } catch { skipped += 1; }
  });
  return { urls, skipped };
}

function normalizeManagerNavigation(value) {
  const views = ["library", "windows", "all"];
  const id = (value) => typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
  return {
    view: views.includes(value?.view) ? value.view : "library",
    selectedByView: Object.fromEntries(views.map((view) => [view, id(value?.selectedByView?.[view])])),
    expanded: [...new Set((Array.isArray(value?.expanded) ? value.expanded : []).map(id).filter(Boolean))].slice(0, 5000)
  };
}

function saveManagerNavigation(payload) {
  const navigation = normalizeManagerNavigation(payload);
  const write = navigationWriteQueue.then(() => storageSet({ [STORAGE_KEYS.NAVIGATION]: navigation }));
  navigationWriteQueue = write.catch(() => {});
  return write.then(() => navigation);
}

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

function serializeMetadataWrite(work) {
  const result = metadataWriteQueue.then(work);
  metadataWriteQueue = result.catch(() => {});
  return result;
}

function mergeMetadataPatches(patches) {
  return serializeMetadataWrite(async () => {
    const latest = await getMetadataMap();
    for (const [url, patch] of Object.entries(patches)) {
      latest[url] = { ...(latest[url] || {}), ...patch };
    }
    await saveMetadataMap(latest);
  });
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

  const latestRoot = await getSubTree(managedRoot.id);
  const latestMap = buildNodeMap(latestRoot);

  for (const folderSetting of ["selectedFolderId", "lastSavedFolderId"]) {
    if (nextSettings[folderSetting]) {
      const selected = await getNode(nextSettings[folderSetting]);
      if (!isFolder(selected) || !isDescendantOrSelf(selected.id, managedRoot.id, latestMap)) {
        nextSettings[folderSetting] = defaultFolder.id;
      }
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

async function getBookmarkContext() {
  const area = await ensureManagedArea();
  const tree = await chromeCall(chrome.bookmarks.getTree.bind(chrome.bookmarks));
  const root = tree[0];
  return { area, root, nodeMap: buildNodeMap(root) };
}

function isReadOnlyNode(node, nodeMap) {
  let current = node;
  while (current) {
    if (current.unmodifiable) return true;
    current = nodeMap.get(current.parentId);
  }
  return false;
}

function isProtectedNode(node, context) {
  return node.id === context.root.id || node.parentId === context.root.id ||
    Boolean(node.folderType) || node.id === context.area.managedRoot.id ||
    node.id === context.area.defaultFolder.id;
}

function writableFolder(id, context) {
  const node = context.nodeMap.get(id);
  if (!isFolder(node) || node.id === context.root.id || isReadOnlyNode(node, context.nodeMap)) {
    throw new Error("The destination folder is missing or read-only.");
  }
  return node;
}

function canModifyNode(node, context) {
  return node && !isProtectedNode(node, context) && !isReadOnlyNode(node, context.nodeMap);
}

function canRemoveSubtree(node, context) {
  if (!node) return false;
  let removable = true;
  walk(node, (child) => { if (!canModifyNode(child, context)) removable = false; });
  return removable;
}

async function getManagerState() {
  const context = await getBookmarkContext();
  const metadataByUrl = await getMetadataMap();
  const auxiliary = await storageGet({
    [STORAGE_KEYS.UNDO]: null,
    [STORAGE_KEYS.NAVIGATION]: null,
    [STORAGE_KEYS.REVISION]: 0
  });
  const captureRecords = await updateSavedWindowRecords(context.root);
  const captureIds = new Set(Object.keys(captureRecords));
  const savedWindows = Object.entries(captureRecords).map(([folderId, record]) => {
    const folder = context.nodeMap.get(folderId);
    const { urls, skipped } = savedWindowUrls(folder);
    return { folderId, ...record, dateAdded: folder.dateAdded || null,
      tabCount: urls.length + skipped, reopenableTabCount: urls.length, skippedTabCount: skipped };
  });
  // Nested captures remain identifiable without duplicating their trees in the overview/export.
  const savedWindowFolderIds = [...captureIds].filter((id) => {
    let parent = context.nodeMap.get(id)?.parentId;
    while (parent) {
      if (captureIds.has(parent)) return false;
      parent = context.nodeMap.get(parent)?.parentId;
    }
    return true;
  });
  return {
    root: context.root,
    managedRoot: context.area.managedRoot,
    defaultFolder: context.area.defaultFolder,
    settings: context.area.settings,
    navigation: normalizeManagerNavigation(auxiliary[STORAGE_KEYS.NAVIGATION]),
    metadataByUrl,
    ...flattenManagedData(context.root, metadataByUrl),
    savedWindowFolderIds,
    savedWindows,
    protectedNodeIds: [...context.nodeMap.values()]
      .filter((node) => isProtectedNode(node, context)).map((node) => node.id),
    readOnlyNodeIds: [...context.nodeMap.values()]
      .filter((node) => isReadOnlyNode(node, context.nodeMap)).map((node) => node.id),
    lastUndo: auxiliary[STORAGE_KEYS.UNDO],
    bookmarkRevision: auxiliary[STORAGE_KEYS.REVISION]
  };
}

async function resolveExport(payload) {
  if (!["json", "html"].includes(payload.format) || !["library", "windows", "all"].includes(payload.view)) {
    throw new Error("Invalid export format or view.");
  }
  const state = await getManagerState();
  const nodeMap = buildNodeMap(state.root);
  const roots = payload.view === "all" ? [state.root] :
    (payload.view === "library" ? [nodeMap.get(state.managedRoot.id)] : state.savedWindowFolderIds.map((id) => nodeMap.get(id)));
  let root;
  if (payload.folderId) {
    root = nodeMap.get(payload.folderId);
    if (!isFolder(root) || !roots.some((scope) => isDescendantOrSelf(root.id, scope.id, nodeMap))) {
      throw new Error("The export folder is no longer in this view.");
    }
  } else {
    root = roots.length === 1 && payload.view !== "windows" ? roots[0] : { title: "Saved Windows", children: roots };
  }
  return { state, root };
}

function escapeBookmarkHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function exportHtmlNode(node, metadataByUrl, depth = 1) {
  const indent = "    ".repeat(depth);
  const added = node.dateAdded ? Math.floor(node.dateAdded / 1000) : "";
  if (node.url) {
    const notes = (metadataByUrl[normalizeUrl(node.url)] || {}).notes;
    return `${indent}<DT><A HREF="${escapeBookmarkHtml(node.url)}" ADD_DATE="${added}">${escapeBookmarkHtml(node.title || node.url)}</A>` +
      (notes ? `\n${indent}<DD>${escapeBookmarkHtml(notes)}` : "");
  }
  return [
    `${indent}<DT><H3 ADD_DATE="${added}">${escapeBookmarkHtml(node.title || "Folder")}</H3>`,
    `${indent}<DL><p>`,
    ...(node.children || []).map((child) => exportHtmlNode(child, metadataByUrl, depth + 1)),
    `${indent}</DL><p>`
  ].join("\n");
}

async function buildExport(payload = {}) {
  const { state, root } = await resolveExport(payload);
  if (payload.format === "html") {
    return { filename: "bookmark-admin-bookmarks.html", type: "text/html", content: [
      "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      "<TITLE>Bookmarks</TITLE>", "<H1>Bookmarks</H1>", "<DL><p>",
      exportHtmlNode(root, state.metadataByUrl), "</DL><p>"
    ].join("\n") };
  }
  const ids = new Set();
  const metadataByUrl = {};
  walk(root, (node) => {
    if (node.id) ids.add(node.id);
    if (node.url) {
      const key = normalizeUrl(node.url);
      if (state.metadataByUrl[key]) metadataByUrl[key] = state.metadataByUrl[key];
    }
  });
  const duplicateGroups = state.duplicateGroups.map((group) => ({
    ...group, bookmarks: group.bookmarks.filter((bookmark) => ids.has(bookmark.id))
  })).filter((group) => group.bookmarks.length > 1).map((group) => ({ ...group, count: group.bookmarks.length }));
  return { filename: "bookmark-admin-backup.json", type: "application/json", content: JSON.stringify({
    app: "Local Bookmark Admin", generatedAt: stamp(), root, metadataByUrl, duplicateGroups,
    savedWindows: state.savedWindows.filter((capture) => ids.has(capture.folderId))
  }, null, 2) };
}

async function openExportPage(payload = {}) {
  await resolveExport(payload);
  const url = new URL(chrome.runtime.getURL("export.html"));
  url.searchParams.set("format", payload.format);
  url.searchParams.set("view", payload.view);
  if (payload.folderId) url.searchParams.set("folder", payload.folderId);
  await chromeCall(chrome.tabs.create.bind(chrome.tabs), { url: url.href });
  return { opened: true };
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

async function rememberLastSavedFolder(folder) {
  if (!isFolder(folder)) return;
  const settings = await getSettings();
  await saveSettings({
    ...settings,
    lastSavedFolderId: folder.id
  });
}

function updateMetadataForUrl(normalizedUrl, patch) {
  return serializeMetadataWrite(() => applyMetadataPatch(normalizedUrl, patch));
}

async function applyMetadataPatch(normalizedUrl, patch) {
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
    await rememberLastSavedFolder(targetFolder);
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
  await rememberLastSavedFolder(targetFolder);

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

function nextWindowFolderNumber(children) {
  let highest = 0n;
  for (const node of children || []) {
    if (!isFolder(node)) continue;
    const match = safeTitle(node.title).match(/^nuevo\s*(\d+)$/i);
    if (match) {
      const number = BigInt(match[1]);
      if (number > highest) highest = number;
    }
  }
  return highest + 1n;
}

function findBookmarksBar(root) {
  const children = root && root.children || [];
  const bars = children.filter((node) =>
    isFolder(node) && !node.unmodifiable && node.folderType === "bookmarks-bar"
  );
  // If Chrome exposes both account and local bars, continue the existing series.
  bars.sort((a, b) => {
    const aNext = nextWindowFolderNumber(a.children);
    const bNext = nextWindowFolderNumber(b.children);
    if (aNext !== bNext) return aNext > bNext ? -1 : 1;
    return Number(Boolean(b.syncing)) - Number(Boolean(a.syncing));
  });
  // Before Chrome 134, the standard bookmarks bar has ID 1 and no folderType.
  return bars[0] || children.find((node) =>
    node.id === "1" && isFolder(node) && !node.unmodifiable && !node.folderType
  );
}

function windowTabUrl(tab) {
  const url = String(tab.pendingUrl || tab.url || "").trim();
  try {
    const protocol = new URL(url).protocol;
    return ["http:", "https:", "chrome:", "chrome-extension:", "file:", "ftp:", "about:"]
      .includes(protocol) ? url : "";
  } catch {
    return "";
  }
}

function saveAllWindows() {
  // Share an active capture so overlapping popup requests cannot create two sets.
  if (!saveAllWindowsPromise) {
    saveAllWindowsPromise = captureAllWindows().finally(() => {
      saveAllWindowsPromise = null;
    });
  }
  return saveAllWindowsPromise;
}

async function captureAllWindows() {
  const windows = await chromeCall(chrome.windows.getAll.bind(chrome.windows), {
    populate: true,
    windowTypes: ["normal", "popup"]
  });
  const tree = await chromeCall(chrome.bookmarks.getTree.bind(chrome.bookmarks));
  const bar = findBookmarksBar(tree[0]);
  if (!bar) throw new Error("Chrome's bookmarks bar is unavailable or read-only.");

  const result = {
    folders: [],
    savedTabCount: 0,
    skippedTabCount: 0,
    failedTabCount: 0,
    failedWindowCount: 0,
    metadataFailedWindowCount: 0
  };

  for (const browserWindow of windows) {
    if (browserWindow.incognito) continue;
    const tabs = (browserWindow.tabs || []).slice().sort((a, b) => a.index - b.index);
    const saveableTabs = tabs.map((tab) => ({ tab, url: windowTabUrl(tab) }))
      .filter((entry) => entry.url);
    result.skippedTabCount += tabs.length - saveableTabs.length;
    if (!saveableTabs.length) continue;

    let folder;
    try {
      // Re-read for every window to include folders added manually during capture.
      const children = await chromeCall(chrome.bookmarks.getChildren.bind(chrome.bookmarks), bar.id);
      folder = await chromeCall(chrome.bookmarks.create.bind(chrome.bookmarks), {
        parentId: bar.id,
        title: `nuevo${nextWindowFolderNumber(children)}`
      });
    } catch {
      result.failedWindowCount += 1;
      continue;
    }
    result.folders.push({ id: folder.id, title: folder.title });
    const capturedAt = Date.now();
    let capturedTabCount = 0;

    for (const { tab, url } of saveableTabs) {
      try {
        await chromeCall(chrome.bookmarks.create.bind(chrome.bookmarks), {
          parentId: folder.id,
          title: safeTitle(tab.title) || url,
          url
        });
        result.savedTabCount += 1;
        capturedTabCount += 1;
      } catch {
        result.failedTabCount += 1;
      }
    }
    try {
      const currentTree = await chromeCall(chrome.bookmarks.getTree.bind(chrome.bookmarks));
      await updateSavedWindowRecords(currentTree[0], { [folder.id]: { capturedAt, originalTabCount: capturedTabCount } });
    } catch {
      result.metadataFailedWindowCount += 1;
    }
  }

  return result;
}

async function getSavedWindow(folderId) {
  const state = await getManagerState();
  const capture = state.savedWindows.find((item) => item.folderId === folderId);
  const node = buildNodeMap(state.root).get(folderId);
  if (!capture || !isFolder(node)) throw new Error("Saved window not found. Refresh the manager.");
  return { state, capture, node };
}

function reopenSavedWindow(payload = {}) {
  if (payload.confirmed !== true) return Promise.reject(new Error("Confirm before reopening a saved window."));
  const id = payload.folderId;
  if (!reopeningWindows.has(id)) {
    const task = (async () => {
      const { node } = await getSavedWindow(id);
      const { urls, skipped } = savedWindowUrls(node);
      if (payload.expectedUrls && JSON.stringify(payload.expectedUrls) !== JSON.stringify(urls)) {
        throw new Error("This capture changed. Cancel and review it before reopening.");
      }
      if (!urls.length) throw new Error("This saved window has no http or https pages to open.");
      if (urls.length > 100) throw new Error("Open at most 100 pages at once. Split this capture into smaller folders first.");
      const window = await chromeCall(chrome.windows.create.bind(chrome.windows), { url: urls, type: "normal", incognito: false });
      return { opened: urls.length, skipped, windowId: window.id };
    })().finally(() => reopeningWindows.delete(id));
    reopeningWindows.set(id, task);
  }
  return reopeningWindows.get(id);
}

function validateSavedLibraryMove(payload, context) {
  const node = context.nodeMap.get(payload.captureId);
  if (!isFolder(node)) throw new Error("Saved window not found. Refresh the manager.");
  const target = writableFolder(payload.folderId, context);
  if (!isDescendantOrSelf(target.id, context.area.managedRoot.id, context.nodeMap)) {
    throw new Error("Choose a folder inside Library.");
  }
  const ids = payload.bookmarkId ? [payload.bookmarkId] : (node.children || []).map((child) => child.id);
  const contents = [];
  walk(node, (item) => { if (item.id !== node.id) contents.push([item.id, item.parentId, item.url || null]); });
  if (payload.expectedIds && JSON.stringify(payload.expectedIds) !== JSON.stringify(ids) ||
      payload.expectedContents && JSON.stringify(payload.expectedContents) !== JSON.stringify(contents)) {
    throw new Error("This capture changed. Cancel and review it before moving.");
  }
  if (!ids.length) throw new Error("This saved window is empty.");
  if (ids.every((id) => context.nodeMap.get(id)?.parentId === target.id)) {
    throw new Error("Choose a different destination. These items are already in that folder.");
  }
  for (const id of ids) {
    const item = context.nodeMap.get(id);
    if (!item || (payload.bookmarkId && !item.url) || !isDescendantOrSelf(id, node.id, context.nodeMap) ||
        !canRemoveSubtree(item, context) || isDescendantOrSelf(target.id, id, context.nodeMap)) {
      throw new Error("These saved items cannot be moved to that folder.");
    }
  }
  return { ids, target, contents };
}

async function moveSavedItemsToLibrary(payload = {}) {
  await getSavedWindow(payload.captureId);
  const initial = await getBookmarkContext();
  const selection = validateSavedLibraryMove(payload, initial);
  const transferId = `${Date.now()}-${Math.random()}`;
  const planned = selection.ids.map((id) => {
    const node = initial.nodeMap.get(id);
    return { id, oldParentId: node.parentId, oldIndex: node.index };
  });
  const completed = [];
  const removed = new Set();
  const snapshot = (moves) => ({ action: "move", transferId,
    label: `Moved ${moves.length} item${moves.length === 1 ? "" : "s"}`, moves });
  const previousUndo = await storageGet({ [STORAGE_KEYS.UNDO]: null });
  await setUndoSnapshot(snapshot(planned));
  try {
    await withInternalMutation(async () => {
      for (const id of selection.ids) {
        // Chrome has no bookmark transaction: revalidate immediately before each native move.
        const context = await getBookmarkContext();
        validateSavedLibraryMove({ ...payload,
          expectedIds: payload.bookmarkId ? [id] : selection.ids.filter((item) => !removed.has(item)),
          expectedContents: selection.contents.filter(([item]) => !removed.has(item))
        }, context);
        const node = context.nodeMap.get(id);
        const subtreeIds = [];
        walk(node, (item) => subtreeIds.push(item.id));
        const move = planned.find((item) => item.id === id);
        await chromeCall(chrome.bookmarks.move.bind(chrome.bookmarks), id, { parentId: payload.folderId });
        completed.push(move);
        for (const item of subtreeIds) removed.add(item);
      }
    });
  } catch (error) {
    const current = await storageGet({ [STORAGE_KEYS.UNDO]: null });
    if (current[STORAGE_KEYS.UNDO]?.transferId === transferId) {
      if (completed.length) await setUndoSnapshot(snapshot(completed));
      else if (previousUndo[STORAGE_KEYS.UNDO]) await storageSet({ [STORAGE_KEYS.UNDO]: previousUndo[STORAGE_KEYS.UNDO] });
      else await storageRemove(STORAGE_KEYS.UNDO);
    }
    throw new Error(`${completed.length ? `Moved ${completed.length} items before stopping. Undo is available. ` : ""}${error.message}`);
  }
  const current = await storageGet({ [STORAGE_KEYS.UNDO]: null });
  if (current[STORAGE_KEYS.UNDO]?.transferId === transferId) await setUndoSnapshot(snapshot(completed));
  return { moved: completed.length, folder: selection.target };
}

async function createFolder(payload = {}) {
  const title = safeTitle(payload.title);
  if (!title) throw new Error("Folder title is required.");

  const context = await getBookmarkContext();
  const parent = writableFolder(payload.parentId || context.area.managedRoot.id, context);

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
  const context = await getBookmarkContext();
  const { nodeMap } = context;
  const savedWindows = await updateSavedWindowRecords(context.root);
  const rawIds = Array.from(new Set(payload.ids || []));
  const ids = filterTopLevelSelection(rawIds, nodeMap)
    .filter((id) => canRemoveSubtree(nodeMap.get(id), context));

  if (!ids.length) throw new Error("No removable bookmarks or folders were selected.");

  const snapshots = [];
  for (const id of ids) {
    const node = nodeMap.get(id);
    const captureIds = new Set();
    walk(node, (child) => captureIds.add(child.id));
    snapshots.push({
      node: clone(await getSubTree(id)),
      parentId: node.parentId,
      index: node.index,
      savedWindows: Object.fromEntries(Object.entries(savedWindows).filter(([captureId]) => captureIds.has(captureId)))
    });
  }

  const deletedSnapshots = [];
  await withInternalMutation(async () => {
    for (const snapshot of snapshots) {
      const node = snapshot.node;
      try {
        if (node.url) {
          await chromeCall(chrome.bookmarks.remove.bind(chrome.bookmarks), node.id);
        } else {
          await chromeCall(chrome.bookmarks.removeTree.bind(chrome.bookmarks), node.id);
        }
        deletedSnapshots.push(snapshot);
      } catch {
        // Only successful removals belong in undo, or restoring could duplicate data.
      }
    }
  });
  if (!deletedSnapshots.length) throw new Error("Chrome could not delete the selected items.");
  await setUndoSnapshot({ action: "delete", label: `Deleted ${deletedSnapshots.length} items`, snapshots: deletedSnapshots });
  return { deleted: deletedSnapshots.length, failed: ids.length - deletedSnapshots.length };
}

async function bulkMove(payload = {}) {
  const context = await getBookmarkContext();
  const { nodeMap } = context;
  const targetFolder = writableFolder(payload.folderId, context);
  const rawIds = Array.from(new Set(payload.ids || []));
  const ids = filterTopLevelSelection(rawIds, nodeMap)
    .filter((id) => canModifyNode(nodeMap.get(id), context));

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

  const context = await getBookmarkContext();
  const { nodeMap } = context;
  const node = nodeMap.get(payload.id);

  if (!node) throw new Error("Bookmark or folder was not found.");
  if (!canModifyNode(node, context)) {
    throw new Error("This folder or bookmark is protected or read-only.");
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
  const context = await getBookmarkContext();
  const { nodeMap } = context;
  const ids = Array.from(new Set(payload.ids || []))
    .filter((id) => canModifyNode(nodeMap.get(id), context));

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

function bookmarkSelectionSnapshot(node) {
  return { id: node.id, parentId: node.parentId, title: node.title || "", url: node.url, index: node.index };
}

function validateNodeAction(payload, context) {
  if (payload.confirmed !== true || !["rename", "move", "delete"].includes(payload.action) ||
      typeof payload.id !== "string" || !payload.id) {
    throw new Error("Confirm a valid bookmark or folder action first.");
  }
  const node = context.nodeMap.get(payload.id);
  if (!node || !canRemoveSubtree(node, context)) {
    throw new Error("The subtree is missing, protected or read-only. Cancel and review it.");
  }
  const current = [];
  walk(node, (child) => current.push({ ...bookmarkSelectionSnapshot(child), url: child.url ?? null }));
  if (!Array.isArray(payload.expected) || !payload.expected.length || payload.expected.length > 10000 ||
      current.length !== payload.expected.length || current.some((child, index) => {
        const previous = payload.expected[index];
        return !previous || ["id", "parentId", "title", "url", "index"].some((key) => child[key] !== previous[key]);
      })) {
    throw new Error("The subtree changed. Cancel and review it.");
  }
  let target;
  let destinationPath;
  if (payload.action === "move") {
    target = writableFolder(payload.folderId, context);
    if (target.id === node.parentId || isDescendantOrSelf(target.id, node.id, context.nodeMap)) {
      throw new Error("Cannot move to the current parent, self or a descendant.");
    }
    destinationPath = [];
    let ancestor = target;
    while (ancestor && ancestor.id !== context.root.id) {
      destinationPath.unshift(ancestor.id);
      ancestor = context.nodeMap.get(ancestor.parentId);
    }
    if (payload.destinationPath !== undefined &&
        JSON.stringify(payload.destinationPath) !== JSON.stringify(destinationPath)) {
      throw new Error("Destination moved. Cancel and choose the folder again.");
    }
  }
  let title;
  if (payload.action === "rename") {
    if (typeof payload.title !== "string") throw new Error("New title is required.");
    title = safeTitle(payload.title);
    if (!title || title.length > 1000) throw new Error("New title must contain between 1 and 1000 characters.");
    if (title === node.title) throw new Error("No title would change.");
  }
  return { node, target, title, destinationPath };
}

function applyNodeAction(payload = {}) {
  const request = clone(payload);
  const task = bookmarkBatchQueue.then(() => executeNodeAction(request));
  bookmarkBatchQueue = task.catch(() => {});
  return task;
}

async function executeNodeAction(payload) {
  const initial = await getBookmarkContext();
  const plan = validateNodeAction(payload, initial);
  // Also pin the destination during asynchronous intent storage when no path was supplied.
  if (plan.destinationPath) payload.destinationPath = plan.destinationPath;
  const previous = await storageGet({ [STORAGE_KEYS.UNDO]: null });
  const operationId = `${Date.now()}-${Math.random()}`;
  const undo = { action: payload.action, operationId, label: `${payload.action === "rename" ? "Renamed" : payload.action === "move" ? "Moved" : "Deleted"} item` };
  if (payload.action === "rename") undo.renames = [{ id: plan.node.id, oldTitle: plan.node.title, newTitle: plan.title }];
  if (payload.action === "move") undo.moves = [{ id: plan.node.id, oldParentId: plan.node.parentId, oldIndex: plan.node.index }];
  if (payload.action === "delete") {
    const records = await updateSavedWindowRecords(initial.root);
    const ids = new Set(payload.expected.map((item) => item.id));
    undo.verifyDeletedIds = true;
    undo.snapshots = [{ node: clone(plan.node), parentId: plan.node.parentId, index: plan.node.index,
      savedWindows: Object.fromEntries(Object.entries(records).filter(([id]) => ids.has(id))) }];
  }
  await setUndoSnapshot(undo);
  let node;
  try {
    await withInternalMutation(async () => {
      const current = validateNodeAction(payload, await getBookmarkContext());
      if (payload.action === "rename") node = await chromeCall(chrome.bookmarks.update.bind(chrome.bookmarks), payload.id, { title: current.title });
      if (payload.action === "move") node = await chromeCall(chrome.bookmarks.move.bind(chrome.bookmarks), payload.id, { parentId: current.target.id });
      if (payload.action === "delete") {
        const remove = current.node.url ? chrome.bookmarks.remove : chrome.bookmarks.removeTree;
        await chromeCall(remove.bind(chrome.bookmarks), payload.id);
      }
    });
  } catch (error) {
    try {
      const stored = await storageGet({ [STORAGE_KEYS.UNDO]: null });
      if (stored[STORAGE_KEYS.UNDO]?.operationId === operationId) {
        if (previous[STORAGE_KEYS.UNDO]) await storageSet({ [STORAGE_KEYS.UNDO]: previous[STORAGE_KEYS.UNDO] });
        else await storageRemove(STORAGE_KEYS.UNDO);
      }
    } catch (cleanupError) {
      throw new Error(`${error.message} Undo recovery failed: ${cleanupError.message}`);
    }
    throw error;
  }
  return { action: payload.action, changed: 1, ...(node ? { node } : {}) };
}

function validateBookmarkBatch(payload, context, completed = []) {
  if (!["move", "delete", "rename"].includes(payload.action)) throw new Error("Invalid bookmark action.");
  if (!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 1000 ||
      new Set(payload.ids).size !== payload.ids.length || payload.ids.some((id) => typeof id !== "string")) {
    throw new Error("Select between 1 and 1000 distinct bookmarks.");
  }
  if (!Array.isArray(payload.expected) || payload.expected.length !== payload.ids.length ||
      new Set(payload.expected.map((item) => item?.id)).size !== payload.ids.length) {
    throw new Error("Review the bookmark selection before continuing.");
  }
  const expected = new Map(payload.expected.map((item) => [item?.id, item]));
  const completedIds = new Set(completed.map((item) => item.before.id));
  const nodes = [];
  for (const id of payload.ids) {
    const previous = expected.get(id);
    if (!previous) throw new Error("Review the bookmark selection before continuing.");
    if (completedIds.has(id)) continue;
    const node = context.nodeMap.get(id);
    if (!node?.url || !canModifyNode(node, context)) throw new Error("Selected bookmarks changed, are missing, or are read-only. Cancel and review the selection.");
    const removedBefore = payload.action === "rename" ? 0 : completed.filter((item) =>
      item.before.parentId === previous.parentId && item.before.index < previous.index).length;
    if (node.parentId !== previous.parentId || node.url !== previous.url || (node.title || "") !== previous.title ||
        Number.isInteger(previous.index) && node.index !== previous.index - removedBefore) {
      throw new Error("Selected bookmarks changed. Cancel and review the selection.");
    }
    nodes.push(node);
  }
  let target;
  if (payload.action === "move") {
    target = writableFolder(payload.folderId, context);
    const ancestors = [];
    let parent = target;
    while (parent && parent.id !== context.root.id) { ancestors.unshift(parent.id); parent = context.nodeMap.get(parent.parentId); }
    if (JSON.stringify(payload.destinationPath) !== JSON.stringify(ancestors)) throw new Error("Destination moved. Cancel and choose the folder again.");
  }
  if (payload.action === "rename" && !["prefix", "suffix", "replace"].includes(payload.mode)) throw new Error("Choose a rename mode.");
  const text = String(payload.text || "");
  const find = String(payload.find || "");
  if (payload.action === "rename" && (!text.trim() && payload.mode !== "replace" || payload.mode === "replace" && !find)) {
    throw new Error("Enter the text to rename these bookmarks.");
  }
  const changes = nodes.map((node) => {
    const before = bookmarkSelectionSnapshot(node);
    if (payload.action === "move") return node.parentId === target.id ? null : { before };
    if (payload.action === "delete") return { before };
    const after = safeTitle(payload.mode === "prefix" ? text + before.title : payload.mode === "suffix" ? before.title + text : before.title.split(find).join(text));
    if (!after || after.length > 1000) throw new Error("Every resulting title must contain between 1 and 1000 characters.");
    return after === before.title ? null : { before, after };
  }).filter(Boolean);
  return { changes, target };
}

async function previewBookmarkBatch(payload = {}) {
  const context = await getBookmarkContext();
  const { changes } = validateBookmarkBatch(payload, context);
  return { count: changes.length, unchanged: payload.ids.length - changes.length,
    examples: changes.slice(0, 3).map((item) => ({ before: item.before.title, after: item.after || item.before.title })) };
}

function applyBookmarkBatch(payload = {}) {
  const request = clone(payload);
  const task = bookmarkBatchQueue.then(() => executeBookmarkBatch(request));
  bookmarkBatchQueue = task.catch(() => {});
  return task;
}

async function executeBookmarkBatch(payload) {
  if (payload.confirmed !== true) throw new Error("Confirm the selected bookmark action first.");
  const initial = await getBookmarkContext();
  const plan = validateBookmarkBatch(payload, initial);
  if (!plan.changes.length) throw new Error("No bookmarks would change.");
  const changes = plan.changes.sort((a, b) => a.before.parentId.localeCompare(b.before.parentId) || a.before.index - b.before.index);
  const operationId = `${Date.now()}-${Math.random()}`;
  const previousUndo = await storageGet({ [STORAGE_KEYS.UNDO]: null });
  const undo = (items) => {
    const snapshot = { action: payload.action, operationId, label: `${payload.action === "move" ? "Moved" : payload.action === "delete" ? "Deleted" : "Renamed"} ${items.length} bookmarks` };
    if (payload.action === "move") snapshot.moves = items.map(({ before }) => ({ id: before.id, oldParentId: before.parentId, oldIndex: before.index }));
    if (payload.action === "rename") snapshot.renames = items.map(({ before, after }) => ({ id: before.id, oldTitle: before.title, newTitle: after }));
    if (payload.action === "delete") {
      snapshot.verifyDeletedIds = true;
      snapshot.snapshots = items.map(({ before }) => ({ node: before, parentId: before.parentId, index: before.index }));
    }
    return snapshot;
  };
  const completed = [];
  await setUndoSnapshot(undo(changes));
  try {
    await withInternalMutation(async () => {
      for (const change of changes) {
        const context = await getBookmarkContext();
        const current = validateBookmarkBatch(payload, context, completed);
        if (!current.changes.some((item) => item.before.id === change.before.id)) throw new Error("Selected bookmarks changed. Cancel and review the selection.");
        if (payload.action === "move") await chromeCall(chrome.bookmarks.move.bind(chrome.bookmarks), change.before.id, { parentId: current.target.id });
        if (payload.action === "delete") await chromeCall(chrome.bookmarks.remove.bind(chrome.bookmarks), change.before.id);
        if (payload.action === "rename") await chromeCall(chrome.bookmarks.update.bind(chrome.bookmarks), change.before.id, { title: change.after });
        completed.push(change);
      }
    });
  } catch (error) {
    const stored = await storageGet({ [STORAGE_KEYS.UNDO]: null });
    if (stored[STORAGE_KEYS.UNDO]?.operationId === operationId) {
      if (completed.length) await setUndoSnapshot(undo(completed));
      else if (previousUndo[STORAGE_KEYS.UNDO]) await storageSet({ [STORAGE_KEYS.UNDO]: previousUndo[STORAGE_KEYS.UNDO] });
      else await storageRemove(STORAGE_KEYS.UNDO);
    }
    throw new Error(`${completed.length ? `Completed ${completed.length} bookmarks before stopping. ` : ""}${error.message}`);
  }
  const stored = await storageGet({ [STORAGE_KEYS.UNDO]: null });
  if (stored[STORAGE_KEYS.UNDO]?.operationId === operationId) await setUndoSnapshot(undo(completed));
  return { changed: completed.length, unchanged: payload.ids.length - completed.length, action: payload.action };
}

async function sortFolder(payload = {}) {
  const context = await getBookmarkContext();
  const folder = writableFolder(payload.folderId || context.area.managedRoot.id, context);
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
  if (Array.isArray(payload.ids) && !payload.ids.length) return { indexed: 0 };
  const state = await getManagerState();
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

  const patches = {};
  let indexed = 0;
  for (const bookmark of unique.values()) {
    const pageIndex = await buildPageIndex(bookmark.url, bookmark.title);
    patches[bookmark.normalizedUrl] = {
      ...pageIndex,
      updatedAt: stamp()
    };
    indexed += 1;
  }

  await mergeMetadataPatches(patches);
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
  if (Array.isArray(payload.ids) && !payload.ids.length) return { checked: 0, results: [], ignoredMissing: [] };
  const state = await getManagerState();
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

  const patches = {};
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
      patches[normalizedUrl] = {
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
  await mergeMetadataPatches(patches);

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

  if (snapshot.savedWindows?.[node.id]) {
    const tree = await chromeCall(chrome.bookmarks.getTree.bind(chrome.bookmarks));
    await updateSavedWindowRecords(tree[0], { [folder.id]: snapshot.savedWindows[node.id] });
  }

  const children = [...(node.children || [])].sort((a, b) => (a.index || 0) - (b.index || 0));
  for (const child of children) {
    await restoreDeletedNode({
      node: child,
      parentId: folder.id,
      index: child.index,
      savedWindows: snapshot.savedWindows
    }, folder.id);
  }

  return folder;
}

async function undoLast() {
  const data = await storageGet({ [STORAGE_KEYS.UNDO]: null });
  const undo = data[STORAGE_KEYS.UNDO];
  if (!undo) throw new Error("There is no undo action available.");

  // Restore deleted trees before initialization can create a replacement Library.
  let area;
  let restoreFallbackId;
  if (undo.action === "delete") {
    const settings = await getSettings();
    const defaultFolder = await getNode(settings.defaultFolderId);
    const tree = await chromeCall(chrome.bookmarks.getTree.bind(chrome.bookmarks));
    const fallback = isFolder(defaultFolder) ? defaultFolder : findWritableRoot(tree[0]);
    if (!fallback) throw new Error("No writable folder is available for restoration.");
    restoreFallbackId = fallback.id;
  } else {
    area = await ensureManagedArea();
  }

  await withInternalMutation(async () => {
    if (undo.action === "delete") {
      for (const snapshot of undo.snapshots || []) {
        // Persisted batch intent can include native deletes not reached before shutdown.
        if (undo.verifyDeletedIds && await getNode(snapshot.node.id)) continue;
        await restoreDeletedNode(snapshot, restoreFallbackId);
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

  if (undo.action === "delete") await ensureManagedArea();
  await storageRemove(STORAGE_KEYS.UNDO);
  return { undone: undo.label || undo.action };
}

async function recordExternalChange(type, summary) {
  clearTimeout(bookmarkRefreshTimer);
  bookmarkRefreshTimer = setTimeout(() => {
    storageSet({ [STORAGE_KEYS.REVISION]: Date.now() }).catch(console.error);
  }, 120);
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

async function openStandaloneManager() {
  await chromeCall(chrome.tabs.create.bind(chrome.tabs), {
    url: chrome.runtime.getURL("manager.html")
  });
}

async function openManagerSurface(tabId) {
  if (!tabId) {
    await openStandaloneManager();
    return;
  }

  try {
    const tab = await chromeCall(chrome.tabs.get.bind(chrome.tabs), tabId);
    if (!isHttpUrl(tab && tab.url)) {
      await openStandaloneManager();
      return;
    }

    await injectManagerOverlay(tabId);
  } catch (error) {
    console.error(error);
    await openStandaloneManager();
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
      case "getManagerState":
        result = await getManagerState();
        break;
      case "saveManagerNavigation":
        result = await saveManagerNavigation(payload);
        break;
      case "buildExport":
        result = await buildExport(payload);
        break;
      case "openExportPage":
        result = await openExportPage(payload);
        break;
      case "getCurrentTab":
        result = await getCurrentTab();
        break;
      case "quickSaveCurrentPage":
        result = await quickSaveCurrentPage(payload);
        break;
      case "saveAllWindows":
        result = await saveAllWindows();
        break;
      case "reopenSavedWindow":
        result = await reopenSavedWindow(payload);
        break;
      case "moveSavedItemsToLibrary":
        result = await moveSavedItemsToLibrary(payload);
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
      case "previewBookmarkBatch":
        result = await previewBookmarkBatch(payload);
        break;
      case "applyBookmarkBatch":
        result = await applyBookmarkBatch(payload);
        break;
      case "applyNodeAction":
        result = await applyNodeAction(payload);
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
