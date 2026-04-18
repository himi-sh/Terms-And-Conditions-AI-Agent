export const MSG = {
  CONTENT_REPORT: "content/report",
  PANEL_REQUEST_STATE: "panel/requestState",
  PANEL_STATE: "panel/state",
  PANEL_ANALYSE_DOC: "panel/analyseDoc",  // { url } → triggers analysis for one doc
  ANALYZE_SUBMIT: "analyze/submit"         // { mode: "url"|"text", content } → { ok, text, analysis }
};
