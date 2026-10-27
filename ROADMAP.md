# Bookmark Admin Roadmap

The extension uses Chrome's native bookmarks as its source of truth. Views must
not duplicate or relocate bookmarks simply to organize the interface.

## 1. Navigation and bookmark coverage (complete)

- Library: the existing Bookmark Admin folder and its descendants.
- Saved Windows: numbered nuevoX folders directly on Chrome's bookmarks bars.
- All Bookmarks: the complete Chrome bookmark tree, including bookmarks outside
  the library and saved windows.
- Show a count and a clear active state for each view. Search and filters operate
  within the selected view and folder.
- Keep native bookmark IDs for opening, editing, moving, deleting, and undoing.
- Protect Chrome's special folders and read-only managed bookmarks.
- Refresh after external Chrome changes without duplicating data or unexpectedly
  changing the active view.
- Preserve the compact popup and its default save destination.

Acceptance: existing nuevo folders appear under Saved Windows, newly captured
windows appear without reopening the manager, and All Bookmarks finds items in
Other Bookmarks. View switching does not change Chrome's bookmark structure.

Accepted at 7.3/10 after one independent evaluation revision. See
[EVALUATION.md](EVALUATION.md) for category scores, fixes, test evidence, and the
limits of verification.

## 2. Compact, readable lists (complete)

Consistent row heights, wider titles, hidden URLs with hover/details access,
compact dates, and fewer visible badges. Verify long titles and resized windows.

Implemented 40px main-list rows and 32px inline tree rows, narrower dates and
option controls, full title/URL and folder-path hover text, and a compact
indicator for warning/dead links only. Notes, use counts, and generated keywords
remain available in the detail panel and search, without enlarging list rows.
Untitled bookmarks use a readable label instead of showing a raw URL.

Accepted at 8.3/10 on the first independent evaluation, with no revision required.
Verification includes 23 unit tests and 61 browser assertions with synthetic data,
long titles, metadata-heavy rows, and an actual window-resize gesture. See
[EVALUATION.md](EVALUATION.md) for the evidence and remaining limitations.

## 3. Details on demand (complete)

Open notes and bookmark properties only when requested, with a close control and
reliable autosave. Let the bookmark list use the available space otherwise.

Notes and Properties open from bookmark menus into a closable panel. Large
windows use a third column only while it is open; narrower or resized windows
use a drawer. Closing restores list space, and Escape dismisses the menu or
details before the manager. Pending edits are flushed on panel close, bookmark
or view changes, and controlled manager close. Failed saves retain the draft and
offer retry. Worker metadata writes are serialized, and indexing/link checking
merge only their own fields so they cannot replace recently saved notes.
External URL changes refresh editor bindings after flushing original-URL drafts.
Drawer mode makes covered panels inert and contains keyboard focus. Stale manager
reads are fetched again if notes were saved while the request was in flight.

Accepted at 8.3/10 after one independent revision. The evaluator reran 26 unit
tests and 154 browser assertions, inspected desktop/drawer/error screenshots,
and checked live column/drawer transitions and browser shortcut preservation.
See [EVALUATION.md](EVALUATION.md) for findings and verification limits.

## 4. Folder hierarchy and navigation memory (complete)

Implemented bounded indentation with branch guides, distinct top-level folder
surfaces, independent disclosure buttons, and expand/collapse-all controls.
Empty folders have no active disclosure arrow. Clickable breadcrumbs keep the
view button outside a separately scrolling ancestor trail so paths do not cover
the overview control. Keyboard focus follows surviving breadcrumb/folder IDs or
falls back to a parent or overview after external changes. Narrow layouts reserve
enough tree space for at least two folder rows at the tested 390x844 viewport.

The manager restores its last view, per-view selected native folder IDs, and
expanded folder IDs from local extension storage, without changing popup save
settings. Restoring reveals the selected folder's ancestors. Renames and moves
retain identity; deleted or out-of-scope locations fall back to their view's
overview. External refreshes do not reapply older navigation snapshots. Closing
an older manager waits for its writes rather than overwriting another manager's
newer location. Search, filters, and open details remain session-only.

Verification: 29 unit tests and 196 browser assertions pass using synthetic
bookmarks, including deep paths, navigation after reopening, corrupt/stale IDs,
focus, external rename/move/delete, and unchanged popup settings. Accepted at
8.33/10 after one optional revision following an initial 7.67/10 review. The
evaluator confirmed both focus and narrow-height findings resolved, checked a
390x600 scrolling layout, and verified independent manager instances do not
overwrite newer navigation on close. No second revision was needed. See
[EVALUATION.md](EVALUATION.md) for evidence and verification limits.

## 5. Saved-window workflows (complete)

Implemented local native-ID capture identity, actual timestamps for new captures,
honest folder-created dates for legacy captures, and live counts. Recognized
captures remain visible after rename/move. Nested captures do not duplicate trees
or exported bookmarks. Deletion undo restores identity against new native IDs.

Capture actions use focused dialogs for rename, confirmed web-only reopening,
and Library-folder picking. Reopening preserves order and duplicates, limits an
operation to 100 pages, and prevents overlapping requests from opening duplicate
windows. Individual bookmarks or capture contents can move to Library while
preserving IDs, notes, folder structure and undo. Stale confirmations are rejected.

Initial independent evaluation scored functionality 8/10, visuals 8/10 and
usability 7/10 (7.67/10 overall). An optional revision addresses execution-time
transfer validation and capture-action focus after refresh. Transfers now stop on
detected concurrent changes, preserve undo for successful items only, and leave
unrelated bulk-move behavior unchanged. Revision 1 was independently accepted at
8.33/10. A second optional revision rejects transfers into the items' existing
parent and excludes that destination from the picker. Independently accepted at
8.33/10 after both optional revision rounds. The evaluator reran 44 unit tests
and 232 browser assertions, plus targeted concurrency, focus and destination
probes, without page errors or new actionable findings. Native loaded-extension
integration remains unverified. See [EVALUATION.md](EVALUATION.md).

## 6. Selection and bulk actions (planned)

Reveal bulk actions only during selection. Support familiar range selection and
multiple selection without cluttering ordinary browsing.

## 7. Search and filters (planned)

Show result locations and explicit search scope. Add domain filtering and visible,
removable filter controls, including a useful duplicate view.

## 8. Consistent actions and recovery (planned)

Align context menus and option buttons. Improve target-folder picking, destructive
action feedback, and discoverable undo.

## 9. Visual refinement and accessibility (planned)

Refine dark surfaces, restrained accents, focus states, contrast, keyboard access,
motion preferences, and layouts across window sizes. Give warning and dead-link
indicators distinct shapes as well as colors.

## Evaluation for this delivery

An independent evaluator reviews evaluated steps for functionality, visuals, and usability,
each scored from 1 to 10, with an overall score. Use synthetic bookmarks rather
than personal browser data. Clearly distinguish browser observations, automated
tests, and static review. If the overall score is below 7, perform a revision and
request another evaluation, up to two revision rounds. Record the outcome and any
remaining limitations. Commit the roadmap, data integration, navigation interface,
and evaluation/revision steps separately.
