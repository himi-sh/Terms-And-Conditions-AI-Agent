# Architecture

How a page visit becomes an on-screen policy analysis. Message constants live in `src/shared/messages.js`; storage access is centralized in `src/shared/storage.js`.

## Component flow

```mermaid
flowchart TD
    subgraph page["Web page (every tab)"]
        CS["content.js<br/><small>classify page · find policy links · SPA hooks</small>"]
        BADGE["In-page badge<br/><small>shadow DOM · dismissable</small>"]
    end

    subgraph sw["Service worker (src/background/service-worker.js)"]
        ORCH["Orchestrator<br/><small>fetch → extract → SHA-256 → store → analyze → broadcast</small>"]
        CHUNK["Section-aware chunking<br/><small>buildSectionAwareExcerpt → buildFocusedExcerpt</small>"]
        NORM["normalizeAnalysis()<br/><small>clamp scores · derive verdict · 15 clause categories</small>"]
    end

    OPENAI["OpenAI API<br/><small>gpt-4o-mini · strict JSON schema</small>"]

    subgraph store["chrome.storage.local (src/shared/storage.js)"]
        TAB["tab:{tabId}<br/><small>page meta + documents[]</small>"]
        DOC["doc:{hash}<br/><small>full document body</small>"]
    end

    subgraph ui["UI (ES modules, share src/shared/ui.js)"]
        PANEL["panel.js<br/><small>verdict · scores · red flags · clause grid · API key</small>"]
        ANALYZE["analyze.js<br/><small>arbitrary URL / pasted text / PDF upload</small>"]
    end

    CS -- "CONTENT_REPORT" --> ORCH
    CS -.-> BADGE
    BADGE -- "OPEN_PANEL" --> ORCH
    ORCH -- "opens side panel" --> PANEL

    ORCH --> CHUNK --> OPENAI --> NORM
    ORCH -- "fetch policy URLs<br/>(cross-origin)" --> WEB["Policy documents"]
    NORM --> TAB
    ORCH --> DOC

    ORCH -- "PANEL_STATE (broadcast)" --> PANEL
    PANEL -- "PANEL_ANALYSE_DOC { url }" --> ORCH
    PANEL -- "PANEL_REQUEST_STATE" --> ORCH

    ANALYZE -- "ANALYZE_SUBMIT { mode, content }" --> ORCH
    ORCH -- "{ ok, text, analysis }" --> ANALYZE
    ANALYZE -. "PDFs parsed client-side<br/>via src/lib/pdf.min.mjs" .-> ANALYZE

    TAB -.-> PANEL
```

## Sequence: automatic analysis on page load

```mermaid
sequenceDiagram
    participant P as Web page
    participant C as content.js
    participant SW as service-worker.js
    participant AI as OpenAI
    participant ST as storage.local
    participant PN as panel.js

    P->>C: page load / SPA navigation
    C->>C: classify page type, find policy links
    C->>SW: CONTENT_REPORT (links + page meta)
    C->>P: inject in-page badge (if policies found)

    loop each policy document
        SW->>SW: fetch URL → extract readable text
        SW->>SW: SHA-256 hash
        SW->>ST: store doc:{hash}
        SW->>SW: section-aware chunk to fit context
        SW->>AI: analyze (gpt-4o-mini, JSON schema)
        AI-->>SW: raw analysis JSON
        SW->>SW: normalizeAnalysis()
        SW->>ST: update tab:{tabId}.documents[]
        SW-->>PN: PANEL_STATE (broadcast)
    end

    Note over C,PN: badge click → OPEN_PANEL → SW opens side panel
    PN->>PN: render via src/shared/ui.js helpers
```

## Standalone analyzer (`analyze.js`)

The Analyze tab bypasses the content-script path: it accepts a URL, pasted text, or an uploaded file (PDFs parsed client-side with `pdf.min.mjs`), sends `ANALYZE_SUBMIT` to the service worker, and renders the returned analysis with the same `src/shared/ui.js` helpers as the side panel.
