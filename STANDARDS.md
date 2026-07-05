# ByeBar Standards

Architecture, quality gates, and contributor workflow.

## Browser support

| Platform              | Minimum version | Notes                              |
| --------------------- | --------------- | ---------------------------------- |
| Chrome / Edge         | 109+            | Load unpacked from repo root       |
| Firefox               | 109+            | MV3 temporary or signed add-on     |
| Safari (macOS)        | 16.4+           | Build via `npm run build:safari`   |
| Safari (iOS / iPadOS) | 16.4+           | Same Xcode project; syncs from Mac |

## Architecture

### Content script load order

Defined in `manifest.json` (global bundle, `document_start`):

```
shared/browser.js       → ByeBar.browser (storage, tabs API)
content/safari-compat.js
content/geolocation.js  → early API patch
content/netsuite-lead.js
content/selectors.js    → SITE_RULES, selector registries
content/shadow.js       → shadow DOM query helpers
content/engine.js       → removal engine, mutation observer
content/cookies.js
content/tos.js
content/china-commerce.js
content/main.js         → boot + timed retries
```

Site-specific CSS is injected via separate `content_scripts` entries (Substack, Bloomberg, China commerce).

### Data flow

```
popup.js / service-worker.js
        ↓ storage.sync
content scripts read settings on load
        ↓
engine.buildSelectors() → active selector list
        ↓
nukeAll() + cookies.decline() + tos.accept() + site modules
        ↓
MutationObserver re-runs on DOM changes
```

### Architecture rules

1. **Cross-browser API** — use `shared/browser.js` (`ByeBar.browser`) instead of calling `chrome.*` directly.
2. **Safari selectors** — run dynamic selectors through `content/safari-compat.js` before `querySelector(All)`.
3. **CSS first** — add hide rules to CSS for instant suppression at `document_start`; JS removal is the backup.
4. **Site-specific before generic** — add targeted rules under `content/selectors.js` (`SITE_RULES`) before widening generic heuristics.
5. **Testable logic in `lib/`** — regexes, host checks, and text heuristics belong in `lib/*.mjs` with Vitest coverage; content scripts duplicate the runtime logic.
6. **Not an ad blocker** — do not block ads, trackers, or network requests. DOM-only overlay/popup removal.

## Adding a new site rule

### 1. Identify the pattern

Capture from DevTools:

- Stable selectors (IDs, `data-testid`, CMP root nodes)
- Hostname pattern (`*.example.com` vs global CMP)
- Whether CSS-only hide is enough, or click-to-decline is required (cookies)
- Whether the overlay injects late (needs mutation observer / retry — already handled by `main.js`)

### 2. Register selectors

In `content/selectors.js`, add or extend a `SITE_RULES` entry:

```js
mySite: {
  hosts: [/\.example\.com$/i],
  hide: ['#overlay-root'],   // CSS + engine remove list
  remove: ['#overlay-root']  // engine-only (can match hide)
}
```

For global patterns (any host), add to `GENERIC_REMOVE` / `GENERIC_HIDE` or the cookie/TOS lists.

Wire site rules into `engine.js` `buildSelectors()` if a new `SITE_RULES` key is added (follow the `isSubstack()` / `isBloomberg()` pattern).

### 3. Add CSS

- **All sites:** `content/styles.css`
- **One host group:** dedicated `content/mysite.css` + new `content_scripts` entry in `manifest.json` (see Substack/Bloomberg)
- **Safari WebKit gaps:** duplicate case variants in `content/styles-safari.css`

### 4. Add heuristics (when selectors are unstable)

Create `lib/mysite-heuristics.mjs`:

```js
export function looksLikeMyOverlay(el) {
  /* ... */
}
```

Add `test/mysite-heuristics.test.mjs`. Mirror logic in the relevant content script (`engine.js`, `cookies.js`, etc.).

### 5. Cookie / CMP modules

For consent platforms, extend `content/cookies.js`:

- `COOKIE_HIDE` / `COOKIE_DECLINE_SELECTORS` in `selectors.js`
- `looksLikeCookieBanner()` class/id checks
- Vendor API fallback (e.g. `Didomi.setUserDisagreeToAll()`, `UC_UI.denyAllConsents()`)
- `hookVendorOnReady()` if the CMP exposes a ready callback

### 6. Validate and smoke-test

```bash
npm run validate
```

Manual checks:

- Overlay hidden on first paint (CSS)
- Overlay removed after JS injection (engine pass)
- Scroll unlocked (`overflow: hidden` cleared)
- Decline button clicked when cookie setting is on
- Per-site disable in popup works

## Quality gates (required before merge)

```bash
npm ci
npm run icons
npm run validate
```

`npm run validate` runs:

- manifest asset checks (`scripts/validate-manifest.mjs`)
- ESLint
- Prettier check
- Vitest unit tests

## Tests

| Area                 | Test file                                 | Notes                                                                                    |
| -------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Cookie CMP detection | `test/cookie-heuristics.test.mjs`         | CookieYes, Usercentrics, Didomi, Sourcepoint, Funding Choices, iubenda, Ketch, Complianz |
| Cookie CMP APIs      | `test/cookie-cmp.test.mjs`                | Sourcepoint, Cookiebot, Quantcast, iubenda, OneTrust, Ketch                              |
| Substack modals      | `test/substack-heuristics.test.mjs`       | Radix signup dialogs                                                                     |
| Bloomberg promos     | `test/bloomberg-heuristics.test.mjs`      | Flash sale strips                                                                        |
| China commerce       | `test/china-commerce-heuristics.test.mjs` | Spinner wheels                                                                           |
| TOS modals           | `test/tos-heuristics.test.mjs`            | Bloomberg CMP                                                                            |
| NetSuite leads       | `test/netsuite-lead.test.mjs`             | extforms redirect                                                                        |
| Geolocation          | `test/geolocation.test.mjs`               | Settings + API patch                                                                     |
| Host / settings      | `test/host.test.mjs`                      | Per-site overrides                                                                       |
| Manifest             | `test/manifest.test.mjs`                  | MV3 structure                                                                            |

Integration/manual checks (no automated test yet):

- Substack Radix “Join … on Substack” modal + scrim
- TrustArc CCPA opt-out (Reltio, IBM, ServiceNow)
- Didomi on orange.jobs
- Generic newsletter modal on an unknown site
- Bloomberg TOS + flash sale promo

## Versioning

- Bump `manifest.json` `version` and `package.json` `version` together.
- Tag releases after manual smoke test in Chrome + one secondary browser.

## Permissions rationale

| Permission        | Why                                                |
| ----------------- | -------------------------------------------------- |
| `storage`         | User settings and per-site overrides               |
| `activeTab`       | Popup reads the active tab hostname                |
| `<all_urls>` host | Content scripts run on all pages to catch overlays |

No `webRequest`, `declarativeNetRequest`, or broad history access — ByeBar does not intercept network traffic.
