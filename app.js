const STORAGE_KEY = "painel-krs-atualizacoes-v1";
const ARCHIVE_KEY = "painel-krs-atualizacoes-arquivo-v1";
const UDI_SESSION_KEY = "painel-krs-udi-auth-v1";
const ADO_PRIORITY_KEY = "painel-krs-prioridade-ado-v1";

const state = {
  baseRecords: [],
  records: [],
  filtered: [],
  updates: [],
  adoPriorities: new Set(),
  udiUsers: [],
  pendingUpdateId: null,
  view: "cards",
};

const statusOrder = ["A iniciar", "Em andamento", "Concluído", "Suspenso", "Sem status"];
const statusClass = {
  "A iniciar": "starting",
  "Em andamento": "progress",
  "Concluído": "done",
  "Suspenso": "suspended",
  "Sem status": "empty",
};

const el = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "Sem informação";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function fillSelect(select, values, label) {
  const unique = [...new Set(values.filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), "pt-BR", { numeric: true }),
  );
  select.innerHTML = [`<option value="">${label}</option>`, ...unique.map((v) => `<option>${escapeHtml(v)}</option>`)].join("");
}

function statusBadge(status) {
  const safe = status || "Sem status";
  return `<span class="badge ${statusClass[safe] || "empty"}">${escapeHtml(safe)}</span>`;
}

function pct(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function formatValue(value) {
  if (value === "" || value === "-") return "Não informado";
  if (typeof value === "number" && value > 0 && value < 1) return `${Math.round(value * 100)}%`;
  return escapeHtml(value);
}

function formatDateTime(iso) {
  if (!iso) return "nenhuma";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return headers.reduce((record, header, index) => {
      record[header] = (values[index] || "").trim();
      return record;
    }, {});
  });
}

function getDefaultUdiUsers() {
  const udis = [...new Set(state.baseRecords.map((record) => record.udi).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), "pt-BR", { numeric: true }),
  );
  return udis.map((udi) => ({
    login: udi,
    senha: udi,
    udi,
    nome: `Responsavel ${udi}`,
    ativo: "Sim",
  }));
}

async function loadUdiUsers() {
  try {
    const response = await fetch("usuarios-udi.csv", { cache: "no-store" });
    if (!response.ok) throw new Error("Arquivo de usuÃ¡rios por UDI indisponÃ­vel");
    const users = parseCsv(await response.text()).filter((user) => user.login && user.senha && user.udi);
    state.udiUsers = users.length ? users : getDefaultUdiUsers();
  } catch {
    state.udiUsers = getDefaultUdiUsers();
  }
}

function isActiveUser(user) {
  return !["nÃ£o", "nao", "false", "0", "inativo"].includes(String(user.ativo || "sim").toLowerCase());
}

function readUdiSession() {
  try {
    return JSON.parse(sessionStorage.getItem(UDI_SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveUdiSession(user) {
  sessionStorage.setItem(UDI_SESSION_KEY, JSON.stringify({
    login: user.login,
    nome: user.nome || user.login,
    udi: user.udi,
  }));
}

function canUpdateUdi(udi) {
  const session = readUdiSession();
  if (!session) return false;
  return String(session.udi || "").trim().toLowerCase() === String(udi || "").trim().toLowerCase();
}

function authenticateUdi(login, password, udi) {
  const normalizedLogin = String(login || "").trim().toLowerCase();
  const normalizedUdi = String(udi || "").trim().toLowerCase();
  return state.udiUsers.find((user) =>
    String(user.login || "").trim().toLowerCase() === normalizedLogin &&
    String(user.senha || "") === String(password || "") &&
    String(user.udi || "").trim().toLowerCase() === normalizedUdi &&
    isActiveUser(user)
  );
}

function statusKeyForYear(year) {
  return `status${year}`;
}

function getBaseStatusForYear(item, year) {
  return item?.[statusKeyForYear(year)] || "Sem status";
}

function getLatestUpdateForYear(krId, year) {
  return [...loadArchiveUpdates()]
    .filter((update) => Number(update.krId) === Number(krId) && String(update.referenceYear || "2026") === String(year))
    .sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt))[0];
}

function getCurrentStatusForYear(item, year) {
  const latest = getLatestUpdateForYear(item.id, year);
  return latest?.newStatus || getBaseStatusForYear(item, year);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadUpdates() {
  try {
    state.updates = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    state.updates = [];
  }
  const archive = loadArchiveUpdates();
  if (archive.length === 0 && state.updates.length > 0) {
    saveArchiveUpdates(state.updates);
  }
}

function saveUpdates() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.updates));
}

