/*
 * AIxRay persistence: recoverable local drafts in browser storage.
 *
 * Drafts are a safety net. The engagement JSON file saved with Save is the
 * durable, portable record. Browser storage can be unavailable (private
 * windows, blocked site data, some direct-file setups) and every call reports
 * failure instead of throwing. Local storage is not encrypted.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./util.js"));
  else { const B = root.AIxRay = root.AIxRay || {}; B.persistence = factory(B.util); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util) {
  "use strict";

  const PREFIX = "aixray:";
  /* Keys written before the app was renamed from BPMVIZ. They move to PREFIX once (see moveLegacyKeys). */
  const LEGACY_PREFIX = "bpmviz:";
  const DRAFT = PREFIX + "draft:";
  const SNAPSHOTS = PREFIX + "snapshots:";
  const INDEX = PREFIX + "index";
  const PREF = PREFIX + "pref:";
  const MAX_SNAPSHOTS = 3;
  const SNAPSHOT_GAP_MS = 2 * 60 * 1000;

  function isQuota(err) {
    return err && (err.name === "QuotaExceededError" || err.code === 22 || err.code === 1014 ||
      /quota/i.test(String(err.message)));
  }

  /**
   * Moves drafts, snapshots and preferences saved under the old BPMVIZ keys to
   * the current ones, once. A key that already exists under the new name wins.
   * The two draft indexes are merged. Returns how many keys were moved.
   */
  function moveLegacyKeys(storage) {
    if (!storage) return 0;
    let moved = 0;
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(LEGACY_PREFIX)) keys.push(k);
      }
      if (!keys.length) return 0;
      const parse = raw => { try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; } };
      const oldIndex = parse(storage.getItem(LEGACY_PREFIX + "index"));
      keys.forEach(k => {
        if (k === LEGACY_PREFIX + "index" || k === LEGACY_PREFIX + "probe") return;
        const target = PREFIX + k.slice(LEGACY_PREFIX.length);
        try {
          if (storage.getItem(target) === null) { storage.setItem(target, storage.getItem(k)); moved++; }
          storage.removeItem(k);
        } catch (_) { /* storage full: leave the old key for the next attempt */ }
      });
      if (Array.isArray(oldIndex)) {
        const current = parse(storage.getItem(PREFIX + "index"));
        const seen = new Set();
        const merged = (Array.isArray(current) ? current : []).concat(oldIndex)
          .filter(x => x && typeof x.id === "string" && !seen.has(x.id) && seen.add(x.id) && storage.getItem(PREFIX + "draft:" + x.id) !== null)
          .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")))
          .slice(0, 20);
        storage.setItem(PREFIX + "index", JSON.stringify(merged));
      }
      storage.removeItem(LEGACY_PREFIX + "index");
      storage.removeItem(LEGACY_PREFIX + "probe");
    } catch (_) { /* storage blocked: nothing to move */ }
    return moved;
  }

  function createDraftStore(storage) {
    moveLegacyKeys(storage);

    function read(key) {
      try {
        const raw = storage ? storage.getItem(key) : null;
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    }

    function available() {
      if (!storage) return false;
      try {
        storage.setItem(PREFIX + "probe", "1");
        storage.removeItem(PREFIX + "probe");
        return true;
      } catch (_) {
        return false;
      }
    }

    function readIndex() {
      const idx = read(INDEX);
      return Array.isArray(idx) ? idx.filter(x => x && typeof x.id === "string") : [];
    }

    function saveDraft(engagement) {
      if (!storage) return { ok: false, reason: "unavailable", message: "Browser storage is not available." };
      const savedAt = util.nowIso();
      try {
        const previous = read(DRAFT + engagement.id);
        if (previous && previous.engagement && previous.revision !== engagement.revision) {
          const snaps = read(SNAPSHOTS + engagement.id);
          const list = Array.isArray(snaps) ? snaps : [];
          const last = list[0];
          if (!last || Date.parse(previous.savedAt) - Date.parse(last.savedAt) >= SNAPSHOT_GAP_MS) {
            list.unshift(previous);
            storage.setItem(SNAPSHOTS + engagement.id, JSON.stringify(list.slice(0, MAX_SNAPSHOTS)));
          }
        }
        storage.setItem(DRAFT + engagement.id, JSON.stringify({ savedAt, revision: engagement.revision, engagement }));
        const index = readIndex().filter(x => x.id !== engagement.id);
        index.unshift({
          id: engagement.id, savedAt, revision: engagement.revision,
          clientDisplayName: engagement.meta.clientDisplayName, processName: engagement.meta.processName
        });
        storage.setItem(INDEX, JSON.stringify(index.slice(0, 20)));
        return { ok: true, savedAt };
      } catch (err) {
        return {
          ok: false, reason: isQuota(err) ? "quota" : "unavailable",
          message: isQuota(err) ? "Browser storage is full." : "Browser storage is not available."
        };
      }
    }

    function loadDraft(id) {
      const d = read(DRAFT + id);
      return d && d.engagement ? d : null;
    }

    function listDrafts() {
      return readIndex().filter(x => loadDraftMeta(x.id))
        .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    }

    function loadDraftMeta(id) {
      try { return storage ? storage.getItem(DRAFT + id) !== null : false; } catch (_) { return false; }
    }

    function listSnapshots(id) {
      const snaps = read(SNAPSHOTS + id);
      return Array.isArray(snaps) ? snaps.map((s, i) => ({ index: i, savedAt: s.savedAt, revision: s.revision })) : [];
    }

    function loadSnapshot(id, index) {
      const snaps = read(SNAPSHOTS + id);
      return Array.isArray(snaps) && snaps[index] && snaps[index].engagement ? snaps[index] : null;
    }

    function removeDraft(id) {
      try {
        storage.removeItem(DRAFT + id);
        storage.removeItem(SNAPSHOTS + id);
        storage.setItem(INDEX, JSON.stringify(readIndex().filter(x => x.id !== id)));
        return true;
      } catch (_) {
        return false;
      }
    }

    /** Removes every draft and snapshot. Preferences such as the theme are kept. */
    function clearAll() {
      if (!storage) return false;
      try {
        const keys = [];
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k && k.startsWith(PREFIX) && !k.startsWith(PREF)) keys.push(k);
        }
        keys.forEach(k => storage.removeItem(k));
        return true;
      } catch (_) {
        return false;
      }
    }

    function getPref(key) {
      try { return storage ? storage.getItem(PREF + key) : null; } catch (_) { return null; }
    }

    function setPref(key, value) {
      try { if (storage) storage.setItem(PREF + key, String(value)); return true; } catch (_) { return false; }
    }

    return { available, saveDraft, loadDraft, listDrafts, listSnapshots, loadSnapshot, removeDraft, clearAll, getPref, setPref };
  }

  /** In-memory storage with the Web Storage interface, for tests. */
  function memoryStorage(options) {
    const map = new Map();
    const opts = options || {};
    return {
      get length() { return map.size; },
      key(i) { return [...map.keys()][i] || null; },
      getItem(k) { if (opts.failReads) throw new Error("blocked"); return map.has(k) ? map.get(k) : null; },
      setItem(k, v) {
        if (opts.failWrites) { const e = new Error("quota exceeded"); e.name = "QuotaExceededError"; throw e; }
        map.set(k, String(v));
      },
      removeItem(k) { map.delete(k); },
      clear() { map.clear(); }
    };
  }

  return { createDraftStore, memoryStorage, moveLegacyKeys, PREFIX, LEGACY_PREFIX };
});
