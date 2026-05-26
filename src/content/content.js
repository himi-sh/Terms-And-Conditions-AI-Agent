// Content script: runs on every page, classifies page type, discovers policy
// links, and reports findings to the background service worker.
// No imports — content scripts cannot use ES modules without bundling.

(() => {
  const MSG_CONTENT_REPORT = "content/report";
  const MSG_OPEN_PANEL     = "tca/openPanel";

  const POLICY_PATTERNS = [
    { type: "terms",        re: /\b(terms( of (service|use))?|t&c|tos|conditions of use|user agreement)\b/i },
    { type: "privacy",      re: /\b(privacy (policy|notice|statement)|data protection)\b/i },
    { type: "cookie",       re: /\b(cookie (policy|notice)|cookies)\b/i },
    { type: "subscription", re: /\b(subscription|auto[- ]renew|cancellation|refund) (terms|policy)\b/i },
    { type: "eula",         re: /\b(eula|end[- ]user licen[cs]e)\b/i }
  ];

  const SIGNUP_KEYWORDS   = /\b(sign ?up|register|create (an )?account|join (now|free)|get started)\b/i;
  const CHECKOUT_KEYWORDS = /\b(checkout|place order|pay(ment)?|billing|complete (your )?purchase)\b/i;
  const ACCOUNT_KEYWORDS  = /\b(my account|account settings|subscription|billing)\b/i;

  // --- Badge state ---
  let badgeHost      = null;
  let badgeShadow    = null;
  let badgeDismissed = false;
  let lastPageUrl    = "";

  function showBadge(count) {
    if (badgeDismissed) return;

    if (badgeHost) {
      const el = badgeShadow.querySelector(".tca-n-count");
      if (el) el.textContent = `${count} document${count !== 1 ? "s" : ""} detected`;
      return;
    }

    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });
    badgeHost   = host;
    badgeShadow = shadow;

    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed !important;
          bottom: 24px !important;
          right: 24px !important;
          z-index: 2147483647 !important;
          font-family: system-ui, -apple-system, Segoe UI, sans-serif !important;
          pointer-events: none !important;
        }
        .wrap {
          pointer-events: auto;
          background: #171a21;
          border: 1px solid #6aa7ff;
          border-radius: 10px;
          padding: 10px 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.65);
          color: #e7ecf3;
          min-width: 220px;
          max-width: 300px;
          animation: slide-in 0.22s ease;
        }
        @keyframes slide-in {
          from { transform: translateY(14px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .icon { font-size: 20px; flex-shrink: 0; line-height: 1; }
        .body { flex: 1; min-width: 0; }
        .title { font-size: 12px; font-weight: 600; color: #6aa7ff; }
        .tca-n-count { font-size: 11px; color: #8b93a1; margin-top: 2px; }
        .open-btn {
          flex-shrink: 0;
          background: transparent;
          border: 1px solid #6aa7ff;
          color: #6aa7ff;
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 11px;
          cursor: pointer;
          white-space: nowrap;
          font-family: inherit;
          transition: background 0.15s;
        }
        .open-btn:hover { background: rgba(106,167,255,0.15); }
        .close-btn {
          flex-shrink: 0;
          background: none;
          border: none;
          color: #8b93a1;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
          padding: 0;
          font-family: inherit;
        }
        .close-btn:hover { color: #e7ecf3; }
      </style>
      <div class="wrap" role="status" aria-live="polite" aria-label="Terms &amp; Conditions Agent">
        <span class="icon">📋</span>
        <div class="body">
          <div class="title">Terms Agent</div>
          <div class="tca-n-count">${count} document${count !== 1 ? "s" : ""} detected</div>
        </div>
        <button class="open-btn">Open ›</button>
        <button class="close-btn" aria-label="Dismiss">×</button>
      </div>
    `;

    shadow.querySelector(".open-btn").addEventListener("click", () => {
      chrome.runtime.sendMessage({ kind: MSG_OPEN_PANEL }).catch(() => {});
    });
    shadow.querySelector(".close-btn").addEventListener("click", () => {
      badgeDismissed = true;
      badgeHost.remove();
      badgeHost   = null;
      badgeShadow = null;
    });

    (document.body || document.documentElement).appendChild(host);
  }

  function hideBadge() {
    if (!badgeHost) return;
    badgeHost.remove();
    badgeHost   = null;
    badgeShadow = null;
  }

  // --- Page classification ---
  function classifyPageType() {
    const path  = location.pathname.toLowerCase();
    const title = (document.title || "").toLowerCase();

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
    const currentUrl = location.href;
    if (currentUrl !== lastPageUrl) {
      lastPageUrl    = currentUrl;
      badgeDismissed = false;
      hideBadge();
    }

    const pageType = classifyPageType();
    const links    = discoverPolicyLinks();

    chrome.runtime.sendMessage({
      kind: MSG_CONTENT_REPORT,
      payload: {
        pageUrl:   location.href,
        pageTitle: document.title,
        pageType,
        links,
        observedAt: new Date().toISOString()
      }
    }).catch(() => { /* service worker may be starting */ });

    if (links.length > 0) {
      showBadge(links.length);
    } else {
      hideBadge();
    }
  }

  // Initial report after idle, plus a debounced re-scan on SPA navigation.
  let scheduled = null;
  function schedule() {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(report, 400);
  }

  schedule();

  // SPA navigation hooks
  const origPush    = history.pushState;
  const origReplace = history.replaceState;
  history.pushState    = function (...args) { const r = origPush.apply(this, args);    schedule(); return r; };
  history.replaceState = function (...args) { const r = origReplace.apply(this, args); schedule(); return r; };
  window.addEventListener("popstate", schedule);

  // Re-scan when DOM changes a lot (e.g. modal sign-up that injects links)
  const mo = new MutationObserver(() => schedule());
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
