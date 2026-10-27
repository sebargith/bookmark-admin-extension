# Bookmark Admin Evaluations

Scope: roadmap phases 1, 2, and 3. Phase 1 introduces Library, Saved Windows, and All
Bookmarks over Chrome's native bookmark tree. Phase 2 makes bookmark lists compact
and readable. Phase 3 adds on-demand details and reliable note saving.
Separate read-only evaluators reviewed the changes, reran tests
with synthetic data, and inspected browser screenshots.

The threshold is an overall score of at least 7/10, calculated as the arithmetic
mean of functionality, visuals, and usability, rounded to one decimal. Up to two
revision rounds are permitted after the initial evaluation.

## Initial evaluation

Reviewed commit: `273578b`.

| Category | Score |
| --- | ---: |
| Functionality | 6/10 |
| Visuals | 7/10 |
| Usability | 7/10 |
| Overall | 6.7/10 |

The evaluator independently reran 18 unit tests and 35 browser assertions and
inspected desktop, narrow, and floating-overlay screenshots. Core navigation,
scope filtering, counts, refresh, and native bookmark operations worked.

Two issues triggered revision:

1. Deleting a parent containing the protected Library could remove that Library;
   initialization during undo could then create a second Library.
2. The floating manager placed its export anchor outside the closed shadow root.
   A host-document observer could read the export in the synthetic browser probe.
   Exploitability under actual extension isolation was not established.

## Revision 1

Fix commit: `6f438f2`.

- Deletion checks every descendant for protected and read-only nodes.
- Deleted trees are restored before initializing a missing Library.
- The floating manager opens a dedicated, non-web-accessible extension page for
  export. Bookmark content and Blob download URLs are never placed in the host
  document by that workflow.
- Export serialization validates the view and folder scope and includes only
  relevant metadata. HTML export escapes titles, URLs, and notes.
- Regression coverage includes ancestor deletion, legacy undo recovery, scoped
  exports, and a hostile host observer during export.

Verification: 23 passing unit tests and 40 passing browser assertions, with no
reported page errors.

The independent evaluator reran both suites and inspected all six screenshots.
Additional probes confirmed invalid-scope rejection without opening export tabs,
empty Saved Windows export without scope widening, and protected-ancestor
deletion rejection without native bookmark mutations.

| Category | Score |
| --- | ---: |
| Functionality | 8/10 |
| Visuals | 7/10 |
| Usability | 7/10 |
| Overall | 7.3/10 |

Outcome: accepted after one revision, within the maximum of two revision rounds.
The evaluator found no remaining blocking defects in the reviewed code and
synthetic tests. Both initial findings were resolved in the tested paths. Narrow
layouts remain cramped but usable; broader list and sidebar refinement stays on
the roadmap. No second revision was required.

## Evidence limits

Browser checks render the real interface in an isolated Chrome context, using
synthetic Chrome API fixtures and synthetic bookmarks. They do not access a
personal browser profile. Screenshots cover 1440px, 1000px, and 390px viewports,
plus the floating overlay. Test source is in `tests/manager-ui.browser.cjs`.

Installation as a loaded extension, actual extension CSP/resource loading, and
native Chrome API integration have not been verified in this environment. The
score is an engineering review, not a security certification.

## Phase 2: Compact lists

Reviewed commit: `04e5629`.

| Category | Score |
| --- | ---: |
| Functionality | 9/10 |
| Visuals | 8/10 |
| Usability | 8/10 |
| Overall | 8.3/10 |

Outcome: accepted on the first evaluation, without revision. The evaluator found
no blocking new regression. Phase 3's sidebar redesign was outside this review.

The evaluator independently reran 23 unit tests and 61 browser assertions without
reported browser errors and inspected seven screenshots. Checks include fixed
40px main rows and 32px inline tree rows, narrow dates, full title/URL hover text,
untitled labels, retained metadata in details/search, long-title truncation,
desktop/narrow layouts, and resizing the manager with its native resize handle.

Non-blocking follow-up: warning and dead-link indicators currently share a glyph
and differ in background color. Hover text and accessible labels distinguish
them; distinct shapes would make them easier to scan without relying on color.
This is recorded under roadmap phase 9.

