# Chrome Web Store publishing

## Package

```bash
npm run build:store
```

Upload `dist/byebar-chrome.zip` in the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Listing copy

| Field              | Text                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | ByeBar                                                                                                                                                                                                                                                                                |
| **Summary**        | Remove distracting popups and make webpages easier to browse.                                                                                                                                                                                                                         |
| **Description**    | ByeBar removes newsletter modals, subscribe overlays, cookie consent banners, terms popups, and broken lead forms. It works entirely in your browser on the pages you visit. Not an ad blocker; it does not block ads, trackers, or network requests. Data stays local; no telemetry. |
| **Category**       | Productivity                                                                                                                                                                                                                                                                          |
| **Language**       | English                                                                                                                                                                                                                                                                               |
| **Homepage**       | https://byebar.mattivan.com/                                                                                                                                                                                                                                                          |
| **Privacy policy** | https://byebar.mattivan.com/privacy.html                                                                                                                                                                                                                                              |
| **Support**        | https://github.com/neuralnexus/ByeBar/issues                                                                                                                                                                                                                                          |

## Permission justifications

| Permission   | Why                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `storage`    | Saves your on/off toggles and per-site preferences locally.                                                                 |
| `activeTab`  | Shows the current site hostname in the popup.                                                                               |
| `<all_urls>` | Injects content scripts on pages you open so overlays and popups can be removed. No browsing data is sent to the developer. |

## Required assets

| Asset            | Size                | Notes                                                   |
| ---------------- | ------------------- | ------------------------------------------------------- |
| Icon             | 128×128             | Included in the zip (`icons/icon-128.png`)              |
| Screenshots      | 1280×800 or 640×400 | At least one; capture the popup and a before/after page |
| Small promo tile | 440×280             | Optional                                                |
| Marquee promo    | 1400×560            | Optional                                                |

Add screenshots to `store/screenshots/` before publishing (not bundled in the zip).

## Pre-submit checklist

- [ ] Run `npm run validate` and `npm run build:store`
- [ ] Load `dist/byebar-chrome.zip` contents unpacked in Chrome and smoke-test
- [ ] Privacy policy URL live at `/privacy.html`
- [ ] Single-purpose description matches behavior (overlay/popup removal only)
- [ ] Declare **no user data collection** in the dashboard privacy section
- [ ] Account: one-time $5 developer registration fee (if not already enrolled)

## After approval

Add the store link to `docs/index.html` and the README install section.
