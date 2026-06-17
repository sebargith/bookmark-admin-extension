# Security

## Supported Use

This extension is intended for local, personal Chrome use as an unpacked extension.

## Permissions Rationale

- `bookmarks`: create, move, rename, delete, and read Chrome bookmarks under the managed bookmark root.
- `contextMenus`: expose save and manager actions from page and link right-click menus.
- `scripting`: inject the full manager overlay into the active page when requested.
- `storage`: store local metadata such as notes, generated keywords, open counts, and undo state.
- `tabs`: read the active tab title and URL for save actions.
- `http://*/*` and `https://*/*`: index saved pages and check bookmark URLs.

## Security Boundaries

- The manager overlay is injected only when the user opens the full manager.
- Page indexing omits credentials.
- No remote analytics, telemetry, or third-party API calls are used.
- No secrets, tokens, local user paths, or account identifiers should be committed to this repository.

## Reporting

For a personal fork, open a private issue or patch the affected file directly before publishing updates.
