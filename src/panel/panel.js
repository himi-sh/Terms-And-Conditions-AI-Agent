import { MSG } from "../shared/messages.js";
import { getApiKey, putApiKey } from "../shared/storage.js";

const els = {
  title: document.getElementById("page-title"),
  url: document.getElementById("page-url"),
  type: document.getElementById("page-type"),
  docs: document.getElementById("docs"),
  empty: document.getElementById("empty"),
  refresh: document.getElementById("refresh"),
  apiKeyInput: document.getElementById("api-key-input"),
  saveKey: document.getElementById("save-key"),
  keyStatus: document.getElementById("key-status")
};

// --- API key management ---
(async () => {
  const key = await getApiKey();
  if (key) {
    els.apiKeyInput.value = key;
    showKeyStatus("Key saved.", "ok");
  }
})();

els.saveKey.addEventListener("click", async () => {
  const key = els.apiKeyInput.value.trim();
  if (!key) { showKeyStatus("Enter a key first.", "err"); return; }
  await putApiKey(key);
  showKeyStatus("Saved — analysing any ready documents…", "ok");
  // Trigger analysis for all ready-but-unanalysed docs
  const resp = await chrome.runtime.sendMessage({ kind: MSG.PANEL_REQUEST_STATE }).catch(() => null);
  for (const doc of resp?.state?.documents || []) {
    if (doc.status === "ready" && !doc.analysisStatus) {
      chrome.runtime.sendMessage({ kind: MSG.PANEL_ANALYSE_DOC, url: doc.url }).catch(() => {});
    }
  }
});

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
  const resp = await chrome.runtime.sendMessage({ kind: MSG.PANEL_REQUEST_STATE }).catch(() => null);
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
  title.textContent = doc.title || doc.text || doc.url;
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
      for (const b of a.summary) { const li = document.createElement("li"); li.textContent = b; ul.appendChild(li); }
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
      for (const item of a.actionItems) { const li = document.createElement("li"); li.textContent = item; ul.appendChild(li); }
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
  }

  return section;
}

function analysisLabel(text) {
  const div = document.createElement("div");
  div.className = "tca-analysis-label";
  div.textContent = text;
  return div;
}

function verdictBanner(verdict, reason) {
  const div = document.createElement("div");
  const normalized = normalizeVerdict(verdict);
  div.className = `tca-verdict tca-verdict-${normalized}`;

  const icon = document.createElement("span");
  icon.className = "tca-verdict-icon";
  icon.textContent = verdictIcon(normalized);
  div.appendChild(icon);

  const body = document.createElement("div");
  body.className = "tca-verdict-body";

  const title = document.createElement("div");
  title.className = "tca-verdict-title";
  title.textContent = verdictText(normalized);
  body.appendChild(title);

  const reasonEl = document.createElement("div");
  reasonEl.className = "tca-verdict-reason";
  reasonEl.textContent = reason || defaultVerdictReason(normalized);
  body.appendChild(reasonEl);

  div.appendChild(body);
  return div;
}

function scoreChip(label, score, reason, opts = {}) {
  const chip = document.createElement("div");
  chip.className = "tca-score-chip";
  if (reason) chip.title = reason;
  const cls = scoreClass(score, opts.inverse);

  const num = document.createElement("span");
  num.className = `tca-score-num ${cls}`;
  num.textContent = score != null ? score : "—";
  chip.appendChild(num);

  const lbl = document.createElement("span");
  lbl.className = "tca-score-label";
  lbl.textContent = label;
  chip.appendChild(lbl);

  const bar = document.createElement("div");
  bar.className = "tca-score-bar";
  const fill = document.createElement("div");
  fill.className = `tca-score-fill ${cls}`;
  fill.style.width = "0%";
  bar.appendChild(fill);
  chip.appendChild(bar);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.width = `${score ?? 0}%`;
  }));

  return chip;
}

function scoreClass(score, inverse = false) {
  if (score == null) return "";
  if (inverse) {
    if (score >= 70) return "bad";
    if (score >= 40) return "warn";
    return "good";
  }
  if (score >= 70) return "good";
  if (score >= 40) return "warn";
  return "bad";
}

async function triggerAnalysis(url) {
  await chrome.runtime.sendMessage({ kind: MSG.PANEL_ANALYSE_DOC, url }).catch(() => {});
}

function setBadge(el, text, kind) {
  el.textContent = text;
  el.className = `tca-badge type-${kind}`;
}
function fmtNum(n) { return new Intl.NumberFormat().format(n || 0); }
function fmtDate(iso) { try { return new Date(iso).toLocaleTimeString(); } catch { return iso; } }

function normalizeVerdict(v) {
  const s = String(v || "").toLowerCase();
  if (s === "safe" || s === "caution" || s === "avoid") return s;
  return "caution";
}

function verdictText(v) {
  if (v === "safe") return "Likely safe";
  if (v === "avoid") return "Avoid accepting";
  return "Proceed with caution";
}

function defaultVerdictReason(v) {
  if (v === "safe") return "No major risks were detected in this policy.";
  if (v === "avoid") return "This policy contains multiple high-risk clauses for users.";
  return "Some important terms should be reviewed before accepting.";
}

function verdictIcon(v) {
  if (v === "safe") return "✅";
  if (v === "avoid") return "🚫";
  return "⚠️";
}

function flagIcon(severity) {
  if (severity === "high") return "🔴";
  if (severity === "medium") return "🟡";
  return "🔵";
}
