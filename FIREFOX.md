# Firefox Desktop Setup

ByeBar uses a Firefox-specific Manifest V3 stage because Firefox requires ordered `background.scripts` while Chromium uses `background.service_worker`.

The Firefox artifact supports Firefox desktop 140 or newer. Firefox for Android is not currently a supported or tested target.

Automatic blocking, Sweep, settings, and Undo support Firefox 140+. Pick additionally requires Navigation API entry identity and is exposed on Firefox 147+.

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

The build checks that generated source assets are current, creates `dist/byebar-firefox-0.8.0.zip` with sorted entries and fixed metadata, verifies that its entries and bytes exactly match the clean Firefox stage, and writes a SHA-256 checksum. Packaging fails rather than modifying source files when generated assets are stale.

The manifest sets Firefox desktop 140 as its strict minimum because earlier releases reject the AMO-required `data_collection_permissions` declaration. This keeps the install metadata aligned with the artifact instead of claiming Firefox 115 compatibility.

`web-ext lint` also evaluates inferred Firefox for Android compatibility, where that key was introduced in 142. Because ByeBar does not claim Android support, the lint script permits exactly one `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` warning for `data_collection_permissions`. Any desktop compatibility warning, error, unrelated warning, or changed warning count fails the build.

## Distribution

The generated ZIP is an unsigned upload artifact. Submit it to [addons.mozilla.org](https://addons.mozilla.org/developers/) for review/signing or use Mozilla's authenticated signing workflow. Installing a permanent release outside development requires Mozilla's signed XPI; AMO credentials are never used in pull-request CI.

## See also

- [README.md](README.md) ; features and general setup
- [STANDARDS.md](STANDARDS.md) ; architecture and quality gates
