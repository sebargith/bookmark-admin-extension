const els = {};
let appState = null;
let currentTab = null;
let savedBookmark = null;
let moving = false;
let readOnly = false;
let creating = false;
let folderKeyboardNavigation = false;

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheElements();
  bindEvents();
  refresh().catch(showError);
}

function cacheElements() {
  for (const id of [
    "currentPageMini",
    "saveFolder",
    "saveFeedback",
    "folderForm",
    "folderName",
    "cancelFolder",
    "createFolderMini",
    "saveAllWindows",
    "windowSaveStatus",
    "openManager",
    "destinationSummary", "chooseFolder", "savedPath", "folderPicker", "closePicker",
    "folderSearch", "recentFolders", "recentFolderList", "selectedPath", "folderEmpty", "defaultActions"
  ]) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.saveFolder.addEventListener("change", () => {
    if (folderKeyboardNavigation) {
      els.selectedPath.textContent = `Destination: ${els.saveFolder.selectedOptions[0]?.textContent || ""}`;
    } else moveSavedBookmark().catch(showError);
  });
  els.saveFolder.addEventListener("pointerdown", () => { folderKeyboardNavigation = false; });
  els.saveFolder.addEventListener("click", (event) => {
    if (event.target.tagName === "OPTION" && !els.folderPicker.hidden) moveSavedBookmark().catch(showError);
  });
  // Native listboxes change value while browsing; keyboard choices commit on Enter.
  els.saveFolder.addEventListener("keydown", (event) => {
    if (!["Enter", "Escape", "Tab", "Shift", "Control", "Alt", "Meta"].includes(event.key)) folderKeyboardNavigation = true;
    if (event.key === "Enter") { event.preventDefault(); moveSavedBookmark().catch(showError); }
  });
  els.chooseFolder.addEventListener("click", () => setPickerOpen(true));
  els.closePicker.addEventListener("click", () => setPickerOpen(false));
  els.folderSearch.addEventListener("input", renderFolders);
  els.folderSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || moving || creating || !els.saveFolder.options.length) return;
    event.preventDefault();
    if (els.saveFolder.options.length === 1) {
      els.saveFolder.value = els.saveFolder.options[0].value;
      moveSavedBookmark().catch(showError);
    } else els.saveFolder.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || moving || creating) return;
    if (!els.folderForm.hidden) { event.preventDefault(); els.folderForm.hidden = true; els.createFolderMini.focus(); }
    else if (!els.folderPicker.hidden) { event.preventDefault(); setPickerOpen(false); }
  });
  els.createFolderMini.addEventListener("click", () => { els.folderForm.hidden = false; els.folderName.focus(); });
  els.cancelFolder.addEventListener("click", () => { els.folderForm.hidden = true; els.createFolderMini.focus(); });
  els.folderForm.addEventListener("submit", (event) => { event.preventDefault(); createFolder().catch(showError); });
  els.saveAllWindows.addEventListener("click", saveWindowTabs);
  els.openManager.addEventListener("click", () => openManagerOverlay().catch(showError));
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

async function refresh() {
  const result = await send("beginPopupSave");
  currentTab = result.tab;
  savedBookmark = result.bookmark;
  readOnly = Boolean(result.readOnly);
  els.currentPageMini.textContent = currentTab.title || currentTab.url;
  els.saveFeedback.textContent = savedBookmark ? (result.existing ? "Already bookmarked" : "Bookmark saved") : "";
  appState = await send("getManagerState");
  els.currentPageMini.textContent = currentTab.title || currentTab.url;
  els.currentPageMini.title = currentTab.url;
  renderFolders();
  updateSaveAvailability();
  if (savedBookmark) {
    els.saveFeedback.textContent = result.existing ? "Already bookmarked" : "Bookmark saved";
    els.saveFolder.disabled = readOnly;
    els.createFolderMini.disabled = readOnly;
    els.chooseFolder.disabled = readOnly;
    if (readOnly) els.saveFeedback.textContent = "Managed bookmark - read-only";
  }
}

