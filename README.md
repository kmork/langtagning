# Langtagning

Din egen filmdatabase: filmer du har sett, vil se, og har i samlingen (DVD/Blu-ray).
Ren HTML/CSS/JavaScript – åpne `index.html` direkte i nettleseren (dobbeltklikk). Ingen server trengs.

```
index.html            nettsiden
css/style.css         utseende
js/app.js             filtrering, søk og detaljvisning
js/store.js           lagring av personlige data i nettleseren (status, tanker, tagger)
data/movies.js        DATABASEN (redigeres for hånd eller med skriptet)
posters/              plakater og bakgrunnsbilder (lastes ned automatisk, brukes bare lokalt)
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

## Endre status, tanker og tagger fra nettsiden

Filmene har tre knapper: **Sett**, **Vil se** og **Eier**. En sett film får i tillegg knappen **◌ Nedton**
(«sett, men ikke interessant»). Nedtonede filmer skjules i Mitt utvalg – «N nedtonede skjult · vis» over filmene
tar dem fram, dempet (`&muted=1`). I lister, på regissørsider og ved søk vises de alltid, og de teller som sett.
I importfiler skrives det `Top Gun (1986) | nedtonet` (gir også «sett»), og `add` har `--nedtonet`.
Detaljvisningen har i tillegg et felt for
**Mine tanker** (lagres automatisk) og **tagger** (skriv og trykk Enter). Alt lagres i nettleseren
(`js/store.js`, IndexedDB med localStorage som reserve). Butikken holder bare *endringer* oppå et grunnlag:

| Modus | Når | Grunnlag | Endringene havner |
|---|---|---|---|
| Lokal | `file://` eller `localhost` | `movies.js` | eksportfil → `queue` → `movies.js` |
| Eier online | på nett, med eierflagg | `movies.js` | eksportfil → `queue` → `movies.js` → opplasting |
| Venn online | på nett, uten flagg | tomt | eksportfil (backup og flytting) |

### Lokalt (som før)

Har du endringer som ikke er lagt inn i `movies.js`, står det «3 endringer ikke lagt inn» nede til høyre.
Klikk der, eller på **Mine data** øverst, for å se lista. Der kan du også fjerne enkeltendringer.

1. **Mine data → Eksporter.** Fila havner i Nedlastinger som `langtagning-knut-<dato>.json`.
2. Kjør:
   ```sh
   python3 tools/langtagning.py queue
   ```
   Skriptet leser `~/Downloads/langtagning-*.json` (og eldre kø-filer: `todo/ko.txt`, `~/Downloads/langtagning-ko*.txt`), og så:
   - legger det til nye filmer (med plakat og priser) og oppdaterer status, `tags` og `description` (tankene)
   - slår sammen filene: nyeste endring vinner, felt for felt
   - holder `tools/eide-filmer.txt` i takt for filmer du eier
   - flytter behandlede JSON-filer til `todo/behandlet/`, og tømmer `todo/ko.txt`
3. Last siden på nytt. Endringer som nå står likt i `movies.js`, forsvinner av seg selv.

Nettsiden skriver ikke lenger `todo/ko.txt`, men skriptet leser den fortsatt. Du kan skrive linjer der for hånd
(tagger og tanker bare når de er endret, tankene alltid sist):

```
Persona (1966) | sett, samling | tmdb:797 | tagger: favoritt, bergman | tanker: "Linjeskift skrives som \n"
```

### Eier online (f.eks. på mobilen)

Åpne den publiserte siden én gang med `#eier` på slutten av adressen, eller kryss av for «Dette er min samling»
under **Mine data** (arkivskuffen øverst). Da er Mitt utvalg hele `movies.js`, og endringene samles i en stripe
nederst: «3 endringer ikke lagt inn». Klikk **Eksporter**, få fila over i `~/Downloads` på Mac-en, og kjør
`queue` som over. Etter opplasting forsvinner endringene fra mobilen ved neste besøk.
Flagget er bare et visningsvalg i nettleseren, ikke sikkerhet. `movies.js` er uansett publisert.
`queue` bruker bare eksportfiler laget med eierflagg (`"owner": true`). En venns fil hoppes over.

### Venner

Uten eierflagg starter Mitt utvalg tomt, og en velkomstboks forklarer siden. Knuts filmer er en egen kilde
under «Vis»: **Knuts utvalg**. Den oppfører seg som en kåring: statusfilteret gjelder vennens egne statuser
(«Knuts utvalg + Ikke sett» = filmer Knut har som du ikke har sett), og Knuts status vises som et eget merke.
Med «Filtrer på: Knuts» gjelder statusfilteret Knuts statuser i stedet (`&st=knut` i adressen).
I detaljvisningen står vennens egne felt øverst, og «Knuts tanker» under.

