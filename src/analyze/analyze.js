import { MSG } from "../shared/messages.js";
import * as pdfjsLib from "../lib/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("src/lib/pdf.worker.min.mjs");

let mode = "url";

const modeUrlBtn  = document.getElementById("mode-url");
const modeTextBtn = document.getElementById("mode-text");
const modeFileBtn = document.getElementById("mode-file");
const urlWrap     = document.getElementById("url-input-wrap");
const textWrap    = document.getElementById("text-input-wrap");
const fileWrap    = document.getElementById("file-input-wrap");
const urlInput    = document.getElementById("url-input");
const textInput   = document.getElementById("text-input");
const fileInput   = document.getElementById("file-input");
const fileNameEl  = document.getElementById("file-name");
const submitBtn   = document.getElementById("submit");
const statusEl    = document.getElementById("status");
const resultsEl   = document.getElementById("results");

modeUrlBtn.addEventListener("click",  () => setMode("url"));
modeTextBtn.addEventListener("click", () => setMode("text"));
modeFileBtn.addEventListener("click", () => setMode("file"));

fileInput.addEventListener("change", () => updateFileName(fileInput.files[0]));

const dropZone = document.getElementById("file-drop-zone");
dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const f = e.dataTransfer.files[0];
  if (f) {
    const dt = new DataTransfer();
    dt.items.add(f);
    fileInput.files = dt.files;
    updateFileName(f);
  }
});

function updateFileName(f) {
  if (f) {
    fileNameEl.textContent = f.name;
    fileNameEl.classList.add("selected");
  } else {
    fileNameEl.textContent = "Drop a file here or click to browse";
    fileNameEl.classList.remove("selected");
  }
}

function setMode(m) {
  mode = m;
  urlWrap.hidden  = m !== "url";
  textWrap.hidden = m !== "text";
  fileWrap.hidden = m !== "file";
  modeUrlBtn.classList.toggle("ana-mode-active",  m === "url");
  modeTextBtn.classList.toggle("ana-mode-active", m === "text");
  modeFileBtn.classList.toggle("ana-mode-active", m === "file");
}

submitBtn.addEventListener("click", async () => {
  if (mode === "file") {
    const file = fileInput.files[0];
    if (!file) { showStatus("Choose a file first.", "error"); return; }
    submitBtn.disabled = true;
    resultsEl.hidden = true;
    showStatus("Reading file…", "loading");
    let text;
    try {
      text = await readFileAsText(file);
    } catch (err) {
      submitBtn.disabled = false;
      showStatus("Could not read file: " + err.message, "error");
      return;
    }
    if (!text || text.length < 100) {
      submitBtn.disabled = false;
      showStatus("File appears empty or could not be parsed. For PDFs, ensure the file contains selectable text (not scanned images).", "error");
      return;
    }
    showStatus("Analyzing… this may take a few seconds.", "loading");
    const resp = await chrome.runtime.sendMessage({ kind: MSG.ANALYZE_SUBMIT, mode: "text", content: text })
      .catch(err => ({ ok: false, error: String(err) }));
    submitBtn.disabled = false;
    if (!resp?.ok) { showStatus(resp?.error || "Analysis failed.", "error"); return; }
    hideStatus();
    renderResults(resp.text, resp.analysis);
    return;
  }

  const content = mode === "url"
    ? urlInput.value.trim()
    : textInput.value.trim();

  if (!content) {
    showStatus(mode === "url" ? "Enter a URL first." : "Paste some text first.", "error");
    return;
  }

  submitBtn.disabled = true;
  resultsEl.hidden = true;
  showStatus("Analyzing… this may take a few seconds.", "loading");

  const resp = await chrome.runtime.sendMessage({ kind: MSG.ANALYZE_SUBMIT, mode, content })
    .catch(err => ({ ok: false, error: String(err) }));

  submitBtn.disabled = false;

  if (!resp?.ok) {
    showStatus(resp?.error || "Analysis failed.", "error");
    return;
  }

  hideStatus();
  renderResults(resp.text, resp.analysis);
});

async function readFileAsText(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "pdf") return extractTextFromPdf(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.readAsText(file);
  });
}

async function extractTextFromPdf(buffer) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(" "));
  }
  return pages.join("\n").replace(/\s+/g, " ").trim();
}

function showStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = `ana-status ${cls}`;
  statusEl.hidden = false;
}
function hideStatus() { statusEl.hidden = true; }

