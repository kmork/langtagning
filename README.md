# Langtagning

Din egen filmdatabase: filmer du har sett, vil se, og har i samlingen (DVD/Blu-ray).
Ren HTML/CSS/JavaScript – åpne `index.html` direkte i nettleseren (dobbeltklikk). Ingen server trengs.

```
index.html            nettsiden
css/style.css         utseende
js/app.js             filtrering, søk og detaljvisning
data/movies.js        DATABASEN (redigeres for hånd eller med skriptet)
posters/              plakater og bakgrunnsbilder (lastes ned automatisk)
tools/langtagning.py   hjelpeskript som henter data fra TMDB
```

## 1. Skaff en gratis TMDB API-nøkkel (én gang)

1. Lag konto på <https://www.themoviedb.org/signup>
2. Gå til <https://www.themoviedb.org/settings/api> og klikk «Create» / be om nøkkel.
   Velg «Developer», og oppgi at det er til personlig, ikke-kommersiell bruk.
3. Kopier **API Key** (eller «API Read Access Token» – begge virker) inn i filen
   `tools/tmdb_key.txt` (bare nøkkelen, ingenting annet).

## 2. Legg til filmer

**Mange på en gang** – lag en tekstfil med én film per linje (se `tools/eksempel-liste.txt`):

```
Stalker (1979) | sett, samling | klassiker
Oslo, 31. august (2011) | sett | nordisk | Trier på sitt beste.
Paris, Texas (1984) | vil-se
Heat
```

```sh
python3 tools/langtagning.py import mine-filmer.txt
python3 tools/langtagning.py import mine-filmer.txt --interactive   # velg selv ved flere treff
python3 tools/langtagning.py import hylla.txt --owned               # gi alle linjene en status
```

Skriptet sier fra om usikre treff (f.eks. «Heat» uten årstall). Legg til årstall, eller bruk `--interactive`.
Filmer som allerede finnes blir ikke duplisert – status og tagger slås sammen.

**Én film:**

```sh
python3 tools/langtagning.py add "Paris, Texas" --year 1984 --seen --owned --tag favoritt --note "Ry Cooders gitar!"
```

**Annet:**

```sh
python3 tools/langtagning.py sync           # hent data/plakater for filmer som mangler det
python3 tools/langtagning.py sync --all     # oppdater TMDB-data for alle (dine egne felt beholdes)
python3 tools/langtagning.py awards         # hent priser fra Wikidata for alle filmer (trenger ikke nøkkel)
python3 tools/langtagning.py check          # sjekk at movies.js er gyldig etter håndredigering
```

### Priser

