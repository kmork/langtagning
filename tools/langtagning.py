#!/usr/bin/env python3
"""Langtagning – hjelpeskript for databasen i data/movies.js.

Henter filmdata og plakater fra TMDB (themoviedb.org). Bruker kun Pythons standardbibliotek.

Eksempler:
  python3 tools/langtagning.py add "Stalker" --year 1979 --seen --owned --tag klassiker
  python3 tools/langtagning.py import mine-filmer.txt
  python3 tools/langtagning.py sync            # fyll inn data/plakater som mangler
  python3 tools/langtagning.py sync --all      # oppdater TMDB-data for alle filmer
  python3 tools/langtagning.py awards          # hent priser fra Wikidata for alle filmer
  python3 tools/langtagning.py lists           # bygg kåringene i tools/lister/ inn i data/lists.js
  python3 tools/langtagning.py queue           # behandle køen du har lagd på nettsiden
  python3 tools/langtagning.py cinemateket     # hent omtaler fra cinemateket.no
  python3 tools/langtagning.py kino            # hent kinoprogrammet (Cinemateket og Vega Scene)
  python3 tools/langtagning.py filmoteket      # finn filmer som kan lånes på filmoteket.no
  python3 tools/langtagning.py wikidata        # Roger Ebert- og Criterion-lenker + Criterion-lista (kjør lists etterpå)
  python3 tools/langtagning.py directors       # hent filmografier (regissører du har minst 2 filmer av)
  python3 tools/langtagning.py directors "Agnès Varda"   # … og/eller en bestemt regissør
  python3 tools/langtagning.py check           # sjekk at movies.js er gyldig

API-nøkkel leses fra miljøvariabelen TMDB_API_KEY eller fra filen tools/tmdb_key.txt.
Både «API Key» (v3) og «API Read Access Token» (v4) fungerer.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "movies.js")
POSTER_DIR = os.path.join(ROOT, "posters")
KEY_FILE = os.path.join(ROOT, "tools", "tmdb_key.txt")
API = "https://api.themoviedb.org/3"
IMG = "https://image.tmdb.org/t/p"
PREFIX = "window.LANGTAGNING = "

DEFAULT_HEADER = """// Langtagning – databasen.
// Alt etter "window.LANGTAGNING =" må være gyldig JSON:
// doble anførselstegn, ingen komma etter siste element, ingen kommentarer inne i listen.
// Se README.md for beskrivelse av feltene.
"""

# Rekkefølgen feltene skrives i
FIELDS = [
    "id", "tmdb_id", "imdb_id", "title", "original_title", "year", "directors", "countries",
    "runtime", "cast", "awards", "overview", "poster", "backdrop", "status", "tags",
    "description", "links", "added",
]
PERSONAL = {"id", "status", "tags", "description", "links", "added", "awards"}

STATUS_WORDS = {
    "sett": "seen", "seen": "seen",
    "vil-se": "want", "vilse": "want", "vil se": "want", "want": "want", "watchlist": "want",
    "samling": "owned", "i-samlingen": "owned", "eier": "owned", "owned": "owned",
    # gamle navn – betyr det samme som «samling»
    "dvd": "owned", "bluray": "owned", "blu-ray": "owned", "br": "owned", "blu ray": "owned",
}


class Fail(Exception):
    pass


# ---------------------------------------------------------------- database

def load_db():
    if not os.path.exists(DB_PATH):
        return DEFAULT_HEADER, []
    with open(DB_PATH, encoding="utf-8") as f:
        text = f.read()
    i = text.find(PREFIX)
    if i < 0 and "window.FILMOTEKET = " in text:  # gammelt navn
        text = text.replace("window.FILMOTEKET = ", PREFIX, 1)
        i = text.find(PREFIX)
    if i < 0:
        raise Fail(f'Fant ikke "{PREFIX.strip()}" i {DB_PATH}')
    header = text[:i]
    body = text[i + len(PREFIX):].strip()
    if body.endswith(";"):
        body = body[:-1]
    try:
        movies = json.loads(body)
    except json.JSONDecodeError as e:
        line = text[:i].count("\n") + body[:e.pos].count("\n") + 1
        raise Fail(f"Ugyldig JSON i data/movies.js, linje {line}: {e.msg}\n"
                   "Tips: sjekk komma (mangler/for mye) og at all tekst har doble anførselstegn.")
    if not isinstance(movies, list):
        raise Fail("data/movies.js må inneholde en liste ([ ... ])")
    for m in movies:
        st = m.get("status")
        if isinstance(st, dict) and ("dvd" in st or "bluray" in st):
            owned = bool(st.get("owned") or st.get("dvd") or st.get("bluray"))
            m["status"] = {"seen": bool(st.get("seen")), "want": bool(st.get("want")), "owned": owned}
    return header, movies


def save_db(header, movies):
    def entry(m):
        keys = [k for k in FIELDS if k in m] + [k for k in m if k not in FIELDS]
        lines = [f"    {json.dumps(k)}: {json.dumps(m[k], ensure_ascii=False)}" for k in keys]
        return "  {\n" + ",\n".join(lines) + "\n  }"

    out = header + PREFIX + "[\n" + ",\n".join(entry(m) for m in movies) + "\n];\n"
    tmp = DB_PATH + ".tmp"
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(out)
    os.replace(tmp, DB_PATH)


def slugify(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def unique_id(movies, title, year):
    base = slugify(f"{title}-{year or ''}") or "film"
    taken = {m.get("id") for m in movies}
    uid, n = base, 2
    while uid in taken:
        uid, n = f"{base}-{n}", n + 1
    return uid


def blank_movie():
    return {
        "status": {"seen": False, "want": False, "owned": False},
        "tags": [], "description": "", "links": {"bfi": "", "rt": ""},
        "added": dt.date.today().isoformat(),
    }


# ---------------------------------------------------------------- TMDB

def api_key():
    key = os.environ.get("TMDB_API_KEY", "").strip()
    if not key and os.path.exists(KEY_FILE):
        with open(KEY_FILE, encoding="utf-8") as f:
            key = f.read().strip()
    if not key:
        raise Fail(
            "Mangler TMDB API-nøkkel.\n"
            "  1. Lag gratis konto på https://www.themoviedb.org/signup\n"
            "  2. Gå til https://www.themoviedb.org/settings/api og be om en API-nøkkel (velg «Developer»/personlig bruk)\n"
            "  3. Lim nøkkelen inn i filen tools/tmdb_key.txt  (eller: export TMDB_API_KEY=...)")
    return key


def http_get(url, headers=None, binary=False):
    url = urllib.parse.quote(url, safe=":/?&=%#+,;@!$'()*~")  # adresser med æ/ø/å o.l.
    req = urllib.request.Request(url, headers={"User-Agent": "Langtagning/1.0", **(headers or {})})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
                if data[:2] == b"\x1f\x8b":  # noen servere sender gzip selv uten å bli spurt
                    import gzip
                    data = gzip.decompress(data)
                return data if binary else json.loads(data.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                wait = e.headers.get("Retry-After", "")
                wait = min(int(wait), 120) if wait.isdigit() else 5 * (attempt + 1)
                if wait > 5:
                    print(f"  … serveren ber oss vente {wait} sekunder")
                time.sleep(wait)
                continue
            if e.code >= 500 and attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            if e.code == 401:
                raise Fail("TMDB avviste API-nøkkelen (401). Sjekk tools/tmdb_key.txt.")
            if e.code == 404:
                return None
            raise Fail(f"HTTP-feil {e.code} for {url.split('?')[0]}")
        except urllib.error.URLError as e:
            if "CERTIFICATE_VERIFY_FAILED" in str(e.reason):
                raise Fail("SSL-sertifikatfeil. Har du Python fra python.org, kjør «Install Certificates.command» "
                           "i /Applications/Python 3.x/.")
            if attempt < 3:
                time.sleep(1.5)
                continue
            raise Fail(f"Nettverksfeil: {e.reason}")


def tmdb(path, **params):
    key = api_key()
    headers = {"Accept": "application/json"}
    if key.startswith("eyJ"):  # v4 read access token
        headers["Authorization"] = f"Bearer {key}"
    else:
        params["api_key"] = key
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    time.sleep(0.03)
    return http_get(url, headers)


def year_of(r):
    d = r.get("release_date") or ""
    return int(d[:4]) if d[:4].isdigit() else None


def search(title, year=None):
    params = {"query": title, "include_adult": "false", "language": "en-US"}
    if year:
        params["primary_release_year"] = year
    res = (tmdb("/search/movie", **params) or {}).get("results", [])
    if year and not res:  # utgivelsesår kan avvike med ett år
        params.pop("primary_release_year")
        res = [r for r in (tmdb("/search/movie", **params) or {}).get("results", [])
               if year_of(r) and abs(year_of(r) - year) <= 1]
    return res


def norm(s):
    return slugify(s).replace("-", "")


def pick(results, title, year, interactive):
    """Velg beste treff. Returnerer (resultat, usikker)."""
    if not results:
        return None, True
    exact = [r for r in results if norm(title) in (norm(r.get("title")), norm(r.get("original_title")))]
    candidates = exact or results
    best = candidates[0]
    unsure = not exact or (not year and len(exact) > 1)
    if interactive and (unsure or len(results) > 1):
        print(f'\nTreff for «{title}»{f" ({year})" if year else ""}:')
        shown = results[:8]
        for i, r in enumerate(shown, 1):
            orig = f" / {r['original_title']}" if r.get("original_title") not in (None, r.get("title")) else ""
            print(f"  {i}. {r.get('title')}{orig} ({year_of(r) or '?'})  –  tmdb:{r['id']}")
        default = shown.index(best) + 1 if best in shown else 1
        ans = input(f"Velg 1–{len(shown)}, 0 for å hoppe over [{default}]: ").strip()
        if ans == "0":
            return None, False
        idx = int(ans) - 1 if ans.isdigit() and 0 < int(ans) <= len(shown) else default - 1
        return shown[idx], False
    return best, unsure


def details(tmdb_id):
    d = tmdb(f"/movie/{tmdb_id}", language="en-US", append_to_response="credits,translations")
    if not d:
        raise Fail(f"Fant ikke film med tmdb-id {tmdb_id}")
    crew = (d.get("credits") or {}).get("crew", [])
    cast = (d.get("credits") or {}).get("cast", [])
    overview = d.get("overview") or ""
    for t in (d.get("translations") or {}).get("translations", []):
        if t.get("iso_639_1") in ("nb", "no", "nn") and (t.get("data") or {}).get("overview"):
            overview = t["data"]["overview"]
            break
    return {
        "tmdb_id": d["id"],
        "imdb_id": d.get("imdb_id") or None,
        "title": d.get("title") or d.get("original_title"),
        "original_title": d.get("original_title"),
        "year": year_of(d),
        "directors": [c["name"] for c in crew if c.get("job") == "Director"],
        "countries": [c["iso_3166_1"] for c in d.get("production_countries", [])],
        "runtime": d.get("runtime") or None,
        "cast": [c["name"] for c in sorted(cast, key=lambda c: c.get("order", 99))[:6]],
        "overview": overview,
        "_poster_path": d.get("poster_path"),
        "_backdrop_path": d.get("backdrop_path"),
    }


def download(path, size, filename, force=False):
    if not path:
        return None
    rel = f"posters/{filename}"
    dest = os.path.join(ROOT, rel)
    if force or not os.path.exists(dest):
        data = http_get(f"{IMG}/{size}{path}", binary=True)
        if not data:
            return None
        os.makedirs(POSTER_DIR, exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
    return rel


def apply_details(movie, d, force_images=False):
    for k, v in d.items():
        if not k.startswith("_") and k not in PERSONAL:
            movie[k] = v
    tid = d["tmdb_id"]
    movie["poster"] = download(d["_poster_path"], "w500", f"{tid}.jpg", force_images) or movie.get("poster")
    movie["backdrop"] = download(d["_backdrop_path"], "w1280", f"{tid}-bg.jpg", force_images) or movie.get("backdrop")


def find_by_imdb(imdb_id):
    r = tmdb(f"/find/{imdb_id}", external_source="imdb_id") or {}
    res = r.get("movie_results") or []
    return res[0]["id"] if res else None


# ---------------------------------------------------------------- priser (Wikidata)

WIKIDATA = "https://query.wikidata.org/sparql"

# Festivaler: alle konkurransepriser tas med. (navn, mønster i prisnavnet på engelsk)
FESTIVALS = [
    ("Cannes", r"cannes|palme d'or|cam[ée]ra d'or|un certain regard"),
    ("Berlin", r"berlin|golden bear|silver bear|berliner b[äa]r|alfred bauer"),
    ("Venezia", r"venice|golden lion|silver lion|volpi cup|marcello mastroianni|orizzonti|lion of the future"),
    ("Locarno", r"locarno|leopard"),
    ("San Sebastián", r"san sebasti|golden shell|silver shell"),
    ("Karlovy Vary", r"karlovy|crystal globe"),
    ("Sundance", r"sundance"),
    ("Toronto", r"toronto international film festival|people's choice award"),
]
# Ikke ta med æres-/livsverkpriser, kortfilm o.l.
EXCLUDE = re.compile(r"honorary|honour|lifetime|order of|doctor|short film|golden globe|teddy|glass bear|"
                     r"blaue engel|fondazione|film festival awards$|^berlin film festival awards$", re.I)
# Oversettelse av selve prisen (første treff vinner)
PRIZES = [
    (r"palme d'or", "Gullpalmen"),
    (r"golden bear|berliner b[äa]r", "Gullbjørnen"),
    (r"golden lion", "Gulløven"),
    (r"golden leopard", "Gulleoparden"),
    (r"golden shell", "Gullskjellet"),
    (r"crystal globe", "Krystallgloben"),
    (r"cam[ée]ra d'or", "Caméra d'Or (beste debut)"),
    (r"un certain regard", "Un Certain Regard"),
    (r"orizzonti", "Orizzonti"),
    (r"lion of the future|first or second|first feature|first film", "Beste debutfilm"),
    (r"marcello mastroianni", "Marcello Mastroianni-prisen"),
    (r"fipresci", "FIPRESCI-prisen"),
    (r"ecumenical|ocic", "Den økumeniske juryens pris"),
    (r"special jury", "Juryens spesialpris"),
    (r"grand jury|grand prix", "Juryens store pris"),
    (r"jury prize", "Juryens pris"),
    (r"alfred bauer", "Alfred Bauer-prisen"),
    (r"best direct|leopard for best direction|^silver lion$", "Beste regi"),
    (r"actress", "Beste kvinnelige skuespiller"),
    (r"actor", "Beste mannlige skuespiller"),
    (r"leading performance", "Beste hovedrolle"),
    (r"supporting performance", "Beste birolle"),
    (r"screenplay", "Beste manus"),
    (r"artistic contribution|single achievement", "Fremragende kunstnerisk bidrag"),
    (r"audience|people's choice", "Publikumsprisen"),
    (r"best film", "Beste film"),
    (r"silver bear", "Sølvbjørnen"),
    (r"silver lion", "Sølvløven"),
    (r"silver shell", "Sølvskjellet"),
]
# Andre store priser – bare utvalgte kategorier
OTHER = [
    (r"academy award for best picture", "Oscar – Beste film"),
    (r"academy award for best director", "Oscar – Beste regi"),
    (r"academy award for best (international feature|foreign language) film", "Oscar – Beste internasjonale film"),
    (r"academy award for best animated feature", "Oscar – Beste animasjonsfilm"),
    (r"academy award for best documentary feature", "Oscar – Beste dokumentar"),
    (r"bafta award for best film", "BAFTA – Beste film"),
    (r"bafta award for best film not in the english language", "BAFTA – Beste ikke-engelskspråklige film"),
    (r"european film award for best film", "European Film Awards – Beste film"),
    (r"c[ée]sar award for best film", "César – Beste film"),
    (r"guldbagge award for best film", "Guldbagge – Beste film"),
    (r"amanda award for best (norwegian )?(feature )?film", "Amanda – Beste film"),
]


def award_name(label):
    """Oversetter et engelsk Wikidata-prisnavn til f.eks. «Cannes – Gullpalmen», eller None."""
    label = (label or "").strip()
    if not label or EXCLUDE.search(label):
        return None
    for pattern, name in OTHER:
        if re.fullmatch(pattern, label, re.I):
            return name
    for festival, pattern in FESTIVALS:
        if re.search(pattern, label, re.I):
            for p, prize in PRIZES:
                if re.search(p, label, re.I):
                    return f"{festival} – {prize}"
            return f"{festival} – {label}"
    return None


def wikidata_awards(imdb_ids):
    """Returnerer {imdb_id: [prisnavn, ...]} for en liste IMDb-id-er."""
    values = " ".join(json.dumps(i) for i in imdb_ids)
    query = ("SELECT ?imdb ?awardLabel WHERE { VALUES ?imdb { %s } ?film wdt:P345 ?imdb . "
             "?film wdt:P166 ?award . SERVICE wikibase:label { bd:serviceParam wikibase:language \"en\". } }" % values)
    url = f"{WIKIDATA}?{urllib.parse.urlencode({'query': query, 'format': 'json'})}"
    data = http_get(url, {"Accept": "application/sparql-results+json",
                          "User-Agent": "Langtagning/1.0 (personlig filmdatabase)"}) or {}
    out = {}
    for row in data.get("results", {}).get("bindings", []):
        name = award_name(row["awardLabel"]["value"])
        if name:
            lst = out.setdefault(row["imdb"]["value"], [])
            if name not in lst:
                lst.append(name)
    return out


def award_sort_key(a):
    order = [f for f, _ in FESTIVALS[:3]] + ["Oscar"]
    group = a.split(" – ")[0]
    return (order.index(group) if group in order else len(order), a)


def fetch_awards(movies, quiet=False):
    """Henter priser og legger dem til (priser du har skrevet inn selv blir stående)."""
    todo = [m for m in movies if m.get("imdb_id")]
    found = 0
    for i in range(0, len(todo), 100):
        batch = todo[i:i + 100]
        try:
            res = wikidata_awards([m["imdb_id"] for m in batch])
        except Fail as e:
            print(f"✗ Klarte ikke hente priser fra Wikidata ({e}). Prøv igjen senere med: python3 tools/langtagning.py awards")
            return
        for m in batch:
            awards = list(m.get("awards") or [])
            new = [a for a in res.get(m["imdb_id"], []) if a not in awards]
            m["awards"] = sorted(awards + new, key=award_sort_key)
            if new:
                found += 1
                if not quiet:
                    print(f"🏆 {label(m)}: {', '.join(new)}")
        time.sleep(0.5)
    print(f"Priser: {found} filmer fikk nye priser.")


# ---------------------------------------------------------------- kommandoer

def label(m):
    return f"{m.get('title')} ({m.get('year') or '?'})"


def merge_personal(m, status=None, tags=None, description=None):
    for k, v in (status or {}).items():
        if v:
            m["status"][k] = True
    for t in tags or []:
        if t not in m["tags"]:
            m["tags"].append(t)
    if description and not m.get("description"):
        m["description"] = description


def add_one(movies, title, year=None, status=None, tags=None, description=None,
            interactive=True, tmdb_id=None):
    """Legger til (eller oppdaterer) én film. Returnerer (film, melding)."""
    unsure = False
    if not tmdb_id:
        hit, unsure = pick(search(title, year), title, year, interactive)
        if not hit:
            return None, f"✗ Fant ikke «{title}»" + (f" ({year})" if year else "")
        tmdb_id = hit["id"]

    existing = next((m for m in movies if m.get("tmdb_id") == tmdb_id), None)
    if existing:
        merge_personal(existing, status, tags, description)
        return existing, f"• Finnes fra før: {label(existing)} – status/tagger oppdatert"

    d = details(tmdb_id)
    # Finnes den fra før uten tmdb-id (lagt inn for hånd)?
    existing = next((m for m in movies if not m.get("tmdb_id") and (
        (d["imdb_id"] and m.get("imdb_id") == d["imdb_id"]) or
        (norm(m.get("title")) == norm(d["title"]) and m.get("year") == d["year"]))), None)
    m = existing or blank_movie()
    for k, v in blank_movie().items():
        m.setdefault(k, v)
    apply_details(m, d)
    merge_personal(m, status, tags, description)
    if not existing:
        m["id"] = unique_id(movies, d["title"], d["year"])
        movies.append(m)
    flag = "  ⚠ usikkert treff – sjekk" if unsure else ""
    return m, f"✓ {label(m)} – {', '.join(m.get('directors') or []) or 'ukjent regissør'}{flag}"


def parse_status(words):
    st = {}
    for w in words:
        k = STATUS_WORDS.get(w.strip().lower())
        if not k:
            raise Fail(f"Ukjent status «{w}». Bruk: sett, vil-se, samling")
        st[k] = True
    return st


def status_from_args(a):
    return {k: True for k in ("seen", "want", "owned") if getattr(a, k)}


def cmd_add(a):
    header, movies = load_db()
    m, msg = add_one(movies, a.title, a.year, status_from_args(a), a.tag, a.note,
                     interactive=not a.first, tmdb_id=a.tmdb)
    print(msg)
    if m:
        fetch_awards([m])
    save_db(header, movies)


LINE_RE = re.compile(r"^(.*?)\s*(?:\((\d{4})\))?\s*$")


def cmd_import(a):
    header, movies = load_db()
    with open(a.file, encoding="utf-8") as f:
        lines = [l.rstrip("\n") for l in f]
    default_status = status_from_args(a)
    ok = failed = 0
    unsure_list = []
    processed = []
    for n, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        # Støtt også «Tittel - sett, samling» når det ikke er brukt |
        dash = re.match(r"^(.*\S)\s+-\s+([\w ,-]+)$", parts[0])
        if dash and len(parts) == 1 and all(
                w in STATUS_WORDS for w in re.split(r"[,\s]+", dash.group(2).lower().replace("vil se", "vil-se")) if w):
            parts = [dash.group(1), dash.group(2)]
        mt = LINE_RE.match(parts[0])
        title, year = mt.group(1).strip(), int(mt.group(2)) if mt.group(2) else None
        try:
            status = dict(default_status)
            if len(parts) > 1 and parts[1]:
                status.update(parse_status(re.split(r"[,\s]+", parts[1].lower().replace("vil se", "vil-se"))))
            tags = [t.strip() for t in parts[2].split(",") if t.strip()] if len(parts) > 2 else []
            tags += a.tag or []
            note = parts[3] if len(parts) > 3 else None
            m, msg = add_one(movies, title, year, status, tags, note, interactive=a.interactive)
        except Fail as e:
            m, msg = None, f"✗ Linje {n}: {e}"
        print(msg)
        if m:
            ok += 1
            processed.append(m)
            if "usikkert" in msg:
                unsure_list.append(label(m))
        else:
            failed += 1
        if ok and ok % 10 == 0:
            save_db(header, movies)
    fetch_awards(processed, quiet=True)
    save_db(header, movies)
    print(f"\nFerdig: {ok} lagt til/oppdatert, {failed} ikke funnet.")
    if unsure_list:
        print("Sjekk disse (flere mulige treff – legg til årstall i lista eller kjør med --interactive):")
        for u in unsure_list:
            print("  -", u)


def cmd_sync(a):
    header, movies = load_db()
    changed = 0
    processed = []
    for m in movies:
        for k, v in blank_movie().items():
            if k not in m:
                m[k] = v
        if not m.get("id"):
            m["id"] = unique_id(movies, m.get("title"), m.get("year"))
        tid = m.get("tmdb_id")
        missing_img = not m.get("poster") or not os.path.exists(os.path.join(ROOT, m["poster"]))
        if tid and not a.all and not missing_img:
            continue
        try:
            if not tid:
                tid = find_by_imdb(m["imdb_id"]) if m.get("imdb_id") else None
                if not tid:
                    hit, unsure = pick(search(m.get("title", ""), m.get("year")), m.get("title", ""),
                                       m.get("year"), a.interactive)
                    if not hit:
                        print(f"✗ Fant ikke {label(m)}")
                        continue
                    tid = hit["id"]
                    if unsure:
                        print(f"  ⚠ usikkert treff for {label(m)} – sjekk")
            apply_details(m, details(tid), force_images=a.images)
            changed += 1
            processed.append(m)
            print(f"✓ {label(m)}")
        except Fail as e:
            print(f"✗ {label(m)}: {e}")
        if changed and changed % 10 == 0:
            save_db(header, movies)
    fetch_awards(movies if a.all else [m for m in movies if m in processed or "awards" not in m], quiet=True)
    save_db(header, movies)
    print(f"\nFerdig: {changed} filmer oppdatert.")


def cmd_awards(a):
    header, movies = load_db()
    fetch_awards(movies)
    save_db(header, movies)


# ---------------------------------------------------------------- kø fra nettsiden (tools/ko.txt)

QUEUE_FILE = os.path.join(ROOT, "todo", "ko.txt")
QUEUE_OLD = [os.path.join(ROOT, "tools", "ko.txt"), os.path.join(ROOT, "ko.txt")]  # tidligere plasseringer
QUEUE_DOWNLOADS = os.path.join(os.path.expanduser("~"), "Downloads")
OWNED_LIST = os.path.join(ROOT, "tools", "eide-filmer.txt")
QUEUE_HEADER = ("# Langtagning – kø fra nettsiden. Behandles med: python3 tools/langtagning.py queue\n"
                "# Format: Tittel (år) | status | tmdb:ID [| tagger: a, b] [| tanker: \"tekst\"]   "
                "(status: sett, vil-se, samling – eller «ingen»)\n")
QUEUE_DONE = os.path.join(ROOT, "todo", "behandlet")  # behandlede JSON-eksporter flyttes hit


def queue_files():
    """todo/ko.txt, nedlastede langtagning-ko*.txt og JSON-eksporter (langtagning-*.json), eldste først."""
    files = [p for p in [QUEUE_FILE] + QUEUE_OLD if os.path.exists(p)]
    if os.path.isdir(QUEUE_DOWNLOADS):
        files += [os.path.join(QUEUE_DOWNLOADS, f) for f in os.listdir(QUEUE_DOWNLOADS)
                  if f.startswith("langtagning-") and (
                      (f.startswith("langtagning-ko") and f.endswith(".txt")) or f.endswith(".json"))]
    return sorted(files, key=os.path.getmtime)


def iso_mtime(path):
    return dt.datetime.fromtimestamp(os.path.getmtime(path), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def parse_queue(path):
    """Linjene i en kø-fil. Status gjelder alltid; tagger og tanker bare når de står på linjen."""
    items = []
    updated = iso_mtime(path)  # linjene har ikke egen tid – fila sin endringstid brukes
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            note = None
            m = re.search(r"\|\s*tanker:\s*", line)
            if m:  # tankene står sist, og kan inneholde «|»
                rest = line[m.end():].strip()
                try:
                    note = json.loads(rest)
                except ValueError:
                    note = rest
                line = line[:m.start()]
            parts = [p.strip() for p in line.split("|")]
            tid = next((int(p[5:]) for p in parts if re.fullmatch(r"tmdb:\d+", p)), None)
            fid = next((p[3:].strip() for p in parts if p.startswith("id:")), None)
            tags = next(([t.strip() for t in p[7:].split(",") if t.strip()] for p in parts if p.startswith("tagger:")), None)
            parts = [p for p in parts if not (re.fullmatch(r"tmdb:\d+", p) or p.startswith(("id:", "tagger:")))]
            mt = LINE_RE.match(parts[0])
            words = re.split(r"[,\s]+", (parts[1] if len(parts) > 1 else "").lower().replace("vil se", "vil-se"))
            words = [w for w in words if w and w != "ingen"]
            status = {"seen": False, "want": False, "owned": False}
            status.update(parse_status(words))
            it = {"title": mt.group(1).strip(), "year": int(mt.group(2)) if mt.group(2) else None,
                  "tmdb": tid, "id": fid, "status": status, "updated": updated}
            if tags is not None:
                it["tags"] = tags
            if note is not None:
                it["note"] = note
            items.append(it)
    return items


def parse_export(path):
    """JSON-eksport fra «Mine data». Bare eierens filer (owner: true) brukes – en venns fil hoppes over."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (ValueError, OSError) as e:
        print(f"✗ {os.path.basename(path)}: kunne ikke lese fila ({e})")
        return None
    if not isinstance(data, dict) or data.get("format") != "langtagning-user":
        return None  # en annen fil som tilfeldigvis heter langtagning-*.json
    if not data.get("owner"):
        print(f"• {os.path.basename(path)}: eksport uten eierflagg (fra en venn?) – hoppes over")
        return None
    items = []
    for r in data.get("films") or []:
        rid = str(r.get("id") or "")
        it = {"title": r.get("title") or rid, "year": r.get("year"),
              "tmdb": r.get("tmdb_id") or (int(rid[5:]) if re.fullmatch(r"tmdb:\d+", rid) else None),
              "id": None if rid.startswith("tmdb:") else rid or None,
              "updated": r.get("updated") or data.get("exported") or iso_mtime(path)}
        if isinstance(r.get("status"), dict):
            it["status"] = {k: bool(r["status"].get(k)) for k in ("seen", "want", "owned")}
        if isinstance(r.get("note"), str):
            it["note"] = r["note"]
        if isinstance(r.get("tags"), list):
            it["tags"] = [str(t) for t in r["tags"] if t]
        items.append(it)
    return items


