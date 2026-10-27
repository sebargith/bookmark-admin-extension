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

## Phase 6: Selection and bulk actions

Implementation commits: `464a8ba` (validated native batch operations) and
`29f162d` (compact selection, contextual controls, dialogs and integration checks).
Commit `4e1b6c0` adds opt-in original-ID verification for batch-delete recovery.

Selection is limited to visible main-list bookmarks, with hover/focus/touch
checkboxes, Ctrl/Cmd toggles, Shift visual ranges, Space/Shift+Space, scoped
Ctrl/Cmd+A, F2 rename, Delete confirmation and Escape clearing. View/folder changes
clear selection; filters and external refresh prune hidden or removed IDs.
Sorting preserves selection. Read-only items disable native mutations.

Contextual actions use the existing modal layer. Move has a native-ID destination
picker; rename previews prefix/suffix/text replacement asynchronously; delete
requires confirmation. Selected-only checking/indexing is separate from ordinary
visible-list actions. Batch dragging is disabled rather than moving one selected
item unexpectedly. Selection/preview drafts are not persisted.

New worker requests serialize native batches of at most 1000 bookmarks and
validate all selected snapshots before any mutation, then revalidate remaining
parent/title/URL/index and target ancestry before each native operation. Confirmed
native changes preserve IDs/URL metadata where applicable. Partial failures retain
undo for successful changes only; failures before any change restore prior undo
when it still belongs to the request. These checks do not provide atomic locking.

Two additional recovery tests simulate persisted batch-delete intent before any
deletion and after one deletion. Undo skips original native IDs that still exist,
so surviving bookmarks are not duplicated. Legacy delete undo remains unchanged.
This is synthetic recovery coverage, not an actual browser-termination test.

Verification: 56 unit tests and 289 browser assertions pass with synthetic data
and zero page errors. Coverage includes keyboard/range selection, filtering,
readonly controls, preview-before-mutation, batch move/rename/delete and undo,
stale confirmations, overlapping requests, storage failure and partial failure.
Desktop and 390px selection and rename dialogs have been visually checked.

Initial independent evaluation at `4e1b6c0`: functionality 9/10, visuals 8/10,
usability 7/10; arithmetic overall 8.00/10. The evaluator reran all 56 unit tests
and 289 browser assertions without page errors, inspected selection and baseline
screenshots, and independently checked out-of-order previews, pending-submit
protection, range union, input shortcut scope, selected-only Check/Index, limits,
partial undo, stale snapshots and recovery from generated persisted delete intent.

An optional revision (`43855b0`) addresses all three findings: keyboard-opened
menus now anchor to their trigger and focus the first action; arrows/Home/End
navigate, Escape restores the trigger, and Tab closes the menu before leaving.
Destructive action text uses a lighter danger color. Failed submissions explicitly
focus Cancel after refresh, while Undo refresh restores list focus. Regressions
cover menu placement/focus, contrast above 4.5:1 against the dialog surface, and
partial-delete failure focus/undo. All 56 unit tests and 300 browser assertions
pass without page errors.

| Category | Final Score |
| --- | ---: |
| Functionality | 9/10 |
| Visuals | 8/10 |
| Usability | 8/10 |
| Arithmetic Overall | 8.33/10 |

Outcome: independently accepted at `43855b0` after one optional revision, with no
second revision required. The evaluator independently reran all 56 unit tests
and 300 browser assertions without page errors and resolved all three findings.
Additional checks covered Shift+Tab, Home/End, More/Clear focus across refresh,
menu placement at 390x600, failure/undo focus and destructive text contrast of
approximately 9.25:1 including the composited button background. Updated menu,
failure, delete and mobile screenshots were inspected. No new actionable findings
were identified. Narrow layouts remain relatively cramped.

Evidence limits remain unchanged: isolated real Chrome rendering uses synthetic
APIs. No personal profile was accessed. Loaded-extension/native API integration,
MV3 lifecycle, actual browser crashes, real touch/macOS and screen-reader behavior,
and security certification are not covered by these checks.

## Phase 7: Search and filters

Implementation commits: `53c462e` (runtime), `f959d12` (synthetic regressions).
Search scope names the active view and folder, including descendants. Domain
choices use exact parsed hostnames from that scope. Duplicate matches use existing
normalized URLs within the same scope before other filters. Active text, date,
status, domain and duplicate filters can be removed individually or cleared
together without changing sorting, native bookmarks or export scope. Hidden
selection is discarded and unavailable domain choices reset on refresh.

