# Local Bookmark Admin

A personal Chrome Manifest V3 extension for managing Chrome bookmarks from a compact save popup and movable manager.

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
- Save all open Chrome windows into separate numbered folders on the bookmarks bar with `Save all windows`.
- Switch between Library, Saved Windows, and All Bookmarks without copying or moving bookmarks.
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
- `tabs`: read tab titles and URLs when saving the current page or all open windows.
- `http://*/*` and `https://*/*`: index saved pages and check bookmark URLs for dead-link status.

## Notes

The manager has three views:

- **Library** shows the existing `Bookmark Admin` folder and its descendants. The compact popup still saves into this library.
- **Saved Windows** shows `nuevoX` folders directly on either local or account bookmarks bars. A matching folder moved elsewhere or renamed without its `nuevoX` name remains available in All Bookmarks.
- **All Bookmarks** shows the complete native tree, including other, mobile, and managed bookmarks supplied by Chrome. Chrome's special folders and read-only managed nodes are protected.

Navigation counts represent bookmarks. Search and date/status filters apply within the active view and selected folder. Export includes that view or folder, regardless of search filters. Changes made in Chrome update the open manager automatically. These views do not create extra copies or move existing bookmarks. See [ROADMAP.md](ROADMAP.md) for upcoming improvements.

Exports started from the floating manager open a dedicated extension-owned tab. The download is created there, so its contents and download link are not inserted into the underlying website. No additional permissions are required.

`Save all windows` creates one folder per non-incognito window directly on the bookmarks bar, named `nuevo1`, `nuevo2`, and so on. It continues after the highest existing numbered folder on that bar (including names such as `nuevo 6`), preserves tab order and repeated URLs, and leaves the windows open. If Chrome exposes both account and local bookmarks bars, it uses the bar with the highest existing `nuevo` number, preferring the account bar when tied. These folders appear in the manager's Saved Windows and All Bookmarks views. The action makes no page-indexing requests. Unsupported or unavailable tab URLs are skipped and failures are reported in the popup. Closing the popup does not cancel a capture already started in the background.

This is built for personal/local use. The real bookmarks live in Chrome's bookmark system under the `Bookmark Admin` folder, so normal Chrome bookmark sync can sync those bookmark folders and URLs. Extra metadata such as notes, generated search keywords, dead-link status, and open counts is stored locally by the extension.

The extension does not send bookmark data to a third-party service. Page indexing fetches saved pages without credentials and stores only compact keyword metadata locally.

The full manager overlay can run on normal `http` and `https` pages. Chrome does not allow extension content scripts on internal pages such as `chrome://extensions`.

## Development checks

Run `node --test` for synthetic Chrome API tests. Run `node tests/manager-ui.browser.cjs` with Playwright available and Chrome installed for interface checks and screenshots. An external Playwright module can be selected through `BOOKMARK_TEST_PLAYWRIGHT`; `BOOKMARK_TEST_ARTIFACTS` sets the screenshot directory. Browser checks use synthetic bookmark APIs in an isolated browser context; they do not access a personal Chrome profile or verify installation as a loaded extension.
