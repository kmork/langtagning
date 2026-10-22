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
  // Kjøres siden lokalt (fil eller localhost)? Da brukes plakatene i posters/, på nett hentes de fra TMDB.
  const LOCAL = location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  const movies = window.LANGTAGNING.map((m, i) => {
    const status = m.status || {};
    const movie = {
      ...m,
      poster: (!LOCAL && m.poster_url) || m.poster,
      backdrop: (!LOCAL && m.backdrop_url) || m.backdrop,
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
    // Knuts egne data fra movies.js – grunnlaget for eieren, egen kilde («Knuts utvalg») for venner
    movie.knut = { status: { ...movie.status }, description: m.description || "", tags: [...movie.tags] };
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
  // Merke for usorterte samlinger: nummererte (Criterion: spine-nummer) viser nummeret, ellers listas merke («Kult»)
  const collLabel = (ar) => ar[0].list.numbered ? `${ar[0].list.short} #${ar[0].e.rank}` : ar[0].list.badge || "Kult";

  const byTmdb = new Map(movies.filter((m) => m.tmdb_id).map((m) => [m.tmdb_id, m]));
  // Filmer fra kåringene som ikke er i databasen din («katalogfilmer»)
  const catalogFilm = (c, id) => ({
    ...c, id: id || `tmdb-${c.tmdb_id}`, directors: arr(c.directors), countries: arr(c.countries), cast: arr(c.cast),
    awards: [], tags: [], links: {}, status: { seen: false, want: false, owned: false }, _awardVals: [], _catalog: true,
    knut: { status: { seen: false, want: false, owned: false }, description: "", tags: [] },
  });
  const catalog = new Map();
  for (const [k, c] of Object.entries(LD.catalog || {})) if (!byTmdb.has(+k)) catalog.set(+k, catalogFilm(c));
  // Regissørenes filmografier (data/directors.js – valgfri)
  const DD = window.LANGTAGNING_DIRECTORS || {};
  const directorsData = Array.isArray(DD.directors) ? DD.directors : [];
  const dirByName = new Map(directorsData.map((d) => [d.name, d]));
  for (const [k, c] of Object.entries(DD.films || {})) if (!byTmdb.has(+k) && !catalog.has(+k)) catalog.set(+k, catalogFilm(c));
  // Kinoprogrammer (data/<kino>-program.js – valgfrie, lages med «langtagning.py kino»).
  // Filmer på programmet som ikke finnes andre steder, blir katalogfilmer.
  const CINEMAS = [
    { key: "cinemateket", name: "Cinemateket", place: "Cinemateket i Oslo", data: window.LANGTAGNING_CINEMATEKET_PROGRAM,
      list: "https://www.cinemateket.no/forestillinger", site: "cinemateket.no" },
    { key: "vega", name: "Vega Scene", place: "Vega Scene", data: window.LANGTAGNING_VEGA_PROGRAM,
      list: "https://www.vegascene.no/kino", site: "vegascene.no" },
  ].filter((c) => c.data && c.data.films);
  for (const c of CINEMAS) for (const [k, x] of Object.entries(c.data.catalog || {})) if (!byTmdb.has(+k) && !catalog.has(+k)) catalog.set(+k, catalogFilm(x));
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
    // fast del av søketeksten – tanker og tagger legges til i applyChanges()
    f._searchBase = [
      f.title, f.original_title, f.year, ...f.directors, ...f.cast, ...f.awards, ...f.countries.map(countryName),
    ].join(" ").toLowerCase();
  }
  const byId = new Map(allFilms.map((m) => [m.id, m]));

  // Filmer som kan lånes på filmoteket.no (bibliotekenes strømmetjeneste)
  const FMT = window.LANGTAGNING_FILMOTEKET || {};
  const fmtUrl = (m) => (m.tmdb_id && FMT[m.tmdb_id]) || "";
  // Filmer i strømmetjenestene (Netflix, Disney+, HBO Max) i Norge – data fra JustWatch via TMDB
  const STREAM = window.LANGTAGNING_STREAMING || {};
  const streams = (m) => (m.tmdb_id && STREAM[m.tmdb_id]) || null;
  const streamNames = [...new Set(Object.values(STREAM).flatMap((x) => x.s))].sort((a, b) => collator.compare(a, b));
  // Tjenestene du har valgt under Mine data. Styrer «▶ Strømming» og merkene.
  // Standard er det alle har: Filmoteket (bibliotekkort) og NRK TV.
  const SERVICES = [...(Object.keys(FMT).length ? ["Filmoteket"] : []), ...streamNames];
  const DEFAULT_SERVICES = SERVICES.filter((n) => n === "Filmoteket" || n === "NRK TV");
  const myServices = () => { const v = Store.getMeta("services"); return Array.isArray(v) ? v : DEFAULT_SERVICES; };
  const hasService = (n) => myServices().includes(n);
  const myFmt = (m) => (hasService("Filmoteket") && fmtUrl(m)) || "";
  const myStreams = (m) => (streams(m) ? streams(m).s.filter(hasService) : []);
  const streamable = (m) => !!(myFmt(m) || myStreams(m).length);

  // Kommende visninger per kino (tmdb-id → { url, shows }). Visninger som har vært, tas bort her –
  // programfilene er bare så ferske som siste «langtagning.py kino».
  for (const c of CINEMAS) {
    c.prog = new Map();
    for (const [k, p] of Object.entries(c.data.films)) {
      const shows = p.shows.filter((x) => Date.parse(x.t) > Date.now() - 2 * 3600e3);  // to timer: kan fortsatt gå
      if (shows.length) c.prog.set(+k, { url: p.url, shows });
    }
  }
  const cinemaBy = new Map(CINEMAS.map((c) => [c.key, c]));
  const kinoShows = (m, c) => (m.tmdb_id && (c.prog.get(m.tmdb_id) || {}).shows) || [];
  const kinoUrl = (m, c) => (m.tmdb_id && (c.prog.get(m.tmdb_id) || {}).url) || "";
  const playingAt = (m) => CINEMAS.filter((c) => kinoShows(m, c).length);
  // Første visning – på én kino, eller på den kinoen som viser filmen først
  const firstShow = (m, key) => (key && cinemaBy.has(key) ? kinoShows(m, cinemaBy.get(key)) : playingAt(m).map((c) => kinoShows(m, c)[0]))
    .map((x) => x.t).sort()[0] || "";
  // Cinemateket-arkivet: filmen har en side på cinemateket.no
  const CINE_LINKS = window.LANGTAGNING_CINEMATEKET_LINKS || {};
  const cineUrl = (m) => (m.tmdb_id && (CINE_LINKS[m.tmdb_id] || (cinemaBy.has("cinemateket") && kinoUrl(m, cinemaBy.get("cinemateket"))))) || "";
  // Dato og klokkeslett tas rett fra teksten (norsk tid), så de stemmer uansett tidssonen til den som ser på
  const MONTHS = ["jan.", "feb.", "mars", "april", "mai", "juni", "juli", "aug.", "sep.", "okt.", "nov.", "des."];
  const DAYS = ["søn.", "man.", "tir.", "ons.", "tor.", "fre.", "lør."];
  const showParts = (t) => { const [y, mo, d] = t.slice(0, 10).split("-").map(Number); return { y, mo, d }; };
  const todayKey = (off = 0) => { const n = new Date(Date.now() + off * 864e5); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
  function showDay(t, weekday) {
    if (t.startsWith(todayKey())) return "i dag";
    if (t.startsWith(todayKey(1))) return "i morgen";
    const { y, mo, d } = showParts(t);
    return `${weekday ? DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()] + " " : ""}${d}. ${MONTHS[mo - 1]}`;
  }
  const showTime = (t) => t.slice(11, 16);
  const kinoTitle = (m, c) => `${c.name}:\n` + kinoShows(m, c).map((x) => `${showDay(x.t, true)} kl. ${showTime(x.t)}${x.series ? ` · ${x.series}` : ""}`).join("\n");
  // Merke per kino filmen går på
  const kinoBadges = (m, cls) => playingAt(m).map((c) => `<span class="${cls} kino k-${c.key}" title="${esc(kinoTitle(m, c))}">${esc(c.name.split(" ")[0])} ${esc(showDay(kinoShows(m, c)[0].t))}</span>`);

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

  // ---------- Personlige data: grunnlag + endringer (js/store.js) ----------
  // Eier (lokalt, eller eierflagg online): grunnlaget er movies.js, og butikken holder det som ikke er lagt inn ennå.
  // Venn: grunnlaget er tomt, og butikken holder alt vennen har markert. Knuts data ligger i f.knut.

  const Store = window.LangtagningStore;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ikke tilgjengelig */ } };

  // Eierflagget («dette er Knut») – et visningsvalg, ikke sikkerhet: movies.js er uansett publisert
  const OWNER_KEY = "langtagning-eier";
  const ownerInHash = /(^|&)eier(=1)?(&|$)/.test(location.hash.slice(1));
  if (ownerInHash) lsSet(OWNER_KEY, "1");
  const OWNER_FLAG = lsGet(OWNER_KEY) === "1";
  // ?venn i adressen: test vennemodus lokalt (egen database, ingen kø-fil)
  const FRIEND_TEST = LOCAL && /[?&]venn(=|&|$)/.test(location.search);
  const LOCAL_OWNER = LOCAL && !FRIEND_TEST;
  const OWNER = LOCAL_OWNER || OWNER_FLAG;

  const NONE = { seen: false, want: false, owned: false };
  const sameStatus = (a, b) => !!a.seen === !!b.seen && !!a.want === !!b.want && !!a.owned === !!b.owned;
  const sameTags = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);
  const anyStatus = (s) => !!(s.seen || s.want || s.owned);
  const statusWords = (s) => [s.seen && "sett", s.want && !s.seen && "vil se", s.owned && "eier"].filter(Boolean).join(" · ");

  // Filmer som kan markeres: alt med TMDB-id, og filmene i movies.js
  const canEdit = (f) => !!f.tmdb_id || !f._catalog;
  const keyOf = (f) => (f.tmdb_id ? `tmdb:${f.tmdb_id}` : f.id);
  const baseOf = (f) => OWNER ? { status: f.knut.status, note: f.knut.description, tags: f.knut.tags } : { status: NONE, note: "", tags: [] };
  const filmByKey = new Map(allFilms.filter(canEdit).map((f) => [keyOf(f), f]));

  // Finn filmen en lagret post gjelder: tmdb-id, så film-id, så tittel og år
  let byTitle = null;
  function findFilm(r) {
    if (r.tmdb_id && filmByKey.has(`tmdb:${r.tmdb_id}`)) return filmByKey.get(`tmdb:${r.tmdb_id}`);
    if (filmByKey.has(r.id)) return filmByKey.get(r.id);
    const f = byId.get(r.id);
    if (f && canEdit(f)) return f;
    if (!r.title) return null;
    if (!byTitle) {
      byTitle = new Map();
      for (const x of filmByKey.values()) for (const t of [x.title, x.original_title]) if (t) byTitle.set(`${fold(t)}|${x.year || ""}`, x);
    }
    return byTitle.get(`${fold(r.title)}|${r.year || ""}`) || null;
  }
  const storeKey = (r) => { const f = findFilm(r); return f ? (f._rec ? f._rec.id : keyOf(f)) : null; };
  const pruneStore = () => Store.prune((r) => { const f = findFilm(r); return f ? baseOf(f) : null; });

  let myFilms = [];      // Mitt utvalg: filmer med minst én status, tanke eller tagg (eier: hele movies.js)
  let unknownRecs = [];  // lagrede poster som ikke finnes i katalogen
  function applyChanges() {
    for (const f of allFilms) f._rec = null;
    unknownRecs = [];
    for (const r of Store.all()) {
      const f = findFilm(r);
      if (f) f._rec = r; else unknownRecs.push(r);
    }
    for (const f of allFilms) {
      const b = baseOf(f), r = f._rec || {};
      f.status = { ...(r.status || b.status) };
      f.note = "note" in r ? r.note : b.note;
      f.tags = r.tags ? [...r.tags] : [...b.tags];
      f._queued = OWNER && !!f._rec;  // endring som ikke er lagt inn i movies.js ennå
      f._mine = (OWNER && !f._catalog) || anyStatus(f.status) || !!f.note || f.tags.length > 0;
      f._addedKey = OWNER ? f.added || (f._rec && f._rec.updated) || "" : (f._rec && f._rec.updated) || "";
      f._search = `${f._searchBase} ${f.tags.join(" ")} ${f.note} ${OWNER ? "" : f.knut.description}`.toLowerCase();
    }
    myFilms = allFilms.filter((f) => f._mine);
  }

  // patch: { status?, note?, tags? } – det som er likt grunnlaget, lagres ikke
  function saveChange(f, patch) {
    const b = baseOf(f), out = {};
    if ("status" in patch) out.status = sameStatus(patch.status, b.status) ? undefined : patch.status;
    if ("note" in patch) out.note = patch.note === b.note ? undefined : patch.note;
    if ("tags" in patch) out.tags = sameTags(patch.tags, b.tags) ? undefined : patch.tags;
    Store.set(f._rec ? f._rec.id : keyOf(f), out, { tmdb_id: f.tmdb_id || undefined, title: f.title, year: f.year || undefined });
    applyChanges();
    renderQueueBar();
  }

  function toggleStatus(f, key) {
    if (!f) return;
    const st = { ...f.status };
    st[key] = !st[key];
    if (key === "seen" && st.seen) st.want = false;
    if (key === "want" && st.want) st.seen = false;
    saveChange(f, { status: st });
  }

  // Dagens kø (langtagning-queue i localStorage) flyttes inn i butikken én gang
  function migrateOldQueue() {
    let q = null;
    try { q = JSON.parse(lsGet("langtagning-queue") || "null"); } catch (e) { q = null; }
    if (!q || typeof q !== "object") return;
    const films = Object.entries(q).filter(([, v]) => v && v.status).map(([k, v]) => ({
      id: `tmdb:${k}`, tmdb_id: +k, title: v.title, year: v.year || undefined, status: v.status,
      updated: new Date(v.ts || Date.now()).toISOString(),
    }));
    try { Store.importJSON({ format: "langtagning-user", schema: 1, films }, "merge", storeKey); } catch (e) { console.warn(e); }
    lsSet("langtagning-queue", null);
  }

  // ---------- Eksport ----------

  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportData() {
    const name = Store.getMeta("name") || (OWNER ? "knut" : "");
    const obj = Store.exportJSON({ name, owner: OWNER });
    download(`langtagning-${slug(name) || "mine"}-${obj.exported.slice(0, 10)}.json`, JSON.stringify(obj, null, 1), "application/json");
    renderQueueBar();
  }
  const daysSince = (iso) => iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : Infinity;
  const agoText = (iso) => { const d = daysSince(iso); return d === Infinity ? "" : d <= 0 ? "i dag" : d === 1 ? "i går" : `for ${d} dager siden`; };

  function actionsHTML(f) {
    if (!canEdit(f)) return "";
    const b = (key, label, icon) => `<button class="act ${key}" data-act="${key}" data-film="${esc(f.id)}" aria-pressed="${!!f.status[key]}" title="${label}">${icon}<span>${label}</span></button>`;
    return b("seen", "Sett", "✓") + b("want", "Vil se", "+") + b("owned", "Eier", "◉");
  }

  // Påminnelse om backup (venner): etter 25 endringer eller 14 dager uten eksport
  function reminderDue() {
    if (OWNER) return false;
    const s = Store.stats();
    if (!s.changes || !myFilms.length) return false;
    const snooze = Store.getMeta("snoozeUntil");
    if (snooze && snooze > new Date().toISOString()) return false;
    return s.changes >= 25 || daysSince(s.lastExport || s.created) >= 14;
  }

  // Stripen nederst: køen (eier) eller påminnelse om backup (venn)
  function renderQueueBar() {
    const bar = $("#qbar");
    if (!bar) return;
    if (!OWNER) {
      bar.classList.remove("mini");
      bar.hidden = !reminderDue();
      if (bar.hidden) return;
      const n = Store.stats().changes;
      bar.innerHTML = `
        <div class="qbar-inner">
          <span class="qbar-count">Du har <strong>${n}</strong> ${n === 1 ? "endring" : "endringer"} siden siste backup</span>
          <span class="qbar-file">Dataene ligger bare i denne nettleseren. Last ned en kopi, så kan du hente dem inn igjen senere.</span>
          <div class="qbar-actions"><button class="btn-primary" data-q="export">Last ned</button><button class="btn-ghost" data-q="snooze">Senere</button></div>
        </div>`;
      return;
    }
    // Eier: lite merke om endringer som ikke er lagt inn i movies.js – detaljene ligger i «Mine data»
    const n = Store.all().length;
    bar.hidden = !n;
    bar.classList.add("mini");
    if (n) bar.innerHTML = `<button class="qbar-count" data-q="mydata" title="Eksporter under Mine data, og kjør python3 tools/langtagning.py queue"><strong>${n}</strong> ${n === 1 ? "endring" : "endringer"} ikke lagt inn <span>→ Mine data</span></button>`;
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
  // «Knuts utvalg» kan filtreres på Knuts statuser i stedet for dine egne (&st=knut)
  const knutFilter = () => state.st === "knut" && src && src.kind === "knut";
  const statusOf = (f) => (knutFilter() ? f.knut.status : f.status);
  const matchStatus = (f, s) => {
    const st = statusOf(f);
    return s === "all" ? true : s === "unseen" ? !st.seen : s === "missing" ? !f._mine : !!st[s];
  };

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
    src: "", st: "", status: "all", stream: "", shorts: "", q: "", director: "", country: "", award: "", list: "", decade: "", actor: "", kino: "",
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
    if (p.get("cine") === "snart") s.kino = "1";
    if (s.kino) s.kino = "1";  // gamle bokmerker: kino=cinemateket / vega / * gjelder nå alle kinoene
    if (s.src === "cine") s.src = "kino:cinemateket";
    if (p.get("sort") === "rank") s.sort = "list";
    if (s.src && !sourceOf(s.src, s)) s.src = "";
    if (s.st !== "knut" || s.src !== "knut") s.st = "";
    if (!STATUSES.some((x) => x.key === s.status) || (s.status === "missing" && (!s.src || s.st))) s.status = "all";
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
  const inFilmography = (x) => x.kind === "feature" || !!(filmFor(x.id) || {})._mine;

  function sourceOf(id, st = state) {
    if (!id) return null;
    if (id === "knut") {  // Knuts filmer for venner – oppfører seg som en kåring
      if (OWNER) return null;
      return { id, kind: "knut", name: "Knuts utvalg", size: movies.length, entries: movies.map((m) => ({ _film: m })) };
    }
    if (id.startsWith("kino:")) {  // programmet på én kino, etter neste visning
      const c = cinemaBy.get(id.slice(5));
      if (!c || !c.prog.size) return null;
      const films = [...c.prog.keys()].map(filmFor).filter(Boolean).sort((a, b) => firstShow(a, c.key).localeCompare(firstShow(b, c.key)));
      const last = films.flatMap((f) => kinoShows(f, c)).map((x) => x.t).sort().pop();
      return { id, kind: "kino", cinema: c, name: `${c.name} – programmet`, source: c.list,
        last, size: films.length, entries: films.map((f) => ({ _film: f })) };
    }
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
  const isRanked = (src) => src && !["group", "collection", "director", "knut", "kino"].includes(src.kind);
  const sortKey = () => state.sort || (state.src ? "list" : "title");
  // Rangerte kåringer vises som liste (plassering, bevegelse, knapper). Utvalg uten rekkefølge – Mitt utvalg,
  // Knuts utvalg, regissører og usorterte samlinger – vises som plakater.
  const defaultLayout = () => src && (isRanked(src) || (src.kind === "group" && !src.coll)) ? "rows" : "grid";
  const layoutKey = () => state.layout || defaultLayout();

  // ---------- Filtrering ----------

  function passes(f, skip) {
    if (skip !== "status" && !matchStatus(f, state.status)) return false;
    if (skip !== "stream" && state.stream && !streamable(f)) return false;
    if (skip !== "kino" && state.kino && !playingAt(f).length) return false;
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
    "added": (a, b) => collator.compare(b._addedKey || "", a._addedKey || "") || (b._order || 0) - (a._order || 0),
    "runtime": (a, b) => (b.runtime || 0) - (a.runtime || 0),
    "awards": (a, b) => b.awards.length - a.awards.length || SORTS["year-asc"](a, b),
    "kino": (a, b) => (firstShow(a, state.kino) || "~").localeCompare(firstShow(b, state.kino) || "~") || SORTS.title(a, b),
  };

  let src = null;        // valgt liste (null = Mitt utvalg)
  let baseItems = [];    // alle rader i utvalget: { f, e (plassering), group }
  let baseFilms = [];    // unike filmer i utvalget
  let items = [];        // rader etter filtrering og sortering
  let current = [];      // unike filmer etter filtrering (brukes av terningen)

  function computeBase() {
    src = sourceOf(state.src);
    baseItems = src ? src.entries.map((e) => ({ f: e._film, e, group: e._group })) : myFilms.map((m) => ({ f: m }));
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
    if (!OWNER && anyStatus(m.knut.status)) b.push(`<span class="badge knut" title="Knuts status">Knut: ${esc(statusWords(m.knut.status))}</span>`);
    if (m.status.owned) b.push('<span class="badge own">Eier</span>');
    if (m.status.want && !m.status.seen) b.push('<span class="badge want">Vil se</span>');
    if (myFmt(m)) b.push('<span class="badge stream" title="Kan lånes på filmoteket.no">Filmoteket</span>');
    if (myStreams(m).length) b.push(`<span class="badge stream" title="Kan strømmes i Norge">${esc(myStreams(m).join(" · "))}</span>`);
    b.push(...kinoBadges(m, "badge"));
    if (m.awards.length) b.push(`<span class="badge award" title="${esc(m.awards.join("\n"))}">${LAUREL}${m.awards.length > 1 ? m.awards.length : ""}</span>`);
    return b.length ? `<div class="badges">${b.join("")}</div>` : "";
  }

  const queuedPill = (f) => f._queued ? '<span class="pill queued" title="Endringen er ikke lagt inn i movies.js ennå – eksporter under Mine data, og kjør python3 tools/langtagning.py queue">i kø</span>' : "";
  function statusPills(f) {
    if (!f._mine) return '<span class="pill ghost">Ikke registrert</span>';
    const p = [queuedPill(f)];
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
    html += opt("", `Mitt utvalg (${myFilms.length})`);
    if (!OWNER) html += opt("knut", `Knuts utvalg (${movies.length})`);
    for (const c of CINEMAS) if (c.prog.size) html += opt(`kino:${c.key}`, `${c.name} – programmet (${sourceOf(`kino:${c.key}`).size})`);
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
          // årslistene (Cahiers) har bare «Alle år» – én årgang vises bare når den er valgt (fra plasseringene)
          o += (coll ? seriesLists(s).slice().reverse() : seriesLists(s).filter((x) => x.id === state.src))
            .map((x) => opt(x.id, coll ? (x.numbered ? x.short : `${x.short} (${x.year})`) : `${x.year}`)).join("");
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

  // Status-knapper (tall følger filtrene) + «Strømming»
  function renderStatus() {
    const base = baseFilms.filter((f) => passes(f, "status"));
    // I «Knuts utvalg»: velg om statusfilteret gjelder dine eller Knuts statuser
    let html = src && src.kind === "knut"
      ? `<span class="whose" role="group" aria-label="Filtrer på"><span>Filtrer på</span><button data-st="" aria-pressed="${!state.st}">Mine</button><button data-st="knut" aria-pressed="${state.st === "knut"}">Knuts</button></span>` : "";
    html += STATUSES.filter((s) => !s.listsOnly || (src && !state.st)).map((s) =>
      `<button class="tab" data-status="${s.key}" aria-pressed="${state.status === s.key}">${s.label}<span class="n">${base.filter((f) => matchStatus(f, s.key)).length}</span></button>`).join("");
    if (myServices().length) {
      const n = baseFilms.filter((f) => passes(f, "stream") && streamable(f)).length;
      const where = myServices().map((s) => (s === "Filmoteket" ? "Filmoteket (lån med bibliotekkortet)" : s)).join(", ");
      html += `<button class="tab stream-toggle" data-stream aria-pressed="${!!state.stream}" title="Bare filmer som kan sees på ${esc(where)}">▶ Strømming<span class="n">${n}</span></button>`;
    }
    const kinos = CINEMAS.filter((c) => c.prog.size);
    if (kinos.length && !(src && src.kind === "kino")) {  // i et kinoprogram går alle filmene på kino
      const n = baseFilms.filter((f) => passes(f, "kino") && playingAt(f).length).length;
      html += `<button class="tab kino-toggle" data-kino aria-pressed="${!!state.kino}" title="Bare filmer som går på ${esc(kinos.map((c) => c.name).join(" eller "))} de neste ukene">🎬 På kino<span class="n">${n}</span></button>`;
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
    const seen = cnt((f) => statusOf(f).seen), owned = cnt((f) => statusOf(f).owned),
      want = cnt((f) => statusOf(f).want && !statusOf(f).seen), missing = cnt((f) => !f._mine);
    const pct = (x) => n ? Math.round((x / n) * 1000) / 10 : 0;
    const desc = src.kind === "knut" ? `${total} filmer Knut har sett, vil se eller eier`
      : src.kind === "kino" ? `${total} filmer frem til ${esc(showDay(src.last))}${src.cinema.data.updated ? ` · hentet ${esc(showDay(src.cinema.data.updated))}` : ""}`
      : src.kind === "director"
      ? `${total} ${state.shorts ? "filmer" : "spillefilmer"}${src.span ? ` (${src.span})` : ""}${src.extra ? ` · <button class="linklike" data-shorts>ta med ${src.extra} kortfilmer, TV-filmer og dokumentarer</button>` : state.shorts ? ' · <button class="linklike" data-shorts>bare spillefilmer</button>' : ""}`
      : src.coll ? `${total} filmer fra ${src.size} lister` : src.kind === "group" ? `${total} filmer fra ${src.size} årganger`
      : src.kind === "collection" ? `${total} filmer` : `${total} filmer${total !== src.size ? ` (topp ${src.size} med delte plasseringer)` : ""}`;
    head.innerHTML = `
      <div>
        <h2>${esc(src.name)}</h2>
        <p class="lv-source">${desc}${src.source ? ` · <a href="${esc(src.source)}" target="_blank" rel="noopener">${src.kind === "director" ? "TMDB" : src.kind === "kino" ? src.cinema.site : "Kilde"}</a>` : ""}</p>
      </div>
      <div class="lv-progress" role="img" aria-label="${state.st ? "Knut har sett" : "Sett"} ${seen} av ${n}">
        <div class="lv-big"><strong>${seen}</strong> av ${n}${n !== total ? " (filtrert)" : ""} ${state.st ? "sett av Knut" : "sett"} <span>${pct(seen)} %</span></div>
        <div class="lv-bar"><i class="b-seen" style="width:${pct(seen)}%"></i><i class="b-want" style="width:${pct(want)}%"></i></div>
        <div class="lv-stats">
          <span><i class="d-seen"></i>Sett ${seen}</span>
          <span><i class="d-want"></i>Vil se ${want}</span>
          <span><i class="d-own"></i>Eier ${owned}</span>
          ${state.st ? "" : `<span><i class="d-miss"></i>Ikke registrert ${missing}</span>`}
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
    sortSel.querySelector('option[value="list"]').textContent = src && src.kind === "director" ? "Kronologisk" : src && src.kind === "knut" ? "Knuts rekkefølge" : src && src.kind === "kino" ? "Neste visning" : "Plassering i lista";
    sortSel.querySelector('option[value="list"]').disabled = !src;
    sortSel.querySelector('option[value="added"]').hidden = !!src;
    sortSel.querySelector('option[value="kino"]').hidden = !CINEMAS.length || (src && src.kind === "kino");
    sortSel.value = sortKey();
  }

  function renderChips() {
    const chips = [];
    if (state.q) chips.push({ k: "q", label: `«${state.q}»` });
    if (state.stream) chips.push({ k: "stream", label: "Strømming" });
    if (state.kino) chips.push({ k: "kino", label: "På kino" });
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
    if (myFmt(f)) t.push('<span class="mt stream">▶ Filmoteket</span>');
    if (myStreams(f).length) t.push(`<span class="mt stream">▶ ${esc(myStreams(f).join(" · "))}</span>`);
    t.push(...kinoBadges(f, "mt"));
    if (!OWNER && anyStatus(f.knut.status)) t.push(`<span class="mt knut" title="Knuts status">Knut: ${esc(statusWords(f.knut.status))}</span>`);
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
    return `${showGroup ? `<li class="lv-yearhead">${esc(x.group)}</li>` : ""}<li class="lv-item${canEdit(f) ? " has-act" : ""}" style="animation-delay:${Math.min(i % CHUNK, 30) * 12}ms"><button class="lv-row${f._mine ? "" : " is-missing"}${f.status.seen ? " is-seen" : ""}" data-id="${esc(f.id)}">
        <span class="lv-rank">${rank}</span>
        <span class="lv-thumb">${posterHTML(f)}</span>
        <span class="lv-text"><b>${esc(f.title)}</b>${orig}
          <span class="lv-meta">${esc(f.year || (e && e.year) || "")}${f.directors.length ? " · " + esc(f.directors.join(", ")) : ""}${f.countries.length ? " · " + esc(f.countries.map(countryName).join(", ")) : ""}</span>${miniTags(f)}</span>
        <span class="lv-status">${canEdit(f) ? queuedPill(f) : statusPills(f)}</span>
        <span class="lv-mv">${src && e ? movement(src, e) : ""}</span>
      </button>${canEdit(f) ? `<div class="lv-act">${actionsHTML(f)}</div>` : ""}</li>`;
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
    if (!n) $("#empty").innerHTML = emptyHTML();
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
    renderWelcome();
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
    const cine = cineUrl(m);
    if (cine) L.push({ cls: "cinemateket", tag: "C", name: "Cinemateket", url: cine });
    const vega = cinemaBy.has("vega") && kinoUrl(m, cinemaBy.get("vega"));
    if (vega) L.push({ cls: "vega", tag: "V", name: "Vega Scene", url: vega });
    // Filmfrelst-episoder om filmen (data/filmfrelst.js), nyeste først
    for (const ep of (m.tmdb_id && FF[m.tmdb_id]) || []) L.push({ cls: "ff", tag: "FF", name: ep.n ? `Filmfrelst #${ep.n}` : "Filmfrelst", url: ep.u, title: ep.t });
    for (const [k, url] of Object.entries(m.links)) {
      if (!url || ["imdb", "bfi", "rt", "ebert", "criterion"].includes(k)) continue;
      L.push({ cls: "", tag: "↗", name: k, url });
    }
    return L.map((l) => `<a class="extlink" href="${esc(l.url)}" target="_blank" rel="noopener"${l.title ? ` title="${esc(l.title)}"` : ""}><i class="${l.cls}">${esc(l.tag)}</i>${esc(l.name)}${l.search ? " <small>søk</small>" : ""}</a>`).join("");
  }

  // Omtaler fra cinemateket.no – teksten bare lokalt (se index.html), ellers bare lenke
  // Roger Ebert- og Criterion-ID-er fra Wikidata (tmdb-id → {ebert, criterion})
  const WIKILINKS = window.LANGTAGNING_WIKILINKS || {};
  // Filmfrelst-podkasten (Montages.no): tmdb-id → [{n, t, d, u}]
  const FF = window.LANGTAGNING_FILMFRELST || {};
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

  // Kommende visninger per kino, med billettlenke (ellers filmsiden – der ligger kjøpsknappene)
  function kinoShowsHTML(m) {
    return playingAt(m).map((c) => `<section class="cine-shows k-${c.key}">
      <h2 class="sec-label">På ${esc(c.place)}</h2>
      <ul>${kinoShows(m, c).map((x) => `<li>
        <span class="cs-when"><b>${esc(showDay(x.t, true))}</b> kl. ${esc(showTime(x.t))}</span>
        <span class="cs-where">${esc([x.screen, x.series].filter(Boolean).join(" · "))}</span>
        <a class="cs-buy" href="${esc(x.ticket || kinoUrl(m, c))}" target="_blank" rel="noopener">${x.ticket ? "Kjøp billett" : "Billetter"}</a>
      </li>`).join("")}</ul>
    </section>`).join("");
  }

  // Plassering i kåringene over tid: tabell per serie + liten graf
  function rankingsHTML(m) {
    if (!m._listVals.length) return "";
    const annual = annualSeries.map((s) => [s, annualRanks(m, s)]).filter(([, r]) => r.length).map(([s, r]) => `
      <div class="rk-row"><span class="rk-key annual"><i></i>${esc(s)}</span><div class="rk-cells">${r.map(({ list, e }) => isColl(s)
        ? `<button class="rk-cell rk-link" data-goto="${esc(list.id)}" title="Vis lista"><small>${list.numbered ? esc(list.short) : list.year || "vist"}</small>${list.numbered ? `#${e.rank}` : esc(list.short)}</button>`
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
  // Dine egne felt: statusknapper, «Mine tanker» (lagres automatisk) og tagger (skriv og trykk Enter)
  function mineHTML(m) {
    if (!canEdit(m)) return "";
    const tags = m.tags.map((t) => `<span class="tagchip"><button class="linklike" data-tagfilter="${esc(t)}">#${esc(t)}</button><button class="tag-x" data-untag="${esc(t)}" aria-label="Fjern taggen ${esc(t)}">×</button></span>`).join("");
    const known = [...new Set(myFilms.flatMap((f) => f.tags))].sort(collator.compare);
    return `<section class="mine">
      <div class="act-row">${actionsHTML(m)}</div>
      <label class="note note-edit"><span class="note-label">Mine tanker</span>
        <textarea id="d-note" rows="2" placeholder="Hva gjorde filmen med deg? Lagres automatisk.">${esc(m.note)}</textarea></label>
      <div class="tagedit"><span class="tagedit-label">Tagger</span>${tags}<input id="d-tag" type="text" list="d-taglist" placeholder="${m.tags.length ? "Ny tagg" : "Legg til tagg"} + Enter" enterkeyhint="done" autocomplete="off" aria-label="Ny tagg"><datalist id="d-taglist">${known.map((t) => `<option value="${esc(t)}">`).join("")}</datalist></div>
      ${OWNER ? `<p class="mine-hint">${m._queued ? "Endringen er ikke lagt inn i movies.js ennå." : "Endringer lagres i nettleseren."} Eksporter under <b>Mine data</b>, og kjør <code>python3 tools/langtagning.py queue</code>.</p>` : ""}
    </section>`;
  }

  // Knuts status og tanker – vises for venner, under deres egne
  function knutHTML(m) {
    if (OWNER) return "";
    const st = statusWords(m.knut.status);
    if (!st && !m.knut.description) return "";
    return `<div class="note knut-note"><span class="note-label">${m.knut.description ? "Knuts tanker" : "Knut"}${st ? ` · ${esc(st)}` : ""}</span>${esc(m.knut.description)}</div>`;
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

    // Kan du endre filmen, viser knappene statusen – da står bare «i kø» igjen her
    // Status vises med knappene; merkene bare for filmer som ikke kan redigeres (som i listevisningen)
    const pills = canEdit(m) ? [queuedPill(m)].filter(Boolean) : [statusPills(m)].filter(Boolean);

    const rows = [];
    if (m.directors.length) rows.push(["Regi", m.directors.map((d) => filterBtns("director", [d]) +
      (dirByName.has(d) ? ` <button class="filmo" data-goto="dir:${esc(d)}">Hele filmografien →</button>` : "")).join(", ")]);
    if (m.countries.length) rows.push(["Land", filterBtns("country", m.countries, countryName)]);
    if (m.cast.length) rows.push(["Medvirkende", filterBtns("actor", m.cast)]);
    if (m.tags.length && !canEdit(m)) rows.push(["Tagger", m.tags.map((t) => `<button class="linklike" data-tagfilter="${esc(t)}">#${esc(t)}</button>`).join(" ")]);

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
            ${pills.length || fmtUrl(m) || streams(m) ? `<div class="statusrow">${pills.join("")}${fmtUrl(m) ? `<a class="pill stream" href="${esc(fmtUrl(m))}" target="_blank" rel="noopener">▶ Lån på Filmoteket</a>` : ""}${(streams(m) ? streams(m).s : []).map((n) =>
              `<a class="pill stream" href="${esc(streams(m).url)}" target="_blank" rel="noopener" title="Strømmedata fra JustWatch">▶ ${esc(n)}</a>`).join("")}</div>` : ""}
            ${m.awards.length ? `<ul class="awards">${m.awards.map((a) =>
              `<li><button data-filter="award" data-v="${esc(a)}">${LAUREL}<span>${a.includes(" – ") ? `<small>${esc(awardGroup(a))}</small>${esc(a.split(" – ").slice(1).join(" – "))}` : esc(a)}</span></button></li>`).join("")}</ul>` : ""}
            ${kinoShowsHTML(m)}
            ${mineHTML(m)}
            ${knutHTML(m)}
            ${cineHTML(m) || (m.overview ? `<p class="overview">${esc(m.overview)}</p>` : "")}
            <dl class="meta">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
            <div class="links">${linksFor(m)}</div>
            ${rankingsHTML(m)}
          </div>
        </div>
      </div>`;
    if (!dialog.open) dialog.showModal();
    $(".detail-scroll", dialog).scrollTop = 0;
    growNote();
  }

  // Tegn detaljvisningen på nytt (etter en endring) uten å miste rulleposisjonen
  function refreshDetail(focus) {
    const sc = $(".detail-scroll", dialog).scrollTop;
    openDetail(state.film, false);
    $(".detail-scroll", dialog).scrollTop = sc;
    if (focus) { const el = $(focus, dialog); if (el) el.focus({ preventScroll: true }); }
  }

  // «Mine tanker»: feltet vokser med teksten, og lagres litt etter at du slutter å skrive
  function growNote() {
    const ta = $("#d-note", dialog);
    if (ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight + 2}px`; }
  }
  let noteTimer = null, listDirty = false;
  function flushNote() {
    clearTimeout(noteTimer);
    noteTimer = null;
    const ta = $("#d-note", dialog), f = byId.get(state.film);
    if (!ta || !f || ta.value === f.note) return;
    saveChange(f, { note: ta.value });
    listDirty = true;
  }
  function addTags(f, text) {
    const add = text.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
    const tags = [...f.tags];
    for (const t of add) if (!tags.includes(t)) tags.push(t);
    if (tags.length !== f.tags.length) saveChange(f, { tags });
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

  dialog.addEventListener("close", () => {
    flushNote();
    if (listDirty) { listDirty = false; render(); }
    if (state.film) { state.film = ""; writeHash(false); }
  });
  dialog.addEventListener("input", (e) => {
    if (e.target.id !== "d-note") return;
    growNote();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(flushNote, 600);
  });
  dialog.addEventListener("focusout", (e) => { if (e.target.id === "d-note") flushNote(); });
  dialog.addEventListener("keydown", (e) => {
    if (e.target.id !== "d-tag" || e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    const f = byId.get(state.film);
    if (!f || !e.target.value.trim()) return;
    flushNote();
    addTags(f, e.target.value);
    refreshDetail("#d-tag");
    listDirty = true;
  });
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
      flushNote();
      toggleStatus(byId.get(act.dataset.film), act.dataset.act);
      refreshDetail();
      render();
      return;
    }
    const untag = e.target.closest("[data-untag]");
    if (untag) {
      const f = byId.get(state.film);
      flushNote();
      saveChange(f, { tags: f.tags.filter((t) => t !== untag.dataset.untag) });
      refreshDetail("#d-tag");
      listDirty = true;
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
    if (state.src !== "knut") state.st = "";
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
    const w = e.target.closest("[data-st]");
    if (w) {
      state.st = w.dataset.st;
      if (state.st && state.status === "missing") state.status = "all";
      return update();
    }
    if (e.target.closest("[data-stream]")) { state.stream = state.stream ? "" : "1"; return update(); }
    if (e.target.closest("[data-kino]")) { state.kino = state.kino ? "" : "1"; update(); }
  });

  $("#layoutpick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-layout]");
    if (!b) return;
    // lagre bare et valg som avviker fra standarden for utvalget
    state.layout = b.dataset.layout === defaultLayout() ? "" : b.dataset.layout;
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
      toggleStatus(byId.get(act.dataset.film), act.dataset.act);
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

  // Stripen nederst: køen (eier) eller påminnelse om backup (venn)
  const changed = () => { applyChanges(); renderQueueBar(); render(); };
  $("#qbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-q]");
    if (!b) return;
    if (b.dataset.q === "mydata") openMyData();
    else if (b.dataset.q === "export") exportData();
    else if (b.dataset.q === "snooze") { Store.setMeta("snoozeUntil", new Date(Date.now() + 3 * 864e5).toISOString()); renderQueueBar(); }
  });

  // ---------- Velkomst (venner, første besøk) ----------

  const WELCOME_KEY = "langtagning-velkommen";
  const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
  const safariTip = "Safari kan slette data for sider du ikke har besøkt på sju dager. Legg siden til på Hjem-skjermen (Del → Legg til på Hjem-skjerm), så får dataene være i fred.";
  // Forslag til hvor man kan starte: Knuts utvalg, hovedlista (S&S) og nyeste TSPDT
  const tspdtList = rankLists.filter((l) => /^tspdt/i.test(l.id)).sort((a, b) => b.year - a.year)[0] || null;
  const startLinks = () => `<button class="btn-primary" data-goto="knut">Se Knuts utvalg</button>` +
    [primaryList, tspdtList].filter((l, i, a) => l && a.indexOf(l) === i)
      .map((l) => `<button class="btn-ghost" data-goto="${esc(l.id)}">${esc(l.short)}</button>`).join("");

  function renderWelcome() {
    const box = $("#welcome");
    box.hidden = OWNER || !!state.src || lsGet(WELCOME_KEY) === "skjult";
    if (box.hidden) return;
    box.innerHTML = `
      <button class="icon-btn close" data-welcome="hide" aria-label="Skjul">${ICON_X}</button>
      <h2>Velkommen til Langtagning</h2>
      <p>Dette er Knuts filmkartotek, med kritikernes kåringer og regissørenes filmografier. Du kan bruke det som ditt eget:
        åpne en film og trykk <b>Sett</b>, <b>Vil se</b> eller <b>Eier</b>, og skriv gjerne egne tanker og tagger.
        Filmene du markerer, samles i <b>Mitt utvalg</b>.</p>
      <p>Alle utvalg kan vises som plakater eller som liste: bytt med knappene øverst til høyre (<b>▦ Plakater</b> og <b>☰ Liste</b>).
        Listevisningen viser plasseringen i kåringene, og har knappene for å markere rett i lista.</p>
      <p>Alt lagres bare i denne nettleseren. Ingen konto, og ingenting sendes noe sted. Last derfor ned en kopi av og til under
        <button class="linklike" data-welcome="mydata">Mine data</button>, særlig før du bytter nettleser eller telefon.</p>
      ${isSafari ? `<p class="welcome-tip">${safariTip}</p>` : ""}
      <div class="welcome-actions">${startLinks()}<button class="btn-ghost" data-welcome="hide">Skjul</button></div>`;
  }
  $("#welcome").addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]");
    if (g) return gotoSrc(g.dataset.goto);
    const w = e.target.closest("[data-welcome]");
    if (!w) return;
    if (w.dataset.welcome === "hide") { lsSet(WELCOME_KEY, "skjult"); renderWelcome(); }
    else openMyData();
  });

  function emptyHTML() {
    if (!src && !myFilms.length) {
      return `<p class="empty-title">Du har ikke markert noen filmer ennå</p>
        <p>Åpne en film og trykk <b>Sett</b>, <b>Vil se</b> eller <b>Eier</b>, så havner den her. Start gjerne her:</p>
        <div class="welcome-actions">${startLinks()}</div>`;
    }
    return '<p class="empty-title">Ingen filmer her</p><p>Prøv å fjerne et filter eller endre søket.</p>';
  }
  $("#empty").addEventListener("click", (e) => { const g = e.target.closest("[data-goto]"); if (g) gotoSrc(g.dataset.goto); });

  // ---------- Mine data: eksport, import, sletting og eierflagg ----------

  const mydata = $("#mydata");
  let mdMsg = null;        // { kind: "ok" | "err", html }
  let mdImport = null;     // fil som venter på valg: { obj, file }
  let mdConfirm = "";      // "delete" | "owner"

  function mdSummary() {
    const s = Store.stats();
    const last = s.lastExport ? `sist eksportert ${agoText(s.lastExport)}` : "aldri eksportert";
    if (OWNER) {
      return `${movies.length} filmer i movies.js · ${s.films ? `<b>${s.films}</b> ${s.films === 1 ? "endring" : "endringer"} ikke lagt inn` : "ingen endringer som venter"} · ${last}`;
    }
    return `${myFilms.length} ${myFilms.length === 1 ? "film" : "filmer"} i Mitt utvalg · ${last}`;
  }

  // Eier: endringene som ikke er lagt inn i movies.js, og kommandoen som legger dem inn
  function pendingHTML() {
    const what = (r) => [r.status && (statusWords(r.status) || "fjern status"), "note" in r && "tanker", r.tags && "tagger"].filter(Boolean).join(" · ");
    const items = Store.all().sort((a, b) => (a.updated || "").localeCompare(b.updated || ""));
    return `<ul class="md-pending">${items.map((r) => `<li><span>${esc(r.title || r.id)}${r.year ? ` <small>${r.year}</small>` : ""}</span><em>${esc(what(r))}</em><button class="icon-btn" data-md="remove" data-key="${esc(r.id)}" aria-label="Fjern endringen" title="Fjern endringen">${ICON_X}</button></li>`).join("")}</ul>
      <div class="cmd"><span>Kjør så i Terminal:</span><code>python3 tools/langtagning.py queue</code><button class="copy" data-copy="python3 tools/langtagning.py queue">Kopier</button></div>`;
  }

  function renderMyData() {
    const s = Store.stats();
    const storeWarn = s.backend === "memory"
      ? `<div class="md-msg err">Nettleseren tillater ikke lagring her (privat modus?). Det du markerer, forsvinner når fanen lukkes. Last ned en kopi før du går.</div>`
      : s.backend === "local" ? `<div class="md-msg">Lagres i nettleserens enkle lager (localStorage), siden IndexedDB ikke er tilgjengelig.</div>` : "";
    const imp = mdImport ? (() => {
      const n = mdImport.obj.films.length, o = mdImport.obj;
      const other = !!o.owner !== OWNER;
      return `<div class="md-choice">
        <p><b>${esc(mdImport.file)}</b>: ${n} ${n === 1 ? "film" : "filmer"}${o.name ? ` fra ${esc(o.name)}` : ""}${o.exported ? `, eksportert ${esc(o.exported.slice(0, 10))}` : ""}.</p>
        ${other ? `<p class="md-note">Fila er laget ${o.owner ? "med" : "uten"} eierflagg, altså mot et annet grunnlag enn du bruker nå.</p>` : ""}
        <div class="md-row">
          <button class="btn-primary" data-md="merge">Slå sammen (nyeste vinner)</button>
          <button class="btn-ghost" data-md="replace">Erstatt alt</button>
          <button class="btn-ghost" data-md="cancel">Avbryt</button>
        </div></div>`;
    })() : "";
    const unknown = unknownRecs.length ? `
      <section class="md-sec">
        <h2>Ukjente filmer</h2>
        <p>Disse ${unknownRecs.length} filmene finnes ikke i katalogen lenger (eller ennå). De beholdes, og blir med i eksporten.</p>
        <ul class="md-list">${unknownRecs.map((r) => `<li>${esc(r.title || r.id)}${r.year ? ` <small>${r.year}</small>` : ""}${r.status && statusWords(r.status) ? ` <em>${esc(statusWords(r.status))}</em>` : ""}</li>`).join("")}</ul>
      </section>` : "";
    const ownerSec = LOCAL_OWNER
      ? `<p>Siden kjører lokalt og bruker alltid <code>movies.js</code> som grunnlag.</p>`
      : FRIEND_TEST && !OWNER ? `<p>Testmodus (<code>?venn</code>): siden later som den ligger på nett, uten eierflagg, med egen database. Fjern <code>?venn</code> fra adressen for å gå tilbake.</p>`
      : mdConfirm === "owner" ? `
        <div class="md-choice">
          <p>Du har ${s.films} ${s.films === 1 ? "endring" : "endringer"} gjort mot ${OWNER ? "movies.js" : "et tomt grunnlag"}. Hva skal skje med dem?</p>
          <div class="md-row">
            <button class="btn-primary" data-md="owner-export">Last ned, og bytt</button>
            <button class="btn-ghost" data-md="owner-keep">Behold dem, og bytt</button>
            <button class="btn-ghost" data-md="owner-delete">Slett dem, og bytt</button>
            <button class="btn-ghost" data-md="cancel">Avbryt</button>
          </div></div>`
      : `<label class="md-switch"><input type="checkbox" data-md="owner"${OWNER ? " checked" : ""}> <span>Dette er min samling</span></label>
        <p class="md-note">Bare for Knut: viser hele <code>movies.js</code> som Mitt utvalg, og samler endringene til <code>langtagning.py queue</code>.
          Det er bare et visningsvalg i denne nettleseren.</p>`;
    $("#mydata-body").innerHTML = `
      <h1 id="mydata-title">Mine data</h1>
      <p class="about-byline">${mdSummary()}</p>
      ${storeWarn}
      ${mdMsg ? `<div class="md-msg ${mdMsg.kind}" role="status">${mdMsg.html}</div>` : ""}
      <section class="md-sec">
        <h2>Eksporter</h2>
        <p>${OWNER
          ? "Laster ned endringene som ikke er lagt inn i movies.js. Fila havner i Nedlastinger, og <code>python3 tools/langtagning.py queue</code> finner den der."
          : "Laster ned alt du har markert, som en fil. Den kan hentes inn igjen her, i hvilken som helst nettleser."}</p>
        <div class="md-row">
          ${OWNER ? "" : `<label class="md-name"><span>Navn i filnavnet</span><input id="md-name" type="text" value="${esc(Store.getMeta("name") || "")}" placeholder="f.eks. ola" autocomplete="off"></label>`}
          <button class="btn-primary" data-md="export"${s.films ? "" : " disabled"}>Eksporter</button>
        </div>
        ${OWNER && s.films ? pendingHTML() : ""}
      </section>
      ${SERVICES.length ? `<section class="md-sec">
        <h2>Strømmetjenester</h2>
        <p>Kryss av for dem du har. Bare disse tas med under «▶ Strømming» og som merker på plakatene.
          Detaljvisningen viser fortsatt alle. Standard er det alle har: Filmoteket og NRK TV.</p>
        <div class="md-services">${SERVICES.map((n) =>
          `<label class="md-check"><input type="checkbox" data-service="${esc(n)}"${hasService(n) ? " checked" : ""}> <span>${esc(n)}${n === "Filmoteket" ? " <small>(bibliotekkort)</small>" : ""}</span></label>`).join("")}</div>
      </section>` : ""}
      <section class="md-sec">
        <h2>Importer</h2>
        <p>Henter inn en eksportfil. Du velger om den skal slås sammen med det du har, eller erstatte alt.</p>
        <input type="file" id="md-file" accept=".json,application/json" hidden>
        ${imp || '<button class="btn-ghost" data-md="pick">Velg fil …</button>'}
      </section>
      ${unknown}
      <section class="md-sec">
        <h2>Slett alle mine data</h2>
        ${mdConfirm === "delete" ? `
          <div class="md-choice danger">
            <p>Alt du har markert i denne nettleseren slettes${OWNER ? " (movies.js berøres ikke)" : ""}. Det kan ikke angres.</p>
            <div class="md-row"><button class="btn-danger" data-md="delete-yes">Ja, slett alt</button><button class="btn-ghost" data-md="cancel">Avbryt</button></div>
          </div>` : `<p>Fjerner status, tanker og tagger fra denne nettleseren.</p>
          <button class="btn-ghost" data-md="delete"${s.films ? "" : " disabled"}>Slett …</button>`}
      </section>
      <section class="md-sec">
        <h2>Eier</h2>
        ${ownerSec}
      </section>`;
  }

  function openMyData() {
    mdMsg = null; mdImport = null; mdConfirm = "";
    renderMyData();
    if (!mydata.open) mydata.showModal();
    $(".about-scroll", mydata).scrollTop = 0;
  }
  const mdChanged = () => { pruneStore(); changed(); renderMyData(); };
  const setOwner = (on) => { lsSet(OWNER_KEY, on ? "1" : null); location.hash = ""; location.reload(); };

  $("#mydata-open").addEventListener("click", openMyData);
  mydata.addEventListener("click", (e) => {
    if (e.target === mydata || e.target.closest("[data-close-mydata]")) return mydata.close();
    const c = e.target.closest("[data-copy]");
    if (c) return copyButton(c);
    const b = e.target.closest("[data-md]");
    if (!b || b.tagName === "INPUT") return;
    const a = b.dataset.md;
    if (a === "remove") { Store.remove(b.dataset.key); return mdChanged(); }
    if (a === "export") { exportData(); mdMsg = { kind: "ok", html: "Fila er lastet ned ✓" }; renderMyData(); }
    else if (a === "pick") $("#md-file").click();
    else if (a === "merge" || a === "replace") {
      try {
        const r = Store.importJSON(mdImport.obj, a, storeKey);
        const parts = [`${r.total} ${r.total === 1 ? "film" : "filmer"}`, `${r.added} nye`, `${r.updated} oppdatert`];
        if (r.unknown) parts.push(`${r.unknown} ukjente`);
        if (r.skipped) parts.push(`${r.skipped} hoppet over`);
        mdMsg = { kind: "ok", html: `Importert: ${parts.join(", ")}.` };
      } catch (err) { mdMsg = { kind: "err", html: esc(err.message) }; }
      mdImport = null;
      mdChanged();
    }
    else if (a === "cancel") { mdImport = null; mdConfirm = ""; renderMyData(); }
    else if (a === "delete") { mdConfirm = "delete"; renderMyData(); }
    else if (a === "delete-yes") { Store.clear(); mdConfirm = ""; mdMsg = { kind: "ok", html: "Alle dine data er slettet." }; mdChanged(); }
    else if (a === "owner-export") { exportData(); Store.flush().then(() => setOwner(!OWNER)); }
    else if (a === "owner-keep") setOwner(!OWNER);
    else if (a === "owner-delete") { Store.clear(); Store.flush().then(() => setOwner(!OWNER)); }
  });
  mydata.addEventListener("change", (e) => {
    if (e.target.dataset.md === "owner") {
      if (Store.stats().films) { e.target.checked = OWNER; mdConfirm = "owner"; return renderMyData(); }
      return setOwner(e.target.checked);
    }
    if (e.target.id === "md-name") Store.setMeta("name", e.target.value.trim());
    if (e.target.dataset.service != null) {
      const on = [...mydata.querySelectorAll("[data-service]")].filter((x) => x.checked).map((x) => x.dataset.service);
      Store.setMeta("services", on);
      return render();
    }
    if (e.target.id !== "md-file" || !e.target.files.length) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      let obj = null;
      try { obj = JSON.parse(reader.result); } catch (err) { obj = null; }
      if (!obj) mdMsg = { kind: "err", html: `«${esc(file.name)}» kunne ikke leses. Fila er ikke gyldig JSON – kanskje den er ødelagt eller ikke lastet ned helt.` };
      else if (obj.format !== "langtagning-user" || !Array.isArray(obj.films)) mdMsg = { kind: "err", html: `«${esc(file.name)}» er ikke en eksportfil fra Langtagning.` };
      else if ((obj.schema || 1) > 1) mdMsg = { kind: "err", html: `«${esc(file.name)}» er laget av en nyere versjon av Langtagning. Last siden på nytt og prøv igjen.` };
      else { mdMsg = null; mdImport = { obj, file: file.name }; }
      renderMyData();
    };
    reader.onerror = () => { mdMsg = { kind: "err", html: `Kunne ikke lese «${esc(file.name)}».` }; renderMyData(); };
    reader.readAsText(file);
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
  // Butikken (IndexedDB) leses asynkront – siden tegnes når endringene er lagt over grunnlaget
  Store.init(FRIEND_TEST ? "-venn" : "").then(() => {
    migrateOldQueue();
    pruneStore();  // det som nå står likt i movies.js (eier), eller som er tomt, ryddes bort
    applyChanges();
    state = readHash();
    if (ownerInHash) writeHash(false);
    render();
    renderQueueBar();
    if (state.film) openDetail(state.film, false);
  });
})();
