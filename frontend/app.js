const storageKeys = {
  access: "kls_access_token",
  refresh: "kls_refresh_token",
  envoiId: "kls_envoi_id",
};

const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const content = document.getElementById("content");
const logoutBtn = document.getElementById("logoutBtn");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const currentUserEl = document.getElementById("currentUser");
const currentEnvoiEl = document.getElementById("currentEnvoi");
const chooseEnvoiBtn = document.getElementById("chooseEnvoiBtn");
const envoisTabBtn = document.getElementById("envoisTab");

const state = {
  products: [],
  currentUser: null,
  envois: [],
  currentEnvoi: null,
  envoiAdmin: {
    editId: null,
  },
  productFilters: {
    q: "",
    category: "",
    stockMin: "",
    stockMax: "",
    pvuMin: "",
    pvuMax: "",
    pvuState: "",
    lowStockOnly: false,
    lowStockThreshold: "5",
  },
  lastProductImport: null,
  audit: {
    events: [],
    lastId: 0,
    pollHandle: null,
    live: true,
  },
};

function getTokens() {
  return {
    access: localStorage.getItem(storageKeys.access),
    refresh: localStorage.getItem(storageKeys.refresh),
  };
}

function setTokens(access, refresh) {
  localStorage.setItem(storageKeys.access, access);
  localStorage.setItem(storageKeys.refresh, refresh);
}

function clearTokens() {
  localStorage.removeItem(storageKeys.access);
  localStorage.removeItem(storageKeys.refresh);
}

function getSelectedEnvoiId() {
  return localStorage.getItem(storageKeys.envoiId);
}

function setSelectedEnvoiId(id) {
  if (!id) {
    localStorage.removeItem(storageKeys.envoiId);
    return;
  }
  localStorage.setItem(storageKeys.envoiId, String(id));
}

function show(el) {
  el.classList.remove("hidden");
}

function hide(el) {
  el.classList.add("hidden");
}

function renderCurrentUser() {
  const user = state.currentUser;
  if (!currentUserEl) return;
  if (!user) {
    currentUserEl.textContent = "";
    hide(currentUserEl);
    return;
  }

  const label = user.display_name || user.username || "";
  currentUserEl.textContent = label ? `Connecté: ${label}` : "Connecté";
  show(currentUserEl);
}

function isAdminUser() {
  const user = state.currentUser;
  return Boolean(user && (user.is_staff || user.is_superuser));
}

function renderAdminTabs() {
  if (!envoisTabBtn) return;
  if (isAdminUser()) {
    show(envoisTabBtn);
    return;
  }
  hide(envoisTabBtn);
}

function renderCurrentEnvoi() {
  const envoi = state.currentEnvoi;
  if (!currentEnvoiEl || !chooseEnvoiBtn) return;
  if (!envoi) {
    currentEnvoiEl.textContent = "";
    hide(currentEnvoiEl);
    hide(chooseEnvoiBtn);
    return;
  }

  const dates = envoi.date_fin ? `${envoi.date_debut} → ${envoi.date_fin}` : `${envoi.date_debut}`;
  const archivedLabel = envoi.is_archived ? " — archivé" : "";
  currentEnvoiEl.textContent = `Envoi: ${envoi.nom} (${dates})${archivedLabel}`;
  show(currentEnvoiEl);
  show(chooseEnvoiBtn);
}

async function loadCurrentUser() {
  try {
    const res = await apiFetch("/api/me/", { method: "GET" });
    if (!res.ok) throw new Error("Impossible de charger l'utilisateur.");
    state.currentUser = await res.json();
  } catch {
    state.currentUser = null;
  } finally {
    renderCurrentUser();
    renderAdminTabs();
  }
}

