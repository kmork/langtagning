# Plan: Langtagning for filmvenner

*Laget 2026-10-17. Status: forslag, ikke påbegynt.*

## Mål

Filmvenner skal kunne bruke den publiserte siden (S3) til sin egen filmoversikt.
De skal kunne markere filmer som **Sett / Vil se / Eier** og skrive egne tanker og
tagger. Alt dette lagres **bare i deres egen nettleser**. Det trengs ingen server,
ingen konto og ingen innlogging. Dataene flyttes og sikres med **eksport og import**
av en fil.

Knuts egen arbeidsflyt forblir som i dag. Han redigerer lokalt (file://), bruker
`movies.js`, køen og `langtagning.py`, og laster opp til S3.

## Grunnprinsipper

1. **Felles data kommer fra siden:** kåringer, filmografier, Knuts filmer, plakater
   og Filmoteket-lenker.
2. **Personlige data ligger bare i nettleseren:** status, tanker, tagger, innstillinger.
   Ingenting sendes noe sted.
3. **Knuts utvalg blir en liste blant de andre.** Online blir Knuts statuser og tanker
   en kilde i «Vis»-menyen («Knuts utvalg», «Knuts tanker»). «Mitt utvalg» betyr
   alltid den besøkendes egne filmer.
4. **Lokal modus er uendret.** På file:// eller localhost gjelder dagens oppførsel:
   `movies.js` er fasit, og knappene skriver til køen.
5. **Opphavsrett og hemmeligheter er uendret:**
   - `data/cinemateket.js` lastes aldri opp.
   - `tools/tmdb_key.txt` lastes aldri opp, og ingen API-nøkkel legges i nettleseren.

## Datamodell (nettleser)

IndexedDB-database `langtagning-user`. Hvis IndexedDB mangler, brukes localStorage.

```
films   (nøkkel: film-id, f.eks. "persona-1966" eller "tmdb:797")
  { id, tmdb_id, status: {seen, want, owned}, note: "", tags: [],
    seen_date?: "2026-10-17", updated: "2026-10-17T20:15:00Z" }

meta
  { schema: 1, created, lastExport, changesSinceExport, name?: "Ola" }
```

- Film-id-en følger samme regel som i dag: DB-id-er, og ellers `tmdb:<id>` for
  katalogfilmer.
- Hver post har `updated`, slik at import kan slå sammen per film (nyeste vinner).
- Tema og layout blir fortsatt lagret i localStorage, siden de bare er bekvemmelighet.

### Eksportformat

Fila heter `langtagning-<navn>-2026-10-17.json`:

```json
{ "format": "langtagning-user", "schema": 1, "exported": "…", "name": "Ola",
  "films": [ { "id": "persona-1966", "tmdb_id": 797, "title": "Persona", "year": 1966,
               "status": {"seen": true, "want": false, "owned": false},
               "note": "…", "tags": ["favoritt"], "updated": "…" } ] }
```

Fila tar med tittel og år, slik at den er lesbar for mennesker og kan matches på nytt
hvis en id endres.

## Faser

### Fase 1 – Lagringslag (`js/store.js`)
- Lag et lite API: `get(id)`, `set(id, patch)`, `all()`, `exportJSON()`,
  `importJSON(obj, mode)`, `stats()`.
- IndexedDB, med fallback til localStorage. Fanger alle feil (privat modus, full disk).
- Kaller `navigator.storage.persist()` ved første endring og husker svaret.
- Telleren `changesSinceExport` økes ved hver endring.
- **Ferdig når:** status, tanker og tagger overlever omlasting i Chrome, Firefox og Safari.

### Fase 2 – Personlig modus online (`js/app.js`)
- Ny modus: `PERSONAL = !LOCAL`. Ved lasting legges personlige data over filmene.
  `f.status`, `f.note` og `f.tags` kommer da fra butikken, ikke fra `movies.js`.
- Knuts data flyttes til egne felt (`f.knut.status`, `f.knut.description`) og vises
  - som kilden **«Knuts utvalg»** i «Vis»-menyen,
  - i detaljvisningen som «Knuts tanker», med Literata som i dag.
- Statusknappene (Sett / Vil se / Eier) vises også online, men skriver til butikken.
  Køen og fil-skrivingen brukes bare lokalt.
- Detaljvisningen får et redigerbart felt for **«Mine tanker»** (lagres automatisk) og
  tagger (skriv og trykk Enter).
- «Mitt utvalg» betyr filmer med minst én personlig status, tanke eller tagg.
- Når en ny bruker åpner siden, er «Mitt utvalg» tomt. Siden viser i stedet en
  velkomstboks (fase 4) og foreslår «Knuts utvalg» eller en kåring.
- Valgfritt: knappen «Start med Knuts statuser» kopierer statusene, slik at Knut
  raskt kan sette opp sin egen nettleser.
- **Ferdig når:** en venn kan markere 20 filmer online, laste siden på nytt og se
  dem i «Mitt utvalg», mens Knuts lokale side er uendret.

### Fase 3 – Eksport, import og backup-påminnelse
- Ny meny **«Mine data»**, et ikon i toppfeltet eller en seksjon i Om-dialogen:
  - **Eksporter** laster ned JSON-fila. I Chrome/Edge kan man i stedet velge en fast
    fil med File System Access, slik ko.txt fungerer i dag.
  - **Importer** tar en fil og spør: «Slå sammen (nyeste vinner)» eller «Erstatt alt».
    Etterpå vises en oppsummering, f.eks. «312 filmer, 14 nye, 3 oppdatert».
  - **Slett alle mine data**, med bekreftelse i dialogen (ikke `confirm()`).
  - Status vises øverst: «187 filmer · sist eksportert for 12 dager siden».
- **Påminnelse:** etter 25 endringer, eller 14 dager uten eksport, vises en diskret
  stripe nederst (som qbar): «Du har 37 endringer siden siste backup – Last ned».
  Den kan utsettes.
- Import tåler ukjente og gamle id-er. Den matcher på `tmdb_id`, deretter tittel og år.
  Filmer som ikke finnes i katalogen beholdes, men vises under «Ukjente filmer».
- **Ferdig når:** eksport fra én nettleser og import i en annen gir identisk
  «Mitt utvalg», og en ødelagt fil gir en forståelig feilmelding.

### Fase 4 – Introduksjon og tekster
- Ved første besøk vises en velkomstboks: hva siden er, at dataene bare lagres i
  denne nettleseren, og at man bør eksportere av og til.
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
  nye kåringer ikke henger fast i hurtigbufferen.
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
| `js/store.js` (ny) | Lagringslaget |
| `js/app.js` | Personlig modus, Knuts utvalg som kilde, redigering, Mine data, påminnelse |
| `index.html` | Laster store.js, «Mine data»-dialog, velkomstboks, manifest-lenke |
| `css/style.css` | Redigerbare felt, dialog, påminnelsesstripe |
| `manifest.webmanifest`, `sw.js`, ikon (nye) | Fase 5 |
| `README.md` | Beskriver vennemodus, eksportformat og opplasting |
| `tools/langtagning.py` | Uendret. (Ev. senere: `import-venn` for å lese en venns fil.) |

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
- Sjekk at lokal modus (file://) fortsatt bruker `movies.js` og køen, og ikke
  personlig lagring.

## Avklaringer før start

1. Skal venner se **Knuts statuser og tanker** («Knuts utvalg»)? *Forslag: ja.*
2. Skal Om-teksten forbli om Knut, med et tillegg for venner? *Forslag: ja, tillegg
   «Dine data».*
3. Trengs filmer utenfor katalogen i første versjon? *Forslag: nei, vent til fase 6.*
4. Har siden HTTPS (CloudFront)? Det avgjør om fase 5 er mulig.

## Rekkefølge og omfang

Fase 1–3 er kjernen, og gir en brukbar vennemodus. Fase 4 er liten, men viktig for
at vennene forstår siden. Fase 5 bør komme før man deler med iPhone-brukere. Fase 6
tas etter behov.
