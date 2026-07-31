# Safari & iOS Setup

ByeBar ships as a **Safari Web Extension** using Apple's converter tool.

## Requirements

- macOS with full Xcode 15+ (Command Line Tools alone are not sufficient)
- Safari 16.4+ on Mac
- iOS/iPadOS 16.4+ for iPhone/iPad (extension embedded in the Xcode app)

## Build

```bash
npm ci
npm run build:safari
open safari/ByeBar/ByeBar.xcodeproj
```

If Xcode is not the active developer directory, the build uses `/Applications/Xcode.app` when available. For another location, set `DEVELOPER_DIR` or select it with `xcode-select`. `npm run build:safari` regenerates the canonical runtime and icons, creates a clean Safari-only stage under `dist/stage/safari`, and converts only that stage with noninteractive/no-open flags.

The generated `safari/` project is disposable. Re-running the command replaces it, so keep source changes in the extension and configure signing through reproducible Xcode settings rather than editing copied extension resources.

CI and local release validation perform unsigned macOS and generic iOS device builds. The iOS build compiles the device target without requiring a Simulator runtime:

```bash
npm run validate:safari
```

## Run on Mac

1. In Xcode, choose the **ByeBar (macOS)** scheme.
2. Press Run ; Safari opens with the extension installed for debugging.
3. Enable the extension in **Safari → Settings → Extensions**.

After changing extension source files, re-run `npm run build:safari` before testing.

## Run on iPhone / iPad

1. In Xcode, choose the **ByeBar (iOS)** scheme.
2. Select a simulator or connected device.
3. Run the app, then enable ByeBar under **Settings → Safari → Extensions** on the device.

## Distribution

Safari Web Extensions must be distributed inside a container app:

1. Archive the Xcode project (macOS and/or iOS target).
2. Upload to App Store Connect.
3. Users install ByeBar from the App Store; the extension is enabled in Safari settings.

Signed archives require an Apple Developer team, unique app and extension bundle identifiers, and matching provisioning profiles. Pull-request CI intentionally performs only an unsigned build and never receives signing credentials.

## Safari-specific behavior

- **Storage** ; global defaults, hostname-keyed site overrides, and the diagnostics preference use device-local extension storage.
- **Case-insensitive selectors** ; `[attr*="x" i]` is stripped at runtime on older WebKit builds (`content/safari-compat.js`).
- **Scoped CSS** ; `content/styles.css` hides only elements already marked by the settings-aware engine.
- **Shadow DOM** ; `content/shadow.js` traverses open shadow roots where standard `querySelector` cannot reach CMP UI.
- **Frame scope** ; content scripts run in the top frame only and do not inspect embedded frame contents.

## Debugging

1. Enable the extension in Safari Settings.
2. Open **Develop → Web Extension Background Pages → ByeBar** for service worker logs.
3. Use **Develop → Show Web Inspector** on the target page; ByeBar content scripts appear under the page's script list.
4. Enable **Local diagnostics** in the popup to inspect rule/result metadata for the current page. The preference stays device-local and decisions clear on reload.
5. If overlays persist, check selector normalization in `content/safari-compat.js` and add a tested candidate selector.

The Playwright suite automates Chromium extension behavior. It does not replace macOS and iOS Safari smoke tests.

## See also

- [README.md](README.md) ; features and install overview
- [STANDARDS.md](STANDARDS.md) ; architecture and contributing
