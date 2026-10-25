const exportStatus = document.getElementById("exportStatus");
document.getElementById("closeExport").addEventListener("click", () => window.close());
const exportParameters = new URLSearchParams(window.location.search);

chrome.runtime.sendMessage({ type: "buildExport", payload: {
  format: exportParameters.get("format"),
  view: exportParameters.get("view"),
  folderId: exportParameters.get("folder") || null
} }, (response) => {
  const error = chrome.runtime.lastError;
  if (error || !response || !response.ok) {
    exportStatus.textContent = error?.message || response?.error || "Export failed.";
    return;
  }
  const { content, type, filename } = response.result;
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  exportStatus.textContent = "Download started.";
});
