# Release Checklist

Before publishing changes:

- Run JavaScript syntax checks:
  - `node --check service-worker.js`
  - `node --check popup.js`
  - `node --check overlay-manager.js`
- Parse `manifest.json` as JSON.
- Search for local paths, account names, tokens, secrets, passwords, API keys, and credentialed fetches.
- Confirm page indexing still uses `credentials: "omit"`.
- Confirm no packaged `.crx`, `.zip`, `.pem`, `.env`, or build output files are staged.
- Reload the unpacked extension in Chrome and test:
  - save current page from popup
  - save to `All`
  - create folder
  - open full manager overlay
  - expand folders
  - edit notes
  - export JSON or HTML
