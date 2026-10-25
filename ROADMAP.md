# Bookmark Admin Roadmap

The extension uses Chrome's native bookmarks as its source of truth. Views must
not duplicate or relocate bookmarks simply to organize the interface.

## 1. Navigation and bookmark coverage (in progress)

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

## 2. Compact, readable lists (planned)

Consistent row heights, wider titles, hidden URLs with hover/details access,
compact dates, and fewer visible badges. Verify long titles and resized windows.

## 3. Details on demand (planned)

Open notes and bookmark properties only when requested, with a close control and
reliable autosave. Let the bookmark list use the available space otherwise.

## 4. Folder hierarchy and navigation memory (planned)

Improve indentation, folder accents, breadcrumbs, expansion controls, and
remembered location and expanded folders.

## 5. Saved-window workflows (planned)

Show capture dates and tab counts. Reopen a capture as a window, rename it, and
move useful bookmarks into the permanent library. Keep renamed captures identifiable.

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
motion preferences, and layouts across window sizes.

## Evaluation for this delivery

An independent evaluator reviews phase 1 for functionality, visuals, and usability,
each scored from 1 to 10, with an overall score. Use synthetic bookmarks rather
than personal browser data. Clearly distinguish browser observations, automated
tests, and static review. If the overall score is below 7, perform a revision and
request another evaluation, up to two revision rounds. Record the outcome and any
remaining limitations. Commit the roadmap, data integration, navigation interface,
and evaluation/revision steps separately.
