(function bookmarkAdminOverlay() {
  const ROOT_ID = "bookmark-admin-overlay";
  const DEFAULT_FOLDER_TITLE = "All";
  const IS_STANDALONE = document.documentElement.dataset.bookmarkAdminMode === "standalone";
  const assetUrl = (path) => chrome.runtime.getURL(`assets/${path}`);
  const ICONS = {
    app: assetUrl("app-icon/icon32.png"),
    bookmark: assetUrl("icons/bookmark-item.svg"),
    check: assetUrl("icons/dead-link-checker.svg"),
    export: assetUrl("icons/backup-export.svg"),
    folderClosed: assetUrl("icons/folder-closed.svg"),
    folderOpen: assetUrl("icons/folder-open.svg"),
    folderSelected: assetUrl("icons/folder-selected.svg"),
    index: assetUrl("icons/filter-tag.svg")
  };
  const ILLUSTRATIONS = {
    emptyLibrary: assetUrl("illustrations/empty-library.svg"),
    noSearchResults: assetUrl("illustrations/no-search-results.svg")
  };
  const state = {
    data: null,
    selectedFolderId: null,
    expanded: new Set(),
    search: "",
    dateFilter: "all",
    sortMode: "newest",
    issueFilter: "all",
    noteTimer: null,
    detailBookmark: null,
    dragging: null
  };

  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    existing.remove();
    return;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.innerHTML = `
    <div class="ba-backdrop" data-close="true"></div>
    <section class="ba-window" role="dialog" aria-label="Bookmark Admin">
      <header class="ba-titlebar" data-drag="true">
        <div class="ba-mark" aria-hidden="true"><img src="${ICONS.app}" alt=""></div>
        <div class="ba-title">
          <h1>Bookmark Admin</h1>
          <p class="ba-current">Loading bookmarks...</p>
        </div>
        <button class="ba-icon-btn ba-close" type="button" aria-label="Close">x</button>
      </header>
      <section class="ba-toolbar">
        <input class="ba-input ba-search" type="search" placeholder="Search page words, title, URL, or folder">
        <select class="ba-select ba-date-filter">
          <option value="all">Any time</option>
          <option value="today">Added today</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
          <option value="year">Last year</option>
        </select>
        <select class="ba-select ba-sort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="title">Title A-Z</option>
          <option value="used">Most used</option>
        </select>
        <select class="ba-select ba-issue-filter">
          <option value="all">All status</option>
          <option value="unchecked">Unchecked</option>
          <option value="issues">Issues only</option>
          <option value="unused">Never opened</option>
        </select>
        <button class="ba-button ba-blue ba-check" type="button"><img src="${ICONS.check}" alt=""><span>Check</span></button>
        <button class="ba-button ba-blue ba-index" type="button"><img src="${ICONS.index}" alt=""><span>Index</span></button>
        <button class="ba-button ba-export" type="button"><img src="${ICONS.export}" alt=""><span>Export</span></button>
      </section>
      <section class="ba-layout">
        <section class="ba-panel">
          <div class="ba-panel-header">
            <h2>Library</h2>
            <button class="ba-button ba-new-folder" type="button"><img src="${ICONS.folderOpen}" alt=""><span>New folder</span></button>
          </div>
          <ul class="ba-folder-tree"></ul>
        </section>
        <section class="ba-panel">
          <div class="ba-panel-header">
            <h2 class="ba-list-title">Bookmarks</h2>
            <span class="ba-list-count ba-muted"></span>
          </div>
          <div class="ba-bookmark-list"></div>
        </section>
        <aside class="ba-panel ba-detail">
          <div class="ba-detail-empty">
            <img class="ba-empty-visual" src="${ILLUSTRATIONS.emptyLibrary}" alt="">
            <span>Select Notes from a bookmark menu to edit notes here.</span>
          </div>
        </aside>
      </section>
      <footer class="ba-footer">
        <span class="ba-status">Ready.</span>
        <span>Right-click folders or bookmarks for actions.</span>
      </footer>
    </section>
    <div class="ba-menu ba-hidden"></div>
  `;
  document.documentElement.append(root);

  const els = {
    backdrop: root.querySelector(".ba-backdrop"),
    win: root.querySelector(".ba-window"),
    titlebar: root.querySelector(".ba-titlebar"),
    close: root.querySelector(".ba-close"),
    current: root.querySelector(".ba-current"),
    search: root.querySelector(".ba-search"),
    dateFilter: root.querySelector(".ba-date-filter"),
    sort: root.querySelector(".ba-sort"),
    issueFilter: root.querySelector(".ba-issue-filter"),
    check: root.querySelector(".ba-check"),
    index: root.querySelector(".ba-index"),
    export: root.querySelector(".ba-export"),
    newFolder: root.querySelector(".ba-new-folder"),
    tree: root.querySelector(".ba-folder-tree"),
    listTitle: root.querySelector(".ba-list-title"),
    listCount: root.querySelector(".ba-list-count"),
    bookmarkList: root.querySelector(".ba-bookmark-list"),
    detail: root.querySelector(".ba-detail"),
    status: root.querySelector(".ba-status"),
    menu: root.querySelector(".ba-menu")
  };

  bindEvents();
  load().catch(showError);

  function bindEvents() {
    els.backdrop.addEventListener("pointerdown", () => {
      if (!IS_STANDALONE) closeOverlay();
    });
    els.close.addEventListener("click", closeOverlay);
    els.win.addEventListener("pointerdown", (event) => event.stopPropagation());
    els.search.addEventListener("input", () => {
      state.search = els.search.value.trim().toLowerCase();
      render();
    });
    els.dateFilter.addEventListener("change", () => {
      state.dateFilter = els.dateFilter.value;
      renderBookmarks();
    });
    els.sort.addEventListener("change", () => {
      state.sortMode = els.sort.value;
      renderBookmarks();
    });
    els.issueFilter.addEventListener("change", () => {
      state.issueFilter = els.issueFilter.value;
      renderBookmarks();
    });
    els.check.addEventListener("click", () => checkVisible());
    els.index.addEventListener("click", () => refreshIndex(visibleBookmarkIds()));
    els.export.addEventListener("click", (event) => {
      event.stopPropagation();
      showMenu(event, [
        { label: "Export JSON", action: exportJson },
        { label: "Export HTML", action: exportHtml }
      ]);
    });
    els.newFolder.addEventListener("click", () => createFolder(state.selectedFolderId));
    root.addEventListener("click", (event) => {
      if (!els.menu.contains(event.target)) hideMenu();
    });
    document.addEventListener("keydown", onKeyDown, true);
    els.titlebar.addEventListener("pointerdown", beginDrag);
  }

  function send(type, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error((response && response.error) || "Extension request failed."));
          return;
        }
        resolve(response.result);
      });
    });
  }

  async function load(status) {
    state.data = await send("getState");
    state.selectedFolderId = state.selectedFolderId || state.data.managedRoot.id;
    state.expanded.add(state.data.managedRoot.id);
    els.current.textContent = IS_STANDALONE ? "Standalone manager" : location.href;
    render();
    if (status) setStatus(status);
  }

  function render() {
    renderTree();
    renderBookmarks();
    renderDetail();
  }

  function renderTree() {
    els.tree.textContent = "";
    const rootNode = state.data.root;
    els.tree.append(renderFolderNode(rootNode, true));
  }

  function renderFolderNode(folder, isRoot = false) {
    const item = document.createElement("li");
    const expanded = state.expanded.has(folder.id);
    const selected = state.selectedFolderId === folder.id;

    const row = document.createElement("div");
    row.className = `ba-folder-line ${selected ? "ba-selected" : ""}`;
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showFolderMenu(event, folder, isRoot);
    });

    const disclosure = document.createElement("button");
    disclosure.type = "button";
    disclosure.className = "ba-disclosure";
    disclosure.textContent = expanded ? "v" : ">";
    disclosure.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFolder(folder.id);
    });

    const folderIcon = document.createElement("img");
    folderIcon.className = "ba-node-icon";
    folderIcon.alt = "";
    folderIcon.src = selected ? ICONS.folderSelected : (expanded ? ICONS.folderOpen : ICONS.folderClosed);

    const name = document.createElement("button");
    name.type = "button";
    name.className = "ba-name";
    name.textContent = isRoot ? "Bookmark Admin" : folder.title || "Untitled";
    name.addEventListener("click", () => {
      state.selectedFolderId = folder.id;
      state.expanded.add(folder.id);
      render();
    });

    const count = document.createElement("span");
    count.className = "ba-count";
    count.textContent = countBookmarks(folder);

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "ba-icon-btn";
    menu.textContent = "...";
    menu.addEventListener("click", (event) => showFolderMenu(event, folder, isRoot));

    row.append(disclosure, folderIcon, name, count, menu);
    item.append(row);

    if (expanded) {
      const children = document.createElement("ul");
      children.className = "ba-tree-children";
      for (const child of folder.children || []) {
        if (child.url) children.append(renderTreeBookmark(child));
        else children.append(renderFolderNode(child));
      }
      item.append(children);
    }

    return item;
  }

  function renderTreeBookmark(node) {
    const item = document.createElement("li");
    item.className = "ba-tree-bookmark";
    item.addEventListener("contextmenu", (event) => {
      const bookmark = findFlatBookmark(node.id);
      if (!bookmark) return;
      event.preventDefault();
      showBookmarkMenu(event, bookmark);
    });

    const bookmarkIcon = document.createElement("img");
    bookmarkIcon.className = "ba-node-icon";
    bookmarkIcon.alt = "";
    bookmarkIcon.src = ICONS.bookmark;

    const title = document.createElement("button");
    title.type = "button";
    title.className = "ba-bookmark-title";
    title.textContent = node.title || node.url;
    title.addEventListener("click", () => openBookmark(node.id));

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "ba-icon-btn";
    menu.textContent = "...";
    menu.addEventListener("click", (event) => {
      const bookmark = findFlatBookmark(node.id);
      if (bookmark) showBookmarkMenu(event, bookmark);
    });

    item.append(bookmarkIcon, title, menu);
    return item;
  }

  function renderBookmarks() {
    const folder = folderById(state.selectedFolderId);
    const bookmarks = visibleBookmarks();
    els.listTitle.textContent = folder ? folder.title || "Bookmark Admin" : "Bookmarks";
    els.listCount.textContent = `${bookmarks.length} shown`;
    els.bookmarkList.textContent = "";

    if (!bookmarks.length) {
      const copy = state.search ? "No bookmarks match these filters." : "This folder does not have bookmarks yet.";
      const image = state.search ? ILLUSTRATIONS.noSearchResults : ILLUSTRATIONS.emptyLibrary;
      els.bookmarkList.append(renderEmptyState(copy, image));
      return;
    }

    for (const bookmark of bookmarks) {
      els.bookmarkList.append(renderBookmarkRow(bookmark));
    }
  }

  function renderBookmarkRow(bookmark) {
    const row = document.createElement("article");
    row.className = "ba-bookmark-row";
    row.draggable = true;
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showBookmarkMenu(event, bookmark);
    });
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("application/x-bookmark-node", bookmark.id);
      event.dataTransfer.effectAllowed = "move";
    });

    const bookmarkIcon = document.createElement("img");
    bookmarkIcon.className = "ba-node-icon";
    bookmarkIcon.alt = "";
    bookmarkIcon.src = ICONS.bookmark;

    const meta = document.createElement("div");
    meta.className = "ba-bookmark-meta";
    const title = document.createElement("button");
    title.type = "button";
    title.className = "ba-bookmark-title";
    title.textContent = bookmark.title || bookmark.url;
    title.addEventListener("click", () => openBookmark(bookmark.id));

    const sub = document.createElement("div");
    sub.className = "ba-bookmark-sub";
    const url = document.createElement("span");
    url.className = "ba-url";
    url.textContent = compactUrl(bookmark.url);
    const folder = document.createElement("span");
    folder.className = "ba-muted";
    folder.textContent = bookmark.folderPath;
    sub.append(url, folder);
    meta.append(title, sub, renderPills(bookmark));

    const date = document.createElement("span");
    date.className = "ba-date";
    date.textContent = formatDate(bookmark.dateAdded);

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "ba-icon-btn";
    menu.textContent = "...";
    menu.addEventListener("click", (event) => showBookmarkMenu(event, bookmark));

    row.append(bookmarkIcon, meta, date, menu);
    return row;
  }

  function renderEmptyState(copy, image) {
    const empty = document.createElement("div");
    empty.className = "ba-detail-empty";
    const visual = document.createElement("img");
    visual.className = "ba-empty-visual";
    visual.alt = "";
    visual.src = image;
    const text = document.createElement("span");
    text.textContent = copy;
    empty.append(visual, text);
    return empty;
  }

  function renderPills(bookmark) {
    const wrap = document.createElement("div");
    wrap.className = "ba-pills";
    const meta = bookmark.metadata || {};
    if (meta.notes) wrap.append(pill("notes"));
    if (meta.useCount) wrap.append(pill(`${meta.useCount} opens`));
    for (const tag of (meta.autoTags || []).slice(0, 3)) wrap.append(pill(tag));
    if (meta.deadStatus) wrap.append(pill(deadStatusLabel(meta.deadStatus), meta.deadStatus.state));
    return wrap;
  }

  function renderDetail() {
    if (!state.detailBookmark) {
      els.detail.textContent = "";
      els.detail.append(renderEmptyState("Select Notes from a bookmark menu to edit notes here.", ILLUSTRATIONS.emptyLibrary));
      return;
    }

    const bookmark = findFlatBookmark(state.detailBookmark.id) || state.detailBookmark;
    const meta = bookmark.metadata || {};
    els.detail.innerHTML = `
      <div class="ba-detail-card">
        <div>
          <div class="ba-detail-title"></div>
          <div class="ba-url"></div>
        </div>
        <label class="ba-muted">Notes auto-save</label>
        <textarea class="ba-textarea" placeholder="Add notes for this bookmark"></textarea>
        <div class="ba-pills"></div>
      </div>
    `;
    els.detail.querySelector(".ba-detail-title").textContent = bookmark.title || bookmark.url;
    els.detail.querySelector(".ba-url").textContent = bookmark.url;
    const textarea = els.detail.querySelector(".ba-textarea");
    textarea.value = meta.notes || "";
    textarea.addEventListener("input", () => autosaveNotes(bookmark, textarea.value));
    const pills = els.detail.querySelector(".ba-pills");
    for (const tag of (meta.autoTags || []).slice(0, 8)) pills.append(pill(tag));
  }

  function visibleBookmarks() {
    let bookmarks = [...state.data.bookmarks];
    if (state.selectedFolderId && state.selectedFolderId !== state.data.managedRoot.id) {
      bookmarks = bookmarks.filter((bookmark) =>
        bookmark.folderId === state.selectedFolderId || bookmark.folderAncestors.includes(state.selectedFolderId)
      );
    }

    bookmarks = bookmarks.filter(matchesDateFilter).filter(matchesIssueFilter);
    if (state.search) bookmarks = bookmarks.filter((bookmark) => searchableText(bookmark).includes(state.search));

    bookmarks.sort((a, b) => {
      if (state.sortMode === "oldest") return (a.dateAdded || 0) - (b.dateAdded || 0);
      if (state.sortMode === "title") return (a.title || "").localeCompare(b.title || "");
      if (state.sortMode === "used") return ((b.metadata || {}).useCount || 0) - ((a.metadata || {}).useCount || 0);
      return (b.dateAdded || 0) - (a.dateAdded || 0);
    });
    return bookmarks;
  }

  function matchesDateFilter(bookmark) {
    if (state.dateFilter === "all") return true;
    const added = bookmark.dateAdded || 0;
    const now = Date.now();
    const start = new Date();
    if (state.dateFilter === "today") {
      start.setHours(0, 0, 0, 0);
      return added >= start.getTime();
    }
    if (state.dateFilter === "week") return now - added <= 7 * 24 * 60 * 60 * 1000;
    if (state.dateFilter === "month") return now - added <= 30 * 24 * 60 * 60 * 1000;
    if (state.dateFilter === "year") return now - added <= 365 * 24 * 60 * 60 * 1000;
    return true;
  }

  function matchesIssueFilter(bookmark) {
    const meta = bookmark.metadata || {};
    if (state.issueFilter === "unchecked") return !meta.deadStatus;
    if (state.issueFilter === "issues") {
      return meta.deadStatus && (meta.deadStatus.state === "dead" || meta.deadStatus.state === "warning");
    }
    if (state.issueFilter === "unused") {
      return !(meta.useCount || 0) && !meta.lastOpenedAt && !bookmark.dateLastUsed;
    }
    return true;
  }

  function visibleBookmarkIds() {
    return visibleBookmarks().map((bookmark) => bookmark.id);
  }

  function searchableText(bookmark) {
    const meta = bookmark.metadata || {};
    return [
      bookmark.title,
      bookmark.url,
      bookmark.folderPath,
      meta.notes,
      ...(meta.tags || []),
      ...(meta.autoTags || []),
      ...(meta.indexTerms || [])
    ].join(" ").toLowerCase();
  }

  function showFolderMenu(event, folder, isRoot = false) {
    event.preventDefault();
    event.stopPropagation();
    const protectedFolder = isRoot || folder.id === state.data.defaultFolder.id;
    const items = [
      { label: "Expand / collapse", action: () => toggleFolder(folder.id) },
      { label: "New subfolder", action: () => createFolder(folder.id) },
      { label: "Sort this folder", action: () => sortFolder(folder.id) },
      { label: "Check links", action: () => checkIds([folder.id]) },
      { label: "Refresh page index", action: () => refreshIndex([folder.id]) }
    ];
    if (!protectedFolder) {
      items.push(
        { separator: true },
        { label: "Rename", action: () => renameNode(folder.id, folder.title) },
        { label: "Move folder", action: () => moveIds([folder.id]) },
        { label: "Delete folder", danger: true, action: () => deleteIds([folder.id]) }
      );
    }
    showMenu(event, items);
  }

  function showBookmarkMenu(event, bookmark) {
    event.preventDefault();
    event.stopPropagation();
    showMenu(event, [
      { label: "Open", action: () => openBookmark(bookmark.id) },
      { label: "Notes", action: () => openNotes(bookmark) },
      { label: "Move", action: () => moveIds([bookmark.id]) },
      { label: "Rename", action: () => renameNode(bookmark.id, bookmark.title) },
      { separator: true },
      { label: "Refresh page index", action: () => refreshIndex([bookmark.id]) },
      { label: "Check link", action: () => checkIds([bookmark.id]) },
      { separator: true },
      { label: "Delete", danger: true, action: () => deleteIds([bookmark.id]) }
    ]);
  }

  function showMenu(event, items) {
    els.menu.textContent = "";
    for (const item of items) {
      if (item.separator) {
        els.menu.append(document.createElement("hr"));
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      if (item.danger) button.className = "ba-danger";
      button.addEventListener("click", async () => {
        hideMenu();
        try {
          await item.action();
        } catch (error) {
          showError(error);
        }
      });
      els.menu.append(button);
    }
    els.menu.classList.remove("ba-hidden");
    const rect = els.menu.getBoundingClientRect();
    els.menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`;
    els.menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`;
  }

  function hideMenu() {
    els.menu.classList.add("ba-hidden");
  }

  function toggleFolder(id) {
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    renderTree();
  }

  async function openBookmark(id) {
    await send("openBookmark", { id });
    await load("Opened bookmark.");
  }

  function openNotes(bookmark) {
    state.detailBookmark = bookmark;
    renderDetail();
  }

  async function autosaveNotes(bookmark, notes) {
    clearTimeout(state.noteTimer);
    state.noteTimer = setTimeout(async () => {
      await send("updateMetadata", { id: bookmark.id, notes });
      bookmark.metadata = { ...(bookmark.metadata || {}), notes };
      if (state.detailBookmark && state.detailBookmark.id === bookmark.id) {
        state.detailBookmark.metadata = { ...(state.detailBookmark.metadata || {}), notes };
      }
      setStatus("Notes saved.");
      renderBookmarks();
    }, 550);
  }

  async function createFolder(parentId) {
    const title = prompt("New folder name", "");
    if (title === null || !title.trim()) return;
    const result = await send("createFolder", {
      title: title.trim(),
      parentId: parentId && parentId !== state.data.defaultFolder.id ? parentId : state.data.managedRoot.id
    });
    state.selectedFolderId = result.folder.id;
    state.expanded.add(result.folder.parentId);
    await load(result.existed ? "Folder already exists." : "Folder created.");
  }

  async function renameNode(id, currentTitle) {
    const title = prompt("Rename", currentTitle || "");
    if (title === null || !title.trim()) return;
    await send("renameNode", { id, title: title.trim() });
    await load("Renamed.");
  }

  async function moveIds(ids) {
    const folders = state.data.folders.map((folder) => `${folder.id}\t${folder.path || folder.title}`).join("\n");
    const label = prompt(`Move to folder name. Available folders:\n${folders}`, DEFAULT_FOLDER_TITLE);
    if (label === null || !label.trim()) return;
    const target = state.data.folders.find((folder) =>
      folder.title.toLowerCase() === label.trim().toLowerCase() ||
      folder.path.toLowerCase() === label.trim().toLowerCase()
    );
    if (!target) {
      setStatus("Folder not found.");
      return;
    }
    const result = await send("bulkMove", { ids, folderId: target.id });
    await load(`Moved ${result.moved}.`);
  }

  async function deleteIds(ids) {
    if (!confirm(`Delete ${ids.length} item${ids.length === 1 ? "" : "s"}?`)) return;
    const result = await send("bulkDelete", { ids });
    await load(`Deleted ${result.deleted}.`);
  }

  async function sortFolder(folderId) {
    const mode = state.sortMode === "title" ? "title-asc" : state.sortMode;
    const result = await send("sortFolder", { folderId, mode });
    await load(`Sorted ${result.sorted}.`);
  }

  async function checkVisible() {
    await checkIds(visibleBookmarkIds());
  }

  async function checkIds(ids) {
    if (!ids.length) return;
    setStatus(`Checking ${ids.length}...`);
    const result = await send("checkLinks", { ids });
    const issues = result.results.filter((item) => item.deadStatus.state !== "ok").length;
    await load(`Checked ${result.checked}. Issues: ${issues}.`);
  }

  async function refreshIndex(ids) {
    setStatus("Indexing...");
    const result = await send("refreshIndex", { ids });
    await load(`Indexed ${result.indexed}.`);
  }

  function exportJson() {
    const payload = {
      app: "Local Bookmark Admin",
      generatedAt: new Date().toISOString(),
      root: state.data.root,
      metadataByUrl: state.data.metadataByUrl,
      duplicateGroups: state.data.duplicateGroups
    };
    downloadText("bookmark-admin-backup.json", JSON.stringify(payload, null, 2), "application/json");
  }

  function exportHtml() {
    const html = [
      "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      "<TITLE>Bookmarks</TITLE>",
      "<H1>Bookmarks</H1>",
      "<DL><p>",
      renderHtmlNode(state.data.root, 1),
      "</DL><p>"
    ].join("\n");
    downloadText("bookmark-admin-bookmarks.html", html, "text/html");
  }

  function renderHtmlNode(node, depth) {
    const indent = "    ".repeat(depth);
    if (node.url) {
      const addDate = node.dateAdded ? Math.floor(node.dateAdded / 1000) : "";
      const meta = state.data.metadataByUrl[normalizeUrl(node.url)] || {};
      const lines = [
        `${indent}<DT><A HREF="${escapeHtml(node.url)}" ADD_DATE="${addDate}">${escapeHtml(node.title || node.url)}</A>`
      ];
      if (meta.notes) lines.push(`${indent}<DD>${escapeHtml(meta.notes)}`);
      return lines.join("\n");
    }

    const addDate = node.dateAdded ? Math.floor(node.dateAdded / 1000) : "";
    const lines = [
      `${indent}<DT><H3 ADD_DATE="${addDate}">${escapeHtml(node.title || "Folder")}</H3>`,
      `${indent}<DL><p>`
    ];
    for (const child of node.children || []) lines.push(renderHtmlNode(child, depth + 1));
    lines.push(`${indent}</DL><p>`);
    return lines.join("\n");
  }

  function downloadText(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function beginDrag(event) {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = els.win.getBoundingClientRect();
    state.dragging = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    els.titlebar.setPointerCapture(event.pointerId);
    els.titlebar.addEventListener("pointermove", dragWindow);
    els.titlebar.addEventListener("pointerup", endDrag, { once: true });
  }

  function dragWindow(event) {
    if (!state.dragging) return;
    const rect = els.win.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 12;
    const maxTop = window.innerHeight - rect.height - 12;
    const left = Math.max(12, Math.min(maxLeft, event.clientX - state.dragging.offsetX));
    const top = Math.max(12, Math.min(maxTop, event.clientY - state.dragging.offsetY));
    els.win.style.left = `${left}px`;
    els.win.style.top = `${top}px`;
    els.win.style.right = "auto";
  }

  function endDrag() {
    state.dragging = null;
    els.titlebar.removeEventListener("pointermove", dragWindow);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") closeOverlay();
  }

  function closeOverlay() {
    if (IS_STANDALONE) {
      window.close();
      setStatus("Close this tab to leave the manager.");
      return;
    }

    document.removeEventListener("keydown", onKeyDown, true);
    root.remove();
  }

  function countBookmarks(folder) {
    let count = 0;
    walk(folder, (node) => {
      if (node.url) count += 1;
    });
    return String(count);
  }

  function walk(node, visitor) {
    visitor(node);
    for (const child of node.children || []) walk(child, visitor);
  }

  function folderById(id) {
    if (state.data.root.id === id) return state.data.root;
    let match = null;
    walk(state.data.root, (node) => {
      if (!node.url && node.id === id) match = node;
    });
    return match;
  }

  function findFlatBookmark(id) {
    return state.data.bookmarks.find((bookmark) => bookmark.id === id);
  }

  function compactUrl(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    } catch {
      return url;
    }
  }

  function normalizeUrl(url) {
    try {
      const parsed = new URL(String(url || "").trim());
      parsed.hash = "";
      parsed.hostname = parsed.hostname.toLowerCase();
      return parsed.toString();
    } catch {
      return String(url || "").trim();
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(ms) {
    if (!ms) return "";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(ms));
  }

  function pill(text, type = "") {
    const span = document.createElement("span");
    span.className = `ba-pill ${type ? `ba-${type}` : ""}`;
    span.textContent = text;
    return span;
  }

  function deadStatusLabel(status) {
    if (!status) return "unchecked";
    if (status.state === "ok") return `ok ${status.code || ""}`.trim();
    if (status.state === "warning") return `warn ${status.code || ""}`.trim();
    return status.code ? `dead ${status.code}` : "dead";
  }

  function setStatus(message) {
    els.status.textContent = message;
  }

  function showError(error) {
    console.error(error);
    setStatus(error.message || String(error));
  }
})();
