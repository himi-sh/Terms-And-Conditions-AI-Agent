import { MSG } from "../shared/messages.js";
import * as pdfjsLib from "../lib/pdf.min.mjs";
import {
  scoreChip, verdictBanner, flagIcon, highlightText, clauseGrid
} from "../shared/ui.js";

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

urlInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !submitBtn.disabled) submitBtn.click();
});

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
  showStatus(
    mode === "url" ? "Fetching and analyzing… this may take a few seconds." : "Analyzing… this may take a few seconds.",
    "loading"
  );

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
  verdictEl.innerHTML = "";
  verdictEl.appendChild(verdictBanner(analysis.verdict, analysis.verdictReason));
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

  // Clause coverage
  const clausesLabel = document.getElementById("clauses-label");
  const clausesEl    = document.getElementById("clauses");
  const hasClauses   = analysis.clauses?.length > 0;
  clausesLabel.hidden = !hasClauses;
  clausesEl.hidden    = !hasClauses;
  if (hasClauses) {
    clausesEl.innerHTML = "";
    clausesEl.appendChild(clauseGrid(analysis.clauses));
  }

  // Source text with highlighted red flags
  document.getElementById("source-text").innerHTML =
    highlightText(rawText, analysis.redFlags || []);

  resultsEl.hidden = false;
  resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
}