async function loadEnvois() {
  const res = await apiFetch("/api/envois/", { method: "GET" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(extractApiErrorMessage(body) || "Chargement des envois impossible.");
  state.envois = Array.isArray(body) ? body : [];
  return state.envois;
}

async function ensureEnvoiSelected() {
  if (state.currentEnvoi) return true;

  const envois = await loadEnvois();
  const savedId = Number(getSelectedEnvoiId() || 0);
  const selected = savedId ? envois.find((e) => Number(e.id) === savedId) : null;
  if (selected) {
    state.currentEnvoi = selected;
    renderCurrentEnvoi();
    return true;
  }

  return false;
}

function setCurrentEnvoi(envoi) {
  state.currentEnvoi = envoi || null;
  setSelectedEnvoiId(state.currentEnvoi?.id || "");
  renderCurrentEnvoi();
  state.products = [];
  state.lastProductImport = null;
  stopAuditPolling();
  state.audit.events = [];
  state.audit.lastId = 0;
}

function initImagePreviewModal() {
  const modal = document.createElement("div");
  modal.id = "imagePreviewModal";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-backdrop" data-modal-close="1"></div>
    <div class="modal-panel" role="dialog" aria-modal="true" aria-label="Aperçu image">
      <div class="modal-header">
        <div id="imagePreviewTitle" class="modal-title"></div>
        <button class="btn btn-secondary" type="button" data-modal-close="1">Fermer</button>
      </div>
      <img id="imagePreviewImg" alt="" />
    </div>
  `;
  document.body.appendChild(modal);

  const titleEl = modal.querySelector("#imagePreviewTitle");
  const imgEl = modal.querySelector("#imagePreviewImg");

  function open(src, title) {
    if (!src) return;
    imgEl.src = src;
    imgEl.alt = title || "Image";
    titleEl.textContent = title || "";
    document.body.classList.add("modal-open");
    show(modal);
  }

  function close() {
    hide(modal);
    document.body.classList.remove("modal-open");
    imgEl.removeAttribute("src");
    imgEl.alt = "";
    titleEl.textContent = "";
  }

  modal.addEventListener("click", (e) => {
    const closeBtn = e.target.closest("[data-modal-close]");
    if (closeBtn) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) close();
  });

  return { open, close };
}

const imagePreview = initImagePreviewModal();

function setLoginError(message) {
  if (!message) {
    hide(loginError);
    loginError.textContent = "";
    return;
  }
  loginError.textContent = message;
  show(loginError);
}

function addEnvoiToPath(path) {
  const envoiId = state.currentEnvoi?.id;
  if (!envoiId) return path;
  if (!path || typeof path !== "string") return path;
  if (!path.startsWith("/api/")) return path;
  if (path.startsWith("/api/auth/")) return path;

  const url = new URL(path, window.location.origin);
  url.searchParams.set("envoi_id", String(envoiId));
  return url.pathname + url.search;
}

async function apiFetch(path, options = {}) {
  path = addEnvoiToPath(path);
  const { access, refresh } = getTokens();
  const headers = new Headers(options.headers || {});

  if (access) {
    headers.set("Authorization", `Bearer ${access}`);
  }

  const isJsonBody =
    options.body && typeof options.body === "string" && !headers.has("Content-Type");
  if (isJsonBody) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, { ...options, headers });

  if (res.status !== 401 || !refresh || path.includes("/api/auth/token/")) {
    return res;
  }

  const refreshed = await fetch("/api/auth/token/refresh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });

  if (!refreshed.ok) {
    clearTokens();
    throw new Error("Session expirée. Merci de vous reconnecter.");
  }

  const data = await refreshed.json();
  setTokens(data.access, data.refresh || refresh);
  return apiFetch(path, options);
}

async function login(username, password) {
  const res = await fetch("/api/auth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Identifiants invalides.");
  }
  const data = await res.json();
  setTokens(data.access, data.refresh);
}

function setActiveTab(route) {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.route === route);
  });
}

function fmt(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeErrorValue(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return normalizeErrorValue(value[0]);
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return null;
    const nested = normalizeErrorValue(value[keys[0]]);
    return nested ? `${keys[0]}: ${nested}` : null;
  }
  return String(value);
}

function extractApiErrorMessage(body) {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") return body;
  if (typeof body !== "object") return String(body);

  const preferredKeys = [
    "detail",
    "non_field_errors",
    "quantite_pretee",
    "quantite",
    "prix_unitaire_cfa",
    "prix_vente_unitaire_cfa",
    "date_retour_effective",
  ];
  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const msg = normalizeErrorValue(body[key]);
      if (msg) return msg;
    }
  }

  const keys = Object.keys(body);
  if (keys.length === 0) return null;
  const key = keys[0];
  const msg = normalizeErrorValue(body[key]);
  if (!msg) return null;
  return `${key}: ${msg}`;
}

function showError(err) {
  const msg = err?.message || String(err);
  alert(msg);
}

function wrapAsync(handler) {
  return (event) => {
    Promise.resolve(handler(event)).catch(showError);
  };
}

function inferFilenameFromContentDisposition(headerValue) {
  if (!headerValue) return null;
  const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(headerValue);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1].replace(/"/g, "").trim());
  } catch {
    return match[1].replace(/"/g, "").trim();
  }
}

async function downloadWithAuth(path, defaultFilename) {
  const res = await apiFetch(path, { method: "GET" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      extractApiErrorMessage(body) || `Téléchargement impossible (HTTP ${res.status}).`
    );
  }

  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition");
  const filename = inferFilenameFromContentDisposition(cd) || defaultFilename || "download";

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function loadProducts() {
  const res = await apiFetch("/api/products/");
  if (!res.ok) throw new Error("Impossible de charger les produits.");
  state.products = await res.json();
}

function productOptionsHtml(selectedId) {
  const opts = state.products
    .map((p) => {
      const selected = selectedId && Number(selectedId) === p.id ? "selected" : "";
      return `<option value="${p.id}" ${selected}>${escapeHtml(p.nom)}</option>`;
    })
    .join("");
  return `<option value="">-- Choisir --</option>${opts}`;
}

async function renderDashboard() {
  setActiveTab("dashboard");
  content.innerHTML = `
    <section class="card">
      <div class="row">
        <div>
          <h2 style="margin: 0 0 6px 0;">Tableau de bord</h2>
          <div class="muted">Vue type Excel (stock + valeurs + dettes).</div>
        </div>
        <div style="display:flex; gap: 10px; align-items: end;">
          <button class="btn" id="exportStockBtn" type="button">Export Stock (.xlsx)</button>
          <button class="btn" id="exportStockCsvBtn" type="button">Export Stock (.csv)</button>
        </div>
        <div style="display:flex; gap: 10px; align-items: end; justify-content: end;">
          <button class="btn" id="exportTransactionsBtn" type="button">Export Transactions (.xlsx)</button>
          <button class="btn" id="exportTransactionsCsvBtn" type="button">Export Transactions (.csv)</button>
        </div>
      </div>
      <div id="dashMeta" class="muted" style="margin-top: 10px;"></div>
      <div id="dashTable" style="margin-top: 12px;"></div>
    </section>
  `;

  document.getElementById("exportStockBtn").addEventListener("click", async () => {
    try {
      await downloadWithAuth("/api/export/stock.xlsx", "stock.xlsx");
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  document.getElementById("exportStockCsvBtn").addEventListener("click", async () => {
    try {
      await downloadWithAuth("/api/export/stock.csv", "stock.csv");
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  document.getElementById("exportTransactionsBtn").addEventListener("click", async () => {
    try {
      await downloadWithAuth("/api/export/transactions.xlsx", "transactions.xlsx");
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  document.getElementById("exportTransactionsCsvBtn").addEventListener("click", async () => {
    try {
      await downloadWithAuth("/api/export/transactions.csv", "transactions.csv");
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  const res = await apiFetch("/api/report/stock/");
  if (!res.ok) throw new Error("Impossible de charger le rapport stock.");
  const report = await res.json();

  const meta = document.getElementById("dashMeta");
  meta.innerHTML = `
    Taux EUR→CFA courant: <code>${fmt(report.taux_euro_cfa) || "non défini"}</code>
    · Vendu = ventes payées + dettes soldées · Dettes = impayées
  `;

  const rows = report.items || [];
  const totals = report.totals || null;
  const totalsRow = totals
    ? `
        <tfoot>
          <tr>
            <th>Total</th>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <th>${escapeHtml(fmt(totals.quantite_achetee))}</th>
            <th>${escapeHtml(fmt(totals.valeur_achetee_euro))}</th>
            <th>${escapeHtml(fmt(totals.valeur_achetee_cfa))}</th>
            <th>${escapeHtml(fmt(totals.quantite_vendue))}</th>
            <th>${escapeHtml(fmt(totals.valeur_vendue_euro))}</th>
            <th>${escapeHtml(fmt(totals.valeur_vendue_cfa))}</th>
            <th>${escapeHtml(fmt(totals.stock_restant))}</th>
            <th>${escapeHtml(fmt(totals.valeur_stock_euro))}</th>
            <th>${escapeHtml(fmt(totals.valeur_stock_cfa))}</th>
            <th>${escapeHtml(fmt(totals.quantite_pretee))}</th>
            <th>${escapeHtml(fmt(totals.valeur_dettes_euro))}</th>
            <th>${escapeHtml(fmt(totals.valeur_dettes_cfa))}</th>
          </tr>
        </tfoot>
      `
    : "";
  const table = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Produit</th>
            <th>Caractéristiques</th>
            <th>PAU (€)</th>
            <th>PAU (CFA)</th>
            <th>PVU (CFA)</th>
            <th>PVU (€)</th>
            <th>Qté achetée</th>
            <th>Valeur achetée (€)</th>
            <th>Valeur achetée (CFA)</th>
            <th>Qté vendue (payée)</th>
            <th>Valeur vendue (€)</th>
            <th>Valeur vendue (CFA)</th>
            <th>Stock restant</th>
            <th>Valeur stock (€)</th>
            <th>Valeur stock (CFA)</th>
            <th>Dettes clients (qté en cours)</th>
            <th>Valeur dettes (€)</th>
            <th>Valeur dettes (CFA)</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((r) => {
              const pill = r.is_low_stock
                ? `<span class="pill warn">Stock bas</span>`
                : `<span class="pill ok">OK</span>`;
              const imgSrc = r.image || r.image_url || "";
              const nameCell = `
                <div class="prod-cell">
                  ${
                    imgSrc
                      ? `<button class="img-btn" type="button" title="Voir l'image en grand" data-image-src="${escapeAttr(
                          imgSrc
                        )}" data-image-alt="image ${escapeAttr(r.nom)}">
                           <img class="thumb-sm" src="${escapeAttr(
                             imgSrc
                           )}" alt="image ${escapeAttr(r.nom)}" />
                         </button>`
                      : ""
                  }
                  <div>
                    <div>${escapeHtml(r.nom)}</div>
                    <div>${pill}</div>
                  </div>
                </div>
              `;
              return `
                <tr>
                  <td>${nameCell}</td>
                  <td class="muted">${escapeHtml(r.caracteristiques || "")}</td>
                  <td>${escapeHtml(fmt(r.pau_euro))}</td>
                  <td>${escapeHtml(fmt(r.pau_cfa))}</td>
                  <td>${escapeHtml(fmt(r.pvu_cfa))}</td>
                  <td>${escapeHtml(fmt(r.pvu_euro))}</td>
                  <td>${escapeHtml(fmt(r.quantite_achetee))}</td>
                  <td>${escapeHtml(fmt(r.valeur_achetee_euro))}</td>
                  <td>${escapeHtml(fmt(r.valeur_achetee_cfa))}</td>
                  <td>${escapeHtml(fmt(r.quantite_vendue))}</td>
                  <td>${escapeHtml(fmt(r.valeur_vendue_euro))}</td>
                  <td>${escapeHtml(fmt(r.valeur_vendue_cfa))}</td>
                  <td>${escapeHtml(fmt(r.stock_restant))}</td>
                  <td>${escapeHtml(fmt(r.valeur_stock_euro))}</td>
                  <td>${escapeHtml(fmt(r.valeur_stock_cfa))}</td>
                  <td>${escapeHtml(fmt(r.quantite_pretee))}</td>
                  <td>${escapeHtml(fmt(r.valeur_dettes_euro))}</td>
                  <td>${escapeHtml(fmt(r.valeur_dettes_cfa))}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
        ${totalsRow}
      </table>
    </div>
  `;

  document.getElementById("dashTable").innerHTML = table;
}

async function renderReports() {
  setActiveTab("reports");

  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear; y >= currentYear - 4; y--) years.push(y);

  content.innerHTML = `
    <section class="card">
      <div class="row">
        <div>
          <h2 style="margin: 0 0 6px 0;">Rapports mensuels</h2>
          <div class="muted">Achats / ventes / marge brute (CFA) + dettes.</div>
        </div>
        <div>
          <label>
            <span>Année</span>
            <select id="reportYear">
              ${years.map((y) => `<option value="${y}">${y}</option>`).join("")}
            </select>
          </label>
        </div>
        <div style="display: flex; align-items: end; gap: 10px; justify-content: end;">
          <button class="btn" id="reportRefreshBtn" type="button">Actualiser</button>
          <button class="btn" id="reportExportXlsxBtn" type="button">Export (.xlsx)</button>
          <button class="btn" id="reportExportCsvBtn" type="button">Export (.csv)</button>
        </div>
      </div>

      <div id="reportMeta" class="muted" style="margin-top: 10px;"></div>
      <div id="reportTable" style="margin-top: 12px;"></div>
    </section>
  `;

  const yearSelect = document.getElementById("reportYear");
  const refreshBtn = document.getElementById("reportRefreshBtn");
  const exportXlsxBtn = document.getElementById("reportExportXlsxBtn");
  const exportCsvBtn = document.getElementById("reportExportCsvBtn");
  const reportMeta = document.getElementById("reportMeta");
  const reportTable = document.getElementById("reportTable");

  async function load() {
    const year = yearSelect.value;
    const res = await apiFetch(`/api/report/monthly/?year=${encodeURIComponent(year)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(extractApiErrorMessage(body) || "Chargement du rapport impossible.");

    reportMeta.innerHTML = `
      Taux EUR→CFA courant: <code>${fmt(body.taux_euro_cfa) || "non défini"}</code>
      • Totaux: achats <code>${fmt(body.totals.achats_total_cfa)} CFA</code>, ventes <code>${fmt(body.totals.ventes_total_cfa)} CFA</code>, marge <code>${fmt(body.totals.marge_brute_cfa)} CFA</code>
    `;

    const rows = body.months || [];
    reportTable.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mois</th>
              <th>Achats (qté)</th>
              <th>Achats (€)</th>
              <th>Achats (CFA)</th>
              <th>Ventes payées (qté)</th>
              <th>Ventes payées (€)</th>
              <th>Ventes payées (CFA)</th>
              <th>Marge brute (CFA)</th>
              <th>Dettes créées (qté)</th>
              <th>Dettes soldées (qté)</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((r) => {
                return `
                  <tr>
                    <td>${escapeHtml(fmt(r.month))}</td>
                    <td>${escapeHtml(fmt(r.achats_quantite))}</td>
                    <td>${escapeHtml(fmt(r.achats_total_euro))}</td>
                    <td>${escapeHtml(fmt(r.achats_total_cfa))}</td>
                    <td>${escapeHtml(fmt(r.ventes_quantite))}</td>
                    <td>${escapeHtml(fmt(r.ventes_total_euro))}</td>
                    <td>${escapeHtml(fmt(r.ventes_total_cfa))}</td>
                    <td>${escapeHtml(fmt(r.marge_brute_cfa))}</td>
                    <td>${escapeHtml(fmt(r.prets_quantite))}</td>
                    <td>${escapeHtml(fmt(r.retours_quantite))}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  refreshBtn.addEventListener("click", wrapAsync(load));
  yearSelect.addEventListener("change", wrapAsync(load));
  exportXlsxBtn.addEventListener(
    "click",
    wrapAsync(async () => {
      const year = yearSelect.value;
      await downloadWithAuth(
        `/api/export/monthly.xlsx?year=${encodeURIComponent(year)}`,
        `monthly_${year}.xlsx`
      );
    })
  );
  exportCsvBtn.addEventListener(
    "click",
    wrapAsync(async () => {
      const year = yearSelect.value;
      await downloadWithAuth(
        `/api/export/monthly.csv?year=${encodeURIComponent(year)}`,
        `monthly_${year}.csv`
      );
    })
  );
  await load();
}

async function renderProducts() {
  setActiveTab("products");
  await loadProducts();

  content.innerHTML = `
    <section class="card">
      <h2 style="margin: 0 0 6px 0;">Produits</h2>
      <div class="muted">CRUD + import Excel.</div>

      <div class="row" style="margin-top: 12px;">
        <form id="productCreateForm" class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <h3 style="margin: 0 0 10px 0;">Ajouter</h3>
          <label><span>Nom</span><input name="nom" required /></label>
          <label><span>Catégorie</span><input name="categorie" /></label>
          <label><span>PAU (€)</span><input name="prix_achat_unitaire_euro" type="number" step="0.01" /></label>
          <label><span>PVU (CFA)</span><input name="prix_vente_unitaire_cfa" type="number" step="0.01" required /></label>
          <label style="grid-column: 1 / -1;"><span>Image</span><input name="image" type="file" accept="image/*" /></label>
          <label style="grid-column: 1 / -1;">
            <span>Caractéristiques</span>
            <textarea name="caracteristiques"></textarea>
          </label>
          <button class="btn btn-primary" type="submit">Créer</button>
        </form>

        <form id="productImportForm" class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <h3 style="margin: 0 0 10px 0;">Import Excel</h3>
          <div class="muted">Colonnes reconnues (produits): Nom/Produit, Catégorie, Caractéristiques, PAU (€), PVU (CFA), Quantité (achetée/stock initial). Images: soit insérées dans Excel (colonne "Image"), soit un zip d'images + dans la colonne "Image" le nom du fichier (ex: photo1.jpg). Les URLs sont acceptées seulement si c'est une vraie URL http(s) (colonne Image URL).</div>
          <label style="margin-top: 10px;">
            <span>Fichier (.xlsx)</span>
            <input name="file" type="file" accept=".xlsx,.xlsm" required />
          </label>
          <label>
            <span>Images (.zip) (optionnel)</span>
            <input name="images_zip" type="file" accept=".zip" />
          </label>
          <label>
            <span>Mode</span>
            <select name="mode">
              <option value="append">Ajouter (1 ligne = 1 produit)</option>
              <option value="upsert">Mettre à jour si existe (même nom)</option>
            </select>
          </label>
          <button class="btn" type="submit">Importer</button>
          <div id="importResult" class="muted" style="margin-top: 10px;"></div>
        </form>

        <div class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <div class="row" style="margin: 0 0 10px 0;">
            <h3 style="margin: 0;">Liste</h3>
            <button class="btn btn-danger" id="purgeProductsBtn" type="button">
              Supprimer tous les produits
            </button>
          </div>
          <div id="productEditPanel" class="hidden" style="margin-bottom: 10px;"></div>
          <div id="productFilters"></div>
          <div id="productFilterCount" class="muted" style="margin-top: 8px;"></div>
          <div id="productsTable" style="margin-top: 10px;"></div>
        </div>
      </div>
    </section>
  `;

  const productsTable = document.getElementById("productsTable");
  const productEditPanel = document.getElementById("productEditPanel");
  const productFilters = document.getElementById("productFilters");
  const productFilterCount = document.getElementById("productFilterCount");
  const importResult = document.getElementById("importResult");

  function formatDrfErrors(errorsObj) {
    if (!errorsObj || typeof errorsObj !== "object") return "";
    return Object.entries(errorsObj)
      .map(([key, val]) => {
        if (Array.isArray(val)) return `${key}: ${val.join(", ")}`;
        return `${key}: ${String(val)}`;
      })
      .join(" | ");
  }

  function renderImportResult(body) {
    if (!body) {
      importResult.textContent = "";
      return;
    }

    const errors = Array.isArray(body.errors) ? body.errors : [];
    const mergedInfo =
      body.merged && Number(body.merged) > 0 ? `, fusionnés: ${fmt(body.merged)}` : "";
    const summary = `Import terminé (mode=${fmt(body.mode) || "append"}). Créés: ${fmt(
      body.created
    )}, mis à jour: ${fmt(body.updated)}${mergedInfo}, ignorés: ${fmt(
      body.skipped
    )}, erreurs: ${fmt(errors.length)}.`;

    const imagesImported = Number(body.images_imported || 0);
    const imagesFound = Number(body.images_found || 0);
    const imagesFoundXml = Number(body.images_found_drawing_xml || 0);
    const imagesFoundOpenpyxl = Number(body.images_found_openpyxl || 0);
    const zipFiles = Number(body.images_zip_files || 0);
    const imageRowsPreview = Array.isArray(body.images_rows_preview) ? body.images_rows_preview : [];
    const detected =
      body.detected_columns && typeof body.detected_columns === "object" ? body.detected_columns : {};
    const detectedQty = detected.quantite || "";
    const detectedImg = detected.image || "";
    const detectedImgUrl = detected.image_url || "";

    const metaBits = [];
    if (imagesImported > 0) metaBits.push(`Images importées: ${imagesImported}`);
    if (imagesFound > 0) metaBits.push(`Images trouvées dans Excel: ${imagesFound}`);
    if (imagesFoundXml > 0) metaBits.push(`Images trouvées (XML): ${imagesFoundXml}`);
    if (imagesFoundOpenpyxl > 0) metaBits.push(`Images trouvées (openpyxl): ${imagesFoundOpenpyxl}`);
    if (imageRowsPreview.length > 0) metaBits.push(`Lignes images: ${imageRowsPreview.join(", ")}`);
    if (zipFiles > 0) metaBits.push(`Fichiers images dans zip: ${zipFiles}`);
    if (detectedQty || detectedImg) {
      metaBits.push(
        `Colonnes détectées: quantité=${detectedQty || "—"}, image=${detectedImg || "—"}, image_url=${
          detectedImgUrl || "—"
        }`
      );
    }
    const metaHtml =
      metaBits.length === 0
        ? ""
        : `<div class="muted" style="margin-top: 4px;">${escapeHtml(metaBits.join(" · "))}</div>`;

    const headersList = Array.isArray(body.headers) ? body.headers : [];
    const previewHeaders = headersList
      .slice(0, 8)
      .map((h) => `${h.original || ""} → ${h.normalized || ""}`)
      .filter((s) => s.trim() !== "")
      .join(" | ");
    const headersHtml =
      previewHeaders === ""
        ? ""
        : `<div class="muted" style="margin-top: 4px;">Headers: ${escapeHtml(previewHeaders)}${
            headersList.length > 8 ? " …" : ""
          }</div>`;

    const maxErrors = 12;
    const errorsHtml =
      errors.length === 0
        ? ""
        : `<div style="margin-top: 8px;">
             <div class="muted" style="margin-bottom: 6px;">Erreurs (premières ${Math.min(
               errors.length,
               maxErrors
             )}) :</div>
             <ul style="margin: 0; padding-left: 18px;">
               ${errors
                 .slice(0, maxErrors)
                 .map((err) => {
                   const row = err?.row ? `Ligne ${err.row}` : "Ligne ?";
                   if (err?.message) {
                     const field = err?.field ? `${err.field}: ` : "";
                     return `<li>${escapeHtml(`${row} — ${field}${err.message}`)}</li>`;
                   }
                   if (err?.errors) {
                     return `<li>${escapeHtml(`${row} — ${formatDrfErrors(err.errors)}`)}</li>`;
                   }
                   return `<li>${escapeHtml(`${row} — ${JSON.stringify(err)}`)}</li>`;
                 })
                 .join("")}
             </ul>
           </div>`;

    importResult.innerHTML = `<div>${escapeHtml(summary)}</div>${metaHtml}${headersHtml}${errorsHtml}`;
  }

  if (state.lastProductImport) {
    renderImportResult(state.lastProductImport);
  }

  const distinctCategories = Array.from(
    new Set(
      state.products
        .map((p) => (p.categorie || "").trim())
        .filter((c) => c !== "")
    )
  ).sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));

  const filters = state.productFilters;

  productFilters.innerHTML = `
    <div class="filters">
      <label style="grid-column: 1 / -1;">
        <span>Recherche</span>
        <input id="pfQuery" placeholder="Nom, catégorie, caractéristiques..." />
      </label>
      <label>
        <span>Catégorie</span>
        <select id="pfCategory">
          <option value="">Toutes</option>
          ${distinctCategories
            .map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`)
            .join("")}
        </select>
      </label>
      <label>
        <span>Stock min</span>
        <input id="pfStockMin" type="number" min="0" step="1" />
      </label>
      <label>
        <span>Stock max</span>
        <input id="pfStockMax" type="number" min="0" step="1" />
      </label>
      <label>
        <span>PVU min (CFA)</span>
        <input id="pfPvuMin" type="number" min="0" step="0.01" />
      </label>
      <label>
        <span>PVU max (CFA)</span>
        <input id="pfPvuMax" type="number" min="0" step="0.01" />
      </label>
      <label>
        <span>PVU</span>
        <select id="pfPvuState">
          <option value="">Tous</option>
          <option value="present">Renseigné</option>
          <option value="missing">Manquant</option>
        </select>
      </label>
      <label>
        <span>Stock bas</span>
        <select id="pfLowStockOnly">
          <option value="">Tous</option>
          <option value="1">Uniquement</option>
        </select>
      </label>
      <label>
        <span>Seuil stock bas</span>
        <input id="pfLowStockThreshold" type="number" min="0" step="1" />
      </label>
      <div class="filters-actions">
        <button class="btn" id="pfReset" type="button">Réinitialiser</button>
      </div>
    </div>
  `;

  function parseNumberOrNull(raw) {
    if (raw === null || raw === undefined) return null;
    const v = String(raw).trim();
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function getFilteredProducts() {
    const q = (filters.q || "").trim().toLowerCase();
    const category = (filters.category || "").trim();
    const stockMin = parseNumberOrNull(filters.stockMin);
    const stockMax = parseNumberOrNull(filters.stockMax);
    const pvuMin = parseNumberOrNull(filters.pvuMin);
    const pvuMax = parseNumberOrNull(filters.pvuMax);
    const threshold = Math.max(parseNumberOrNull(filters.lowStockThreshold) ?? 0, 0);

    return state.products.filter((p) => {
      const name = (p.nom || "").toLowerCase();
      const cat = (p.categorie || "").toLowerCase();
      const carac = (p.caracteristiques || "").toLowerCase();

      if (q && !(name.includes(q) || cat.includes(q) || carac.includes(q))) {
        return false;
      }

      if (category && (p.categorie || "").trim() !== category) {
        return false;
      }

      const stock = p.stock ? Number(p.stock.quantite_restante) : 0;
      if (stockMin !== null && stock < stockMin) return false;
      if (stockMax !== null && stock > stockMax) return false;

      const pvuRaw = p.prix_vente_unitaire_cfa;
      const pvu =
        pvuRaw === null || pvuRaw === undefined || pvuRaw === "" ? null : Number(pvuRaw);

      if (filters.pvuState === "missing" && pvu !== null && Number.isFinite(pvu)) return false;
      if (filters.pvuState === "present" && (pvu === null || !Number.isFinite(pvu)))
        return false;

      if (pvuMin !== null) {
        if (pvu === null || !Number.isFinite(pvu) || pvu < pvuMin) return false;
      }
      if (pvuMax !== null) {
        if (pvu === null || !Number.isFinite(pvu) || pvu > pvuMax) return false;
      }

      if (filters.lowStockOnly && stock > threshold) return false;

      return true;
    });
  }

  function renderProductsTable(list) {
    productsTable.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Catégorie</th>
              <th>Image</th>
              <th>PAU (€)</th>
              <th>PVU (CFA)</th>
              <th>Qté achetée</th>
              <th>Stock restant</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              list.length === 0
                ? `<tr><td colspan="8" class="muted">Aucun produit ne correspond aux filtres.</td></tr>`
                : list
                    .map((p) => {
                      const imgSrc = productImageSrc(p);
                      const stockInitial = p.stock ? p.stock.quantite_initial : 0;
                      const stockRemaining = p.stock ? p.stock.quantite_restante : 0;
                      return `
                        <tr>
                          <td>${escapeHtml(p.nom)}</td>
                          <td class="muted">${escapeHtml(p.categorie || "")}</td>
                          <td>${
                            imgSrc
                              ? `<button class="img-btn" type="button" title="Voir l'image en grand" data-image-src="${escapeAttr(
                                  imgSrc
                                )}" data-image-alt="image ${escapeAttr(p.nom)}">
                                   <img class="thumb" src="${escapeAttr(
                                     imgSrc
                                   )}" alt="image ${escapeAttr(p.nom)}" />
                                 </button>`
                              : ""
                          }</td>
                          <td>${escapeHtml(fmt(p.prix_achat_unitaire_euro))}</td>
                          <td>${escapeHtml(fmt(p.prix_vente_unitaire_cfa))}</td>
                          <td>${escapeHtml(fmt(stockInitial))}</td>
                          <td>${escapeHtml(fmt(stockRemaining))}</td>
                          <td>
                            <div style="display:flex; gap:8px; flex-wrap: wrap;">
                              <button class="btn" data-edit-product="${p.id}" type="button">Modifier</button>
                              <button class="btn btn-danger" data-delete-product="${p.id}" type="button">Supprimer</button>
                            </div>
                          </td>
                        </tr>
                      `;
                    })
                    .join("")
            }
          </tbody>
        </table>
      </div>
    `;
  }

  function renderTable() {
    const list = getFilteredProducts();
    productFilterCount.textContent = `${list.length} / ${state.products.length} produits`;
    renderProductsTable(list);
  }

  const pfQuery = document.getElementById("pfQuery");
  const pfCategory = document.getElementById("pfCategory");
  const pfStockMin = document.getElementById("pfStockMin");
  const pfStockMax = document.getElementById("pfStockMax");
  const pfPvuMin = document.getElementById("pfPvuMin");
  const pfPvuMax = document.getElementById("pfPvuMax");
  const pfPvuState = document.getElementById("pfPvuState");
  const pfLowStockOnly = document.getElementById("pfLowStockOnly");
  const pfLowStockThreshold = document.getElementById("pfLowStockThreshold");

  function resetFilters() {
    Object.assign(filters, {
      q: "",
      category: "",
      stockMin: "",
      stockMax: "",
      pvuMin: "",
      pvuMax: "",
      pvuState: "",
      lowStockOnly: false,
      lowStockThreshold: "5",
    });

    pfQuery.value = filters.q;
    pfCategory.value = filters.category;
    pfStockMin.value = filters.stockMin;
    pfStockMax.value = filters.stockMax;
    pfPvuMin.value = filters.pvuMin;
    pfPvuMax.value = filters.pvuMax;
    pfPvuState.value = filters.pvuState;
    pfLowStockOnly.value = filters.lowStockOnly ? "1" : "";
    pfLowStockThreshold.value = filters.lowStockThreshold;
  }

  pfQuery.value = filters.q;
  pfCategory.value = filters.category;
  pfStockMin.value = filters.stockMin;
  pfStockMax.value = filters.stockMax;
  pfPvuMin.value = filters.pvuMin;
  pfPvuMax.value = filters.pvuMax;
  pfPvuState.value = filters.pvuState;
  pfLowStockOnly.value = filters.lowStockOnly ? "1" : "";
  pfLowStockThreshold.value = filters.lowStockThreshold;
  if (pfCategory.value !== filters.category) filters.category = pfCategory.value;
  if (pfPvuState.value !== filters.pvuState) filters.pvuState = pfPvuState.value;

  pfQuery.addEventListener("input", () => {
    filters.q = pfQuery.value;
    renderTable();
  });
  pfCategory.addEventListener("change", () => {
    filters.category = pfCategory.value;
    renderTable();
  });
  pfStockMin.addEventListener("input", () => {
    filters.stockMin = pfStockMin.value;
    renderTable();
  });
  pfStockMax.addEventListener("input", () => {
    filters.stockMax = pfStockMax.value;
    renderTable();
  });
  pfPvuMin.addEventListener("input", () => {
    filters.pvuMin = pfPvuMin.value;
    renderTable();
  });
  pfPvuMax.addEventListener("input", () => {
    filters.pvuMax = pfPvuMax.value;
    renderTable();
  });
  pfPvuState.addEventListener("change", () => {
    filters.pvuState = pfPvuState.value;
    renderTable();
  });
  pfLowStockOnly.addEventListener("change", () => {
    filters.lowStockOnly = pfLowStockOnly.value === "1";
    renderTable();
  });
  pfLowStockThreshold.addEventListener("input", () => {
    filters.lowStockThreshold = pfLowStockThreshold.value;
    renderTable();
  });
  document.getElementById("pfReset").addEventListener("click", () => {
    resetFilters();
    renderTable();
  });

  renderTable();

  function closeProductEdit() {
    productEditPanel.innerHTML = "";
    hide(productEditPanel);
  }

  function productImageSrc(product) {
    if (product.image) return product.image;
    if (product.image_url) return product.image_url;
    return "";
  }

  function openProductEdit(product) {
    const imgSrc = productImageSrc(product);
    const stockInitial = product.stock ? product.stock.quantite_initial : 0;
    const stockRemaining = product.stock ? product.stock.quantite_restante : 0;
    productEditPanel.innerHTML = `
      <form id="productEditForm" class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
        <div style="display:flex; align-items:center; justify-content: space-between; gap: 10px;">
          <h3 style="margin: 0;">Modifier</h3>
          <button class="btn" id="productEditCancel" type="button">Fermer</button>
        </div>

        <div class="muted" style="margin-top: 6px;">
          Stock: acheté <b>${escapeHtml(fmt(stockInitial))}</b> · restant <b>${escapeHtml(
            fmt(stockRemaining)
          )}</b>
        </div>

        <div class="grid" style="margin-top: 10px;">
          <input type="hidden" name="id" value="${escapeHtml(String(product.id))}" />
          <label><span>Nom</span><input name="nom" required value="${escapeHtml(product.nom)}" /></label>
          <label><span>Catégorie</span><input name="categorie" value="${escapeHtml(
            product.categorie || ""
          )}" /></label>
          <label><span>PAU (€)</span><input name="prix_achat_unitaire_euro" type="number" step="0.01" value="${escapeHtml(
            fmt(product.prix_achat_unitaire_euro)
          )}" /></label>
          <label><span>PVU (CFA)</span><input name="prix_vente_unitaire_cfa" type="number" step="0.01" value="${escapeHtml(
            fmt(product.prix_vente_unitaire_cfa)
          )}" /></label>
          <label style="grid-column: 1 / -1;">
            <span>Image</span>
            ${
              imgSrc
                ? `<div style="margin-top:6px;">
                     <button class="img-btn" type="button" title="Voir l'image en grand" data-image-src="${escapeAttr(
                       imgSrc
                     )}" data-image-alt="image ${escapeAttr(product.nom)}">
                       <img class="thumb-lg" src="${escapeAttr(
                         imgSrc
                       )}" alt="image ${escapeAttr(product.nom)}" />
                     </button>
                   </div>`
                : ""
            }
            <input name="image" type="file" accept="image/*" style="margin-top: 8px;" />
          </label>
          <label style="grid-column: 1 / -1;">
            <span>Caractéristiques</span>
            <textarea name="caracteristiques">${escapeHtml(
              product.caracteristiques || ""
            )}</textarea>
          </label>
          <label>
            <span>Ajouter quantité achetée</span>
            <input name="achat_quantite" type="number" min="1" step="1" />
          </label>
          <div class="muted" style="display:flex; align-items:end;">
            Ajoute une transaction d'achat et augmente le stock.
          </div>
        </div>

        <button class="btn btn-primary" type="submit">Enregistrer</button>
      </form>
    `;
    show(productEditPanel);

    document.getElementById("productEditCancel").addEventListener("click", closeProductEdit);

    document.getElementById("productEditForm").addEventListener(
      "submit",
        wrapAsync(async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const id = fd.get("id");
          const achatQuantiteRaw = fd.get("achat_quantite");
          fd.delete("id");
          fd.delete("achat_quantite");

          if (fd.get("prix_achat_unitaire_euro") === "") fd.delete("prix_achat_unitaire_euro");
          if (fd.get("prix_vente_unitaire_cfa") === "") fd.delete("prix_vente_unitaire_cfa");
          const image = fd.get("image");
          if (image && image.name === "") fd.delete("image");

          const res = await apiFetch(`/api/products/${id}/`, { method: "PATCH", body: fd });
          const body = await res.json().catch(() => null);
          if (!res.ok) throw new Error(extractApiErrorMessage(body) || "Mise à jour impossible.");

          if (achatQuantiteRaw && String(achatQuantiteRaw).trim() !== "") {
            const achatQuantite = Number(achatQuantiteRaw);
            if (!Number.isInteger(achatQuantite) || achatQuantite <= 0) {
              throw new Error("Quantité achetée invalide.");
            }

            const existing = state.products.find((p) => p.id === Number(id));
            const prixAchatEuro =
              fd.get("prix_achat_unitaire_euro") ||
              (existing ? existing.prix_achat_unitaire_euro : null);

            const txPayload = {
              produit: Number(id),
              type_transaction: "achat",
            quantite: achatQuantite,
          };
          if (prixAchatEuro) txPayload.prix_unitaire_euro = prixAchatEuro;

          const txRes = await apiFetch("/api/transactions/", {
            method: "POST",
            body: JSON.stringify(txPayload),
          });
          const txBody = await txRes.json().catch(() => null);
          if (!txRes.ok) {
            throw new Error(extractApiErrorMessage(txBody) || "Achat impossible.");
          }
        }

        await renderProducts();
      })
    );
  }

  document.getElementById("productCreateForm").addEventListener(
    "submit",
    wrapAsync(async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (fd.get("prix_achat_unitaire_euro") === "") fd.delete("prix_achat_unitaire_euro");
    if (fd.get("categorie") === "") fd.delete("categorie");
    if (fd.get("caracteristiques") === "") fd.delete("caracteristiques");
    const image = fd.get("image");
    if (image && image.name === "") fd.delete("image");

    const res = await apiFetch("/api/products/", { method: "POST", body: fd });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(extractApiErrorMessage(body) || "Création impossible.");
    }
    await renderProducts();
    })
  );

  document.getElementById("productImportForm").addEventListener(
    "submit",
    wrapAsync(async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      const mode = String(fd.get("mode") || "append");
      fd.delete("mode");
      const res = await apiFetch(`/api/products/import/?mode=${encodeURIComponent(mode)}`, {
        method: "POST",
        body: fd,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(extractApiErrorMessage(body) || "Import impossible.");
      state.lastProductImport = body;
      await renderProducts();
    })
  );

  productsTable.addEventListener(
    "click",
    wrapAsync(async (e) => {
      const editBtn = e.target.closest("[data-edit-product]");
      if (editBtn) {
        const id = Number(editBtn.getAttribute("data-edit-product"));
        const product = state.products.find((p) => p.id === id);
        if (!product) throw new Error("Produit introuvable.");
        openProductEdit(product);
        return;
      }

      const deleteBtn = e.target.closest("[data-delete-product]");
      if (!deleteBtn) return;
      const id = deleteBtn.getAttribute("data-delete-product");
      if (!confirm("Supprimer ce produit (transactions + dettes) ?")) return;
      const res = await apiFetch(`/api/products/${id}/`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(extractApiErrorMessage(body) || "Suppression impossible.");
      }
      await renderProducts();
    })
  );

  document.getElementById("purgeProductsBtn").addEventListener(
    "click",
    wrapAsync(async () => {
      if (
        !confirm(
          "Supprimer TOUS les produits ?\\n\\nCela supprime aussi les transactions, dettes, stocks et images associées."
        )
      ) {
        return;
      }

      const res = await apiFetch("/api/products/purge/", { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(extractApiErrorMessage(body) || "Suppression impossible.");
      }

      const msg =
        body && typeof body === "object"
          ? `Supprimés: ${fmt(body.deleted_products)} produits, ${fmt(
              body.deleted_transactions
            )} transactions, ${fmt(body.deleted_debts)} dettes.`
          : "Suppression terminée.";
      alert(msg);

      await renderProducts();
    })
  );
}

async function renderTransactions() {
  setActiveTab("transactions");
  await loadProducts();
  const res = await apiFetch("/api/transactions/");
  if (!res.ok) throw new Error("Impossible de charger les transactions.");
  const allTxs = await res.json();
  const txs = allTxs.filter((t) => t.type_transaction === "achat" || t.type_transaction === "vente");

  content.innerHTML = `
    <section class="card">
      <h2 style="margin: 0 0 6px 0;">Transactions</h2>
      <div class="muted">Achat / Vente (les dettes clients se gèrent dans l'onglet Dettes).</div>

      <div class="row" style="margin-top: 12px;">
        <form id="txCreateForm" class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <h3 style="margin: 0 0 10px 0;">Ajouter</h3>
          <label>
            <span>Produit</span>
            <select name="produit" required>${productOptionsHtml()}</select>
          </label>
          <label>
            <span>Type</span>
            <select name="type_transaction" required>
              <option value="achat">achat</option>
              <option value="vente">vente</option>
            </select>
          </label>
          <label>
            <span>Quantité</span>
            <input name="quantite" type="number" min="1" step="1" required />
          </label>
          <label id="txPriceEuroField">
            <span>Prix unitaire (€)</span>
            <input name="prix_unitaire_euro" type="number" step="0.01" />
          </label>
          <label id="txPriceCfaField">
            <span>Prix unitaire (CFA)</span>
            <input name="prix_unitaire_cfa" type="number" step="0.01" />
          </label>
          <label>
            <span>Client/Fournisseur</span>
            <input name="client_fournisseur" />
          </label>
          <label style="grid-column: 1 / -1;">
            <span>Notes</span>
            <textarea name="notes"></textarea>
          </label>
          <button class="btn btn-primary" type="submit">Enregistrer</button>
        </form>

        <div class="card" style="padding: 14px; background: rgba(15,23,48,0.55); grid-column: span 2;">
          <h3 style="margin: 0 0 10px 0;">Historique</h3>
          <div id="txTable"></div>
        </div>
      </div>
    </section>
  `;

  document.getElementById("txTable").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Produit</th>
          <th>Type</th>
          <th>Quantité</th>
          <th>Total (€)</th>
          <th>Total (CFA)</th>
          <th>Client/Fournisseur</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${txs
          .map((t) => {
            const prod = state.products.find((p) => p.id === t.produit);
            return `
              <tr>
                <td class="muted">${escapeHtml(fmt(t.date_transaction))}</td>
                <td>${escapeHtml(prod ? prod.nom : String(t.produit))}</td>
                <td><span class="pill">${escapeHtml(t.type_transaction)}</span></td>
                <td>${escapeHtml(fmt(t.quantite))}</td>
                <td>${escapeHtml(fmt(t.total_euro))}</td>
                <td>${escapeHtml(fmt(t.total_cfa))}</td>
                <td class="muted">${escapeHtml(fmt(t.client_fournisseur || ""))}</td>
                <td><button class="btn btn-danger" data-delete-tx="${t.id}" type="button">Supprimer</button></td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;

  {
    const form = document.getElementById("txCreateForm");
    const productSelect = form.querySelector('select[name="produit"]');
    const typeSelect = form.querySelector('select[name="type_transaction"]');
    const priceEuroField = document.getElementById("txPriceEuroField");
    const priceCfaField = document.getElementById("txPriceCfaField");
    const priceEuroInput = form.querySelector('input[name="prix_unitaire_euro"]');
    const priceCfaInput = form.querySelector('input[name="prix_unitaire_cfa"]');

    function prefillSalePriceIfEmpty() {
      if (typeSelect.value !== "vente") return;
      if (priceCfaInput.value) return;
      const pid = Number(productSelect.value);
      if (!pid) return;
      const prod = state.products.find((p) => p.id === pid);
      if (prod && prod.prix_vente_unitaire_cfa) {
        priceCfaInput.value = prod.prix_vente_unitaire_cfa;
      }
    }

    function updatePriceFields() {
      const type = typeSelect.value;
      if (type === "achat") {
        priceEuroField.classList.remove("hidden");
        priceCfaField.classList.add("hidden");
        priceCfaInput.value = "";
        return;
      }
      if (type === "vente") {
        priceEuroField.classList.add("hidden");
        priceCfaField.classList.remove("hidden");
        priceEuroInput.value = "";
        prefillSalePriceIfEmpty();
        return;
      }
      priceEuroField.classList.add("hidden");
      priceCfaField.classList.add("hidden");
      priceEuroInput.value = "";
      priceCfaInput.value = "";
    }

    typeSelect.addEventListener("change", updatePriceFields);
    productSelect.addEventListener("change", prefillSalePriceIfEmpty);
    updatePriceFields();
  }

  document.getElementById("txCreateForm").addEventListener(
    "submit",
    wrapAsync(async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const payload = Object.fromEntries(fd.entries());
      if (payload.quantite) payload.quantite = Number(payload.quantite);
      if (payload.prix_unitaire_euro === "") delete payload.prix_unitaire_euro;
      if (payload.prix_unitaire_cfa === "") delete payload.prix_unitaire_cfa;
      if (payload.client_fournisseur === "") delete payload.client_fournisseur;
      if (payload.notes === "") delete payload.notes;

      if (
        payload.type_transaction === "vente" &&
        !payload.prix_unitaire_cfa &&
        !payload.prix_unitaire_euro
      ) {
        const pid = Number(payload.produit);
        const prod = state.products.find((p) => p.id === pid);
        if (prod && prod.prix_vente_unitaire_cfa) {
          payload.prix_unitaire_cfa = prod.prix_vente_unitaire_cfa;
        } else {
          throw new Error("Pour une vente, renseigne le prix unitaire en CFA (ou définis le PVU sur le produit).");
        }
      }

      const res = await apiFetch("/api/transactions/", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(extractApiErrorMessage(body) || "Création impossible.");
      await renderTransactions();
    })
  );

  document.getElementById("txTable").addEventListener(
    "click",
    wrapAsync(async (e) => {
      const btn = e.target.closest("[data-delete-tx]");
      if (!btn) return;
      const id = btn.getAttribute("data-delete-tx");
      if (!confirm("Supprimer cette transaction ?")) return;
      const res = await apiFetch(`/api/transactions/${id}/`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(extractApiErrorMessage(body) || "Suppression impossible.");
      }
      await renderTransactions();
    })
  );
}

