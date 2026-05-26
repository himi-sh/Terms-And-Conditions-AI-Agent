import { MSG } from "../shared/messages.js";
import { getApiKey, putApiKey } from "../shared/storage.js";
import {
  scoreChip, verdictBanner, analysisLabel, flagIcon, clauseGrid
} from "../shared/ui.js";

const els = {
  title:          document.getElementById("page-title"),
  url:            document.getElementById("page-url"),
  type:           document.getElementById("page-type"),
  docs:           document.getElementById("docs"),
  empty:          document.getElementById("empty"),
  refresh:        document.getElementById("refresh"),
  settings:       document.getElementById("settings"),
  settingsToggle: document.getElementById("settings-toggle"),
  apiKeyInput:    document.getElementById("api-key-input"),
  keyVisibility:  document.getElementById("key-visibility"),
  saveKey:        document.getElementById("save-key"),
  keyStatus:      document.getElementById("key-status")
};

const fallbackTabId = normalizeTabId(new URLSearchParams(location.search).get("tabId"));

// --- API key management ---
(async () => {
  const key = await getApiKey();
  if (key) {
    els.apiKeyInput.value = key;
    showKeyStatus("Key saved.", "ok");
  } else {
    openSettings();
  }
})();

els.settingsToggle.addEventListener("click", () => {
  if (els.settings.hidden) openSettings(); else closeSettings();
});

els.keyVisibility.addEventListener("click", () => {
  const showing = els.apiKeyInput.type === "text";
  els.apiKeyInput.type = showing ? "password" : "text";
  els.keyVisibility.textContent = showing ? "Show" : "Hide";
});

els.saveKey.addEventListener("click", async () => {
  const key = els.apiKeyInput.value.trim();
  if (!key) { showKeyStatus("Enter a key first.", "err"); return; }
  await putApiKey(key);
  showKeyStatus("Saved — analysing any ready documents…", "ok");
  closeSettings();
  const resp = await chrome.runtime.sendMessage({
    kind: MSG.PANEL_REQUEST_STATE,
    tabId: fallbackTabId
  }).catch(() => null);
  for (const doc of resp?.state?.documents || []) {
    if (doc.status === "ready" && !doc.analysisStatus) {
      chrome.runtime.sendMessage({
        kind: MSG.PANEL_ANALYSE_DOC,
        url: doc.url,
        tabId: fallbackTabId
      }).catch(() => {});
    }
  }
});

function openSettings() {
  els.settings.hidden = false;
  els.settingsToggle.classList.add("tca-settings-open");
  els.apiKeyInput.focus();
}

function closeSettings() {
  els.settings.hidden = true;
  els.settingsToggle.classList.remove("tca-settings-open");
}

function showKeyStatus(text, cls) {
  els.keyStatus.textContent = text;
  els.keyStatus.className = `tca-key-status ${cls}`;
}

// --- Open analyze page ---
document.getElementById("open-analyze").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/analyze/analyze.html") });
});

// --- State ---
els.refresh.addEventListener("click", requestState);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind === MSG.PANEL_STATE && msg.state) render(msg.state);
});

chrome.tabs.onActivated.addListener(requestState);
chrome.tabs.onUpdated.addListener((_tabId, info) => { if (info.status === "complete") requestState(); });

requestState();

async function requestState() {
  const resp = await chrome.runtime.sendMessage({
    kind: MSG.PANEL_REQUEST_STATE,
    tabId: fallbackTabId
  }).catch(() => null);
  render(resp?.state || null);
}

function render(state) {
  if (!state) {
    els.title.textContent = "—";
    els.url.textContent = "—"; els.url.removeAttribute("href");
    setBadge(els.type, "—", "other");
    els.docs.innerHTML = "";
    els.empty.hidden = false;
    els.empty.textContent = "No data for this tab yet. Open a page with sign-up, checkout, or policy links.";
    return;
  }

  els.title.textContent = state.pageTitle || "(untitled)";
  els.url.textContent = state.pageUrl;
  els.url.href = state.pageUrl;
  const pt = state.pageType?.type || "other";
  setBadge(els.type, pt, pt);
  els.type.title = (state.pageType?.reasons || []).join(", ");

  els.docs.innerHTML = "";
  if (!state.documents?.length) {
    els.empty.hidden = false;
    els.empty.textContent = "No terms, privacy, cookie or subscription links detected on this page.";
    return;
  }
  els.empty.hidden = true;
  for (const doc of state.documents) els.docs.appendChild(renderDoc(doc));
}

function renderDoc(doc) {
  const li = document.createElement("li");
  li.className = "tca-doc";

  const head = document.createElement("div");
  head.className = "tca-doc-head";

  const typeBadge = document.createElement("span");
  typeBadge.className = "tca-badge";
  typeBadge.textContent = doc.type;
  head.appendChild(typeBadge);

  const title = document.createElement("div");
  title.className = "tca-doc-title";
  title.textContent = doc.title || docDisplayName(doc.url);
  head.appendChild(title);

  const status = document.createElement("span");
  status.className = `tca-status ${doc.status}`;
  status.textContent = doc.status;
  head.appendChild(status);

  li.appendChild(head);

  const link = document.createElement("a");
  link.className = "tca-doc-url";
  link.href = doc.url; link.target = "_blank"; link.rel = "noreferrer";
  link.textContent = doc.url;
  li.appendChild(link);

  const meta = document.createElement("div");
  meta.className = "tca-doc-meta";
  if (doc.status === "ready") {
    meta.innerHTML = `Extracted ${fmtDate(doc.extractedAt)} · ${fmtNum(doc.textLength)} chars · <code>${(doc.hash || "").slice(0, 12)}…</code>`;
  } else if (doc.status === "error") {
    meta.textContent = `Failed: ${doc.error}`;
  } else if (doc.status === "fetching") {
    meta.textContent = "Fetching and extracting text…";
  } else {
    meta.textContent = "Waiting to fetch…";
  }
  li.appendChild(meta);

  if (doc.status === "ready") li.appendChild(renderAnalysis(doc));

  return li;
}

