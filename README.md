# ByeBar

**Overlay & popup blocker for Chrome, Firefox, and Safari.**

Website: [byebar.mattivan.com](https://byebar.mattivan.com/)

ByeBar removes or dismisses UI clutter that gets between you and the page: supported newsletter prompts, subscribe bars, email-capture overlays, cookie consent controls, coupon spinners, and similar interruptions. It works entirely in the DOM ; it does not block ads, trackers, or network requests.

## Table of contents

- [How it works](#how-it-works)
- [Features](#features)
- [Site coverage](#site-coverage)
- [Browser support](#browser-support)
- [Install](#install-chrome--edge--firefox)
- [Settings](#settings)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Contributing](#contributing)
- [What ByeBar is not](#what-byebar-is-not)

## How it works

ByeBar is a Manifest V3 extension that injects content scripts at `document_start` into eligible top-level pages. It does not inspect or modify embedded frame contents.

1. **Settings gate** ; no page changes run until global and per-site settings have loaded.
2. **Candidate pass** ; selectors identify possible overlays, but generic candidates must also have promotional text and modal/fixed-position geometry.
3. **Interaction pass** ; cookie and optional legal handlers act only on visible controls inside confirmed dialogs, then let the site clean up its own modal state.
4. **Reversible hide** ; confirmed elements stay in the DOM with a `data-byebar-hidden` marker, so disabling the relevant setting or using Undo can restore them without reloading. Site button clicks are intentionally not described as reversible.
5. **Mutation observer** ; watches changed subtrees for late-injected overlays instead of repeatedly rescanning every page element and style change.

```
document_start
  ├── runtime.generated.js  (canonical lib/*.mjs bundle)
  ├── styles.css             (marker styles only)
  └── main.js → actions + settings → engine, cookies, tos, china-commerce
        └── scoped MutationObserver + timed retries + reversible ledger
```

## Features

| Feature                         | What it does                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Generic overlay blocking**    | Removes supported newsletter nags, subscribe prompts, and email popups when text and layout agree  |
| **Auto-decline cookie banners** | Clicks visible reject/deny controls inside confirmed CMP banners and lets the CMP close itself     |
| **Optional legal dialogs**      | Can accept confirmed legal/TOS popups; disabled by default                                         |
| **Reversible marker hides**     | Hides matched elements without deleting DOM nodes and supports Undo for the latest reversible hide |
| **On-demand page sweep**        | Reruns the same conservative rules and reports each direct action or that no safe action ran       |
| **Site-specific rules**         | Targeted, host-limited heuristics for known offenders                                              |
| **Per-site feature controls**   | Inherit or override each global feature for the current host                                       |
| **Local diagnostics**           | Optionally shows rule/result metadata in page memory without recording page text or telemetry      |

Open the toolbar popup to toggle behavior globally or per-site, or use **Sweep page** for a fresh pass. Press `Ctrl+Shift+Y` (`Command+Shift+Y` on macOS) to Sweep without opening the popup; remap it in your browser's extension-shortcut settings where supported.

## Site coverage

### Dedicated site modules

| Sites                                        | Module                | Examples handled                                              |
| -------------------------------------------- | --------------------- | ------------------------------------------------------------- |
| `*.substack.com` and Substack custom domains | `engine.js`           | Confirmed signup dialogs and their full-page scrims           |
| `*.bloomberg.*`                              | `engine.js`, `tos.js` | Promotional strips and optional TOS consent                   |
| Temu, Shein, AliExpress, Taobao, JD, etc.    | `china-commerce.js`   | Coupon wheels and lottery overlays with matching spinner copy |

### Cookie / consent platforms (global)

Auto-decline is implemented for top-document and open-shadow-root variants of common CMPs. Controls inside vendor iframes are outside ByeBar's top-frame scope. ByeBar acts only while a banner is visible and never treats a generic close/hide action as consent rejection:

| CMP                                                                                               | Visible decline control                  |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Sourcepoint**                                                                                   | `sp_choice_type_11`, Reject All          |
| **Google Funding Choices**                                                                        | `.fc-cta-do-not-consent`                 |
| **OneTrust**                                                                                      | `#onetrust-reject-all-handler`           |
| **CookieYes**                                                                                     | `[data-cky-tag="reject-button"]`         |
| **Cookiebot**                                                                                     | `#CybotCookiebotDialogBodyButtonDecline` |
| **Quantcast**                                                                                     | `.qc-cmp2-summary-buttons` secondary     |
| **Usercentrics**                                                                                  | `uc-deny-all-button`                     |
| **TrustArc / Truste**                                                                             | CCPA opt-out button                      |
| **Didomi**                                                                                        | disagree / continue-without              |
| **iubenda**                                                                                       | `.iubenda-cs-reject-btn`                 |
| **Ketch**                                                                                         | `#ketch-banner-button-secondary`         |
| **Termly**, **Borlabs**, **Complianz**, **consentmanager.net**, **Moove GDPR**, **Cookie Notice** | vendor decline selectors                 |

Generic cookie-banner heuristics still catch long-tail CMPs not listed above.

### Generic heuristics (all sites)

When **Block promotional popups & bars** is enabled, ByeBar hides modal or fixed/sticky candidates whose text also matches newsletter/signup/discount patterns. Inline forms, navigation, account dialogs, paywalls, and subscription-management UI are intentionally left alone.

## Browser support

| Browser              | Minimum version | Install                                          |
| -------------------- | --------------- | ------------------------------------------------ |
| Chrome / Edge        | 109+            | [Load unpacked](#install-chrome--edge--firefox)  |
| Firefox              | 115+            | [Staged temporary add-on or package](FIREFOX.md) |
| Safari (macOS / iOS) | 16.4+           | [SAFARI.md](SAFARI.md)                           |

## Install (Chrome / Edge / Firefox)

### Chrome Web Store

Install ByeBar from the [Chrome Web Store](https://chromewebstore.google.com/detail/byebar-overlay-popup-bloc/dnmnddkflabkeclpkcpnkiilljedkhdi). Publishing checklist and store listing copy: [CHROME_WEB_STORE.md](CHROME_WEB_STORE.md). Build the upload zip with:

```bash
npm run build:store
```

### Load unpacked (development)

1. Clone, install dependencies, and generate the runtime/assets:

   ```bash
   git clone https://github.com/neuralnexus/ByeBar.git
    cd ByeBar
    npm ci
    npm run build:runtime
    npm run icons
   ```

2. Create a browser-specific stage:

   ```bash
   npm run stage:chrome
   npm run stage:firefox
   ```

3. Load the extension:
   - **Chrome / Edge:** `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist/stage/chrome`.
   - **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `dist/stage/firefox/manifest.json`.

4. Rebuild the runtime/stage and reload the extension after pulling updates, then refresh open tabs.

For Safari, see [SAFARI.md](SAFARI.md).

## Settings

Open the popup from the toolbar:

| Setting                         | Global default | Description                                                              |
| ------------------------------- | -------------- | ------------------------------------------------------------------------ |
| Enabled                         | On             | Global gate with an optional positive or negative override for each host |
| Block promotional popups & bars | On             | Text-and-layout-validated promotional overlays                           |
| Auto-decline cookie banners     | On             | Reject through visible controls inside confirmed CMP banners             |
| Auto-accept legal dialogs       | Off            | Click through confirmed TOS/legal modals; this action cannot be undone   |

Use **This site** to inherit or override each setting for the current host. **Global defaults** changes the values inherited by sites without an override. **Use global defaults** clears every override for the current host.

Global defaults, hostname-keyed site overrides, and the diagnostics preference stay in device-local extension storage. Diagnostic decisions contain only rule/result metadata, live in page memory, and clear on reload; no page text or telemetry is recorded. **Sweep page** reruns the enabled safe rules without broadening what ByeBar may act on and reports counts for direct actions from that pass. **Undo hide** restores only the latest marker-based hide in the current document. Cookie, legal, and site close-button clicks cannot be undone.

## Troubleshooting

**Overlay still appears briefly, then disappears**  
Expected for late-injected modals. ByeBar retries at 500 ms, 1.5 s, 4 s, and 8 s. If it never clears, file an issue with the site URL and a DOM snippet.

**ByeBar does nothing on a site**  
Check **Enabled on this site** and each feature under **This site**. Use **Use global defaults** to clear stale whole-site or per-feature overrides. ByeBar intentionally does not process overlays inside iframes.

**The Sweep shortcut does nothing**

Reload the page after installing or updating ByeBar, then confirm the shortcut is assigned in your browser's extension-shortcut settings. Browser-internal pages and extension stores do not allow ByeBar content scripts.

**Cookie banner keeps returning**  
Some CMPs re-inject on interaction. Ensure **Auto-decline cookie banners** is on. Didomi/Usercentrics sites may need a new rule ; see [Contributing](#contributing).

**Page scroll is stuck after a modal**  
ByeBar applies a temporary CSS overflow override while a confirmed hidden modal is the only open dialog. It does not delete site classes or inline styles; disable ByeBar on the site if a non-standard lock remains.

**Firefox temporary add-on disappears**  
Re-load `manifest.json` from `about:debugging` after each browser restart.

## Development

```bash
npm ci
npm run icons      # generate brand and toolbar sizes from icons/*.svg
npm run build:runtime
npm run validate   # generated runtime + manifest + lint + format + Vitest
npm run test       # vitest watch mode
npx playwright install chromium
npm run test:e2e   # persistent Chromium extension tests
npm run validate:packages
npm run lint:fix   # auto-fix eslint issues
npm run format     # prettier write
npm run build:safari
```

### Project layout

```
background/   Settings owner and versioned message protocol
content/      Content scripts, CSS, site modules
  engine.js   Settings, validated overlay passes, scoped mutation observer
  actions.js  Action ledger, Undo, focus safety, local diagnostics
  visibility.js  Reversible hiding and scroll-lock override
  cookies.js  Confirmed visible Cookie CMP decline controls
  tos.js      Terms-of-service auto-accept
  selectors.js  SITE_RULES, GENERIC_REMOVE, COOKIE_* lists
  main.js     Entry point, timed retries
lib/          Testable heuristics (*.mjs)
src/          Entry point for the generated classic runtime
test/         Vitest unit tests
e2e/          Playwright fixtures and extension integration tests
popup/        Toolbar popup UI
shared/       Generated runtime and cross-browser WebExtension API shim
scripts/      Runtime generation, target staging, validation, and packaging
```

### Heuristic modules (`lib/`)

| Module                          | Purpose                                   |
| ------------------------------- | ----------------------------------------- |
| `cookie-heuristics.mjs`         | CookieYes, Usercentrics, Didomi detection |
| `overlay-heuristics.mjs`        | Generic text, layout, and geometry checks |
| `substack-heuristics.mjs`       | Radix/pencraft Substack signup modals     |
| `bloomberg-heuristics.mjs`      | Bloomberg promo strips                    |
| `china-commerce-heuristics.mjs` | Coupon spinner / lottery wheels           |
| `tos-heuristics.mjs`            | Terms-of-service modal text               |
| `host.mjs`                      | Host normalization, per-site enablement   |
| `constants.mjs`                 | Shared regexes and default settings       |

Pure logic lives in `lib/` and is tested with Vitest. `scripts/build-runtime.mjs` bundles that canonical logic through `src/classic-runtime.mjs` into `shared/runtime.generated.js` for classic extension contexts. Do not edit the generated runtime by hand; run `npm run build:runtime` after changing `lib/`.

CI runs source validation, staged Chrome Playwright tests, Chrome/Firefox package validation, Firefox lint, and a no-sign Safari conversion/build on pushes and pull requests.

## Contributing

See [STANDARDS.md](STANDARDS.md) for architecture rules and a step-by-step guide to adding site-specific blocking.

Quick checklist for a new overlay type:

1. Add candidate selectors to `content/selectors.js` (`SITE_RULES` or `GENERIC_REMOVE`).
2. Keep selector CSS out of `content/styles.css`; only validated elements receive the shared hide marker.
3. Add heuristics in `lib/*.mjs` + tests in `test/`.
4. Wire removal/decline logic in the appropriate content script (`engine.js`, `cookies.js`, etc.).
5. Run `npm run build:runtime`, `npm run validate`, and `npm run test:e2e`, then manually smoke-test on the target site.

Pull requests welcome at [github.com/neuralnexus/ByeBar](https://github.com/neuralnexus/ByeBar).

## What ByeBar is not

ByeBar is **not an ad blocker**. It does not filter network traffic, block trackers, or remove on-page ads. It is a focused tool that removes or dismisses annoying overlay UIs: modals, banners, nags, and consent popups, etc (things normal ad-blockers allow through, but are still annoying!)

## Related docs

- [DOMAIN.md](DOMAIN.md) ; custom domain setup for the landing site
- [CHROME_WEB_STORE.md](CHROME_WEB_STORE.md) ; Chrome Web Store publishing
- [FIREFOX.md](FIREFOX.md) ; Firefox staging, linting, and packaging
- [STANDARDS.md](STANDARDS.md) ; architecture, quality gates, adding rules
- [SAFARI.md](SAFARI.md) ; Xcode build and App Store distribution