def status_words(st):
    w = [x for k, x in (("seen", "sett"), ("want", "vil-se"), ("owned", "samling")) if st.get(k)]
    return ", ".join(w) or "ingen"


def sync_owned_list(changed):
    """Hold tools/eide-filmer.txt i takt: oppdater status på linjer som finnes, legg til nye filmer du eier."""
    if not changed or not os.path.exists(OWNED_LIST):
        return
    with open(OWNED_LIST, encoding="utf-8") as f:
        lines = f.read().split("\n")
    for m in changed:
        found = False
        for i, line in enumerate(lines):
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            mt = LINE_RE.match(line.split("|")[0].strip())
            t, y = mt.group(1).strip(), int(mt.group(2)) if mt.group(2) else None
            if norm(t) in (norm(m["title"]), norm(m.get("original_title"))) and (not y or not m.get("year") or abs(y - m["year"]) <= 1):
                rest = line.split("|")[2:]
                lines[i] = " | ".join([line.split("|")[0].strip(), status_words(m["status"])] + [r.strip() for r in rest])
                found = True
                break
        if not found and m["status"].get("owned"):
            while lines and not lines[-1].strip():
                lines.pop()
            lines.append(f"{m['title']} ({m.get('year') or '?'}) | {status_words(m['status'])}")
    with open(OWNED_LIST, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).rstrip("\n") + "\n")


