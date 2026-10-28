const els = {};
let appState = null;
let currentTab = null;
let savedBookmark = null;
let moving = false;

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
    "openManager"
  ]) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.saveFolder.addEventListener("change", () => moveSavedBookmark().catch(showError));
  els.createFolderMini.addEventListener("click", () => { els.folderForm.hidden = false; els.folderName.focus(); });
  els.cancelFolder.addEventListener("click", () => { els.folderForm.hidden = true; });
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
  els.currentPageMini.textContent = currentTab.title || currentTab.url;
  els.saveFeedback.textContent = savedBookmark ? (result.existing ? "Already bookmarked" : "Bookmark saved") : "";
  appState = await send("getManagerState");
  els.currentPageMini.textContent = currentTab.title || currentTab.url;
  els.currentPageMini.title = currentTab.url;
  renderFolders();
  updateSaveAvailability();
  if (savedBookmark) {
    els.saveFeedback.textContent = result.existing ? "Already bookmarked" : "Bookmark saved";
    els.saveFolder.disabled = Boolean(result.readOnly);
    els.createFolderMini.disabled = Boolean(result.readOnly);
  }
}

function renderFolders() {
  const selected = savedBookmark?.parentId;
  els.saveFolder.textContent = "";
  for (const folder of appState.folders) {
    if (folder.id === appState.root.id || (appState.readOnlyNodeIds.includes(folder.id) && folder.id !== selected)) continue;
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = `${"  ".repeat(Math.max(0, folder.depth - 1))}${folder.path || folder.title}`;
    els.saveFolder.append(option);
  }
  const hasSelectedFolder = Array.from(els.saveFolder.options).some((option) => option.value === selected);
  els.saveFolder.value = hasSelectedFolder ? selected : "";
}

async function moveSavedBookmark() {
  if (!savedBookmark || moving) return;
  moving = true;
  els.saveFolder.disabled = true;
  els.createFolderMini.disabled = true;
  try {
    const result = await send("movePopupBookmark", { id: savedBookmark.id, url: savedBookmark.url,
      expectedParentId: savedBookmark.parentId, folderId: els.saveFolder.value });
    savedBookmark = result.bookmark;
    els.saveFeedback.textContent = "Bookmark moved";
  } catch (error) {
    els.saveFolder.value = savedBookmark.parentId;
    throw error;
  } finally {
    moving = false;
    els.saveFolder.disabled = false;
    els.createFolderMini.disabled = false;
  }
}

async function createFolder() {
  const title = els.folderName.value.trim();
  if (!title || moving || !savedBookmark) return;

  const result = await send("createFolder", {
    title: title.trim(),
    parentId: savedBookmark.parentId
  });
  appState = await send("getManagerState");
  renderFolders();
  els.saveFolder.value = result.folder.id;
  await moveSavedBookmark();
  els.folderForm.hidden = true;
  els.folderName.value = "";
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
  els.saveFeedback.textContent = `${savedBookmark ? "Bookmark remains saved. " : ""}${error.message || String(error)}`;
}

function isSaveableUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

function updateSaveAvailability() {
  const canSave = isSaveableUrl(currentTab && currentTab.url);
  els.saveFolder.disabled = !canSave || !savedBookmark;
  els.createFolderMini.disabled = !canSave || !savedBookmark;

  if (!canSave) {
    els.saveFeedback.textContent = "";
    els.currentPageMini.textContent = "This Chrome page cannot be saved.";
    els.currentPageMini.title = currentTab && currentTab.url ? currentTab.url : "";
  }
}
