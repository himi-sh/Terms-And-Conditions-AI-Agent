import { MSG } from "../shared/messages.js";

const els = {
  title: document.getElementById("page-title"),
  url: document.getElementById("page-url"),
  type: document.getElementById("page-type"),
  docs: document.getElementById("docs"),
  empty: document.getElementById("empty"),
  refresh: document.getElementById("refresh")
};

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
  return li;
}

function setBadge(el, text, kind) {
  el.textContent = text;
  el.className = `tca-badge type-${kind}`;
}
function fmtNum(n) { return new Intl.NumberFormat().format(n || 0); }
function fmtDate(iso) { try { return new Date(iso).toLocaleTimeString(); } catch { return iso; } }
