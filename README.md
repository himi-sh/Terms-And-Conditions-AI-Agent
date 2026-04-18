# Terms & Conditions Agent

> **A Chrome/Edge browser extension powered by AI that reads the fine print so you don't have to.**

Most people click "Accept" on Terms & Conditions without reading a word. This extension quietly reads them for you in the background — and tells you, in plain English, what you're about to agree to.

---

## The Problem

Terms of Service documents are long, full of legalese, and often written to hide what actually matters: forced arbitration, auto-renewal traps, data-sale clauses, perpetual content licenses, and more. Even people who want to read them usually can't spare 20 minutes per signup.

The result: users sign away rights they'd never knowingly give up.

This agent closes that gap. It runs automatically on every page, detects policy links, analyzes the document with AI, and surfaces:

- A plain-English **summary** of what the document says
- **Red flags** — risky clauses with the verbatim quote that triggered them
- A clear **verdict**: `safe`, `caution`, or `avoid`
- A **"before you accept" checklist** — concrete things to do first
- **GDPR completeness score** and **transparency score**
- A **rights-letter generator** to request access, deletion, or cancellation

All before you click Accept.

---

## Screenshots

**Side panel — live analysis on a page**

![Side panel](docs/screenshot-panel.png)

**Standalone analyzer — paste any URL or text**

![Standalone analyzer](docs/screenshot-analyzer.png)

---

## How to run it

**Requirements:** Chrome 114+ or Edge 114+, and an [OpenAI API key](https://platform.openai.com/api-keys).

1. Clone or download this repository.
2. *(Optional)* Add your OpenAI key to `src/shared/config.js` — copy `src/shared/config.example.js` and paste your key. Or skip this and enter the key inside the extension's Settings panel at runtime.
3. Open `chrome://extensions` (or `edge://extensions`) in your browser.
4. Turn on **Developer mode** (top-right toggle).
5. Click **Load unpacked** and select this folder.
6. Pin the extension icon, then click it to open the side panel.
7. Browse normally. The side panel updates automatically whenever it finds a policy document.

To reload after code changes: click the refresh icon on the extensions page. Content-script changes also require a page reload on the tab under test.

---

## Credits

Built by **Himani Sharma** for the AI Agent Hackathon.

- **AI analysis** — OpenAI `gpt-4o-mini` with JSON-Schema structured output
- **PDF extraction** — [pdf.js](https://mozilla.github.io/pdf.js/) by Mozilla
- **Platform** — Chrome / Edge Manifest V3 extension APIs
