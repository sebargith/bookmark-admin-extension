# Local Bookmark Admin

A personal Chrome Manifest V3 extension for managing Chrome bookmarks from a compact save popup and movable manager.

## Install locally

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the extension source folder.

Chrome will create a managed bookmark root named `Bookmark Admin`. Clicking the pinned extension icon immediately saves a new web page in Chrome's Other bookmarks folder and opens a compact editor. Changing the folder moves that same bookmark automatically. An existing bookmark is reused in its current location. Closing the popup leaves the bookmark saved.

## Main features

- Save the current page from the compact toolbar popup, page context menu, or `Alt+Shift+B`.
- Change the saved bookmark's destination across writable Chrome folders, or create a subfolder inline and move it there.
- Save all open Chrome windows into separate numbered folders on the bookmarks bar with `Save all windows`.
- See saved-window dates and current tab counts, reopen web pages as a window after confirmation, and keep recognized captures identifiable after renaming or moving them.
- Move one captured bookmark or a capture's contents into a Library folder using a destination picker, preserving native IDs, notes, folder structure, and move undo.
- Switch between Library, Saved Windows, and All Bookmarks without copying or moving bookmarks.
- Open the movable full manager overlay from the compact popup, page context menu, or `Alt+Shift+M`.
- Blur the page behind the manager overlay and close it by clicking outside or pressing `Esc`.
- Create folders and move bookmarks or folders by drag and drop.
- Search title, URL, folder path, saved notes, and automatically extracted page keywords.
- Filter bookmarks by time added, link status, and usage; sort by newest, oldest, title, or use count.
- Store generated keywords, notes, open counts, and dead-link status in extension local storage.
- Detect duplicates before saving and update metadata instead of creating another copy.
- Expand folders into deployable lists that show subfolders and bookmarks inline.
- Navigate with clickable folder breadcrumbs, independent disclosure arrows, and expand/collapse-all controls. Empty folders have no active disclosure arrow.
- Resume the manager's last view and selected folder, with folder locations remembered per view and expanded folders stored locally. New popup saves always start in Other bookmarks.
- Browse consistent compact bookmark rows with wider titles, narrow dates, and full titles/URLs on hover. Only link issues show a list indicator; notes, use counts, and generated keywords remain in the detail panel and search.
- Select visible list bookmarks with compact checkboxes, Ctrl/Cmd-click, and Shift ranges. Batch Move, Rename and Delete controls appear only during selection.
- Preview prefix/suffix/text-replacement renames, pick move destinations by full folder path, confirm deletions, and undo successful batch changes.
- Right-click folders and bookmarks, or use their `...` buttons, for move, rename, notes, delete, check, sort, and re-index actions.
- Notes and Properties open on demand in a closable panel, or a drawer in smaller windows. Closing returns the space to the list.
- Notes auto-save, flush on navigation or controlled closing, and retain failed drafts for retry. Background indexing and link checking preserve recent note edits.
- Export the managed tree as JSON or Chrome bookmark HTML.
- Undo the latest delete, move, rename, or sort action.
- Refresh when Chrome bookmark changes are made outside the manager.

## Permissions

The extension asks for:

- `bookmarks`: read and organize Chrome bookmarks.
- `contextMenus`: add quick-save and open-manager menu items.
- `scripting`: inject the movable full manager overlay into the active page.
- `storage`: store tags, notes, usage stats, undo state, and change notices.
- `tabs`: read tab titles and URLs when saving the current page or all open windows.
- `http://*/*` and `https://*/*`: index saved pages and check bookmark URLs for dead-link status.

## Notes

The manager has three views:

- **Library** shows the existing `Bookmark Admin` folder and its descendants. The compact popup still saves into this library.
- **Saved Windows** recognizes `nuevoX` folders directly on either local or account bookmarks bars. Once recognized, their native folder IDs are remembered locally, so renaming or moving them does not remove them from this view. Nested captures are listed within their ancestor capture instead of duplicating the same bookmark tree.
- **All Bookmarks** shows the complete native tree, including other, mobile, and managed bookmarks supplied by Chrome. Chrome's special folders and read-only managed nodes are protected.

Navigation counts represent bookmarks. Search and filters apply within the active view and selected folder, including its descendants. Export includes that view or folder, regardless of search filters. Changes made in Chrome update the open manager automatically. These views do not create extra copies or move existing bookmarks. See [ROADMAP.md](ROADMAP.md) for upcoming improvements.

The search scope is displayed beside the results. Domain filtering matches the exact hostname, so a subdomain is a separate choice. Duplicate filtering uses normalized URLs within that scope before applying text, domain, date and status filters; it does not merge or delete bookmarks. Active filters can be removed individually or cleared together. Sorting is separate from filtering. Filters remain session-only and do not change Chrome's bookmark structure or request any network data.

Phase-seven search/filter evaluation: 8.33/10 after one optional compact-layout revision, with 56 passing unit tests and 378 passing browser assertions using synthetic data. See [EVALUATION.md](EVALUATION.md) for evidence and verification limits.