def cmd_queue(a):
    files, raw = [], []
    for path in queue_files():
        its = parse_export(path) if path.endswith(".json") else parse_queue(path)
        if its is not None:
            files.append(path)
            raw += its
    # Slå sammen per film: nyeste vinner, felt for felt (en JSON-post har bare feltene som er endret)
    items = {}
    for it in sorted(raw, key=lambda x: x.get("updated") or ""):
        k = it["tmdb"] or (("id", it["id"]) if it.get("id") else (norm(it["title"]), it["year"]))
        items.setdefault(k, {}).update(it)
    if not items:
        print("Køen er tom. (Ser i todo/ko.txt, ~/Downloads/langtagning-ko*.txt og ~/Downloads/langtagning-*.json)")
        return
    header, movies = load_db()
    changed, added = [], []
    for it in items.values():
        existing = next((m for m in movies if (it["tmdb"] and m.get("tmdb_id") == it["tmdb"]) or
                         (it.get("id") and m.get("id") == it["id"])), None)
        if existing:
            what = []
            if "status" in it:
                old = {k: bool((existing.get("status") or {}).get(k)) for k in ("seen", "want", "owned")}
                if old != it["status"]:
                    existing["status"] = dict(it["status"])
                    what.append(f"status: {status_words(it['status'])}")
            if "tags" in it and (existing.get("tags") or []) != it["tags"]:
                existing["tags"] = list(it["tags"])
                what.append("tagger: " + (", ".join(it["tags"]) or "ingen"))
            if "note" in it and (existing.get("description") or "") != it["note"]:
                existing["description"] = it["note"]
                what.append("tanker")
            if not what:
                print(f"• {label(existing)} – uendret")
                continue
            changed.append(existing)
            print(f"✓ {label(existing)} – {'; '.join(what)}")
            continue
        st = it.get("status") or {}
        if not (any(st.values()) or it.get("note") or it.get("tags")):
            continue  # ingenting å legge inn, og ikke i databasen: ingenting å gjøre
        try:
            m, msg = add_one(movies, it["title"], it["year"], st, interactive=False, tmdb_id=it["tmdb"])
        except Fail as e:
            print(f"✗ {it['title']}: {e}")
            continue
        if m:
            m["status"] = {k: bool(st.get(k)) for k in ("seen", "want", "owned")}
            if "tags" in it:
                m["tags"] = list(it["tags"])
            if "note" in it:
                m["description"] = it["note"]
            changed.append(m)
            added.append(m)
        print(msg.replace("✓", "✓ Lagt til:"))
    if added:
        fetch_awards(added, quiet=True)
    save_db(header, movies)
    sync_owned_list(changed)
    # Tøm køen
    os.makedirs(os.path.dirname(QUEUE_FILE), exist_ok=True)
    with open(QUEUE_FILE, "w", encoding="utf-8") as f:
        f.write(QUEUE_HEADER)
    for path in files:
        if path == QUEUE_FILE:
            continue
        if path.endswith(".json"):  # eksporter flyttes, så de ikke leses to ganger
            os.makedirs(QUEUE_DONE, exist_ok=True)
            os.replace(path, os.path.join(QUEUE_DONE, os.path.basename(path)))
        else:
            os.remove(path)
    print(f"\nFerdig: {len(added)} nye, {len(changed) - len(added)} endret. Køen er tømt"
          + (f", og {sum(p.endswith('.json') for p in files)} eksportfil(er) er flyttet til todo/behandlet/." if any(p.endswith(".json") for p in files) else "."))
    if added and os.path.exists(LISTS_PATH):
        import contextlib, io
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_lists(argparse.Namespace(refresh=False, local_images=False))
        print("Kåringene er oppdatert.")
    print("Last siden på nytt (Cmd+Shift+R).")


# ---------------------------------------------------------------- Cinemateket (omtaler fra cinemateket.no)

CINE_BASE = "https://www.cinemateket.no"
CINE_CACHE = os.path.join(ROOT, "tools", "cinemateket-cache.json")
CINE_TEXTS = os.path.join(ROOT, "data", "cinemateket.js")          # tekster – bare for lokal bruk
CINE_LINKS = os.path.join(ROOT, "data", "cinemateket-lenker.js")   # bare lenker – kan publiseres
CINE_UA = {"User-Agent": "Langtagning/1.0 (personlig filmliste; henter omtaler én gang)"}
ARTICLES = r"^(the|a|an|la|le|les|l'|il|der|die|das|el)\s+"


def _text(fragment):
    import html as _html
    t = re.sub(r"<br\s*/?>", "\n", fragment)
    t = _html.unescape(re.sub(r"<[^>]+>", "", t)).replace("\xa0", " ")
    return re.sub(r"[ \t]+", " ", re.sub(r"\s*\n\s*", "\n", t)).strip()