**Mine data** har eksport og import (slå sammen eller erstatt), sletting og eierflagget.
Etter 25 endringer, eller 14 dager uten eksport, minner en stripe nederst om å ta backup.

### Eksportformat

`langtagning-<navn>-2026-10-18.json`:

```json
{ "format": "langtagning-user", "schema": 1, "exported": "…", "name": "ola", "owner": false,
  "films": [ { "id": "tmdb:797", "tmdb_id": 797, "title": "Persona", "year": 1966,
               "status": {"seen": true, "want": false, "owned": false},
               "note": "…", "tags": ["favoritt"], "updated": "…" } ] }
```

Hver post har bare feltene som er endret. Et felt som mangler, betyr «som i grunnlaget». Film-id-en er
`tmdb:<id>` når filmen har TMDB-id, ellers film-id-en fra `movies.js`. Ved import matches filmene på TMDB-id,
så id, så tittel og år. Ukjente filmer beholdes, og listes under «Ukjente filmer» i Mine data.

### Opplasting

Last opp som før, pluss `js/store.js`. Last **aldri** opp `data/cinemateket.js`, `tools/`, `todo/` eller `filmer/`.

`posters/` trenger ikke lastes opp. På nett henter siden plakatene rett fra TMDB (`poster_url`/`backdrop_url` i
`movies.js`, som `add`, `import`, `queue` og `sync` fyller ut), mens lokalt brukes filene i `posters/`.

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

Filmer med en side på cinemateket.no får en «Cinemateket»-lenke i detaljvisningen. Merket «Cinemateket» kommer
fra lista under.

## Alle filmer Cinemateket har vist (egen liste)

```sh
python3 tools/langtagning.py cinemateket-alle                 # sitemap + programmet
python3 tools/langtagning.py cinemateket-alle --kilde sitemap # bare filmsidene på cinemateket.no
python3 tools/langtagning.py cinemateket-alle --kilde wayback # arkiverte sider fra Wayback Machine (1–2 timer første gang)
python3 tools/langtagning.py lists                            # bygg lista inn i appen
```

Lager én liste, «Cinemateket i Oslo», med alle filmene Cinemateket har vist. Den vises på linje med
kåringene (under **Kuratert av andre**) og har merket «Cinemateket». Lista er ikke koblet til kinoprogrammet.

- `tools/cinemateket-alle.json`: alle filmene som er funnet (filmside → tittel, år, regissør, tmdb-id og kilder).
  Nye kilder legger bare til filmer, så kommandoen kan kjøres så ofte du vil.
- `tools/lister/cinemateket.txt`: lista som `lists` bygger inn. **Genereres. Ikke rediger den.**
  `tmdb:0` betyr at filmen ikke ble funnet i TMDB.
- Sider uten produksjonsår (arrangementer, kortfilmprogram, verksteder) tas ikke med.
- `kino` og `cinemateket-program` legger nye filmer fra programmet inn i lista automatisk.
  Kjør `lists` etterpå.

