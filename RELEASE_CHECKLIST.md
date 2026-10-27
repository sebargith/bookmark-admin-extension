# Release Checklist

Before publishing changes:

- Run JavaScript syntax checks:
  - `node --check service-worker.js`
  - `node --check popup.js`
  - `node --check overlay-manager.js`
- Parse `manifest.json` as JSON.
- Run `node --test` and the synthetic UI suite `node tests/manager-ui.browser.cjs` with Playwright and installed Chrome available. These checks do not replace loaded-extension testing.
- Search for local paths, account names, tokens, secrets, passwords, API keys, and credentialed fetches.
- Confirm page indexing still uses `credentials: "omit"`.
- Confirm no packaged `.crx`, `.zip`, `.pem`, `.env`, or build output files are staged.
- Reload the unpacked extension in Chrome and test:
  - save current page from popup
  - save to `All`
  - create folder
  - open full manager overlay
  - expand folders
  - select a nested folder, switch views, and reopen the manager to verify navigation memory
  - use breadcrumbs and expand/collapse controls without changing the selected location
  - rename, move, and remove the selected folder in Chrome and verify the manager refreshes safely
  - confirm manager navigation does not change the compact popup's last save destination
  - recognize a numbered capture, rename and move it, and verify it remains in Saved Windows
  - confirm/cancel reopening a saved window; verify order, repeated URLs and unsupported-link skips
  - move one captured bookmark and all capture contents to Library, then undo each operation
  - move a capture into Library and verify its own folder is not offered as a transfer destination
  - select bookmarks with Ctrl/Cmd, Shift ranges and checkboxes; confirm hidden selections are discarded after filtering
  - verify selection controls stay hidden during ordinary browsing and read-only selections cannot mutate bookmarks
  - preview/cancel/apply batch rename, move and delete, then verify native order and undo
  - open More with Enter, navigate actions with arrows, and verify Escape/Tab and failed-submit focus recovery
  - edit notes
  - export JSON or HTML