def parse_cine_page(page):
    """Trekk ut tittel, ingress, omtale, sitat og teknisk tabell fra en filmside."""
    h1 = re.search(r'<h1 class="page-film__heading[^"]*">(.*?)</h1>', page, re.S)
    if not h1:
        return None
    intro = re.search(r'<div class="page-film__intro-text">(.*?)</div>', page, re.S)
    blocks = page[page.find('class="page-film__blocks'):page.find('class="page-film__data')]
    wys = "".join(re.findall(r'<div class="wysiwyg">(.*?)</div>', blocks, re.S))
    paras = [_text(p) for p in re.findall(r"<p[^>]*>(.*?)</p>", wys, re.S)]
    quotes = []
    for q in re.findall(r"<blockquote>(.*?)</blockquote>", blocks, re.S):
        cite = re.search(r"<cite>(.*?)</cite>", q, re.S)
        quotes.append({"text": _text(re.sub(r"<cite>.*?</cite>", "", q, flags=re.S)), "cite": _text(cite.group(1)) if cite else ""})
    data = {}
    for k, v in re.findall(r'<td class="data-table__key">(.*?)</td>\s*<td class="data-table__value">(.*?)</td>', page, re.S):
        data[_text(k)] = _text(v)
    orig, nor = data.get("Originaltittel", ""), ""
    if "Norsk tittel:" in orig:
        orig, nor = [x.strip(" /,") for x in orig.split("Norsk tittel:", 1)]
    y = re.findall(r"\b(1[89]\d\d|20\d\d)\b", data.get("Produsert", ""))
    return {
        "title": _text(h1.group(1)), "original_title": orig, "norwegian_title": nor,
        "year": int(y[-1]) if y else None,
        "directors": [d.strip() for d in re.split(r",| og ", data.get("Regi", "")) if d.strip()],
        "ingress": _text(intro.group(1)) if intro else "", "text": [p for p in paras if p],
        "quotes": [q for q in quotes if q["text"]],
    }


def cine_urls():
    index = http_get(f"{CINE_BASE}/sitemap.xml", CINE_UA, binary=True).decode("utf-8")
    urls = []
    for sm in re.findall(r"<loc>([^<]*sitemap-films-[^<]*)</loc>", index):
        urls += re.findall(r"<loc>([^<]+/filmer/[^<]+)</loc>", http_get(sm, CINE_UA, binary=True).decode("utf-8"))
        time.sleep(0.3)
    return sorted(set(urls))


def write_js(path, var, obj, comment):
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        f.write(f"// {comment}\nwindow.{var} = {json.dumps(obj, ensure_ascii=False, indent=0, sort_keys=True)};\n")
    os.replace(path + ".tmp", path)


def title_keys(t):
    t = t or ""
    variants = {t, re.sub(ARTICLES, "", t, flags=re.I)}
    main = re.split(r"\s*[:–—]\s+|\s+-\s+", t)[0]  # uten undertittel: «Symbiopsychotaxiplasm: Take One»
    if len(main) >= 4:
        variants |= {main, re.sub(ARTICLES, "", main, flags=re.I)}
    return {k for k in (norm(v) for v in variants) if k}


def titles_alike(a, b):
    """Tydelig like titler: den ene er begynnelsen av den andre, eller svært lik."""
    fold = lambda t: unicodedata.normalize("NFKD", re.sub(r"[–—]", "-", t or "")).encode("ascii", "ignore").decode().lower().strip()
    fa, fb = fold(a), fold(b)
    if not fa or not fb:
        return False
    # oppfølgere er andre filmer: «Scream» ≠ «Scream 2», «Rocky» ≠ «Rocky II»
    seq = lambda t: re.search(r"\s(\d{1,2}|i{1,3}|iv|v|vi{0,3})$", t)
    if bool(seq(fa)) != bool(seq(fb)):
        return False
    short, long_ = sorted((fa, fb), key=len)
    # «Tittel: undertittel», «Tittel (70mm)», «Tittel – Director's Cut», «Tittel + kortfilm»
    if len(norm(short)) >= 6 and re.match(re.escape(short) + r"\s*[:(+-]", long_):
        return True
    return title_score(a, {"title": b}) >= 0.85


def all_known_films(movies):
    """Filmene i databasen + katalogfilmene fra kåringene og regissørenes filmografier."""
    films = [m for m in movies if m.get("tmdb_id")]
    films += [c for c in load_lists().get("catalog", {}).values() if c.get("tmdb_id")]
    if os.path.exists(DIR_JS):
        with open(DIR_JS, encoding="utf-8") as f:
            text = f.read()
        films += [c for c in json.loads(text[text.index("=") + 1:].strip().rstrip(";")).get("films", {}).values() if c.get("tmdb_id")]
    return films


def cmd_cinemateket(a):
    cache = {}
    if os.path.exists(CINE_CACHE):
        with open(CINE_CACHE, encoding="utf-8") as f:
            cache = json.load(f)
    urls = cine_urls()
    todo = [u for u in urls if a.refresh or u not in cache]
    print(f"Cinemateket: {len(urls)} filmsider, {len(todo)} å hente (ca. {len(todo) * a.delay / 60 + 1:.0f} min) …")
    for n, u in enumerate(todo, 1):
        try:
            page = http_get(u, CINE_UA, binary=True)
            cache[u] = parse_cine_page(page.decode("utf-8", errors="replace")) if page else None
        except Exception as e:  # én rar side skal ikke stoppe hele hentingen
            print(f"  ✗ {u}: {type(e).__name__}: {e}")
        time.sleep(a.delay)
        if n % 100 == 0 or n == len(todo):
            print(f"  … {n}/{len(todo)}")
            with open(CINE_CACHE, "w", encoding="utf-8") as f:
                json.dump(cache, f, ensure_ascii=False)

    # Indeks: normalisert tittel (sidetittel, originaltittel, norsk tittel) → sider, og år → sider
    index, by_year = {}, {}
    for u, p in cache.items():
        if p and p.get("year"):
            by_year.setdefault(p["year"], {})[u] = p
            for t in (p["title"], p["original_title"], p["norwegian_title"]):
                for k in title_keys(t):
                    index.setdefault(k, {})[u] = p

    _, movies = load_db()
    in_db = {m["tmdb_id"] for m in movies if m.get("tmdb_id")}
    films = all_known_films(movies)
    texts, links, mine = {}, {}, 0
    for m in films:
        key = str(m["tmdb_id"])
        if key in links:
            continue
        cands = {}
        for t in (m.get("title"), m.get("original_title")):
            for k in title_keys(t):
                cands.update(index.get(k, {}))
        if not cands and m.get("year") and m.get("directors"):
            # ingen tittel-treff: samme regissør og år, og tydelig lik tittel
            for y in (m["year"] - 1, m["year"], m["year"] + 1):
                for u, p in by_year.get(y, {}).items():
                    if p["directors"] and director_ok(" / ".join(p["directors"]), m) and any(
                            titles_alike(a, b) for a in (m.get("title"), m.get("original_title"))
                            for b in (p["title"], p["original_title"], p["norwegian_title"])):
                        cands[u] = p
        best = None
        for u, p in cands.items():
            dy = abs(p["year"] - (m.get("year") or 0))
            if dy > 1:
                continue
            # regissøren må stemme; uten regissør på siden kreves eksakt år
            if not (director_ok(" / ".join(p["directors"]), m) if p["directors"] else dy == 0):
                continue
            score = (dy == 0, bool(p["text"]), bool(p["ingress"]))
            if not best or score > best[0]:
                best = (score, u, p)
        if best and (best[2]["ingress"] or best[2]["text"]):
            _, u, p = best
            links[key] = u
            texts[key] = {"url": u, "title": p["title"], "ingress": p["ingress"], "text": p["text"], "quotes": p["quotes"]}
            mine += m["tmdb_id"] in in_db
    write_js(CINE_TEXTS, "LANGTAGNING_CINEMATEKET", texts,
             "Omtaler fra cinemateket.no (© Cinemateket/Norsk filminstitutt). Bare for lokal bruk – ikke publiser denne fila.")
    write_js(CINE_LINKS, "LANGTAGNING_CINEMATEKET_LINKS", links, "Lenker til filmsider på cinemateket.no (tmdb-id → adresse).")
    print(f"\nFerdig: {len(links)} filmer koblet til Cinemateket – {mine} i databasen din, {len(links) - mine} andre (kåringer/filmografier).")


# ---------------------------------------------------------------- Cinemateket-programmet (kommende visninger)

CINE_PROGRAM = os.path.join(ROOT, "data", "cinemateket-program.js")  # bare tidspunkter og lenker – kan publiseres
CINE_TMDB = os.path.join(ROOT, "tools", "cinemateket-tmdb.json")     # filmside → tmdb-id (null = ikke funnet)


def parse_cine_shows(page):
    """Visningene på én side av /forestillinger: film, tidspunkt, sal, serie og billettlenke."""
    shows = []
    for url, body in re.findall(r'<a href="(https://www\.cinemateket\.no/filmer/[^"]+)" class="shows-(?:list|grid)__link">(.*?)</a>', page, re.S):
        t = re.search(r'datetime="(\d{4}-\d\d-\d\dT\d\d:\d\d):\d\d([+-]\d\d)(\d\d)"', body)
        if not t:
            continue
        get = lambda cls: (lambda x: _text(x.group(1)) if x else "")(re.search(rf'info-{cls}">(.*?)</', body, re.S))
        ticket = re.search(r'data-ticket-url="([^"]+)"', body)
        shows.append({"url": url, "t": f"{t.group(1)}{t.group(2)}:{t.group(3)}", "screen": get("screen"),
                      "series": get("concept"), "ticket": _text(ticket.group(1)) if ticket else ""})
    return shows


def cine_program(delay):
    """Hent alle sidene i programmet. Etter siste side gir nettstedet bare siste side på nytt."""
    shows, seen = [], set()
    for n in range(1, 40):
        page = http_get(f"{CINE_BASE}/forestillinger" + (f"/side-{n}" if n > 1 else ""), CINE_UA, binary=True)
        new = [s for s in parse_cine_shows((page or b"").decode("utf-8", errors="replace")) if (s["url"], s["t"]) not in seen]
        if not new:
            break
        seen |= {(s["url"], s["t"]) for s in new}
        shows += new
        time.sleep(delay)
    return shows


