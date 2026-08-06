# Chrome Web Store publishing

## Package

```bash
npm run validate
npm run test:e2e
npm run build:store
```

The build checks that the tracked runtime and icons are current, stages only declared Chrome files, and creates a deterministic ZIP with sorted entries, fixed metadata, and a SHA-256 checksum. Packaging fails rather than modifying source files when generated assets are stale.

Upload a package in the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole):

| Mode         | File                           | When                                              |
| ------------ | ------------------------------ | ------------------------------------------------- |
| Default      | `dist/byebar-chrome-0.8.0.zip` | Before opting in to verified CRX uploads          |
| Verified CRX | `dist/byebar-chrome-0.8.0.crx` | After opting in (required for all future uploads) |

## Verified CRX uploads (optional security)

Chrome can require that **only you** can upload new versions, by verifying uploads against an RSA public key you register. Google still re-signs the extension for users; your key only gates who may upload.

**Before opting in:** you can upload `.zip` files (current `npm run build:store` flow).

**After opting in:** every upload must be a `.crx` signed with your private key. If you lose the private key, you cannot publish updates until Chrome Web Store support helps (can take ~1 week).

### 1. Generate a key pair (once, on your machine)

```bash
mkdir -p store/signing
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out store/signing/privatekey.pem
chmod 600 store/signing/privatekey.pem
```

`store/signing/` is gitignored. **Never commit `privatekey.pem`.** Back it up somewhere safe (password manager, encrypted backup).

### 2. Copy the public key into the dashboard

```bash
openssl rsa -in store/signing/privatekey.pem -pubout
```

Paste the **entire** output into **Package → Verified CRX uploads → Public key**, including:

```
-----BEGIN PUBLIC KEY-----
...
-----END PUBLIC KEY-----
```

Then click opt in.

### 3. Build and upload signed CRX

```bash
npm run build:store:crx
```

Upload the versioned `.crx` in `dist/` with **Upload New Package** (not the zip).

Set `BYEBAR_CRX_PRIVATE_KEY` if your key is not at `store/signing/privatekey.pem`. The build signs and verifies the CRX3 directly, so Chrome is not required. It prints the SHA-256 fingerprint of the signer public key and creates a checksum beside the CRX.

For release automation, set `BYEBAR_CRX_PUBLIC_KEY_SHA256` to the expected 64-character signer fingerprint. The build then fails if the supplied private key does not match the pinned release identity. Given the same source tree and private key, repeated builds produce byte-identical ZIP and CRX artifacts.

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

> ByeBar hides validated newsletter modals and subscribe bars, and can click confirmed cookie-reject or optional terms controls. Its toolbar popup offers a conservative on-demand Sweep and a one-shot Pick to hide for an interruption you select by pointer, keyboard, or accessible in-page controls. Pick intercepts the selection action, stores no selector, and adds one reversible marker hide. Sweep can also run from a configurable keyboard shortcut with brief badge feedback. Up to 10 recent marker-based hide actions are reversible, while site control clicks are not. Not an ad blocker; it does not block ads, trackers, or network requests. No telemetry.

## Privacy practices tab (copy-paste)

Open your item → **Privacy practices** → fill every required field → **Save draft**.

### Single purpose description

> ByeBar has one purpose: remove intrusive on-page overlays and popups (newsletter modals, subscribe bars, cookie consent banners, terms dialogs, and similar page chrome) from websites the user visits, so pages are easier to read and browse. It is not an ad blocker and does not block network requests, ads, or trackers.

### Permission justifications

| Field                              | Justification                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **storage**                        | Saves global defaults, hostname-keyed site overrides, and the diagnostics preference in device-local extension storage. Nothing is sent to the developer.                                                                              |
| **activeTab**                      | Identifies the active tab so the popup can show the current site, start or cancel a one-shot Pick, and let the keyboard shortcut target the page active at keypress. No page content is collected or transmitted.                      |
| **Host permission** (`<all_urls>`) | Injects content scripts into eligible top-level pages to detect and remove intrusive overlays in the page DOM. Embedded frame contents are not processed. ByeBar does not send browsing data or diagnostic decisions to the developer. |
| **Remote code**                    | ByeBar does not use remote code. All JavaScript and CSS are bundled in the published package. The extension does not fetch, load, or execute scripts from external servers at runtime.                                                 |

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
| Small promo tile | 440×280             | Required                                                |
| Marquee promo    | 1400×560            | Optional                                                |

Add screenshots to `store/screenshots/` before publishing (not bundled in the zip).

## Pre-submit checklist

- [ ] `npm run validate` and `npm run test:e2e`
- [ ] Default ZIP upload: `npm run build:store`
- [ ] Verified CRX upload: pin `BYEBAR_CRX_PUBLIC_KEY_SHA256` and run `npm run build:store:crx`
- [ ] Verify the selected artifact against its adjacent `.sha256` checksum
- [ ] Support URL live: https://byebar.mattivan.com/support.html
- [ ] Privacy policy live: https://byebar.mattivan.com/privacy.html
- [ ] Privacy practices tab: all justifications + single purpose + data certification
- [ ] Load `dist/stage/chrome`, or extract the ZIP and load the extracted directory, then smoke-test
- [ ] Account: one-time $5 developer registration fee (if not already enrolled)

## After approval

Add the store link to `docs/index.html` and the README install section.
