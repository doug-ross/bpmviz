/*
 * BPMVIZ fuzzy: matches activity names from an event log to process steps.
 * Names are normalized (case, accents, punctuation and "&" ignored). Equal
 * normalized names are an exact match. Otherwise the similarity is the
 * higher of the token Jaccard index (shared words) and the normalized
 * Levenshtein similarity (spelling), and a step is suggested from SUGGEST
 * (0.75) upwards. A
 * suggestion is never confirmed on its own: a person ticks it.
 * Owned by the event-log import feature (mining slice); see docs/extensions.md.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else { const B = root.BPMVIZ = root.BPMVIZ || {}; B.fuzzy = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SUGGEST = 0.75;

  function normalize(text) {
    return String(text == null ? "" : text).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function tokens(text) {
    const n = normalize(text);
    return n ? n.split(" ") : [];
  }

  /** Jaccard index of two token lists (as sets): shared / all. */
  function jaccard(a, b) {
    const x = new Set(a), y = new Set(b);
    if (!x.size && !y.size) return 1;
    let shared = 0;
    x.forEach(t => { if (y.has(t)) shared++; });
    return shared / (x.size + y.size - shared);
  }

  /** Edit distance (insertions, deletions and substitutions). */
  function levenshtein(a, b) {
    const s = String(a), t = String(b);
    if (s === t) return 0;
    if (!s.length) return t.length;
    if (!t.length) return s.length;
    let prev = new Array(t.length + 1);
    let cur = new Array(t.length + 1);
    for (let j = 0; j <= t.length; j++) prev[j] = j;
    for (let i = 1; i <= s.length; i++) {
      cur[0] = i;
      const c = s.charCodeAt(i - 1);
      for (let j = 1; j <= t.length; j++) {
        const cost = c === t.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const swap = prev; prev = cur; cur = swap;
    }
    return prev[t.length];
  }

  /** 1 minus the edit distance over the longer length. */
  function levenshteinRatio(a, b) {
    const max = Math.max(String(a).length, String(b).length);
    return max ? 1 - levenshtein(a, b) / max : 1;
  }

  /** Similarity of two names between 0 and 1; 1 means the normalized names are equal. */
  function similarity(a, b) {
    const na = normalize(a), nb = normalize(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    return Math.max(jaccard(na.split(" "), nb.split(" ")), levenshteinRatio(na, nb));
  }

  /*
   * The best upper bound for similarity before computing the edit distance:
   * the Levenshtein ratio can never exceed the shorter length over the longer.
   */
  function bound(na, ta, nb, tb) {
    const lenRatio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    return Math.max(jaccard(ta, tb), lenRatio);
  }

  /**
   * Proposes a step for each activity.
   * activities: [{ name, events }] or names; steps: [{ id, label }].
   * Returns [{ activity, events, nodeId, method, score, confirmed }] where
   * method is "exact" (confirmed), "fuzzy" (not confirmed) or null (no match).
   * options.threshold overrides SUGGEST.
   */
  function matchActivities(activities, steps, options) {
    const threshold = options && Number.isFinite(options.threshold) ? options.threshold : SUGGEST;
    const prepared = (steps || []).map(st => {
      const n = normalize(st.label);
      return { id: st.id, n, t: n ? n.split(" ") : [] };
    }).filter(st => st.n);
    const exact = new Map();
    prepared.forEach(st => { if (!exact.has(st.n)) exact.set(st.n, st.id); });
    return (activities || []).map(a => {
      const name = typeof a === "string" ? a : a.name;
      const events = typeof a === "string" ? 0 : (a.events || 0);
      const n = normalize(name);
      if (n && exact.has(n)) return { activity: name, events, nodeId: exact.get(n), method: "exact", score: 1, confirmed: true };
      let best = null, bestScore = 0;
      if (n) {
        const t = n.split(" ");
        prepared.forEach(st => {
          if (bound(n, t, st.n, st.t) < threshold) return;
          const score = Math.max(jaccard(t, st.t), levenshteinRatio(n, st.n));
          if (score > bestScore) { best = st; bestScore = score; }
        });
      }
      if (best && bestScore >= threshold) {
        return { activity: name, events, nodeId: best.id, method: "fuzzy", score: Math.round(bestScore * 1000) / 1000, confirmed: false };
      }
      return { activity: name, events, nodeId: null, method: null, score: 0, confirmed: false };
    });
  }

  return { SUGGEST, normalize, tokens, jaccard, levenshtein, levenshteinRatio, similarity, matchActivities };
});
