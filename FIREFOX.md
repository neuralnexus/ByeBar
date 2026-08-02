# Firefox Setup

ByeBar uses a Firefox-specific Manifest V3 stage because Firefox requires ordered `background.scripts` while Chromium uses `background.service_worker`.

## Temporary installation

```bash
npm ci
npm run build:runtime
npm run icons
npm run stage:firefox
```

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/stage/firefox/manifest.json`. Temporary add-ons must be loaded again after Firefox restarts.

## Lint and package

```bash
npm run lint:firefox
npm run build:firefox
```

The build creates `dist/byebar-firefox-0.7.0.zip`, verifies that its entries and bytes exactly match the clean Firefox stage, and prints a SHA-256 digest.

`web-ext lint` currently reports two allowed warnings because Firefox 115 predates the `data_collection_permissions` manifest key now required by AMO. The lint script allows only these warning codes and fails on any other warning or error:

- `KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION`
- `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`

This preserves Firefox 115 ESR support without dropping AMO's required no-data declaration. Revisit the policy when the minimum supported Firefox version reaches 140 desktop and 142 Android.

## Distribution

The generated ZIP is an unsigned upload artifact. Submit it to [addons.mozilla.org](https://addons.mozilla.org/developers/) for review/signing or use Mozilla's authenticated signing workflow. Installing a permanent release outside development requires Mozilla's signed XPI; AMO credentials are never used in pull-request CI.

## See also

- [README.md](README.md) ; features and general setup
- [STANDARDS.md](STANDARDS.md) ; architecture and quality gates