Kilder:
- `sitemap`: filmsidene på dagens cinemateket.no.
- `program`: programmet (også via `kino`).
- `wayback`: filmsider som er fjernet fra nettstedet, hentet fra [Wayback Machine](https://web.archive.org).
  Gjelder dagens nettsted (ca. 2018 og framover): arkiverte filmsider, og filmer som arkiverte program- og
  kalendersider lenker til. Funnene lagres i `tools/wayback-cache.json`, så en avbrutt kjøring fortsetter der den slapp.

Eldre nettsteder (før 2018) og trykte programmer (Nasjonalbiblioteket) kommer i senere steg.

## Kinoprogram: Cinemateket og Vega Scene

```sh
python3 tools/langtagning.py kino                  # begge kinoene (ca. 10 sekunder, første gang ca. 2 minutter)
python3 tools/langtagning.py cinemateket-program   # bare Cinemateket
python3 tools/langtagning.py vega-program          # bare Vega Scene
```

Henter alle kommende visninger fra [cinemateket.no/forestillinger](https://www.cinemateket.no/forestillinger) og
[vegascene.no/kino](https://www.vegascene.no/kino) og kobler filmene til TMDB. Regissøren må stemme. Vega oppgir
sjelden produksjonsår, så uten regissør kreves eksakt tittel, år og spilletid. Filmer som ikke finnes i databasen
eller kåringene, legges inn som katalogfilmer. Skriptet viser hvilke av «Vil se»-filmene dine som går.
Kjør det gjerne én gang i uka. Vega legger ut visningene fortløpende, ofte bare én–to uker frem.

- `data/cinemateket-program.js`, `data/vega-program.js`: tidspunkter, sal, serie og billettlenker. Kan publiseres.
- `tools/cinemateket-tmdb.json`, `tools/vega-tmdb.json`: TMDB-oppslag som er gjort (`--refresh` prøver de som ikke
  ble funnet på nytt). `tools/vega-cache.json`: fakta fra filmsidene på vegascene.no.

På siden:
- **Vis → Cinemateket – programmet** / **Vega Scene – programmet**: alle filmene på programmet, sortert etter neste visning.
- Knappen **🎬 På kino** ved statusknappene viser bare filmer som går på en av kinoene. Sammen med **Vil se** får du
  filmene du vil se og som går på kino nå. Det virker også for venner med sin egen vil-se-liste.
  Velg sorteringen **Neste kinovisning**; merkene på plakatene viser hvilken kino.
- Plakatene får merker som «Cinemateket 25. okt.» og «Vega 17. nov.», og detaljvisningen viser alle visningene
  med billettlenke.
- Visninger som har vært, skjules automatisk. Programmet er likevel bare så ferskt som siste kjøring.

## Filmfrelst (podkast)

```sh
python3 tools/langtagning.py filmfrelst
```

Kobler filmene til episoder av [Filmfrelst](https://filmfrelst.podbean.com), podkasten til Montages.no.
Detaljvisningen får en lenke per episode, for eksempel «Filmfrelst #482». Det blir ingen merker og ingen filtre.

- Filmtitlene leses fra episodetitlene: titler i «» (med regissør og år når de står der) og, for eldre episoder,
  kommaseparerte titler. Seriefrelst (TV-serier) hoppes over.
- Bare filmer som allerede finnes i Langtagning kobles (databasen, listene og filmografiene).
  Når tittelen ikke gir ett sikkert treff, avgjør et TMDB-søk på norsk. Det finner også norske titler som «Parasitt».
- `data/filmfrelst.js`: tmdb-id → episoder (bare lenker). Kan publiseres.
- `tools/filmfrelst-tmdb.json`: TMDB-søk som er gjort.
- `tools/filmfrelst-rettelser.txt` (valgfri): `482 | West Side Story | tmdb:511809`. `tmdb:0` fjerner en kobling.
  Du kan også legge til filmer som ikke står i episodetittelen.

Kjør kommandoen på nytt når det kommer nye episoder, eller etter `lists`/`directors` (flere filmer å koble mot).

## Lån på Filmoteket

```sh
python3 tools/langtagning.py filmoteket
```

Sjekker hvilke filmer som kan lånes på [filmoteket.no](https://filmoteket.no) (bibliotekenes strømmetjeneste, lån med
bibliotekkortet). Første gang tar det ca. 45 minutter, og senere hentes bare nye titler. Et treff krever at
regissør og år (±1) stemmer. Filmoteket bruker ofte norske titler («Dagdriverne» = *I Vitelloni*), så
tittelen kontrolleres også mot TMDBs norske og alternative titler.

Siden får «▶ Lån på Filmoteket» i detaljvisningen, et merke på plakaten og på/av-knappen «▶ Strømming»
ved statusknappene. Lenkene (`data/filmoteket.js`) kan publiseres.
Kjør kommandoen av og til, for utvalget på Filmoteket endrer seg.

## Netflix, Disney+, HBO Max, NRK TV, TV 2 Play og Viaplay

```sh
python3 tools/langtagning.py streaming
```

Sjekker hvilke filmer på siden – dine, kåringene, regissørenes filmografier og kinoprogrammene – som kan sees
på Netflix, Disney+, HBO Max, NRK TV, TV 2 Play og Viaplay **i Norge** (abonnement eller gratis, ikke leie/kjøp; TMDB-nøkkelen
holder, og dataene kommer fra JustWatch). Den henter hele katalogen til hver tjeneste og kontrollerer treffene film
for film. Det tar 4–5 minutter, og til slutt skrives «vil se»-filmene dine som kan strømmes nå. Siden viser tjenesten
som merke på plakaten og i lista, lenke i detaljvisningen, og filmene kommer med under «▶ Strømming». Flere tjenester (Prime Video, Strim, MUBI …)
legger du til i `STREAM_SERVICES` i `tools/langtagning.py`. Katalogene endrer seg ofte, så kjør den jevnlig.

Under **Mine data → Strømmetjenester** krysser du av for tjenestene du har (Filmoteket er med i lista).
Da tar «▶ Strømming» og merkene på plakatene bare med dem. Detaljvisningen viser fortsatt alle.
Valget lagres i nettleseren, på samme måte som statusene dine. Før du har valgt, gjelder det alle har: Filmoteket og NRK TV.

## Roger Ebert og Criterion Collection

```sh
python3 tools/langtagning.py wikidata
python3 tools/langtagning.py lists
```

rogerebert.com og criterion.com blokkerer skript, så ID-ene hentes fra Wikidata (én spørring). `wikidata` skriver
`data/wikidata-lenker.js` (kan publiseres) og lager Criterion Collection som en liste med spine-nummer
(`tools/lister/criterion/criterion.txt`, `# nummer: spine`). `lists` bygger den inn i nettsiden.

I detaljvisningen får alle filmer en «Roger Ebert»-lenke: direkte til anmeldelsen når Wikidata kjenner adressen,
ellers et søk. «Criterion»-lenken vises bare for filmer Criterion har gitt ut. Filmer i samlingen får merket
«Criterion #spine», og hele samlingen finnes under «Vis». Lim inn en adresse i `links.ebert` /
`links.criterion` for å overstyre.

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
  Lim inn den eksakte adressen i `links.bfi` / `links.rt` (eller `links.ebert` / `links.criterion`) for direktelenke.
  Du kan også legge til egne lenker, f.eks. `"letterboxd": "https://letterboxd.com/film/stalker/"`.
- **Ny film for hånd:** Det holder å skrive `{ "title": "Stalker", "year": 1979 }` og så kjøre `sync`.
- **Husk gyldig JSON:** doble anførselstegn, komma mellom elementer men ikke etter det siste.
  Kjør `check` hvis siden plutselig er tom.

## Nettsiden

Navigasjonen har tre nivåer, og alle kan kombineres:

1. **Vis:** *Mitt utvalg* (filmene du har tatt stilling til) eller en liste kuratert av andre
   (Sight and Sound, TSPDT, Cahiers, Kultfilmer …). I en liste ser du alle filmene på lista, også dem du ikke har registrert.
2. **Status:** Alle · Sett · Ikke sett · Vil se · Eier (og *Ikke registrert* i lister), pluss på/av-knappen
   **▶ Strømming** (Filmoteket, Netflix, Disney+, HBO Max, NRK TV, TV 2 Play, Viaplay) og **🎬 På kino** (Cinemateket og Vega Scene).
3. **Filtre** i sidepanelet: regissør, land, priser, «også på liste», tiår, skuespiller, tagger og søk.

Eksempel: *Vis: TSPDT* + *Ikke sett* + *Regissør: Fellini* gir Fellini-klassikerne du mangler.

- **Plakater eller liste** (knappene til høyre). Lister vises som standard med plassering og bevegelse siden
  forrige kåring, og med knappene Sett / Vil se / Eier.
- Når en liste er valgt, viser toppen fremdriften («65 av 264 sett»). Den følger filtrene.
- Fritekstsøk (`/` hopper til søkefeltet), sortering (også «Plassering i lista» og «Flest priser»), terning for tilfeldig film.
- Klikk regissør/land/skuespiller/tagg i detaljvisningen for å filtrere på det innenfor utvalget du står i.
- Valgene lagres i adressen, så bokmerker og tilbake-knappen virker. Gamle bokmerker oversettes automatisk.
- Detaljvisningen viser plasseringene over tid og Cinematekets omtale (lokalt).
- Mørkt kinotema med lys variant (månen øverst til høyre). ⓘ viser «Om Langtagning».

## Forslag til forbedringer

### Legg til film som ikke ligger i noen liste (søk i Wikidata)

I dag kan nettsiden bare vise filmer som ligger i `movies.js` eller `lists.js`. En ny film må slås opp i TMDB
med skriptet og eierens nøkkel, så en venn kan ikke legge til en film som ikke står på noen liste.

Forslag: en knapp «Legg til film» som søker i [Wikidata](https://www.wikidata.org/) rett fra nettleseren.

- Wikidata trenger ingen nøkkel, og søket kan gjøres direkte fra siden. Da slipper vi en server og
  holder TMDB-nøkkelen hemmelig.
- Et treff gir tittel, år, regissør, IMDb-id og som regel TMDB-id.
- Filmen lagres i nettleseren som de andre endringene. `Store.set` tar allerede imot `tmdb_id`, tittel og år.
  Den vises med generert plakat, siden Wikidata ikke har plakater.
- For eieren: `queue` kjenner TMDB-id-en og henter resten (data og plakat) inn i `movies.js`.
- Må gjøres i `app.js`: filmer i lagringen som ikke finnes i katalogen må vises (i dag blir de nok ikke det).
- Begrensning: smale filmer (kortfilmer, studentfilmer, festivalfilmer) mangler ofte i Wikidata.
  Et enkelt skjema der man fyller inn tittel og år kan legges til senere hvis det trengs.

Data og bilder fra [TMDB](https://www.themoviedb.org/). Dette produktet bruker TMDB API, men er ikke godkjent eller sertifisert av TMDB.