function renderAnalysis(doc) {
  const section = document.createElement("div");
  section.className = "tca-analysis";

  if (!doc.analysisStatus) {
    const btn = document.createElement("button");
    btn.className = "tca-btn tca-analyse-btn";
    btn.textContent = "Analyse";
    btn.addEventListener("click", () => triggerAnalysis(doc.url));
    section.appendChild(btn);
    return section;
  }

  if (doc.analysisStatus === "analysing") {
    const p = document.createElement("p");
    p.className = "tca-analysis-loading";
    const spinner = document.createElement("span");
    spinner.className = "tca-spinner";
    p.appendChild(spinner);
    p.appendChild(document.createTextNode("Analysing with AI…"));
    section.appendChild(p);
    return section;
  }

  if (doc.analysisStatus === "error") {
    const p = document.createElement("p");
    p.className = "tca-analysis-error";
    p.textContent = `Analysis failed: ${doc.analysisError}`;
    section.appendChild(p);
    const btn = document.createElement("button");
    btn.className = "tca-btn tca-analyse-btn";
    btn.textContent = "Retry";
    btn.addEventListener("click", () => triggerAnalysis(doc.url));
    section.appendChild(btn);
    return section;
  }

  if (doc.analysisStatus === "ready" && doc.analysis) {
    const a = doc.analysis;

    section.appendChild(verdictBanner(a.verdict, a.verdictReason));

    const scores = document.createElement("div");
    scores.className = "tca-scores";
    scores.appendChild(scoreChip("Risk", a.riskScore, "", { inverse: true }));
    scores.appendChild(scoreChip("Transparency", a.transparencyScore, a.transparencyReason));
    if (a.gdpr) scores.appendChild(scoreChip("GDPR", a.gdpr.score));
    section.appendChild(scores);

    if (a.summary?.length) {
      section.appendChild(analysisLabel("Summary"));
      const ul = document.createElement("ul");
      ul.className = "tca-bullets";
      for (const b of a.summary) {
        const li = document.createElement("li");
        li.textContent = b;
        ul.appendChild(li);
      }
      section.appendChild(ul);
    }

    if (a.redFlags?.length) {
      section.appendChild(analysisLabel("Red flags"));
      const ul = document.createElement("ul");
      ul.className = "tca-flags";
      for (const f of a.redFlags) {
        const li = document.createElement("li");
        li.className = `tca-flag tca-flag-${f.severity}`;
        const icon = document.createElement("span");
        icon.className = "tca-flag-icon";
        icon.textContent = flagIcon(f.severity);
        li.appendChild(icon);
        li.appendChild(document.createTextNode(f.text));
        ul.appendChild(li);
      }
      section.appendChild(ul);
    }

    if (a.actionItems?.length) {
      section.appendChild(analysisLabel("Before you accept"));
      const ul = document.createElement("ul");
      ul.className = "tca-bullets";
      for (const item of a.actionItems) {
        const li = document.createElement("li");
        li.textContent = item;
        ul.appendChild(li);
      }
      section.appendChild(ul);
    }

    if (a.gdpr && (a.gdpr.present?.length || a.gdpr.missing?.length)) {
      section.appendChild(analysisLabel("GDPR"));
      const grid = document.createElement("div");
      grid.className = "tca-gdpr";
      for (const item of (a.gdpr.present || [])) {
        const span = document.createElement("span");
        span.className = "tca-gdpr-item ok";
        span.textContent = "✓ " + item;
        grid.appendChild(span);
      }
      for (const item of (a.gdpr.missing || [])) {
        const span = document.createElement("span");
        span.className = "tca-gdpr-item miss";
        span.textContent = "✗ " + item;
        grid.appendChild(span);
      }
      section.appendChild(grid);
    }

    if (a.clauses?.length) {
      section.appendChild(analysisLabel("Clause Coverage"));
      section.appendChild(clauseGrid(a.clauses));
    }
  }

  return section;
}

async function triggerAnalysis(url) {
  await chrome.runtime.sendMessage({
    kind: MSG.PANEL_ANALYSE_DOC,
    url,
    tabId: fallbackTabId
  }).catch(() => {});
}

function setBadge(el, text, kind) {
  el.textContent = text;
  el.className = `tca-badge type-${kind}`;
}

function docDisplayName(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last).replace(/[-_]/g, " ") : u.hostname;
  } catch {
    return url;
  }
}

function fmtNum(n) { return new Intl.NumberFormat().format(n || 0); }

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString();
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString();
  } catch { return iso; }
}

function normalizeTabId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
