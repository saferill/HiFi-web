# HiFi Web & Deep-Link Gateway (`HiFi-web`)

Official landing page, client architecture portal, and intelligent APK download gateway for **[HiFi Music](https://github.com/saferill/HiFi)**.

Hosted live on GitHub Pages: **[https://saferill.github.io/HiFi-web/](https://saferill.github.io/HiFi-web/)**

---

## Core Capabilities

### 1. Smart 1-Click APK Downloader
Rather than forcing users to guess which ABI (`arm64-v8a`, `armeabi-v7a`, `x86_64`, or universal) matches their device from the GitHub Releases page:
* Client-side JavaScript detects the device CPU architecture via `navigator.userAgent`.
* Queries `api.github.com/repos/saferill/HiFi/releases/latest`.
* Sets the primary download button to immediately fetch the optimal signed `.apk` file for that specific device.

### 2. Universal Deep-Link Routing (`404.html`)
GitHub Pages does not natively support server-side URL rewrites. To support cross-platform sharing:
* Any URL path under `/app/*` (e.g., `/app/track/<id>` or `/app/playlist/<id>`) is caught by `404.html`.
* The router parses the request and triggers a custom intent scheme:
  ```
  https://saferill.github.io/HiFi-web/app/track/<id>  -->  hifi://track/<id>
  ```
* If the app is installed, Android/Desktop opens the track directly. If not, it falls back gracefully to the web installer.

---

## Development

```bash
# Preview locally with any static web server
npx serve .
# Or Python
python -m http.server 8080
```

Zero external frameworks, zero build tools required. Raw vanilla HTML5, CSS3, and modern ES6 JavaScript for instant loading speeds and minimal memory footprint.

---

## License

Open-source under the [GPL-3.0 License](https://www.gnu.org/licenses/gpl-3.0.html).