async function renderDebts() {
  setActiveTab("debts");
  await loadProducts();
  const res = await apiFetch("/api/debts/");
  if (!res.ok) throw new Error("Impossible de charger les dettes.");
  const debts = await res.json();

  content.innerHTML = `
    <section class="card">
      <h2 style="margin: 0 0 6px 0;">Dettes clients</h2>
      <div class="muted">Ventes à crédit + alertes de retard.</div>

      <div class="row" style="margin-top: 12px;">
        <form id="debtCreateForm" class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <h3 style="margin: 0 0 10px 0;">Nouvelle dette</h3>
          <label>
            <span>Produit</span>
            <select name="produit" required>${productOptionsHtml()}</select>
          </label>
          <label>
            <span>Client</span>
            <input name="client" required />
          </label>
          <label>
            <span>Quantité</span>
            <input name="quantite_pretee" type="number" min="1" step="1" required />
          </label>
          <label>
            <span>Prix de vente unitaire (CFA)</span>
            <input name="prix_unitaire_cfa" type="number" step="0.01" required />
          </label>
          <label>
            <span>Date paiement prévue</span>
            <input name="date_retour_prevue" type="date" />
          </label>
          <button class="btn btn-primary" type="submit">Enregistrer</button>
        </form>

        <div class="card" style="padding: 14px; background: rgba(15,23,48,0.55); grid-column: span 2;">
          <h3 style="margin: 0 0 10px 0;">Liste</h3>
          <div id="debtTable"></div>
        </div>
      </div>
    </section>
  `;

  {
    const form = document.getElementById("debtCreateForm");
    const productSelect = form.querySelector('select[name="produit"]');
    const priceInput = form.querySelector('input[name="prix_unitaire_cfa"]');

    function prefillDebtPriceIfEmpty() {
      if (priceInput.value) return;
      const pid = Number(productSelect.value);
      if (!pid) return;
      const prod = state.products.find((p) => p.id === pid);
      if (prod && prod.prix_vente_unitaire_cfa) {
        priceInput.value = prod.prix_vente_unitaire_cfa;
      }
    }

    productSelect.addEventListener("change", prefillDebtPriceIfEmpty);
    prefillDebtPriceIfEmpty();
  }

  function debtRow(d) {
    const prod = state.products.find((p) => p.id === d.produit);
    const isLate =
      d.statut === "retard" ||
      (d.date_retour_prevue && !d.date_retour_effective && new Date(d.date_retour_prevue) < new Date());
    const pill = d.date_retour_effective
      ? `<span class="pill ok">soldée</span>`
      : isLate
        ? `<span class="pill warn">retard</span>`
        : `<span class="pill">en cours</span>`;
    const payBtn = d.date_retour_effective
      ? ""
      : `<button class="btn" data-return-debt="${d.id}" type="button">Marquer payée</button>`;
    return `
      <tr>
        <td>${escapeHtml(prod ? prod.nom : String(d.produit))}</td>
        <td>${escapeHtml(d.client)}</td>
        <td>${escapeHtml(fmt(d.quantite_pretee))}</td>
        <td class="muted">${escapeHtml(fmt(d.date_pret))}</td>
        <td class="muted">${escapeHtml(fmt(d.date_retour_prevue))}</td>
        <td class="muted">${escapeHtml(fmt(d.date_retour_effective))}</td>
        <td>${pill}</td>
        <td>
          ${payBtn}
          <button class="btn btn-danger" data-delete-debt="${d.id}" type="button">Supprimer</button>
        </td>
      </tr>
    `;
  }

  document.getElementById("debtTable").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Produit</th>
          <th>Client</th>
          <th>Qté</th>
          <th>Date dette</th>
          <th>Paiement prévu</th>
          <th>Paiement effectif</th>
          <th>Statut</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${debts.map(debtRow).join("")}</tbody>
    </table>
  `;

  document.getElementById("debtCreateForm").addEventListener(
    "submit",
    wrapAsync(async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const payload = Object.fromEntries(fd.entries());
      payload.quantite_pretee = Number(payload.quantite_pretee);
      if (payload.date_retour_prevue === "") delete payload.date_retour_prevue;
      if (payload.prix_unitaire_cfa === "") delete payload.prix_unitaire_cfa;

      const res = await apiFetch("/api/debts/", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(extractApiErrorMessage(body) || "Création impossible.");
      await renderDebts();
    })
  );

  document.getElementById("debtTable").addEventListener(
    "click",
    wrapAsync(async (e) => {
      const returnBtn = e.target.closest("[data-return-debt]");
      if (returnBtn) {
        const id = returnBtn.getAttribute("data-return-debt");
        const today = new Date().toISOString().slice(0, 10);
        let res = await apiFetch(`/api/debts/${id}/`, {
          method: "PATCH",
          body: JSON.stringify({ date_retour_effective: today }),
        });
        let body = await res.json().catch(() => null);
        if (
          !res.ok &&
          body &&
          typeof body === "object" &&
          Object.prototype.hasOwnProperty.call(body, "prix_unitaire_cfa")
        ) {
          const price = prompt("Prix de vente unitaire (CFA) pour solder cette dette :", "");
          if (price === null) return;
          const trimmed = String(price).trim();
          if (trimmed === "") throw new Error("Prix de vente requis (CFA).");

          res = await apiFetch(`/api/debts/${id}/`, {
            method: "PATCH",
            body: JSON.stringify({ date_retour_effective: today, prix_unitaire_cfa: trimmed }),
          });
          body = await res.json().catch(() => null);
        }
        if (!res.ok) throw new Error(extractApiErrorMessage(body) || "Update impossible.");
        await renderDebts();
        return;
      }

      const deleteBtn = e.target.closest("[data-delete-debt]");
      if (deleteBtn) {
        const id = deleteBtn.getAttribute("data-delete-debt");
        if (!confirm("Supprimer cette dette (et ses transactions) ?")) return;
        const res = await apiFetch(`/api/debts/${id}/`, { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(extractApiErrorMessage(body) || "Suppression impossible.");
        }
        await renderDebts();
      }
    })
  );
}

async function renderRates() {
  setActiveTab("rates");
  const currentRes = await apiFetch("/api/exchange-rates/current/");
  const currentBody = currentRes.ok ? await currentRes.json() : { taux_euro_cfa: null };
  const listRes = await apiFetch("/api/exchange-rates/");
  if (!listRes.ok) throw new Error("Impossible de charger les taux.");
  const rates = await listRes.json();

  content.innerHTML = `
    <section class="card">
      <h2 style="margin: 0 0 6px 0;">Taux de change</h2>
      <div class="muted">Historique + définition du taux courant.</div>

      <div class="row" style="margin-top: 12px;">
        <form id="rateCreateForm" class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <h3 style="margin: 0 0 10px 0;">Définir un taux</h3>
          <div class="muted">Taux courant: <code>${fmt(currentBody.taux_euro_cfa) || "non défini"}</code></div>
          <label style="margin-top: 10px;">
            <span>Taux EUR → CFA</span>
            <input name="taux_euro_cfa" type="number" step="0.01" required />
          </label>
          <label>
            <span>Date d'application</span>
            <input name="date_application" type="date" required />
          </label>
          <button class="btn btn-primary" type="submit">Enregistrer</button>
        </form>

        <div class="card" style="padding: 14px; background: rgba(15,23,48,0.55); grid-column: span 2;">
          <h3 style="margin: 0 0 10px 0;">Historique</h3>
          <div id="ratesTable"></div>
        </div>
      </div>
    </section>
  `;

  document.getElementById("ratesTable").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Taux EUR→CFA</th>
        </tr>
      </thead>
      <tbody>
        ${rates
          .map((r) => {
            return `
              <tr>
                <td class="muted">${escapeHtml(fmt(r.date_application))}</td>
                <td>${escapeHtml(fmt(r.taux_euro_cfa))}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;

  document.getElementById("rateCreateForm").addEventListener(
    "submit",
    wrapAsync(async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const payload = Object.fromEntries(fd.entries());
      const res = await apiFetch("/api/exchange-rates/", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(extractApiErrorMessage(body) || "Création impossible.");
      await renderRates();
    })
  );
}

