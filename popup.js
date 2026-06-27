const els = {};
let appState = null;
let currentTab = null;

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
    "saveToFolder",
    "saveToAll",
    "createFolderMini",
    "openManager"
  ]) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.saveToFolder.addEventListener("click", () => saveCurrentPage(els.saveFolder.value));
  els.saveToAll.addEventListener("click", () => saveCurrentPage(appState.defaultFolder.id));
  els.createFolderMini.addEventListener("click", () => createFolder().catch(showError));
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
  appState = await send("getState");
  currentTab = await send("getCurrentTab");
  els.currentPageMini.textContent = currentTab.title || currentTab.url;
  els.currentPageMini.title = currentTab.url;
  renderFolders();
  updateSaveAvailability();
}

function renderFolders() {
  const selected = appState.settings.lastSavedFolderId ||
    appState.settings.selectedFolderId ||
    appState.defaultFolder.id;
  els.saveFolder.textContent = "";
  for (const folder of appState.folders) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = `${"  ".repeat(Math.max(0, folder.depth - 1))}${folder.path || folder.title}`;
    els.saveFolder.append(option);
  }
  const hasSelectedFolder = Array.from(els.saveFolder.options).some((option) => option.value === selected);
  els.saveFolder.value = hasSelectedFolder ? selected : appState.defaultFolder.id;
}

async function saveCurrentPage(folderId) {
  if (!isSaveableUrl(currentTab && currentTab.url)) {
    showError(new Error("This page cannot be saved. Open a normal http or https page."));
    return;
  }

  const buttonText = els.saveToFolder.textContent;
  els.saveToFolder.textContent = "Saving";
  els.saveToFolder.disabled = true;

  try {
    await send("quickSaveCurrentPage", { folderId });
    els.saveToFolder.textContent = "Saved";
    setTimeout(() => window.close(), 420);
  } catch (error) {
    els.saveToFolder.textContent = "Error";
    showError(error);
    setTimeout(() => {
      els.saveToFolder.textContent = buttonText;
      els.saveToFolder.disabled = false;
    }, 900);
  }
}

async function createFolder() {
  const title = prompt("New folder name", "");
  if (title === null || !title.trim()) return;

  const result = await send("createFolder", {
    title: title.trim(),
    parentId: appState.managedRoot.id
  });
  await refresh();
  els.saveFolder.value = result.folder.id;
}

async function openManagerOverlay() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) throw new Error("No active tab available.");
  if (!isSaveableUrl(tab.url)) {
    throw new Error("The full manager overlay can only open on normal http or https pages.");
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
  console.error(error);
  els.currentPageMini.textContent = error.message || String(error);
}

function isSaveableUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

function updateSaveAvailability() {
  const canSave = isSaveableUrl(currentTab && currentTab.url);
  els.saveToFolder.disabled = !canSave;
  els.saveToAll.disabled = !canSave;

  if (!canSave) {
    els.currentPageMini.textContent = "This Chrome page cannot be saved.";
    els.currentPageMini.title = currentTab && currentTab.url ? currentTab.url : "";
  }
}
