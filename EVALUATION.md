# Bookmark Admin Evaluations

Scope: roadmap phases 1 and 2. Phase 1 introduces Library, Saved Windows, and All
Bookmarks over Chrome's native bookmark tree. Phase 2 makes bookmark lists compact
and readable. Separate read-only evaluators reviewed the changes, reran tests
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
