"use strict";

// Properties data table (Tabulator). Talks to the authed /api endpoints.

// ---------- small helpers ----------
async function api(url, method = "GET", body) {
  const opts = { method, headers: {}, credentials: "same-origin" };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
  return data;
}

let toastTimer = null;
function toast(msg, isError) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = "toast";
  }, 2600);
}

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoney(v) {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : "$" + n.toLocaleString();
}
function fmtDateTime(v) {
  if (!v) return "";
  return String(v).replace("T", " ").slice(0, 16);
}
function fmtDate(v) {
  if (!v) return "";
  return String(v).slice(0, 10);
}

// Field metadata used by the bulk bar and detail modal.
const TEXT_FIELDS = [
  "name",
  "block",
  "lot",
  "owner_name",
  "owner_street",
  "city_state",
  "sale_date",
  "sale_price",
  "notes",
];
const BOOL_FIELDS = ["reviewed", "yiddish", "bobov"];
const SCRAPER_FIELDS = new Set([
  "owner_name",
  "owner_street",
  "city_state",
  "sale_date",
  "sale_price",
  "name",
]);
const FIELD_LABELS = {
  name: "Address (Prop Loc)",
  city_id: "City",
  block: "Block",
  lot: "Lot",
  owner_name: "Owner",
  owner_street: "Owner street",
  city_state: "City / State",
  sale_date: "Sale date",
  sale_price: "Sale price",
  reviewed: "Reviewed",
  yiddish: "Yiddish",
  bobov: "Bobov",
  notes: "Notes",
};

let table = null;
let cities = [];
let cityValues = {};
let searchValue = "";
let selectedCount = 0;

// ---------- build the page chrome ----------
function buildChrome() {
  const email = (document.getElementById("signed-in") || {}).dataset
    ? document.getElementById("signed-in").dataset.email
    : "";

  const top = document.createElement("div");
  top.className = "topbar";
  top.innerHTML =
    '<h1>Properties</h1>' +
    '<input id="search" class="search" type="search" placeholder="Search address, owner, block/lot...">' +
    '<select id="cityFilter" class="search" style="max-width:170px"><option value="">All cities</option></select>' +
    '<button id="needsReview" class="toggle">Needs review</button>' +
    '<button id="refresh" title="Refresh" aria-label="Refresh">\u21bb Refresh</button>' +
    '<span class="spacer"></span>' +
    '<span class="email">' + esc(email) + "</span>" +
    '<form method="post" action="/logout" style="margin:0"><button type="submit">Sign out</button></form>';
  document.body.appendChild(top);

  const bulk = document.createElement("div");
  bulk.className = "bulkbar";
  bulk.id = "bulkbar";
  bulk.innerHTML =
    '<span class="count" id="bulkCount">0 selected</span>' +
    '<span>Set</span>' +
    '<select id="bulkField"></select>' +
    '<span id="bulkValueWrap"></span>' +
    '<button class="primary" id="bulkApplySel">Apply to selected</button>' +
    '<button id="bulkApplyAll">Apply to all matching</button>' +
    '<button id="bulkClear">Clear selection</button>';
  document.body.appendChild(bulk);

  const tableDiv = document.createElement("div");
  tableDiv.id = "table";
  document.body.appendChild(tableDiv);

  const status = document.createElement("div");
  status.className = "statusbar";
  status.id = "status";
  document.body.appendChild(status);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "overlay";
  overlay.innerHTML =
    '<div class="modal">' +
    '<header><h2 id="modalTitle">Property</h2>' +
    '<button id="modalClose">Close</button></header>' +
    '<div class="body" id="modalBody"></div>' +
    '<footer><button id="modalCancel">Cancel</button>' +
    '<button class="primary" id="modalSave">Save changes</button></footer>' +
    "</div>";
  document.body.appendChild(overlay);
}

function setStatus(total) {
  const el = document.getElementById("status");
  if (el) el.textContent = (total == null ? "" : total.toLocaleString() + " properties");
}

