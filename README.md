# Terms and Conditions Agent

Browser extension (Manifest V3) that reads T&C, privacy, cookie and subscription notices before you accept them, flags risky clauses, scores transparency, and keeps a record of what you agreed to.

## Phased build

- **Phase 1 (current):** MV3 skeleton, page-type detection, policy-link discovery, text extraction.
- **Phase 2:** Five-bullet summary, red flags, GDPR completeness, transparency score.
- **Phase 3:** Accepted-terms vault with URL, timestamp, content hash and version history.
- **Phase 4:** Rights-action generator (access / delete / port / object / cancel) + proofreading.
- **Phase 5:** Reminders for policy changes, renewals and rights-request deadlines; version diffing.

## Load unpacked (Chrome / Edge)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Pin the action icon; click it to open the side panel.

## Layout

```
manifest.json
src/
  background/service-worker.js   # fetch + extract + orchestration
  content/content.js             # detects page type, discovers policy links
  panel/panel.{html,js,css}      # side panel UI
  shared/                        # messaging, storage, utils
icons/                           # placeholder; add real PNGs before publishing
```

Phase 1 has no network calls to any LLM. All logic runs locally.