async function renderEnvois() {
  setActiveTab("envois");
  stopAuditPolling();

  if (!isAdminUser()) {
    content.innerHTML = `
      <section class="card">
        <h2 style="margin: 0 0 6px 0;">Envois</h2>
        <div class="alert">Accès réservé aux administrateurs.</div>
      </section>
    `;
    return;
  }

  const envois = await loadEnvois();

  if (state.currentEnvoi) {
    const refreshed = envois.find((e) => Number(e.id) === Number(state.currentEnvoi.id));
    if (refreshed) {
      state.currentEnvoi = refreshed;
      setSelectedEnvoiId(refreshed.id);
      renderCurrentEnvoi();
    }
  }

  const editId = Number(state.envoiAdmin?.editId || 0);
  const editing = editId ? envois.find((e) => Number(e.id) === editId) : null;
  if (editId && !editing) state.envoiAdmin.editId = null;

  const rows = envois
    .map((e) => {
      const dates = e.date_fin ? `${e.date_debut} → ${e.date_fin}` : `${e.date_debut}`;
      const isCurrent = state.currentEnvoi && Number(state.currentEnvoi.id) === Number(e.id);
      const statusPill = e.is_archived
        ? `<span class="pill warn">Archivé</span>`
        : `<span class="pill ok">Actif</span>`;
      const currentPill = isCurrent ? `<span class="pill ok">Sélectionné</span>` : "";
      const notes = e.notes ? String(e.notes) : "";
      const archiveAction = e.is_archived ? "unarchive" : "archive";
      const archiveLabel = e.is_archived ? "Désarchiver" : "Archiver";

      return `
        <tr>
          <td>
            <div style="display:flex; gap: 10px; align-items: center; flex-wrap: wrap;">
              <div style="font-weight: 700;">${escapeHtml(e.nom || "")}</div>
              ${statusPill}
              ${currentPill}
            </div>
            <div class="muted" style="margin-top: 6px;">${escapeHtml(dates)}</div>
          </td>
          <td class="muted">${escapeHtml(notes)}</td>
          <td>
            <div style="display:flex; gap: 8px; flex-wrap: wrap;">
              <button class="btn btn-secondary" type="button" data-envoi-action="select" data-envoi-id="${escapeAttr(
                e.id
              )}">Utiliser</button>
              <button class="btn" type="button" data-envoi-action="edit" data-envoi-id="${escapeAttr(
                e.id
              )}">Modifier</button>
              <button class="btn" type="button" data-envoi-action="${escapeAttr(
                archiveAction
              )}" data-envoi-id="${escapeAttr(e.id)}">${escapeHtml(archiveLabel)}</button>
              <button class="btn btn-danger" type="button" data-envoi-action="delete" data-envoi-id="${escapeAttr(
                e.id
              )}">Supprimer</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  const editCard = editing
    ? `
        <form id="envoiEditForm" class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <h3 style="margin: 0 0 10px 0;">Modifier</h3>
          <div class="muted" style="margin-bottom: 10px;">
            ID: <code>${escapeHtml(String(editing.id))}</code> · Statut: <code>${
              editing.is_archived ? "archivé" : "actif"
            }</code>
          </div>
          <label><span>Nom</span><input name="nom" required value="${escapeAttr(editing.nom || "")}" /></label>
          <label><span>Date début</span><input name="date_debut" type="date" required value="${escapeAttr(
            editing.date_debut || ""
          )}" /></label>
          <label><span>Date fin</span><input name="date_fin" type="date" value="${escapeAttr(
            editing.date_fin || ""
          )}" /></label>
          <label style="grid-column: 1 / -1;">
            <span>Notes</span>
            <textarea name="notes" placeholder="Optionnel">${escapeHtml(editing.notes || "")}</textarea>
          </label>
          <div style="display:flex; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
            <button class="btn btn-primary" type="submit">Enregistrer</button>
            <button class="btn btn-secondary" id="cancelEnvoiEditBtn" type="button">Annuler</button>
          </div>
          <div id="envoiEditError" class="alert hidden"></div>
        </form>
      `
    : `
        <div class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <h3 style="margin: 0 0 10px 0;">Modifier</h3>
          <div class="muted">Clique sur "Modifier" sur un envoi dans la liste.</div>
        </div>
      `;

  const selectedLabel = state.currentEnvoi
    ? `${state.currentEnvoi.nom}${state.currentEnvoi.is_archived ? " — archivé" : ""}`
    : "Aucun";

  content.innerHTML = `
    <section class="card">
      <div class="row">
        <div>
          <h2 style="margin: 0 0 6px 0;">Envois</h2>
          <div class="muted">Gestion (créer / modifier / archiver / supprimer).</div>
          <div class="pill" style="margin-top: 10px;">Envoi sélectionné: <strong>${escapeHtml(
            selectedLabel
          )}</strong></div>
        </div>
        <div style="display:flex; gap: 10px; align-items: end; justify-content: end; flex-wrap: wrap;">
          <button class="btn" id="refreshEnvoisAdminBtn" type="button">Rafraîchir</button>
          <button class="btn btn-secondary" type="button" id="goSelectEnvoiBtn">Choisir envoi</button>
        </div>
      </div>

      <div class="row" style="margin-top: 12px;">
        <form id="envoiCreateForm" class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <h3 style="margin: 0 0 10px 0;">Créer</h3>
          <label><span>Nom</span><input name="nom" required placeholder="Ex: 2ème envoi" /></label>
          <label><span>Date début</span><input name="date_debut" type="date" required /></label>
          <label><span>Date fin</span><input name="date_fin" type="date" /></label>
          <label style="grid-column: 1 / -1;">
            <span>Notes</span>
            <textarea name="notes" placeholder="Optionnel"></textarea>
          </label>
          <button class="btn btn-primary" type="submit">Créer</button>
          <div id="envoiCreateError" class="alert hidden"></div>
        </form>

        ${editCard}

        <div class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <h3 style="margin: 0 0 10px 0;">Attention</h3>
          <div class="muted">
            Supprimer un envoi supprime aussi tous ses produits, transactions et dettes.
          </div>
        </div>
      </div>

      <div style="margin-top: 12px;">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Envoi</th>
                <th>Notes</th>
                <th style="width: 360px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="3" class="muted">Aucun envoi.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const refreshBtn = document.getElementById("refreshEnvoisAdminBtn");
  const goSelectBtn = document.getElementById("goSelectEnvoiBtn");
  const createForm = document.getElementById("envoiCreateForm");
  const createError = document.getElementById("envoiCreateError");
  const editForm = document.getElementById("envoiEditForm");
  const editError = document.getElementById("envoiEditError");
  const cancelEditBtn = document.getElementById("cancelEnvoiEditBtn");

  function setErr(el, msg) {
    if (!el) return;
    if (!msg) {
      el.textContent = "";
      hide(el);
      return;
    }
    el.textContent = msg;
    show(el);
  }

  refreshBtn.addEventListener(
    "click",
    wrapAsync(async () => {
      await renderEnvois();
    })
  );

  goSelectBtn.addEventListener("click", () => routeTo("selectEnvoi"));

  const today = new Date().toISOString().slice(0, 10);
  const dateDebutEl = createForm.querySelector('input[name="date_debut"]');
  if (dateDebutEl && !dateDebutEl.value) dateDebutEl.value = today;

  createForm.addEventListener(
    "submit",
    wrapAsync(async (e) => {
      e.preventDefault();
      setErr(createError, "");
      const fd = new FormData(e.currentTarget);
      const payload = Object.fromEntries(fd.entries());
      if (!payload.date_fin) delete payload.date_fin;
      const res = await apiFetch("/api/envois/", { method: "POST", body: JSON.stringify(payload) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(extractApiErrorMessage(body) || "Création impossible.");
      if (!state.currentEnvoi) setCurrentEnvoi(body);
      await renderEnvois();
    })
  );

  if (editForm) {
    editForm.addEventListener(
      "submit",
      wrapAsync(async (e) => {
        e.preventDefault();
        setErr(editError, "");
        const fd = new FormData(e.currentTarget);
        const payload = Object.fromEntries(fd.entries());
        if (payload.date_fin === "") payload.date_fin = null;
        const res = await apiFetch(`/api/envois/${encodeURIComponent(editId)}/`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(extractApiErrorMessage(body) || "Modification impossible.");
        state.envoiAdmin.editId = null;
        await renderEnvois();
      })
    );
  }

  if (cancelEditBtn) {
    cancelEditBtn.addEventListener("click", () => {
      state.envoiAdmin.editId = null;
      renderEnvois().catch(() => {});
    });
  }

  content.querySelectorAll("[data-envoi-action]").forEach((btn) => {
    btn.addEventListener(
      "click",
      wrapAsync(async () => {
        const action = btn.getAttribute("data-envoi-action") || "";
        const id = Number(btn.getAttribute("data-envoi-id") || 0);
        if (!id) return;

        if (action === "select") {
          const envoi = state.envois.find((e) => Number(e.id) === id);
          if (!envoi) throw new Error("Envoi introuvable.");
          setCurrentEnvoi(envoi);
          await routeTo("dashboard");
          return;
        }

        if (action === "edit") {
          state.envoiAdmin.editId = id;
          await renderEnvois();
          return;
        }

        if (action === "archive" || action === "unarchive") {
          const toArchived = action === "archive";
          const question = toArchived ? "Archiver cet envoi ?" : "Désarchiver cet envoi ?";
          if (!confirm(question)) return;
          const res = await apiFetch(`/api/envois/${encodeURIComponent(id)}/`, {
            method: "PATCH",
            body: JSON.stringify({ is_archived: toArchived }),
          });
          const body = await res.json().catch(() => null);
          if (!res.ok) throw new Error(extractApiErrorMessage(body) || "Mise à jour impossible.");
          await renderEnvois();
          return;
        }

        if (action === "delete") {
          if (
            !confirm(
              "Supprimer cet envoi ? (Cela supprimera aussi tous ses produits, transactions et dettes.)"
            )
          ) {
            return;
          }
          const res = await apiFetch(`/api/envois/${encodeURIComponent(id)}/`, { method: "DELETE" });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(extractApiErrorMessage(body) || "Suppression impossible.");
          }
          if (state.currentEnvoi && Number(state.currentEnvoi.id) === id) setCurrentEnvoi(null);
          if (Number(state.envoiAdmin.editId || 0) === id) state.envoiAdmin.editId = null;
          await renderEnvois();
        }
      })
    );
  });
}

function stopAuditPolling() {
  if (state.audit?.pollHandle) {
    clearInterval(state.audit.pollHandle);
    state.audit.pollHandle = null;
  }
}

function formatDateTime(value) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString("fr-FR");
}