function populateCityFilter() {
  const sel = document.getElementById("cityFilter");
  if (!sel) return;
  sel.innerHTML =
    '<option value="">All cities</option>' +
    cities
      .map((c) => `<option value="${esc(c.id)}">${esc(c.name || c.id)}</option>`)
      .join("");
}

// ---------- bulk bar ----------
function buildBulkBar() {
  const fieldSel = document.getElementById("bulkField");
  const editable = ["reviewed", "yiddish", "bobov", "notes", "city_id"].concat(
    TEXT_FIELDS.filter((f) => f !== "notes")
  );
  fieldSel.innerHTML = editable
    .map((f) => `<option value="${f}">${esc(FIELD_LABELS[f] || f)}</option>`)
    .join("");
  fieldSel.addEventListener("change", renderBulkValue);
  renderBulkValue();

  document.getElementById("bulkApplySel").addEventListener("click", () => applyBulk(false));
  document.getElementById("bulkApplyAll").addEventListener("click", () => applyBulk(true));
  document.getElementById("bulkClear").addEventListener("click", () => table.deselectRow());
}

function renderBulkValue() {
  const field = document.getElementById("bulkField").value;
  const wrap = document.getElementById("bulkValueWrap");
  if (BOOL_FIELDS.includes(field)) {
    wrap.innerHTML =
      '<select id="bulkValue"><option value="true">Yes</option><option value="false">No</option></select>';
  } else if (field === "city_id") {
    wrap.innerHTML =
      '<select id="bulkValue">' +
      cities.map((c) => `<option value="${esc(c.id)}">${esc(c.name || c.id)}</option>`).join("") +
      "</select>";
  } else {
    wrap.innerHTML = '<input id="bulkValue" type="text" placeholder="new value">';
  }
}

function updateBulkBar() {
  const bar = document.getElementById("bulkbar");
  document.getElementById("bulkCount").textContent = selectedCount + " selected";
  document.getElementById("bulkApplySel").disabled = selectedCount === 0;
  bar.classList.toggle("show", selectedCount > 0);
}

async function applyBulk(all) {
  const field = document.getElementById("bulkField").value;
  const valueEl = document.getElementById("bulkValue");
  const value = valueEl ? valueEl.value : "";
  const changes = { [field]: value };

  try {
    let body;
    if (all) {
      const filters = table.getFilters(true);
      if (
        !window.confirm(
          "Apply " + (FIELD_LABELS[field] || field) + ' = "' + value +
            '" to ALL rows matching the current filters?'
        )
      )
        return;
      body = { all: true, q: searchValue, filter: filters, changes };
    } else {
      const ids = table.getSelectedData().map((r) => r.id);
      if (!ids.length) return;
      body = { ids, changes };
    }
    const res = await api("/api/properties/bulk", "POST", body);
    toast("Updated " + res.updated + " record(s)");
    table.deselectRow();
    table.replaceData();
  } catch (e) {
    toast(e.message || "Bulk update failed", true);
  }
}

// ---------- detail modal ----------
let modalId = null;

function fieldInput(field, value) {
  if (field === "city_id") {
    const opts = cities
      .map(
        (c) =>
          `<option value="${esc(c.id)}"${c.id === value ? " selected" : ""}>${esc(c.name || c.id)}</option>`
      )
      .join("");
    return `<select data-field="city_id">${opts}</select>`;
  }
  return `<input type="text" data-field="${field}" value="${esc(value)}">`;
}

function readonlyField(label, value) {
  return (
    '<div class="field readonly"><label>' + esc(label) + "</label>" +
    '<div class="value">' + esc(value) + "</div></div>"
  );
}
function editField(field, value, hint) {
  return (
    '<div class="field"><label>' + esc(FIELD_LABELS[field] || field) + "</label>" +
    fieldInput(field, value) +
    (hint ? '<span class="hint">resync may overwrite</span>' : "") +
    "</div>"
  );
}