function loadArchiveUpdates() {
  try {
    return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveArchiveUpdates(updates) {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(updates));
}

function loadAdoPriorities() {
  try {
    const savedIds = JSON.parse(localStorage.getItem(ADO_PRIORITY_KEY) || "[]");
    state.adoPriorities = new Set(savedIds.map((id) => String(id)));
  } catch {
    state.adoPriorities = new Set();
  }
}

function saveAdoPriorities() {
  localStorage.setItem(ADO_PRIORITY_KEY, JSON.stringify([...state.adoPriorities]));
}

function toggleAdoPriority(id, checked) {
  const key = String(id);
  if (checked) state.adoPriorities.add(key);
  else state.adoPriorities.delete(key);
  saveAdoPriorities();
  applyLatestUpdates();
  applyFilters();
}

function applyLatestUpdates() {
  const latestByKr = new Map();
  [...state.updates]
    .filter((update) => String(update.referenceYear || "2026") === "2026")
    .sort((a, b) => new Date(a.registeredAt) - new Date(b.registeredAt))
    .forEach((update) => latestByKr.set(Number(update.krId), update));

  state.records = state.baseRecords.map((record) => {
    const latest = latestByKr.get(Number(record.id));
    const prioridadeAdo = state.adoPriorities.has(String(record.id));
    if (!latest) return { ...record, prioridadeAdo, latestUpdate: null };
    return {
      ...record,
      prioridadeAdo,
      statusAtual: latest.newStatus,
      latestUpdate: latest,
    };
  });
}

function renderSummary() {
  const total = state.records.length;
  const counts = countBy(state.records, "statusAtual");
  const progress = counts["Em andamento"] || 0;
  const done = counts["Concluído"] || 0;
  const attention = (counts["Suspenso"] || 0) + (counts["Sem status"] || 0);

  el("totalKrs").textContent = total;
  el("progressCount").textContent = progress;
  el("doneCount").textContent = done;
  el("attentionCount").textContent = attention;
  el("progressBar").style.width = `${pct(progress, total)}%`;
  el("doneBar").style.width = `${pct(done, total)}%`;
}

function renderCharts() {
  const visible = state.filtered.length;
  el("visibleCount").textContent = `${visible} visíveis`;

  const statusCounts = countBy(state.filtered, "statusAtual");
  el("statusChart").innerHTML = statusOrder
    .map((status) => {
      const count = statusCounts[status] || 0;
      return `
        <div class="chart-row">
          <strong>${escapeHtml(status)}</strong>
          <div class="track"><div class="fill ${statusClass[status]}" style="width:${pct(count, visible)}%"></div></div>
          <span>${count}</span>
        </div>
      `;
    })
    .join("");

  const udiCounts = Object.entries(countBy(state.filtered, "udi"))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .slice(0, 8);
  const max = Math.max(...udiCounts.map(([, count]) => count), 1);
  el("udiChart").innerHTML = udiCounts
    .map(([udi, count]) => `
      <div class="chart-row">
        <strong>${escapeHtml(udi)}</strong>
        <div class="track"><div class="fill progress" style="width:${Math.round((count / max) * 100)}%"></div></div>
        <span>${count}</span>
      </div>
    `)
    .join("");
}

function renderCards() {
  el("cards").innerHTML = state.filtered
    .map((item) => `
      <article class="kr-card">
        <div class="card-meta">
          ${statusBadge(item.statusAtual)}
          <span class="badge">${escapeHtml(item.udi || "Sem UDI")}</span>
          <span class="badge">Prioridade ${escapeHtml(item.prioridade || "-")}</span>
          <label class="ado-priority-control">
            <input class="ado-priority-checkbox" type="checkbox" data-id="${item.id}" ${item.prioridadeAdo ? "checked" : ""} />
            <span>Prioridade ADO</span>
          </label>
          ${item.latestUpdate ? `<span class="badge">Atualizado em ${formatDateTime(item.latestUpdate.registeredAt)}</span>` : ""}
        </div>
        <h3>${escapeHtml(item.kr)}</h3>
        <p>${escapeHtml(item.tramite || item.objetivos || "Sem trâmite informado.")}</p>
        <div class="timeline">
          <span class="badge">2024: ${escapeHtml(getCurrentStatusForYear(item, 2024) || "-")}</span>
          <span class="badge">2025: ${escapeHtml(getCurrentStatusForYear(item, 2025) || "-")}</span>
          <span class="badge">2026: ${escapeHtml(getCurrentStatusForYear(item, 2026) || "-")}</span>
          <span class="badge">2027: ${escapeHtml(getCurrentStatusForYear(item, 2027) || "-")}</span>
        </div>
        <div class="card-actions">
          <button type="button" class="details-btn" data-id="${item.id}">Detalhes</button>
          <button type="button" class="update-btn" data-id="${item.id}">Atualizar status</button>
        </div>
      </article>
    `)
    .join("");

  document.querySelectorAll(".details-btn").forEach((button) => {
    button.addEventListener("click", () => openDetails(Number(button.dataset.id)));
  });
  document.querySelectorAll(".update-btn").forEach((button) => {
    button.addEventListener("click", () => openUpdateForm(Number(button.dataset.id)));
  });
  document.querySelectorAll(".ado-priority-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => toggleAdoPriority(checkbox.dataset.id, checkbox.checked));
  });
}

