# ByeBar

**Overlay & popup blocker for Chrome, Firefox, and Safari.**

ByeBar removes the UI clutter that gets between you and the page: newsletter modals, subscribe bars, email-capture overlays, cookie consent walls, coupon spinners, and similar interruptions. It works entirely in the DOM — it does not block ads, trackers, or network requests.

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

ByeBar is a Manifest V3 extension that injects content scripts at `document_start` on every page.

1. **CSS hide** — `content/styles.css` (and site-specific stylesheets) hide known overlays instantly, before paint.
2. **Selector pass** — the engine removes matching elements from `content/selectors.js` (`SITE_RULES`, `GENERIC_REMOVE`, cookie/TOS lists).
3. **Heuristic pass** — text and layout heuristics catch newsletter dialogs, Substack signup modals, Bloomberg promos, coupon spinners, etc.
4. **Interaction pass** — cookie and TOS modules click decline/accept buttons when available, then remove leftovers.
5. **Mutation observer** — watches for late-injected overlays (common with CMPs and SPAs) and re-runs passes; delayed retries at 500 ms–8 s cover async injection.

Early scripts (`geolocation.js`, `netsuite-lead.js`) patch browser APIs or redirect before the page fully loads.

```
document_start
  ├── styles.css          (instant hide)
  ├── geolocation.js      (patch navigator.geolocation)
  ├── netsuite-lead.js    (redirect broken NetSuite forms)
  └── main.js → engine, cookies, tos, china-commerce
        └── MutationObserver + timed retries
```

## Features

| Feature                            | What it does                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Generic overlay blocking**       | Removes newsletter nags, subscribe prompts, and email-capture popups via keyword + layout heuristics |
| **Auto-decline cookie banners**    | Clicks reject/deny when possible, calls CMP APIs, then hides the banner                              |
| **Auto-accept terms modals**       | Dismisses legal/TOS popups (e.g. Bloomberg consent)                                                  |
| **Auto-decline location requests** | Denies `navigator.geolocation` without a browser prompt                                              |
| **Bypass lead forms**              | Leaves broken external lead forms (e.g. NetSuite `extforms`) for the brand site                      |
| **Site-specific rules**            | Targeted CSS + selectors + heuristics for known offenders                                            |

Open the toolbar popup to toggle behavior globally or per-site.

## Site coverage

### Dedicated site modules

| Sites                                     | Module                                 | Examples handled                                                            |
| ----------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `*.substack.com`                          | `substack.css`, `engine.js`            | Subscribe modals, Radix/pencraft “Join … on Substack” dialogs, modal scrims |
| `*.bloomberg.*`                           | `bloomberg.css`, `engine.js`, `tos.js` | TOS consent modal, flash-sale promo strips                                  |
| Temu, Shein, AliExpress, Taobao, JD, etc. | `china-commerce.js`                    | Coupon wheels, lottery spinners, `react-responsive-modal` overlays          |
| `*.extforms.netsuite.com`                 | `netsuite-lead.js`                     | Broken external lead forms with SuiteScript errors                          |

### Cookie / consent platforms (global)

Auto-decline and hide are implemented for common CMPs, including:

| CMP                                                                                               | Decline                                  | API fallback              |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------- |
| **Sourcepoint**                                                                                   | `sp_choice_type_11`, Reject All          | `_sp_.gdpr.rejectAll()`   |
| **Google Funding Choices**                                                                        | `.fc-cta-do-not-consent`                 | —                         |
| **OneTrust**                                                                                      | `#onetrust-reject-all-handler`           | `OneTrust.RejectAll()`    |
| **CookieYes**                                                                                     | `[data-cky-tag="reject-button"]`         | —                         |
| **Cookiebot**                                                                                     | `#CybotCookiebotDialogBodyButtonDecline` | `Cookiebot.withdraw()`    |
| **Quantcast**                                                                                     | `.qc-cmp2-summary-buttons` secondary     | `__cmp('rejectAll')`      |
| **Usercentrics**                                                                                  | `uc-deny-all-button`                     | `UC_UI.denyAllConsents()` |
| **TrustArc / Truste**                                                                             | CCPA opt-out button                      | `truste.bn.declineCPRA()` |
| **Didomi**                                                                                        | disagree / continue-without              | `setUserDisagreeToAll()`  |
| **iubenda**                                                                                       | `.iubenda-cs-reject-btn`                 | `_iub.cs.api.reject()`    |
| **Ketch**                                                                                         | `#ketch-banner-button-secondary`         | `ketch('deny')`           |
| **Termly**, **Borlabs**, **Complianz**, **consentmanager.net**, **Moove GDPR**, **Cookie Notice** | vendor decline selectors                 | —                         |

Generic cookie-banner heuristics still catch long-tail CMPs not listed above.

### Generic heuristics (all sites)

When **Generic blocking** is enabled, ByeBar removes fixed/sticky overlays and `role="dialog"` elements whose text matches subscribe/newsletter/signup patterns. Substack-style copy (“Join … on Substack”, “Get the app”) is detected on custom domains too.

## Browser support

