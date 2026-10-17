# Plan: Langtagning for filmvenner

*Laget 2026-10-17. Oppdatert 2026-10-17 med eierflagg. Status: forslag, ikke påbegynt.*

## Mål

Filmvenner skal kunne bruke den publiserte siden (S3) til sin egen filmoversikt.
De skal kunne markere filmer som **Sett / Vil se / Eier** og skrive egne tanker og
tagger. Alt dette lagres **bare i deres egen nettleser**. Det trengs ingen server,
ingen konto og ingen innlogging. Dataene flyttes og sikres med **eksport og import**
av en fil.

Knuts egen arbeidsflyt forblir som i dag. Han redigerer lokalt (file://), bruker
`movies.js`, køen og `langtagning.py`, og laster opp til S3. I tillegg kan Knut
bruke den publiserte siden (f.eks. på mobilen) og se hele utvalget sitt der, uten
en kopi av lista. Endringer han gjør online, havner i `movies.js` via den samme
køen.

## Grunnprinsipper

1. **Felles data kommer fra siden:** kåringer, filmografier, Knuts filmer, plakater
   og Filmoteket-lenker.
2. **Mitt utvalg = grunnlag + endringer.** Nettleseren lagrer bare *endringer* oppå et
   grunnlag, slik køen gjør i dag (`js/app.js`, `langtagning-queue`):
   - **Eier (Knut):** grunnlaget er `movies.js`. Endringene er det som ikke er
     behandlet med `langtagning.py queue` ennå.
   - **Venn:** grunnlaget er tomt. Endringene er alle vennens data.
   - Det finnes aldri to fullstendige lister. `movies.js` er fasit for Knut.
3. **Eierflagg velger grunnlag.** Et flagg i nettleseren sier «dette er Knut».
   Det er et visningsvalg, ikke sikkerhet. `movies.js` er uansett publisert, så
   flagget gir ikke tilgang til noe nytt.
4. **Personlige data ligger bare i nettleseren:** status, tanker, tagger, innstillinger.
   Ingenting sendes noe sted.
5. **Knuts utvalg for venner.** Uten eierflagg blir Knuts statuser og tanker en kilde i
   «Vis»-menyen («Knuts utvalg», «Knuts tanker»). «Mitt utvalg» betyr alltid den
   besøkendes egne filmer. Med eierflagg skjules «Knuts utvalg», for det er det
   samme som «Mitt utvalg».
6. **Lokal modus er uendret.** På file:// eller localhost gjelder dagens oppførsel:
   `movies.js` er fasit, og knappene skriver til køen. Lokal modus regnes alltid som
   eier.
7. **Opphavsrett og hemmeligheter er uendret:**
   - `data/cinemateket.js` lastes aldri opp.
   - `tools/tmdb_key.txt` lastes aldri opp, og ingen API-nøkkel legges i nettleseren.

## Moduser

| Modus | Når | Grunnlag | Endringer | Hvor endringene ender |
|---|---|---|---|---|
| Lokal | file:// eller localhost | `movies.js` | køen/butikken | `ko.txt` → `queue` → `movies.js` |
| Eier online | nett + eierflagg | `movies.js` | butikken | eksportfil → `queue` → `movies.js` → S3 |
| Venn online | nett, uten flagg | tomt | butikken | eksportfil (backup, flytting) |

### Eierflagget

- Settes ved å åpne siden med `#eier` én gang, eller med en bryter under «Mine data»
  («Dette er min samling»). Huskes i localStorage (`langtagning-eier`).
- Kan slås av samme sted. Når det slås av eller på, beholdes endringene i butikken,
  men siden spør om de skal beholdes, eksporteres eller slettes, siden de var gjort
  mot et annet grunnlag.
- Bryteren er ikke fremhevet for venner. Den står nederst under «Mine data», med en
  kort forklaring.

## Datamodell (nettleser)

IndexedDB-database `langtagning-user`. Hvis IndexedDB mangler, brukes localStorage.

```
films   (nøkkel: film-id, f.eks. "persona-1966" eller "tmdb:797")
  { id, tmdb_id, title, year,
    status?: {seen, want, owned}, note?: "", tags?: [],
    seen_date?: "2026-10-17", updated: "2026-10-17T20:15:00Z" }

meta
  { schema: 1, created, lastExport, changesSinceExport, name?: "Ola" }
```

- Hver post er en **endring**: bare feltene som er endret, lagres. Et felt som mangler,
  betyr «som i grunnlaget».
- Film-id-en følger samme regel som i dag: DB-id-er, og ellers `tmdb:<id>` for
  katalogfilmer.
- Hver post har `updated`, slik at import kan slå sammen per film (nyeste vinner).
- **Rydding (eier):** ved lasting fjernes felt som nå er like i `movies.js`, og poster
  uten gjenværende felt slettes. Slik forsvinner endringer av seg selv etter
  `queue` og opplasting, akkurat som køen i dag (`js/app.js:165–167`).
- Dagens kø (`langtagning-queue` i localStorage) flyttes inn i butikken ved første
  lasting og slettes deretter.
- Tema, layout og eierflagget blir fortsatt lagret i localStorage, siden de bare er
  bekvemmelighet.

### Eksportformat

Fila heter `langtagning-<navn>-2026-10-17.json` (for Knut: `langtagning-knut-…`):

```json
{ "format": "langtagning-user", "schema": 1, "exported": "…", "name": "Ola",
  "owner": false,
  "films": [ { "id": "persona-1966", "tmdb_id": 797, "title": "Persona", "year": 1966,
               "status": {"seen": true, "want": false, "owned": false},
               "note": "…", "tags": ["favoritt"], "updated": "…" } ] }
```

- Fila tar med tittel og år, slik at den er lesbar for mennesker og kan matches på nytt
  hvis en id endres.
- Det samme formatet er **køformatet**: `langtagning.py queue` leser det i tillegg til
  `ko.txt`. Eieren eksporterer derfor bare endringene sine, ikke hele `movies.js`.

## Faser

### Fase 1 – Lagringslag (`js/store.js`)
- Lag et lite API: `get(id)`, `set(id, patch)`, `all()`, `exportJSON()`,
  `importJSON(obj, mode)`, `stats()`, `prune(base)`.
- Butikken erstatter dagens kø. Lokal modus bruker den også, og `ko.txt` skrives fra
  butikken som i dag.
- IndexedDB, med fallback til localStorage. Fanger alle feil (privat modus, full disk).
- Kaller `navigator.storage.persist()` ved første endring og husker svaret.
- Telleren `changesSinceExport` økes ved hver endring.
- **Ferdig når:** status, tanker og tagger overlever omlasting i Chrome, Firefox og Safari,
  og den lokale køen virker som før.

### Fase 2 – Personlig modus online (`js/app.js`)
- Ny modus: `OWNER = LOCAL || eierflagg`. Grunnlaget er `movies.js` når `OWNER`,
  ellers tomt. Ved lasting legges endringene fra butikken over grunnlaget.
  `f.status`, `f.note` og `f.tags` er da grunnlag + endring.
- **Eier online:**
  - «Mitt utvalg» viser hele `movies.js` med endringene oppå.
  - Statusknapper og redigering vises, og skriver til butikken.
  - En stripe nederst (som qbar) viser «5 endringer ikke lagt inn – Eksporter», med
    kommandoen `python3 tools/langtagning.py queue`.
  - «Knuts utvalg» skjules i «Vis».
- **Venn online:**
  - Knuts data flyttes til egne felt (`f.knut.status`, `f.knut.description`) og vises
    - som kilden **«Knuts utvalg»** i «Vis»-menyen,
    - i detaljvisningen som «Knuts tanker», med Literata som i dag.
  - Statusknappene (Sett / Vil se / Eier) skriver til butikken.
  - **«Knuts utvalg» oppfører seg som en kåring:**
    - Lista består av alle filmene i `movies.js`.
    - Statusfilteret (Sett / Ikke sett / Vil se / Eier / Ikke registrert) gjelder
      **vennens egne** statuser, som for Sight and Sound i dag. «Knuts utvalg + Ikke
      sett» betyr da «filmer Knut har som jeg ikke har sett».
    - Plakat og liste viser vennens status som hovedmerke. Knuts status vises som et
      lite ekstra merke, f.eks. «Knut: sett · eier».
    - Detaljvisningen viser vennens knapper og «Mine tanker» øverst, og «Knuts tanker»
      (`description`, i Literata) under. Vennens felt for tanker og tagger starter tomme.
  - **Opsjon: bryteren «Filtrer på: Mine / Knuts».** Den står ved statusfilteret når
    «Knuts utvalg» er valgt. Med «Knuts» gjelder statusfilteret `f.knut.status`, så man
    kan spørre f.eks. «hva eier Knut som jeg vil se?». Valget lagres i adressen
    (`&st=knut`), slik at bokmerker virker. Bryteren skjules i andre kilder og for eieren.
    Kan tas med i fase 2 eller vente til etter første deling.
  - Når en ny bruker åpner siden, er «Mitt utvalg» tomt. Siden viser i stedet en
    velkomstboks (fase 4) og foreslår «Knuts utvalg» eller en kåring.
- Detaljvisningen får et redigerbart felt for **«Mine tanker»** (lagres automatisk) og
  tagger (skriv og trykk Enter). For eieren er feltet forhåndsutfylt med
  `description` fra `movies.js`.
- «Mitt utvalg» betyr filmer med minst én status, tanke eller tagg, etter at
  endringene er lagt over grunnlaget.
- Fil-skrivingen til `ko.txt` (File System Access) brukes bare lokalt.
- **Ferdig når:**
  - en venn kan markere 20 filmer online, laste siden på nytt og se dem i «Mitt utvalg»;
  - Knut online med eierflagg ser samme «Mitt utvalg» som lokalt, uten import;
  - en venn kan velge «Knuts utvalg + Ikke sett» og få filmene Knut har som vennen
    ikke har sett, med Knuts status som eget merke;
  - Knuts lokale side er uendret.

### Fase 3 – Eksport, import og backup-påminnelse
- Ny meny **«Mine data»**, et ikon i toppfeltet eller en seksjon i Om-dialogen:
  - **Eksporter** laster ned JSON-fila. I Chrome/Edge kan man i stedet velge en fast
    fil med File System Access, slik ko.txt fungerer i dag.
  - **Importer** tar en fil og spør: «Slå sammen (nyeste vinner)» eller «Erstatt alt».
    Etterpå vises en oppsummering, f.eks. «312 filmer, 14 nye, 3 oppdatert».
  - **Slett alle mine data**, med bekreftelse i dialogen (ikke `confirm()`).
  - **Dette er min samling** (eierflagget), nederst.
  - Status vises øverst: «187 filmer · sist eksportert for 12 dager siden». For eieren:
    «5 endringer ikke lagt inn i movies.js».
- **Påminnelse (venn):** etter 25 endringer, eller 14 dager uten eksport, vises en
  diskret stripe nederst (som qbar): «Du har 37 endringer siden siste backup – Last ned».
  Den kan utsettes. Eieren har i stedet køstripen fra fase 2.
- Import tåler ukjente og gamle id-er. Den matcher på `tmdb_id`, deretter tittel og år.
  Filmer som ikke finnes i katalogen beholdes, men vises under «Ukjente filmer».
- **`langtagning.py queue`** leser også `~/Downloads/langtagning-*.json`:
  - status som i dag (nye filmer hentes med plakat og priser);
  - `note` → `description` og `tags` → `tags` (nytt: i dag skrives bare status);
  - nyeste vinner mellom `ko.txt` og JSON-filer, etter `updated`/`ts`;
  - behandlede filer flyttes til `todo/behandlet/`, så de ikke leses to ganger.
- **Ferdig når:**
  - eksport fra én nettleser og import i en annen gir identisk «Mitt utvalg»;
  - en ødelagt fil gir en forståelig feilmelding;
  - Knut kan markere en film på mobilen, eksportere, kjøre `queue`, laste opp, og se
    endringen forsvinne fra butikken på mobilen ved neste besøk.

### Fase 4 – Introduksjon og tekster
- Ved første besøk vises en velkomstboks: hva siden er, at dataene bare lagres i
  denne nettleseren, og at man bør eksportere av og til. Vises ikke med eierflagg.
- Om-dialogen får en kort seksjon, **«Dine data»**, skrevet i samme stil som resten
  av teksten.
- **Safari-tips:** Safari kan slette data etter 7 dager uten besøk. Teksten anbefaler
  derfor å legge siden til på Hjem-skjermen.
- **Ferdig når:** en venn uten instruksjoner skjønner hvordan man markerer, og hvorfor
  man eksporterer.

### Fase 5 – Kan installeres (PWA)
- Legg til `manifest.webmanifest` (navn, ikon, mørk temafarge) og en enkel `sw.js`
  som mellomlagrer siden, datafilene og viste plakater.
- Gevinster:
  - Siden virker uten nett.
  - Den kan legges på Hjem-skjermen.
  - I Safari unngår man 7-dagersslettingen når siden er installert.
- Service worker krever HTTPS. S3-nettstedsadresser er bare HTTP, så siden må serveres
  via CloudFront eller en annen HTTPS-adresse.
- Datafilene får versjonsnummer i adressen, eller nettverket spørres først, slik at
  nye kåringer og en ny `movies.js` ikke henger fast i hurtigbufferen. Det er viktig
  for eieren, ellers ryddes ikke behandlede endringer bort.
- **Ferdig når:** siden kan installeres på iPhone og Android og åpnes i flymodus.

### Fase 6 – Valgfritt senere
- **Import fra Letterboxd:** mange filmvenner har en eksport (`watched.csv`,
  `watchlist.csv`). Filmene matches mot katalogen på tittel og år, og siden viser en
  forhåndsvisning før import.
- **Se en venns utvalg:** last inn en venns eksportfil som en skrivebeskyttet kilde i
  «Vis» («Olas utvalg»), uten server. Da kan man sammenligne: «Ola har sett, du vil se».
- **Filmer utenfor katalogen:** venner kan bare markere filmer i katalogen (DB, kåringer
  og filmografier, rundt 1700 filmer pluss). Tre alternativer:
  1. Ønskeknapp: «Foreslå film for Knut» (viser e-postadresse som tekst).
  2. Manuell innlegging: tittel, år og regissør, uten plakat.
  3. En liten mellomtjeneste (Cloudflare Worker eller AWS Lambda) som søker i TMDB
     med en skjult nøkkel. Dette er det første steget mot en server, og bør vente.

## Filer som berøres

| Fil | Endring |
|---|---|
| `js/store.js` (ny) | Lagringslaget, erstatter køen i localStorage |
| `js/app.js` | Grunnlag + endringer, eierflagg, Knuts utvalg som kilde, redigering, Mine data, påminnelse |
| `index.html` | Laster store.js, «Mine data»-dialog, velkomstboks, manifest-lenke |
| `css/style.css` | Redigerbare felt, dialog, påminnelsesstripe |
| `manifest.webmanifest`, `sw.js`, ikon (nye) | Fase 5 |
| `README.md` | Beskriver vennemodus, eiermodus, eksportformat og opplasting |
| `tools/langtagning.py` | `queue` leser også JSON-eksport og skriver tanker og tagger |

## Opplasting til S3

Som i dag, pluss `js/store.js`, og i fase 5 `manifest.webmanifest`, `sw.js` og ikoner.
Fortsatt **aldri**: `data/cinemateket.js`, `tools/`, `todo/`, `filmer/`.

## Testing

- Headless Chrome for DOM-sjekker, som i dag. Manuelt i Safari (macOS og iOS),
  Firefox og Chrome på Android.
- Spesialtilfeller:
  - privat modus (lagring nektes)
  - full lagring
  - import av ødelagt eller fremmed fil
  - import fra eldre schema
  - sammenslåing med konflikt
  - en id som forsvinner fra katalogen
  - eierflagg slås på og av med endringer i butikken
  - rydding etter ny `movies.js` (status, tanker og tagger)
  - gammel kø i localStorage flyttes til butikken
- Sjekk at lokal modus (file://) fortsatt bruker `movies.js` og køen, og at `ko.txt`
  får samme innhold som før.

## Avklaringer før start

1. Skal venner se **Knuts statuser og tanker** («Knuts utvalg»)? *Forslag: ja.*
2. Skal Om-teksten forbli om Knut, med et tillegg for venner? *Forslag: ja, tillegg
   «Dine data».*
3. Trengs filmer utenfor katalogen i første versjon? *Forslag: nei, vent til fase 6.*
4. Har siden HTTPS (CloudFront)? Det avgjør om fase 5 er mulig.
5. Skal bryteren «Mine / Knuts» med i fase 2? *Forslag: ja hvis den er enkel, ellers
   etter første deling.*
6. ~~Hvordan ser Knut sitt eget utvalg online?~~ *Avgjort: eierflagg i nettleseren.
   Det velger bare visning, og krever ingen server.*

## Rekkefølge og omfang

Fase 1–3 er kjernen, og gir en brukbar vennemodus og eiermodus online. Fase 4 er liten,
men viktig for at vennene forstår siden. Fase 5 bør komme før man deler med
iPhone-brukere. Fase 6 tas etter behov.