function renderTable() {
  el("tableBody").innerHTML = state.filtered
    .map((item) => `
      <tr>
        <td>${statusBadge(item.statusAtual)}</td>
        <td>${escapeHtml(item.udi || "-")}</td>
        <td>${escapeHtml(item.kr)}</td>
        <td>
          <label class="ado-priority-control table-ado-priority">
            <input class="ado-priority-checkbox" type="checkbox" data-id="${item.id}" ${item.prioridadeAdo ? "checked" : ""} />
            <span>${escapeHtml(item.prioridade || "-")} / ADO</span>
          </label>
        </td>
        <td>${escapeHtml(item.tramite || "-")}</td>
        <td><button type="button" class="update-btn" data-id="${item.id}">Atualizar</button></td>
      </tr>
    `)
    .join("");

  document.querySelectorAll("tbody .update-btn").forEach((button) => {
    button.addEventListener("click", () => openUpdateForm(Number(button.dataset.id)));
  });
  document.querySelectorAll("tbody .ado-priority-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => toggleAdoPriority(checkbox.dataset.id, checkbox.checked));
  });
}

function renderUpdatesPanel() {
  if (!el("updatesList")) return;
  const sorted = [...state.updates].sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
  el("updatesCount").textContent = sorted.length;
  el("lastUpdateLabel").textContent = sorted[0] ? formatDateTime(sorted[0].registeredAt) : "nenhuma";
  el("updatesList").innerHTML = sorted.length
    ? sorted.slice(0, 8).map((update) => `
        <article class="update-item">
          <strong>${escapeHtml(update.krTitle)}</strong>
          <div class="update-meta">
            <span>${formatDateTime(update.registeredAt)}</span>
            <span>${escapeHtml(update.udi || "-")}</span>
            <span>Ano ${escapeHtml(update.referenceYear || "2026")}</span>
            <span>${escapeHtml(update.previousStatus)} → ${escapeHtml(update.newStatus)}</span>
            <span>${escapeHtml(update.responsible)}</span>
            ${update.proofName ? `<span>Comprovação: ${update.proofDataUrl ? `<a href="${escapeHtml(update.proofDataUrl)}" download="${escapeHtml(update.proofName)}">${escapeHtml(update.proofName)}</a>` : escapeHtml(update.proofName)}</span>` : ""}
          </div>
          <p>${escapeHtml(update.description)}</p>
        </article>
      `).join("")
    : `<article class="update-item"><strong>Nenhuma atualização registrada.</strong><p>Use o botão "Atualizar status" em um KR para iniciar o histórico.</p></article>`;
}

