import { OPENAI_API_KEY } from "./config.js";

const DOC_PREFIX = "doc:";
const TAB_PREFIX = "tab:";
const ANALYSIS_PREFIX = "analysis:";
const API_KEY_KEY = "apiKey";

export async function putDocument(doc) {
  await chrome.storage.local.set({ [DOC_PREFIX + doc.hash]: doc });
}

export async function getDocument(hash) {
  const key = DOC_PREFIX + hash;
  const out = await chrome.storage.local.get(key);
  return out[key] || null;
}

export async function putTabState(tabId, state) {
  await chrome.storage.local.set({ [TAB_PREFIX + tabId]: state });
}

export async function getTabState(tabId) {
  const key = TAB_PREFIX + tabId;
  const out = await chrome.storage.local.get(key);
  return out[key] || null;
}

export async function clearTabState(tabId) {
  await chrome.storage.local.remove(TAB_PREFIX + tabId);
}

export async function putAnalysis(hash, analysis) {
  await chrome.storage.local.set({
    [ANALYSIS_PREFIX + hash]: {
      hash,
      analysis,
      analyzedAt: new Date().toISOString()
    }
  });
}

export async function getAnalysis(hash) {
  const key = ANALYSIS_PREFIX + hash;
  const out = await chrome.storage.local.get(key);
  return out[key]?.analysis || null;
}

export async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function getApiKey() {
  const out = await chrome.storage.local.get(API_KEY_KEY);
  return out[API_KEY_KEY] || OPENAI_API_KEY || null;
}

export async function putApiKey(key) {
  await chrome.storage.local.set({ [API_KEY_KEY]: key });
}
