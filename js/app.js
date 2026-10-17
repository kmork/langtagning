/* Langtagning – visning av filmdatabasen i data/movies.js */
(function () {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const grid = $("#grid");
  const dialog = $("#detail");

  if (!Array.isArray(window.LANGTAGNING)) {
    grid.innerHTML =
      '<div class="empty" style="grid-column:1/-1"><p class="empty-title">Kunne ikke lese databasen</p>' +
      "<p>Sjekk at <code>data/movies.js</code> finnes og er gyldig JSON (doble anførselstegn, ingen komma etter siste element). " +
      "Kjør <code>python3 tools/langtagning.py check</code> for å finne feilen.</p></div>";
    return;
  }

  // ---------- Oppslag og tekst ----------

  // Priser grupperes etter det som står før « – », f.eks. «Cannes – Gullpalmen»
  const AWARD_ORDER = ["Cannes", "Berlin", "Venezia", "Locarno", "San Sebastián", "Karlovy Vary", "Sundance", "Toronto",
    "Oscar", "BAFTA", "European Film Awards", "César", "Guldbagge", "Amanda"];
  const awardGroup = (a) => a.split(" – ")[0];
  const awardName = (v) => v === "*" ? "Alle prisvinnere" : v.includes(" – ") ? v : `${v} (alle priser)`;
  const groupRank = (g) => { const i = AWARD_ORDER.indexOf(g); return i < 0 ? 99 : i; };

  const OLD_COUNTRIES = {
    SU: "Sovjetunionen", XC: "Tsjekkoslovakia", CS: "Tsjekkoslovakia", YU: "Jugoslavia",
    DD: "Øst-Tyskland", XG: "Øst-Tyskland", AN: "De nederlandske Antillene", XK: "Kosovo",
  };
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(["nb", "no"], { type: "region" }); } catch (e) { /* eldre nettleser */ }
  const countryName = (code) => {
    if (!code) return "";
    if (OLD_COUNTRIES[code]) return OLD_COUNTRIES[code];
    if (code.length !== 2) return code;
    try { return (regionNames && regionNames.of(code)) || code; } catch (e) { return code; }
  };

  const collator = new Intl.Collator("nb", { sensitivity: "base", numeric: true });
  const sortTitle = (t) => (t || "").replace(/^(the|a|an)\s+/i, "");

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const slug = (s) => String(s || "").toLowerCase().normalize("NFKD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

  const LAUREL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 20c-3-2-5-5.5-5-9.5M16 20c3-2 5-5.5 5-9.5M4.2 15.5c1.2.1 2.3-.5 2.8-1.5M3.2 11c1.2.4 2.4 0 3.2-.9M3.5 6.6c1 .7 2.3.7 3.3 0M19.8 15.5c-1.2.1-2.3-.5-2.8-1.5M20.8 11c-1.2.4-2.4 0-3.2-.9M20.5 6.6c-1 .7-2.3.7-3.3 0M12 4.5l1.2 2.4 2.6.4-1.9 1.8.5 2.6L12 10.5l-2.4 1.2.5-2.6-1.9-1.8 2.6-.4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

  // ---------- Normaliser data ----------

  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);
  const movies = window.LANGTAGNING.map((m, i) => {
    const status = m.status || {};
    const movie = {
      ...m,
      id: m.id || slug(`${m.title}-${m.year || ""}`) || `film-${i}`,
      directors: arr(m.directors),
      countries: arr(m.countries),
      awards: arr(m.awards),
      cast: arr(m.cast),
      tags: arr(m.tags),
      links: m.links || {},
      status: { seen: !!status.seen, want: !!status.want, owned: !!(status.owned || status.dvd || status.bluray) },
      decade: m.year ? `${Math.floor(m.year / 10) * 10}` : "",
      _order: i,
    };
    movie._awardVals = movie.awards.length
      ? [...new Set(["*", ...movie.awards, ...movie.awards.map(awardGroup)])] : [];
    return movie;
  });

  // ---------- Kåringer (data/lists.js – valgfri) ----------

  const LD = window.LANGTAGNING_LISTS || {};
  const lists = Array.isArray(LD.lists) ? LD.lists : [];
  const listById = new Map(lists.map((l) => [l.id, l]));
  // Rangerte kåringer (S&S, TSPDT) vs. årslister (f.eks. Cahiers' årets topp 10)
  // Grupperte lister: årslister («årets topp 10») og usorterte samlinger (f.eks. kultfilmer) – ikke i historikkgrafen
  const isAnnual = (l) => l.kind === "annual" || l.kind === "collection";
  const isColl = (s) => lists.some((l) => l.series === s && l.kind === "collection");
  const rankLists = lists.filter((l) => !isAnnual(l));
  const annualSeries = [...new Set(lists.filter(isAnnual).map((l) => l.series))];
  // Hovedlista (brukes på plakatmerket og som standard sortering): nyeste kritikerliste
  const primaryList = rankLists.filter((l) => /kritiker/i.test(l.series)).sort((a, b) => b.year - a.year)[0] || rankLists[0] || lists[0] || null;
  const seriesNames = [...new Set([...rankLists.map((l) => l.series), ...annualSeries])];
  const seriesLabel = (s) => { const t = s.split(" – ").pop(); return t.charAt(0).toUpperCase() + t.slice(1); };
  const seriesLists = (s) => lists.filter((l) => l.series === s).sort((a, b) => b.year - a.year);
  const prevInSeries = (l) => seriesLists(l.series).find((x) => x.year < l.year) || null;
  const listShort = (id) => id.startsWith("series:") ? (lists.some((l) => l.series === id.slice(7) && l.kind === "collection") ? id.slice(7) : `${id.slice(7)} – topp 10 (alle år)`) : (listById.get(id) || {}).short || id;
  // Plassering(er) i en årsliste-serie, nyeste først
  const annualRanks = (f, s) => seriesLists(s).filter((l) => f._ranks[l.id]).map((l) => ({ list: l, e: f._ranks[l.id] }));
  // Merke for usorterte samlinger: nummererte (Criterion: spine-nummer) viser nummeret, ellers «Kult»
  const collLabel = (ar) => ar[0].list.numbered ? `${ar[0].list.short} #${ar[0].e.rank}` : "Kult";

  const byTmdb = new Map(movies.filter((m) => m.tmdb_id).map((m) => [m.tmdb_id, m]));
  // Filmer fra kåringene som ikke er i databasen din («katalogfilmer»)
  const catalogFilm = (c, id) => ({
    ...c, id: id || `tmdb-${c.tmdb_id}`, directors: arr(c.directors), countries: arr(c.countries), cast: arr(c.cast),
    awards: [], tags: [], links: {}, status: { seen: false, want: false, owned: false }, _awardVals: [], _catalog: true,
  });
  const catalog = new Map();
  for (const [k, c] of Object.entries(LD.catalog || {})) if (!byTmdb.has(+k)) catalog.set(+k, catalogFilm(c));
  // Regissørenes filmografier (data/directors.js – valgfri)
  const DD = window.LANGTAGNING_DIRECTORS || {};
  const directorsData = Array.isArray(DD.directors) ? DD.directors : [];
  const dirByName = new Map(directorsData.map((d) => [d.name, d]));
  for (const [k, c] of Object.entries(DD.films || {})) if (!byTmdb.has(+k) && !catalog.has(+k)) catalog.set(+k, catalogFilm(c));
  const filmFor = (id) => byTmdb.get(id) || catalog.get(id);
  const extras = [];
  for (const l of lists) {
    for (const e of l.entries) {
      let f = e.tmdb_id ? byTmdb.get(e.tmdb_id) || catalog.get(e.tmdb_id) : null;
      if (!f) {  // ikke funnet i TMDB – vis likevel linjen fra lista
        f = catalogFilm({ title: e.title, year: e.year, directors: e.director ? [e.director] : [] }, `kaaring-${l.id}-${e.rank}-${slug(e.title)}`);
        extras.push(f);
      }
      (f._ranks || (f._ranks = {}))[l.id] = e;
      e._film = f;
    }
  }
  const allFilms = [...movies, ...catalog.values(), ...extras];
  for (const f of allFilms) {
    f._ranks = f._ranks || {};
    f._listVals = [...rankLists.filter((l) => f._ranks[l.id]).map((l) => l.id),
      ...annualSeries.filter((s) => annualRanks(f, s).length).map((s) => `series:${s}`)];
    f._search = [
      f.title, f.original_title, f.year, ...f.directors, ...f.cast,
      ...f.tags, ...f.awards, ...f.countries.map(countryName), f.description,
    ].join(" ").toLowerCase();
  }
  const byId = new Map(allFilms.map((m) => [m.id, m]));

  // Filmer som kan lånes på filmoteket.no (bibliotekenes strømmetjeneste)
  const FMT = window.LANGTAGNING_FILMOTEKET || {};
  const fmtUrl = (m) => (m.tmdb_id && FMT[m.tmdb_id]) || "";

  // Beste plassering: hovedlista først, ellers beste plass i en annen liste
  function bestRank(m) {
    if (primaryList && m._ranks[primaryList.id]) return { list: primaryList, e: m._ranks[primaryList.id] };
    let best = null;
    for (const l of rankLists) {
      const e = m._ranks[l.id];
      if (e && (!best || e.rank < best.e.rank || (e.rank === best.e.rank && l.year > best.list.year))) best = { list: l, e };
    }
    return best;
  }
  const rankText = (e) => `${e.rank}${e.tied ? "=" : ""}`;

  // ---------- Lokal redigering: kø som skrives til todo/ko.txt ----------
  // Vises bare når siden åpnes fra disk eller localhost – ikke når den ligger ute på nett.

  const LOCAL = location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const QKEY = "langtagning-queue";
  let queue = {};
  try { queue = JSON.parse(localStorage.getItem(QKEY) || "{}") || {}; } catch (e) { queue = {}; }
  for (const f of allFilms) f._orig = { ...f.status };
  const sameStatus = (a, b) => !!a.seen === !!b.seen && !!a.want === !!b.want && !!a.owned === !!b.owned;
  const filmByTmdb = new Map(allFilms.filter((f) => f.tmdb_id).map((f) => [String(f.tmdb_id), f]));

  // Fjern det skriptet allerede har behandlet (filmen finnes i databasen med samme status)
  for (const [k, q] of Object.entries(queue)) {
    const f = filmByTmdb.get(k);
    if (!f || (!f._catalog && sameStatus(f._orig, q.status)) || (f._catalog && !Object.values(q.status).some(Boolean))) delete queue[k];
  }
  const saveQueueLocal = () => { try { localStorage.setItem(QKEY, JSON.stringify(queue)); } catch (e) { /* ikke tilgjengelig */ } };
  saveQueueLocal();

  function applyQueue() {
    for (const f of allFilms) {
      const q = f.tmdb_id && queue[String(f.tmdb_id)];
      f.status = q ? { ...q.status } : { ...f._orig };
      f._queued = !!q;
    }
  }
  applyQueue();

  function toggleStatus(f, key) {
    const st = { ...f.status };
    st[key] = !st[key];
    if (key === "seen" && st.seen) st.want = false;
    if (key === "want" && st.want) st.seen = false;
    const k = String(f.tmdb_id);
    if (sameStatus(st, f._orig)) delete queue[k];
    else queue[k] = { title: f.title, year: f.year || null, status: st, ts: Date.now() };
    saveQueueLocal();
    applyQueue();
    writeQueueFile("auto");
  }

  function queueText() {
    const words = (s) => [s.seen && "sett", s.want && "vil-se", s.owned && "samling"].filter(Boolean).join(", ") || "ingen";
    const lines = Object.entries(queue).sort((a, b) => a[1].ts - b[1].ts)
      .map(([k, q]) => `${q.title}${q.year ? ` (${q.year})` : ""} | ${words(q.status)} | tmdb:${k}`);
    return "# Langtagning – kø fra nettsiden. Behandles med: python3 tools/langtagning.py queue\n" +
      "# Format: Tittel (år) | status | tmdb:ID   (status: sett, vil-se, samling – eller «ingen»)\n" + lines.join("\n") + "\n";
  }

  // Fil: Chrome/Edge kan skrive direkte til todo/ko.txt (valgt én gang). Ellers: last ned til Nedlastinger.
  const canPickFile = typeof window.showSaveFilePicker === "function";
  let fileHandle = null, fileState = "none";  // none | saved | unsaved | error
  function idb(mode, fn) {
    return new Promise((resolve) => {
      try {
        const r = indexedDB.open("langtagning", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => {
          const tx = r.result.transaction("kv", mode), st = tx.objectStore("kv"), req = fn(st);
          tx.oncomplete = () => resolve(req && req.result);
          tx.onerror = () => resolve(null);
        };
        r.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  // mode: "auto" (etter et klikk på en statusknapp), "save" («Lagre nå»), "pick" (velg ny fil), "download"
  let lastError = "";
  function downloadQueue() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([queueText()], { type: "text/plain" }));
    a.download = "langtagning-ko.txt";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    fileState = "downloaded";
  }
  async function writeHandle() {
    const w = await fileHandle.createWritable();
    await w.write(queueText());
    await w.close();
    fileState = "saved";
    lastError = "";
  }
  async function writeQueueFile(mode) {
    if (!LOCAL) return;
    if (mode === "download" || (!canPickFile && mode !== "auto")) {
      downloadQueue();
      return renderQueueBar();
    }
    if (!canPickFile) {
      fileState = Object.keys(queue).length ? "unsaved" : "none";
      return renderQueueBar();
    }
    try {
      if (mode === "pick" || (mode === "save" && !fileHandle)) {
        fileHandle = await window.showSaveFilePicker({ suggestedName: "ko.txt", types: [{ description: "Tekstfil", accept: { "text/plain": [".txt"] } }] });
        idb("readwrite", (st) => st.put(fileHandle, "queueFile"));
      }
      if (!fileHandle) {
        fileState = Object.keys(queue).length ? "unsaved" : "none";
      } else if (mode === "auto") {
        // Automatisk lagring bare når tilgangen allerede er gitt – ingen spørsmål midt i klikkingen
        if ((await fileHandle.queryPermission({ mode: "readwrite" })) === "granted") await writeHandle();
        else fileState = "unsaved";
      } else {
        // Spør om tilgang direkte i klikket (nettleseren krever at det skjer i en brukerhandling)
        const perm = await fileHandle.requestPermission({ mode: "readwrite" });
        if (perm !== "granted") throw new Error("Nettleseren ga ikke skrivetilgang til fila");
        await writeHandle();
      }
    } catch (e) {
      if (e && e.name === "AbortError") return renderQueueBar();  // brukeren avbrøt filvelgeren
      lastError = (e && (e.message || e.name)) || String(e);
      console.warn("Kunne ikke skrive kø-fila:", e);
      if (mode !== "auto") downloadQueue();  // reserve: skriptet leser også ~/Downloads/langtagning-ko*.txt
      else fileState = "unsaved";
    }
    renderQueueBar();
  }
  if (LOCAL && canPickFile) idb("readonly", (st) => st.get("queueFile")).then((h) => { if (h) { fileHandle = h; renderQueueBar(); } });

  function actionsHTML(f) {
    if (!LOCAL || !f.tmdb_id) return "";
    const b = (key, label, icon) => `<button class="act ${key}" data-act="${key}" data-tmdb="${f.tmdb_id}" aria-pressed="${!!f.status[key]}" title="${label}">${icon}<span>${label}</span></button>`;
    return b("seen", "Sett", "✓") + b("want", "Vil se", "+") + b("owned", "Eier", "◉");
  }

  function renderQueueBar() {
    const bar = $("#qbar");
    if (!bar) return;
    const items = Object.entries(queue).sort((a, b) => a[1].ts - b[1].ts);
    bar.hidden = !LOCAL || !items.length;
    if (bar.hidden) return;
    const words = (s) => [s.seen && "sett", s.want && "vil se", s.owned && "eier"].filter(Boolean).join(", ") || "fjern status";
    const err = lastError ? ` <span class="qbar-err" title="${esc(lastError)}">(kunne ikke skrive til ${fileHandle ? esc(fileHandle.name) : "fila"}: ${esc(lastError)})</span>` : "";
    const fileInfo =
      fileState === "saved" ? `Lagret i <b>${esc(fileHandle.name)}</b> ✓` :
      fileState === "downloaded" ? `Lastet ned til Nedlastinger som <b>langtagning-ko.txt</b> ✓${err}` :
      !canPickFile ? "Last ned køen – skriptet finner den i Nedlastinger" :
      fileHandle ? `Ikke lagret ennå i ${esc(fileHandle.name)}${err}` :
      "Velg <b>todo/ko.txt</b> én gang, så lagres køen automatisk";
    const btn = canPickFile
      ? `<button class="btn-primary" data-q="save">${fileHandle ? "Lagre nå" : "Velg kø-fil …"}</button>`
        + (fileHandle ? '<button class="btn-ghost" data-q="pick" title="Velg todo/ko.txt på nytt">Velg annen fil</button>' : "")
        + '<button class="btn-ghost" data-q="download" title="Last ned til Nedlastinger – skriptet finner den der">Last ned</button>'
      : `<button class="btn-primary" data-q="download">Last ned kø-fil</button>`;
    bar.innerHTML = `
      <div class="qbar-inner">
        <button class="qbar-count" data-q="toggle" aria-expanded="${bar.classList.contains("open")}"><strong>${items.length}</strong> ${items.length === 1 ? "endring" : "endringer"} i kø <span>▾</span></button>
        <span class="qbar-file">${fileInfo}</span>
        <div class="qbar-actions">${btn}<button class="btn-ghost" data-q="clear">Tøm</button></div>
      </div>
      <div class="qbar-list">
        <ul>${items.map(([k, q]) => `<li><span>${esc(q.title)}${q.year ? ` <small>${q.year}</small>` : ""}</span><em>${words(q.status)}</em><button class="icon-btn" data-q="remove" data-tmdb="${k}" aria-label="Fjern">${ICON_X}</button></li>`).join("")}</ul>
        <div class="cmd"><span>Kjør så i Terminal:</span><code>python3 tools/langtagning.py queue</code><button class="copy" data-copy="python3 tools/langtagning.py queue">Kopier</button></div>
      </div>`;
  }

  // ---------- Tilstand (lagres i URL-en, så lenker og tilbake-knapp virker) ----------
  // Modell: «Vis» (Mitt utvalg eller en liste) → status → filtre. Plakater eller liste er bare presentasjon.

  const STATUSES = [
    { key: "all", label: "Alle" },
    { key: "seen", label: "Sett" },
    { key: "unseen", label: "Ikke sett" },
    { key: "want", label: "Vil se" },
    { key: "owned", label: "Eier" },
    { key: "missing", label: "Ikke registrert", listsOnly: true },
  ];
  const matchStatus = (f, s) =>
    s === "all" ? true : s === "unseen" ? !f.status.seen : s === "missing" ? f._catalog && !f._queued : !!f.status[s];

  const FACETS = [
    { key: "director", label: "Regissør", values: (m) => m.directors, name: (v) => v },
    { key: "country", label: "Land", values: (m) => m.countries, name: countryName },
    { key: "award", label: "Priser", values: (m) => m._awardVals, name: awardName },
    { key: "decade", label: "Tiår", values: (m) => (m.decade ? [m.decade] : []), name: (v) => `${v}-tallet`, numeric: true },
    { key: "actor", label: "Skuespiller", values: (m) => m.cast, name: (v) => v },
  ];
  if (lists.length) {
    FACETS.splice(3, 0, { key: "list", label: "Også på liste", values: (m) => m._listVals, name: listShort,
      order: (v) => v.startsWith("series:") ? 9999 : lists.indexOf(listById.get(v)) });
  }
  for (const f of allFilms) f.decade = f.decade || (f.year ? `${Math.floor(f.year / 10) * 10}` : "");

  const blank = () => ({
    src: "", status: "all", stream: "", shorts: "", q: "", director: "", country: "", award: "", list: "", decade: "", actor: "",
    tags: [], sort: "", layout: "", film: "",
  });
  let state = blank();

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const s = blank();
    for (const k of Object.keys(s)) {
      if (!p.has(k)) continue;
      s[k] = k === "tags" ? p.get(k).split(",").filter(Boolean) : p.get(k);
    }
    // Gamle bokmerker (Samling/Kåringer-modellen) oversettes
    if (p.get("view") === "lists") s.src = p.get("ranking") || (primaryList ? primaryList.id : "");
    const rf = p.get("rfilter");
    if (rf === "stream") s.stream = "1";
    else if (rf && rf !== "all") s.status = rf;
    if (p.get("stream") === "Filmoteket") s.stream = "1";
    if (p.get("sort") === "rank") s.sort = "list";
    if (s.src && !sourceOf(s.src, s)) s.src = "";
    if (!STATUSES.some((x) => x.key === s.status) || (s.status === "missing" && !s.src)) s.status = "all";
    return s;
  }

  function writeHash(push) {
    const p = new URLSearchParams();
    const d = blank();
    for (const [k, v] of Object.entries(state)) {
      if (k === "tags" ? v.length : v !== d[k]) p.set(k, k === "tags" ? v.join(",") : v);
    }
    const url = p.toString() ? `#${p}` : location.pathname + location.search;
    history[push ? "pushState" : "replaceState"](null, "", url);
  }

  // ---------- Utvalg: Mitt utvalg eller en liste ----------

  // Filmografien viser spillefilmer – og alltid filmer du selv har registrert (f.eks. TV-filmen «Duel»)
  const inFilmography = (x) => x.kind === "feature" || byTmdb.has(x.id);

  function sourceOf(id, st = state) {
    if (!id) return null;
    if (id.startsWith("dir:")) {  // regissør: hele filmografien
      const d = dirByName.get(id.slice(4));
      if (!d) return null;
      const all = d.films.filter((x) => filmFor(x.id));
      const pick = all.filter((x) => st.shorts || inFilmography(x));
      const years = pick.map((x) => x.year);
      return {
        id, kind: "director", name: d.name, person: d.person_id, source: `https://www.themoviedb.org/person/${d.person_id}`,
        span: years.length ? `${Math.min(...years)}–${Math.max(...years)}` : "", extra: all.length - pick.length,
        size: pick.length, entries: pick.map((x) => ({ _film: filmFor(x.id), year: x.year, kind: x.kind })),
      };
    }
    if (id.startsWith("series:")) {
      const s = id.slice(7), ls = seriesLists(s);
      if (!ls.length) return null;
      const coll = isColl(s);
      return {
        id, kind: "group", coll, numbered: ls.every((x) => x.numbered), series: s, name: coll ? s : `${s} – årets topp 10, alle år`, source: ls[0].source, size: ls.length,
        entries: (coll ? ls.slice().reverse() : ls).flatMap((x) => x.entries.map((e) => ({ ...e, _group: coll ? x.short : x.year }))),
      };
    }
    return listById.get(id) || null;
  }
  const isRanked = (src) => src && !["group", "collection", "director"].includes(src.kind);
  const sortKey = () => state.sort || (state.src ? "list" : "title");
  const layoutKey = () => state.layout || (state.src ? "rows" : "grid");

  // ---------- Filtrering ----------

  function passes(f, skip) {
    if (skip !== "status" && !matchStatus(f, state.status)) return false;
    if (skip !== "stream" && state.stream && !fmtUrl(f)) return false;
    for (const fc of FACETS) {
      if (skip !== fc.key && state[fc.key] && !fc.values(f).includes(state[fc.key])) return false;
    }
    if (skip !== "tags" && state.tags.length && !state.tags.every((t) => f.tags.includes(t))) return false;
    if (state.q) {
      const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.every((w) => f._search.includes(w))) return false;
    }
    return true;
  }

  const SORTS = {
    "title": (a, b) => collator.compare(sortTitle(a.title), sortTitle(b.title)),
    "year-desc": (a, b) => (b.year || 0) - (a.year || 0) || SORTS.title(a, b),
    "year-asc": (a, b) => (a.year || 9999) - (b.year || 9999) || SORTS.title(a, b),
    "director": (a, b) => {
      const last = (m) => (m.directors[0] || "~").split(" ").slice(-1)[0];
      return collator.compare(last(a), last(b)) || (a.year || 0) - (b.year || 0);
    },
    "added": (a, b) => collator.compare(b.added || "", a.added || "") || (b._order || 0) - (a._order || 0),
    "runtime": (a, b) => (b.runtime || 0) - (a.runtime || 0),
    "awards": (a, b) => b.awards.length - a.awards.length || SORTS["year-asc"](a, b),
  };

  let src = null;        // valgt liste (null = Mitt utvalg)
  let baseItems = [];    // alle rader i utvalget: { f, e (plassering), group }
  let baseFilms = [];    // unike filmer i utvalget
  let items = [];        // rader etter filtrering og sortering
  let current = [];      // unike filmer etter filtrering (brukes av terningen)

  function computeBase() {
    src = sourceOf(state.src);
    baseItems = src ? src.entries.map((e) => ({ f: e._film, e, group: e._group })) : movies.map((m) => ({ f: m }));
    baseFilms = [...new Set(baseItems.map((x) => x.f))];
  }

  function computeItems() {
    let rows = baseItems.filter((x) => passes(x.f));
    const k = sortKey();
    if (k !== "list" || !src) {
      const seen = new Set();
      rows = rows.filter((x) => (seen.has(x.f) ? false : seen.add(x.f))).sort((a, b) => (SORTS[k] || SORTS.title)(a.f, b.f));
    }
    items = rows;
    current = [...new Set(rows.map((x) => x.f))];
  }

  // ---------- Rendering ----------

  function posterHTML(m, cls) {
    const ph = `<div class="ph" style="--h:${hue(m.title)}"><b>${esc(m.title)}</b><span>${esc(m.year || "")}${m.directors[0] ? " · " + esc(m.directors[0]) : ""}</span></div>`;
    if (!m.poster) return ph;
    return `<img src="${esc(m.poster)}" alt="" loading="lazy" decoding="async" class="${cls || ""}" data-ph="${esc(ph)}">`;
  }

  function badgesHTML(m) {
    const b = [];
    // I en liste: vis plasseringen i nettopp den lista
    const here = src && isRanked(src) && m._ranks[src.id];
    const br = here ? { list: src, e: here } : bestRank(m);
    if (br) {
      const all = lists.filter((l) => m._ranks[l.id] && !isAnnual(l)).map((l) => `${l.short}: #${rankText(m._ranks[l.id])}`).join("\n");
      b.push(`<span class="badge rank" title="${esc(all)}">${esc(br.list.short.split(" ")[0])} #${esc(rankText(br.e))}</span>`);
    }
    for (const s of annualSeries) {
      const ar = annualRanks(m, s);
      if (ar.length && isColl(s)) b.push(`<span class="badge annual" title="${esc(ar.map((r) => r.list.name).join("\n"))}">${esc(collLabel(ar))}</span>`);
      else if (ar.length) b.push(`<span class="badge annual" title="${esc(ar.map((r) => `${s} ${r.list.year}: #${rankText(r.e)}`).join("\n"))}">${esc(s.split(" ")[0])} ’${String(ar[0].list.year).slice(2)}</span>`);
    }
    if (m.status.owned) b.push('<span class="badge own">Eier</span>');
    if (m.status.want && !m.status.seen) b.push('<span class="badge want">Vil se</span>');
    if (fmtUrl(m)) b.push('<span class="badge stream" title="Kan lånes på filmoteket.no">Filmoteket</span>');
    if (m.awards.length) b.push(`<span class="badge award" title="${esc(m.awards.join("\n"))}">${LAUREL}${m.awards.length > 1 ? m.awards.length : ""}</span>`);
    return b.length ? `<div class="badges">${b.join("")}</div>` : "";
  }

  function statusPills(f) {
    const any = f.status.seen || f.status.want || f.status.owned;
    if (f._catalog && !any) return `<span class="pill ghost">${f._queued ? "Fjernes fra kø" : "Ikke registrert"}</span>`;
    const p = [];
    if (f._queued) p.push('<span class="pill queued" title="Endringen ligger i køen – kjør python3 tools/langtagning.py queue">i kø</span>');
    if (f.status.seen) p.push('<span class="pill seen">✓ Sett</span>');
    if (f.status.want) p.push('<span class="pill want">Vil se</span>');
    if (f.status.owned) p.push('<span class="pill own">Eier</span>');
    return p.join("");
  }

  function movement(l, e) {
    if (!isRanked(l)) return "";
    const prev = prevInSeries(l);
    if (!prev) return "";
    const pe = e._film._ranks[prev.id];
    if (!pe) return e.rank <= prev.size ? `<span class="mv new" title="Ikke med i ${esc(prev.short)}">ny</span>` : "";
    const d = pe.rank - e.rank;
    if (!d) return `<span class="mv same" title="Samme plass i ${esc(prev.short)}">=</span>`;
    return `<span class="mv ${d > 0 ? "up" : "down"}" title="#${rankText(pe)} i ${esc(prev.short)}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>`;
  }

  // «Vis:»-menyen
  function renderSource() {
    const opt = (v, label) => `<option value="${esc(v)}"${state.src === v ? " selected" : ""}>${esc(label)}</option>`;
    let html = state.src.startsWith("dir:") ? opt(state.src, `Regissør: ${state.src.slice(4)}`) : "";
    html += opt("", `Mitt utvalg (${movies.length})`);
    if (lists.length) {
      html += '<option disabled>──── Kuratert av andre ────</option>';
      for (const s of seriesNames) {
        let o = "";
        if (annualSeries.includes(s) && seriesLists(s).length === 1) {
          // bare én liste i serien (f.eks. Criterion): ingen egen «Alle»-oppføring
          const x = seriesLists(s)[0];
          o += opt(x.id, `${x.short} (${x.entries.length} filmer)`);
        } else if (annualSeries.includes(s)) {
          const coll = isColl(s);
          o += opt(`series:${s}`, coll ? `Alle (${seriesLists(s).reduce((a, x) => a + x.entries.length, 0)} filmer)` : `Alle år (${seriesLists(s).length} årganger)`);
          o += (coll ? seriesLists(s).slice().reverse() : seriesLists(s)).map((x) => opt(x.id, coll ? (x.numbered ? x.short : `${x.short} (${x.year})`) : `${x.year}`)).join("");
        } else {
          o += seriesLists(s).map((x) => opt(x.id, `${x.short} – topp ${x.size}`)).join("");
        }
        html += `<optgroup label="${esc(s)}">${o}</optgroup>`;
      }
    }
    $("#src").innerHTML = html;
    $("#src").classList.toggle("active", !!state.src);
    $("#src-clear").hidden = !state.src;
  }

  // Status-knapper (tall følger filtrene) + «Kan lånes»
  function renderStatus() {
    const base = baseFilms.filter((f) => passes(f, "status"));
    let html = STATUSES.filter((s) => !s.listsOnly || src).map((s) =>
      `<button class="tab" data-status="${s.key}" aria-pressed="${state.status === s.key}">${s.label}<span class="n">${base.filter((f) => matchStatus(f, s.key)).length}</span></button>`).join("");
    if (Object.keys(FMT).length) {
      const n = baseFilms.filter((f) => passes(f, "stream") && fmtUrl(f)).length;
      html += `<button class="tab stream-toggle" data-stream aria-pressed="${!!state.stream}" title="Bare filmer som kan lånes med bibliotekkortet på filmoteket.no">▶ Kan lånes<span class="n">${n}</span></button>`;
    }
    $("#tabs").innerHTML = html;
    for (const b of document.querySelectorAll("#layoutpick [data-layout]")) b.setAttribute("aria-pressed", String(b.dataset.layout === layoutKey()));
  }

  // Overskrift og fremdrift når utvalget er en liste
  function renderSourceHead() {
    const head = $("#src-head");
    head.hidden = !src;
    if (!src) return;
    const films = baseFilms.filter((f) => passes(f, "status"));  // følger filtrene, men ikke status
    const n = films.length, total = baseFilms.length;
    const cnt = (fn) => films.filter(fn).length;
    const seen = cnt((f) => f.status.seen), owned = cnt((f) => f.status.owned),
      want = cnt((f) => f.status.want && !f.status.seen), missing = cnt((f) => f._catalog && !f._queued);
    const pct = (x) => n ? Math.round((x / n) * 1000) / 10 : 0;
    const desc = src.kind === "director"
      ? `${total} ${state.shorts ? "filmer" : "spillefilmer"}${src.span ? ` (${src.span})` : ""}${src.extra ? ` · <button class="linklike" data-shorts>ta med ${src.extra} kortfilmer, TV-filmer og dokumentarer</button>` : state.shorts ? ' · <button class="linklike" data-shorts>bare spillefilmer</button>' : ""}`
      : src.coll ? `${total} filmer fra ${src.size} lister` : src.kind === "group" ? `${total} filmer fra ${src.size} årganger`
      : src.kind === "collection" ? `${total} filmer` : `${total} filmer${total !== src.size ? ` (topp ${src.size} med delte plasseringer)` : ""}`;
    head.innerHTML = `
      <div>
        <h2>${esc(src.name)}</h2>
        <p class="lv-source">${desc} · <a href="${esc(src.source || "#")}" target="_blank" rel="noopener">${src.kind === "director" ? "TMDB" : "Kilde"}</a></p>
      </div>
      <div class="lv-progress" role="img" aria-label="Sett ${seen} av ${n}">
        <div class="lv-big"><strong>${seen}</strong> av ${n}${n !== total ? " (filtrert)" : ""} sett <span>${pct(seen)} %</span></div>
        <div class="lv-bar"><i class="b-seen" style="width:${pct(seen)}%"></i><i class="b-want" style="width:${pct(want)}%"></i></div>
        <div class="lv-stats">
          <span><i class="d-seen"></i>Sett ${seen}</span>
          <span><i class="d-want"></i>Vil se ${want}</span>
          <span><i class="d-own"></i>Eier ${owned}</span>
          <span><i class="d-miss"></i>Ikke registrert ${missing}</span>
        </div>
      </div>`;
  }

  function renderFacets() {
    let html = "";
    for (const f of FACETS) {
      const counts = new Map();
      for (const m of baseFilms) if (passes(m, f.key)) for (const v of f.values(m)) counts.set(v, (counts.get(v) || 0) + 1);
      if (state[f.key] && !counts.has(state[f.key])) counts.set(state[f.key], 0);
      if (!counts.size) continue;
      const opt = (v, n, label) =>
        `<option value="${esc(v)}"${state[f.key] === v ? " selected" : ""}>${esc(label || f.name(v))} (${n})</option>`;
      let opts;
      if (f.order) {
        opts = [...counts.entries()].filter(([v]) => v !== state.src).sort((a, b) => f.order(a[0]) - f.order(b[0])).map(([v, n]) => opt(v, n)).join("");
      } else if (f.key === "award") {
        opts = counts.has("*") ? opt("*", counts.get("*")) : "";
        const groups = [...new Set([...counts.keys()].filter((v) => v !== "*").map(awardGroup))]
          .sort((a, b) => groupRank(a) - groupRank(b) || collator.compare(a, b));
        for (const g of groups) {
          const prizes = [...counts.keys()].filter((v) => v !== g && awardGroup(v) === g && v.includes(" – "))
            .sort((a, b) => counts.get(b) - counts.get(a) || collator.compare(a, b));
          if (!prizes.length) { opts += opt(g, counts.get(g) || 0, g); continue; }
          opts += `<optgroup label="${esc(g)}">${opt(g, counts.get(g) || 0, `Alle fra ${g}`)}` +
            prizes.map((v) => opt(v, counts.get(v), v.split(" – ").slice(1).join(" – "))).join("") + "</optgroup>";
        }
      } else {
        const entries = [...counts.entries()].sort((a, b) =>
          f.numeric ? collator.compare(a[0], b[0]) : b[1] - a[1] || collator.compare(f.name(a[0]), f.name(b[0])));
        opts = entries.slice(0, 400).map(([v, n]) => opt(v, n)).join("");
      }
      html += `<label class="field"><span>${f.label}</span><select data-facet="${f.key}" class="${state[f.key] ? "active" : ""}">` +
        `<option value="">Alle</option>${opts}</select></label>`;
      if (f.key === "director" && state.director && dirByName.has(state.director) && state.src !== `dir:${state.director}`) {
        const n = dirByName.get(state.director).films.filter((x) => inFilmography(x) && filmFor(x.id)).length;
        html += `<button class="facet-link" data-goto="dir:${esc(state.director)}">→ Se hele filmografien (${n} spillefilmer)</button>`;
      }
    }

    const tagCounts = new Map();
    for (const m of baseFilms) if (passes(m, "tags")) for (const t of m.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    for (const t of state.tags) if (!tagCounts.has(t)) tagCounts.set(t, 0);
    if (tagCounts.size) {
      const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
      html += `<div class="field"><span>Tagger</span><div class="tagcloud">` +
        tags.map(([t, n]) => `<button class="tagbtn" data-tag="${esc(t)}" aria-pressed="${state.tags.includes(t)}">${esc(t)}<small>${n}</small></button>`).join("") +
        `</div></div>`;
    }
    $("#facets").innerHTML = html;
    const sortSel = $("#sort");
    sortSel.querySelector('option[value="list"]').hidden = !src;
    sortSel.querySelector('option[value="list"]').textContent = src && src.kind === "director" ? "Kronologisk" : "Plassering i lista";
    sortSel.querySelector('option[value="list"]').disabled = !src;
    sortSel.querySelector('option[value="added"]').hidden = !!src;
    sortSel.value = sortKey();
  }

  function renderChips() {
    const chips = [];
    if (state.q) chips.push({ k: "q", label: `«${state.q}»` });
    if (state.stream) chips.push({ k: "stream", label: "Kan lånes" });
    for (const f of FACETS) if (state[f.key]) chips.push({ k: f.key, label: `${f.label}: ${f.name(state[f.key])}` });
    for (const t of state.tags) chips.push({ k: "tag", v: t, label: `#${t}` });
    $("#chips").innerHTML = chips.map((c) =>
      `<button class="chip" data-clear="${c.k}" data-v="${esc(c.v || "")}" title="Fjern filter">${esc(c.label)}${ICON_X}</button>`).join("");
    $("#filter-dot").hidden = !chips.filter((c) => c.k !== "q").length;
  }

  function cardHTML(m, i) {
    return `
      <button class="card" data-id="${esc(m.id)}" style="animation-delay:${Math.min(i % CHUNK, 24) * 18}ms">
        <div class="poster">
          ${posterHTML(m)}
          ${badgesHTML(m)}
          <div class="hover">${esc(m.directors.join(", "))}${m.countries.length ? `<br>${esc(m.countries.map(countryName).join(", "))}` : ""}</div>
        </div>
        <h3 class="card-title">${esc(m.title)}</h3>
        ${m.original_title && m.original_title !== m.title ? `<p class="card-orig">${esc(m.original_title)}</p>` : ""}
        <p class="card-meta">${esc(m.year || "")}${m.directors[0] ? " · " + esc(m.directors[0]) : ""}</p>
      </button>`;
  }

  // Små merker i listevisningen: plassering på kåringer, Cahiers/Kult og Filmoteket
  function miniTags(f) {
    const t = [];
    const here = src && isRanked(src) ? src.id : null;
    for (const l of rankLists) {
      const e = f._ranks[l.id];
      if (!e || l.id === here) continue;
      // én per serie: den nyeste kåringen filmen er med i
      if (seriesLists(l.series).find((x) => f._ranks[x.id]) !== l) continue;
      t.push(`<span class="mt rank" title="${esc(l.name)}">${esc(l.short.replace(/ \d{4}$/, ""))} #${rankText(e)}</span>`);
    }
    for (const s of annualSeries) {
      if (src && src.numbered && src.series === s) continue;  // nummeret står allerede i rangkolonnen
      const ar = annualRanks(f, s);
      if (ar.length) t.push(`<span class="mt annual" title="${esc(ar.map((r) => r.list.name).join("\n"))}">${isColl(s) ? esc(collLabel(ar)) : `${esc(s.split(" ")[0])} ’${String(ar[0].list.year).slice(2)}`}</span>`);
    }
    if (f.awards.length) t.push(`<span class="mt award" title="${esc(f.awards.join("\n"))}">${LAUREL}${f.awards.length}</span>`);
    if (fmtUrl(f)) t.push('<span class="mt stream">▶ Filmoteket</span>');
    return t.length ? `<span class="lv-tags">${t.join("")}</span>` : "";
  }

  let lastGroup = null;
  function rowHTML(x, i) {
    const f = x.f, e = x.e;
    const showGroup = src && src.kind === "group" && sortKey() === "list" && x.group !== lastGroup;
    if (showGroup) lastGroup = x.group;
    const rank = src && isRanked(src) && e ? `${e.tied ? "<small>=</small>" : ""}${e.rank}`
      : src && (src.kind === "group" && !src.coll || src.numbered) && e && sortKey() === "list" ? `${e.tied ? "<small>=</small>" : ""}${e.rank}` : "";
    const orig = f.original_title && f.original_title !== f.title ? `<span class="lv-orig">${esc(f.original_title)}</span>` : "";
    return `${showGroup ? `<li class="lv-yearhead">${esc(x.group)}</li>` : ""}<li class="lv-item${LOCAL && f.tmdb_id ? " has-act" : ""}" style="animation-delay:${Math.min(i % CHUNK, 30) * 12}ms"><button class="lv-row${f._catalog && !f._queued ? " is-missing" : ""}${f.status.seen ? " is-seen" : ""}" data-id="${esc(f.id)}">
        <span class="lv-rank">${rank}</span>
        <span class="lv-thumb">${posterHTML(f)}</span>
        <span class="lv-text"><b>${esc(f.title)}</b>${orig}
          <span class="lv-meta">${esc(f.year || (e && e.year) || "")}${f.directors.length ? " · " + esc(f.directors.join(", ")) : ""}${f.countries.length ? " · " + esc(f.countries.map(countryName).join(", ")) : ""}</span>${miniTags(f)}</span>
        <span class="lv-status">${statusPills(f)}</span>
        <span class="lv-mv">${src && e ? movement(src, e) : ""}</span>
      </button>${LOCAL && f.tmdb_id ? `<div class="lv-act">${actionsHTML(f)}</div>` : ""}</li>`;
  }

  // Resultater tegnes i bolker – store lister (TSPDT 1000) blir ikke trege
  const CHUNK = 120;
  let shown = 0;
  function renderMore() {
    const rows = layoutKey() === "rows";
    const next = rows ? items.slice(shown, shown + CHUNK) : current.slice(shown, shown + CHUNK);
    const html = next.map((x, i) => (rows ? rowHTML(x, shown + i) : cardHTML(x, shown + i))).join("");
    (rows ? $("#rows") : grid).insertAdjacentHTML("beforeend", html);
    shown += next.length;
    $("#more").hidden = shown >= (rows ? items.length : current.length);
  }

  function renderResults() {
    const rows = layoutKey() === "rows";
    const total = baseFilms.length;
    const n = current.length;
    $("#count").innerHTML = n === total
      ? `<strong>${total}</strong> ${total === 1 ? "film" : "filmer"}`
      : `<strong>${n}</strong> av ${total} filmer`;
    $("#empty").hidden = n > 0;
    grid.hidden = rows;
    $("#rows").hidden = !rows;
    $("#rows").classList.toggle("no-rank", !(src && (isRanked(src) || ((src.kind === "group" && !src.coll || src.numbered) && sortKey() === "list"))));
    grid.innerHTML = "";
    $("#rows").innerHTML = "";
    shown = 0;
    lastGroup = null;
    renderMore();
  }

  // Søkeforslag: regissører med filmografi som matcher søket
  const fold = (t) => String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  function renderSuggest() {
    const box = $("#suggest");
    const qq = fold(state.q);
    const hits = qq.length >= 3 ? directorsData.filter((d) => fold(d.name).includes(qq)).slice(0, 3) : [];
    box.hidden = !hits.length;
    box.innerHTML = hits.map((d) => {
      const n = d.films.filter((x) => inFilmography(x) && filmFor(x.id)).length;
      return `<button data-goto="dir:${esc(d.name)}">▸ Regissør: <b>${esc(d.name)}</b> – hele filmografien <small>(${n} spillefilmer)</small></button>`;
    }).join("");
  }

  function render() {
    renderSuggest();
    computeBase();
    computeItems();
    renderSource();
    renderStatus();
    renderSourceHead();
    renderFacets();
    renderChips();
    renderResults();
    if ($("#search").value.trim() !== state.q) $("#search").value = state.q;
  }

  // Tegn neste bolk når man nærmer seg bunnen
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) renderMore(); }, { rootMargin: "800px" }).observe($("#more"));
  }

  // Bytt ut plakater som ikke finnes med en generert plakat
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName === "IMG" && img.dataset.ph) img.outerHTML = img.dataset.ph;
  }, true);

  // ---------- Detaljvisning ----------

  function q(s) { return encodeURIComponent(s); }

  function linksFor(m) {
    const t = m.title;
    const L = [];
    L.push({ cls: "imdb", tag: "IMDb", name: "IMDb",
      url: m.links.imdb || (m.imdb_id ? `https://www.imdb.com/title/${m.imdb_id}/` : `https://www.imdb.com/find/?q=${q(`${t} ${m.year || ""}`)}&s=tt`),
      search: !m.links.imdb && !m.imdb_id });
    L.push({ cls: "bfi", tag: "BFI", name: "BFI",
      url: m.links.bfi || `https://www.bfi.org.uk/search?q=${q(t)}`, search: !m.links.bfi });
    L.push({ cls: "rt", tag: "RT", name: "Rotten Tomatoes",
      url: m.links.rt || `https://www.rottentomatoes.com/search?search=${q(t)}`, search: !m.links.rt });
    const wl = (m.tmdb_id && WIKILINKS[m.tmdb_id]) || {};
    const ebert = m.links.ebert || (wl.ebert && `https://www.rogerebert.com/reviews/${wl.ebert}`);
    L.push({ cls: "ebert", tag: "RE", name: "Roger Ebert",
      url: ebert || `https://www.rogerebert.com/search?q=${q(`${t} ${m.year || ""}`)}`, search: !ebert });
    const crit = m.links.criterion || (wl.criterion && `https://www.criterion.com/films/${wl.criterion}`);
    if (crit) L.push({ cls: "crit", tag: "CC", name: "Criterion", url: crit });
    if (m.tmdb_id) L.push({ cls: "tmdb", tag: "TMDB", name: "TMDB", url: `https://www.themoviedb.org/movie/${m.tmdb_id}` });
    if (fmtUrl(m)) L.push({ cls: "fmt", tag: "▶", name: "Filmoteket", url: fmtUrl(m) });
    const cine = m.tmdb_id && CINE_LINKS[m.tmdb_id];
    if (cine) L.push({ cls: "cinemateket", tag: "C", name: "Cinemateket", url: cine });
    for (const [k, url] of Object.entries(m.links)) {
      if (!url || ["imdb", "bfi", "rt", "ebert", "criterion"].includes(k)) continue;
      L.push({ cls: "", tag: "↗", name: k, url });
    }
    return L.map((l) => `<a class="extlink" href="${esc(l.url)}" target="_blank" rel="noopener"><i class="${l.cls}">${esc(l.tag)}</i>${esc(l.name)}${l.search ? " <small>søk</small>" : ""}</a>`).join("");
  }

  // Omtaler fra cinemateket.no – teksten bare lokalt (se index.html), ellers bare lenke
  const CINE_LINKS = window.LANGTAGNING_CINEMATEKET_LINKS || {};
  // Roger Ebert- og Criterion-ID-er fra Wikidata (tmdb-id → {ebert, criterion})
  const WIKILINKS = window.LANGTAGNING_WIKILINKS || {};
  const CINE = (LOCAL && window.LANGTAGNING_CINEMATEKET) || {};
  function cineHTML(m) {
    const c = m.tmdb_id && CINE[m.tmdb_id];
    if (!c) return "";
    return `<section class="cine">
      <h2 class="sec-label">Fra Cinemateket</h2>
      ${c.ingress ? `<p class="cine-ingress">${esc(c.ingress)}</p>` : ""}
      ${c.text.map((p) => `<p>${esc(p)}</p>`).join("")}
      ${c.quotes.map((q) => `<blockquote>${esc(q.text)}${q.cite ? `<cite>${esc(q.cite)}</cite>` : ""}</blockquote>`).join("")}
      <p class="cine-src">Tekst: <a href="${esc(c.url)}" target="_blank" rel="noopener">Cinemateket</a> · vises bare lokalt</p>
    </section>`;
  }

  // Plassering i kåringene over tid: tabell per serie + liten graf
  function rankingsHTML(m) {
    if (!m._listVals.length) return "";
    const annual = annualSeries.map((s) => [s, annualRanks(m, s)]).filter(([, r]) => r.length).map(([s, r]) => `
      <div class="rk-row"><span class="rk-key annual"><i></i>${esc(s)}</span><div class="rk-cells">${r.map(({ list, e }) => isColl(s)
        ? `<button class="rk-cell rk-link" data-goto="${esc(list.id)}" title="Vis lista"><small>${list.numbered ? esc(list.short) : list.year}</small>${list.numbered ? `#${e.rank}` : esc(list.short)}</button>`
        : `<button class="rk-cell rk-link" data-goto="${esc(list.id)}" title="Vis ${esc(list.short)}"><small>topp 10 ${list.year}</small>#${rankText(e)}</button>`).join("")}</div></div>`).join("");
    const ranked = rankLists.some((l) => m._ranks[l.id]);
    if (!ranked) return `<section class="rankings"><div class="rk-table">${annual}</div></section>`;
    const years = [...new Set(rankLists.map((l) => l.year))].sort((a, b) => a - b);
    const maxSize = Math.max(...rankLists.map((l) => l.size || 100));
    const W = 640, H = 170, L = 40, R = 26, T = 18, B = 24;
    const x = (yr) => years.length > 1 ? L + (years.indexOf(yr) / (years.length - 1)) * (W - L - R) : (L + W - R) / 2;
    const y = (r) => T + (Math.log(r) / Math.log(maxSize)) * (H - T - B);  // logaritmisk: toppen får mest plass
    const ticks = [1, 3, 10, 30, 100, 300, 1000].filter((t) => t <= maxSize);
    let svg = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="rk-grid"/><text x="${L - 8}" y="${y(t) + 4}" class="rk-tick" text-anchor="end">${t}</text>`).join("");
    const yl = (yr) => years.length > 6 ? `'${String(yr).slice(2)}` : yr;
    svg += years.map((yr) => `<text x="${x(yr)}" y="${H - 6}" class="rk-tick" text-anchor="middle">${yl(yr)}</text>`).join("");

    const table = seriesNames.filter((s) => !annualSeries.includes(s)).map((s, si) => {
      const ls = seriesLists(s).slice().reverse();  // eldst først
      const pts = ls.filter((l) => m._ranks[l.id]).map((l) => [x(l.year), y(m._ranks[l.id].rank), m._ranks[l.id]]);
      if (pts.length > 1) svg += `<polyline class="rk-line s${si}" points="${pts.map((p) => p[0] + "," + p[1]).join(" ")}"/>`;
      // første serie får tallet over punktet, neste under – så de ikke kolliderer
      const dy = si % 2 ? 15 : -8;
      // tall bare ved beste plassering og siste kåring – resten står i tabellen
      const best = pts.reduce((a, p) => (!a || p[2].rank < a[2].rank ? p : a), null);
      const shown = new Set([best, pts[pts.length - 1]]);
      svg += pts.map(([px, py, e], pi) => `<circle class="rk-dot s${si}" cx="${px}" cy="${py}" r="4.5"/>${shown.has(pts[pi]) ? `<text class="rk-val s${si}" x="${px}" y="${py + dy}" text-anchor="middle">#${rankText(e)}</text>` : ""}`).join("");
      const cells = ls.map((l) => {
        const e = m._ranks[l.id];
        return `<span class="rk-cell${e ? "" : " out"}" title="${e ? esc(l.short) : `Utenfor topp ${l.size}`}"><small>${l.year}</small>${e ? `#${rankText(e)}` : "–"}</span>`;
      }).join("");
      return `<div class="rk-row"><span class="rk-key s${si}"><i></i>${esc(seriesLabel(s))}</span><div class="rk-cells">${cells}</div></div>`;
    }).join("");

    const title = [...new Set(rankLists.map((l) => l.series.split(" – ")[0]))].join(", ");
    return `<section class="rankings">
      <h2 class="sec-label">${esc(title)}</h2>
      <div class="rk-wrap">
        <div class="rk-table">${table}${annual}</div>
        <svg class="rk-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Plassering over tid">${svg}</svg>
      </div>
    </section>`;
  }

  // Kommandoer for å legge en katalogfilm inn i databasen
  // Bare lokalt: status-knapper som legger endringen i køen
  function addBoxHTML(m) {
    if (!LOCAL || !m.tmdb_id) return "";
    return `<section class="addbox">
      <h2 class="sec-label">${m._catalog && !m._queued ? "Ikke i databasen din ennå" : "Endre status"}</h2>
      <div class="act-row">${actionsHTML(m)}</div>
      <p>Endringen legges i køen nederst på siden. Lagre køen, og kjør <code>python3 tools/langtagning.py queue</code>.</p>
    </section>`;
  }

  const filterBtns = (facet, values, name = (v) => v) =>
    values.map((v) => `<button class="linklike" data-filter="${facet}" data-v="${esc(v)}">${esc(name(v))}</button>`).join(", ");

  function openDetail(id, push) {
    const m = byId.get(id);
    if (!m) return;
    state.film = id;
    if (push) writeHash(true);

    const facts = [
      m.year && `<span>${m.year}</span>`,
      m.runtime && `<span>${Math.floor(m.runtime / 60)} t ${m.runtime % 60} min</span>`,
    ].filter(Boolean).join("");

    const pills = statusPills(m) ? [statusPills(m)] : [];

    const rows = [];
    if (m.directors.length) rows.push(["Regi", m.directors.map((d) => filterBtns("director", [d]) +
      (dirByName.has(d) ? ` <button class="filmo" data-goto="dir:${esc(d)}">Hele filmografien →</button>` : "")).join(", ")]);
    if (m.countries.length) rows.push(["Land", filterBtns("country", m.countries, countryName)]);
    if (m.cast.length) rows.push(["Medvirkende", filterBtns("actor", m.cast)]);
    if (m.tags.length) rows.push(["Tagger", m.tags.map((t) => `<button class="linklike" data-tagfilter="${esc(t)}">#${esc(t)}</button>`).join(" ")]);

    const showOrig = m.original_title && m.original_title !== m.title;
    dialog.innerHTML = `
      <div class="detail-scroll" tabindex="-1" autofocus>
        <div class="hero${m.backdrop ? "" : " noimg"}" style="--h:${hue(m.title)};${m.backdrop ? `background-image:url('${esc(m.backdrop)}')` : ""}">
          <button class="icon-btn close" data-close aria-label="Lukk">${ICON_X}</button>
        </div>
        <div class="detail-body">
          <div class="detail-poster">${posterHTML(m)}</div>
          <div class="detail-main">
            <h1 id="d-title">${esc(m.title)}</h1>
            ${showOrig ? `<p class="orig">${esc(m.original_title)}</p>` : ""}
            <div class="facts">${facts}</div>
            ${pills.length || fmtUrl(m) ? `<div class="statusrow">${pills.join("")}${fmtUrl(m) ? `<a class="pill stream" href="${esc(fmtUrl(m))}" target="_blank" rel="noopener">▶ Lån på Filmoteket</a>` : ""}</div>` : ""}
            ${m.awards.length ? `<ul class="awards">${m.awards.map((a) =>
              `<li><button data-filter="award" data-v="${esc(a)}">${LAUREL}<span>${a.includes(" – ") ? `<small>${esc(awardGroup(a))}</small>${esc(a.split(" – ").slice(1).join(" – "))}` : esc(a)}</span></button></li>`).join("")}</ul>` : ""}
            ${m.description ? `<div class="note"><span class="note-label">Mine tanker</span>${esc(m.description)}</div>` : ""}
            ${cineHTML(m) || (m.overview ? `<p class="overview">${esc(m.overview)}</p>` : "")}
            ${addBoxHTML(m)}
            <dl class="meta">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
            <div class="links">${linksFor(m)}</div>
            ${rankingsHTML(m)}
          </div>
        </div>
      </div>`;
    if (!dialog.open) dialog.showModal();
    $(".detail-scroll", dialog).scrollTop = 0;
  }

  function closeDetail(fromHistory) {
    if (dialog.open) dialog.close();
    if (state.film) {
      state.film = "";
      if (!fromHistory) writeHash(false);
    }
  }

  function copyButton(c) {
    const done = () => { c.textContent = "Kopiert ✓"; setTimeout(() => { c.textContent = "Kopier"; }, 1600); };
    const fallback = () => {  // marker teksten så den kan kopieres med Cmd+C
      const r = document.createRange(); r.selectNodeContents(c.previousElementSibling);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      c.textContent = "Trykk Cmd+C";
    };
    try { navigator.clipboard.writeText(c.dataset.copy).then(done, fallback); } catch (err) { fallback(); }
  }

  dialog.addEventListener("close", () => { if (state.film) { state.film = ""; writeHash(false); } });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) return closeDetail();
    const c = e.target.closest("[data-copy]");
    if (c) return copyButton(c);
    const go = e.target.closest("[data-goto]");
    if (go) {
      state = { ...blank(), src: go.dataset.goto };
      dialog.close(); writeHash(true); render(); window.scrollTo({ top: 0 });
      return;
    }
    const act = e.target.closest("[data-act]");
    if (act) {
      const sc = $(".detail-scroll", dialog).scrollTop;
      toggleStatus(filmByTmdb.get(act.dataset.tmdb), act.dataset.act);
      openDetail(state.film, false);
      $(".detail-scroll", dialog).scrollTop = sc;
      render();
      return;
    }
    const f = e.target.closest("[data-filter]");
    const t = e.target.closest("[data-tagfilter]");
    if (!f && !t) return;
    // filtrer innenfor utvalget du står i
    const s = { ...blank(), src: state.src, sort: state.sort, layout: state.layout };
    if (f) s[f.dataset.filter] = f.dataset.v;
    if (t) s.tags = [t.dataset.tagfilter];
    state = s;
    dialog.close();
    writeHash(false);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ---------- Hendelser ----------

  const update = () => { writeHash(false); render(); };

  $("#src").addEventListener("change", (e) => {
    state.src = e.target.value;
    if (!state.src && state.status === "missing") state.status = "all";
    if (state.sort === "list" && !state.src) state.sort = "";
    if (state.list === state.src) state.list = "";
    writeHash(true);
    render();
    window.scrollTo({ top: 0 });
  });

  const gotoSrc = (id) => {
    state = { ...blank(), src: id };
    writeHash(true); render(); window.scrollTo({ top: 0 });
  };
  $("#src-clear").addEventListener("click", (e) => { e.preventDefault(); gotoSrc(""); });
  $("#suggest").addEventListener("click", (e) => { const b = e.target.closest("[data-goto]"); if (b) gotoSrc(b.dataset.goto); });
  $("#src-head").addEventListener("click", (e) => {
    if (e.target.closest("[data-shorts]")) { state.shorts = state.shorts ? "" : "1"; update(); }
  });

  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-status]");
    if (b) { state.status = b.dataset.status; return update(); }
    if (e.target.closest("[data-stream]")) { state.stream = state.stream ? "" : "1"; update(); }
  });

  $("#layoutpick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-layout]");
    if (!b) return;
    // lagre bare et valg som avviker fra standarden for utvalget
    state.layout = b.dataset.layout === (state.src ? "rows" : "grid") ? "" : b.dataset.layout;
    update();
  });

  $("#facets").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-facet]");
    if (!sel) return;
    state[sel.dataset.facet] = sel.value;
    update();
  });

  $("#facets").addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]");
    if (g) return gotoSrc(g.dataset.goto);
    const b = e.target.closest("[data-tag]");
    if (!b) return;
    const t = b.dataset.tag;
    state.tags = state.tags.includes(t) ? state.tags.filter((x) => x !== t) : [...state.tags, t];
    update();
  });

  $("#sort").addEventListener("change", (e) => {
    state.sort = e.target.value === (state.src ? "list" : "title") ? "" : e.target.value;
    update();
  });

  let searchTimer;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = e.target.value.trim(); update(); }, 120);
  });

  $("#chips").addEventListener("click", (e) => {
    const c = e.target.closest("[data-clear]");
    if (!c) return;
    const k = c.dataset.clear;
    if (k === "tag") state.tags = state.tags.filter((t) => t !== c.dataset.v);
    else state[k] = "";
    update();
  });

  // Nullstill filtrene, men behold utvalg og visning
  $("#reset").addEventListener("click", () => {
    state = { ...blank(), src: state.src, sort: state.sort, layout: state.layout };
    update();
  });

  $("#brand").addEventListener("click", (e) => { e.preventDefault(); state = blank(); update(); window.scrollTo({ top: 0 }); });

  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card) openDetail(card.dataset.id, true);
  });

  $("#rows").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act) {
      // behold rullepos.: tegn på nytt og bla til samme sted
      const y = window.scrollY, had = shown;
      toggleStatus(filmByTmdb.get(act.dataset.tmdb), act.dataset.act);
      render();
      while (shown < had && shown < items.length) renderMore();
      window.scrollTo({ top: y });
      return;
    }
    const row = e.target.closest(".lv-row");
    if (row) openDetail(row.dataset.id, true);
  });

  $("#random").addEventListener("click", () => {
    const pool = current.length ? current : baseFilms;
    if (pool.length) openDetail(pool[Math.floor(Math.random() * pool.length)].id, true);
  });

  // Købaren nederst (bare lokalt)
  $("#qbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-q], [data-copy]");
    if (!b) return;
    if (b.dataset.copy) return copyButton(b);
    const bar = $("#qbar");
    if (b.dataset.q === "toggle") { bar.classList.toggle("open"); renderQueueBar(); }
    else if (["save", "pick", "download"].includes(b.dataset.q)) writeQueueFile(b.dataset.q);
    else if (b.dataset.q === "remove") { delete queue[b.dataset.tmdb]; saveQueueLocal(); applyQueue(); writeQueueFile("auto"); render(); }
    else if (b.dataset.q === "clear") {
      if (b.dataset.confirm) { queue = {}; saveQueueLocal(); applyQueue(); writeQueueFile("auto"); render(); }
      else { b.dataset.confirm = "1"; b.textContent = "Sikker? Klikk igjen"; setTimeout(() => renderQueueBar(), 3000); }
    }
  });

  // «Om»-vinduet
  const about = $("#about");
  $("#about-open").addEventListener("click", () => { about.showModal(); $(".about-scroll", about).scrollTop = 0; });
  about.addEventListener("click", (e) => { if (e.target === about || e.target.closest("[data-close-about]")) about.close(); });

  // Filterpanel på mobil
  const filters = $("#filters"), scrim = $("#scrim");
  const openFilters = () => { filters.classList.add("open"); scrim.hidden = false; };
  const closeFilters = () => { filters.classList.remove("open"); scrim.hidden = true; };
  $("#filter-open").addEventListener("click", openFilters);
  $("#filter-close").addEventListener("click", closeFilters);
  $("#filter-done").addEventListener("click", closeFilters);
  scrim.addEventListener("click", closeFilters);

  // Tastatur: "/" fokuserer søk
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT" && !dialog.open) {
      e.preventDefault();
      $("#search").focus();
    } else if (e.key === "Escape") closeFilters();
  });

  // Tilbake/frem i nettleseren
  window.addEventListener("popstate", () => {
    state = readHash();
    render();
    if (state.film && byId.has(state.film)) openDetail(state.film, false);
    else closeDetail(true);
  });

  // Tema (lys/mørk) – husket i nettleseren
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="theme-color"]');
  const setTheme = (t) => {
    root.dataset.theme = t;
    meta.content = t === "light" ? "#f6f2ec" : "#0d0c0b";
    try { localStorage.setItem("langtagning-theme", t); } catch (e) { /* ikke tilgjengelig */ }
  };
  try {
    const saved = localStorage.getItem("langtagning-theme");
    if (saved) setTheme(saved);
  } catch (e) { /* ikke tilgjengelig */ }
  $("#theme").addEventListener("click", () => setTheme(root.dataset.theme === "light" ? "dark" : "light"));

  // ---------- Start ----------
  state = readHash();
  render();
  renderQueueBar();
  if (state.film) openDetail(state.film, false);
})();