function applyFilters() {
  const query = normalize(el("searchInput").value);
  const status = el("statusFilter").value;
  const udi = el("udiFilter").value;
  const classification = el("classFilter").value;
  const priority = el("priorityFilter").value;
  const onlyAdoPriority = el("adoPriorityFilter").checked;

  state.filtered = state.records.filter((item) => {
    const latest = item.latestUpdate ? `${item.latestUpdate.description} ${item.latestUpdate.responsible}` : "";
    const haystack = normalize(`${item.kr} ${item.udi} ${item.objetivos} ${item.tramite} ${item.diretrizes} ${latest}`);
    return (
      (!query || haystack.includes(query)) &&
      (!status || item.statusAtual === status) &&
      (!udi || item.udi === udi) &&
      (!classification || item.classificacao === classification) &&
      (!priority || String(item.prioridade) === priority) &&
      (!onlyAdoPriority || item.prioridadeAdo)
    );
  });

  renderSummary();
  renderCharts();
  renderCards();
  renderTable();
  renderUpdatesPanel();
}

function openDetails(id) {
  const item = state.records.find((record) => Number(record.id) === Number(id));
  if (!item) return;
  el("dialogTitle").textContent = item.kr;
  el("dialogBody").innerHTML = `
    <div class="card-meta">${statusBadge(item.statusAtual)}<span class="badge">${escapeHtml(item.udi)}</span><span class="badge">${escapeHtml(item.classificacao || "Sem classificação")}</span></div>
    <div class="detail-grid">
      <div class="detail-item"><span>Objetivo</span>${formatValue(item.objetivos)}</div>
      <div class="detail-item"><span>Métrica</span>${formatValue(item.metrica)}</div>
      <div class="detail-item"><span>Meta 2024</span>${formatValue(item.meta2024)}</div>
      <div class="detail-item"><span>Meta 2025</span>${formatValue(item.meta2025)}</div>
      <div class="detail-item"><span>Meta 2026</span>${formatValue(item.meta2026)}</div>
      <div class="detail-item"><span>Meta 2027</span>${formatValue(item.meta2027)}</div>
      <div class="detail-item"><span>Trâmite atual</span>${formatValue(item.tramite)}</div>
      <div class="detail-item"><span>Prazo</span>${formatValue(item.prazo)}</div>
    </div>
    ${item.latestUpdate ? `<div class="detail-item"><span>Última atualização registrada</span>${escapeHtml(item.latestUpdate.description)}<br><strong>${escapeHtml(item.latestUpdate.responsible)}</strong> - ${formatDateTime(item.latestUpdate.registeredAt)}</div>` : ""}
    <div class="detail-item"><span>Despacho do ESi</span>${formatValue(item.despacho)}</div>
    <div class="card-actions">
      <button type="button" class="update-btn" data-id="${item.id}">Atualizar status</button>
      ${item.linkEstudo ? `<a href="${escapeHtml(item.linkEstudo)}" target="_blank" rel="noreferrer">Estudo de situação</a>` : ""}
    </div>
  `;
  el("dialogBody").querySelector(".update-btn").addEventListener("click", () => {
    el("detailDialog").close();
    openUpdateForm(item.id);
  });
  el("detailDialog").showModal();
}

