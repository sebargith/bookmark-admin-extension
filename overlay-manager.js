(function bookmarkAdminOverlay() {
  const ROOT_ID = "bookmark-admin-overlay";
  const previousFocus = document.activeElement;
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
    index: assetUrl("icons/filter-tag.svg"),
    open: assetUrl("icons/open-manager.svg"),
    undo: assetUrl("icons/undo.svg")
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
    domainFilter: "",
    duplicatesOnly: false,
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
    refreshTimer: null,
    action: null,
    actionBusy: false,
    selectedBookmarks: new Set(),
    selectionAnchor: null,
    renamePreviewTimer: null,
    menuAnchor: null
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
    <section class="ba-window" role="dialog" aria-modal="true" aria-label="Bookmark Admin">
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
        <input class="ba-input ba-search" type="search" aria-label="Search Library" aria-describedby="ba-search-scope" placeholder="Search Library">
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
        <select class="ba-select ba-domain-filter" aria-label="Domain"><option value="">All domains</option></select>
        <label class="ba-duplicates-control"><input class="ba-duplicates-filter" type="checkbox">Duplicates only</label>
        <button class="ba-button ba-blue ba-check" type="button"><img src="${ICONS.check}" alt=""><span>Check</span></button>
        <button class="ba-button ba-blue ba-index" type="button"><img src="${ICONS.index}" alt=""><span>Index</span></button>
        <button class="ba-button ba-export" type="button"><img src="${ICONS.export}" alt=""><span>Export</span></button>
        <div class="ba-filter-summary">
          <span class="ba-search-scope" id="ba-search-scope" role="status"></span>
          <div class="ba-active-filters" role="group" aria-label="Active filters" hidden></div>
        </div>
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
            <input class="ba-select-all" type="checkbox" aria-label="Select all visible bookmarks" title="Select all visible bookmarks">
          </div>
          <nav class="ba-breadcrumbs" aria-label="Folder path"></nav>
          <section class="ba-selection-bar" role="toolbar" aria-label="Selected bookmarks" hidden>
            <span class="ba-selection-count" role="status" aria-live="polite"></span>
            <button class="ba-button" data-bulk-action="move" type="button"><img src="${ICONS.folderOpen}" alt=""><span>Move</span></button>
            <button class="ba-button" data-bulk-action="rename" type="button">Rename</button>
            <button class="ba-button ba-danger" data-bulk-action="delete" type="button">Delete</button>
            <button class="ba-icon-btn ba-selection-more" data-selection-control="more" type="button" title="More selected actions" aria-label="More selected actions">...</button>
            <button class="ba-icon-btn ba-selection-clear" data-selection-control="clear" type="button" title="Clear selection" aria-label="Clear selection">x</button>
          </section>
          <section class="ba-capture-bar" aria-label="Saved window" hidden></section>
          <div class="ba-bookmark-list"></div>
        </section>
        <button class="ba-detail-scrim" type="button" aria-label="Dismiss details" tabindex="-1"></button>
        <aside class="ba-panel ba-detail" aria-label="Bookmark details" hidden></aside>
      </section>
      <footer class="ba-footer">
        <span class="ba-status" role="status" aria-live="polite">Ready.</span>
        <span class="ba-footer-hint">Right-click folders or bookmarks for actions.</span>
        <button class="ba-button ba-undo" type="button" hidden><img src="${ICONS.undo}" alt=""><span>Undo</span></button>
      </footer>
      <div class="ba-action-layer" hidden></div>
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
    captureBar: root.querySelector(".ba-capture-bar"),
    selectAll: root.querySelector(".ba-select-all"),
    selectionBar: root.querySelector(".ba-selection-bar"),
    selectionCount: root.querySelector(".ba-selection-count"),
    selectionClear: root.querySelector(".ba-selection-clear"),
    actionLayer: root.querySelector(".ba-action-layer"),
    undo: root.querySelector(".ba-undo"),
    search: root.querySelector(".ba-search"),
    dateFilter: root.querySelector(".ba-date-filter"),
    sort: root.querySelector(".ba-sort"),
    issueFilter: root.querySelector(".ba-issue-filter"),
    domainFilter: root.querySelector(".ba-domain-filter"),
    duplicatesFilter: root.querySelector(".ba-duplicates-filter"),
    searchScope: root.querySelector(".ba-search-scope"),
    activeFilters: root.querySelector(".ba-active-filters"),
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
  load().then(() => els.search.focus({ preventScroll: true })).catch(showError);

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
    els.selectAll.addEventListener("change", () => {
      if (els.selectAll.checked) selectAllVisible();
      else clearBookmarkSelection();
    });
    els.selectionClear.addEventListener("click", () => clearBookmarkSelection(true));
    els.menu.setAttribute("role", "group");
    els.menu.setAttribute("aria-label", "Actions");
    els.menu.addEventListener("keydown", (event) => {
      const controls = [...els.menu.querySelectorAll("button:not(:disabled)")];
      const index = controls.indexOf((shadow || document).activeElement);
      let next;
      if (event.key === "ArrowDown") next = (index + 1) % controls.length;
      if (event.key === "ArrowUp") next = (index + controls.length - 1) % controls.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = controls.length - 1;
      if (next !== undefined && controls.length) {
        event.preventDefault();
        event.stopPropagation();
        controls[next].focus();
      } else if (event.key === "Tab") hideMenu(true);
    });
    for (const button of els.selectionBar.querySelectorAll("[data-bulk-action]")) {
      button.addEventListener("click", () => openBulkAction(button.dataset.bulkAction).catch(showError));
    }
    root.querySelector(".ba-selection-more").addEventListener("click", (event) => {
      event.stopPropagation();
      showMenu(event, [
        { label: "Check selected links", action: () => checkIds([...state.selectedBookmarks]) },
        { label: "Index selected pages", action: () => refreshIndex([...state.selectedBookmarks]) }
      ]);
    });
    els.undo.addEventListener("click", async () => {
      if (els.undo.disabled) return;
      els.undo.disabled = true;
      try {
        await flushNotes();
        const result = await send("undoLast");
        await load(`Undone: ${result.undone}`);
        (els.selectAll.disabled ? els.search : els.selectAll).focus();
      }
      catch (error) { showError(error); }
      finally { els.undo.disabled = false; }
    });
    els.backdrop.addEventListener("pointerdown", () => {
      if (!IS_STANDALONE) closeOverlay().catch(showError);
    });
    els.close.addEventListener("click", () => closeOverlay().catch(showError));
    els.win.addEventListener("pointerdown", (event) => event.stopPropagation());
    els.search.addEventListener("input", () => {
      state.search = els.search.value.trim().toLowerCase();
      renderBookmarks();
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
    els.domainFilter.addEventListener("change", () => {
      state.domainFilter = els.domainFilter.value;
      renderBookmarks();
    });
    els.duplicatesFilter.addEventListener("change", () => {
      state.duplicatesOnly = els.duplicatesFilter.checked;
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
    const navigationFocus = captureNavigationFocus();
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
    render(navigationFocus);
    if (revealLocation) els.tree.querySelector(".ba-selected")?.scrollIntoView({ block: "nearest" });
    if (status) setStatus(status);
    else if (urlChanged) setStatus("Bookmark URL changed. Details refreshed.");
  }

  function render(navigationFocus = captureNavigationFocus()) {
    if (!state.data) return;
    renderNavigation();
    renderTree();
    renderBreadcrumbs();
    renderCaptureBar();
    renderBookmarks();
    renderDetail();
    restoreNavigationFocus(navigationFocus);
  }

  function captureNavigationFocus() {
    const active = shadow?.activeElement || document.activeElement;
    if (active === els.selectAll || active === els.undo) return { kind: "list-control" };
    const bookmarkRow = active?.closest(".ba-bookmark-row");
    if (bookmarkRow) return { kind: "bookmark", id: bookmarkRow.dataset.bookmarkId,
      control: active.matches(".ba-select-bookmark") ? ".ba-select-bookmark" : active.matches(".ba-icon-btn") ? ".ba-icon-btn" : ".ba-bookmark-title" };
    if (els.selectionBar.contains(active)) return { kind: "selection", action: active.dataset.bulkAction || active.dataset.selectionControl,
      id: state.selectionAnchor || [...state.selectedBookmarks][0] };
    if (els.captureBar.contains(active) && active.dataset.captureAction) {
      return { kind: "capture", id: state.selectedFolderId, action: active.dataset.captureAction };
    }
    const breadcrumb = active?.closest(".ba-breadcrumbs button");
    const folder = active?.closest(".ba-folder-line");
    if (!breadcrumb && !folder) return null;
    const id = breadcrumb ? breadcrumb.dataset.locationId || null : folder.dataset.folderId;
    return {
      kind: breadcrumb ? "breadcrumb" : "tree",
      candidates: [...folderTrail(id).map((node) => node.id).reverse(), null],
      control: active.matches(".ba-disclosure") ? ".ba-disclosure" :
        (active.matches(".ba-name") ? ".ba-name" : ".ba-icon-btn")
    };
  }

  function restoreNavigationFocus(memory) {
    if (!memory) return;
    if (memory.kind === "list-control") { (els.selectAll.disabled ? els.search : els.selectAll).focus({ preventScroll: true }); return; }
    if (memory.kind === "bookmark" || memory.kind === "selection") {
      const button = memory.kind === "selection" && memory.action && !els.selectionBar.hidden &&
        els.selectionBar.querySelector(`[data-bulk-action="${memory.action}"], [data-selection-control="${memory.action}"]`);
      const row = memory.id && els.bookmarkList.querySelector(`[data-bookmark-id="${CSS.escape(memory.id)}"]`);
      const target = button && !button.disabled ? button : row?.querySelector(memory.control || ".ba-select-bookmark") || els.selectAll;
      (target.disabled ? els.search : target).focus({ preventScroll: true });
      return;
    }
    if (memory.kind === "capture") {
      const action = state.selectedFolderId === memory.id && els.captureBar.querySelector(`[data-capture-action="${memory.action}"]`);
      const row = els.tree.querySelector(`[data-folder-id="${CSS.escape(memory.id)}"] .ba-name`);
      (action && !action.disabled ? action : row || els.overview).focus({ preventScroll: true });
      return;
    }
    for (const id of memory.candidates) {
      const selector = memory.kind === "breadcrumb" ?
        `[data-location-id="${CSS.escape(id || "")}"]` :
        `[data-folder-id="${CSS.escape(id || "")}"] ${memory.control}`;
      const target = (memory.kind === "breadcrumb" ? els.breadcrumbs : els.tree).querySelector(selector);
      if (target && !target.disabled) { target.focus({ preventScroll: true }); return; }
    }
    els.overview.focus({ preventScroll: true });
  }

  async function selectView(view) {
    if (!state.data || !VIEW_LABELS[view]) return;
    await flushNotes();
    resetBookmarkSelection();
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

  function captureById(id) {
    return state.data.savedWindows.find((capture) => capture.folderId === id);
  }

  function captureForBookmark(bookmark) {
    return [bookmark.folderId, ...bookmark.folderAncestors.slice().reverse()].map(captureById).find(Boolean);
  }

  function captureDate(capture, compact = false) {
    const value = capture.capturedAt || capture.dateAdded;
    if (!value) return "Date unavailable";
    const date = compact ? formatDate(value) : new Date(value).toLocaleString();
    return `${capture.capturedAt ? "Captured" : "Folder created"} ${date}`;
  }

  function renderCaptureBar() {
    const capture = captureById(state.selectedFolderId);
    els.captureBar.hidden = !capture;
    els.captureBar.textContent = "";
    els.undo.hidden = !state.data.lastUndo;
    els.undo.title = state.data.lastUndo?.label || "Undo last action";
    els.undo.querySelector("span").textContent = state.data.lastUndo ? `Undo: ${state.data.lastUndo.label || "last action"}` : "Undo";
    if (!capture) return;
    const summary = document.createElement("span");
    summary.className = "ba-capture-summary";
    summary.textContent = `${capture.tabCount} ${capture.tabCount === 1 ? "tab" : "tabs"} | ${captureDate(capture)}`;
    summary.title = capture.originalTabCount === null ? "Original capture date and count are unknown" : `${capture.originalTabCount} tabs originally saved`;
    const open = document.createElement("button");
    open.type = "button";
    open.dataset.captureAction = "open";
    open.className = "ba-button ba-blue";
    open.innerHTML = `<img src="${ICONS.open}" alt=""><span>Open window</span>`;
    open.addEventListener("click", () => openCaptureAction("open", capture).catch(showError));
    const move = document.createElement("button");
    move.type = "button";
    move.dataset.captureAction = "move";
    move.className = "ba-button";
    move.innerHTML = `<img src="${ICONS.folderOpen}" alt=""><span>Move to Library</span>`;
    move.disabled = !capture.tabCount || state.data.readOnlyNodeIds.includes(capture.folderId);
    move.addEventListener("click", () => openCaptureAction("move", capture).catch(showError));
    els.captureBar.append(summary, open, move);
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
      button.dataset.locationId = part.id || "";
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
    const label = document.createElement("div");
    label.className = "ba-folder-label";
    label.append(name);
    const capture = captureById(folder.id);
    if (capture) {
      row.classList.add("ba-capture-folder");
      const meta = document.createElement("span");
      meta.className = "ba-folder-meta";
      meta.textContent = `${capture.tabCount} ${capture.tabCount === 1 ? "tab" : "tabs"} | ${captureDate(capture, true)}`;
      meta.title = captureDate(capture);
      label.append(meta);
    }

    const count = document.createElement("span");
    count.className = "ba-count";
    count.textContent = countBookmarks(folder);

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "ba-icon-btn";
    menu.textContent = "...";
    menu.addEventListener("click", (event) => showFolderMenu(event, folder, isRoot));

    menu.setAttribute("aria-label", `Options for ${folder.title}`);
    row.append(disclosure, folderIcon, label, count, menu);
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
    resetBookmarkSelection();
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
    const focusMemory = captureNavigationFocus();
    renderFilterControls();
    const folder = folderById(state.selectedFolderId);
    const bookmarks = visibleBookmarks();
    const visibleIds = new Set(bookmarks.map((bookmark) => bookmark.id));
    state.selectedBookmarks = new Set([...state.selectedBookmarks].filter((id) => visibleIds.has(id)));
    if (!visibleIds.has(state.selectionAnchor)) state.selectionAnchor = null;
    renderSelectionBar(bookmarks);
    els.listTitle.textContent = folder ? folderDisplayName(folder) : VIEW_LABELS[state.view];
    els.listCount.textContent = `${bookmarks.length} shown`;
    els.bookmarkList.textContent = "";
    els.check.disabled = !bookmarks.length;
    els.index.disabled = !bookmarks.length;

    if (!bookmarks.length) {
      const filtered = state.search || state.dateFilter !== "all" || state.issueFilter !== "all" || state.domainFilter || state.duplicatesOnly;
      const copy = filtered ? "No bookmarks match these filters." :
        (state.view === "windows" && !scopeRoots().length ? "No saved windows yet." : "No bookmarks here yet.");
      const image = filtered ? ILLUSTRATIONS.noSearchResults : ILLUSTRATIONS.emptyLibrary;
      els.bookmarkList.append(renderEmptyState(copy, image));
      if (["bookmark", "selection", "list-control"].includes(focusMemory?.kind)) restoreNavigationFocus(focusMemory);
      return;
    }

    for (const bookmark of bookmarks) {
      els.bookmarkList.append(renderBookmarkRow(bookmark));
    }
    if (["bookmark", "selection", "list-control"].includes(focusMemory?.kind)) restoreNavigationFocus(focusMemory);
  }

  function resetBookmarkSelection() {
    state.selectedBookmarks.clear();
    state.selectionAnchor = null;
  }

  function clearBookmarkSelection(focus = false) {
    const id = state.selectionAnchor || [...state.selectedBookmarks][0];
    resetBookmarkSelection();
    renderBookmarks();
    if (focus) (id && els.bookmarkList.querySelector(`[data-bookmark-id="${CSS.escape(id)}"] .ba-select-bookmark`) || els.selectAll).focus();
  }

  function selectAllVisible() {
    const bookmarks = visibleBookmarks();
    state.selectedBookmarks = new Set(bookmarks.map((bookmark) => bookmark.id));
    state.selectionAnchor ||= bookmarks[0]?.id || null;
    renderBookmarks();
  }

  function selectBookmark(id, event = {}) {
    const ids = visibleBookmarkIds();
    const end = ids.indexOf(id);
    if (end < 0) return;
    const start = ids.indexOf(state.selectionAnchor);
    if (event.shiftKey && start >= 0) {
      if (!event.ctrlKey && !event.metaKey) state.selectedBookmarks.clear();
      for (const item of ids.slice(Math.min(start, end), Math.max(start, end) + 1)) state.selectedBookmarks.add(item);
    } else {
      if (state.selectedBookmarks.has(id)) state.selectedBookmarks.delete(id);
      else state.selectedBookmarks.add(id);
      state.selectionAnchor = id;
    }
    renderBookmarks();
  }

  function renderSelectionBar(bookmarks) {
    const count = state.selectedBookmarks.size;
    const readOnly = [...state.selectedBookmarks].filter((id) => state.data.readOnlyNodeIds.includes(id)).length;
    els.listPanel.classList.toggle("ba-selecting", count > 0);
    els.selectionBar.hidden = !count;
    els.selectAll.disabled = !bookmarks.length;
    els.selectAll.checked = Boolean(bookmarks.length && count === bookmarks.length);
    els.selectAll.indeterminate = count > 0 && count < bookmarks.length;
    els.selectionCount.textContent = `${count} selected${readOnly ? ` (${readOnly} read-only)` : ""}`;
    for (const button of els.selectionBar.querySelectorAll("[data-bulk-action]")) {
      button.disabled = Boolean(readOnly || count > 1000);
      button.title = readOnly ? "Selection includes read-only bookmarks" : count > 1000 ? "Select at most 1000 bookmarks" : "";
    }
    els.captureBar.hidden = Boolean(count) || !captureById(state.selectedFolderId);
  }

  function renderBookmarkRow(bookmark) {
    const row = document.createElement("article");
    row.className = "ba-bookmark-row";
    row.dataset.bookmarkId = bookmark.id;
    row.classList.toggle("ba-row-selected", state.selectedBookmarks.has(bookmark.id));
    row.draggable = true;
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showBookmarkMenu(event, bookmark);
    });
    row.addEventListener("dragstart", (event) => {
      if (state.selectedBookmarks.size) { event.preventDefault(); return; }
      event.dataTransfer.setData("application/x-bookmark-node", bookmark.id);
      event.dataTransfer.effectAllowed = "move";
    });

    const bookmarkIcon = document.createElement("img");
    bookmarkIcon.className = "ba-node-icon";
    bookmarkIcon.alt = "";
    bookmarkIcon.src = ICONS.bookmark;
    const selection = document.createElement("span");
    selection.className = "ba-bookmark-select";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "ba-select-bookmark";
    checkbox.checked = state.selectedBookmarks.has(bookmark.id);
    checkbox.setAttribute("aria-label", `Select ${bookmarkTitle(bookmark)}`);
    checkbox.addEventListener("click", (event) => { event.preventDefault(); selectBookmark(bookmark.id, event); });
    checkbox.addEventListener("keydown", (event) => {
      if (event.key === " " && event.shiftKey) { event.preventDefault(); selectBookmark(bookmark.id, event); }
    });
    selection.append(bookmarkIcon, checkbox);

    const meta = document.createElement("div");
    meta.className = "ba-bookmark-meta";
    const title = document.createElement("button");
    title.type = "button";
    title.className = "ba-bookmark-title";
    title.textContent = bookmarkTitle(bookmark);
    title.title = `${bookmarkTitle(bookmark)}\n${bookmark.url}`;
    title.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || state.selectedBookmarks.size) selectBookmark(bookmark.id, event);
      else openBookmark(bookmark.id).catch(showError);
    });
    row.addEventListener("click", (event) => {
      if (!event.target.closest("button,input")) selectBookmark(bookmark.id, event);
    });

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
    row.append(selection, meta, renderLinkIndicator(bookmark), date, menu);
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
    const icon = document.createElement("span");
    icon.className = "ba-status-symbol";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = status.state === "dead" ? "\u00d7" : "!";
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
    if (state.action && !els.actionLayer.hidden) {
      if (!els.actionLayer.contains((shadow || document).activeElement)) {
        (els.actionLayer.querySelector("button:not(:disabled), input:not(:disabled), select:not(:disabled)") || els.actionLayer.querySelector("form"))?.focus();
      }
      return;
    }
    const active = (shadow || document).activeElement;
    if (!root.isConnected || els.menu.contains(active)) return;
    if (state.detailDrawer) {
      if (!els.detail.contains(active)) els.detail.querySelector(state.detailMode === "notes" ? "textarea" : ".ba-detail-title")?.focus();
    } else if (!els.win.contains(active)) els.search.focus({ preventScroll: true });
  }

  function fullDate(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(date) : "-";
  }

  function currentScopeBookmarks() {
    if (!state.data) return [];
    return scopeBookmarks().filter((bookmark) => !state.selectedFolderId ||
      bookmark.folderId === state.selectedFolderId || bookmark.folderAncestors.includes(state.selectedFolderId));
  }

  function bookmarkHostname(bookmark) {
    try { return new URL(bookmark.url).hostname; }
    catch { return ""; }
  }

  function renderFilterControls() {
    const domains = [...new Set(currentScopeBookmarks().map(bookmarkHostname).filter(Boolean))].sort();
    if (!domains.includes(state.domainFilter)) state.domainFilter = "";
    els.domainFilter.replaceChildren(new Option("All domains", ""), ...domains.map((domain) => new Option(domain, domain)));
    els.domainFilter.value = state.domainFilter;
    els.domainFilter.disabled = !domains.length;
    const trail = folderTrail(state.selectedFolderId).filter((folder) => folderInView(folder.id) &&
      !(state.view === "library" && folder.id === state.data.managedRoot.id));
    const location = [VIEW_LABELS[state.view], ...trail.map((folder) => folder.title || "Untitled")].join(" / ");
    els.searchScope.textContent = `Search scope: ${location} (including subfolders)`;
    const focusedChip = (shadow || document).activeElement?.closest("[data-remove-filter]")?.dataset.removeFilter;
    els.activeFilters.textContent = "";
    const filters = [
      ["search", state.search, `Search: ${els.search.value.trim()}`, els.search, ""],
      ["dateFilter", state.dateFilter !== "all", els.dateFilter.selectedOptions[0].textContent, els.dateFilter, "all"],
      ["issueFilter", state.issueFilter !== "all", els.issueFilter.selectedOptions[0].textContent, els.issueFilter, "all"],
      ["domainFilter", state.domainFilter, `Domain: ${state.domainFilter}`, els.domainFilter, ""],
      ["duplicatesOnly", state.duplicatesOnly, "Duplicates only", els.duplicatesFilter, false]
    ];
    const reset = (filter) => {
      const [key, , , control, value] = filter;
      state[key] = value;
      if (control.type === "checkbox") control.checked = value;
      else control.value = value;
    };
    for (const filter of filters.filter((item) => item[1])) {
      const [key, , label, control] = filter;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ba-filter-chip";
      button.dataset.removeFilter = key;
      button.textContent = `${label} \u00d7`;
      button.title = button.ariaLabel = `Remove ${label}`;
      button.addEventListener("click", () => {
        reset(filter);
        renderBookmarks();
        (control.disabled ? els.search : control).focus();
      });
      els.activeFilters.append(button);
    }
    els.activeFilters.hidden = !els.activeFilters.childElementCount;
    if (!els.activeFilters.hidden) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "ba-filter-clear";
      clear.textContent = "Clear all";
      clear.ariaLabel = "Clear all filters";
      clear.dataset.removeFilter = "all";
      clear.addEventListener("click", () => {
        filters.forEach(reset);
        renderBookmarks();
        els.search.focus();
      });
      els.activeFilters.append(clear);
    }
    if (focusedChip) (els.activeFilters.querySelector(`[data-remove-filter="${focusedChip}"]`) || els.search).focus();
  }

  function visibleBookmarks() {
    let bookmarks = currentScopeBookmarks();
    // Count before applying any filters: a matching copy may be hidden by search/date/status.
    if (state.duplicatesOnly) {
      const counts = new Map();
      for (const bookmark of bookmarks) {
        const key = noteKey(bookmark);
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
      bookmarks = bookmarks.filter((bookmark) => counts.get(noteKey(bookmark)) > 1);
    }
    if (state.domainFilter) bookmarks = bookmarks.filter((bookmark) => bookmarkHostname(bookmark) === state.domainFilter);

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
    const capture = captureById(folder.id);
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
    if (capture) items.unshift(
      { label: "Open as window", action: () => openCaptureAction("open", capture) },
      ...(!readOnly ? [{ label: "Move contents to Library", action: () => openCaptureAction("move", capture) }] : []),
      { separator: true }
    );
    showMenu(event, items);
  }

  function showBookmarkMenu(event, bookmark) {
    event.preventDefault();
    event.stopPropagation();
    const readOnly = state.data.readOnlyNodeIds.includes(bookmark.id);
    const items = [
      { label: "Open", action: () => openBookmark(bookmark.id) },
      { label: "Notes", action: () => openDetails(bookmark, "notes") },
      { label: "Properties", action: () => openDetails(bookmark, "properties") }
    ];
    if (visibleBookmarkIds().includes(bookmark.id)) items.unshift({ label: state.selectedBookmarks.has(bookmark.id) ? "Deselect" : "Select", action: () => selectBookmark(bookmark.id) });
    if (!readOnly) {
      const capture = captureForBookmark(bookmark);
      items.push({ separator: true },
        { label: "Rename", action: () => renameNode(bookmark.id, bookmark.title) },
        { label: "Move", action: () => moveIds([bookmark.id]) },
      );
      if (capture) items.push({ label: "Move to Library", action: () => openCaptureAction("move", capture, bookmark) });
    }
    items.push({ separator: true },
      { label: "Refresh page index", action: () => refreshIndex([bookmark.id]) },
      { label: "Check link", action: () => checkIds([bookmark.id]) });
    if (!readOnly) items.push({ separator: true }, { label: "Delete", danger: true, action: () => deleteIds([bookmark.id]) });
    if (state.selectedBookmarks.has(bookmark.id) && state.selectedBookmarks.size > 1 &&
        ![...state.selectedBookmarks].some((id) => state.data.readOnlyNodeIds.includes(id))) {
      items.unshift(
        { label: `Move selected (${state.selectedBookmarks.size})`, action: () => openBulkAction("move") },
        { label: "Rename selected", action: () => openBulkAction("rename") },
        { label: "Delete selected", danger: true, action: () => openBulkAction("delete") },
        { separator: true }
      );
    }
    showMenu(event, items);
  }

  function bulkPayload(action, form) {
    const select = form.querySelector(".ba-bulk-destination");
    const destination = select?.value;
    return { action: action.type, ids: action.ids, expected: action.expected,
      folderId: destination, destinationPath: select?.destinationPaths?.get(destination),
      mode: form.querySelector(".ba-bulk-mode")?.value, text: form.querySelector(".ba-bulk-text")?.value,
      find: form.querySelector(".ba-bulk-find")?.value };
  }

  async function openBulkAction(type) {
    await flushNotes();
    const ids = visibleBookmarkIds().filter((id) => state.selectedBookmarks.has(id));
    if (!ids.length || ids.length > 1000) throw new Error("Select between 1 and 1000 bookmarks.");
    if (ids.some((id) => state.data.readOnlyNodeIds.includes(id))) throw new Error("The selection contains read-only bookmarks.");
    state.detailBookmark = null;
    renderDetail();
    const bookmarks = ids.map(findFlatBookmark);
    const action = { kind: "bulk", type, ids, expected: bookmarks.map((bookmark) => ({ id: bookmark.id, parentId: bookmark.parentId,
      title: bookmark.title || "", url: bookmark.url, index: bookmark.index })), returnFocus: shadow?.activeElement || document.activeElement, previewSequence: 0 };
    state.action = action;
    els.actionLayer.innerHTML = `<form class="ba-action-dialog" role="dialog" aria-modal="true" aria-labelledby="ba-action-title" tabindex="-1">
      <div class="ba-action-body">
      <h2 id="ba-action-title"></h2><p class="ba-action-copy"></p>
      <label class="ba-bulk-field ba-destination-field" hidden><span>Destination folder</span><select class="ba-select ba-bulk-destination" aria-label="Destination folder"></select></label>
      <div class="ba-bulk-rename-fields" hidden>
        <label class="ba-bulk-field"><span>Rename mode</span><select class="ba-select ba-bulk-mode" aria-label="Rename mode"><option value="prefix">Add prefix</option><option value="suffix">Add suffix</option><option value="replace">Replace text</option></select></label>
        <label class="ba-bulk-field ba-find-field" hidden><span>Find</span><input class="ba-input ba-bulk-find" aria-label="Find text" maxlength="300"></label>
        <label class="ba-bulk-field"><span>Text</span><input class="ba-input ba-bulk-text" aria-label="Rename text" maxlength="300"></label>
      </div>
      <p class="ba-bulk-preview-status" role="status" aria-live="polite"></p><ul class="ba-rename-preview"></ul>
      <p class="ba-action-error" role="alert"></p>
      </div>
      <div class="ba-action-buttons"><button class="ba-button ba-action-cancel" type="button">Cancel</button><button class="ba-button ba-action-submit" type="submit" disabled></button></div>
    </form>`;
    const form = els.actionLayer.querySelector("form");
    form.querySelector("h2").textContent = `${type === "move" ? "Move" : type === "delete" ? "Delete" : "Rename"} selected bookmarks`;
    form.querySelector(".ba-action-copy").textContent = type === "delete" ? `Delete ${ids.length} selected bookmarks? Folders and other bookmarks will remain.` :
      type === "move" ? `Move ${ids.length} selected bookmarks. Names, URLs and notes will be kept.` : `${ids.length} selected bookmarks`;
    const submit = form.querySelector(".ba-action-submit");
    submit.textContent = type === "move" ? "Move" : type === "delete" ? "Delete" : "Rename";
    submit.classList.add(type === "delete" ? "ba-danger" : "ba-blue");
    if (type === "move") {
      form.querySelector(".ba-destination-field").hidden = false;
      const select = form.querySelector(".ba-bulk-destination");
      for (const folder of state.data.folders) {
        if (folder.id === state.data.root.id || state.data.readOnlyNodeIds.includes(folder.id) || bookmarks.every((bookmark) => bookmark.parentId === folder.id)) continue;
        const option = document.createElement("option");
        option.value = folder.id;
        option.textContent = folder.path || folder.title;
        select.append(option);
      }
      if ([...select.options].some((option) => option.value === state.data.defaultFolder.id)) select.value = state.data.defaultFolder.id;
      attachDestinationPicker(select);
    }
    if (type === "rename") form.querySelector(".ba-bulk-rename-fields").hidden = false;
    const refreshPreview = () => {
      clearTimeout(state.renamePreviewTimer);
      action.previewSequence += 1;
      submit.disabled = true;
      form.querySelector(".ba-find-field").hidden = form.querySelector(".ba-bulk-mode").value !== "replace";
      state.renamePreviewTimer = setTimeout(() => previewBulkAction(action, form), type === "rename" ? 180 : 0);
    };
    for (const input of form.querySelectorAll("input,select")) {
      input.addEventListener(input.tagName === "SELECT" ? "change" : "input", refreshPreview);
    }
    bindActionDialog(form, submitBulkAction, form.querySelector(type === "rename" ? ".ba-bulk-text" : type === "move" ? ".ba-bulk-destination" : ".ba-action-cancel"));
    refreshPreview();
  }

  async function previewBulkAction(action, form) {
    const sequence = action.previewSequence;
    try {
      const payload = bulkPayload(action, form);
      const preview = await send("previewBookmarkBatch", payload);
      if (state.action !== action || sequence !== action.previewSequence || state.actionBusy) return;
      form.querySelector(".ba-action-error").textContent = "";
      form.querySelector(".ba-bulk-preview-status").textContent = `${preview.count} will change${preview.unchanged ? `; ${preview.unchanged} unchanged` : ""}`;
      const list = form.querySelector(".ba-rename-preview");
      list.textContent = "";
      if (action.type === "rename") for (const example of preview.examples) {
        const item = document.createElement("li");
        const before = document.createElement("span");
        const after = document.createElement("span");
        before.textContent = example.before;
        after.textContent = example.after;
        item.append(before, after);
        list.append(item);
      }
      action.previewPayload = payload;
      form.querySelector(".ba-action-submit").disabled = !preview.count;
    } catch (error) {
      if (state.action !== action || sequence !== action.previewSequence || state.actionBusy) return;
      form.querySelector(".ba-action-error").textContent = error.message;
      form.querySelector(".ba-bulk-preview-status").textContent = "";
      form.querySelector(".ba-rename-preview").textContent = "";
    }
  }

  async function submitBulkAction(event) {
    event.preventDefault();
    const action = state.action;
    const form = event.currentTarget;
    if (!action || state.actionBusy || form.querySelector(".ba-action-submit").disabled) return;
    state.actionBusy = true;
    const controls = [...form.querySelectorAll("input,select,button")];
    controls.forEach((control) => { control.disabled = true; });
    try {
      const result = await send("applyBookmarkBatch", { ...action.previewPayload, confirmed: true });
      state.actionBusy = false;
      resetBookmarkSelection();
      closeCaptureAction();
      await load(`${result.changed} bookmarks ${action.type === "delete" ? "deleted" : action.type === "move" ? "moved" : "renamed"}.${result.unchanged ? ` ${result.unchanged} unchanged.` : ""}`);
    } catch (error) {
      state.actionBusy = false;
      if (!state.action) { showError(error); return; }
      controls.forEach((control) => { control.disabled = false; });
      form.querySelector(".ba-action-error").textContent = error.message;
      form.querySelector(".ba-action-submit").disabled = true;
      await load(error.message).catch(showError);
      if (state.action === action && form.isConnected) form.querySelector(".ba-action-cancel").focus();
    }
  }

  function bindActionDialog(form, submit, initialFocus) {
    form.querySelector(".ba-action-cancel").addEventListener("click", closeCaptureAction);
    els.actionLayer.onclick = (event) => { if (event.target === els.actionLayer) closeCaptureAction(); };
    form.addEventListener("submit", submit);
    els.actionLayer.hidden = false;
    for (const child of els.win.children) if (child !== els.actionLayer) child.inert = true;
    (initialFocus || form.querySelector(".ba-action-cancel")).focus();
  }

  async function openCaptureAction(type, capture, bookmark = null) {
    await flushNotes();
    const folder = folderById(capture.folderId);
    if (!folder) throw new Error("Saved window not found.");
    state.detailBookmark = null;
    renderDetail();
    state.action = { type, capture, bookmark, returnFocus: shadow?.activeElement || document.activeElement };
    const sourceBookmarks = state.data.bookmarks.filter((item) => item.folderId === folder.id || item.folderAncestors.includes(folder.id));
    const urls = [];
    walk(folder, (item) => {
      try { if (item.url && ["http:", "https:"].includes(new URL(item.url).protocol)) urls.push(item.url); } catch {}
    });
    state.action.expectedUrls = urls;
    state.action.expectedContents = [];
    walk(folder, (item) => { if (item.id !== folder.id) state.action.expectedContents.push([item.id, item.parentId, item.url || null]); });
    state.action.expectedIds = bookmark ? [bookmark.id] : (folder.children || []).map((item) => item.id);
    els.actionLayer.innerHTML = `<form class="ba-action-dialog" role="dialog" aria-modal="true" aria-labelledby="ba-action-title" tabindex="-1">
      <div class="ba-action-body">
      <h2 id="ba-action-title"></h2><p class="ba-action-subject"></p><p class="ba-action-copy"></p>
      <label class="ba-action-field" hidden><span></span><select class="ba-select" aria-label="Destination folder"></select></label>
      <label class="ba-action-name" hidden><span>Name</span><input class="ba-input" aria-label="Capture name" maxlength="300"></label>
      <p class="ba-action-error" role="alert"></p>
      </div>
      <div class="ba-action-buttons"><button class="ba-button ba-action-cancel" type="button">Cancel</button><button class="ba-button ba-blue ba-action-submit" type="submit"></button></div>
    </form>`;
    const form = els.actionLayer.querySelector("form");
    form.querySelector("h2").textContent = type === "open" ? "Open saved window" : type === "rename" ? "Rename saved window" : "Move to Library";
    form.querySelector(".ba-action-subject").textContent = bookmark ? bookmarkTitle(bookmark) : folder.title;
    const submit = form.querySelector(".ba-action-submit");
    submit.textContent = type === "open" ? "Open window" : type === "rename" ? "Rename" : "Move";
    if (type === "open") {
      const skipped = sourceBookmarks.length - urls.length;
      form.querySelector(".ba-action-copy").textContent = `${urls.length} web pages will open in a new window.${skipped ? ` ${skipped} non-web or invalid links will be skipped.` : ""}`;
      if (!urls.length || urls.length > 100) {
        submit.disabled = true;
        form.querySelector(".ba-action-error").textContent = urls.length ? "Open at most 100 pages at once. Split this capture into smaller folders first." : "No http or https pages to open.";
      }
    } else if (type === "move") {
      form.querySelector(".ba-action-copy").textContent = bookmark ? "Move this bookmark. Its notes and native bookmark ID will be kept." : `${capture.tabCount} bookmarks in this capture will move with their folder structure. The capture folder will remain.`;
      const field = form.querySelector(".ba-action-field");
      field.hidden = false;
      field.querySelector("span").textContent = "Destination folder";
      const select = field.querySelector("select");
      const libraryId = state.data.managedRoot.id;
      for (const destination of state.data.folders) {
        if (state.data.readOnlyNodeIds.includes(destination.id)) continue;
        if (destination.id === (bookmark ? bookmark.folderId : folder.id)) continue;
        const trail = folderTrail(destination.id);
        if (!trail.some((item) => item.id === libraryId)) continue;
        if (state.action.expectedIds.some((id) => trail.some((item) => item.id === id))) continue;
        const option = document.createElement("option");
        option.value = destination.id;
        option.textContent = trail.slice(trail.findIndex((item) => item.id === libraryId)).map(folderDisplayName).join(" / ");
        select.append(option);
      }
      select.value = [...select.options].some((option) => option.value === state.data.defaultFolder.id) ? state.data.defaultFolder.id : select.options[0]?.value || "";
      submit.disabled = !select.value || !state.action.expectedIds.length;
      attachDestinationPicker(select);
      select.addEventListener("change", () => { submit.disabled = !select.value || !state.action?.expectedIds.length; });
    } else {
      form.querySelector(".ba-action-name").hidden = false;
      form.querySelector("input").required = true;
      form.querySelector("input").value = folder.title;
    }
    bindActionDialog(form, submitCaptureAction, form.querySelector(type === "rename" ? "input" : type === "move" ? "select" : ".ba-action-cancel"));
  }

  function closeCaptureAction() {
    if (state.actionBusy) return;
    const action = state.action;
    clearTimeout(state.renamePreviewTimer);
    state.action = null;
    els.actionLayer.hidden = true;
    els.actionLayer.textContent = "";
    for (const child of els.win.children) child.inert = false;
    syncDetailFocus();
    if (action?.kind === "bulk" && !state.selectedBookmarks.size) { (els.selectAll.disabled ? els.search : els.selectAll).focus(); return; }
    const row = action?.capture && els.tree.querySelector(`[data-folder-id="${CSS.escape(action.capture.folderId)}"] .ba-name`);
    const bookmark = action?.ids?.[0] && els.bookmarkList.querySelector(`[data-bookmark-id="${CSS.escape(action.ids[0])}"] .ba-select-bookmark`);
    (action?.returnFocus?.isConnected && action.returnFocus.getClientRects().length && !action.returnFocus.disabled ? action.returnFocus : row || bookmark || els.search).focus();
  }

  async function submitCaptureAction(event) {
    event.preventDefault();
    if (state.actionBusy || !state.action) return;
    const action = state.action;
    const form = event.currentTarget;
    const destination = form.querySelector("select").value;
    const title = form.querySelector("input").value.trim();
    if (action.type === "rename" && !title) {
      form.querySelector(".ba-action-error").textContent = "Enter a name.";
      return;
    }
    state.actionBusy = true;
    const controls = [...form.querySelectorAll("button,input,select")];
    controls.forEach((control) => { control.disabled = true; });
    try {
      let status;
      if (action.type === "open") {
        const result = await send("reopenSavedWindow", { folderId: action.capture.folderId, confirmed: true, expectedUrls: action.expectedUrls });
        status = `Opened ${result.opened} pages.${result.skipped ? ` Skipped ${result.skipped}.` : ""}`;
      } else if (action.type === "rename") {
        await send("renameNode", { id: action.capture.folderId, title });
        status = "Saved window renamed.";
      } else {
        const result = await send("moveSavedItemsToLibrary", { captureId: action.capture.folderId, bookmarkId: action.bookmark?.id, folderId: destination, expectedIds: action.expectedIds,
          expectedContents: action.expectedContents });
        status = `Moved ${result.moved} items to Library. Undo is available.`;
      }
      state.actionBusy = false;
      closeCaptureAction();
      await load(status);
    } catch (error) {
      state.actionBusy = false;
      if (!state.action) { showError(error); return; }
      controls.forEach((control) => { control.disabled = false; });
      form.querySelector(".ba-action-error").textContent = error.message;
      if (action.type === "move") await load(error.message).catch(showError);
      if (state.action === action && form.isConnected) form.querySelector(".ba-action-cancel").focus();
    }
  }

  function showMenu(event, items) {
    hideMenu();
    const source = event.currentTarget || event.target;
    const anchor = source?.matches?.("button,input,[tabindex]") ? source : source?.querySelector?.(".ba-icon-btn,button");
    state.menuAnchor = anchor || els.search;
    state.menuAnchor.setAttribute("aria-haspopup", "true");
    state.menuAnchor.setAttribute("aria-expanded", "true");
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
        hideMenu(true);
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
    const keyboard = event.type === "click" && event.detail === 0 || event.type === "contextmenu" && !event.clientX && !event.clientY;
    const origin = state.menuAnchor.getBoundingClientRect();
    const x = keyboard ? origin.left : event.clientX;
    let y = keyboard ? origin.bottom + 4 : event.clientY;
    if (keyboard && y + rect.height > window.innerHeight - 8) y = origin.top - rect.height - 4;
    els.menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    els.menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    if (keyboard) els.menu.querySelector("button:not(:disabled)")?.focus();
  }

  function hideMenu(restoreFocus = false) {
    els.menu.classList.add("ba-hidden");
    state.menuAnchor?.setAttribute("aria-expanded", "false");
    if (restoreFocus && state.menuAnchor?.isConnected && state.menuAnchor.getClientRects().length && !state.menuAnchor.disabled) state.menuAnchor.focus({ preventScroll: true });
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
    if (parentId) await openNodeAction("create", parentId);
  }

  async function renameNode(id, currentTitle) {
    await openNodeAction("rename", id);
  }

  async function moveIds(ids) {
    if (ids.length === 1) await openNodeAction("move", ids[0]);
  }

  async function deleteIds(ids) {
    if (ids.length === 1) await openNodeAction("delete", ids[0]);
  }

  function attachDestinationPicker(select) {
    select.destinationPaths = new Map([...select.options].map((option) => [option.value, folderTrail(option.value).map((folder) => folder.id)]));
    const labels = new Map();
    for (const option of select.options) labels.set(option.textContent, (labels.get(option.textContent) || 0) + 1);
    for (const option of select.options) {
      if (labels.get(option.textContent) > 1) option.textContent += ` [folder ID: ${option.value}]`;
    }
    const options = [...select.options].map((option) => ({ value: option.value, label: option.textContent }));
    let chosen = select.value;
    let filtering = false;
    const search = document.createElement("input");
    search.type = "search";
    search.className = "ba-input ba-destination-search";
    search.ariaLabel = "Find destination folder";
    search.placeholder = "Find folder";
    const path = document.createElement("span");
    path.className = "ba-destination-path";
    path.setAttribute("role", "status");
    select.before(search);
    select.after(path);
    const update = () => {
      select.disabled = !select.options.length;
      path.textContent = select.selectedOptions[0]?.textContent || (select.options.length ? "Choose a destination folder." : "No matching writable folders.");
    };
    search.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      select.replaceChildren(...options.filter((option) => option.label.toLowerCase().includes(query))
        .map((option) => new Option(option.label, option.value)));
      select.value = chosen;
      update();
      filtering = true;
      select.dispatchEvent(new Event("change"));
      filtering = false;
    });
    select.addEventListener("change", () => { if (!filtering && select.value) chosen = select.value; update(); });
    update();
    return search;
  }

  function nativeNode(id) {
    let result;
    walk(state.data.root, (node) => { if (node.id === id) result = node; });
    return result;
  }

  async function openNodeAction(type, id) {
    await flushNotes();
    const node = nativeNode(id);
    if (!node) throw new Error("Bookmark or folder no longer exists.");
    if (state.data.readOnlyNodeIds.includes(id) || type !== "create" && state.data.protectedNodeIds.includes(id)) throw new Error("This item is protected or read-only.");
    state.detailBookmark = null;
    renderDetail();
    const expected = [];
    let bookmarks = 0;
    let folders = 0;
    walk(node, (item) => {
      expected.push({ id: item.id, parentId: item.parentId, title: item.title || "", url: item.url || null, index: item.index });
      if (item.url) bookmarks += 1;
      else if (item.id !== id) folders += 1;
    });
    const action = { kind: "node", type, id, expected, returnFocus: (shadow || document).activeElement };
    state.action = action;
    els.actionLayer.innerHTML = `<form class="ba-action-dialog" role="dialog" aria-modal="true" aria-labelledby="ba-action-title" tabindex="-1">
      <div class="ba-action-body">
      <h2 id="ba-action-title"></h2><p class="ba-action-subject"></p><p class="ba-action-copy"></p>
      <label class="ba-action-name" hidden><span>Name</span><input class="ba-input" aria-label="Name" maxlength="300"></label>
      <label class="ba-action-field" hidden><span>Destination folder</span><select class="ba-select" aria-label="Destination folder"></select></label>
      <p class="ba-action-error" role="alert"></p>
      </div>
      <div class="ba-action-buttons"><button class="ba-button ba-action-cancel" type="button">Cancel</button><button class="ba-button ba-action-submit" type="submit"></button></div>
    </form>`;
    const form = els.actionLayer.querySelector("form");
    const verb = { create: "Create", rename: "Rename", move: "Move", delete: "Delete" }[type];
    form.querySelector("h2").textContent = type === "create" ? "New folder" : `${verb} ${node.url ? "bookmark" : "folder"}`;
    form.querySelector(".ba-action-subject").textContent = node.title || "Untitled";
    form.querySelector(".ba-action-copy").textContent = type === "delete" ?
      (node.url ? "Delete this bookmark?" : `Delete this folder, ${folders} subfolders and ${bookmarks} bookmarks?`) + " Undo restores the deleted items. A later action replaces the single undo entry." :
      type === "create" ? `Parent: ${folderTrail(id).map(folderDisplayName).join(" / ")}` :
      type === "move" ? "Names, URLs, notes and folder structure will be kept." : "The bookmark location and saved notes will be kept.";
    const submit = form.querySelector(".ba-action-submit");
    submit.textContent = verb;
    submit.classList.add(type === "delete" ? "ba-danger" : "ba-blue");
    let initialFocus = form.querySelector(".ba-action-cancel");
    if (type === "rename" || type === "create") {
      form.querySelector(".ba-action-name").hidden = false;
      const input = form.querySelector("input");
      input.required = true;
      input.value = type === "rename" ? node.title || "" : "";
      initialFocus = input;
    }
    if (type === "move") {
      form.querySelector(".ba-action-field").hidden = false;
      const select = form.querySelector("select");
      for (const folder of state.data.folders) {
        if (folder.id === state.data.root.id || folder.id === node.parentId || state.data.readOnlyNodeIds.includes(folder.id) || folderTrail(folder.id).some((item) => item.id === id)) continue;
        select.append(new Option(folder.path || folder.title || "Untitled", folder.id));
      }
      if ([...select.options].some((option) => option.value === state.data.defaultFolder.id)) select.value = state.data.defaultFolder.id;
      initialFocus = attachDestinationPicker(select);
      select.addEventListener("change", () => { submit.disabled = !select.value; });
      submit.disabled = !select.value;
    }
    bindActionDialog(form, submitNodeAction, initialFocus);
    if (initialFocus.tagName === "INPUT" && initialFocus.type !== "search") initialFocus.select();
  }

  async function submitNodeAction(event) {
    event.preventDefault();
    const action = state.action;
    const form = event.currentTarget;
    if (!action || state.actionBusy || form.querySelector(".ba-action-submit").disabled) return;
    const title = form.querySelector(".ba-action-name input").value.trim();
    const folderId = form.querySelector("select").value;
    if (["create", "rename"].includes(action.type) && !title) return;
    state.actionBusy = true;
    const controls = [...form.querySelectorAll("button,input,select")];
    controls.forEach((control) => { control.disabled = true; });
    try {
      const result = action.type === "create" ? await send("createFolder", { parentId: action.id, title }) :
        await send("applyNodeAction", { action: action.type, id: action.id, title, folderId, expected: action.expected,
          destinationPath: form.querySelector("select").destinationPaths?.get(folderId), confirmed: true });
      if (action.type === "create") {
        state.selectedFolderId = result.folder.id;
        state.selectedByView[state.view] = result.folder.id;
        state.expanded.add(result.folder.parentId);
      }
      state.actionBusy = false;
      closeCaptureAction();
      await load(action.type === "create" ? result.existed ? "Folder already exists." : "Folder created." :
        action.type === "delete" ? "Deleted. Undo is available." : action.type === "move" ? "Moved. Undo is available." : "Renamed. Undo is available.");
      if (action.type === "create") persistNavigation();
    } catch (error) {
      state.actionBusy = false;
      if (state.action !== action) return;
      controls.forEach((control) => { control.disabled = false; });
      form.querySelector(".ba-action-error").textContent = error.message;
      form.querySelector(".ba-action-submit").disabled = true;
      await load(error.message).catch(showError);
      if (form.isConnected) form.querySelector(".ba-action-cancel").focus();
    }
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
    const active = (shadow || document).activeElement;
    const inBookmarkList = els.bookmarkList.contains(active) || els.selectionBar.contains(active) || active === els.selectAll;
    if (!state.action && !state.detailDrawer && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "a" &&
        inBookmarkList) {
      event.preventDefault();
      event.stopPropagation();
      selectAllVisible();
      return;
    }
    if (!state.action && !state.detailDrawer && inBookmarkList && state.selectedBookmarks.size &&
        !event.ctrlKey && !event.metaKey && !event.altKey && ["Delete", "F2"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (state.selectedBookmarks.size > 1000 || [...state.selectedBookmarks].some((id) => state.data.readOnlyNodeIds.includes(id))) {
        setStatus("Selection contains read-only bookmarks or exceeds 1000 items.");
      } else openBulkAction(event.key === "Delete" ? "delete" : "rename").catch(showError);
      return;
    }
    if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey &&
        (state.action || state.detailDrawer || els.menu.classList.contains("ba-hidden"))) {
      const surface = state.action ? els.actionLayer : state.detailDrawer ? els.detail : els.win;
      const controls = [...surface.querySelectorAll("button, textarea, input, select, a[href], [tabindex]")]
        .filter((node) => node.tabIndex >= 0 && !node.disabled && node.getClientRects().length);
      const index = controls.indexOf((shadow || document).activeElement);
      if (!controls.length || index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === controls.length - 1) {
        event.preventDefault();
        event.stopPropagation();
        (controls[event.shiftKey ? controls.length - 1 : 0] || surface.querySelector("form"))?.focus();
      }
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (state.action) closeCaptureAction();
    else if (!els.menu.classList.contains("ba-hidden")) hideMenu(true);
    else if (state.detailBookmark) closeDetails().catch(showError);
    else if (state.selectedBookmarks.size) clearBookmarkSelection(true);
    else closeOverlay().catch(showError);
  }

  async function closeOverlay() {
    if (state.action) { closeCaptureAction(); return; }
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
    clearTimeout(state.renamePreviewTimer);
    host.remove();
    if (previousFocus?.isConnected && typeof previousFocus.focus === "function") previousFocus.focus({ preventScroll: true });
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
