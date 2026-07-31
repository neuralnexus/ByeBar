# ByeBar Standards

Architecture, quality gates, and contributor workflow.

## Browser support

| Platform              | Minimum version | Notes                              |
| --------------------- | --------------- | ---------------------------------- |
| Chrome / Edge         | 109+            | Load `dist/stage/chrome`           |
| Firefox               | 115+            | Load `dist/stage/firefox`          |
| Safari (macOS)        | 16.4+           | Build via `npm run build:safari`   |
| Safari (iOS / iPadOS) | 16.4+           | Same Xcode project; syncs from Mac |

## Architecture

### Content script load order

Defined in `manifest.json` (global bundle, `document_start`):

```
shared/runtime.generated.js → canonical ByeBar.lib + settings bundle
shared/browser.js       → ByeBar.browser (storage, tabs API)
shared/substack-detect.js
content/safari-compat.js
content/selectors.js    → SITE_RULES, selector registries
content/shadow.js       → shadow DOM query helpers
content/visibility.js   → reversible hiding and scroll handling
content/actions.js      → action ledger, Undo, focus safety, diagnostics
content/engine.js       → validation engine, scoped mutation observer
content/cookies.js
content/tos.js
content/china-commerce.js
content/main.js         → boot + timed retries
```

The content script declaration has `all_frames: false`; embedded frames are not processed. The only injected stylesheet is `content/styles.css`; it targets engine-applied marker attributes, never raw site selectors.

### Data flow

```
popup.js → versioned messages → service-worker.js (sole settings writer)
                                  ↓ settings: storage.local
content scripts read global + host feature settings on load/change
        ↓
engine validates selector candidates with text + layout
        ↓
nukeAll() + cookies.decline() + optional tos.accept()
        ↓
actions + visibility preserve marker-hidden nodes for restoration/Undo

diagnostics preference → storage.local
decision metadata      → current page memory only
```

### Architecture rules

1. **Cross-browser API** ; use `shared/browser.js` (`ByeBar.browser`) instead of calling `chrome.*` directly.
2. **Safari selectors** ; run dynamic selectors through `content/safari-compat.js` before `querySelector(All)`.
3. **Marker CSS only** ; never add raw site, class, or vendor selectors to CSS. Settings-aware JavaScript must validate and mark each hidden element.
4. **Site-specific before generic** ; add targeted candidates under `content/selectors.js` (`SITE_RULES`) before widening generic heuristics.
5. **Canonical logic in `lib/`** ; regexes, host checks, settings, and text heuristics belong in `lib/*.mjs` with Vitest coverage. Export them from `src/classic-runtime.mjs`, run `npm run build:runtime`, and consume them through `ByeBar.lib`; do not duplicate or hand-edit generated logic.
6. **Not an ad blocker** ; do not block ads, trackers, or network requests. DOM-only overlay/popup removal.

## Adding a new site rule

### 1. Identify the pattern

Capture from DevTools:

- Stable selectors (IDs, `data-testid`, CMP root nodes)
- Hostname pattern (`*.example.com` vs global CMP)
- Whether a close/reject action is required for the site to clean up its own state
- Whether the overlay injects late (needs mutation observer / retry ; already handled by `main.js`)

### 2. Register selectors

In `content/selectors.js`, add or extend a `SITE_RULES` entry:

```js
mySite: {
  hosts: [/\.example\.com$/i],
  remove: ['#overlay-root']  // candidate list consumed by the engine
}
```

For global patterns (any host), add to `GENERIC_REMOVE` / `GENERIC_HIDE` or the cookie/TOS lists.

Wire site rules into a host-limited engine pass and validate candidates before calling `ByeBar.visibility.hide()`.

### 3. Keep CSS scoped

Do not add raw selectors to `content/styles.css` or a site-specific stylesheet. Only the settings-aware engine may apply `data-byebar-hidden`, with a feature reason that can later be restored.

### 4. Add heuristics (when selectors are unstable)

Create `lib/mysite-heuristics.mjs`:

```js
export function looksLikeMyOverlay(el) {
  /* ... */
}
```

