# Circulate

A static map + calendar of Chicago donation & recycling drop-offs: who takes what, when, and where. No build step, no framework, no server needed — plain HTML/CSS/JS that runs anywhere, including GitHub Pages.

## What's here

- **Map view** — every drop-off site pinned (basemap: OpenFreeMap's Liberty style, built on OpenStreetMap data — no API key needed; attribution is shown in the map's corner). Teardrop pins are fixed sites, stars are event-based drop-offs, small squares are drop bins, round pink pins are community fridges. Multi-location orgs (Open Books, WasteShed, Brown Elephant) get one pin per store or bin. Filter chips narrow the map and list by what you're donating. Click a card in the list to fly the map to that org.
- **Calendar view** — dated events by month: Trash Castle drop-off windows, Reduce Waste Chicago pop-ups, the city facility's first-Saturday hours (generated automatically for the next 8 months), and seasonal drives. Click an event for details.

## Run it locally

Just open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```

then visit http://localhost:8000.

## Deploy to GitHub Pages

1. Create a GitHub repository (public works fine; private also serves Pages on paid plans).
2. Push this folder's contents to the repo — `index.html` must sit at the repository root (or in a `/docs` folder if you prefer; adjust the Pages setting to match).
3. In the repo: **Settings → Pages → Source: Deploy from a branch → main / (root) → Save.**
4. The site appears at `https://<your-username>.github.io/<repo-name>/` within a minute or two.

Everything is relative-pathed, so it also works if you serve it from a subfolder.

## Editing the data

Data lives in the **Circulate Airtable base** now — edit it there, then regenerate:

1. Create a personal access token (airtable.com → Account → Developer hub): scope **`data.records:read`**, access to the Circulate base only.
2. Copy `.env.example` to `.env` and paste the token.
3. Edit places, events and locations in Airtable.
4. Run `node build.js` — it rewrites `js/data.js` from the base.
5. Review the diff, commit, push. GitHub Pages updates in a minute or two.

The token never leaves your machine: `.env` is git-ignored, and the site itself never talks to Airtable, so nothing is exposed on GitHub Pages. No dependencies — `build.js` uses Node's built-in fetch (Node 18+).

What goes where in the base:

- **Organizations** — one record per org. Slug becomes the `id`, Categories feed the filter chips, "List only (no pin)" covers citywide orgs with no single address. Coordinates are `[lat, lng]` — nudge the ones marked approximate right in Airtable. Orgs with entries in the Locations table leave coordinates blank; their pins come from the Locations records, one per site.
- **Events** — one-off and date-span events; set "End date" for a multi-day drive (like the string-lights collection).
- **Recurring patterns** — the anchors `app.js` expands ahead of time. The Pattern field's kinds are `first-saturday`, `last-two-weeks-wed-fri`, or `every-<weekday>` (like `every-tuesday`, `every-thursday` — the HCCRF's weekly windows). Adding a brand-new kind means adding a choice there *and* a branch in `expandRecurring()` in `js/app.js`; a new `every-<weekday>` pattern needs no code change.
- **Locations** — one record per physical site: a store, a drop bin, or a community fridge, linked to its organization (the linked field points at the Organizations record). Kind is `Store`, `Drop bin` or `Fridge`; each record gets its own pin on the map, colored by the org's first category and shaped by its kind. Multi-location orgs (Open Books, WasteShed, Brown Elephant, Love Fridge) list their sites here instead of carrying coordinates on the org record.

One hand-edited block remains in `js/data.js`: **`CATEGORIES`** (the filter chip labels + colors). `build.js` preserves it verbatim on every run — adding a category means editing that block and adding the matching choice to the Categories field in Airtable. Note also that regenerating drops inline comments (like the `// approx` coordinate notes); keep those observations in the Airtable Notes field instead.

## Files

```
index.html          page shell
styles.css          all styling
build.js            ← regenerates js/data.js from Airtable (token in .env)
js/data.js          generated data (CATEGORIES block is hand-edited)
js/app.js           rendering, map, calendar logic
js/vendor/leaflet.js        local copy of Leaflet (no CDN, works offline)
css/vendor/leaflet.css
js/vendor/maplibre-gl.js    MapLibre GL (renders the vector basemap)
js/vendor/maplibre-gl-leaflet.js   bridge that puts MapLibre inside Leaflet
css/vendor/maplibre-gl.css
assets/fonts/       Caveat webfont (local)
```

Hours and accepted-item lists were verified October 2026. Lists rotate seasonally — check an organization's own page before a long trip.

## About the map tiles

The basemap is OpenFreeMap's **Liberty** style: free vector tiles built on OpenStreetMap data, with no API key, no tile limits, and no signup. The site loads the style from `https://tiles.openfreemap.org/styles/liberty` and renders it with MapLibre GL inside the Leaflet map (via the `maplibre-gl-leaflet` bridge, both kept as local vendor copies so the site still works offline and from file://). Attribution ("© OpenStreetMap contributors · OpenFreeMap") stays in the map's corner, which is all OpenFreeMap asks.

If you ever want a different look: OpenFreeMap also serves **Positron** and **Bright** styles (swap the URL in `L.maplibreGL(...)` in `js/app.js`, and customize them with Maputnik if you like), or go back to a raster provider like MapTiler or Stadia Maps, which offer free tiers with an API key.