def cine_tmdb_lookup(p):
    """Finn TMDB-id for en filmside som ikke er koblet fra før. Regissøren må stemme."""
    if not p or not p.get("year"):
        return None
    for t in dict.fromkeys(x for x in (p["original_title"], p["title"], p["norwegian_title"]) if x):
        tid, unsure = resolve_row({"title": t, "year": p["year"], "director": " / ".join(p["directors"]), "tmdb": None})
        if tid and not unsure:
            return tid
    return None


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_program(name, path, var, source, shows, by_url, titles, movies):
    """Felles for kinoene: skriv programfila (tmdb-id → visninger) og vis hva som går av «Vil se»-filmene.
    shows: [{url, t, screen, series, ticket}], by_url: filmside → tmdb-id, titles: filmside → tittel."""
    known = {m["tmdb_id"] for m in all_known_films(movies)}
    films, catalog = {}, {}
    for s in sorted(shows, key=lambda s: s["t"]):
        tid = by_url.get(s["url"])
        if not tid:
            continue
        f = films.setdefault(str(tid), {"url": s["url"], "shows": []})
        f["shows"].append({k: s[k] for k in ("t", "screen", "series", "ticket") if s.get(k)})
        if tid not in known and str(tid) not in catalog:  # ikke i databasen, kåringene eller filmografiene
            d = details_cached(tid)
            c = {k: d.get(k) for k in CATALOG_FIELDS if k in d}
            c["poster"] = f"{IMG}/w342{d['_poster_path']}" if d.get("_poster_path") else None
            c["backdrop"] = f"{IMG}/w780{d['_backdrop_path']}" if d.get("_backdrop_path") else None
            catalog[str(tid)] = c
    write_js(path, var, {"updated": time.strftime("%Y-%m-%dT%H:%M"), "films": films, "catalog": catalog},
             f"Programmet på {source}: kommende visninger (tmdb-id → visninger). Lages med «langtagning.py kino».")

    urls = {s["url"] for s in shows}
    in_db = {m["tmdb_id"]: m for m in movies if m.get("tmdb_id")}
    mine = [in_db[int(k)] for k in films if int(k) in in_db]
    print(f"{name}: {len(films)} av {len(urls)} filmer koblet til TMDB ({len(catalog)} nye i katalogen), {len(mine)} i databasen din.")
    for m in sorted(mine, key=lambda m: films[str(m["tmdb_id"])]["shows"][0]["t"]):
        if (m.get("status") or {}).get("want"):
            first = films[str(m["tmdb_id"])]["shows"][0]
            series = f" ({first['series']})" if first.get("series") else ""
            print(f"  ★ Vil se: {label(m)} – {first['t'][:16].replace('T', ' kl. ')}{series}")
    missing = sorted(titles.get(u) or u for u in urls if u not in by_url)
    if missing:
        print(f"  Ikke funnet i TMDB ({len(missing)}): {', '.join(missing)}")


def cmd_cinemateket_program(a):
    shows = cine_program(a.delay)
    if not shows:
        raise Fail("Fant ingen visninger på cinemateket.no/forestillinger – har siden endret seg?")
    urls = sorted({s["url"] for s in shows})
    print(f"Cinemateket: {len(shows)} visninger av {len(urls)} filmer ({shows[0]['t'][:10]} – {max(s['t'] for s in shows)[:10]})")

    # Filmsidene (tittel, år, regissør) – samme mellomlager som «cinemateket»
    cache = load_json(CINE_CACHE, {})
    todo = [u for u in urls if u not in cache]
    for u in todo:
        page = http_get(u, CINE_UA, binary=True)
        cache[u] = parse_cine_page(page.decode("utf-8", errors="replace")) if page else None
        time.sleep(a.delay)
    if todo:
        print(f"  hentet {len(todo)} nye filmsider")
        with open(CINE_CACHE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)

    # Kobling til TMDB: først lenkene fra «cinemateket», ellers et oppslag (huskes i tools/cinemateket-tmdb.json)
    known_links = {}
    if os.path.exists(CINE_LINKS):
        with open(CINE_LINKS, encoding="utf-8") as f:
            text = f.read()
        known_links = {u: int(k) for k, u in json.loads(text[text.index("=") + 1:].strip().rstrip(";")).items()}
    looked = load_json(CINE_TMDB, {})
    by_url = {}
    for u in urls:
        tid = known_links.get(u)
        if tid is None and (u not in looked or a.refresh):
            looked[u] = cine_tmdb_lookup(cache.get(u))
        if tid or looked.get(u):
            by_url[u] = tid or looked[u]
    with open(CINE_TMDB, "w", encoding="utf-8") as f:
        json.dump(looked, f, ensure_ascii=False, indent=0, sort_keys=True)

    _, movies = load_db()
    save_program("Cinemateket", CINE_PROGRAM, "LANGTAGNING_CINEMATEKET_PROGRAM", "cinemateket.no", shows, by_url,
                 {u: (cache.get(u) or {}).get("title") for u in urls}, movies)


# ---------------------------------------------------------------- Vega Scene (kinoprogrammet på vegascene.no)

VEGA_BASE = "https://www.vegascene.no"
VEGA_PROGRAM = os.path.join(ROOT, "data", "vega-program.js")      # bare tidspunkter og lenker – kan publiseres
VEGA_CACHE = os.path.join(ROOT, "tools", "vega-cache.json")       # filmside → fakta (originaltittel, regi …)
VEGA_TMDB = os.path.join(ROOT, "tools", "vega-tmdb.json")         # filmside → tmdb-id (null = ikke funnet)


