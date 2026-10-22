#!/usr/bin/env node
// ============================================================
// build.js — regenerate js/data.js from the Circulate Airtable base.
//
// Usage:
//   node build.js                    pull from Airtable (token in .env)
//   node build.js --fixture f.json   offline: transform a saved API dump
//
// The token needs the "data.records:read" scope on this base only.
// It stays in .env, which is git-ignored — never commit it, and the
// site itself never talks to Airtable, so nothing ships to Pages.
//
// CATEGORIES (filter chips) is not in Airtable: build.js preserves the
// block already in js/data.js. Edit labels/colors there by hand.
// ============================================================

"use strict";
const fs = require("fs");
const path = require("path");

const BASE_ID = process.env.AIRTABLE_BASE_ID || "appxqzMbcv09SeeOE";
const DATA_FILE = path.join(__dirname, "js", "data.js");

// Table IDs (stable regardless of how fields are named).
const T = {
  orgs: "tblRkD7bMx87ATFA2",
  events: "tblsdgTj1gEF7Vs3y",
  recurring: "tblz9UblxrubXwl9f",
  locations: "tblyuPRSxfZ356aEF",
};

// Field NAMES, exactly as Airtable's REST API returns them in each record's
// fields object (records are keyed by field name, not ID — the list-tables
// metadata API is the one that speaks in IDs). Renaming a field in Airtable
// therefore needs a matching update here; adding or removing records or
// fields is otherwise safe.
const F = {
  orgs: {
    name: "Name", slug: "Slug",
    takes: "What they take", address: "Address",
    hours: "Hours", notes: "Notes",
    url: "Website", cats: "Categories",
    shape: "Pin shape", listOnly: "List only (no pin)",
    lat: "Latitude", lng: "Longitude",
  },
  events: {
    name: "Event", date: "Date",
    end: "End date", time: "Time",
    where: "Where", what: "What",
  },
  recurring: {
    name: "Name", orgs: "Organization",
    pattern: "Pattern", time: "Time",
    where: "Where", what: "What",
    note: "Note",
  },
  locations: {
    name: "Name", org: "Organization",
    kind: "Kind", address: "Address",
    lat: "Latitude", lng: "Longitude",
    hours: "Hours", notes: "Notes",
  },
};

// Fallback when no js/data.js exists yet (first run).
const DEFAULT_CATEGORIES = `const CATEGORIES = {
  clothes:     { label: "Clothes & textiles", color: "#7C4FB0" },
  electronics: { label: "Electronics & batteries", color: "#E03E1F" },
  plastics:    { label: "Plastics & caps", color: "#1C6FB0" },
  art:         { label: "Art, craft & school supplies", color: "#F0A202" },
  books:       { label: "Books & paper", color: "#2E7D4F" },
  furniture:   { label: "Furniture & household", color: "#8C5A2B" },
  building:    { label: "Building materials", color: "#5B6770" },
  tools:       { label: "Tools", color: "#3A3A3A" },
  food:        { label: "Food", color: "#C2185B" },
  pet:         { label: "Pet supplies", color: "#0E8A8A" },
};`;

// ---------- tiny helpers ----------
function loadToken() {
  if (process.env.AIRTABLE_TOKEN) return process.env.AIRTABLE_TOKEN;
  const envFile = path.join(__dirname, ".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^\s*AIRTABLE_TOKEN\s*=\s*(.+?)\s*$/);
      if (m && !line.trim().startsWith("#")) return m[1];
    }
  }
  console.error(
    "No AIRTABLE_TOKEN found.\n" +
    "Create one at airtable.com (Account → Developer hub, scope: data.records:read,\n" +
    "access to the Circulate base), then put it in a .env file next to build.js:\n" +
    "  AIRTABLE_TOKEN=patXXXXXXXXXXXXXX.secretXXXXXXXX"
  );
  process.exit(1);
}