function openUpdateForm(id) {
  const item = state.records.find((record) => Number(record.id) === Number(id));
  if (!item) return;
  if (!canUpdateUdi(item.udi)) {
    state.pendingUpdateId = item.id;
    el("udiLoginTitle").textContent = `Acesso da UDI ${item.udi || "-"}`;
    el("udiLoginMessage").textContent = `Entre com o login autorizado para atualizar os KRs da ${item.udi || "UDI selecionada"}.`;
    el("udiLoginInput").value = "";
    el("udiPasswordInput").value = "";
    el("udiLoginError").textContent = "";
    el("udiLoginDialog").showModal();
    return;
  }
  el("updateKrId").value = item.id;
  el("updateKrTitle").textContent = item.kr;
  el("yearInput").value = "2026";
  el("currentStatusInput").value = getCurrentStatusForYear(item, 2026);
  el("newStatusInput").value = getCurrentStatusForYear(item, 2026);
  el("responsibleInput").value = item.responsavel || "";
  el("identifierInput").value = "";
  el("updateDescriptionInput").value = "";
  el("proofInput").value = "";
  el("notesInput").value = "";
  el("updateDialog").showModal();
}

function handleUdiLoginSubmit(event) {
  event.preventDefault();
  const item = state.records.find((record) => Number(record.id) === Number(state.pendingUpdateId));
  if (!item) return;
  const user = authenticateUdi(el("udiLoginInput").value, el("udiPasswordInput").value, item.udi);
  if (!user) {
    el("udiLoginError").textContent = "Login ou senha nÃ£o autorizado para esta UDI.";
    return;
  }
  saveUdiSession(user);
  el("udiLoginDialog").close();
  openUpdateForm(item.id);
}

function updateCurrentStatusField() {
  const item = state.records.find((record) => Number(record.id) === Number(el("updateKrId").value));
  const year = el("yearInput").value;
  if (!item || !year) return;
  const status = getCurrentStatusForYear(item, year);
  el("currentStatusInput").value = status;
  el("newStatusInput").value = status;
}

async function handleUpdateSubmit(event) {
  event.preventDefault();
  const krId = Number(el("updateKrId").value);
  const item = state.records.find((record) => Number(record.id) === krId);
  const file = el("proofInput").files[0];
  const referenceYear = el("yearInput").value;
  if (!item) return;
  if (!file) {
    window.alert("Anexe uma comprovação antes de salvar a atualização.");
    return;
  }
  let proofDataUrl = "";
  try {
    proofDataUrl = await readFileAsDataUrl(file);
  } catch {
    window.alert("Não foi possível ler o arquivo de comprovação. Tente anexar novamente.");
    return;
  }

  const update = {
    updateId: `UPD-${Date.now()}`,
    registeredAt: new Date().toISOString(),
    krId,
    referenceYear,
    krTitle: item.kr,
    udi: item.udi,
    previousStatus: getCurrentStatusForYear(item, referenceYear),
    newStatus: el("newStatusInput").value,
    responsible: el("responsibleInput").value.trim(),
    identifier: el("identifierInput").value.trim(),
    description: el("updateDescriptionInput").value.trim(),
    proofName: file ? file.name : "",
    proofType: file ? file.type || "Arquivo" : "",
    proofSize: file ? file.size : "",
    proofDataUrl,
    notes: el("notesInput").value.trim(),
    source: "Painel de KRs",
  };

  state.updates.push(update);
  const archive = loadArchiveUpdates();
  archive.push(update);
  saveUpdates();
  saveArchiveUpdates(archive);
  applyLatestUpdates();
  applyFilters();
  el("updateDialog").close();
}