The evidence limits above also apply to phase 2: real Chrome rendering used
synthetic APIs; loaded-extension and native Chrome API integration remain unverified.

## Phase 3: Details on demand

Implementation commits: `2022d51` (metadata write reliability) and `25b207e`
(on-demand Notes/Properties panel and responsive drawer).

Changes include a hidden-by-default detail panel, dedicated Notes and Properties
views, close/Escape behavior, restored list width, responsive drawers, retained
drafts, visible save errors and retry, and flushing on controlled close and
navigation. Pending notes also survive bookmark refresh and removal. Background
metadata work is serialized and merges only its changed fields.

Verification: 26 unit tests and 93 browser assertions pass with synthetic data.
Coverage includes immediate close, switching bookmarks and views, edits during
in-flight writes, failure/retry, clearing notes, keyboard/focus behavior,
responsive drawers, overlay closure, and page-exit delivery. The page-exit event
test is not a guarantee against abrupt browser termination.

Initial independent score: functionality 6/10, visuals 8/10, usability 6/10;
overall 6.7/10. The evaluator reproduced a stale URL binding after manual bookmark
URL changes and keyboard focus escaping behind the drawer. Both required revision.

A further local regression probe reproduced an older manager response replacing
recently saved notes in the UI. Commit `8404519` adds a notes revision counter
that rejects and refetches such responses.

Revision 1 (`6425bc5`, including `8404519`) refreshes URL identity and input bindings after flushing drafts against
their original URL. Covered panels become inert, with drawer focus containment,
resize-aware mode changes, and focus restoration on close. The complete browser
suite now passes 154 assertions, including the delayed-read, URL-change and
keyboard-focus regressions.

| Category | Score |
| --- | ---: |
| Functionality | 9/10 |
| Visuals | 8/10 |
| Usability | 8/10 |
| Overall | 8.3/10 |

Outcome: accepted after one revision; no second revision required. The evaluator
found no remaining actionable step-3 findings, independently reran all 26 unit
tests and 154 browser assertions without page errors, and inspected eight fresh
screenshots. Additional probes passed live column-to-drawer-to-column transitions
and confirmed that Ctrl/Alt/Meta+Tab events were not prevented.

The shared evidence limits above apply.

## Phase 4: Folder hierarchy and navigation memory

Implementation commits: `28206ed` (independent local navigation storage),
`7178256` (hierarchy, breadcrumbs, controls and restoration), and `5b18e8f`
(separate fixed scope control from the scrolling ancestor trail).

The independent evaluator reviewed `5b18e8f`, reran 29 unit tests and 192 browser
assertions without page errors, and inspected desktop, mobile and deep-hierarchy
screenshots. A separate two-instance probe confirmed that closing an older
manager does not issue a navigation write or overwrite the newer location.
Quick-save settings remained unchanged. No personal browser profile was used.

Initial scores: functionality 8/10, visuals 8/10, usability 7/10; arithmetic
overall 7.67/10. This exceeded the acceptance threshold. The evaluator found
incomplete focus recovery for externally refreshed breadcrumbs/deleted folders,
and a narrow tree viewport that showed only one complete folder row.

An optional revision (`a1c8ac7`) captures focused navigation IDs and their original
ancestor chain before replacing data. Rendering restores the same control, a
surviving ancestor, or the overview. Stacked layouts reserve a larger tree track
and scroll the layout on short windows. Regression checks cover both focus
fallbacks and two visible folder rows at 390x844. All 29 unit tests and 196 browser
assertions pass without page errors.

| Category | Score |
| --- | ---: |
| Functionality | 9/10 |
| Visuals | 8/10 |
| Usability | 8/10 |
| Arithmetic Overall | 8.33/10 |

Outcome: accepted after one optional revision, with no second revision required.
The evaluator independently reran all 29 unit tests and 196 browser assertions,
inspected revised deep/mobile/detail screenshots, and confirmed both findings
resolved without new actionable findings. A 390x600 probe verified scrolling
access to the bookmark list and details controls. The two-instance test passed
again, with no additional navigation write when closing the older manager.

