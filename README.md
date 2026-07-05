# ByeBar

**Overlay & popup blocker for Chrome, Firefox, and Safari.**

ByeBar removes the UI clutter that gets between you and the page: newsletter modals, subscribe bars, email-capture overlays, cookie consent walls, and similar interruptions. It works entirely in the DOM — it does not block ads, trackers, or network requests.

## Features

- **Generic overlay blocking** — heuristics for newsletter nags, subscribe prompts, and email-capture popups across any site
- **Auto-decline cookie banners** — clicks reject/deny when available, then hides the banner; supports OneTrust, CookieYes, Usercentrics, TrustArc, Didomi, and others
- **Auto-accept terms modals** — dismisses legal/TOS popups (e.g. Bloomberg consent)
- **Auto-decline location requests** — denies `navigator.geolocation` prompts without showing the browser dialog
- **NetSuite lead-form redirect** — sends broken `extforms.netsuite.com` email-capture pages to the brand's main site
- **Site-specific rules** — targeted handling for Substack, Bloomberg, Temu/Shein/AliExpress, Mercedes-Benz, orange.jobs (Didomi), and more

Click the toolbar icon to toggle behavior globally or per-site.

## Browser support

| Browser              | Minimum version | Install                               |
| -------------------- | --------------- | ------------------------------------- |
| Chrome / Edge        | 109+            | Load unpacked (see below)             |
| Firefox              | 109+            | Load temporary add-on or signed build |
| Safari (macOS / iOS) | 16.4+           | [Build via Xcode](SAFARI.md)          |

## Install (Chrome / Edge / Firefox)

1. Clone the repo:

   ```bash
   git clone https://github.com/neuralnexus/ByeBar.git
   cd ByeBar
   npm ci
   npm run icons
   ```

2. Load the extension:
   - **Chrome / Edge:** open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, select the `ByeBar` folder.
   - **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, select `manifest.json`.

For Safari, see [SAFARI.md](SAFARI.md).

## Settings

Open the popup from the toolbar:

| Setting                             | Default | Description                                                        |
| ----------------------------------- | ------- | ------------------------------------------------------------------ |
| Enabled on this site                | On      | Per-site override; disabling adds the current host to an allowlist |
| Generic blocking                    | On      | Newsletter/subscribe overlay heuristics on all sites               |
| Auto-decline cookie banners         | On      | Reject cookies and hide consent UI                                 |
| Auto-accept terms & legal modals    | On      | Click through TOS/legal modals                                     |
| Auto-decline location requests      | On      | Block geolocation prompts                                          |
| Redirect broken NetSuite lead forms | On      | Leave broken NetSuite external lead pages                          |

## Development

```bash
npm ci
npm run icons      # generate icon sizes from icons/icon-512.png
npm run validate   # manifest check, lint, format, tests
npm run test       # watch mode
npm run build:safari
```

### Project layout

```
content/     Content scripts (engine, cookies, TOS, site modules)
lib/         Testable heuristics (*.mjs)
test/        Vitest unit tests
popup/       Toolbar popup UI
background/  MV3 service worker
shared/      Cross-browser WebExtension API shim
```

Pure logic lives in `lib/`; content scripts mirror it for the browser runtime. Site-specific selectors are registered in `content/selectors.js`. See [STANDARDS.md](STANDARDS.md) for architecture and contribution rules.

CI runs `npm run validate` on every push to `main`.

## What ByeBar is not

ByeBar is **not an ad blocker**. It does not filter network traffic, block trackers, or remove on-page ads. It only removes or dismisses overlay UI: modals, banners, nags, and consent popups.

## License

See repository for license terms.