function exportUpdatesExcel() {
  const archiveUpdates = loadArchiveUpdates();
  const exportSource = archiveUpdates.length ? archiveUpdates : state.updates;
  const rows = [
    ["ID atualização", "Data/hora do registro", "ID KR", "Ano de referência", "Resultado-Chave", "UDI", "Status anterior", "Novo status", "Responsável pela atualização", "E-mail/Matrícula", "Descrição da atualização", "Nome do arquivo de comprovação", "Tipo do arquivo", "Tamanho do arquivo (bytes)", "Observações", "Fonte"],
    ...exportSource.map((u) => [
      u.updateId,
      formatDateTime(u.registeredAt),
      u.krId,
      u.referenceYear || "2026",
      u.krTitle,
      u.udi,
      u.previousStatus,
      u.newStatus,
      u.responsible,
      u.identifier,
      u.description,
      u.proofName,
      u.proofType,
      u.proofSize,
      u.notes,
      u.source,
    ]),
  ];
  const table = rows
    .map((row, index) => `<tr>${row.map((cell) => `<${index ? "td" : "th"}>${escapeHtml(cell)}</${index ? "td" : "th"}>`).join("")}</tr>`)
    .join("");
  const workbook = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"></head>
      <body><table>${table}</table></body>
    </html>`;
  const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `atualizacoes-krs-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function clearUpdates() {
  const ok = window.confirm("Deseja limpar apenas a visualização do site? O histórico continuará disponível na exportação para Excel.");
  if (!ok) return;
  state.updates = [];
  saveUpdates();
  applyLatestUpdates();
  applyFilters();
}

function setView(view) {
  state.view = view;
  el("cardView").classList.toggle("active", view === "cards");
  el("tableView").classList.toggle("active", view === "table");
  el("cards").classList.toggle("hidden", view !== "cards");
  el("tableWrap").classList.toggle("hidden", view !== "table");
}

async function init() {
  const payload = window.KR_DATA || await fetch("data.json").then((response) => response.json());
  state.baseRecords = payload.records;
  await loadUdiUsers();
  loadAdoPriorities();
  loadUpdates();
  applyLatestUpdates();
  state.filtered = state.records;

  el("sourceNote").textContent = `Fonte: ${payload.summary.source}`;
  fillSelect(el("statusFilter"), statusOrder, "Todos");
  fillSelect(el("udiFilter"), state.records.map((item) => item.udi), "Todas");
  fillSelect(el("classFilter"), state.records.map((item) => item.classificacao), "Todas");
  fillSelect(el("priorityFilter"), state.records.map((item) => String(item.prioridade || "")), "Todas");

  ["searchInput", "statusFilter", "udiFilter", "classFilter", "priorityFilter", "adoPriorityFilter"].forEach((id) => {
    el(id).addEventListener("input", applyFilters);
  });
  el("clearFilters").addEventListener("click", () => {
    ["searchInput", "statusFilter", "udiFilter", "classFilter", "priorityFilter"].forEach((id) => {
      el(id).value = "";
    });
    el("adoPriorityFilter").checked = false;
    applyFilters();
  });
  el("cardView").addEventListener("click", () => setView("cards"));
  el("tableView").addEventListener("click", () => setView("table"));
  el("closeDialog").addEventListener("click", () => el("detailDialog").close());
  el("closeUpdateDialog").addEventListener("click", () => el("updateDialog").close());
  el("cancelUpdate").addEventListener("click", () => el("updateDialog").close());
  el("udiLoginForm").addEventListener("submit", handleUdiLoginSubmit);
  el("closeUdiLoginDialog").addEventListener("click", () => el("udiLoginDialog").close());
  el("cancelUdiLogin").addEventListener("click", () => el("udiLoginDialog").close());
  el("yearInput").addEventListener("change", updateCurrentStatusField);
  el("updateForm").addEventListener("submit", handleUpdateSubmit);
  if (el("exportUpdates")) el("exportUpdates").addEventListener("click", exportUpdatesExcel);
  if (el("clearUpdates")) el("clearUpdates").addEventListener("click", clearUpdates);

  applyFilters();
}

init();