Add `test/mysite-heuristics.test.mjs`, export the module from `src/classic-runtime.mjs`, and run `npm run build:runtime`. Call the generated `ByeBar.lib` export from the relevant content script (`engine.js`, `cookies.js`, etc.).

### 5. Cookie / CMP modules

For consent platforms, extend `content/cookies.js`:

- Exact `COOKIE_HIDE` roots and `COOKIE_DECLINE_SELECTORS` in `selectors.js`
- A confirmed banner ancestor for every control click

### 6. Validate and smoke-test

```bash
npm run build:runtime
npm run validate
npm run test:e2e
```

Manual checks:

- Only the intended overlay receives `data-byebar-hidden`
- Inline forms, account dialogs, navigation, and paywalls remain usable
- Disabling the feature or site removes ByeBar's marker without a reload
- Scroll remains usable without deleting site classes or inline styles
- Decline button clicked when cookie setting is on
- Whole-site and individual feature overrides inherit/reset correctly
- Undo restores only the latest reversible hide; cookie/legal/site clicks remain irreversible
- Diagnostics record metadata without page text and clear decisions on reload
- Same-origin and cross-origin iframe contents remain untouched

## Quality gates (required before merge)

```bash
npm ci
npm run icons
npm run validate
npx playwright install chromium
npm run test:e2e
npm run validate:packages
```

`npm run validate` checks generated runtime freshness and runs:

- manifest asset checks (`scripts/validate-manifest.mjs`)
- ESLint
- Prettier check
- Vitest unit tests

`npm run test:e2e` runs the persistent Chromium extension suite. `npm run validate:packages` stages, lints, builds, and verifies Chrome and Firefox ZIPs. On a machine with full Xcode, `npm run validate:safari` converts the clean Safari stage and performs a no-sign macOS build.

## Tests

| Area                 | Test file                                 | Notes                                                                                    |
| -------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Cookie CMP detection | `test/cookie-heuristics.test.mjs`         | CookieYes, Usercentrics, Didomi, Sourcepoint, Funding Choices, iubenda, Ketch, Complianz |
| Substack modals      | `test/substack-heuristics.test.mjs`       | Radix signup dialogs                                                                     |
| Bloomberg promos     | `test/bloomberg-heuristics.test.mjs`      | Flash sale strips                                                                        |
| China commerce       | `test/china-commerce-heuristics.test.mjs` | Spinner wheels                                                                           |
| TOS modals           | `test/tos-heuristics.test.mjs`            | Bloomberg CMP                                                                            |
| Generic overlays     | `test/overlay-heuristics.test.mjs`        | Promotional text + geometry; inline/functional negatives                                 |
| Extension scope      | `test/extension-scope.test.mjs`           | Marker-only CSS and unrelated behavior exclusions                                        |
| Host / settings      | `test/host.test.mjs`                      | Per-site overrides                                                                       |
| Manifest             | `test/manifest.test.mjs`                  | MV3 structure                                                                            |
| Worker protocol      | `test/service-worker.test.mjs`            | Serialization, migration, validation, storage errors, and quotas                         |
| Target manifests     | `test/staging.test.mjs`                   | Chrome, Firefox, and Safari background shapes                                            |

Playwright runs automated browser coverage for overlay negatives, trusted interaction, settings restoration, consent safety, focus/inert behavior, open Shadow DOM, late class activation, top-frame scope, mutation batching, and popup Undo/diagnostics.

Live-site manual checks still include:

- Substack Radix “Join … on Substack” modal + scrim
- TrustArc CCPA opt-out (Reltio, IBM, ServiceNow)
- Didomi on orange.jobs
- Generic newsletter modal on an unknown site
- Bloomberg TOS + flash sale promo

## Versioning

- Bump `manifest.json` `version` and `package.json` `version` together.
- Tag releases after manual smoke test in Chrome + one secondary browser.

## Permissions rationale

| Permission        | Why                                                               |
| ----------------- | ----------------------------------------------------------------- |
| `storage`         | Global/per-site settings and local diagnostics preference         |
| `activeTab`       | Popup reads the active tab hostname                               |
| `<all_urls>` host | Content scripts run in eligible top-level pages to catch overlays |

No `webRequest`, `declarativeNetRequest`, or broad history access ; ByeBar does not intercept network traffic.