async function fetchTable(name, id, token) {
  const out = [];
  let offset;
  do {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${id}?pageSize=100` +
      (offset ? `&offset=${encodeURIComponent(offset)}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Airtable ${res.status} on ${name}. ${body.slice(0, 300)}`);
      if (res.status === 401 || res.status === 403) {
        console.error("Check the token: needs data.records:read scope and access to base " + BASE_ID);
      }
      process.exit(1);
    }
    const json = await res.json();
    out.push(...json.records);
    offset = json.offset;
  } while (offset);
  console.log(`  ${name}: ${out.length} records`);
  return out;
}

function preserveCategories() {
  if (fs.existsSync(DATA_FILE)) {
    const m = fs.readFileSync(DATA_FILE, "utf8").match(/const CATEGORIES = \{[\s\S]*?\n\};/);
    if (m) return m[0];
  }
  return DEFAULT_CATEGORIES;
}

// CATEGORIES labels -> keys, so Airtable's category names map back to app keys.
function labelToKeyMap(categoriesBlock) {
  const objSrc = categoriesBlock.slice(categoriesBlock.indexOf("{"), categoriesBlock.lastIndexOf("}") + 1);
  const cats = new Function(`return ${objSrc}`)();
  const map = {};
  for (const [k, v] of Object.entries(cats)) map[v.label] = k;
  return map;
}

// ---------- record -> data.js transforms ----------
function orgToEntry(r, f, catMap) {
  const v = r.fields || {};
  const entry = {
    id: v[f.slug] || r.id,
    name: v[f.name],
    shape: v[f.shape] || "dot",
    cats: (v[f.cats] || []).map((label) => catMap[label]).filter(Boolean),
    address: v[f.address] || "",
    hours: v[f.hours] || "",
    takes: v[f.takes] || "",
  };
  if (v[f.notes]) entry.notes = v[f.notes];
  if (v[f.url]) entry.url = v[f.url];
  if (typeof v[f.lat] === "number" && typeof v[f.lng] === "number") {
    entry.coords = [+v[f.lat].toFixed(4), +v[f.lng].toFixed(4)];
  }
  if (v[f.listOnly]) entry.noMarker = true;
  return entry;
}

function eventToEntry(r, f) {
  const v = r.fields || {};
  return {
    date: v[f.date],
    end: v[f.end] || null,
    time: v[f.time] || "",
    org: v[f.name],
    where: v[f.where] || "",
    what: v[f.what] || "",
  };
}

function recurringToEntry(r, f, orgByRecId) {
  const v = r.fields || {};
  const linked = (v[f.orgs] || [])[0];
  return {
    orgId: linked && orgByRecId[linked] ? orgByRecId[linked].id : null,
    name: v[f.name],
    kind: v[f.pattern] || "first-saturday",
    time: v[f.time] || "",
    where: v[f.where] || "",
    what: v[f.what] || "",
    note: v[f.note] || "",
  };
}

function locationsToEntry(r, f, orgByRecId) {
  const v = r.fields || {};
  const linked = (v[f.org] || [])[0];
  const entry = {
    orgId: linked && orgByRecId[linked] ? orgByRecId[linked].id : null,
    kind: (v[f.kind] || "store").toLowerCase().replace(/\s+/g, "-"),
    name: v[f.name],
    address: v[f.address] || "",
    coords: [+(v[f.lat] || 0).toFixed(4), +(v[f.lng] || 0).toFixed(4)],
  };
  if (v[f.hours]) entry.hours = v[f.hours];
  if (v[f.notes]) entry.notes = v[f.notes];
  return entry;
}

// ---------- output formatting (matches data.js style) ----------
function objLines(entry, indent) {
  const pad = " ".repeat(indent);
  return Object.entries(entry)
    .map(([k, val]) => {
      let rendered;
      if (Array.isArray(val)) rendered = JSON.stringify(val);
      else if (typeof val === "string") rendered = JSON.stringify(val);
      else rendered = String(val);
      return `${pad}  ${k}: ${rendered},`;
    })
    .join("\n");
}

function arrayBlock(entries, indent) {
  if (!entries.length) return "[]";
  const pad = " ".repeat(indent);
  return "[\n" + entries.map((e) => `${pad}  {\n${objLines(e, indent + 2)}\n${pad}  },`).join("\n") + "\n" + pad + "]";
}

// ---------- main ----------
async function main() {
  const fixtureIdx = process.argv.indexOf("--fixture");
  const categoriesBlock = preserveCategories();
  const catMap = labelToKeyMap(categoriesBlock);

  let orgsRecs, eventRecs, recRecs, locationRecs;
  if (fixtureIdx > -1) {
    const fix = JSON.parse(fs.readFileSync(process.argv[fixtureIdx + 1], "utf8"));
    orgsRecs = fix.orgs; eventRecs = fix.events; recRecs = fix.recurring; locationRecs = fix.locations;
    console.log("Using fixture (offline mode)");
  } else {
    const token = loadToken();
    console.log(`Pulling from base ${BASE_ID}…`);
    orgsRecs = await fetchTable("Organizations", T.orgs, token);
    eventRecs = await fetchTable("Events", T.events, token);
    recRecs = await fetchTable("Recurring patterns", T.recurring, token);
    locationRecs = await fetchTable("Locations", T.locations, token);
  }

  const fo = F.orgs;
  const orgs = orgsRecs.map((r) => orgToEntry(r, fo, catMap));
  const orgByRecId = Object.fromEntries(orgsRecs.map((r) => [r.id, orgToEntry(r, fo, catMap)]));
  const events = eventRecs.map((r) => eventToEntry(r, F.events));
  const recurring = recRecs.map((r) => recurringToEntry(r, F.recurring, orgByRecId));
  const locations = locationRecs.map((r) => locationsToEntry(r, F.locations, orgByRecId));

  const file = `// ============================================================
// DATA — GENERATED by build.js from the Circulate Airtable base.
// Edit places and dates in Airtable, then run \`node build.js\`.
// The CATEGORIES block below is the one hand-edited part
// (filter chip labels + colors — build.js preserves it).
// ============================================================

${categoriesBlock}

// Marker shapes: "dot" = fixed drop-off site, "star" = event-based drop-off,
// "fridge" = community fridge. listOnly = shown in the list, no map pin.
const ORGS = ${arrayBlock(orgs, 0)};

// Physical sites: stores, drop bins, fridges — one pin each, linked to its org.
const LOCATIONS = ${arrayBlock(locations, 0)};

// Dated events. Recurring ones are generated in app.js from RECURRING.
const EVENTS = ${arrayBlock(events, 0)};

// Recurring anchors: generated for the next N months in app.js.
// orgId ties each pattern to its ORGS entry (used for pin color + detail).
const RECURRING = ${arrayBlock(recurring, 0)};
`;

  fs.writeFileSync(DATA_FILE, file);
  console.log(`Wrote ${DATA_FILE} — ${orgs.length} orgs, ${events.length} events, ${recurring.length} recurring patterns, ${locations.length} locations.`);
  console.log("Review the diff, then commit js/data.js and push to publish.");
}

main().catch((e) => { console.error(e); process.exit(1); });