async function openDetail(id) {
  try {
    const p = await api("/api/properties/" + encodeURIComponent(id));
    modalId = id;
    document.getElementById("modalTitle").textContent = p.name || p.id;

    const manual =
      '<div class="group"><h3>Manual (safe from resync)</h3>' +
      '<div class="checks">' +
      BOOL_FIELDS.map(
        (f) =>
          `<label><input type="checkbox" data-field="${f}"${p[f] ? " checked" : ""}> ${esc(FIELD_LABELS[f])}</label>`
      ).join("") +
      "</div>" +
      '<div class="field" style="margin-top:.7rem"><label>Notes</label>' +
      fieldInput("notes", p.notes) +
      "</div></div>";

    const identity =
      '<div class="group"><h3>Identity</h3><div class="field-grid">' +
      readonlyField("ID", p.id) +
      editField("name", p.name, true) +
      editField("block", p.block) +
      editField("lot", p.lot) +
      editField("city_id", p.city_id) +
      readonlyField("District code", p.district_code) +
      "</div></div>";

    const scraper =
      '<div class="group"><h3>Scraper fields</h3><div class="field-grid">' +
      editField("owner_name", p.owner_name, true) +
      editField("owner_street", p.owner_street, true) +
      editField("city_state", p.city_state, true) +
      editField("sale_date", p.sale_date, true) +
      editField("sale_price", p.sale_price, true) +
      readonlyField("Last run", fmtDateTime(p.last_run_date_time)) +
      "</div></div>";

    const derived =
      '<div class="group"><h3>Derived (read-only)</h3><div class="field-grid">' +
      readonlyField("Date of sale", fmtDate(p.date_of_sale)) +
      readonlyField("Price", fmtMoney(p.price)) +
      readonlyField("Block period", String(p.block_period)) +
      readonlyField("Lot period", String(p.lot_period)) +
      "</div>" +
      (p.url
        ? '<div class="field" style="margin-top:.6rem"><label>Scrape URL</label>' +
          '<div class="value"><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.url) + "</a></div></div>"
        : "") +
      "</div>";

    document.getElementById("modalBody").innerHTML = manual + identity + scraper + derived;
    document.getElementById("overlay").classList.add("show");
  } catch (e) {
    toast(e.message || "Could not load record", true);
  }
}

function closeModal() {
  document.getElementById("overlay").classList.remove("show");
  modalId = null;
}

async function saveModal() {
  if (!modalId) return;
  const body = document.getElementById("modalBody");
  const changes = {};
  body.querySelectorAll("[data-field]").forEach((el) => {
    const f = el.getAttribute("data-field");
    changes[f] = el.type === "checkbox" ? el.checked : el.value;
  });
  try {
    const updated = await api(
      "/api/properties/" + encodeURIComponent(modalId),
      "PATCH",
      changes
    );
    try {
      table.updateData([updated]);
    } catch (_) {
      /* row may not be in the loaded set */
    }
    toast("Saved");
    closeModal();
  } catch (e) {
    toast(e.message || "Save failed", true);
  }
}

// ---------- table ----------
function buildColumns() {
  const boolFilterValues = { "": "(all)", true: "Yes", false: "No" };

  const textCol = (field, title, opts) =>
    Object.assign(
      {
        title,
        field,
        editor: "input",
        headerFilter: "input",
        headerFilterLiveFilter: false,
        minWidth: 110,
      },
      opts || {}
    );
  const boolCol = (field, title) => ({
    title,
    field,
    formatter: "tickCross",
    editor: "tickCross",
    hozAlign: "center",
    width: 95,
    headerFilter: "list",
    headerFilterParams: { values: boolFilterValues, clearable: true },
  });

  return [
    {
      formatter: "rowSelection",
      titleFormatter: "rowSelection",
      hozAlign: "center",
      headerSort: false,
      width: 42,
      cellClick: (e, cell) => cell.getRow().toggleSelect(),
    },
    {
      title: "",
      formatter: () => '<button class="linkbtn">view</button>',
      width: 64,
      hozAlign: "center",
      headerSort: false,
      cellClick: (e, cell) => openDetail(cell.getRow().getData().id),
    },
    boolCol("reviewed", "Reviewed"),
    boolCol("yiddish", "Yiddish"),
    boolCol("bobov", "Bobov"),
    textCol("name", "Address", { minWidth: 170, widthGrow: 2 }),
    textCol("owner_name", "Owner", { minWidth: 170, widthGrow: 2 }),
    textCol("owner_street", "Owner street", { minWidth: 150 }),
    textCol("city_state", "City / State", { minWidth: 140 }),
    {
      title: "Sale date",
      field: "date_of_sale",
      formatter: (cell) => fmtDate(cell.getValue()),
      width: 110,
      headerSort: true,
    },
    {
      title: "Price",
      field: "price",
      formatter: (cell) => fmtMoney(cell.getValue()),
      hozAlign: "right",
      width: 110,
      headerSort: true,
    },
    textCol("notes", "Notes", { minWidth: 140 }),
    {
      title: "Last run",
      field: "last_run_date_time",
      formatter: (cell) => fmtDateTime(cell.getValue()),
      width: 140,
    },
    {
      title: "URL",
      field: "url",
      headerSort: false,
      formatter: "link",
      formatterParams: { label: "open", target: "_blank" },
      width: 70,
    },
  ];
}

