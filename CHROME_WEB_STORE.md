# Chrome Web Store publishing

## Package

```bash
npm run validate
npm run build:store
```

Upload `dist/byebar-chrome.zip` in the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Store listing

| Field              | Value                                                         |
| ------------------ | ------------------------------------------------------------- |
| **Name**           | ByeBar                                                        |
| **Summary**        | Remove distracting popups and make webpages easier to browse. |
| **Description**    | See below                                                     |
| **Category**       | Productivity                                                  |
| **Language**       | English                                                       |
| **Homepage**       | https://byebar.mattivan.com/                                  |
| **Privacy policy** | https://byebar.mattivan.com/privacy.html                      |
| **Support**        | https://byebar.mattivan.com/support.html                      |

**Description (listing tab):**

> ByeBar removes newsletter modals, subscribe overlays, cookie consent banners, terms popups, and broken lead forms. It works entirely in your browser on the pages you visit. Not an ad blocker; it does not block ads, trackers, or network requests. Data stays local; no telemetry.

## Privacy practices tab (copy-paste)

Open your item → **Privacy practices** → fill every required field → **Save draft**.

### Single purpose description

> ByeBar has one purpose: remove intrusive on-page overlays and popups (newsletter modals, subscribe bars, cookie consent banners, terms dialogs, and similar page chrome) from websites the user visits, so pages are easier to read and browse. It is not an ad blocker and does not block network requests, ads, or trackers.

### Permission justifications

| Field                              | Justification                                                                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **storage**                        | Saves the user's extension settings locally: global on/off toggles (cookie decline, newsletter blocking, etc.) and per-site enable overrides. Data stays on the device via chrome.storage; nothing is sent to the developer.                               |
| **activeTab**                      | Reads the active tab's URL hostname so the toolbar popup can show whether ByeBar is enabled on the current site and let the user set a per-site override. No page content is collected or transmitted.                                                     |
| **Host permission** (`<all_urls>`) | Injects content scripts on pages the user opens to detect and remove intrusive overlays and popups in the page DOM. Host access is required because these overlays appear on many different websites. ByeBar does not send browsing data to the developer. |
| **Remote code**                    | ByeBar does not use remote code. All JavaScript and CSS are bundled in the published package. The extension does not fetch, load, or execute scripts from external servers at runtime.                                                                     |

### Data usage certification

Answer **No** to collecting user data. Typical answers:

| Question                                                                          | Answer |
| --------------------------------------------------------------------------------- | ------ |
| Does your extension collect user data?                                            | **No** |
| Is data sold to third parties?                                                    | **No** |
| Is data used for purposes unrelated to the extension's single purpose?            | **No** |
| Is data transferred to third parties (except as required for core functionality)? | **No** |

Then check the box certifying compliance with the [Developer Program Policies](https://developer.chrome.com/docs/webstore/program-policies/).

## Required assets

| Asset            | Size                | Notes                                                   |
| ---------------- | ------------------- | ------------------------------------------------------- |
| Icon             | 128×128             | Included in the zip (`icons/icon-128.png`)              |
| Screenshots      | 1280×800 or 640×400 | At least one; capture the popup and a before/after page |
| Small promo tile | 440×280             | Optional                                                |
| Marquee promo    | 1400×560            | Optional                                                |

Add screenshots to `store/screenshots/` before publishing (not bundled in the zip).

## Pre-submit checklist

- [ ] `npm run validate` and `npm run build:store`
- [ ] Support URL live: https://byebar.mattivan.com/support.html
- [ ] Privacy policy live: https://byebar.mattivan.com/privacy.html
- [ ] Privacy practices tab: all justifications + single purpose + data certification
- [ ] Load unpacked zip in Chrome and smoke-test
- [ ] Account: one-time $5 developer registration fee (if not already enrolled)

## After approval

Add the store link to `docs/index.html` and the README install section.
