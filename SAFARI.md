# Safari & iOS Setup

ByeBar ships as a **Safari Web Extension** using Apple's converter tool.

## Requirements

- macOS with Xcode 15+
- Safari 16.4+ on Mac
- iOS/iPadOS 16.4+ for iPhone/iPad (extension embedded in the Xcode app)

## Build

```bash
npm ci
npm run icons
npm run build:safari
open safari/ByeBar/ByeBar.xcodeproj
```

## Run on Mac

1. In Xcode, choose the **ByeBar (macOS)** scheme.
2. Press Run — Safari opens with the extension installed for debugging.
3. Enable the extension in **Safari → Settings → Extensions**.

## Run on iPhone / iPad

1. In Xcode, choose the **ByeBar (iOS)** scheme.
2. Select a simulator or connected device.
3. Run the app, then enable ByeBar under **Settings → Safari → Extensions** on the device.

## Distribution

Safari Web Extensions must be distributed inside a container app:

1. Archive the Xcode project (macOS and/or iOS target).
2. Upload to App Store Connect.
3. Users install ByeBar from the App Store; the extension is enabled in Safari settings.

## Safari-specific behavior

- Storage falls back to `storage.local` when `storage.sync` is unavailable.
- Case-insensitive CSS attribute selectors (`[attr*="x" i]`) are stripped at runtime on older WebKit builds.
- `content/styles-safari.css` provides additional hide rules for WebKit.
