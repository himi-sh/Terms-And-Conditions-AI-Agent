import { MSG } from "../shared/messages.js";
import { putDocument, getDocument, putTabState, getTabState, clearTabState, sha256Hex } from "../shared/storage.js";

// Open side panel when the toolbar action is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => { clearTabState(tabId).catch(() => {}); });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.kind === MSG.CONTENT_REPORT) {
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    handleContentReport(tabId, msg.payload).catch(err => console.error("[TCA] report failed", err));
    return;
  }

  if (msg.kind === MSG.PANEL_REQUEST_STATE) {
    (async () => {
      const tabId = await currentTabId();
      const state = tabId ? await getTabState(tabId) : null;
      sendResponse({ kind: MSG.PANEL_STATE, state });
    })();
    return true; // async response
  }
});

async function currentTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ?? null;
}

async function handleContentReport(tabId, payload) {
  const existing = await getTabState(tabId);
  const prevLinks = new Map((existing?.documents || []).map(d => [d.url, d]));

  const documents = payload.links.map(link => {
    const prev = prevLinks.get(link.url);
    return prev ? { ...prev, ...link } : {
      ...link,
      status: "pending",
      extractedAt: null,
      finalUrl: null,
      textLength: 0,
      hash: null,
      error: null
    };
  });

  const state = {
    pageUrl: payload.pageUrl,
    pageTitle: payload.pageTitle,
    pageType: payload.pageType,
    observedAt: payload.observedAt,
    documents
  };
  await putTabState(tabId, state);
  broadcastState(tabId, state);

  // Kick off extraction for documents that haven't been fetched yet.
  for (const doc of documents) {
    if (doc.status === "ready") continue;
    extractOne(tabId, doc.url).catch(err => console.error("[TCA] extract failed", doc.url, err));
  }
}

async function extractOne(tabId, url) {
  await updateDocStatus(tabId, url, { status: "fetching", error: null });
  try {
    const res = await fetch(url, { credentials: "omit", redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const { text, title } = extractReadableText(html);
    if (!text || text.length < 200) throw new Error("document too short to be a real policy");
    const hash = await sha256Hex(text);
    await putDocument({
      hash,
      url,
      finalUrl: res.url,
      title,
      text,
      extractedAt: new Date().toISOString(),
      textLength: text.length
    });
    await updateDocStatus(tabId, url, {
      status: "ready",
      finalUrl: res.url,
      textLength: text.length,
      hash,
      extractedAt: new Date().toISOString(),
      title
    });
  } catch (err) {
    await updateDocStatus(tabId, url, { status: "error", error: String(err?.message || err) });
  }
}

async function updateDocStatus(tabId, url, patch) {
  const state = await getTabState(tabId);
  if (!state) return;
  const documents = state.documents.map(d => d.url === url ? { ...d, ...patch } : d);
  const next = { ...state, documents };
  await putTabState(tabId, next);
  broadcastState(tabId, next);
}

function broadcastState(tabId, state) {
  chrome.runtime.sendMessage({ kind: MSG.PANEL_STATE, tabId, state }).catch(() => {});
}

// --- HTML → readable text ---------------------------------------------------
// Minimal, dependency-free extractor. Strips scripts/styles/nav/footer/aside
// and nav-like sections, then returns concatenated text from <main>/<article>
// or the body fallback.
function extractReadableText(html) {
  // Service worker has no DOMParser; use regex pre-strip, then offload to an
  // offscreen-free approach by letting DOMParser run here via the sandboxed
  // pattern: we reconstruct structure with a tiny tag stripper instead.
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

  const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(stripTags(titleMatch[1])).trim() : "";

  // Prefer <main> or <article> if present.
  const main = pickFirst(cleaned, [/<main\b[\s\S]*?<\/main>/i, /<article\b[\s\S]*?<\/article>/i]);
  const body = main || pickBody(cleaned) || cleaned;

  const text = decodeEntities(
    body
      .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/section)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map(l => l.trim()).filter(Boolean).join("\n");

  return { text, title };
}

function pickFirst(src, patterns) {
  for (const re of patterns) { const m = src.match(re); if (m) return m[0]; }
  return null;
}
function pickBody(src) {
  const m = src.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : null;
}
function stripTags(s) { return s.replace(/<[^>]+>/g, ""); }
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
