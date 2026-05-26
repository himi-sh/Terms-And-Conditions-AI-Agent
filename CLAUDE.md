# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome MV3 extension that detects Terms & Conditions / privacy policy links on web pages, extracts their text, and analyzes them via OpenAI API to surface risks and transparency scores.

## Development Setup

No build step — load the extension directly in Chrome:
1. Copy `src/shared/config.example.js` → `src/shared/config.js` and add your OpenAI API key (or enter it in the extension's Settings panel at runtime)
2. Open `chrome://extensions`, enable Developer Mode, click "Load unpacked", select this repo root

To reload after changes: click the refresh icon on `chrome://extensions` (service worker changes require this; content script changes require a page reload too).

There are no tests, no linter config, and no build pipeline.

### Safari

The same `src/` runs as a Safari Web Extension. Safari aliases the `chrome.*` namespace, so no namespace changes are needed; the only unsupported API is `chrome.sidePanel`, which `openPanel()` falls back to a tab for. Packaging requires macOS + Xcode: run `./scripts/build-safari.sh` to generate the Xcode project. See `SAFARI.md` for the full procedure.

## Architecture

```
Content Script → Service Worker → Side Panel / Analyze Tab
```

**Message-passing flow** (see `src/shared/messages.js` for constants):
1. `content.js` runs on every page, classifies page type, finds policy links, sends `CONTENT_REPORT` to the service worker
2. `service-worker.js` receives the report, fetches each policy URL, extracts readable text, hashes it (SHA-256), stores it, then calls OpenAI and stores the analysis — all in `chrome.storage.local`
3. The service worker broadcasts `PANEL_STATE` to all connected panels after each update
4. `panel.js` and `analyze.js` consume state and render UI

**Key files:**
- `src/background/service-worker.js` — all async orchestration: fetch → extract → hash → store → analyze → broadcast
- `src/content/content.js` — IIFE (no ES module imports); handles SPA navigation via pushState/replaceState hooks + MutationObserver
- `src/shared/storage.js` — all `chrome.storage.local` access; tab state keyed `tab:{tabId}`, documents keyed `doc:{hash}`
- `src/panel/panel.js` — renders analysis results (scores, red flags, GDPR grid); also handles API key management
- `src/analyze/analyze.js` — standalone analyzer for arbitrary URL or pasted text; includes red-flag text highlighting

## Storage Schema

**Tab state** (`tab:{tabId}`): `{ pageUrl, pageTitle, pageType, observedAt, documents[] }`

**Per document in the array**: `{ url, type, status, hash, text, textLength, extractedAt, analysisStatus, analysis }`  
**Analysis shape**: `{ summary: string[], redFlags: [{text, severity, quote}], gdpr: {score, present[], missing[]}, transparencyScore: number }`

**Full document body** (`doc:{hash}`): `{ hash, url, finalUrl, title, text, textLength, extractedAt }`

## OpenAI Integration

- Model: `gpt-4o-mini`
- Max document context sent: 12,000 chars (truncated)
- API key sourced from `chrome.storage.local` first, then falls back to `src/shared/config.js` (`OPENAI_API_KEY`)
- `src/shared/config.js` is gitignored; `config.example.js` is the template

## Extension Permissions

`storage`, `scripting`, `activeTab`, `sidePanel`, `tabs`, host permissions `<all_urls>` (needed to fetch policy documents cross-origin from the service worker).

## Planned Phases

- Phase 3: Accepted-terms vault with history
- Phase 4: Rights-action generator (GDPR access/delete/port/object/cancel)
- Phase 5: Policy change reminders and version diffing