Manager navigation uses native folder IDs, so renaming or moving a folder keeps its identity. Deleted folders or locations moved outside a view fall back to that view's overview. Reopening reveals the selected folder's ancestors; expand/collapse controls do not change the selected location. Navigation is local to this extension installation, with the most recent interaction winning between manager instances. Search, filters, and open details are not restored. Deep tree indentation is capped to keep names readable, and the folder path can scroll horizontally while its view button remains accessible.

Selection applies to bookmarks in the main list, not folders or inline tree entries. Checkboxes appear on hover, keyboard focus, touch devices, or while selection is active; the list-header checkbox selects all visible results. Ctrl/Cmd-click toggles a bookmark, Shift selects a range in the current visual order, and Ctrl/Cmd+Shift adds a range. Space toggles a focused checkbox; Shift+Space extends the range. Ctrl/Cmd+A selects visible bookmarks only when focus is in the list or selection controls. F2 opens batch rename and Delete opens confirmation. Escape dismisses a dialog/menu/details first, then clears selection before closing the manager. Text inputs keep their normal selection shortcuts. In selection mode, title clicks toggle selection; use a bookmark's Open menu command to open it.

Changing view or folder clears selection. Search/date/status changes discard hidden selections; clearing filters does not select those items again. Sorting preserves selected native IDs. Read-only bookmarks can be selected but disable native mutations. Batch mutations are limited to 1000 bookmarks per action, with confirmation and a preview/count of affected items. Moves skip items already in the chosen folder; renames skip unchanged titles. More selected actions checks/indexes only selected bookmarks; the main Check/Index buttons retain their visible-list scope. Export retains its view/folder scope, not selection scope. Multi-item dragging is disabled; use the explicit Move action instead.

Selections and preview drafts remain in memory and are not restored on reopen. Batch mutation requests serialize and revalidate native IDs, parent, title, URL and native index before each change. Destination moves, stale selections and read-only changes stop the operation. Undo covers successful changes only after partial failure; a no-change failure preserves the prior undo when still owned by that request. As with other native operations, this is conflict detection, not atomic locking. Batch delete undo recreates native bookmark IDs; notes remain keyed to URL. Native folder sorting stays in each folder's menu, separate from list sorting.

Batch-delete undo verifies whether each original bookmark ID still exists before restoring it. This avoids duplicate survivors when recovering persisted intent from an interrupted deletion. Actual browser termination and MV3 lifecycle behavior still require loaded-extension testing.

Folder and bookmark actions open inside the manager rather than using browser prompts. Create and Rename use a name field; Move provides a searchable picker with full destination paths and native folder IDs, so equal names remain distinct. The same picker search is available for batch moves and Library transfers. Current parents, self/descendant destinations and read-only folders are excluded where applicable. Delete names the target and counts contained subfolders/bookmarks, with Cancel focused initially. Single-node rename/move/delete rejects changes to its frozen subtree or destination ancestry before applying the native action; cancel and reopen stale confirmations. These checks are conflict detection, not atomic locking against Chrome.

The footer names the action available to Undo. Only the latest supported action can be undone; a later mutation replaces it. Deleted items are recreated with new native IDs, while URL-based notes remain available. In short windows, scrolling may be needed to reach all dialog controls. No additional permissions or remote requests are introduced by these actions.

Filtering destination choices never substitutes another folder: the chosen ID is remembered, Move is disabled while that choice is hidden, and clearing the search restores it. Identical full paths receive native-folder-ID suffixes to distinguish their options. Single-node and batch destination ancestry is captured when the picker opens, so moving a destination while confirming is rejected. Single-node subtree confirmations support up to 10,000 nodes; larger actions are rejected without mutation.

Phase-eight actions/recovery evaluation: 8.5/10 after one optional revision, with 68 passing unit tests and 416 passing browser assertions using synthetic data. Native loaded-extension integration remains unverified. See [EVALUATION.md](EVALUATION.md).

The manager and quick-save popup use visible keyboard focus, readable dark surfaces and reduced-motion styles. Link warnings use a triangle/exclamation mark; broken links use a circle/cross, with accessible names and tooltips rather than color alone. Manager dialogs keep action buttons outside their scrolling content, so long destination paths do not hide Cancel or the primary action. Context menus stay inside the viewport and scroll when needed. Tab stays within the active manager/dialog/drawer; closing an injected manager restores the previously focused page control when it still exists. Screen-reader and assistive-hardware integration still require manual testing.

Phase-nine visual/accessibility evaluation: 9.00/10 after one optional menu-resize revision. Verification passes 68 unit tests, 465 manager browser assertions and 10 popup browser tests with synthetic data. All nine implementation steps are complete; native loaded-extension and manual accessibility verification remain pending. See [EVALUATION.md](EVALUATION.md).