function renderFolders() {
  const selected = savedBookmark?.parentId;
  const query = els.folderSearch.value.trim().toLocaleLowerCase();
  const available = appState.folders.filter((folder) => folder.id !== appState.root.id &&
    (!appState.readOnlyNodeIds.includes(folder.id) || folder.id === selected));
  const selectedFolder = available.find((folder) => folder.id === selected);
  const labelCounts = new Map();
  for (const folder of available) {
    const label = folder.path || folder.title;
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  }
  const folderLabel = (folder) => {
    const label = folder.path || folder.title;
    return `${label}${labelCounts.get(label) > 1 ? ` (#${folder.id})` : ""}`;
  };
  const path = selectedFolder ? folderLabel(selectedFolder) : "Folder unavailable";
  els.savedPath.textContent = path;
  els.chooseFolder.title = path;
  els.selectedPath.textContent = `Saved in: ${path}`;
  els.saveFolder.textContent = "";
  for (const folder of available) {
    if (!(folder.path || folder.title).toLocaleLowerCase().includes(query)) continue;
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folderLabel(folder);
    option.title = option.textContent;
    els.saveFolder.append(option);
  }
  const hasSelectedFolder = Array.from(els.saveFolder.options).some((option) => option.value === selected);
  els.saveFolder.value = hasSelectedFolder ? selected : "";
  els.folderEmpty.hidden = els.saveFolder.options.length > 0;
  els.recentFolderList.textContent = "";
  const recent = (appState.popupRecentFolderIds || []).map((id) => available.find((folder) => folder.id === id))
    .filter((folder) => folder && !appState.readOnlyNodeIds.includes(folder.id) &&
      (folder.path || folder.title).toLocaleLowerCase().includes(query)).slice(0, 2);
  els.recentFolders.hidden = !recent.length;
  for (const folder of recent) {
    const button = document.createElement("button");
    button.type = "button";
    const sameTitle = available.some((other) => other.id !== folder.id && other.title === folder.title);
    button.textContent = `${sameTitle ? `(#${folder.id}) ` : ""}${folder.title}`;
    button.title = folderLabel(folder);
    button.disabled = moving || creating;
    button.addEventListener("click", () => { els.saveFolder.value = folder.id; moveSavedBookmark().catch(showError); });
    els.recentFolderList.append(button);
  }
}

function setPickerOpen(open) {
  folderKeyboardNavigation = false;
  els.folderPicker.hidden = !open;
  els.destinationSummary.hidden = open;
  els.defaultActions.hidden = open;
  els.chooseFolder.setAttribute("aria-expanded", String(open));
  els.folderForm.hidden = true;
  if (open) { els.folderSearch.value = ""; renderFolders(); els.folderSearch.focus(); }
  else els.chooseFolder.focus();
}

async function moveSavedBookmark() {
  if (!savedBookmark || moving || readOnly || !els.saveFolder.value) return;
  moving = true;
  updateSaveAvailability();
  try {
    const result = await send("movePopupBookmark", { id: savedBookmark.id, url: savedBookmark.url,
      expectedParentId: savedBookmark.parentId, folderId: els.saveFolder.value });
    savedBookmark = result.bookmark;
    appState.popupRecentFolderIds = result.recentFolderIds || appState.popupRecentFolderIds;
    renderFolders();
    els.saveFeedback.textContent = "Bookmark moved";
    delete els.saveFeedback.dataset.error;
    setPickerOpen(false);
  } catch (error) {
    els.saveFolder.value = savedBookmark.parentId;
    throw error;
  } finally {
    moving = false;
    updateSaveAvailability();
    if (els.folderPicker.hidden && !creating) els.chooseFolder.focus();
  }
}

async function createFolder() {
  const title = els.folderName.value.trim();
  if (!title || moving || creating || readOnly || !savedBookmark) return;
  creating = true;
  updateSaveAvailability();
  const submit = els.folderForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const result = await send("createFolder", {
      title: title.trim(),
      parentId: savedBookmark.parentId
    });
    appState = await send("getManagerState");
    els.folderSearch.value = "";
    renderFolders();
    els.saveFolder.value = result.folder.id;
    await moveSavedBookmark();
    els.folderForm.hidden = true;
    els.folderName.value = "";
  } finally {
    creating = false;
    submit.disabled = false;
    updateSaveAvailability();
    if (els.folderPicker.hidden) els.chooseFolder.focus();
  }
}

async function saveWindowTabs() {
  if (els.saveAllWindows.disabled) return;
  const label = els.saveAllWindows.querySelector("span");
  els.saveAllWindows.disabled = true;
  label.textContent = "Saving windows...";
  els.windowSaveStatus.hidden = true;

  try {
    const result = await send("saveAllWindows");
    const folderCount = result.folders.length;
    const parts = [folderCount
      ? `Saved ${result.savedTabCount} ${result.savedTabCount === 1 ? "tab" : "tabs"} in ${folderCount} ${folderCount === 1 ? "folder" : "folders"}: ${result.folders.map((folder) => folder.title).join(", ")}.`
      : "No tabs were saved."];
    if (result.skippedTabCount) parts.push(`${result.skippedTabCount} unsupported ${result.skippedTabCount === 1 ? "tab" : "tabs"} skipped.`);
    if (result.failedTabCount) parts.push(`${result.failedTabCount} ${result.failedTabCount === 1 ? "tab" : "tabs"} could not be saved.`);
    if (result.failedWindowCount) parts.push(`${result.failedWindowCount} window ${result.failedWindowCount === 1 ? "folder" : "folders"} could not be created.`);
    if (result.metadataFailedWindowCount) parts.push("Bookmarks were saved, but some capture details could not be stored. Keep their nuevo names until storage works again.");
    els.windowSaveStatus.textContent = parts.join(" ");
  } catch (error) {
    els.windowSaveStatus.textContent = error.message || "Could not save the open windows.";
  } finally {
    els.windowSaveStatus.hidden = false;
    els.saveAllWindows.disabled = false;
    label.textContent = "Save all windows";
  }
}

async function openManagerOverlay() {
  const managerUrl = chrome.runtime.getURL("manager.html");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined || !isSaveableUrl(tab.url)) {
    await chrome.tabs.create({ url: managerUrl });
    window.close();
    return;
  }

  await chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ["overlay-manager.css"]
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["overlay-manager.js"]
  });
  window.close();
}

function showError(error) {
  els.saveFeedback.dataset.error = "true";
  els.saveFeedback.textContent = `${savedBookmark ? "Bookmark remains saved. " : ""}${error.message || String(error)}`;
}

function isSaveableUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

function updateSaveAvailability() {
  const canSave = isSaveableUrl(currentTab && currentTab.url);
  const disabled = !canSave || !savedBookmark || readOnly || moving || creating;
  for (const control of [els.saveFolder, els.createFolderMini, els.chooseFolder, els.folderSearch]) control.disabled = disabled;
  for (const button of els.recentFolderList.querySelectorAll("button")) button.disabled = disabled;
  els.closePicker.disabled = moving || creating;
  els.cancelFolder.disabled = moving || creating;

  if (!canSave) {
    els.saveFeedback.textContent = "";
    els.currentPageMini.textContent = "This Chrome page cannot be saved.";
    els.currentPageMini.title = currentTab && currentTab.url ? currentTab.url : "";
  }
}