Priser hentes automatisk fra [Wikidata](https://www.wikidata.org/) når du legger til filmer (via IMDb-id-en).
Følgende tas med:

- **Festivaler** (alle konkurransepriser): Cannes, Berlin, Venezia, Locarno, San Sebastián, Karlovy Vary, Sundance, Toronto
- **Andre:** Oscar (beste film, regi, internasjonale film, animasjon, dokumentar), BAFTA (beste film og
  ikke-engelskspråklige film), European Film Awards, César, Guldbagge og Amanda (beste film)

Wikidata er ikke komplett, og noen priser kan mangle. Legg dem til selv i `awards`,
f.eks. `"Cannes – Beste kvinnelige skuespiller"`. Med formatet «Utdeler – Pris» blir prisen gruppert riktig
i filteret. Er Wikidata nede eller treg, kjører du bare `awards` igjen senere.
Vil du ta med flere priser eller kategorier, endrer du listene `FESTIVALS` og `OTHER` i `tools/langtagning.py`.

Etter du har fått nøkkel: kjør `sync` én gang for å hente plakater til eksempelfilmene –
eller slett dem (de har taggen `eksempel`).

## Kåringer (Sight and Sound)

Kåringene ligger som tekstfiler i `tools/lister/`, én fil per kåring:

```
# navn: Sight and Sound 2022 – kritikernes topp 250
# kort: S&S kritikere 2022
# serie: Sight and Sound – kritikere
# år: 2022
# kilde: https://www.bfi.org.uk/sight-and-sound/greatest-films-all-time

1 | Jeanne Dielman, 23 Quai du Commerce, 1080 Bruxelles (1975) | Chantal Akerman
=4 | Tokyo Story (1953) | Yasujirō Ozu          ← «=» betyr delt plass
17 | Some Film (1960) | Some Director | tmdb:12345   ← tving riktig TMDB-film
152 | Twin Peaks: The Return (2017) | David Lynch | tmdb:0   ← bevisst uten kobling (TV-serie o.l.)
```

Lister kan også ligge i undermapper (som `tools/lister/cahiers/`).
Med `# type: årlig` i toppen regnes lista som «årets topp 10» (som Cahiers). Den vises da med årvelger og
«Alle år», og med et merke («Cahiers ’59»), men ikke i historikkgrafen.

Etter endringer kjører du:

```sh
python3 tools/langtagning.py lists          # bygg data/lists.js (gjenbruker tidligere oppslag)
python3 tools/langtagning.py lists --refresh   # slå opp alt på nytt
```

Skriptet slår opp hver film i TMDB og kontrollerer at regissøren stemmer. Usikre treff listes opp til slutt.
Filmer du ikke har i databasen, hentes inn som «katalogfilmer» med plakat. De vises i kåringene, men ikke i samlingen din.
Kåringer med samme `serie` sammenlignes over tid. En ny kåring (for eksempel en annen kritikerliste) legges til
ved å lage en ny fil og kjøre `lists`.

| Fil | Kilde |
|---|---|
| `ss-2022-kritikere.txt` | BFI – topp 250 |
| `ss-2022-regissorer.txt` | BFI – topp 100 |
| `ss-2012-kritikere.txt` | BFI (arkivert) – topp 100. BFI publiserte topp 250 i 2012, men bare topp 100 er bevart |
| `ss-2012-regissorer.txt` | AwardsDaily sin kopi av BFIs liste (plass 1–20 kontrollert mot BFIs arkiv) |
| `ss-1952…2002-kritikere.txt`, `ss-1992/2002-regissorer.txt` | Topp 10 fra Wikipedia (*Sight and Sound*-artikkelen). I 2002 regnes The Godfather I og II som én oppføring |
| `tspdt-2026.txt` | [They Shoot Pictures, Don't They?](https://www.theyshootpictures.com/gf1000_all1000films_table.php) – 1000 Greatest Films, 2026-utgaven |
| `cahiers/cahiers-1951…2025.txt` | Cahiers du cinémas årlige topp 10 ([fransk Wikipedia](https://fr.wikipedia.org/wiki/Top_10_des_Cahiers_du_cin%C3%A9ma)). TMDB-id-ene er hentet via Wikidata. Det mangler lister for 1952–53, 1969–80 og 2003 |

Filmer du ikke har, viser bilder rett fra TMDB (krever nett) for å spare plass.
Vil du ha dem lokalt: `python3 tools/langtagning.py lists --local-images` (rundt 200 MB ekstra).

## Endre status fra nettsiden (bare lokalt)

Når siden er åpnet fra disk (eller `localhost`), har filmene i kåringslista og detaljvisningen tre knapper:
**Sett**, **Vil se** og **Eier**. Klikkene legges i en kø, som vises nederst på siden.

1. **Lagre køen**
   - **Chrome/Edge:** klikk «Velg kø-fil …» og velg `todo/ko.txt` én gang. Etter det lagres køen automatisk ved hver endring.
   - **Safari/Firefox:** klikk «Last ned kø-fil». Fila havner i Nedlastinger som `langtagning-ko.txt`.
2. Kjør:
   ```sh
   python3 tools/langtagning.py queue
   ```
   Skriptet leser `todo/ko.txt` og `~/Downloads/langtagning-ko*.txt`, og så:
   - legger det til nye filmer (med plakat og priser) og oppdaterer status på filmer du har
   - holder `tools/eide-filmer.txt` i takt for filmer du eier
   - tømmer køen
3. Last siden på nytt. Behandlede filmer forsvinner fra køen av seg selv.

Knappene, køen og «Ikke i databasen din ennå» vises **ikke** når siden ligger ute på nett.

## Omtaler fra Cinemateket

```sh
python3 tools/langtagning.py cinemateket
```

Henter norske omtaler fra filmsidene på [cinemateket.no](https://www.cinemateket.no). Første gang tar det
ca. 45 minutter (én side i sekundet). Senere henter kommandoen bare nye sider. En film kobles bare når tittel,
år (±1) og regissør stemmer. Det gjelder både filmene dine og filmene i kåringene.

- `data/cinemateket.js`: tekstene (© Cinemateket/Norsk filminstitutt). **Bare for lokal bruk. Ikke last
  opp denne fila** når siden legges ut på nett. Siden laster den uansett bare når den kjøres lokalt.
- `data/cinemateket-lenker.js`: bare lenkene. Kan publiseres. På nett viser detaljvisningen en «Cinemateket»-lenke.
- `tools/cinemateket-cache.json`: sider som allerede er hentet.

## Lån på Filmoteket

```sh
python3 tools/langtagning.py filmoteket
```

Sjekker hvilke filmer som kan lånes på [filmoteket.no](https://filmoteket.no) (bibliotekenes strømmetjeneste, lån med
bibliotekkortet). Første gang tar det ca. 45 minutter, og senere hentes bare nye titler. Et treff krever at
regissør og år (±1) stemmer. Filmoteket bruker ofte norske titler («Dagdriverne» = *I Vitelloni*), så
tittelen kontrolleres også mot TMDBs norske og alternative titler.

Siden får «▶ Lån på Filmoteket» i detaljvisningen, et merke på plakaten og på/av-knappen «▶ Kan lånes»
ved statusknappene. Lenkene (`data/filmoteket.js`) kan publiseres.
Kjør kommandoen av og til, for utvalget på Filmoteket endrer seg.

## Regissører: hele filmografien

```sh
python3 tools/langtagning.py directors                  # regissører du har minst 2 filmer av
python3 tools/langtagning.py directors "Agnès Varda"    # en bestemt regissør (huskes i tools/regissorer.txt)
python3 tools/langtagning.py directors --min 1          # alle regissørene i Mitt utvalg
```

Henter regissørenes filmografier fra TMDB. Skriptet sjekker at TMDB-personen har regissert minst én av filmene dine,
så det ikke blir feil person med samme navn. Plakatene vises rett fra TMDB.

På siden kommer du til en regissør på tre måter: *Hele filmografien →* i detaljvisningen, lenken under
regissørfilteret, eller forslaget som dukker opp når du søker (f.eks. «felli»). «Vis» viser da
*Regissør: Federico Fellini* med × for å gå tilbake, filmene står kronologisk, og toppen viser «8 av 24 sett».
Som standard vises spillefilmer. Kortfilmer, TV-filmer og dokumentarer tas med via lenken i toppen.
Kjør `cinemateket`/`filmoteket` etterpå, så også de nye filmene får omtaler og lånelenker.

## 3. Rediger for hånd

Åpne `data/movies.js` i en teksteditor. Hver film ser slik ut:

```js
{
  "id": "stalker-1979",                 // unik, brukes i lenker (#film=stalker-1979)
  "tmdb_id": 1398,                      // fylles inn av skriptet
  "imdb_id": "tt0079944",
  "title": "Stalker",
  "original_title": "Сталкер",
  "year": 1979,
  "directors": ["Andrei Tarkovsky"],
  "countries": ["SU"],                  // landkoder (ISO), vises på norsk
  "runtime": 162,                       // minutter
  "cast": ["Alexander Kaidanovsky"],
  "awards": ["Cannes – Den økumeniske juryens pris"],   // «Utdeler – Pris»
  "overview": "Handlingsresymé fra TMDB (norsk hvis det finnes)",
  "poster": "posters/1398.jpg",
  "backdrop": "posters/1398-bg.jpg",
  "status": { "seen": true, "want": false, "owned": true },
  "tags": ["klassiker"],
  "description": "Din egen tekst. Linjeskift skrives som \n",
  "links": { "bfi": "", "rt": "" },     // valgfrie direktelenker
  "added": "2026-10-15"
}
```

Felt du eier selv, og som skriptet **aldri** overskriver: `status`, `tags`, `description`, `links`, `added`, `id`.
Til `awards` legger skriptet bare til nye priser. Priser du har skrevet inn selv blir stående.

- **BFI / Rotten Tomatoes:** Uten egen lenke viser siden en søkelenke (merket «søk»).
  Lim inn den eksakte adressen i `links.bfi` / `links.rt` for direktelenke.
  Du kan også legge til egne lenker, f.eks. `"letterboxd": "https://letterboxd.com/film/stalker/"`.
- **Ny film for hånd:** Det holder å skrive `{ "title": "Stalker", "year": 1979 }` og så kjøre `sync`.
- **Husk gyldig JSON:** doble anførselstegn, komma mellom elementer men ikke etter det siste.
  Kjør `check` hvis siden plutselig er tom.

## Nettsiden

Navigasjonen har tre nivåer, og alle kan kombineres:

1. **Vis:** *Mitt utvalg* (filmene du har tatt stilling til) eller en liste kuratert av andre
   (Sight and Sound, TSPDT, Cahiers, Kultfilmer …). I en liste ser du alle filmene på lista, også dem du ikke har registrert.
2. **Status:** Alle · Sett · Ikke sett · Vil se · Eier (og *Ikke registrert* i lister), pluss på/av-knappen
   **▶ Kan lånes** (Filmoteket).
3. **Filtre** i sidepanelet: regissør, land, priser, «også på liste», tiår, skuespiller, tagger og søk.

Eksempel: *Vis: TSPDT* + *Ikke sett* + *Regissør: Fellini* gir Fellini-klassikerne du mangler.

- **Plakater eller liste** (knappene til høyre). Lister vises som standard med plassering og bevegelse siden
  forrige kåring, og lokalt med knappene Sett / Vil se / Eier.
- Når en liste er valgt, viser toppen fremdriften («65 av 264 sett»). Den følger filtrene.
- Fritekstsøk (`/` hopper til søkefeltet), sortering (også «Plassering i lista» og «Flest priser»), terning for tilfeldig film.
- Klikk regissør/land/skuespiller/tagg i detaljvisningen for å filtrere på det innenfor utvalget du står i.
- Valgene lagres i adressen, så bokmerker og tilbake-knappen virker. Gamle bokmerker oversettes automatisk.
- Detaljvisningen viser plasseringene over tid og Cinematekets omtale (lokalt).
- Mørkt kinotema med lys variant (månen øverst til høyre). ⓘ viser «Om Langtagning».

Data og bilder fra [TMDB](https://www.themoviedb.org/). Dette produktet bruker TMDB API, men er ikke godkjent eller sertifisert av TMDB.
