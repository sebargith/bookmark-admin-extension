# Local Bookmark Admin

A personal Chrome Manifest V3 extension for managing a dedicated Chrome bookmark folder from a compact save popup and movable page overlay.

## Install locally

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the extension source folder.

Chrome will create a managed bookmark root named `Bookmark Admin`. Clicking the pinned extension icon opens a compact save popup under the toolbar icon. Choose a folder, save, create a folder, or open the movable full manager overlay.

## Main features

- Save the current page from the compact toolbar popup, page context menu, or `Alt+Shift+B`.
- Choose the target folder before saving, with a compact `New` folder action.
- Open the movable full manager overlay from the compact popup, page context menu, or `Alt+Shift+M`.
- Blur the page behind the manager overlay and close it by clicking outside or pressing `Esc`.
- Create folders and move bookmarks or folders by drag and drop.
- Search title, URL, folder path, saved notes, and automatically extracted page keywords.
- Filter bookmarks by time added, link status, and usage; sort by newest, oldest, title, or use count.
- Store generated keywords, notes, open counts, and dead-link status in extension local storage.
- Detect duplicates before saving and update metadata instead of creating another copy.
- Expand folders into deployable lists that show subfolders and bookmarks inline.
- Right-click folders and bookmarks, or use their `...` buttons, for move, rename, notes, delete, check, sort, and re-index actions.
- Notes auto-save from the detail compartment.
- Export the managed tree as JSON or Chrome bookmark HTML.
- Undo the latest delete, move, rename, or sort action.
- Refresh when Chrome bookmark changes are made outside the manager.

## Permissions

The extension asks for:

- `bookmarks`: read and organize Chrome bookmarks.
- `contextMenus`: add quick-save and open-manager menu items.
- `scripting`: inject the movable full manager overlay into the active page.
- `storage`: store tags, notes, usage stats, undo state, and change notices.
- `tabs`: read the active tab when saving the current page.
- `http://*/*` and `https://*/*`: index saved pages and check bookmark URLs for dead-link status.

## Notes

This is built for personal/local use. The real bookmarks live in Chrome's bookmark system under the `Bookmark Admin` folder, so normal Chrome bookmark sync can sync those bookmark folders and URLs. Extra metadata such as notes, generated search keywords, dead-link status, and open counts is stored locally by the extension.

The extension does not send bookmark data to a third-party service. Page indexing fetches saved pages without credentials and stores only compact keyword metadata locally.

The full manager overlay can run on normal `http` and `https` pages. Chrome does not allow extension content scripts on internal pages such as `chrome://extensions`.
