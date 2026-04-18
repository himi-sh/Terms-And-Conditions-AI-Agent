// Content script: runs on every page, classifies page type, discovers policy
// links, and reports findings to the background service worker.
// No imports — content scripts cannot use ES modules without bundling.

(() => {
  const MSG_CONTENT_REPORT = "content/report";

  const POLICY_PATTERNS = [
    { type: "terms",        re: /\b(terms( of (service|use))?|t&c|tos|conditions of use|user agreement)\b/i },
    { type: "privacy",      re: /\b(privacy (policy|notice|statement)|data protection)\b/i },
    { type: "cookie",       re: /\b(cookie (policy|notice)|cookies)\b/i },
    { type: "subscription", re: /\b(subscription|auto[- ]renew|cancellation|refund) (terms|policy)\b/i },
    { type: "eula",         re: /\b(eula|end[- ]user licen[cs]e)\b/i }
  ];

  const SIGNUP_KEYWORDS    = /\b(sign ?up|register|create (an )?account|join (now|free)|get started)\b/i;
  const CHECKOUT_KEYWORDS  = /\b(checkout|place order|pay(ment)?|billing|complete (your )?purchase)\b/i;
  const ACCOUNT_KEYWORDS   = /\b(my account|account settings|subscription|billing)\b/i;

  function classifyPageType() {
    const url = location.href.toLowerCase();
    const path = location.pathname.toLowerCase();
    const title = (document.title || "").toLowerCase();
    const forms = Array.from(document.forms);

    const hasPassword = !!document.querySelector('input[type="password"]');
    const hasEmail    = !!document.querySelector('input[type="email"], input[name*="email" i]');
    const hasCC       = !!document.querySelector('input[autocomplete*="cc-" i], input[name*="card" i], input[name*="cvv" i]');
    const hasRepeatPw = document.querySelectorAll('input[type="password"]').length >= 2;

    const reasons = [];

    if (hasCC || CHECKOUT_KEYWORDS.test(path) || CHECKOUT_KEYWORDS.test(title)) {
      reasons.push("checkout signals");
      return { type: "checkout", reasons };
    }
    if (hasRepeatPw || (hasPassword && hasEmail) || SIGNUP_KEYWORDS.test(path) || SIGNUP_KEYWORDS.test(title)) {
      reasons.push("signup signals");
      return { type: "signup", reasons };
    }
    if (ACCOUNT_KEYWORDS.test(path) || ACCOUNT_KEYWORDS.test(title)) {
      reasons.push("account signals");
      return { type: "account", reasons };
    }
    if (hasPassword) {
      reasons.push("password field present");
      return { type: "login", reasons };
    }
    return { type: "other", reasons: ["no strong signals"] };
  }

  function classifyLink(text, href) {
    const hay = `${text} ${href}`;
    for (const { type, re } of POLICY_PATTERNS) if (re.test(hay)) return type;
    return null;
  }

  function discoverPolicyLinks() {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const seen = new Map();
    for (const a of anchors) {
      const href = a.href;
      if (!href || !/^https?:/i.test(href)) continue;
      const text = (a.textContent || a.getAttribute("aria-label") || a.title || "").trim().slice(0, 200);
      const type = classifyLink(text, href);
      if (!type) continue;
      const key = href.split("#")[0];
      if (seen.has(key)) continue;
      seen.set(key, { type, url: href, text: text || "(no link text)" });
    }
    return [...seen.values()];
  }

  function report() {
    const pageType = classifyPageType();
    const links = discoverPolicyLinks();
    chrome.runtime.sendMessage({
      kind: MSG_CONTENT_REPORT,
      payload: {
        pageUrl: location.href,
        pageTitle: document.title,
        pageType,
        links,
        observedAt: new Date().toISOString()
      }
    }).catch(() => { /* service worker may be starting */ });
  }

  // Initial report after idle, plus a debounced re-scan on SPA navigation.
  let scheduled = null;
  function schedule() {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(report, 400);
  }

  schedule();

  // SPA navigation hooks
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) { const r = origPush.apply(this, args); schedule(); return r; };
  history.replaceState = function (...args) { const r = origReplace.apply(this, args); schedule(); return r; };
  window.addEventListener("popstate", schedule);

  // Re-scan when DOM changes a lot (e.g. modal sign-up that injects links)
  const mo = new MutationObserver(() => schedule());
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
