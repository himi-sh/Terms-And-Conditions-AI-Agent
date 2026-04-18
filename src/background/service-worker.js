import { MSG } from "../shared/messages.js";
import {
  putDocument,
  getDocument,
  putAnalysis,
  getAnalysis,
  putTabState,
  getTabState,
  clearTabState,
  sha256Hex,
  getApiKey
} from "../shared/storage.js";

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
          if (!text || text.length < 100) {
            text = html
              .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
              .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim();
          }
        }
        const label = msg.mode === "url" ? msg.content : "(pasted text)";
        const textHash = await sha256Hex(text);
        const cachedAnalysis = await getAnalysis(textHash);
        const analysis = cachedAnalysis || await callOpenAI(apiKey, "document", label, text);
        if (!cachedAnalysis) await putAnalysis(textHash, analysis);
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
    const cachedAnalysis = await getAnalysis(doc.hash);
    if (cachedAnalysis) {
      await updateDocStatus(tabId, url, { analysisStatus: "ready", analysis: cachedAnalysis, analysisError: null });
      return;
    }

    const fullDoc = await getDocument(doc.hash);
    if (!fullDoc) throw new Error("document text not found in storage");
    const analysis = await callOpenAI(apiKey, doc.type, url, fullDoc.text);
    await putAnalysis(doc.hash, analysis);
    await updateDocStatus(tabId, url, { analysisStatus: "ready", analysis, analysisError: null });
  } catch (err) {
    await updateDocStatus(tabId, url, { analysisStatus: "error", analysisError: String(err?.message || err), analysis: null });
  }
}

async function callOpenAI(apiKey, docType, docUrl, text) {
  const excerpt = buildFocusedExcerpt(text, 12000);
  const prompt = `Analyze this ${docType} document and return strict JSON only.

URL: ${docUrl}

Text:
${excerpt}

Scoring guidance:
- transparencyScore: 0 = opaque legalese, 100 = clear plain language.
- gdpr.score: 0 = missing core clauses, 100 = complete and explicit.
- riskScore: 0 = very safe for user rights, 100 = very risky/unbalanced.

Decision guidance:
- verdict should be one of: "safe", "caution", "avoid".
- Prefer "avoid" when there are severe penalties, broad liability waivers, forced arbitration, or hard cancellation traps.

Rules:
- summary: exactly 5 plain-English sentences (20 words max each).
- redFlags: 0-8 user-disadvantaging clauses with verbatim quote snippets (max 200 chars each).
- gdpr: check lawful basis, data subject rights, retention periods, DPO contact, data transfers, breach notification.
- actionItems: up to 3 practical actions before accepting.`;

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  };

  const structuredPayload = {
    model: "gpt-4o-mini",
    max_tokens: 1100,
    messages: [
      { role: "system", content: "You are a strict JSON policy-risk analyzer." },
      { role: "user", content: prompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "tnc_analysis",
        strict: true,
        schema: {
          type: "object",
          properties: {
            summary: { type: "array", items: { type: "string" } },
            redFlags: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  severity: { type: "string", enum: ["high", "medium", "low"] },
                  quote: { type: "string" }
                },
                required: ["text", "severity", "quote"],
                additionalProperties: false
              }
            },
            gdpr: {
              type: "object",
              properties: {
                score: { type: "integer" },
                present: { type: "array", items: { type: "string" } },
                missing: { type: "array", items: { type: "string" } }
              },
              required: ["score", "present", "missing"],
              additionalProperties: false
            },
            transparencyScore: { type: "integer" },
            transparencyReason: { type: "string" },
            riskScore: { type: "integer" },
            verdict: { type: "string", enum: ["safe", "caution", "avoid"] },
            verdictReason: { type: "string" },
            actionItems: { type: "array", items: { type: "string" } }
          },
          required: [
            "summary",
            "redFlags",
            "gdpr",
            "transparencyScore",
            "transparencyReason",
            "riskScore",
            "verdict",
            "verdictReason",
            "actionItems"
          ],
          additionalProperties: false
        }
      }
    }
  };

  let parsed = null;
  const firstTry = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(structuredPayload)
  });

  if (firstTry.ok) {
    const data = await firstTry.json();
    const content = data.choices?.[0]?.message?.content || "";
    parsed = JSON.parse(content);
  } else {
    const errorBody = await firstTry.text().catch(() => "");
    // Older API behavior may reject json_schema; retry with classic JSON prompting.
    if (firstTry.status !== 400 || !/response_format|json_schema/i.test(errorBody)) {
      throw new Error(`OpenAI API ${firstTry.status}: ${errorBody.slice(0, 200)}`);
    }

    const legacyRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1100,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!legacyRes.ok) {
      const legacyBody = await legacyRes.text().catch(() => "");
      throw new Error(`OpenAI API ${legacyRes.status}: ${legacyBody.slice(0, 200)}`);
    }

    const legacyData = await legacyRes.json();
    const content = legacyData.choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON in OpenAI response");
    parsed = JSON.parse(match[0]);
  }

  return sanitizeAnalysis(parsed);
}

