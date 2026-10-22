// Circulate — Chicago donation & recycling trip planner
// Reads ORGS, LOCATIONS, EVENTS, RECURRING from data.js

(function () {
  "use strict";

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  // ---------- helpers ----------
  function fmtDay(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  function sameDay(a, y, m, d) {
    const [ay, am, ad] = a.split("-").map(Number);
    return ay === y && am === m && ad === d;
  }
  function inSpan(ev, y, m, d) {
    if (!ev.end) return false;
    const [sy, sm, sd] = ev.date.split("-").map(Number);
    const [ey, em, ed] = ev.end.split("-").map(Number);
    const t = new Date(y, m - 1, d).getTime();
    return t >= new Date(sy, sm - 1, sd).getTime() && t <= new Date(ey, em - 1, ed).getTime();
  }
  function catChips(cats) {
    return cats.map((c) => `<span class="chip chip-sm" data-chip="${c}">${CATEGORIES[c].label}</span>`).join("");
  }

  // ---------- recurring events (next 8 months) ----------
  function expandRecurring() {
    const out = [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const DAY_NUM = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    for (let i = 0; i < 8; i++) {
      const base = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const y = base.getFullYear(), m = base.getMonth();
      const last = new Date(y, m + 1, 0).getDate();
      for (const r of RECURRING) {
        const days = [];
        if (r.kind === "first-saturday") {
          // first Saturday of the month
          let d = 1;
          while (new Date(y, m, d).getDay() !== 6) d++;
          days.push(d);
        } else if (r.kind === "last-two-weeks-wed-fri") {
          // last two weeks of the month, Wed/Thu/Fri only
          for (let d = last - 13; d <= last; d++) {
            const dow = new Date(y, m, d).getDay();
            if (dow === 3 || dow === 4 || dow === 5) days.push(d);
          }
        } else if (/^every-(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.test(r.kind)) {
          // same weekday every week (e.g. "every-tuesday")
          const want = DAY_NUM[r.kind.slice(6)];
          for (let d = 1; d <= last; d++) {
            if (new Date(y, m, d).getDay() === want) days.push(d);
          }
        }
        for (const d of days) {
          if (new Date(y, m, d).getTime() < today) continue; // skip dates already past
          const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          out.push({ date: iso, time: r.time, org: r.name, orgId: r.orgId,
                     where: r.where, what: r.what, recurring: true, recNote: r.note });
        }
      }
    }
    return out;
  }
  const ALL_EVENTS = EVENTS.concat(expandRecurring());

  // ---------- state ----------
  let activeCats = new Set();
  let activeOrg = null;
  let view = "map";
  let calY, calM;

  // ---------- list ----------
  function orgMatches(o) {
    if (!activeCats.size) return true;
    return o.cats.some((c) => activeCats.has(c));
  }

  function renderList() {
    const el = $("#org-list");
    el.innerHTML = "";
    ORGS.forEach((o, i) => {
      if (!orgMatches(o)) return;
      const card = document.createElement("article");
      card.className = "org" + (o.id === activeOrg ? " org-active" : "");
      card.dataset.id = o.id;
      card.innerHTML = `
        <header class="org-head">
          <h3>${o.name}</h3>
          <span class="marker-legend marker-${o.shape === "star" ? "star" : "dot"}"></span>
        </header>
        <p class="org-takes">${o.takes.length > 180 ? o.takes.slice(0, 178) + "…" : o.takes}</p>
        <p class="org-line">${o.address}</p>
        <p class="org-line"><strong>${o.hours}</strong></p>
        ${o.notes ? `<p class="org-notes">${o.notes}</p>` : ""}
        <div class="org-chips">${catChips(o.cats)}</div>
        ${o.url ? `<a class="org-link" href="${o.url}" target="_blank" rel="noopener">Open their site ↗</a>` : ""}`;
      card.addEventListener("click", () => focusOrg(o.id));
      el.appendChild(card);
    });
    if (!el.children.length) el.innerHTML = `<p class="empty">Nothing takes that combination — try fewer filters.</p>`;
  }

  // ---------- filters ----------
  function renderFilters() {
    const el = $("#filters");
    el.innerHTML = Object.entries(CATEGORIES)
      .map(([k, v]) => `<button class="chip" data-cat="${k}" aria-pressed="${activeCats.has(k)}">${v.label}</button>`)
      .join("");
    $$(".chip[data-cat]", el).forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.cat;
        activeCats.has(k) ? activeCats.delete(k) : activeCats.add(k);
        renderFilters();
        renderList();
        renderMarkers();
      })
    );
  }

  // ---------- map ----------
  let map, markers = {}, locationMarkers = [];
  const pinSvg = (fill, star) => `
    <svg viewBox="0 0 28 36" width="28" height="36">
      ${star
        ? `<path d="M14 1 C8 10 2 14 2 21 a12 12 0 0 0 24 0 C26 14 20 10 14 1 Z" fill="${fill}" stroke="#20315c" stroke-width="2"/>
           <path d="M14 15 l1.8 3.8 4.2 .5 -3.1 2.9 .8 4.1 -3.7 -2.1 -3.7 2.1 .8 -4.1 -3.1 -2.9 4.2 -.5 Z" fill="#fff"/>`
        : `<path d="M14 1 C8 10 2 14 2 21 a12 12 0 0 0 24 0 C26 14 20 10 14 1 Z" fill="${fill}" stroke="#20315c" stroke-width="2"/>
           <circle cx="14" cy="21" r="5" fill="#fff"/>`}
    </svg>`;

  function orgColor(o) {
    // one color per org: first category color wins
    return CATEGORIES[o.cats[0]].color;
  }

  function initMap() {
    map = L.map("map", { scrollWheelZoom: false }).setView([41.878, -87.65], 11);
    // OpenFreeMap vector basemap, "Liberty" style: free, no API key, no tile
    // limits, built on OpenStreetMap data. Rendered through MapLibre inside
    // Leaflet (maplibre-gl-leaflet bridge, local vendor copies).
    L.maplibreGL({
      style: "https://tiles.openfreemap.org/styles/liberty",
      attributionControl: false,
    }).addTo(map);
    map.attributionControl.addAttribution(
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &middot; <a href="https://openfreemap.org">OpenFreeMap</a>'
    );
    map.on("focus", () => map.scrollWheelZoom.enable());
    map.on("blur", () => map.scrollWheelZoom.disable());

    ORGS.forEach((o) => {
      if (o.noMarker || !o.coords) return;
      const star = o.shape === "star";
      const icon = L.divIcon({
        className: "pin-wrap",
        html: pinSvg(orgColor(o), star),
        iconSize: [28, 36],
        iconAnchor: [14, 34],
        popupAnchor: [0, -30],
      });
      const m = L.marker(o.coords, { icon, title: o.name }).addTo(map);
      m.bindPopup(
        `<strong>${o.name}</strong><br>${o.address}<br><em>${o.hours}</em><br>${o.takes.length > 140 ? o.takes.slice(0, 138) + "…" : o.takes}` +
          (o.url ? `<br><a href="${o.url}" target="_blank" rel="noopener">Their site ↗</a>` : "")
      );
      m.on("click", () => setActiveOrg(o.id));
      markers[o.id] = m;
    });

    // Physical sites (LOCATIONS): one pin per store, drop bin or fridge,
    // colored by the org's first category, shaped by `kind`.
    const siteIcon = (loc, org) => {
      const color = org ? orgColor(org) : "#E03E1F";
      if (loc.kind === "fridge") {
        return L.divIcon({ className: "pin-wrap",
          html: `<svg viewBox="0 0 22 22" width="22" height="22"><circle cx="11" cy="11" r="9" fill="#C2185B" stroke="#20315c" stroke-width="2"/><path d="M7 6 h8 M7 6 v10 M7 11 h8 M15 6 v10" stroke="#fff" stroke-width="1.6" fill="none"/></svg>`,
          iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -12] });
      }
      if (loc.kind === "drop-bin") {
        // small square: a box on the curb
        return L.divIcon({ className: "pin-wrap",
          html: `<svg viewBox="0 0 16 16" width="16" height="16"><rect x="2" y="2" width="12" height="12" rx="2" fill="${color}" stroke="#20315c" stroke-width="2"/><rect x="2" y="6.5" width="12" height="1.6" fill="#fff" opacity="0.85"/></svg>`,
          iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -9] });
      }
      // store (and anything else): the standard teardrop
      return L.divIcon({ className: "pin-wrap", html: pinSvg(color, false),
        iconSize: [28, 36], iconAnchor: [14, 34], popupAnchor: [0, -30] });
    };
    LOCATIONS.forEach((loc, i) => {
      const org = ORGS.find((o) => o.id === loc.orgId);
      const title = org && org.name !== loc.name ? `${org.name} — ${loc.name}` : loc.name;
      const m = L.marker(loc.coords, { icon: siteIcon(loc, org), title }).addTo(map);
      m.bindPopup(
        `<strong>${loc.name}</strong>` +
          (org && org.name !== loc.name ? `<br><em>${org.name}</em>` : "") +
          `<br>${loc.address}` +
          (loc.hours ? `<br><em>${loc.hours}</em>` : "") +
          (loc.notes ? `<br>${loc.notes}` : "") +
          (org && org.url ? `<br><a href="${org.url}" target="_blank" rel="noopener">Their site ↗</a>` : "")
      );
      m.on("click", () => setActiveOrg(loc.orgId));
      markers[`loc-${i}`] = m;
      locationMarkers.push({ orgId: loc.orgId, marker: m });
    });
  }

  function renderMarkers() {
    ORGS.forEach((o) => {
      const m = markers[o.id];
      if (!m) return;
      const show = orgMatches(o);
      if (show && !map.hasLayer(m)) m.addTo(map);
      if (!show && map.hasLayer(m)) map.removeLayer(m);
    });
    // location pins follow their org's filter state
    locationMarkers.forEach(({ orgId, marker }) => {
      const org = ORGS.find((o) => o.id === orgId);
      const show = org ? orgMatches(org) : !activeCats.size;
      if (show && !map.hasLayer(marker)) marker.addTo(map);
      if (!show && map.hasLayer(marker)) map.removeLayer(marker);
    });
  }

  function setActiveOrg(id) {
    activeOrg = id;
    $$(".org").forEach((c) => c.classList.toggle("org-active", c.dataset.id === id));
  }

  function focusOrg(id) {
    setActiveOrg(id);
    const o = ORGS.find((x) => x.id === id);
    if (view !== "map") switchView("map");
    if (o && o.coords && markers[id]) {
      markers[id].openPopup();
      map.flyTo(o.coords, 14, { duration: 0.8 });
    } else {
      // multi-location org: fly to its first location pin
      const first = locationMarkers.find((l) => l.orgId === id);
      if (first) {
        first.marker.openPopup();
        map.flyTo(first.marker.getLatLng(), 14, { duration: 0.8 });
      }
    }
  }

  // ---------- calendar ----------
  function renderCalendar() {
    const grid = $("#cal-grid");
    const first = new Date(calY, calM, 1);
    const startDow = first.getDay();
    const days = new Date(calY, calM + 1, 0).getDate();
    const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    $("#cal-month").textContent = monthLabel;

    let html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < startDow; i++) html += `<div class="cal-cell cal-pad"></div>`;
    for (let d = 1; d <= days; d++) {
      const evs = ALL_EVENTS.filter(
        (e) => sameDay(e.date, calY, calM + 1, d) || inSpan(e, calY, calM + 1, d)
      );
      const today = new Date();
      const isToday = today.getFullYear() === calY && today.getMonth() === calM && today.getDate() === d;
      html += `<div class="cal-cell${isToday ? " cal-today" : ""}">
        <span class="cal-daynum">${d}</span>
        ${evs
          .map((e) => {
            const org = ORGS.find((o) => o.id === e.orgId)
              || ORGS.find((o) => o.name.includes(e.org.split(" ")[0]));
            const color = org ? orgColor(org) : "#E03E1F";
            return `<button class="cal-ev" data-date="${e.date}" style="--ev:${color}" title="${e.org} · ${e.time}">
              <span class="cal-ev-dot"></span>${e.org}</button>`;
          })
          .join("")}
      </div>`;
    }
    grid.innerHTML = html;
    $$(".cal-ev", grid).forEach((b) => b.addEventListener("click", () => showEvent(b.dataset.date)));
    $("#cal-prev").disabled = calY === 2026 && calM === 9;
  }

  function showEvent(date) {
    const evs = ALL_EVENTS.filter((e) => e.date === date);
    const box = $("#cal-detail");
    box.innerHTML = evs
      .map(
        (e) => `<div class="ev-card">
          <h4>${e.org}</h4>
          <p class="ev-when">${fmtDay(e.date)} · ${e.time}</p>
          <p>${e.where}</p>
          <p class="ev-what">${e.what}</p>
          ${e.recurring ? `<p class="ev-note">${e.recNote || "Repeats first Saturday of every month."}</p>` : ""}
        </div>`
      )
      .join("");
    box.hidden = false;
  }

  // ---------- view switching ----------
  function switchView(v) {
    view = v;
    $("#map-view").hidden = v !== "map";
    $("#cal-view").hidden = v !== "cal";
    $("#tab-map").setAttribute("aria-selected", v === "map");
    $("#tab-cal").setAttribute("aria-selected", v === "cal");
    if (v === "map") setTimeout(() => map.invalidateSize(), 50);
    if (v === "cal") renderCalendar();
  }

  // ---------- boot ----------
  const now = new Date();
  calY = now.getFullYear();
  calM = now.getMonth();

  $("#tab-map").addEventListener("click", () => switchView("map"));
  $("#tab-cal").addEventListener("click", () => switchView("cal"));
  $("#cal-prev").addEventListener("click", () => { calM--; if (calM < 0) { calM = 11; calY--; } renderCalendar(); });
  $("#cal-next").addEventListener("click", () => { calM++; if (calM > 11) { calM = 0; calY++; } renderCalendar(); });

  renderFilters();
  renderList();
  initMap();

  // deep link: circulate.html#org=trash-castle
  const hash = location.hash.match(/org=([\w-]+)/);
  if (hash) focusOrg(hash[1]);
})();
