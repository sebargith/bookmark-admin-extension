# Redesign rollout

Three user-requested prompts, with one commit per step.

1. Complete: one-click saving and compact automatic destination editor (0.5.0).
   New web pages go into native Other bookmarks. Existing bookmarks anywhere in
   Chrome are reused in place, including read-only bookmarks without editing.
   Folder changes move the same native ID; stale parent changes are rejected.
   New folders are created inline beneath the current destination.
   Opening and moving do not fetch page contents or require keyword indexing.
2. Complete (0.5.1): two-column manager with unified folder navigation, compact main
   list, Recently saved as the default opening view, and toolbar-icon context
   menu entry to open the manager. Chrome owns the right-click gesture; its
   action context menu can provide Open manager, rather than intercepting it.
   Sidebar folders contain no bookmark rows. Expanded main-pane folders use the
   same bookmark rows, counts and selection model as other results. Domain filters
   cover subfolders even before search. Advanced filters open on demand.
3. Pending: remaining visual polish, searchable destination picker, advanced
   filters and contextual controls, matching the approved navy/violet previews.

Validation uses synthetic bookmarks and isolated browser profiles. Native
toolbar-popup hosting still requires a manual check after extension reload.
