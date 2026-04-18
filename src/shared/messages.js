export const MSG = {
  CONTENT_REPORT: "content/report",
  PANEL_REQUEST_STATE: "panel/requestState",
  PANEL_STATE: "panel/state",
  BG_EXTRACT_DONE: "bg/extractDone",
  BG_EXTRACT_ERROR: "bg/extractError",
  PANEL_ANALYSE_DOC: "panel/analyseDoc",  // { url } → triggers analysis for one doc
  ANALYZE_SUBMIT: "analyze/submit"         // { mode: "url"|"text", content } → { ok, text, analysis }
};
