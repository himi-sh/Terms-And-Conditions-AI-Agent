# Running on Safari

This extension ships from a single Chrome MV3 codebase that also runs as a **Safari Web
Extension**. Safari can't load an unpacked folder like Chrome — the web-extension files
must be wrapped in an Xcode app and built. **That step requires macOS + Xcode**, so it
can't be done on Windows.

## Why it works without rewriting the code

- Safari exposes the same `chrome.*` namespace (aliased to its `browser.*` engine), and
  `chrome.storage`, `chrome.runtime`, `chrome.tabs`, and `chrome.action` all behave the
  same way — including returning promises. No namespace changes needed.
- `chrome.sidePanel` is the only API Safari doesn't implement. The service worker detects
  its absence and opens `src/panel/panel.html` in a normal tab instead (reusing an
  existing panel tab rather than stacking new ones). See `openPanel()` in
  `src/background/service-worker.js`.
- The PDF.js library, content-script IIFE, and module-based service worker all run on
  Safari 16.4+ (Safari 17+ recommended).

## Build steps (macOS)

1. Install **Xcode** from the App Store and its Command Line Tools (`xcode-select --install`).
2. From the repo root, run the converter:
   ```bash
   ./scripts/build-safari.sh
   ```
   This stages a clean copy of `manifest.json` + `src/` (dropping your local
   `config.js` so your API key isn't bundled) and runs Apple's
   `safari-web-extension-converter`, producing an Xcode project under `./safari/`.
3. Open the generated project in Xcode and **Run** (`Cmd+R`) the macOS app target. This
   builds the host app and registers the extension with Safari.
4. In **Safari → Settings → Advanced**, enable *Show features for web developers*.
5. In **Safari → Settings → Developer**, enable *Allow unsigned extensions*
   (resets on each Safari restart unless you code-sign the app).
6. In **Safari → Settings → Extensions**, enable *Terms and Conditions Agent* and set it
   to *Allow on Every Website* — it needs cross-site access to fetch policy documents.
7. Open the extension's settings (toolbar button → panel tab) and paste your OpenAI API key.

## Expected converter warnings (harmless)

- `sidePanel` permission and the `side_panel` manifest key are Chrome-only. Safari warns
  and ignores them; the panel opens in a tab.
- `minimum_chrome_version` is ignored by Safari.
- No `icons` are declared, so Safari uses a placeholder. Add an `icons` block to
  `manifest.json` if you want branded toolbar/app icons.

## Distributing (optional)

The unsigned-extension toggle is for local development only. To share the build or ship
to the App Store, set your Apple Developer team under the target's **Signing &
Capabilities** in Xcode, then archive and notarize/submit as a normal Mac app.
