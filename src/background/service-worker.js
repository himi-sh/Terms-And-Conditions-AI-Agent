import { MSG } from "../shared/messages.js";
import { putDocument, getDocument, putTabState, getTabState, clearTabState, sha256Hex, getApiKey } from "../shared/storage.js";

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
    return true;
  }

  if (msg.kind === MSG.PANEL_ANALYSE_DOC) {
    (async () => {
      const tabId = await currentTabId();
      if (tabId && msg.url) {
        analyzeOne(tabId, msg.url).catch(err => console.error("[TCA] analyse failed", msg.url, err));
      }
      sendResponse({});
    })();
    return true;
  }

  if (msg.kind === MSG.ANALYZE_SUBMIT) {
    (async () => {
      try {
        const apiKey = await getApiKey();
        if (!apiKey) { sendResponse({ ok: false, error: "No API key set. Add one in the panel settings." }); return; }
        let text = msg.content;
        if (msg.mode === "url") {
          const res = await fetch(msg.content, { credentials: "omit", redirect: "follow" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const html = await res.text();
          ({ text } = extractReadableText(html));
          if (!text || text.length < 100) throw new Error("Could not extract readable text from that URL.");
        }
        const label = msg.mode === "url" ? msg.content : "(pasted text)";
        const analysis = await callOpenAI(apiKey, "document", label, text);
        sendResponse({ ok: true, text, analysis });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
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
      error: null,
      analysisStatus: null,
      analysisError: null,
      analysis: null
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

  for (const doc of documents) {
    if (doc.status === "ready") {
      if (!doc.analysisStatus || doc.analysisStatus === "error") {
        analyzeOne(tabId, doc.url).catch(err => console.error("[TCA] analyse failed", doc.url, err));
      }
      continue;
    }
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
      hash, url, finalUrl: res.url, title, text,
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
    analyzeOne(tabId, url).catch(err => console.error("[TCA] analyse failed", url, err));
  } catch (err) {
    await updateDocStatus(tabId, url, { status: "error", error: String(err?.message || err) });
  }
}

async function analyzeOne(tabId, url) {
  const apiKey = await getApiKey();
  if (!apiKey) return;

  const state = await getTabState(tabId);
  if (!state) return;
  const doc = state.documents.find(d => d.url === url);
  if (!doc || doc.status !== "ready" || doc.analysisStatus === "ready" || doc.analysisStatus === "analysing") return;

  await updateDocStatus(tabId, url, { analysisStatus: "analysing", analysisError: null });

  try {
    const fullDoc = await getDocument(doc.hash);
    if (!fullDoc) throw new Error("document text not found in storage");
    const analysis = await callOpenAI(apiKey, doc.type, url, fullDoc.text);
    await updateDocStatus(tabId, url, { analysisStatus: "ready", analysis, analysisError: null });
  } catch (err) {
    await updateDocStatus(tabId, url, { analysisStatus: "error", analysisError: String(err?.message || err), analysis: null });
  }
}

async function callOpenAI(apiKey, docType, docUrl, text) {
  const truncated = text.length > 12000 ? text.slice(0, 12000) + "\n[... truncated ...]" : text;

  const prompt = `Analyze this ${docType} document and respond ONLY with a JSON object (no markdown, no explanation).

URL: ${docUrl}

Text:
${truncated}

Required JSON structure (use exactly this schema):
{
  "summary": ["<sentence 1>", "<sentence 2>", "<sentence 3>", "<sentence 4>", "<sentence 5>"],
  "redFlags": [{"text": "<description>", "severity": "high|medium|low", "quote": "<verbatim excerpt from document, max 200 chars, or empty string>"}],
  "gdpr": {
    "score": <integer 0-100>,
    "present": ["<element found>"],
    "missing": ["<element missing>"]
  },
  "transparencyScore": <integer 0-100>,
  "transparencyReason": "<one sentence explaining the score>"
}

Rules:
- summary: exactly 5 plain-English sentences (≤20 words each) covering what the user agrees to
- redFlags: 0–8 clauses that disadvantage users; omit array if none; "quote" must be the exact verbatim sentence or phrase from the text (max 200 chars) that the flag refers to
- gdpr: check for lawful basis, data subject rights, retention periods, DPO contact, data transfers, breach notification
- transparencyScore: 0 = completely opaque legalese, 100 = clear plain English`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in OpenAI response");
  return JSON.parse(m[0]);
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
function extractReadableText(html) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

  const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(stripTags(titleMatch[1])).trim() : "";

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