Version 0.4.10 restores the established dark blue/violet palette after the step-nine color change. The compact popup declares a 360px intrinsic/minimum document width rather than limiting itself to the popup host's initial viewport. This prevents the header and Save/All/New row from collapsing during narrow startup sizing. Focus, contrast, reduced-motion and other accessibility fixes remain in place. Native toolbar-popup sizing still needs confirmation after reloading the installed extension.

Phase-one independent evaluation: 7.3/10 after one revision. See [EVALUATION.md](EVALUATION.md) for findings, verification, and remaining test limits.

Phase-two compact-list evaluation: 8.3/10 on its first review, with 23 passing unit tests and 61 passing browser assertions using synthetic data.

Phase-three on-demand details evaluation: 8.3/10 after one revision, with 26 passing unit tests and 154 passing browser assertions using synthetic data.

Phase-four hierarchy and navigation-memory evaluation: 8.33/10 after one optional revision, with 29 passing unit tests and 196 passing browser assertions using synthetic data. Focus recovery, short-window scrolling, and independent manager instances were also reviewed.

Phase-five saved-window evaluation: 8.33/10 after two optional revisions, with 44 passing unit tests and 232 passing browser assertions using synthetic data. Independent probes covered execution-time move conflicts, partial undo, toolbar focus, and same-folder destination rejection. Native loaded-extension integration remains unverified.

Phase-six selection/batch evaluation: 8.33/10 after one optional revision, with 56 passing unit tests and 300 passing browser assertions using synthetic data. Independent probes covered stale previews, selection scope, interruption recovery, limits, partial failures, menu keyboard navigation, focus and destructive-action contrast. Native installation, actual crashes, real touch/macOS and screen-reader behavior remain unverified.

Exports started from the floating manager open a dedicated extension-owned tab. The download is created there, so its contents and download link are not inserted into the underlying website. No additional permissions are required.

`Save all windows` creates one folder per non-incognito window directly on the bookmarks bar, named `nuevo1`, `nuevo2`, and so on. It continues after the highest existing numbered folder on that bar (including names such as `nuevo 6`), preserves tab order and repeated URLs, and leaves the windows open. If Chrome exposes both account and local bookmarks bars, it uses the bar with the highest existing `nuevo` number, preferring the account bar when tied. These folders appear in the manager's Saved Windows and All Bookmarks views. The action makes no page-indexing requests. Unsupported or unavailable tab URLs are skipped and failures are reported in the popup. Closing the popup does not cancel a capture already started in the background.

Select a capture to see its actions, or use its folder menu. New captures store their capture timestamp and original saved-tab count locally. Older captures show **Folder created**, not an invented capture date. Counts reflect the current contents, including nested folders. Reopening preserves native bookmark order and repeated URLs, skips non-http/https or invalid links, and requires confirmation. The limit is 100 web pages per operation; oversized captures are rejected without silently truncating them. Reopening uses [Chrome's windows API](https://developer.chrome.com/docs/extensions/reference/api/windows#method-create) without adding permissions. It opens ordinary browser pages, which may use the browser's existing signed-in sessions.

The Library picker can move an individual captured bookmark or all immediate capture contents (keeping subfolders intact). The capture folder remains and can become empty. Undo restores moved items; it does not close reopened browser windows. If a capture changes while an opening/moving confirmation is displayed, cancel and review it again. Local capture identity survives undoing a deletion from this extension, but a folder renamed before it is first recognized, a folder re-imported with new IDs, or a renamed capture on another installation cannot be identified automatically. JSON backups include capture metadata only for folders in the exported scope; HTML preserves native bookmark structure, not extension-only identity.

Transfers revalidate source contents and the Library destination immediately before each move. A detected concurrent change stops the remaining items. If some items already moved, the error reports that and Undo contains only those successful moves; the rest stay where they are. Cancel the dialog before choosing Undo. This is conflict detection between native operations, not an atomic bookmark transaction.

This is built for personal/local use. The real bookmarks live in Chrome's bookmark system under the `Bookmark Admin` folder, so normal Chrome bookmark sync can sync those bookmark folders and URLs. Extra metadata such as notes, generated search keywords, dead-link status, and open counts is stored locally by the extension.

The extension does not send bookmark data to a third-party service. Page indexing fetches saved pages without credentials and stores only compact keyword metadata locally.

The full manager overlay can run on normal `http` and `https` pages. Chrome does not allow extension content scripts on internal pages such as `chrome://extensions`.

Notes use local extension storage. Closing the panel or manager through its controls waits for pending saves and keeps the editor open if saving fails. A page-exit handler makes a best-effort delivery of remaining drafts on native tab closure; browser crashes or forced shutdown cannot guarantee delivery.

## Development checks

Run `node --test` for synthetic Chrome API tests. Run `node tests/manager-ui.browser.cjs` with Playwright available and Chrome installed for interface checks and screenshots. An external Playwright module can be selected through `BOOKMARK_TEST_PLAYWRIGHT`; `BOOKMARK_TEST_ARTIFACTS` sets the screenshot directory. Browser checks use synthetic bookmark APIs in an isolated browser context; they do not access a personal Chrome profile or verify installation as a loaded extension.
