# Terms and Conditions Agent

Chrome / Edge browser extension (Manifest V3) that automatically detects Terms & Conditions, privacy policy, cookie, and subscription notices on any web page, analyzes them via OpenAI (gpt-4o-mini), and surfaces risks before you click Accept.

## Features

- **Auto-detection** — content script classifies every page (T&C, privacy policy, cookie notice, etc.) and discovers policy links, including SPA navigation via pushState hooks and MutationObserver.
- **Text extraction** — service worker fetches and extracts readable text from linked policy documents cross-origin; SHA-256 hashes each document for deduplication.
- **AI analysis** — sends up to 12,000 chars to OpenAI and returns:
  - Five-bullet plain-English summary
  - Red flags (text, severity, verbatim quote)
  - GDPR completeness score (present / missing clauses)
  - Transparency score (0–100)
- **Side panel UI** — live results panel (scores, GDPR grid, red-flag list) opens alongside any page; no page reload needed.
- **Standalone analyzer** — `analyze.html` lets you paste a URL or raw text and analyze any document on demand, with red-flag text highlighting.
- **Accepted-terms vault** — stores URL, timestamp, content hash, and version history of every document you've reviewed in `chrome.storage.local`.
- **Rights-action generator** — drafts GDPR action letters (access / delete / port / object / cancel) for the site you're on.
- **API key management** — enter your OpenAI key in the Settings panel; stored locally and never sent anywhere except the OpenAI API.

## Planned

- **Phase 5:** Policy-change reminders, renewal deadlines, and version diffing.

## Load unpacked (Chrome / Edge)

1. Copy `src/shared/config.example.js` → `src/shared/config.js` and add your OpenAI API key (or enter it at runtime in the Settings panel).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this folder.
5. Pin the action icon; click it to open the side panel.

To reload after changes: click the refresh icon on the extensions page. Content-script changes also require a page reload.

## Layout

```
manifest.json
src/
  background/service-worker.js   # fetch → extract → hash → analyze → broadcast
  content/content.js             # page-type detection, policy-link discovery, SPA hooks
  panel/panel.{html,js,css}      # side panel — live analysis results + settings
  analyze/analyze.{html,js,css}  # standalone analyzer — URL or pasted text
  shared/
    messages.js                  # message-type constants
    storage.js                   # all chrome.storage.local access
    config.example.js            # API key template (copy → config.js)
  lib/                           # third-party helpers
icons/
```

## Storage schema

**Tab state** (`tab:{tabId}`): `{ pageUrl, pageTitle, pageType, observedAt, documents[] }`

**Per document**: `{ url, type, status, hash, text, textLength, extractedAt, analysisStatus, analysis }`

**Analysis**: `{ summary: string[], redFlags: [{text, severity, quote}], gdpr: {score, present[], missing[]}, transparencyScore: number }`

**Full document body** (`doc:{hash}`): `{ hash, url, finalUrl, title, text, textLength, extractedAt }`