The shared evidence limits above apply: these are synthetic Chrome API checks
with real browser rendering, not verification as an installed extension or a
security certification.

## Phase 5: Saved-window workflows

Implementation commits: `97407fe` (capture identity and worker operations),
`614075e` (confirmation guards and storage-failure coverage), and `7787b5a`
(capture actions, dates, destination dialogs and interface tests).

Recognized capture folder IDs persist locally across rename and move. New
captures record their timestamp and original saved-tab count; legacy captures
show folder creation dates instead of claiming a capture time. Current counts
include nested bookmarks. Nested captures do not duplicate overview/export trees,
and deletion undo remaps capture identity to restored native IDs.

Reopening requires confirmation, preserves order and duplicate URLs, skips
non-web/invalid links, rejects more than 100 pages, and shares overlapping requests.
Library transfers preserve native IDs, notes and subfolder structure and offer
undo. Confirmation snapshots reject changed captures. Dialogs contain keyboard
focus, make the background inert, and support cancellation and error recovery.

Verification: 40 unit tests and 228 browser assertions pass using synthetic
bookmarks. Tests include reopening failure/retry/cancel, stale confirmations,
individual/content moves and undo, renamed capture identity, capture metadata
storage failure, desktop and 390px dialogs, and existing navigation/details
regressions. No personal Chrome profile was used.

Initial independent evaluation at `7787b5a`: functionality 8/10, visuals 8/10,
usability 7/10; arithmetic overall 7.67/10. The evaluator independently reran all
40 unit tests and 228 browser assertions without page errors and inspected five
capture screenshots. Although above threshold, two findings warranted an optional
revision: transfer validation compared different snapshots, and successful toolbar
actions lost keyboard focus after a refresh.

Revision 1 (`3cb6d93`, `e311bec`) validates capture contents, source protection and
Library destination scope against the execution context immediately before each
native move. Expected remaining contents exclude only this operation's completed
subtrees. Detected conflicts stop further moves; partial undo includes successes
only, and an abort before any move restores the previous undo record when it is
still owned by this operation. Unrelated bulk moves were not changed. Capture
toolbar focus now uses stable action identities and falls back to a folder row
or overview if the action disappears or becomes disabled.

All 43 unit tests and 230 browser assertions pass without page errors. New probes
cover URL changes between capture lookup and execution, destinations leaving
Library during an undo write or between moves, partial undo, and focus after
successful Open/Move toolbar actions. The evaluator independently reran these
checks and its original race/focus probes, inspected all five revised screenshots,
and accepted revision 1 at functionality 9/10, visuals 8/10, usability 8/10;
arithmetic overall 8.33/10. Both initial findings were resolved.

A further local regression probe found that a recognized capture moved inside
Library could choose its own folder as a transfer destination. Native same-parent
moves reordered items before the remaining-content guard stopped the operation.
Optional revision 2 (`d91bf0a`) rejects moves when the selected items already have
the requested parent, before any mutation or undo replacement. The picker excludes
that destination. Tests cover whole-capture and individual-bookmark rejection,
unchanged item order and undo, and the picker after moving a capture into Library.
All 44 unit tests and 232 browser assertions pass without page errors.

| Category | Final Score |
| --- | ---: |
| Functionality | 9/10 |
| Visuals | 8/10 |
| Usability | 8/10 |
| Arithmetic Overall | 8.33/10 |

Outcome: independently accepted at `d91bf0a` after both optional revision rounds.
The evaluator reran all 44 unit tests and 232 browser assertions, with zero page
errors, and independently confirmed no-op transfers preserve item order and prior
undo. An additional browser picker probe verified exclusion for individual
bookmarks, availability of other Library targets, and unchanged undo on cancel.
The original race probes and revision 1 focus checks still pass. Five final
screenshots plus the individual-bookmark picker were inspected without visual
regressions. No new actionable findings were identified within the review.

The shared evidence limits above apply: real browser rendering uses synthetic
Chrome APIs, not a loaded-extension/native API integration test or a security
certification. Native operations are not transactional; per-move conflict checks
cannot provide atomic locking. MV3 service-worker lifecycle and actual native
bookmark/window operations remain unverified.