function renderAuditTable(container, events) {
  const rows = (events || [])
    .map((ev) => {
      const who = ev.user_display || ev.username || "";
      const target = ev.entity
        ? ev.object_id
          ? `${ev.entity}#${ev.object_id}`
          : ev.entity
        : "";
      return `
        <tr>
          <td>${escapeHtml(formatDateTime(ev.created_at))}</td>
          <td>${escapeHtml(who)}</td>
          <td>${escapeHtml(ev.action || "")}</td>
          <td>${escapeHtml(target)}</td>
          <td>${escapeHtml(ev.message || ev.object_repr || "")}</td>
        </tr>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width: 170px;">Date</th>
            <th style="width: 170px;">Utilisateur</th>
            <th style="width: 110px;">Action</th>
            <th style="width: 170px;">Cible</th>
            <th>Détails</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="5" class="muted">Aucun évènement.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

async function renderAudit() {
  setActiveTab("audit");
  stopAuditPolling();

  content.innerHTML = `
    <section class="card">
      <h2 style="margin: 0 0 6px 0;">Historique</h2>
      <div class="muted">Qui a fait quoi (mise à jour automatique).</div>

      <div class="row" style="margin-top: 12px; grid-template-columns: 1fr 1fr 1fr;">
        <div class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <label>
            <span>Live</span>
            <select id="auditLiveSelect">
              <option value="1">Activé</option>
              <option value="0">Désactivé</option>
            </select>
          </label>
          <button class="btn" id="auditRefreshBtn" type="button" style="margin-top: 10px;">Rafraîchir</button>
          <div id="auditMeta" class="muted" style="margin-top: 10px;"></div>
        </div>

        <div class="card" style="padding: 14px; background: rgba(15,23,48,0.55); grid-column: 2 / -1;">
          <div id="auditTable"></div>
        </div>
      </div>
    </section>
  `;

  const auditTable = document.getElementById("auditTable");
  const auditMeta = document.getElementById("auditMeta");
  const refreshBtn = document.getElementById("auditRefreshBtn");
  const liveSelect = document.getElementById("auditLiveSelect");

  function setMeta(text) {
    auditMeta.textContent = text || "";
  }

  async function loadInitial() {
    const res = await apiFetch("/api/audit/?limit=200", { method: "GET" });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(extractApiErrorMessage(body) || "Chargement impossible.");
    state.audit.events = Array.isArray(body) ? body : [];
    state.audit.lastId = state.audit.events.reduce((m, ev) => Math.max(m, Number(ev.id) || 0), 0);
    renderAuditTable(auditTable, state.audit.events);
    setMeta(`Dernière mise à jour: ${new Date().toLocaleTimeString("fr-FR")}`);
  }

  async function pollOnce() {
    if (!state.audit.lastId) return;
    const res = await apiFetch(`/api/audit/?after_id=${encodeURIComponent(state.audit.lastId)}&limit=200`, {
      method: "GET",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return;

    const newEvents = Array.isArray(body) ? body : [];
    if (newEvents.length === 0) return;

    const maxId = newEvents.reduce((m, ev) => Math.max(m, Number(ev.id) || 0), state.audit.lastId);
    state.audit.lastId = maxId;

    // On affiche les plus récents en haut
    state.audit.events = [...newEvents.slice().reverse(), ...state.audit.events].slice(0, 200);
    renderAuditTable(auditTable, state.audit.events);
    setMeta(`Dernière mise à jour: ${new Date().toLocaleTimeString("fr-FR")}`);
  }

  refreshBtn.addEventListener(
    "click",
    wrapAsync(async () => {
      await loadInitial();
    })
  );

  liveSelect.value = state.audit.live ? "1" : "0";
  liveSelect.addEventListener("change", () => {
    state.audit.live = liveSelect.value === "1";
    stopAuditPolling();
    if (state.audit.live) {
      state.audit.pollHandle = setInterval(() => {
        pollOnce().catch(() => {});
      }, 2000);
    }
  });

  await loadInitial();
  if (state.audit.live) {
    state.audit.pollHandle = setInterval(() => {
      pollOnce().catch(() => {});
    }, 2000);
  }
}

async function renderEnvoiSelect() {
  setActiveTab("");
  stopAuditPolling();

  content.innerHTML = `
    <section class="card">
      <h2 style="margin: 0 0 6px 0;">Choisir un envoi</h2>
      <div class="muted">Toutes les pages (produits, stocks, transactions, rapports) sont liées à un envoi.</div>

      <div class="row" style="margin-top: 12px;">
        <div class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <h3 style="margin: 0 0 10px 0;">Sélection</h3>
          <label>
            <span>Envoi</span>
            <select id="envoiSelect"></select>
          </label>
          <button class="btn btn-primary" id="useEnvoiBtn" type="button" style="margin-top: 10px;">
            Continuer
          </button>
          <button class="btn" id="refreshEnvoisBtn" type="button" style="margin-top: 10px;">
            Rafraîchir
          </button>
          <div id="envoiSelectError" class="alert hidden"></div>
        </div>

        <form id="createEnvoiForm" class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <h3 style="margin: 0 0 10px 0;">Créer un envoi</h3>
          <label><span>Nom</span><input name="nom" required placeholder="Ex: 1er envoi" /></label>
          <label><span>Date début</span><input name="date_debut" type="date" required /></label>
          <label><span>Date fin</span><input name="date_fin" type="date" /></label>
          <label style="grid-column: 1 / -1;">
            <span>Notes</span>
            <textarea name="notes" placeholder="Optionnel"></textarea>
          </label>
          <button class="btn btn-primary" type="submit">Créer</button>
          <div id="createEnvoiError" class="alert hidden"></div>
        </form>

        <div class="card" style="padding: 14px; background: rgba(15,23,48,0.55);">
          <h3 style="margin: 0 0 10px 0;">Envoi actuel</h3>
          <div class="muted">${escapeHtml(state.currentEnvoi ? `${state.currentEnvoi.nom}${state.currentEnvoi.is_archived ? " — archivé" : ""}` : "Aucun")}</div>
        </div>
      </div>
    </section>
  `;

  const envoiSelect = document.getElementById("envoiSelect");
  const useBtn = document.getElementById("useEnvoiBtn");
  const refreshBtn = document.getElementById("refreshEnvoisBtn");
  const selectError = document.getElementById("envoiSelectError");
  const createForm = document.getElementById("createEnvoiForm");
  const createError = document.getElementById("createEnvoiError");

  function setErr(el, msg) {
    if (!msg) {
      el.textContent = "";
      hide(el);
      return;
    }
    el.textContent = msg;
    show(el);
  }

  async function reloadList() {
    const envois = await loadEnvois();
    envoiSelect.innerHTML = envois
      .map((e) => {
        const dates = e.date_fin ? `${e.date_debut} → ${e.date_fin}` : `${e.date_debut}`;
        const archived = e.is_archived ? " — archivé" : "";
        return `<option value="${escapeAttr(e.id)}">${escapeHtml(`${e.nom}${archived} (${dates})`)}</option>`;
      })
      .join("");

    const saved = Number(getSelectedEnvoiId() || 0);
    const preferred = saved && envois.some((e) => Number(e.id) === saved) ? saved : null;
    const current = state.currentEnvoi?.id;
    const pick = preferred || current || (envois[0] ? envois[0].id : "");
    if (pick) envoiSelect.value = String(pick);
  }

  function selectEnvoiFromUi() {
    const id = Number(envoiSelect.value || 0);
    const envoi = state.envois.find((e) => Number(e.id) === id);
    if (!envoi) throw new Error("Sélection invalide.");
    setCurrentEnvoi(envoi);
  }

  useBtn.addEventListener(
    "click",
    wrapAsync(async () => {
      setErr(selectError, "");
      selectEnvoiFromUi();
      await routeTo("dashboard");
    })
  );

  refreshBtn.addEventListener(
    "click",
    wrapAsync(async () => {
      setErr(selectError, "");
      await reloadList();
    })
  );

  createForm.addEventListener(
    "submit",
    wrapAsync(async (e) => {
      e.preventDefault();
      setErr(createError, "");
      const fd = new FormData(e.currentTarget);
      const payload = Object.fromEntries(fd.entries());
      if (!payload.date_fin) delete payload.date_fin;
      const res = await apiFetch("/api/envois/", { method: "POST", body: JSON.stringify(payload) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(extractApiErrorMessage(body) || "Création impossible.");
      await reloadList();
      envoiSelect.value = String(body.id);
      selectEnvoiFromUi();
      await routeTo("dashboard");
    })
  );

  const today = new Date().toISOString().slice(0, 10);
  createForm.querySelector('input[name="date_debut"]').value = today;

  await reloadList();
  renderCurrentEnvoi();
}

async function routeTo(route) {
  try {
    setLoginError("");
    stopAuditPolling();
    if (route === "selectEnvoi") return await renderEnvoiSelect();
    if (route === "envois") return await renderEnvois();

    if (!state.currentEnvoi) {
      const ok = await ensureEnvoiSelected();
      if (!ok) return await renderEnvoiSelect();
    }
    if (route === "dashboard") return await renderDashboard();
    if (route === "reports") return await renderReports();
    if (route === "products") return await renderProducts();
    if (route === "transactions") return await renderTransactions();
    if (route === "debts") return await renderDebts();
    if (route === "rates") return await renderRates();
    if (route === "audit") return await renderAudit();
    return await renderDashboard();
  } catch (err) {
    content.innerHTML = `<section class="card"><div class="alert">${escapeHtml(err.message || String(err))}</div></section>`;
  }
}

function initTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => routeTo(btn.dataset.route));
  });
}

async function showLoggedInUI() {
  hide(loginView);
  show(appView);
  initTabs();
  await loadCurrentUser();
  renderCurrentEnvoi();
  await routeTo("dashboard");
}

function showLoggedOutUI() {
  stopAuditPolling();
  hide(appView);
  show(loginView);
  state.currentUser = null;
  renderCurrentUser();
  renderAdminTabs();
  state.currentEnvoi = null;
  renderCurrentEnvoi();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const username = fd.get("username");
  const password = fd.get("password");
  try {
    setLoginError("");
    await login(String(username), String(password));
    await showLoggedInUI();
  } catch (err) {
    setLoginError(err.message || "Connexion impossible.");
  }
});

logoutBtn.addEventListener("click", () => {
  clearTokens();
  showLoggedOutUI();
});

if (chooseEnvoiBtn) {
  chooseEnvoiBtn.addEventListener("click", () => routeTo("selectEnvoi"));
}

content.addEventListener("click", (e) => {
  const el = e.target.closest("[data-image-src]");
  if (!el) return;
  const src = el.getAttribute("data-image-src");
  if (!src) return;
  const alt = el.getAttribute("data-image-alt") || "Image";
  imagePreview.open(src, alt);
});

if (getTokens().access) {
  showLoggedInUI().catch(() => showLoggedOutUI());
} else {
  showLoggedOutUI();
}
