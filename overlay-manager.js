(function bookmarkAdminOverlay() {
  const ROOT_ID = "bookmark-admin-overlay";
  const DEFAULT_FOLDER_TITLE = "All";
  const VIEW_LABELS = { library: "Library", windows: "Saved Windows", all: "All Bookmarks" };
  const IS_STANDALONE = window.location.href.split(/[?#]/, 1)[0] === chrome.runtime.getURL("manager.html");
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
    view: "library",
    selectedByView: { library: null, windows: null, all: null },
    selectedFolderId: null,
    expanded: new Set(),
    navigationLoaded: false,
    navigationWrite: null,
    search: "",
    dateFilter: "all",
    sortMode: "newest",
    issueFilter: "all",
    noteTimer: null,
    noteDrafts: new Map(),
    noteVersion: 0,
    noteFlushPromise: null,
    notesRevision: 0,
    detailBookmark: null,
    detailMode: "notes",
    detailRenderKey: null,
    detailDrawer: false,
    dragging: null,
    loadSequence: 0,
    refreshTimer: null
  };

  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    const dismissal = new Event("bookmark-admin-dismiss", { cancelable: true });
    existing.dispatchEvent(dismissal);
    if (!dismissal.defaultPrevented) existing.remove();
    return;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  const host = IS_STANDALONE ? root : document.createElement("div");
  host.id = ROOT_ID;
  const shadow = IS_STANDALONE ? null : host.attachShadow({ mode: "closed" });
  if (shadow) {
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;visibility:hidden";
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = chrome.runtime.getURL("overlay-manager.css");
    stylesheet.addEventListener("load", () => { host.style.visibility = "visible"; });
    shadow.append(stylesheet, root);
  }
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
      <nav class="ba-navigation" role="tablist" aria-label="Bookmark views">
        <button class="ba-view-tab" id="ba-view-library" role="tab" type="button" data-view="library" aria-selected="true" aria-controls="ba-manager-content">
          <img src="${ICONS.folderSelected}" alt=""><span>Library</span><span class="ba-nav-count"></span>
        </button>
        <button class="ba-view-tab" id="ba-view-windows" role="tab" type="button" data-view="windows" aria-selected="false" aria-controls="ba-manager-content" tabindex="-1">
          <img src="${ICONS.export}" alt=""><span>Saved Windows</span><span class="ba-nav-count"></span>
        </button>
        <button class="ba-view-tab" id="ba-view-all" role="tab" type="button" data-view="all" aria-selected="false" aria-controls="ba-manager-content" tabindex="-1">
          <img src="${ICONS.bookmark}" alt=""><span>All Bookmarks</span><span class="ba-nav-count"></span>
        </button>
      </nav>
      <section class="ba-toolbar">
        <input class="ba-input ba-search" type="search" aria-label="Search Library" placeholder="Search Library">
        <select class="ba-select ba-date-filter" aria-label="Date added">
          <option value="all">Any time</option>
          <option value="today">Added today</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
          <option value="year">Last year</option>
        </select>
        <select class="ba-select ba-sort" aria-label="Sort bookmarks">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="title">Title A-Z</option>
          <option value="used">Most used</option>
        </select>
        <select class="ba-select ba-issue-filter" aria-label="Bookmark status">
          <option value="all">All status</option>
          <option value="unchecked">Unchecked</option>
          <option value="issues">Issues only</option>
          <option value="unused">Never opened</option>
        </select>
        <button class="ba-button ba-blue ba-check" type="button"><img src="${ICONS.check}" alt=""><span>Check</span></button>
        <button class="ba-button ba-blue ba-index" type="button"><img src="${ICONS.index}" alt=""><span>Index</span></button>
        <button class="ba-button ba-export" type="button"><img src="${ICONS.export}" alt=""><span>Export</span></button>
      </section>
      <section class="ba-layout" id="ba-manager-content" role="tabpanel" aria-labelledby="ba-view-library">
        <section class="ba-panel ba-library-panel">
          <div class="ba-panel-header">
            <h2 class="ba-tree-title">Library</h2>
            <button class="ba-button ba-new-folder" type="button"><img src="${ICONS.folderOpen}" alt=""><span>New folder</span></button>
          </div>
          <button class="ba-overview" type="button" aria-pressed="true"><span class="ba-overview-label">All in Library</span><span class="ba-overview-count"></span></button>
          <div class="ba-tree-tools">
            <button class="ba-icon-btn ba-expand-all" type="button" title="Expand all folders" aria-label="Expand all folders">+</button>
            <button class="ba-icon-btn ba-collapse-all" type="button" title="Collapse all folders" aria-label="Collapse all folders">&minus;</button>
          </div>
          <ul class="ba-folder-tree" aria-label="Library folders"></ul>
        </section>
        <section class="ba-panel ba-list-panel">
          <div class="ba-panel-header">
            <h2 class="ba-list-title">Bookmarks</h2>
            <span class="ba-list-count ba-muted"></span>
          </div>
          <nav class="ba-breadcrumbs" aria-label="Folder path"></nav>
          <div class="ba-bookmark-list"></div>
        </section>
        <button class="ba-detail-scrim" type="button" aria-label="Dismiss details" tabindex="-1"></button>
        <aside class="ba-panel ba-detail" aria-label="Bookmark details" hidden></aside>
      </section>
      <footer class="ba-footer">
        <span class="ba-status">Ready.</span>
        <span>Right-click folders or bookmarks for actions.</span>
      </footer>
    </section>
    <div class="ba-menu ba-hidden"></div>
  `;
  document.documentElement.append(host);

  const els = {
    backdrop: root.querySelector(".ba-backdrop"),
    win: root.querySelector(".ba-window"),
    titlebar: root.querySelector(".ba-titlebar"),
    close: root.querySelector(".ba-close"),
    current: root.querySelector(".ba-current"),
    tabs: [...root.querySelectorAll(".ba-view-tab")],
    layout: root.querySelector(".ba-layout"),
    treeTitle: root.querySelector(".ba-tree-title"),
    overview: root.querySelector(".ba-overview"),
    overviewLabel: root.querySelector(".ba-overview-label"),
    overviewCount: root.querySelector(".ba-overview-count"),
    expandAll: root.querySelector(".ba-expand-all"),
    collapseAll: root.querySelector(".ba-collapse-all"),
    breadcrumbs: root.querySelector(".ba-breadcrumbs"),
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
    detailScrim: root.querySelector(".ba-detail-scrim"),
    treePanel: root.querySelector(".ba-library-panel"),
    listPanel: root.querySelector(".ba-list-panel"),
    status: root.querySelector(".ba-status"),
    menu: root.querySelector(".ba-menu")
  };

  bindEvents();
  load().catch(showError);

  function bindEvents() {
    els.newFolder.disabled = true;
    els.check.disabled = true;
    els.index.disabled = true;
    els.export.disabled = true;
    host.addEventListener("bookmark-admin-dismiss", (event) => {
      event.preventDefault();
      closeOverlay().catch(showError);
    });
    els.detailScrim.addEventListener("click", () => closeDetails().catch(showError));
    for (const tab of els.tabs) {
      tab.addEventListener("click", () => selectView(tab.dataset.view).catch(showError));
      tab.addEventListener("keydown", (event) => {
        const index = els.tabs.indexOf(tab);
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % els.tabs.length;
        if (event.key === "ArrowLeft") next = (index + els.tabs.length - 1) % els.tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = els.tabs.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        els.tabs[next].focus();
        selectView(els.tabs[next].dataset.view).catch(showError);
      });
    }
    els.overview.addEventListener("click", () => selectFolder(null).catch(showError));
    els.expandAll.addEventListener("click", () => setAllExpanded(true));
    els.collapseAll.addEventListener("click", () => setAllExpanded(false));
    els.backdrop.addEventListener("pointerdown", () => {
      if (!IS_STANDALONE) closeOverlay().catch(showError);
    });
    els.close.addEventListener("click", () => closeOverlay().catch(showError));
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
    els.check.addEventListener("click", () => checkVisible().catch(showError));
    els.index.addEventListener("click", () => refreshIndex(visibleBookmarkIds()).catch(showError));
    els.export.addEventListener("click", (event) => {
      event.stopPropagation();
      showMenu(event, [
        { label: "Export JSON", action: exportJson },
        { label: "Export HTML", action: exportHtml }
      ]);
    });
    els.newFolder.addEventListener("click", () => createFolder(newFolderParent()).catch(showError));
    root.addEventListener("click", (event) => {
      if (!els.menu.contains(event.target)) hideMenu();
    });
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", containDrawerFocus, true);
    els.titlebar.addEventListener("pointerdown", beginDrag);
    chrome.storage.onChanged.addListener(onStorageChanged);
    window.addEventListener("pagehide", onPageHide);
    state.detailResizeObserver = new ResizeObserver(syncDetailFocus);
    state.detailResizeObserver.observe(els.win);
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
    const sequence = ++state.loadSequence;
    const notesRevision = state.notesRevision;
    const data = await send("getManagerState");
    if (sequence !== state.loadSequence || !root.isConnected) return;
    if (notesRevision !== state.notesRevision) return load(status);
    const oldPath = state.data ? folderTrail(state.selectedFolderId).map((node) => node.id).join("/") : null;
    state.data = data;
    if (!state.navigationLoaded) {
      state.view = data.navigation.view;
      state.selectedByView = { ...data.navigation.selectedByView };
      state.expanded = new Set(data.navigation.expanded);
      state.selectedFolderId = state.selectedByView[state.view];
      state.navigationLoaded = true;
    }
    const beforeNavigation = JSON.stringify(navigationSnapshot());
    for (const view of Object.keys(VIEW_LABELS)) {
      if (!folderInView(state.selectedByView[view], view)) state.selectedByView[view] = null;
    }
    state.selectedFolderId = state.selectedByView[state.view];
    state.expanded = new Set([...state.expanded].filter((id) => folderById(id) && id !== data.root.id));
    const revealLocation = oldPath !== folderTrail(state.selectedFolderId).map((node) => node.id).join("/");
    if (revealLocation) revealFolder(state.selectedFolderId);
    if (beforeNavigation !== JSON.stringify(navigationSnapshot())) persistNavigation();
    const currentDetail = state.detailBookmark && findFlatBookmark(state.detailBookmark.id);
    const urlChanged = currentDetail && currentDetail.url !== state.detailBookmark.url;
    if (state.detailBookmark && (!currentDetail || urlChanged)) {
      await flushNotes();
      if (sequence !== state.loadSequence || !root.isConnected) return;
      state.detailBookmark = currentDetail || null;
      state.detailRenderKey = null;
    }
    render();
    if (revealLocation) els.tree.querySelector(".ba-selected")?.scrollIntoView({ block: "nearest" });
    if (status) setStatus(status);
    else if (urlChanged) setStatus("Bookmark URL changed. Details refreshed.");
  }

  function render() {
    if (!state.data) return;
    renderNavigation();
    renderTree();
    renderBreadcrumbs();
    renderBookmarks();
    renderDetail();
  }

  async function selectView(view) {
    if (!state.data || !VIEW_LABELS[view]) return;
    await flushNotes();
    state.selectedByView[state.view] = state.selectedFolderId;
    state.view = view;
    state.selectedFolderId = state.selectedByView[view];
    if (state.selectedFolderId && !folderInView(state.selectedFolderId)) state.selectedFolderId = null;
    state.detailBookmark = null;
    hideMenu();
    revealFolder(state.selectedFolderId);
    render();
    persistNavigation();
  }

  function scopeRoots(view = state.view) {
    if (view === "library") return [folderById(state.data.managedRoot.id)].filter(Boolean);
    if (view === "windows") return state.data.savedWindowFolderIds.map(folderById).filter(Boolean);
    return state.data.root.children || [];
  }

  function scopeBookmarks(view = state.view) {
    if (view === "all") return state.data.bookmarks;
    const ids = new Set(scopeRoots(view).map((node) => node.id));
    return state.data.bookmarks.filter((bookmark) =>
      ids.has(bookmark.folderId) || bookmark.folderAncestors.some((id) => ids.has(id))
    );
  }

  function folderInView(id, view = state.view) {
    const folder = folderById(id);
    if (!folder) return false;
    if (view === "all") return id !== state.data.root.id;
    return scopeRoots(view).some((node) => {
      let found = false;
      walk(node, (child) => { if (child.id === id && !child.url) found = true; });
      return found;
    });
  }

  function navigationSnapshot() {
    return { view: state.view, selectedByView: { ...state.selectedByView }, expanded: [...state.expanded] };
  }

  function persistNavigation() {
    if (!state.navigationLoaded) return Promise.resolve();
    state.navigationWrite = send("saveManagerNavigation", navigationSnapshot());
    state.navigationWrite.catch(showError);
    return state.navigationWrite;
  }

  function folderTrail(id) {
    const trail = [];
    let folder = folderById(id);
    while (folder && folder.id !== state.data.root.id) {
      trail.unshift(folder);
      folder = folderById(folder.parentId);
    }
    return trail;
  }

  function revealFolder(id) {
    for (const folder of folderTrail(id)) {
      if (folderInView(folder.id)) state.expanded.add(folder.id);
    }
  }

  function renderBreadcrumbs() {
    els.breadcrumbs.textContent = "";
    const scrollTrail = document.createElement("div");
    scrollTrail.className = "ba-breadcrumb-trail";
    const trail = folderTrail(state.selectedFolderId).filter((folder) => folderInView(folder.id) &&
      !(state.view === "library" && folder.id === state.data.managedRoot.id));
    const parts = [{ id: null, title: VIEW_LABELS[state.view] }, ...trail.map((folder) => ({ id: folder.id, title: folder.title || "Untitled" }))];
    for (const [index, part] of parts.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = part.title;
      button.title = part.title;
      if (index === parts.length - 1) button.setAttribute("aria-current", "location");
      button.addEventListener("click", () => selectFolder(part.id).then(() => {
        els.breadcrumbs.querySelector('[aria-current="location"]')?.focus();
      }).catch(showError));
      if (index === 0) els.breadcrumbs.append(button);
      else scrollTrail.append(button);
    }
    if (scrollTrail.childElementCount) els.breadcrumbs.append(scrollTrail);
    scrollTrail.lastElementChild?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function setAllExpanded(expanded) {
    for (const scope of scopeRoots()) walk(scope, (node) => {
      if (node.url) return;
      if (expanded && node.children?.length) state.expanded.add(node.id);
      else state.expanded.delete(node.id);
    });
    renderTree();
    persistNavigation();
  }

  function newFolderParent() {
    return state.selectedFolderId || (state.view === "library" ? state.data.managedRoot.id : null);
  }

  function renderNavigation() {
    root.dataset.view = state.view;
    const label = VIEW_LABELS[state.view];
    els.current.textContent = label;
    els.layout.setAttribute("aria-labelledby", `ba-view-${state.view}`);
    els.treeTitle.textContent = label;
    els.tree.setAttribute("aria-label", `${label} folders`);
    els.overviewLabel.textContent = state.view === "all" ? "All bookmarks" :
      (state.view === "windows" ? "All saved windows" : "All in Library");
    els.overviewCount.textContent = scopeBookmarks().length;
    els.overview.setAttribute("aria-pressed", String(!state.selectedFolderId));
    els.search.placeholder = `Search ${label}`;
    els.search.setAttribute("aria-label", `Search ${label}`);
    const parentId = newFolderParent();
    els.newFolder.disabled = !parentId || state.data.readOnlyNodeIds.includes(parentId);
    els.newFolder.title = parentId ? "New folder" : "Select a destination folder";
    els.export.title = `Export ${state.selectedFolderId ? folderById(state.selectedFolderId).title : label}`;
    els.export.disabled = false;
    for (const tab of els.tabs) {
      const selected = tab.dataset.view === state.view;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.querySelector(".ba-nav-count").textContent = scopeBookmarks(tab.dataset.view).length;
    }
  }

  function onStorageChanged(changes, area) {
    if (area !== "local" || !changes.bookmarkRevision) return;
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => load().catch(showError), 180);
  }

  function renderTree() {
    const active = shadow?.activeElement || document.activeElement;
    const focusedFolder = els.tree.contains(active) && active.closest(".ba-folder-line")?.dataset.folderId;
    const focusedControl = active?.matches(".ba-name") ? ".ba-name" :
      (active?.matches(".ba-disclosure") ? ".ba-disclosure" : ".ba-icon-btn");
    const scrollTop = els.tree.scrollTop;
    els.tree.textContent = "";
    const nodes = state.view === "library" ? (scopeRoots()[0]?.children || []) : scopeRoots();
    for (const node of nodes) {
      els.tree.append(node.url ? renderTreeBookmark(node) : renderFolderNode(node));
    }
    let expandable = false;
    let anyExpanded = false;
    for (const scope of scopeRoots()) walk(scope, (node) => {
      if (!node.url && node.children?.length) {
        expandable = true;
        if (state.expanded.has(node.id)) anyExpanded = true;
      }
    });
    els.expandAll.disabled = !expandable;
    els.collapseAll.disabled = !anyExpanded;
    if (!nodes.length) {
      const empty = document.createElement("li");
      empty.className = "ba-tree-empty";
      empty.textContent = state.view === "windows" ? "No saved windows" : "No folders";
      els.tree.append(empty);
    }
    els.tree.scrollTop = scrollTop;
    if (focusedFolder) els.tree.querySelector(`[data-folder-id="${CSS.escape(focusedFolder)}"] ${focusedControl}`)?.focus({ preventScroll: true });
  }

  function renderFolderNode(folder, isRoot = false, depth = 0) {
    const item = document.createElement("li");
    const expanded = state.expanded.has(folder.id);
    const selected = state.selectedFolderId === folder.id;

    const row = document.createElement("div");
    row.className = `ba-folder-line ${selected ? "ba-selected" : ""}`;
    row.dataset.folderId = folder.id;
    row.dataset.depth = depth;
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showFolderMenu(event, folder, isRoot);
    });
    row.addEventListener("click", (event) => {
      if (!event.target.closest("button")) selectFolder(folder.id).catch(showError);
    });

    const disclosure = document.createElement("button");
    disclosure.type = "button";
    disclosure.className = "ba-disclosure";
    const hasChildren = Boolean(folder.children?.length);
    disclosure.disabled = !hasChildren;
    if (hasChildren) disclosure.setAttribute("aria-expanded", String(expanded));
    disclosure.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${folder.title}`);
    disclosure.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFolder(folder.id);
      els.tree.querySelector(`[data-folder-id="${CSS.escape(folder.id)}"] .ba-disclosure`)?.focus();
    });

    const folderIcon = document.createElement("img");
    folderIcon.className = "ba-node-icon";
    folderIcon.alt = "";
    folderIcon.src = selected ? ICONS.folderSelected : (expanded ? ICONS.folderOpen : ICONS.folderClosed);

    const name = document.createElement("button");
    name.type = "button";
    name.className = "ba-name";
    name.textContent = folderDisplayName(folder, isRoot);
    name.title = state.data.folders.find((node) => node.id === folder.id)?.path || folder.title;
    if (selected) name.setAttribute("aria-current", "true");
    name.addEventListener("click", () => selectFolder(folder.id).catch(showError));

    const count = document.createElement("span");
    count.className = "ba-count";
    count.textContent = countBookmarks(folder);

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "ba-icon-btn";
    menu.textContent = "...";
    menu.addEventListener("click", (event) => showFolderMenu(event, folder, isRoot));

    menu.setAttribute("aria-label", `Options for ${folder.title}`);
    row.append(disclosure, folderIcon, name, count, menu);
    item.append(row);

    if (expanded) {
      const children = document.createElement("ul");
      children.className = "ba-tree-children";
      children.style.setProperty("--ba-indent", depth < 4 ? "12px" : "0px");
      for (const child of folder.children || []) {
        if (child.url) children.append(renderTreeBookmark(child));
        else children.append(renderFolderNode(child, false, depth + 1));
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
    title.textContent = bookmarkTitle(node);
    title.title = `${bookmarkTitle(node)}\n${node.url}`;
    title.addEventListener("click", () => openBookmark(node.id).catch(showError));

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "ba-icon-btn";
    menu.textContent = "...";
    menu.addEventListener("click", (event) => {
      const bookmark = findFlatBookmark(node.id);
      if (bookmark) showBookmarkMenu(event, bookmark);
    });

    menu.setAttribute("aria-label", `Options for ${node.title || "bookmark"}`);
    item.append(bookmarkIcon, title, menu);
    return item;
  }

  async function selectFolder(folderId, expand = true) {
    if (!state.data) return;
    await flushNotes();
    state.detailBookmark = null;
    state.selectedFolderId = folderId;
    state.selectedByView[state.view] = folderId;
    if (expand && folderId) revealFolder(folderId);
    render();
    els.tree.querySelector(".ba-selected")?.scrollIntoView({ block: "nearest" });
    persistNavigation();
  }

  function renderBookmarks() {
    if (!state.data) return;
    const folder = folderById(state.selectedFolderId);
    const bookmarks = visibleBookmarks();
    els.listTitle.textContent = folder ? folderDisplayName(folder) : VIEW_LABELS[state.view];
    els.listCount.textContent = `${bookmarks.length} shown`;
    els.bookmarkList.textContent = "";
    els.check.disabled = !bookmarks.length;
    els.index.disabled = !bookmarks.length;

    if (!bookmarks.length) {
      const filtered = state.search || state.dateFilter !== "all" || state.issueFilter !== "all";
      const copy = filtered ? "No bookmarks match these filters." :
        (state.view === "windows" && !scopeRoots().length ? "No saved windows yet." : "No bookmarks here yet.");
      const image = filtered ? ILLUSTRATIONS.noSearchResults : ILLUSTRATIONS.emptyLibrary;
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
    row.dataset.bookmarkId = bookmark.id;
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
    title.textContent = bookmarkTitle(bookmark);
    title.title = `${bookmarkTitle(bookmark)}\n${bookmark.url}`;
    title.addEventListener("click", () => openBookmark(bookmark.id).catch(showError));

    const sub = document.createElement("div");
    sub.className = "ba-bookmark-sub";
    const folder = document.createElement("span");
    folder.className = "ba-muted";
    folder.textContent = bookmark.folderPath;
    folder.title = bookmark.folderPath;
    sub.append(folder);
    meta.append(title, sub);

    const date = document.createElement("time");
    date.className = "ba-date";
    date.textContent = formatDate(bookmark.dateAdded);
    if (bookmark.dateAdded) {
      date.dateTime = new Date(bookmark.dateAdded).toISOString();
      date.title = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(new Date(bookmark.dateAdded));
      date.setAttribute("aria-label", `Added ${date.title}`);
    }

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "ba-icon-btn";
    menu.textContent = "...";
    menu.addEventListener("click", (event) => showBookmarkMenu(event, bookmark));

    menu.setAttribute("aria-label", `Options for ${bookmarkTitle(bookmark)}`);
    row.append(bookmarkIcon, meta, renderLinkIndicator(bookmark), date, menu);
    return row;
  }

  function bookmarkTitle(bookmark) {
    return String(bookmark.title || "").trim() || "Untitled bookmark";
  }

  function renderLinkIndicator(bookmark) {
    const indicator = document.createElement("span");
    indicator.className = "ba-row-status";
    const status = (bookmark.metadata || {}).deadStatus;
    if (!status || !["dead", "warning"].includes(status.state)) {
      indicator.setAttribute("aria-hidden", "true");
      return indicator;
    }
    const label = `${status.state === "dead" ? "Broken link" : "Link warning"}: ${status.message || deadStatusLabel(status)}`;
    indicator.dataset.state = status.state;
    indicator.setAttribute("role", "img");
    indicator.setAttribute("aria-label", label);
    indicator.title = label;
    const icon = document.createElement("img");
    icon.src = ICONS.check;
    icon.alt = "";
    indicator.append(icon);
    return indicator;
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
    for (const tag of (meta.autoTags || []).slice(0, 8)) wrap.append(pill(tag));
    if (meta.deadStatus) wrap.append(pill(deadStatusLabel(meta.deadStatus), meta.deadStatus.state));
    return wrap;
  }

  function renderDetail() {
    const open = Boolean(state.detailBookmark);
    els.detail.hidden = !open;
    els.layout.classList.toggle("ba-has-detail", open);
    if (!state.detailBookmark) {
      els.detail.textContent = "";
      state.detailRenderKey = null;
      syncDetailFocus();
      return;
    }

    const bookmark = findFlatBookmark(state.detailBookmark.id) || state.detailBookmark;
    const meta = bookmark.metadata || {};
    const key = `${bookmark.id}:${state.detailMode}:${bookmark.url}`;
    if (key === state.detailRenderKey && state.detailMode === "notes") {
      const textarea = els.detail.querySelector("textarea");
      els.detail.querySelector(".ba-detail-title").textContent = bookmarkTitle(bookmark);
      if (!state.noteDrafts.has(noteKey(bookmark)) && (shadow || document).activeElement !== textarea) {
        textarea.value = meta.notes || "";
      }
      updateNoteStatus();
      syncDetailFocus();
      return;
    }
    state.detailRenderKey = key;
    els.detail.innerHTML = `
      <header class="ba-panel-header ba-detail-header">
        <h2>Bookmark details</h2>
        <button class="ba-icon-btn ba-detail-close" type="button" aria-label="Close details" title="Close details">x</button>
      </header>
      <div class="ba-detail-title" tabindex="-1"></div>
      <div class="ba-detail-tabs" role="tablist" aria-label="Bookmark detail views">
        <button type="button" class="ba-detail-tab" role="tab" data-mode="notes" id="ba-detail-notes" aria-controls="ba-detail-content">Notes</button>
        <button type="button" class="ba-detail-tab" role="tab" data-mode="properties" id="ba-detail-properties" aria-controls="ba-detail-content">Properties</button>
      </div>
      <div class="ba-detail-content" id="ba-detail-content" role="tabpanel"></div>
    `;
    els.detail.querySelector(".ba-detail-title").textContent = bookmarkTitle(bookmark);
    els.detail.querySelector(".ba-detail-close").addEventListener("click", () => closeDetails().catch(showError));
    const tabs = [...els.detail.querySelectorAll(".ba-detail-tab")];
    for (const [index, tab] of tabs.entries()) {
      const selected = tab.dataset.mode === state.detailMode;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.addEventListener("click", () => openDetails(bookmark, tab.dataset.mode, false).then(() => {
        els.detail.querySelector(`.ba-detail-tab[data-mode="${tab.dataset.mode}"]`).focus();
      }).catch(showError));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
        openDetails(bookmark, tabs[next].dataset.mode, false).then(() => {
          els.detail.querySelector(`.ba-detail-tab[data-mode="${tabs[next].dataset.mode}"]`).focus();
        }).catch(showError);
      });
    }
    const content = els.detail.querySelector(".ba-detail-content");
    content.setAttribute("aria-labelledby", `ba-detail-${state.detailMode}`);
    content.tabIndex = 0;
    if (state.detailMode === "notes") {
      content.innerHTML = `
        <div class="ba-notes-editor">
          <label class="ba-muted" for="ba-bookmark-notes">Notes</label>
          <textarea id="ba-bookmark-notes" class="ba-textarea" placeholder="Add notes"></textarea>
          <div class="ba-note-feedback"><span class="ba-note-status" role="status" aria-live="polite"></span>
            <button class="ba-button ba-note-retry" type="button" hidden>Retry</button></div>
        </div>`;
      const textarea = content.querySelector("textarea");
      textarea.value = state.noteDrafts.get(noteKey(bookmark))?.notes ?? meta.notes ?? "";
      textarea.addEventListener("input", () => queueNotes(bookmark, textarea.value));
      content.querySelector(".ba-note-retry").addEventListener("click", () => flushNotes().catch(showError));
      updateNoteStatus();
    } else {
      const properties = document.createElement("dl");
      properties.className = "ba-properties";
      const lastOpened = Math.max(new Date(meta.lastOpenedAt || 0).getTime() || 0, bookmark.dateLastUsed || 0);
      const fields = [
        ["Title", bookmarkTitle(bookmark)], ["URL", bookmark.url], ["Folder", bookmark.folderPath],
        ["Added", fullDate(bookmark.dateAdded)],
        ["Last opened", fullDate(lastOpened)],
        ["Opens in Bookmark Admin", String(meta.useCount || 0)],
        ["Link status", meta.deadStatus ? meta.deadStatus.message || deadStatusLabel(meta.deadStatus) : "Not checked"]
      ];
      for (const [label, value] of fields) {
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = value || "-";
        properties.append(term, description);
      }
      content.append(properties, renderPills(bookmark));
      if (meta.tags?.length) {
        const tags = document.createElement("div");
        tags.className = "ba-pills";
        for (const tag of meta.tags) tags.append(pill(tag));
        content.append(tags);
      }
    }
    syncDetailFocus();
  }

  function syncDetailFocus() {
    state.detailDrawer = !els.detail.hidden && getComputedStyle(els.detailScrim).display !== "none";
    els.treePanel.inert = state.detailDrawer;
    els.listPanel.inert = state.detailDrawer;
    els.detail.setAttribute("role", state.detailDrawer ? "dialog" : "complementary");
    if (state.detailDrawer) els.detail.setAttribute("aria-modal", "true");
    else els.detail.removeAttribute("aria-modal");
    containDrawerFocus();
  }

  function containDrawerFocus() {
    if (!state.detailDrawer || !root.isConnected || els.detail.contains((shadow || document).activeElement)) return;
    els.detail.querySelector(state.detailMode === "notes" ? "textarea" : ".ba-detail-title")?.focus();
  }

  function fullDate(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(date) : "-";
  }

  function visibleBookmarks() {
    if (!state.data) return [];
    let bookmarks = [...scopeBookmarks()];
    if (state.selectedFolderId) {
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
    const protectedFolder = state.data.protectedNodeIds.includes(folder.id);
    const readOnly = state.data.readOnlyNodeIds.includes(folder.id);
    const items = [
      { label: "Expand / collapse", action: () => toggleFolder(folder.id) },
      { label: "Check links", action: () => checkIds([folder.id]) },
      { label: "Refresh page index", action: () => refreshIndex([folder.id]) }
    ];
    if (!readOnly) items.splice(1, 0,
      { label: "New subfolder", action: () => createFolder(folder.id) },
      { label: "Sort this folder", action: () => sortFolder(folder.id) }
    );
    if (!protectedFolder && !readOnly) {
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
    const items = [
      { label: "Open", action: () => openBookmark(bookmark.id) },
      { label: "Notes", action: () => openDetails(bookmark, "notes") },
      { label: "Properties", action: () => openDetails(bookmark, "properties") },
      { separator: true },
      { label: "Refresh page index", action: () => refreshIndex([bookmark.id]) },
      { label: "Check link", action: () => checkIds([bookmark.id]) }
    ];
    if (!state.data.readOnlyNodeIds.includes(bookmark.id)) {
      items.splice(3, 0,
        { label: "Move", action: () => moveIds([bookmark.id]) },
        { label: "Rename", action: () => renameNode(bookmark.id, bookmark.title) }
      );
      items.push({ separator: true }, { label: "Delete", danger: true, action: () => deleteIds([bookmark.id]) });
    }
    showMenu(event, items);
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
    persistNavigation();
  }

  async function openBookmark(id) {
    await send("openBookmark", { id });
    await load("Opened bookmark.");
  }

  async function openDetails(bookmark, mode, focus = true) {
    await flushNotes();
    state.detailBookmark = findFlatBookmark(bookmark.id) || bookmark;
    state.detailMode = mode;
    renderDetail();
    if (focus) {
      const target = els.detail.querySelector(mode === "notes" ? "textarea" : ".ba-detail-title");
      target.focus();
    }
  }

  async function closeDetails() {
    await flushNotes();
    const id = state.detailBookmark?.id;
    state.detailBookmark = null;
    renderDetail();
    const target = id && els.bookmarkList.querySelector(`[data-bookmark-id="${CSS.escape(id)}"] .ba-icon-btn`);
    (target || els.search).focus();
  }

  function noteKey(bookmark) {
    return bookmark.normalizedUrl || bookmark.url;
  }

  function queueNotes(bookmark, notes) {
    state.noteDrafts.set(noteKey(bookmark), {
      id: bookmark.id, url: bookmark.url, title: bookmarkTitle(bookmark),
      notes, version: ++state.noteVersion, error: null
    });
    clearTimeout(state.noteTimer);
    state.noteTimer = setTimeout(() => flushNotes().catch(showError), 450);
    updateNoteStatus();
  }

  function updateNoteStatus() {
    const status = els.detail.querySelector(".ba-note-status");
    if (!status) return;
    const error = [...state.noteDrafts.values()].find((draft) => draft.error);
    const pending = state.detailBookmark && state.noteDrafts.has(noteKey(state.detailBookmark));
    status.textContent = error ? `Could not save notes: ${error.error}` : pending ? "Saving..." : "Saved";
    status.classList.toggle("ba-note-error", Boolean(error));
    els.detail.querySelector(".ba-note-retry").hidden = !error;
  }

  function flushNotes() {
    clearTimeout(state.noteTimer);
    if (state.noteFlushPromise) return state.noteFlushPromise;
    if (!state.noteDrafts.size) return Promise.resolve();
    state.noteFlushPromise = (async () => {
      while (state.noteDrafts.size) {
        const [key, draft] = state.noteDrafts.entries().next().value;
        draft.error = null;
        updateNoteStatus();
        try {
          await send("updateMetadata", { id: draft.id, url: draft.url, notes: draft.notes });
        } catch (error) {
          state.noteDrafts.get(key).error = error.message || String(error);
          updateNoteStatus();
          throw error;
        }
        state.notesRevision += 1;
        // A newer edit must survive an older request finishing.
        if (state.noteDrafts.get(key)?.version === draft.version) state.noteDrafts.delete(key);
        for (const bookmark of state.data.bookmarks) {
          if (noteKey(bookmark) === key) bookmark.metadata = { ...(bookmark.metadata || {}), notes: draft.notes };
        }
        if (state.detailBookmark && noteKey(state.detailBookmark) === key) {
          state.detailBookmark.metadata = { ...(state.detailBookmark.metadata || {}), notes: draft.notes };
        }
        state.data.metadataByUrl[key] = { ...(state.data.metadataByUrl[key] || {}), notes: draft.notes };
        updateNoteStatus();
      }
      setStatus("Notes saved.");
      renderBookmarks();
    })().finally(() => { state.noteFlushPromise = null; });
    return state.noteFlushPromise;
  }

  function onPageHide() {
    clearTimeout(state.noteTimer);
    // Deliver the latest snapshots directly; the worker serializes their writes.
    for (const draft of state.noteDrafts.values()) {
      send("updateMetadata", { url: draft.url, notes: draft.notes }).catch(() => {});
    }
  }

  async function createFolder(parentId) {
    if (!parentId) return;
    const title = prompt("New folder name", "");
    if (title === null || !title.trim()) return;
    const result = await send("createFolder", {
      title: title.trim(),
      parentId
    });
    state.selectedFolderId = result.folder.id;
    state.selectedByView[state.view] = result.folder.id;
    state.expanded.add(result.folder.parentId);
    await load(result.existed ? "Folder already exists." : "Folder created.");
    persistNavigation();
  }

  async function renameNode(id, currentTitle) {
    const title = prompt("Rename", currentTitle || "");
    if (title === null || !title.trim()) return;
    await send("renameNode", { id, title: title.trim() });
    await load("Renamed.");
  }

  async function moveIds(ids) {
    const destinations = state.data.folders.filter((folder) => !state.data.readOnlyNodeIds.includes(folder.id));
    const folders = destinations.map((folder) => folder.path || folder.title).join("\n");
    const label = prompt(`Move to folder name. Available folders:\n${folders}`, DEFAULT_FOLDER_TITLE);
    if (label === null || !label.trim()) return;
    const query = label.trim().toLowerCase();
    const paths = destinations.filter((folder) => folder.path.toLowerCase() === query);
    const matches = paths.length ? paths : destinations.filter((folder) => folder.title.toLowerCase() === query);
    const target = matches.length === 1 ? matches[0] : null;
    if (!target) {
      setStatus(matches.length ? "More than one folder matches. Use the full folder path." : "Folder not found.");
      return;
    }
    const result = await send("bulkMove", { ids, folderId: target.id });
    await load(`Moved ${result.moved}.`);
  }

  async function deleteIds(ids) {
    if (!confirm(`Delete ${ids.length} item${ids.length === 1 ? "" : "s"}?`)) return;
    const result = await send("bulkDelete", { ids });
    await load(`Deleted ${result.deleted}.${result.failed ? ` Could not delete ${result.failed}.` : ""}`);
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
    if (!ids.length) return;
    setStatus("Indexing...");
    const result = await send("refreshIndex", { ids });
    await load(`Indexed ${result.indexed}.`);
  }

  function exportJson() {
    return exportBookmarks("json");
  }

  function exportHtml() {
    return exportBookmarks("html");
  }

  async function exportBookmarks(format) {
    const payload = { format, view: state.view, folderId: state.selectedFolderId };
    if (!IS_STANDALONE) {
      await send("openExportPage", payload);
      setStatus("Export opened in a separate tab.");
      return;
    }
    const result = await send("buildExport", payload);
    downloadText(result.filename, result.content, result.type);
  }

  function downloadText(filename, content, type) {
    if (!IS_STANDALONE) throw new Error("Downloads require an extension-owned page.");
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    root.append(link);
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
    if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey && state.detailDrawer) {
      const controls = [...els.detail.querySelectorAll("button, textarea, input, select, a[href], [tabindex]")]
        .filter((node) => node.tabIndex >= 0 && !node.disabled && node.getClientRects().length);
      const index = controls.indexOf((shadow || document).activeElement);
      if (controls.length && (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === controls.length - 1)) {
        event.preventDefault();
        event.stopPropagation();
        controls[event.shiftKey ? controls.length - 1 : 0].focus();
      }
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (!els.menu.classList.contains("ba-hidden")) hideMenu();
    else if (state.detailBookmark) closeDetails().catch(showError);
    else closeOverlay().catch(showError);
  }

  async function closeOverlay() {
    await flushNotes();
    if (state.navigationWrite) await state.navigationWrite.catch(() => persistNavigation());
    if (IS_STANDALONE) {
      window.close();
      setStatus("Close this tab to leave the manager.");
      return;
    }

    disposeOverlay();
  }

  function disposeOverlay() {
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("focusin", containDrawerFocus, true);
    state.detailResizeObserver.disconnect();
    chrome.storage.onChanged.removeListener(onStorageChanged);
    window.removeEventListener("pagehide", onPageHide);
    clearTimeout(state.noteTimer);
    clearTimeout(state.refreshTimer);
    host.remove();
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

  function folderDisplayName(folder, isRoot = false) {
    if (folder.id === state.data.managedRoot.id) return "Library";
    if (folder.id === state.data.root.id) return "All Bookmarks";
    return folder.title || "Untitled";
  }

  function findFlatBookmark(id) {
    return state.data.bookmarks.find((bookmark) => bookmark.id === id);
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
