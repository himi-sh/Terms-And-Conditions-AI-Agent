export function scoreClass(score, inverse = false) {
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

export function scoreChip(label, score, reason, opts = {}) {
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

export function normalizeVerdict(v) {
  const s = String(v || "").toLowerCase();
  if (s === "safe" || s === "caution" || s === "avoid") return s;
  return "caution";
}

export function verdictText(v) {
  if (v === "safe") return "Likely safe";
  if (v === "avoid") return "Avoid accepting";
  return "Proceed with caution";
}

export function defaultVerdictReason(v) {
  if (v === "safe") return "No major risks were detected in this policy.";
  if (v === "avoid") return "This policy contains multiple high-risk clauses for users.";
  return "Some important terms should be reviewed before accepting.";
}

export function verdictIcon(v) {
  if (v === "safe") return "✅";
  if (v === "avoid") return "🚫";
  return "⚠️";
}

export function flagIcon(severity) {
  if (severity === "high") return "🔴";
  if (severity === "medium") return "🟡";
  return "🔵";
}

export function analysisLabel(text) {
  const div = document.createElement("div");
  div.className = "tca-analysis-label";
  div.textContent = text;
  return div;
}

export function verdictBanner(verdict, reason) {
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

export function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function clauseGrid(clauses) {
  const div = document.createElement("div");
  div.className = "tca-clauses";
  for (const c of (clauses || [])) {
    const span = document.createElement("span");
    span.className = `tca-clause-item tca-clause-${c.present ? c.severity : "none"}`;
    if (c.note) span.title = c.note;
    span.textContent = (c.present ? "✓ " : "– ") + c.category;
    div.appendChild(span);
  }
  return div;
}

export function highlightText(rawText, redFlags) {
  const ranges = [];
  const lower = rawText.toLowerCase();
  for (const f of redFlags) {
    const q = f.quote?.trim();
    if (!q || q.length < 8) continue;
    const lq = q.toLowerCase();
    let idx = 0;
    while (true) {
      const pos = lower.indexOf(lq, idx);
      if (pos === -1) break;
      ranges.push({ start: pos, end: pos + q.length, severity: f.severity });
      idx = pos + 1;
    }
  }

  if (!ranges.length) return escapeHtml(rawText);

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