function renderResults(rawText, analysis) {
  // Verdict
  const verdictEl = document.getElementById("verdict");
  const verdict = normalizeVerdict(analysis.verdict);
  verdictEl.className = `ana-verdict ana-section tca-verdict tca-verdict-${verdict}`;
  verdictEl.innerHTML = "";

  const vIcon = document.createElement("span");
  vIcon.className = "tca-verdict-icon";
  vIcon.textContent = verdictIcon(verdict);
  verdictEl.appendChild(vIcon);

  const vBody = document.createElement("div");
  vBody.className = "tca-verdict-body";
  const vTitle = document.createElement("div");
  vTitle.className = "tca-verdict-title";
  vTitle.textContent = verdictText(verdict);
  const vReason = document.createElement("div");
  vReason.className = "tca-verdict-reason";
  vReason.textContent = analysis.verdictReason || defaultVerdictReason(verdict);
  vBody.appendChild(vTitle);
  vBody.appendChild(vReason);
  verdictEl.appendChild(vBody);
  verdictEl.hidden = false;

  // Scores
  const scoresEl = document.getElementById("scores");
  scoresEl.innerHTML = "";
  scoresEl.appendChild(scoreChip("Risk", analysis.riskScore, "", { inverse: true }));
  scoresEl.appendChild(scoreChip("Transparency", analysis.transparencyScore, analysis.transparencyReason));
  if (analysis.gdpr) scoresEl.appendChild(scoreChip("GDPR", analysis.gdpr.score));

  // Summary
  const summaryEl = document.getElementById("summary");
  summaryEl.innerHTML = "";
  for (const s of (analysis.summary || [])) {
    const li = document.createElement("li");
    li.textContent = s;
    summaryEl.appendChild(li);
  }

  // Red flags
  const flagsLabel = document.getElementById("flags-label");
  const flagsList  = document.getElementById("flags");
  const hasFlags = analysis.redFlags?.length > 0;
  flagsLabel.hidden = !hasFlags;
  flagsList.hidden  = !hasFlags;
  flagsList.innerHTML = "";
  for (const f of (analysis.redFlags || [])) {
    const li = document.createElement("li");
    li.className = `tca-flag tca-flag-${f.severity}`;
    const icon = document.createElement("span");
    icon.className = "tca-flag-icon";
    icon.textContent = flagIcon(f.severity);
    li.appendChild(icon);
    li.appendChild(document.createTextNode(f.text));
    flagsList.appendChild(li);
  }

  // GDPR
  const gdprLabel = document.getElementById("gdpr-label");
  const gdprEl    = document.getElementById("gdpr");
  const hasGdpr   = analysis.gdpr && (analysis.gdpr.present?.length || analysis.gdpr.missing?.length);
  gdprLabel.hidden = !hasGdpr;
  gdprEl.hidden    = !hasGdpr;
  gdprEl.innerHTML = "";
  for (const item of (analysis.gdpr?.present || [])) {
    const span = document.createElement("span");
    span.className = "tca-gdpr-item ok";
    span.textContent = "✓ " + item;
    gdprEl.appendChild(span);
  }
  for (const item of (analysis.gdpr?.missing || [])) {
    const span = document.createElement("span");
    span.className = "tca-gdpr-item miss";
    span.textContent = "✗ " + item;
    gdprEl.appendChild(span);
  }

  // Action items
  const actionsLabel = document.getElementById("actions-label");
  const actionsEl = document.getElementById("actions");
  const hasActions = analysis.actionItems?.length > 0;
  actionsLabel.hidden = !hasActions;
  actionsEl.hidden = !hasActions;
  actionsEl.innerHTML = "";
  for (const item of (analysis.actionItems || [])) {
    const li = document.createElement("li");
    li.textContent = item;
    actionsEl.appendChild(li);
  }

  // Source text with highlighted red flags
  document.getElementById("source-text").innerHTML =
    highlightText(rawText, analysis.redFlags || []);

  resultsEl.hidden = false;
  resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function highlightText(rawText, redFlags) {
  // Build ranges from verbatim quotes provided by the AI
  const ranges = [];
  const lower = rawText.toLowerCase();
  for (const f of redFlags) {
    const q = f.quote?.trim();
    if (!q || q.length < 8) continue;
    const lq    = q.toLowerCase();
    let idx = 0;
    while (true) {
      const pos = lower.indexOf(lq, idx);
      if (pos === -1) break;
      ranges.push({ start: pos, end: pos + q.length, severity: f.severity });
      idx = pos + 1;
    }
  }

  if (!ranges.length) return escapeHtml(rawText);

  // Sort and merge overlapping ranges, keeping highest severity
  const SEV = { high: 3, medium: 2, low: 1 };
  ranges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && r.start <= prev.end) {
      prev.end = Math.max(prev.end, r.end);
      if ((SEV[r.severity] || 0) > (SEV[prev.severity] || 0)) prev.severity = r.severity;
    } else {
      merged.push({ ...r });
    }
  }

  // Build HTML segments
  let html = "";
  let pos = 0;
  for (const { start, end, severity } of merged) {
    html += escapeHtml(rawText.slice(pos, start));
    html += `<mark class="rf-${severity}">${escapeHtml(rawText.slice(start, end))}</mark>`;
    pos = end;
  }
  html += escapeHtml(rawText.slice(pos));
  return html;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