function initTable() {
  table = new Tabulator("#table", {
    height: "100%",
    layout: "fitColumns",
    placeholder: "No properties match.",
    index: "id",
    ajaxURL: "/api/properties",
    progressiveLoad: "scroll",
    progressiveLoadDelay: 100,
    progressiveLoadScrollMargin: 300,
    paginationSize: 100,
    filterMode: "remote",
    sortMode: "remote",
    ajaxParams: () => ({ q: searchValue }),
    ajaxResponse: (url, params, response) => {
      setStatus(response.total);
      return response;
    },
    columns: buildColumns(),
    rowFormatter: (row) => {
      const d = row.getData();
      row.getElement().classList.toggle("row-needs-review", d.reviewed === false);
    },
  });

  table.on("cellEdited", async (cell) => {
    const data = cell.getRow().getData();
    const field = cell.getField();
    try {
      const updated = await api(
        "/api/properties/" + encodeURIComponent(data.id),
        "PATCH",
        { [field]: cell.getValue() }
      );
      cell.getRow().update(updated);
      toast("Saved");
    } catch (e) {
      cell.restoreOldValue();
      toast(e.message || "Save failed", true);
    }
  });

  table.on("rowSelectionChanged", (data) => {
    selectedCount = data.length;
    updateBulkBar();
  });

  table.on("dataLoadError", (error) => {
    console.error("data load error", error);
    toast("Could not load properties: " + (error && error.message ? error.message : error), true);
  });
}

// ---------- wire events ----------
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function wireEvents() {
  document.getElementById("search").addEventListener(
    "input",
    debounce((e) => {
      searchValue = e.target.value.trim();
      table.replaceData();
    }, 350)
  );

  const reviewBtn = document.getElementById("needsReview");
  reviewBtn.addEventListener("click", () => {
    const active = reviewBtn.classList.toggle("active");
    table.setHeaderFilterValue("reviewed", active ? "false" : "");
  });

  document.getElementById("cityFilter").addEventListener("change", (e) => {
    const v = e.target.value;
    if (v) table.setFilter("city_id", "=", v);
    else table.clearFilter();
  });

  document.getElementById("refresh").addEventListener("click", () => {
    table.replaceData();
    toast("Refreshed");
  });

  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("modalCancel").addEventListener("click", closeModal);
  document.getElementById("modalSave").addEventListener("click", saveModal);
  document.getElementById("overlay").addEventListener("click", (e) => {
    if (e.target.id === "overlay") closeModal();
  });
}

// ---------- bootstrap ----------
async function main() {
  buildChrome();
  try {
    cities = await api("/api/cities");
  } catch (e) {
    cities = [];
  }
  cityValues = {};
  cities.forEach((c) => {
    cityValues[c.id] = c.name || c.id;
  });
  populateCityFilter();

  buildBulkBar();
  initTable();
  wireEvents();
}

document.addEventListener("DOMContentLoaded", main);