Initial independent evaluation: functionality 9/10, visuals 7/10, usability 7/10;
arithmetic overall 7.67/10. The evaluator independently passed 56 unit tests and
371 browser assertions without page errors, inspected screenshots and checked
exact domains, scoped duplicates, external updates, chip keyboard/focus behavior,
hidden selections and zero synthetic bookmark mutations. A compact-layout finding
showed only 14px of folder-tree scrolling height with filters active.

Optional revision 1 (`89a458f`) removes that reduced tree reservation and gives
both navigation and results minimum space in narrow layouts, with central-area
scrolling when necessary. Regression checks now require at least 96px of actual
folder-tree height at 390x844, 320x844 and 390x600 while all five filters are active.
All 56 unit tests and 378 browser assertions pass without page errors. Evidence:
`phase-7-initial`, `phase-7-evaluator`, and `phase-7-revision-1` directories in the
external verification workspace; generated artifacts are not packaged.

Final independent scores: functionality 9/10, visuals 8/10, usability 8/10;
arithmetic overall 8.33/10. Accepted after one optional revision with no new
actionable findings. The evaluator independently reran all 56 unit tests and
378 browser assertions without page errors or observed remote page requests.
Tree height was 115px at the three narrow viewports and 101px after manager
resizing. Pointer/keyboard navigation after external rename, scope, chip focus
and access to results through scrolling were verified. Screenshots were inspected
from `phase-7-evaluator-revision-1`. Short windows still require scrolling.

These checks use isolated Chrome rendering and synthetic APIs, not a loaded
extension or personal profile. Native bookmark events/MV3 lifecycle, screen
readers, touch hardware, large-library performance and security certification
remain unverified. No personal bookmark data was used or committed.

## Phase 8: Consistent actions and recovery

Worker commit `0ae5d47` adds queued single-node rename/move/delete requests with
complete subtree snapshots (up to 10,000 nodes), destination ancestry validation,
read-only/protected-node checks and persisted undo intent. Native failures restore
the prior undo when the request still owns it. Delete recovery retains capture
identity and checks original IDs to avoid duplicating surviving items.

Interface commit `21c791f` replaces native prompts for create/rename/move/delete
with in-manager dialogs. Single, batch and Library-transfer destinations share a
searchable native-ID picker with full path feedback and explicit empty states.
Menus use stable action groups; right-click and option buttons share their action
definitions. Folder deletion shows its subject and descendant counts, with Cancel
focused first. Footer feedback names Undo's action and prevents repeated clicks
while that manager's undo request is pending.

Regression commits `a2a04b2` and `98faa50` cover dialog cancellation, menu entry
point parity, readonly/current/self/descendant destination exclusions, shared
picker empty-state restoration, stale child edits, native move/delete/rename,
focus recovery, undo and narrow dialog layout. Main verification passes 68 unit
tests and 406 browser assertions without page errors, using isolated Chrome and
synthetic bookmark APIs. Artifacts are outside the packaged repository in
`phase-8-initial` in the verification workspace.

Initial independent scores: functionality 8.5/10, visuals 8/10, usability 7.5/10;
arithmetic overall 8/10. The evaluator independently passed 68 unit tests and
406 browser assertions without page errors and checked worker failure recovery,
counts, cancellation, stale confirmation, focus, narrow layout and screenshots.
Two P2 findings: picker filtering could substitute the chosen destination, and
same-name sibling folders could have indistinguishable full path labels.

Optional revision 1 preserves the chosen native ID independently of filtering,
requires a valid selection before enabling Move and restores the chosen ID when
it becomes visible again. Colliding labels receive native-ID suffixes. Single
and batch pickers also retain their opening destination ancestry for validation
after external changes. New tests verify exact restored IDs in all three picker
types, nonempty filters without a selected destination, colliding paths and stale
destinations after manager refresh. All 68 unit tests and 416 browser assertions
pass without page errors; artifacts: `phase-8-revision-1`.

Final independent scores: functionality 9/10, visuals 8/10, usability 8.5/10;
arithmetic overall 8.5/10. Both original P2 findings were independently resolved
after one optional revision (`b19942a`). The evaluator independently passed all
68 unit tests and 416 browser assertions without page errors, inspected revision
screenshots and confirmed restoration/disabled states in all three picker types.
An additional bulk-move probe verified that a destination moved externally during
confirmation is rejected after refresh without moving selection or replacing
undo. Evidence: `phase-8-evaluator-revision-1`. No second revision was needed.

Nonblocking polish: extremely long paths can push action buttons below the fold
at 320x568; scrolling remains available. This is recorded for step 9. Verification
uses real Chrome rendering with synthetic APIs, not a loaded extension. No
personal profile, personal bookmark data or external-page access was used.
Native API integration, MV3 lifecycle, screen readers, touch hardware and security
certification remain unverified.
