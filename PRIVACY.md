# Privacy

Local Bookmark Admin is designed to keep bookmark data local to Chrome.

## Data Stored

- Chrome bookmarks are stored in Chrome's native bookmark system.
- Notes, generated search keywords, link-check status, open counts, and undo metadata are stored in `chrome.storage.local`.
- Generated search keywords are compact metadata, not full saved page copies.
- Bookmark selections and batch-preview drafts are held only in manager memory and discarded when it closes. Confirmed native batch mutations store the same local undo metadata used by other move, rename and delete actions. Previewing a rename does not fetch pages or change native bookmarks.
- The manager stores its active view, selected native folder IDs per view, and expanded folder IDs in `chrome.storage.local`. Navigation memory does not include page contents, search queries, or a separate browsing history, and is independent of the popup save destination.
- The popup retains up to four recently chosen native folder IDs locally and displays the two most recent available destinations. Folder search queries are kept only in popup memory. Automatic saving and folder moves do not fetch page content.
- `Save all windows` copies tab titles and URLs into native bookmarks, one numbered bookmarks-bar folder per window. It excludes incognito windows and does not fetch page content or store a separate tab history.
- Recognized saved-window folder IDs, capture timestamps, and original saved-tab counts are stored locally. Source Chrome window IDs are not retained. Older numbered folders use their native creation date when the actual capture time is unknown. This local identity metadata is not synced by the extension.
- The manager reads Chrome's complete bookmark tree to provide Library, Saved Windows, and All Bookmarks views. Navigation does not send bookmark data over the network.
- The floating manager uses a closed shadow root to prevent direct DOM inspection of its contents by ordinary webpage scripts. The standalone manager runs on the extension's own page.
- Floating-manager exports are generated in a separate extension-owned page, which is not web-accessible. Bookmark content and backup download URLs are not inserted into the host webpage.

## Network Access

- The extension fetches saved pages only to generate local search keywords.
- Page indexing uses `credentials: "omit"`, so cookies and logged-in session credentials are not sent with indexing requests.
- Link checking sends normal `HEAD` or small `GET` requests to the bookmark URLs being checked.
- Reopening a saved window is an explicit, confirmed action that opens normal http/https tabs through Chrome. Those pages load normally and can use browser cookies and signed-in sessions; this is distinct from credential-free background indexing. Internal, local-file, script, and other non-web URLs are not reopened by this action.
- The extension does not send bookmark data, notes, or generated metadata to a third-party service.

## Sync

Chrome can sync the native bookmark folders and URLs if Chrome Sync is enabled. Extension-local metadata is not intentionally uploaded by this extension.