def next_payload(page):
    """Next.js-sider sender dataene som tekstbiter i self.__next_f.push([1, "…"]) – sett dem sammen."""
    return "".join(json.loads(f'"{c}"') for c in re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', page, re.S))


def vega_program():
    from zoneinfo import ZoneInfo
    page = http_get(f"{VEGA_BASE}/kino", CINE_UA, binary=True).decode("utf-8", errors="replace")
    p = next_payload(page)
    i = p.find('{"movies":[')
    if i < 0:
        raise Fail("Fant ikke kinoprogrammet på vegascene.no/kino – har siden endret seg?")
    shows, titles = [], {}
    for m in json.JSONDecoder().raw_decode(p, i)[0]["movies"]:
        url = f"{VEGA_BASE}/film/{m['mainVersionId']}"
        titles[url] = m["title"]
        for s in m["shows"]:
            # showStart er norsk tid uten tidssone
            t = dt.datetime.fromisoformat(s["showStart"]).replace(tzinfo=ZoneInfo("Europe/Oslo"))
            shows.append({"url": url, "t": t.isoformat(timespec="minutes"), "screen": s.get("screenName", "").replace("Vega Kino ", "Sal "),
                          "series": s.get("showType", ""), "ticket": s.get("ticketSaleUrl", "")})
    return shows, titles


def parse_vega_film(page):
    facts = dict(re.findall(r'SFactLabel","children":"([^"]+)"\}\],\["\$","dd",null,\{"className":"[^"]+","children":"?([^"}]*)"?\}', next_payload(page)))
    rt = re.match(r"(?:(\d+) t\.)?\s*(?:(\d+) min)?", facts.get("Spilletid", ""))
    return {"original_title": facts.get("OriginalTittel", ""), "directors": [d.strip() for d in re.split(r",| og ", facts.get("Regi", "")) if d.strip()],
            "year": int(facts["Produksjonsår"]) if facts.get("Produksjonsår", "").isdigit() else None,
            "runtime": int(rt.group(1) or 0) * 60 + int(rt.group(2) or 0) or None, "countries": facts.get("Nasjonalitet", "")}


def vega_tmdb_lookup(title, f):
    """Vega oppgir sjelden produksjonsår. Regissøren må stemme – eller, uten regissør, eksakt tittel, år (±1)
    og spilletid (±10 min). Årstall i tittelen («Speed Racer (2008)») brukes."""
    if not f:
        return None
    y = re.search(r"\((\d{4})\)\s*$", title)
    year = f.get("year") or (int(y.group(1)) if y else None)
    if not f["directors"] and not year:
        return None
    clean = re.sub(r"\s*\(\d{4}\)\s*$|\s+-\s+Filmklubben$", "", title)
    for t in dict.fromkeys(x for x in (f["original_title"], clean) if x):
        # «Produksjonsår» hos Vega er ofte norsk premiereår – med regissør søkes det også uten år
        results = search(t, year) if year else []
        results += [r for r in (search(t) if f["directors"] or not year else []) if r not in results]
        exact = [r for r in results if norm(t) in (norm(r.get("title")), norm(r.get("original_title")))]
        if f["directors"]:
            for r in (exact + [r for r in results if r not in exact])[:6]:
                if director_ok(" / ".join(f["directors"]), details_cached(r["id"])):
                    return r["id"]
        else:
            ok = [r for r in exact if year_of(r) and abs(year_of(r) - year) <= 1 and
                  (not f.get("runtime") or abs((details_cached(r["id"])["runtime"] or 0) - f["runtime"]) <= 10)]
            if len(ok) == 1:
                return ok[0]["id"]
    return None


def cmd_vega_program(a):
    shows, titles = vega_program()
    if not shows:
        raise Fail("Fant ingen visninger på vegascene.no/kino.")
    urls = sorted({s["url"] for s in shows})
    print(f"Vega Scene: {len(shows)} visninger av {len(urls)} filmer ({min(s['t'] for s in shows)[:10]} – {max(s['t'] for s in shows)[:10]})")
    cache, looked = load_json(VEGA_CACHE, {}), load_json(VEGA_TMDB, {})
    todo = [u for u in urls if u not in cache]
    for u in todo:
        page = http_get(u, CINE_UA, binary=True)
        cache[u] = parse_vega_film(page.decode("utf-8", errors="replace")) if page else None
        time.sleep(a.delay)
    if todo:
        print(f"  hentet {len(todo)} nye filmsider")
        with open(VEGA_CACHE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=0, sort_keys=True)
    by_url = {}
    for u in urls:
        if u not in looked or (a.refresh and not looked[u]):
            looked[u] = vega_tmdb_lookup(titles[u], cache.get(u))
        if looked[u]:
            by_url[u] = looked[u]
    with open(VEGA_TMDB, "w", encoding="utf-8") as f:
        json.dump(looked, f, ensure_ascii=False, indent=0, sort_keys=True)
    _, movies = load_db()
    save_program("Vega Scene", VEGA_PROGRAM, "LANGTAGNING_VEGA_PROGRAM", "vegascene.no", shows, by_url, titles, movies)


def cmd_kino(a):
    for fn in (cmd_cinemateket_program, cmd_vega_program):
        fn(a)
        print()


# ---------------------------------------------------------------- Filmoteket (bibliotekenes strømmetjeneste)

FMT_BASE = "https://filmoteket.no"
FMT_CACHE = os.path.join(ROOT, "tools", "filmoteket-cache.json")
FMT_LINKS = os.path.join(ROOT, "data", "filmoteket.js")


class FmtSession:
    """Filmlista hentes med et POST-skjema som krever informasjonskapsel + engangstoken."""

    def __init__(self):
        import http.cookiejar
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.headers = {"User-Agent": "Mozilla/5.0 (Langtagning/1.0; personlig filmliste)"}
        page = self.get("/Films")
        m = re.search(r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"', page)
        if not m:
            raise Fail("Fant ikke skjemaet på filmoteket.no/Films – har nettstedet endret seg?")
        self.token = m.group(1)

    def get(self, path, data=None):
        body = urllib.parse.urlencode(data).encode() if data else None
        req = urllib.request.Request(FMT_BASE + path, data=body, headers={**self.headers, **({"HX-Request": "true"} if data else {})})
        for attempt in range(4):
            try:
                with self.opener.open(req, timeout=30) as r:
                    return r.read().decode("utf-8")
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return ""
                if attempt == 3 or e.code < 500 and e.code != 429:
                    raise Fail(f"HTTP-feil {e.code} for {path}")
            except urllib.error.URLError as e:
                if attempt == 3:
                    raise Fail(f"Nettverksfeil: {e.reason}")
            time.sleep(3 * (attempt + 1))

    def list_page(self, n):
        return self.get("/Films/search", {"__RequestVerificationToken": self.token, "search-term": "", "page": n,
                                          "sort": "", "kat": "", "genre": "", "only-favorites": ""})


def parse_fmt_list(page):
    import html as _html
    items = re.findall(r'href="/film/(\d+)".*?<span>(.*?)</span>.*?<div class="info">\s*(\d{4})?', page, re.S)
    return [{"id": i, "title": _html.unescape(t).strip(), "year": int(y) if y else None} for i, t, y in items]


def parse_fmt_film(page):
    t = _text(re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S))
    regi = re.search(r"\nRegi\n(.*?)\n(?:Produsent|Manus|Musikk|Medvirkende|Foto|Klipp|Undertekster|Land|Språk)\n", t, re.S)
    land = re.search(r"\nLand\n(.*?)\n(?:Språk|Undertekster|Les mer)", t, re.S)
    year = re.search(r"\n(1[89]\d\d|20\d\d)\n•", t)
    directors = [d.strip() for d in re.split(r"\n,\s*\n|,", regi.group(1))] if regi else []
    return {"directors": [d for d in directors if d], "countries": [c.strip(" ,") for c in land.group(1).split("\n") if c.strip(" ,")] if land else [],
            "year": int(year.group(1)) if year else None}


_alt_memo = {}


def tmdb_other_titles(tid):
    """Norske/svenske/danske og alternative titler fra TMDB (for å kjenne igjen f.eks. «Dagdriverne» = «I Vitelloni»)."""
    if tid not in _alt_memo:
        d = tmdb(f"/movie/{tid}", append_to_response="alternative_titles,translations") or {}
        titles = {d.get("title"), d.get("original_title")}
        titles |= {a.get("title") for a in (d.get("alternative_titles") or {}).get("titles", [])}
        titles |= {(t.get("data") or {}).get("title") for t in (d.get("translations") or {}).get("translations", [])
                   if t.get("iso_639_1") in ("no", "nb", "nn", "sv", "da", "en")}
        _alt_memo[tid] = {t for t in titles if t}
    return _alt_memo[tid]


def cmd_filmoteket(a):
    cache = {}
    if os.path.exists(FMT_CACHE):
        with open(FMT_CACHE, encoding="utf-8") as f:
            cache = json.load(f)
    s = FmtSession()
    first = s.list_page(1)
    pages = int((re.search(r'Pagination\.PageCount" type="hidden" value="(\d+)"', first) or [0, 1])[1])
    items = parse_fmt_list(first)
    print(f"Filmoteket: {pages} sider i katalogen – leser lista …")
    for n in range(2, pages + 1):
        time.sleep(a.delay)
        items += parse_fmt_list(s.list_page(n))
    items = list({it["id"]: it for it in items}.values())
    todo = [it for it in items if a.refresh or it["id"] not in cache]
    print(f"{len(items)} titler, {len(todo)} filmsider å hente (ca. {len(todo) * a.delay / 60 + 1:.0f} min) …")
    for n, it in enumerate(todo, 1):
        try:
            cache[it["id"]] = {**it, **parse_fmt_film(s.get(f"/film/{it['id']}") or "")}
        except Fail as e:
            print(f"  ✗ {it['title']}: {e}")
        time.sleep(a.delay)
        if n % 100 == 0 or n == len(todo):
            print(f"  … {n}/{len(todo)}")
            with open(FMT_CACHE, "w", encoding="utf-8") as f:
                json.dump(cache, f, ensure_ascii=False)
    live = {it["id"] for it in items}  # filmer som har forsvunnet fra tjenesten, lenkes ikke

    _, movies = load_db()
    films = all_known_films(movies)
    by_year = {}
    for fid, p in cache.items():
        if fid in live and p.get("year") and p.get("directors"):
            by_year.setdefault(p["year"], []).append((fid, p))
    links, unsure = {}, []
    for m in films:
        key = str(m["tmdb_id"])
        if key in links or not m.get("year") or not m.get("directors"):
            continue
        cands = [(fid, p) for y in (m["year"] - 1, m["year"], m["year"] + 1) for fid, p in by_year.get(y, [])
                 if director_ok(" / ".join(p["directors"]), m)]
        best = None
        for fid, p in cands:
            ts = title_score(p["title"], {"title": m.get("title"), "original_title": m.get("original_title")})
            if ts < 0.75:  # ulik tittel (f.eks. norsk visningstittel) – sjekk TMDBs andre titler
                try:
                    ts = max([ts] + [title_score(p["title"], {"title": t}) for t in tmdb_other_titles(m["tmdb_id"])])
                except Fail:
                    pass
            if ts >= 0.75 and (not best or ts > best[0]):
                best = (ts, fid, p)
        if best:
            links[key] = f"{FMT_BASE}/film/{best[1]}"
            if best[0] < 0.9:
                unsure.append(f"{m['title']} ({m['year']}) ↔ «{best[2]['title']}» ({best[2]['year']})")
    write_js(FMT_LINKS, "LANGTAGNING_FILMOTEKET", links, "Filmer som kan lånes på filmoteket.no (tmdb-id → adresse).")
    in_db = {m["tmdb_id"] for m in movies}
    mine = sum(1 for k in links if int(k) in in_db)
    print(f"\nFerdig: {len(links)} filmer kan lånes på Filmoteket – {mine} i databasen din, {len(links) - mine} andre (kåringer/filmografier).")
    if unsure:
        print("Koblet via norsk/alternativ tittel (kontroller gjerne):")
        for u in unsure:
            print("  -", u)


# ---------------------------------------------------------------- Strømmetjenester (TMDB, data fra JustWatch)
# Tjenestenavn → TMDB-ids for Norge (se /watch/providers/movie?watch_region=NO). Legg til flere ved behov,
# f.eks. "Prime Video": {119}, "Viaplay": {76}, "SkyShowtime": {1773}, "MUBI": {11}.
STREAM_SERVICES = {"Netflix": {8, 175, 1796}, "Disney+": {337}, "HBO Max": {1899, 384}, "NRK TV": {442}, "TV 2 Play": {431}}
STREAM_LINKS = os.path.join(ROOT, "data", "streaming.js")


def cmd_streaming(a):
    _, movies = load_db()
    films = [m for m in movies if m.get("tmdb_id")]
    print(f"Sjekker {len(films)} filmer mot {', '.join(STREAM_SERVICES)} i Norge …")
    out, fails = {}, 0
    for n, m in enumerate(films, 1):
        try:
            no = ((tmdb(f"/movie/{m['tmdb_id']}/watch/providers") or {}).get("results") or {}).get("NO") or {}
        except Fail:
            fails += 1
            continue
        # abonnement, gratis (NRK) og med reklame – ikke leie/kjøp
        ids = {p["provider_id"] for t in ("flatrate", "free", "ads") for p in no.get(t, [])}
        hits = [name for name, pids in STREAM_SERVICES.items() if ids & pids]
        if hits:
            out[str(m["tmdb_id"])] = {"s": hits, "url": no.get("link", "")}
        if n % 100 == 0:
            print(f"  … {n}/{len(films)}")
    write_js(STREAM_LINKS, "LANGTAGNING_STREAMING", out,
             "Filmer i strømmetjenestene i Norge (tmdb-id → tjenester). Strømmedata fra JustWatch via TMDB.")
    want = [m for m in films if str(m["tmdb_id"]) in out and m["status"].get("want") and not m["status"].get("seen")]
    print(f"\nFerdig: {len(out)} av filmene dine kan strømmes" + (f" ({fails} oppslag feilet)" if fails else "") + ".")
    if want:
        print(f"Vil se – og kan strømmes nå ({len(want)}):")
        for m in sorted(want, key=lambda m: m["title"]):
            print(f"  - {m['title']} ({m.get('year')}): {', '.join(out[str(m['tmdb_id'])]['s'])}")


# ---------------------------------------------------------------- Roger Ebert og Criterion (via Wikidata)
# Begge nettstedene blokkerer skript, men Wikidata har ID-ene: P6932 (RogerEbert.com), P9584 (Criterion-film),
# P12279 (Criterion spine-nummer) og P4947 (TMDB-film-ID).

WIKI_LINKS = os.path.join(ROOT, "data", "wikidata-lenker.js")
CRIT_LIST = os.path.join(ROOT, "tools", "lister", "criterion", "criterion.txt")


def cmd_wikidata(a):
    # Uten GROUP BY/SAMPLE – det er tregt på serveren; radene slås sammen her i stedet
    query = """SELECT ?tmdb ?e ?c ?s ?t ?d WHERE {
      { ?film wdt:P6932 ?e } UNION { ?film wdt:P9584 ?c }
      UNION { ?film wdt:P12279 ?s . OPTIONAL { ?film rdfs:label ?t FILTER(LANG(?t) = "en") } OPTIONAL { ?film wdt:P577 ?d } }
      ?film wdt:P4947 ?tmdb .
    }"""
    url = f"{WIKIDATA}?{urllib.parse.urlencode({'query': query, 'format': 'json'})}"
    print("Henter Roger Ebert- og Criterion-ID-er fra Wikidata …")
    try:
        data = http_get(url, {"Accept": "application/sparql-results+json",
                              "User-Agent": "Langtagning/1.0 (personlig filmdatabase)"}) or {}
    except Fail as e:
        if "429" in str(e):
            raise Fail("Wikidata begrenser antall spørringer akkurat nå (429). Vent et par minutter og prøv igjen.")
        raise
    links, crit = {}, {}  # crit: tmdb → [spine, tittel, år]
    for row in data.get("results", {}).get("bindings", []):
        v = {k: row[k]["value"] for k in row}
        tid = v.get("tmdb", "")
        if not tid.isdigit():
            continue
        if v.get("e"):
            links.setdefault(tid, {})["ebert"] = v["e"]
        if v.get("c"):
            links.setdefault(tid, {})["criterion"] = v["c"]
        num = re.match(r"\d+", v.get("s", ""))
        if num:
            c = crit.setdefault(tid, [int(num[0]), None, None])
            c[0] = min(c[0], int(num[0]))
            c[1] = c[1] or v.get("t")
            yr = re.match(r"\d{4}", v.get("d", ""))
            if yr and (not c[2] or int(yr[0]) < c[2]):
                c[2] = int(yr[0])
    spines = [(c[0], c[1], c[2], int(tid)) for tid, c in crit.items() if c[1] and c[2]]
    if not links:
        raise Fail("Fikk ingen treff fra Wikidata – prøv igjen senere.")
    write_js(WIKI_LINKS, "LANGTAGNING_WIKILINKS", links,
             "Lenker til Roger Ebert og Criterion (tmdb-id → ID). Genereres av: python3 tools/langtagning.py wikidata")

    # Criterion Collection som usortert samling, med spine-nummeret som nummer
    spines.sort()
    count = {}
    for s, *_ in spines:
        count[s] = count.get(s, 0) + 1
    os.makedirs(os.path.dirname(CRIT_LIST), exist_ok=True)
    with open(CRIT_LIST, "w", encoding="utf-8") as f:
        f.write("# navn: The Criterion Collection\n# kort: Criterion\n# serie: Criterion Collection\n"
                f"# år: {dt.date.today().year}\n# type: samling\n# nummer: spine\n"
                "# kilde: https://www.criterion.com/shop/browse/list\n"
                "# Genereres av: python3 tools/langtagning.py wikidata (spine-nummer fra Wikidata) – ikke rediger.\n\n")
        for s, title, year, tid in spines:
            title = re.sub(r"[|()]", " ", title).strip()
            f.write(f"{'=' if count[s] > 1 else ''}{s} | {title} ({year}) | tmdb:{tid}\n")

    _, movies = load_db()
    mine = {m["tmdb_id"] for m in movies if m.get("tmdb_id")}
    n_eb = sum(1 for k, v in links.items() if "ebert" in v and int(k) in mine)
    n_cc = sum(1 for k, v in links.items() if "criterion" in v and int(k) in mine)
    n_sp = sum(1 for *_, tid in spines if tid in mine)
    print(f"Ferdig: {len(links)} filmer med lenker – i databasen din: {n_eb} Roger Ebert, {n_cc} Criterion.")
    print(f"Criterion Collection: {len(spines)} filmer med spine-nummer ({n_sp} i databasen din) → {os.path.relpath(CRIT_LIST, ROOT)}")
    print("Kjør nå «python3 tools/langtagning.py lists» for å bygge Criterion-lista inn i nettsiden.")


# ---------------------------------------------------------------- regissører (hele filmografien fra TMDB)

DIR_JS = os.path.join(ROOT, "data", "directors.js")
DIR_EXTRA = os.path.join(ROOT, "tools", "regissorer.txt")
DIR_CACHE = os.path.join(ROOT, "tools", "regissorer-cache.json")
SHORT_MINUTES = 45


def read_extra_directors():
    if not os.path.exists(DIR_EXTRA):
        return []
    with open(DIR_EXTRA, encoding="utf-8") as f:
        return [l.strip() for l in f if l.strip() and not l.startswith("#")]


def find_person(name, own_ids):
    """Finn riktig TMDB-person. Har du filmer av regissøren, må personen ha regissert minst én av dem."""
    people = (tmdb("/search/person", query=name) or {}).get("results", [])[:5]
    fallback = None
    for p in people:
        credits = tmdb(f"/person/{p['id']}/movie_credits") or {}
        directed = {c["id"] for c in credits.get("crew", []) if c.get("job") == "Director"}
        if own_ids and own_ids & directed:
            return p, credits
        if not own_ids and directed and (fallback is None or p.get("known_for_department") == "Directing"):
            if fallback is None or fallback[0].get("known_for_department") != "Directing":
                fallback = (p, credits)
    return fallback if fallback and not own_ids else (None, None)


def cmd_directors(a):
    from collections import Counter
    cache = {"people": {}, "films": {}}
    if os.path.exists(DIR_CACHE):
        with open(DIR_CACHE, encoding="utf-8") as f:
            cache = json.load(f)
    extra = read_extra_directors()
    for n in a.names or []:
        if n not in extra:
            extra.append(n)
    if a.names:
        with open(DIR_EXTRA, "w", encoding="utf-8") as f:
            f.write("# Ekstra regissører som skal ha hele filmografien (én per linje)\n" + "\n".join(extra) + "\n")

    _, movies = load_db()
    counts = Counter(d for m in movies for d in m.get("directors") or [])
    names = sorted({n for n, c in counts.items() if c >= a.min} | set(extra))
    known = {m["tmdb_id"]: m for m in movies if m.get("tmdb_id")}
    known.update({int(k): c for k, c in load_lists().get("catalog", {}).items()})
    today = dt.date.today().isoformat()
    print(f"Henter filmografi for {len(names)} regissører …")

    directors, films_out = [], {}
    for n, name in enumerate(names, 1):
        own = {m["tmdb_id"] for m in movies if name in (m.get("directors") or []) and m.get("tmdb_id")}
        try:
            pid = cache["people"].get(name)
            if pid:
                person, credits = {"id": pid, "name": name}, tmdb(f"/person/{pid}/movie_credits") or {}
            else:
                person, credits = find_person(name, own)
        except Fail as e:
            print(f"  ✗ {name}: {e}")
            continue
        if not person:
            print(f"  ✗ Fant ikke {name} i TMDB")
            continue
        cache["people"][name] = person["id"]
        seen_ids, films = set(), []
        for c in credits.get("crew", []):
            if c.get("job") != "Director" or c["id"] in seen_ids:
                continue
            date = c.get("release_date") or ""
            if not date or date > today:
                continue  # uten dato eller ikke utgitt ennå
            seen_ids.add(c["id"])
            tid = c["id"]
            k = known.get(tid) or cache["films"].get(str(tid))
            if not k:
                try:
                    d = details(tid)
                except Fail:
                    continue
                k = {key: d.get(key) for key in CATALOG_FIELDS if key in d}
                k["poster"] = f"{IMG}/w342{d['_poster_path']}" if d.get("_poster_path") else None
                k["backdrop"] = f"{IMG}/w780{d['_backdrop_path']}" if d.get("_backdrop_path") else None
                cache["films"][str(tid)] = k
            runtime = k.get("runtime") or 0
            genres = c.get("genre_ids") or []
            kind = ("doc" if 99 in genres else "tv" if 10770 in genres  # 10770 = TV-film
                    else "short" if 0 < runtime < SHORT_MINUTES else "feature")
            films.append({"id": tid, "year": int(date[:4]), "kind": kind})
            if tid not in known:
                films_out[str(tid)] = cache["films"][str(tid)]
        films.sort(key=lambda f: (f["year"], f["id"]))
        directors.append({"name": name, "person_id": person["id"], "films": films})
        if n % 10 == 0 or n == len(names):
            print(f"  … {n}/{len(names)}")
            with open(DIR_CACHE, "w", encoding="utf-8") as f:
                json.dump(cache, f, ensure_ascii=False)
    write_js(DIR_JS, "LANGTAGNING_DIRECTORS", {"directors": directors, "films": films_out},
             "Regissørenes filmografier fra TMDB. Genereres av: python3 tools/langtagning.py directors")
    feats = sum(1 for d in directors for f in d["films"] if f["kind"] == "feature")
    print(f"\nFerdig: {len(directors)} regissører, {feats} spillefilmer ({len(films_out)} nye i katalogen).")


# ---------------------------------------------------------------- kåringer (tools/lister → data/lists.js)

LISTS_DIR = os.path.join(ROOT, "tools", "lister")
LISTS_PATH = os.path.join(ROOT, "data", "lists.js")
LISTS_PREFIX = "window.LANGTAGNING_LISTS = "
LIST_LINE = re.compile(r"^(=?)\s*(\d+)\s*=?\s*\|\s*(.*?)\s*\((\d{4})\)\s*(?:\|(?!\s*tmdb:)\s*([^|]*?))?\s*(?:\|\s*tmdb:(\d+))?\s*$")
CATALOG_FIELDS = ["tmdb_id", "imdb_id", "title", "original_title", "year", "directors", "countries",
                  "runtime", "cast", "overview", "poster", "backdrop"]


def parse_list_file(path):
    meta = {"id": os.path.splitext(os.path.basename(path))[0]}
    rows = []
    with open(path, encoding="utf-8") as f:
        for n, raw in enumerate(f, 1):
            line = raw.strip()
            if not line:
                continue
            if line.startswith("#"):
                m = re.match(r"#\s*(navn|kort|serie|år|størrelse|type|kilde|nummer):\s*(.+)$", line)
                if m:
                    meta[{"navn": "name", "kort": "short", "serie": "series", "år": "year", "størrelse": "size", "type": "kind", "kilde": "source", "nummer": "numbered"}[m.group(1)]] = m.group(2).strip()
                continue
            m = LIST_LINE.match(line)
            if not m:
                raise Fail(f"{os.path.basename(path)} linje {n}: forstår ikke «{line}»")
            rows.append({"rank": int(m.group(2)), "tied": bool(m.group(1)) or "=" in line.split("|")[0][1:],
                         "title": m.group(3), "year": int(m.group(4)), "director": (m.group(5) or "").strip(),
                         "tmdb": int(m.group(6)) if m.group(6) else None})
    meta["year"] = int(meta.get("year") or 0)
    if meta.get("kind") in ("årlig", "annual"):
        meta["kind"] = "annual"  # årets topp 10 (f.eks. Cahiers): vises med årvelger, ikke i historikkgrafen
    elif meta.get("kind") in ("samling", "collection"):
        meta["kind"] = "collection"  # usortert samling (f.eks. kultfilmer): ingen plassering
    else:
        meta.pop("kind", None)
    meta.setdefault("name", meta["id"])
    meta.setdefault("short", meta["name"])
    meta.setdefault("series", meta["name"])
    return meta, rows


def load_lists():
    if not os.path.exists(LISTS_PATH):
        return {"lists": [], "catalog": {}}
    with open(LISTS_PATH, encoding="utf-8") as f:
        text = f.read()
    i = text.find(LISTS_PREFIX)
    body = text[i + len(LISTS_PREFIX):].strip().rstrip(";")
    return json.loads(body)


def save_lists(data):
    lines = ["// Langtagning – kåringer. Genereres av: python3 tools/langtagning.py lists",
             "// Ikke rediger denne fila – endre heller tools/lister/*.txt og kjør kommandoen på nytt.",
             LISTS_PREFIX + "{", '"lists": [']
    for li, lst in enumerate(data["lists"]):
        head = {k: v for k, v in lst.items() if k != "entries"}
        lines.append("{" + json.dumps(head, ensure_ascii=False)[1:-1] + ', "entries": [')
        lines.append(",\n".join("  " + json.dumps(e, ensure_ascii=False) for e in lst["entries"]))
        lines.append("]}" + ("," if li < len(data["lists"]) - 1 else ""))
    lines.append('],\n"catalog": {')
    items = sorted(data["catalog"].items(), key=lambda kv: int(kv[0]))
    lines.append(",\n".join(f'"{k}": ' + json.dumps(v, ensure_ascii=False) for k, v in items))
    lines.append("}\n};\n")
    with open(LISTS_PATH + ".tmp", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    os.replace(LISTS_PATH + ".tmp", LISTS_PATH)


def name_tokens(names):
    toks = set()
    for n in names:
        toks |= {t for t in slugify(n).split("-") if len(t) >= 3}
    return toks


def split_directors(wanted):
    return [n.strip() for n in re.split(r"[/&,]| and ", wanted or "") if n.strip()]


def _token_like(a, b):
    import difflib
    return a == b or (min(len(a), len(b)) >= 5 and (a.startswith(b) or b.startswith(a))) \
        or (min(len(a), len(b)) >= 5 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.8)


def director_ok(wanted, d):
    """True hvis én av regissørene i lista har alle navneledd (omtrent) med hos en TMDB-regissør.
    «Ozu Yasujirô» = «Yasujirō Ozu», «Carl Dreyer» = «Carl Theodor Dreyer», men «Michael Haneke» ≠ «Michael Leinau»."""
    names = split_directors(wanted)
    if not names:
        return True
    have = [name_tokens([h]) for h in (d.get("directors") or [])]
    for n in names:
        want = name_tokens([n]) - {"the"}
        if want and any(all(any(_token_like(w, h) for h in hv) for w in want) for hv in have):
            return True
    return False


def title_score(title, r):
    import difflib
    t = norm(title)
    return max(difflib.SequenceMatcher(None, t, norm(r.get(k) or "")).ratio() for k in ("title", "original_title"))


def find_via_director(row):
    """Slå opp regissøren og finn filmen blant regissørens filmer (fanger opp f.eks. Mirror = Zerkalo)."""
    best = None
    for name in split_directors(row["director"])[:2]:
        people = (tmdb("/search/person", query=name) or {}).get("results", [])[:2]
        for p in people:
            credits = tmdb(f"/person/{p['id']}/movie_credits") or {}
            films = {c["id"]: c for c in credits.get("crew", []) if c.get("job") == "Director"}
            near = [c for c in films.values() if year_of(c) and abs(year_of(c) - row["year"]) <= 1]
            for c in near:
                ts = title_score(row["title"], c)
                if len(near) > 1 and ts < 0.5:
                    continue  # flere filmer samme år: tittelen må ligne
                score = ts + (0.15 if year_of(c) == row["year"] else 0) + (0.4 if len(near) == 1 else 0)
                if not best or score > best[0]:
                    best = (score, c["id"])
    return best[1] if best and best[0] >= 0.55 else None


_details_memo = {}


def details_cached(tid):
    if tid not in _details_memo:
        _details_memo[tid] = details(tid)
    return _details_memo[tid]


def resolve_row(row):
    """Finn TMDB-id for en linje i en kåring. Returnerer (tmdb_id, usikker)."""
    if row["tmdb"]:
        return row["tmdb"], False
    ordered = []
    # først med årstall, så uten (utgivelsesåret kan avvike mye, f.eks. Partie de campagne: 1936/1946)
    for results in (search(row["title"], row["year"]), search(row["title"])):
        exact = [r for r in results if norm(row["title"]) in (norm(r.get("title")), norm(r.get("original_title")))]
        cand = exact + [r for r in results if r not in exact]
        for r in cand[:6]:
            if director_ok(row["director"], details_cached(r["id"])):
                return r["id"], False
        ordered = ordered or cand
    if row["director"]:
        tid = find_via_director(row)
        if tid:
            return tid, False
        return None, True  # heller ingen kobling enn feil film
    return (ordered[0]["id"], True) if ordered else (None, True)


def cmd_lists(a):
    files = sorted(os.path.relpath(os.path.join(d, f), LISTS_DIR) for d, _, fs in os.walk(LISTS_DIR)
                   for f in fs if f.endswith(".txt")) if os.path.isdir(LISTS_DIR) else []
    if not files:
        raise Fail("Fant ingen kåringer i tools/lister/")
    _, movies = load_db()
    in_db = {m["tmdb_id"] for m in movies if m.get("tmdb_id")}
    old = load_lists()
    cache = {}
    for lst in old.get("lists", []):
        for e in lst["entries"]:
            if e.get("tmdb_id") and not e.get("unsure"):
                cache[(norm(e["title"]), e["year"], e.get("director", ""))] = e["tmdb_id"]
    lists, unsure, missing = [], [], []
    for fn in files:
        meta, rows = parse_list_file(os.path.join(LISTS_DIR, fn))
        if meta.get("kind") != "annual":
            print(f"\n{meta['name']} – {len(rows)} filmer")
        entries = []
        for row in rows:
            key = (norm(row["title"]), row["year"], row["director"])
            tid = row["tmdb"] or (None if a.refresh else cache.get(key))
            doubt = False
            if row["tmdb"] == 0:  # «tmdb:0» = bevisst uten kobling (f.eks. TV-serier)
                tid = None
            elif not tid:
                try:
                    tid, doubt = resolve_row(row)
                except Fail as e:
                    print(f"  ✗ {row['title']}: {e}")
                    tid = None
            if not tid and row["tmdb"] != 0:
                missing.append(f"{meta['short']}: {row['rank']}. {row['title']} ({row['year']})")
            if tid and doubt:
                unsure.append(f"{meta['short']}: {row['rank']}. {row['title']} ({row['year']}) → tmdb:{tid}")
            entry = {"rank": row["rank"], "tied": row["tied"], "tmdb_id": tid,
                     "title": row["title"], "year": row["year"], "director": row["director"]}
            if doubt:
                entry["unsure"] = True
            entries.append(entry)
        meta["size"] = int(meta.get("size") or max((e["rank"] for e in entries), default=0))
        meta["entries"] = entries
        lists.append(meta)
    lists.sort(key=lambda l: (l["series"], -l["year"]))

    # Katalog: filmer i kåringene som ikke finnes i databasen din
    catalog, old_cat = {}, old.get("catalog", {})
    wanted = sorted({e["tmdb_id"] for l in lists for e in l["entries"] if e["tmdb_id"] and e["tmdb_id"] not in in_db})
    print(f"\nKatalog: {len(wanted)} filmer du ikke har registrert – henter data og plakater …")
    for n, tid in enumerate(wanted, 1):
        prev = old_cat.get(str(tid))
        if prev:
            local = (prev.get("poster") or "").startswith("posters/")
            if a.local_images == local and (not local or os.path.exists(os.path.join(ROOT, prev["poster"]))):
                catalog[str(tid)] = prev
                continue
        try:
            d = details_cached(tid)
        except Fail as e:
            print(f"  ✗ tmdb:{tid}: {e}")
            continue
        entry = {k: d.get(k) for k in CATALOG_FIELDS if k in d}
        if a.local_images:
            entry["poster"] = download(d["_poster_path"], "w500", f"{tid}.jpg")
            entry["backdrop"] = download(d["_backdrop_path"], "w780", f"{tid}-bg.jpg")
        else:  # bilder rett fra TMDB – sparer plass for filmer du ikke har
            entry["poster"] = f"{IMG}/w342{d['_poster_path']}" if d.get("_poster_path") else None
            entry["backdrop"] = f"{IMG}/w780{d['_backdrop_path']}" if d.get("_backdrop_path") else None
        catalog[str(tid)] = entry
        if n % 25 == 0:
            print(f"  … {n}/{len(wanted)}")
    save_lists({"lists": lists, "catalog": catalog})

    # Rydd bort bilder for katalogfilmer som ikke lenger er med (aldri bilder for filmer i databasen)
    keep = {m.get(k) for m in movies for k in ("poster", "backdrop")} | {c.get(k) for c in catalog.values() for k in ("poster", "backdrop")}
    removed = 0
    for tid, c in old_cat.items():
        for k in ("poster", "backdrop"):
            pth = c.get(k)
            if pth and pth not in keep and pth.startswith("posters/") and os.path.exists(os.path.join(ROOT, pth)):
                os.remove(os.path.join(ROOT, pth))
                removed += 1
    if removed:
        print(f"Ryddet bort {removed} bildefiler for filmer som ikke lenger er i katalogen.")

    print("\nFerdig:")
    groups = []  # årlige serier slås sammen til én linje
    for l in lists:
        grouped = l.get("kind") in ("annual", "collection")
        key = l["series"] if grouped else l["id"]
        if not groups or groups[-1][0] != key:
            groups.append((key, l["series"] if grouped else l["short"], []))
        groups[-1][2].append(l)
    for _, name, ls in groups:
        ids = {e["tmdb_id"] for l in ls for e in l["entries"] if e["tmdb_id"]}
        n = sum(len(l["entries"]) for l in ls)
        mine = [m for m in movies if m.get("tmdb_id") in ids]
        seen = sum(1 for m in mine if (m.get("status") or {}).get("seen"))
        extra = f" ({len(ls)} {'lister' if ls[0].get('kind') == 'collection' else 'årganger'})" if len(ls) > 1 else ""
        print(f"  {name}{extra}: {n} filmer, {len(mine)} i databasen din, {seen} sett")
    if unsure:
        print("\nUsikre treff (uten regissør å sjekke mot) – kontroller, og legg evt. til «| tmdb:ID» i lista:")
        for u in unsure:
            print("  -", u)
    if missing:
        print("\nIkke koblet til TMDB (fant ingen film av riktig regissør) – legg evt. til «| tmdb:ID» i lista:")
        for u in missing:
            print("  -", u)


def cmd_check(a):
    _, movies = load_db()
    ids, problems = set(), 0
    for i, m in enumerate(movies, 1):
        if not m.get("title"):
            print(f"⚠ Film nr. {i} mangler tittel"); problems += 1
        if m.get("id") in ids:
            print(f"⚠ Dobbel id: {m['id']}"); problems += 1
        ids.add(m.get("id"))
        p = m.get("poster")
        if p and not os.path.exists(os.path.join(ROOT, p)):
            print(f"⚠ {label(m)}: mangler bildefil {p}"); problems += 1
    print(f"{'OK' if not problems else 'Fant ' + str(problems) + ' problem(er)'} – {len(movies)} filmer i databasen.")


def main():
    p = argparse.ArgumentParser(description="Langtagning – vedlikehold av filmdatabasen.")
    sub = p.add_subparsers(dest="cmd", required=True)

    def status_flags(sp):
        sp.add_argument("--seen", "--sett", action="store_true", help="merk som sett")
        sp.add_argument("--want", "--vil-se", action="store_true", help="merk som «vil se»")
        sp.add_argument("--owned", "--samling", "--dvd", "--bluray", dest="owned", action="store_true",
                        help="i samlingen (har den på DVD/Blu-ray)")
        sp.add_argument("--tag", action="append", help="legg til tagg (kan gjentas)")

    s = sub.add_parser("add", help="legg til én film")
    s.add_argument("title")
    s.add_argument("--year", type=int)
    s.add_argument("--tmdb", type=int, help="bruk denne TMDB-id-en direkte")
    s.add_argument("--note", help="egen beskrivelse")
    s.add_argument("--first", action="store_true", help="ikke spør, velg beste treff")
    status_flags(s)
    s.set_defaults(fn=cmd_add)

    s = sub.add_parser("import", help="importer en tekstfil med én film per linje")
    s.add_argument("file")
    s.add_argument("--interactive", "-i", action="store_true", help="spør når det er flere treff")
    status_flags(s)
    s.set_defaults(fn=cmd_import)

    s = sub.add_parser("sync", help="hent data og bilder for filmer som mangler det")
    s.add_argument("--all", action="store_true", help="oppdater TMDB-data for alle filmer")
    s.add_argument("--images", action="store_true", help="last ned bildene på nytt")
    s.add_argument("--interactive", "-i", action="store_true", help="spør når det er flere treff")
    s.set_defaults(fn=cmd_sync)

    s = sub.add_parser("awards", help="hent festivalpriser o.l. fra Wikidata for alle filmer")
    s.set_defaults(fn=cmd_awards)

    s = sub.add_parser("lists", help="bygg kåringene (tools/lister/*.txt) inn i data/lists.js")
    s.add_argument("--refresh", action="store_true", help="slå opp alle filmer på nytt")
    s.add_argument("--local-images", action="store_true", help="last ned bilder også for filmer du ikke har (mer plass)")
    s.set_defaults(fn=cmd_lists)

    s = sub.add_parser("queue", aliases=["ko"], help="behandle køen fra nettsiden (todo/ko.txt, Nedlastinger og JSON-eksport)")
    s.set_defaults(fn=cmd_queue)

    s = sub.add_parser("cinemateket", help="hent omtaler fra cinemateket.no og koble dem til filmene")
    s.add_argument("--refresh", action="store_true", help="hent alle sidene på nytt")
    s.add_argument("--delay", type=float, default=1.0, help="sekunder mellom hver side (standard 1)")
    s.set_defaults(fn=cmd_cinemateket)

    s = sub.add_parser("cinemateket-program", help="hent kommende visninger fra cinemateket.no/forestillinger")
    s.add_argument("--refresh", action="store_true", help="slå opp filmer som ikke ble funnet i TMDB på nytt")
    s.add_argument("--delay", type=float, default=1.0, help="sekunder mellom hver side (standard 1)")
    s.set_defaults(fn=cmd_cinemateket_program)

    s = sub.add_parser("vega-program", help="hent kinoprogrammet fra vegascene.no/kino")
    s.add_argument("--refresh", action="store_true", help="slå opp filmer som ikke ble funnet i TMDB på nytt")
    s.add_argument("--delay", type=float, default=1.0, help="sekunder mellom hver side (standard 1)")
    s.set_defaults(fn=cmd_vega_program)

    s = sub.add_parser("kino", help="hent programmet fra alle kinoene (Cinemateket og Vega Scene)")
    s.add_argument("--refresh", action="store_true", help="slå opp filmer som ikke ble funnet i TMDB på nytt")
    s.add_argument("--delay", type=float, default=1.0, help="sekunder mellom hver side (standard 1)")
    s.set_defaults(fn=cmd_kino)

    s = sub.add_parser("filmoteket", help="finn filmer som kan lånes på filmoteket.no")
    s.add_argument("--refresh", action="store_true", help="hent alle filmsidene på nytt")
    s.add_argument("--delay", type=float, default=1.0, help="sekunder mellom hver side (standard 1)")
    s.set_defaults(fn=cmd_filmoteket)

    s = sub.add_parser("streaming", aliases=["strømming"], help="finn filmene dine på Netflix, Disney+, HBO Max, NRK TV og TV 2 Play (Norge)")
    s.set_defaults(fn=cmd_streaming)

    s = sub.add_parser("wikidata", help="hent Roger Ebert- og Criterion-lenker og Criterion-lista fra Wikidata")
    s.set_defaults(fn=cmd_wikidata)

    s = sub.add_parser("directors", help="hent hele filmografien til regissørene dine fra TMDB")
    s.add_argument("names", nargs="*", help="ekstra regissører (huskes i tools/regissorer.txt)")
    s.add_argument("--min", type=int, default=2, help="ta med regissører du har minst så mange filmer av (standard 2)")
    s.set_defaults(fn=cmd_directors)

    s = sub.add_parser("check", help="sjekk at databasen er gyldig")
    s.set_defaults(fn=cmd_check)

    a = p.parse_args()
    try:
        if a.cmd not in ("check", "awards", "cinemateket", "wikidata"):
            api_key()  # stopp tidlig hvis nøkkelen mangler
        a.fn(a)
    except Fail as e:
        print(f"Feil: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nAvbrutt.")
        sys.exit(130)


if __name__ == "__main__":
    main()
