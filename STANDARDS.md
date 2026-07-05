# ByeBar Standards

## Browser support

| Platform              | Minimum version | Notes                              |
| --------------------- | --------------- | ---------------------------------- |
| Chrome / Edge         | 109+            | Load unpacked from repo root       |
| Firefox               | 109+            | MV3 temporary or signed add-on     |
| Safari (macOS)        | 16.4+           | Build via `npm run build:safari`   |
| Safari (iOS / iPadOS) | 16.4+           | Same Xcode project; syncs from Mac |

## Architecture rules

1. **Cross-browser API** — use `shared/browser.js` (`ByeBar.browser`) instead of calling `chrome.*` directly.
2. **Safari selectors** — run dynamic selectors through `content/safari-compat.js` before `querySelector(All)`.
3. **CSS** — prefer ID/class selectors; duplicate case variants in `content/styles-safari.css` when needed.
4. **Site-specific logic** — add targeted rules under `content/selectors.js` (`SITE_RULES`) before expanding generic heuristics.
5. **Not an ad blocker** — do not block ads, trackers, or network requests; DOM-only overlay/popup removal.

## Quality gates (required before merge)

```bash
npm ci
npm run icons
npm run validate
```

`npm run validate` runs:

- manifest asset checks
- ESLint
- Prettier check
- Vitest unit tests

## Tests

- Pure logic lives in `lib/*.mjs` and is covered by Vitest (`test/`).
- Integration/manual checks: Substack scrim, TrustArc opt-out (Reltio/IBM/ServiceNow), generic newsletter modal.

## Versioning

- Bump `manifest.json` `version` and `package.json` `version` together.
- Tag releases after manual smoke test in Chrome + one secondary browser.