function buildFocusedExcerpt(text, maxChars) {
  const normalized = (text || "").replace(/\r/g, "").trim();
  if (normalized.length <= maxChars) return normalized;

  const headBudget = Math.floor(maxChars * 0.45);
  const tailBudget = Math.floor(maxChars * 0.2);
  const bridgeBudget = maxChars - headBudget - tailBudget - 64;

  const head = normalized.slice(0, headBudget);
  const tail = normalized.slice(-tailBudget);

  const riskHints = [
    /\barbitration\b/i,
    /\bwaive\b/i,
    /\bliability\b/i,
    /\bauto[- ]?renew\b/i,
    /\bcancel(?:lation)?\b/i,
    /\brefund\b/i,
    /\bclass action\b/i,
    /\bdata transfer\b/i,
    /\bretention\b/i,
    /\bthird[- ]party\b/i
  ];

  const selected = [];
  let budget = bridgeBudget;
  for (const rawLine of normalized.split(/\n+/)) {
    const line = rawLine.trim();
    if (line.length < 30 || line.length > 360) continue;
    if (!riskHints.some(re => re.test(line))) continue;
    if (selected.includes(line)) continue;
    if (line.length + 1 > budget) continue;
    selected.push(line);
    budget -= (line.length + 1);
    if (budget < 80) break;
  }

  const bridge = selected.join("\n");
  return `${head}\n[... middle omitted ...]\n${bridge}\n[... ending ...]\n${tail}`.slice(0, maxChars);
}

function sanitizeAnalysis(raw) {
  const summary = Array.isArray(raw?.summary)
    ? raw.summary.map(s => String(s || "").trim()).filter(Boolean).slice(0, 5)
    : [];

  const redFlags = Array.isArray(raw?.redFlags)
    ? raw.redFlags.map(flag => ({
      text: String(flag?.text || "").trim(),
      severity: normalizeSeverity(flag?.severity),
      quote: String(flag?.quote || "").trim().slice(0, 200)
    })).filter(flag => flag.text).slice(0, 8)
    : [];

  const gdprPresent = Array.isArray(raw?.gdpr?.present)
    ? raw.gdpr.present.map(v => String(v || "").trim()).filter(Boolean).slice(0, 10)
    : [];
  const gdprMissing = Array.isArray(raw?.gdpr?.missing)
    ? raw.gdpr.missing.map(v => String(v || "").trim()).filter(Boolean).slice(0, 10)
    : [];

  const gdprScore = clampScore(raw?.gdpr?.score);
  const transparencyScore = clampScore(raw?.transparencyScore);
  const transparencyReason = String(raw?.transparencyReason || "").trim();

  const riskScore = clampScore(raw?.riskScore ?? estimateRiskScore({ redFlags, gdprScore, transparencyScore }));
  const verdict = normalizeVerdict(raw?.verdict, riskScore);
  const verdictReason = String(raw?.verdictReason || defaultVerdictReason(verdict)).trim();
  const modelActionItems = Array.isArray(raw?.actionItems)
    ? raw.actionItems.map(v => String(v || "").trim()).filter(Boolean).slice(0, 3)
    : [];
  const actionItems = modelActionItems.length ? modelActionItems : defaultActionItems(redFlags, verdict);

  return {
    summary,
    redFlags,
    gdpr: {
      score: gdprScore,
      present: gdprPresent,
      missing: gdprMissing
    },
    transparencyScore,
    transparencyReason,
    riskScore,
    verdict,
    verdictReason,
    actionItems
  };
}

function normalizeSeverity(v) {
  const s = String(v || "").toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

function clampScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function estimateRiskScore({ redFlags, gdprScore, transparencyScore }) {
  let risk = Math.round((100 - transparencyScore) * 0.45 + (100 - gdprScore) * 0.3);
  for (const flag of redFlags) {
    if (flag.severity === "high") risk += 14;
    else if (flag.severity === "medium") risk += 8;
    else risk += 4;
  }
  return clampScore(risk);
}

function normalizeVerdict(value, riskScore) {
  const v = String(value || "").toLowerCase();
  if (v === "safe" || v === "caution" || v === "avoid") return v;
  if (riskScore >= 70) return "avoid";
  if (riskScore >= 40) return "caution";
  return "safe";
}

function defaultVerdictReason(verdict) {
  if (verdict === "avoid") return "This agreement includes terms that strongly disadvantage users.";
  if (verdict === "caution") return "Some clauses are acceptable, but a few important terms need review before accepting.";
  return "No major risks were found, but you should still verify key business terms.";
}

function defaultActionItems(redFlags, verdict) {
  const items = [];
  if (redFlags.some(f => /auto[- ]?renew|cancel|refund/i.test(f.text))) {
    items.push("Confirm cancellation and refund terms in writing before accepting.");
  }
  if (redFlags.some(f => /arbitration|class action|waive/i.test(f.text))) {
    items.push("Review dispute-resolution and waiver clauses to understand your legal options.");
  }
  if (redFlags.some(f => /data|share|third[- ]party|transfer/i.test(f.text))) {
    items.push("Check what personal data is shared and whether opt-out controls exist.");
  }
  if (!items.length && verdict !== "safe") {
    items.push("Do a quick manual review of payment, cancellation, and liability sections before accepting.");
  }
  return items.slice(0, 3);
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