| Browser              | Minimum version | Install                                         |
| -------------------- | --------------- | ----------------------------------------------- |
| Chrome / Edge        | 109+            | [Load unpacked](#install-chrome--edge--firefox) |
| Firefox              | 109+            | Temporary add-on or signed build                |
| Safari (macOS / iOS) | 16.4+           | [SAFARI.md](SAFARI.md)                          |

## Install (Chrome / Edge / Firefox)

1. Clone and prepare assets:

   ```bash
   git clone https://github.com/neuralnexus/ByeBar.git
   cd ByeBar
   npm ci
   npm run icons
   ```

2. Load the extension:
   - **Chrome / Edge:** `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `ByeBar` folder.
   - **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `manifest.json`.

3. Reload the extension after pulling updates, then refresh open tabs.

For Safari, see [SAFARI.md](SAFARI.md).

## Settings

Open the popup from the toolbar:

| Setting                          | Default | Description                                                             |
| -------------------------------- | ------- | ----------------------------------------------------------------------- |
| Enabled on this site             | On      | Per-site override; turning off adds the current host to `siteOverrides` |
| Generic blocking                 | On      | Newsletter/subscribe overlay heuristics on all sites                    |
| Auto-decline cookie banners      | On      | Reject cookies and hide consent UI                                      |
| Auto-accept terms & legal modals | On      | Click through TOS/legal modals                                          |
| Auto-decline location requests   | On      | Block geolocation prompts                                               |
| Bypass lead forms                | On      | Redirect away from broken external lead capture pages                   |

Settings persist in `storage.sync` (falls back to `storage.local` on Safari).

## Troubleshooting

**Overlay still appears briefly, then disappears**  
Expected for late-injected modals. ByeBar retries at 500 ms, 1.5 s, 4 s, and 8 s. If it never clears, file an issue with the site URL and a DOM snippet.

**ByeBar does nothing on a site**  
Check that **Enabled on this site** is on in the popup. The host may be in `siteOverrides` from a prior disable.

**Cookie banner keeps returning**  
Some CMPs re-inject on interaction. Ensure **Auto-decline cookie banners** is on. Didomi/Usercentrics sites may need a new rule — see [Contributing](#contributing).

**Page scroll is stuck after a modal**  
ByeBar unlocks `overflow: hidden` and `didomi-popup-open` / `modal-open` body classes when removing overlays. Reload if a site uses a non-standard scroll lock.

**Firefox temporary add-on disappears**  
Re-load `manifest.json` from `about:debugging` after each browser restart.

## Development

```bash
npm ci
npm run icons      # generate icon sizes from icons/icon-512.png
npm run validate   # manifest check + lint + format + tests
npm run test       # vitest watch mode
npm run lint:fix   # auto-fix eslint issues
npm run format     # prettier write
npm run build:safari
```

### Project layout

```
background/   MV3 service worker (settings bootstrap)
content/      Content scripts, CSS, site modules
  engine.js   Settings, selector passes, mutation observer
  cookies.js  Cookie CMP decline + hide
  tos.js      Terms-of-service auto-accept
  selectors.js  SITE_RULES, GENERIC_REMOVE, COOKIE_* lists
  main.js     Entry point, timed retries
lib/          Testable heuristics (*.mjs)
test/         Vitest unit tests
popup/        Toolbar popup UI
shared/       Cross-browser WebExtension API shim (browser.js)
scripts/      Manifest validation, Safari build, icon generation
```

### Heuristic modules (`lib/`)

| Module                          | Purpose                                   |
| ------------------------------- | ----------------------------------------- |
| `cookie-heuristics.mjs`         | CookieYes, Usercentrics, Didomi detection |
| `substack-heuristics.mjs`       | Radix/pencraft Substack signup modals     |
| `bloomberg-heuristics.mjs`      | Bloomberg promo strips                    |
| `china-commerce-heuristics.mjs` | Coupon spinner / lottery wheels           |
| `tos-heuristics.mjs`            | Terms-of-service modal text               |
| `netsuite-lead.mjs`             | NetSuite external lead URL detection      |
| `geolocation.mjs`               | Geolocation decline settings              |
| `host.mjs`                      | Host normalization, per-site enablement   |
| `constants.mjs`                 | Shared regexes and default settings       |

Pure logic lives in `lib/` and is tested with Vitest. Content scripts mirror the same logic at runtime (MV3 content scripts cannot import ES modules directly).

CI runs `npm run validate` on every push to `main`.

## Contributing

See [STANDARDS.md](STANDARDS.md) for architecture rules and a step-by-step guide to adding site-specific blocking.

Quick checklist for a new overlay type:

1. Add selectors to `content/selectors.js` (`SITE_RULES` or `GENERIC_REMOVE`).
2. Add matching CSS to `content/styles.css` or a site-specific stylesheet in `manifest.json`.
3. Add heuristics in `lib/*.mjs` + tests in `test/`.
4. Wire removal/decline logic in the appropriate content script (`engine.js`, `cookies.js`, etc.).
5. Run `npm run validate` and manually smoke-test on the target site.

Pull requests welcome at [github.com/neuralnexus/ByeBar](https://github.com/neuralnexus/ByeBar).

## What ByeBar is not

ByeBar is **not an ad blocker**. It does not filter network traffic, block trackers, or remove on-page ads. It only removes or dismisses overlay UI: modals, banners, nags, and consent popups.

## Related docs

- [STANDARDS.md](STANDARDS.md) — architecture, quality gates, adding rules
- [SAFARI.md](SAFARI.md) — Xcode build and App Store distribution
