/* Langtagning – lagringslag for personlige data (status, tanker, tagger).
   Lagrer bare *endringer* oppå et grunnlag: for eieren er grunnlaget data/movies.js, for en venn er det tomt.
   IndexedDB («langtagning-user»), med localStorage som reserve. Ingenting sendes noe sted. */
(function () {
  "use strict";

  // Navnet kan få et tillegg (init("-venn")), så en testmodus får sin egen database
  let DB_NAME = "langtagning-user";
  let LS_KEY = "langtagning-user";
  const SCHEMA = 1;
  const FIELDS = ["status", "note", "tags"];

  let films = new Map();   // id → { id, tmdb_id, title, year, status?, note?, tags?, updated }
  let meta = {};
  let db = null;
  let backend = "memory";  // idb | local | memory
  let lastError = "";

  const now = () => new Date().toISOString();
  const hasData = (r) => FIELDS.some((k) => k in r);
  const sameStatus = (a, b) => !!a.seen === !!b.seen && !!a.want === !!b.want && !!a.owned === !!b.owned;
  const sameTags = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);
  const fail = (e) => { lastError = (e && (e.message || e.name)) || String(e); console.warn("Langtagning-lagring:", e); };

  // ---------- IndexedDB ----------

  function openIDB() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      setTimeout(() => finish(null), 2500);  // noen nettlesere henger i privat modus
      try {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore("films", { keyPath: "id" });
          r.result.createObjectStore("meta");
        };
        r.onsuccess = () => finish(r.result);
        r.onerror = () => { fail(r.error); finish(null); };
        r.onblocked = () => finish(null);
      } catch (e) { fail(e); finish(null); }
    });
  }

  function idbReadAll() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["films", "meta"], "readonly");
      const fr = tx.objectStore("films").getAll();
      const mr = tx.objectStore("meta").get("meta");
      tx.oncomplete = () => resolve({ films: fr.result || [], meta: mr.result || {} });
      tx.onerror = () => reject(tx.error);
    });
  }

  // Skriver endrede poster (og meta) i én transaksjon
  function idbWrite(puts, dels) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(["films", "meta"], "readwrite");
        const st = tx.objectStore("films");
        for (const r of puts) st.put(r);
        for (const id of dels) st.delete(id);
        tx.objectStore("meta").put(meta, "meta");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => { fail(tx.error); resolve(false); };
        tx.onabort = () => { fail(tx.error || "avbrutt"); resolve(false); };
      } catch (e) { fail(e); resolve(false); }
    });
  }

  function idbClear() {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(["films", "meta"], "readwrite");
        tx.objectStore("films").clear();
        tx.objectStore("meta").put(meta, "meta");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => { fail(tx.error); resolve(false); };
      } catch (e) { fail(e); resolve(false); }
    });
  }

  // ---------- localStorage (reserve) ----------

  function lsRead() {
    const raw = localStorage.getItem(LS_KEY);
    const o = raw ? JSON.parse(raw) : {};
    return { films: Array.isArray(o.films) ? o.films : [], meta: o.meta || {} };
  }
  function lsWrite() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ films: [...films.values()], meta }));
      return true;
    } catch (e) { fail(e); return false; }
  }

  // ---------- Felles ----------

  let pending = Promise.resolve();
  function persistChanges(puts, dels) {
    if (backend === "idb") pending = pending.then(() => idbWrite(puts, dels));
    else if (backend === "local") lsWrite();
    return pending;
  }

  async function init(suffix) {
    if (suffix) { DB_NAME += suffix; LS_KEY += suffix; }
    if (typeof indexedDB !== "undefined") db = await openIDB();
    if (db) {
      try {
        const d = await idbReadAll();
        backend = "idb";
        load(d);
        // Data som havnet i localStorage-reserven tidligere (f.eks. en gang IndexedDB feilet), flyttes inn
        try {
          const ls = lsRead();
          if (ls.films.length && !films.size) { load(ls); await idbWrite([...films.values()], []); }
          localStorage.removeItem(LS_KEY);
        } catch (e) { /* ikke tilgjengelig */ }
      } catch (e) { fail(e); db = null; }
    }
    if (!db) {
      try { load(lsRead()); backend = "local"; localStorage.setItem(LS_KEY + "-test", "1"); localStorage.removeItem(LS_KEY + "-test"); }
      catch (e) { fail(e); backend = "memory"; }
    }
    if (!meta.schema) meta = { schema: SCHEMA, created: now(), changesSinceExport: 0, ...meta };
    return api;
  }

  function load(d) {
    films = new Map(d.films.filter((r) => r && r.id).map((r) => [r.id, r]));
    meta = d.meta || {};
  }

  // Be nettleseren om å ikke slette dataene ved plassmangel (spørres én gang)
  function askPersist() {
    if ("persisted" in meta || !navigator.storage || !navigator.storage.persist) return;
    meta.persisted = null;
    navigator.storage.persist().then((ok) => { meta.persisted = ok; persistChanges([], []); }, () => {});
  }

  // patch: { status?, note?, tags? } – en verdi som er undefined betyr «som i grunnlaget» (feltet fjernes)
  // info: { tmdb_id, title, year } – lagres for at fila skal være lesbar og kunne matches på nytt
  function set(id, patch, info) {
    const r = { ...(films.get(id) || { id }), ...(info || {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (!FIELDS.includes(k)) continue;
      if (v === undefined) delete r[k];
      else r[k] = k === "status" ? { seen: !!v.seen, want: !!v.want, owned: !!v.owned } : k === "tags" ? [...v] : String(v);
    }
    r.updated = now();
    meta.changesSinceExport = (meta.changesSinceExport || 0) + 1;
    askPersist();
    if (hasData(r)) { films.set(id, r); return persistChanges([r], []); }
    films.delete(id);
    return persistChanges([], [id]);
  }

  function remove(id) {
    if (!films.has(id)) return pending;
    films.delete(id);
    return persistChanges([], [id]);
  }

  function clear() {
    films = new Map();
    meta = { schema: SCHEMA, created: now(), changesSinceExport: 0, name: meta.name, services: meta.services };  // innstillinger beholdes
    if (backend === "idb") return (pending = pending.then(idbClear));
    if (backend === "local") lsWrite();
    return pending;
  }

  // Fjern felt som nå er like i grunnlaget, og poster uten gjenværende felt.
  // base(rec) → { status, note, tags } eller null (ukjent film – beholdes)
  function prune(base) {
    const puts = [], dels = [];
    for (const r of films.values()) {
      const b = base(r);
      if (!b) continue;
      const before = FIELDS.filter((k) => k in r).length;
      if (r.status && sameStatus(r.status, b.status)) delete r.status;
      if ("note" in r && r.note === b.note) delete r.note;
      if (r.tags && sameTags(r.tags, b.tags)) delete r.tags;
      if (!hasData(r)) dels.push(r.id);
      else if (FIELDS.filter((k) => k in r).length !== before) puts.push(r);
    }
    for (const id of dels) films.delete(id);
    if (!films.size) meta.changesSinceExport = 0;
    if (puts.length || dels.length) persistChanges(puts, dels);
    return dels.length;
  }

  function exportJSON(opts) {
    const o = opts || {};
    const out = {
      format: "langtagning-user", schema: SCHEMA, exported: now(),
      name: o.name || meta.name || "", owner: !!o.owner,
      films: [...films.values()].sort((a, b) => (a.updated || "").localeCompare(b.updated || "")),
    };
    meta.lastExport = out.exported;
    meta.changesSinceExport = 0;
    persistChanges([], []);
    return out;
  }

  // mode: "merge" (nyeste vinner per film) eller "replace" (erstatt alt).
  // resolve(rec) → gjeldende id i katalogen, eller null hvis filmen er ukjent (beholdes med sin id).
  // Kaster Error med en forståelig melding hvis fila ikke kan brukes.
  function importJSON(obj, mode, resolve) {
    if (!obj || typeof obj !== "object" || obj.format !== "langtagning-user" || !Array.isArray(obj.films))
      throw new Error("Dette er ikke en eksportfil fra Langtagning.");
    if ((obj.schema || 1) > SCHEMA)
      throw new Error("Fila er laget av en nyere versjon av Langtagning. Last siden på nytt og prøv igjen.");
    const sum = { total: 0, added: 0, updated: 0, unchanged: 0, unknown: 0, skipped: 0 };
    const incoming = [];
    for (const raw of obj.films) {
      if (!raw || typeof raw !== "object" || (!raw.id && !raw.tmdb_id)) { sum.skipped++; continue; }
      const r = { id: String(raw.id || `tmdb:${raw.tmdb_id}`) };
      if (raw.tmdb_id) r.tmdb_id = +raw.tmdb_id;
      if (raw.title) r.title = String(raw.title);
      if (raw.year) r.year = +raw.year || undefined;
      if (raw.status && typeof raw.status === "object") r.status = { seen: !!raw.status.seen, want: !!raw.status.want, owned: !!(raw.status.owned || raw.status.dvd || raw.status.bluray) };
      if (typeof raw.note === "string") r.note = raw.note;
      if (Array.isArray(raw.tags)) r.tags = raw.tags.map(String).filter(Boolean);
      r.updated = typeof raw.updated === "string" ? raw.updated : obj.exported || now();
      if (!hasData(r)) { sum.skipped++; continue; }
      const id = resolve ? resolve(r) : r.id;
      if (id) r.id = id; else sum.unknown++;
      incoming.push(r);
    }
    if (mode === "replace") {
      films = new Map();
      if (backend === "idb") pending = pending.then(idbClear);
    }
    const puts = [];
    for (const r of incoming) {
      sum.total++;
      const old = films.get(r.id);
      if (!old) { sum.added++; films.set(r.id, r); puts.push(r); }
      else if ((r.updated || "") > (old.updated || "")) { sum.updated++; films.set(r.id, r); puts.push(r); }
      else sum.unchanged++;
    }
    if (obj.name && !meta.name) meta.name = String(obj.name);
    meta.changesSinceExport = (meta.changesSinceExport || 0) + sum.added + sum.updated;
    if (backend === "local") lsWrite();
    else persistChanges(puts, []);
    askPersist();
    return sum;
  }

  const api = {
    init, set, remove, clear, prune, exportJSON, importJSON,
    get: (id) => films.get(id) || null,
    all: () => [...films.values()],
    stats: () => ({
      films: films.size, changes: meta.changesSinceExport || 0, lastExport: meta.lastExport || "",
      created: meta.created || "", backend, persisted: meta.persisted, error: lastError,
    }),
    getMeta: (k) => meta[k],
    setMeta: (k, v) => { meta[k] = v; persistChanges([], []); },
    flush: () => pending,
  };
  window.LangtagningStore = api;
})();
