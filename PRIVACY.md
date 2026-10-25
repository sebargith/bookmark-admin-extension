# Privacy

Local Bookmark Admin is designed to keep bookmark data local to Chrome.

## Data Stored

- Chrome bookmarks are stored in Chrome's native bookmark system.
- Notes, generated search keywords, link-check status, open counts, and undo metadata are stored in `chrome.storage.local`.
- Generated search keywords are compact metadata, not full saved page copies.
- `Save all windows` copies tab titles and URLs into native bookmarks, one numbered bookmarks-bar folder per window. It excludes incognito windows and does not fetch page content or store a separate tab history.
- The manager reads Chrome's complete bookmark tree to provide Library, Saved Windows, and All Bookmarks views. Navigation does not send bookmark data over the network.
- The floating manager uses a closed shadow root to prevent direct DOM inspection of its contents by ordinary webpage scripts. The standalone manager runs on the extension's own page.

## Network Access

- The extension fetches saved pages only to generate local search keywords.
- Page indexing uses `credentials: "omit"`, so cookies and logged-in session credentials are not sent with indexing requests.
- Link checking sends normal `HEAD` or small `GET` requests to the bookmark URLs being checked.
- The extension does not send bookmark data, notes, or generated metadata to a third-party service.

## Sync

Chrome can sync the native bookmark folders and URLs if Chrome Sync is enabled. Extension-local metadata is not intentionally uploaded by this extension.
