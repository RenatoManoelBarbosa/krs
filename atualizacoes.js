const STORAGE_KEY = "painel-krs-atualizacoes-v1";
const ARCHIVE_KEY = "painel-krs-atualizacoes-arquivo-v1";
const SESSION_KEY = "painel-krs-auth-v1";
const el = (id) => document.getElementById(id);

let authorizedUsers = [{ login: "ADMIN", senha: "ADMIN", nome: "Administrador", ativo: "Sim" }];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateTime(iso) {
  if (!iso) return "nenhuma";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

function loadUpdates() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveUpdates(updates) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updates));
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

async function loadAuthorizedUsers() {
  try {
    const response = await fetch("usuarios-acesso.csv", { cache: "no-store" });
    if (!response.ok) throw new Error("Arquivo de usuários indisponível");
    const users = parseCsv(await response.text()).filter((user) => user.login && user.senha);
    if (users.length) authorizedUsers = users;
  } catch {
    authorizedUsers = [{ login: "ADMIN", senha: "ADMIN", nome: "Administrador", ativo: "Sim" }];
  }
}

function isActiveUser(user) {
  return !["não", "nao", "false", "0", "inativo"].includes(String(user.ativo || "sim").toLowerCase());
}

function authenticate(login, password) {
  const normalizedLogin = String(login || "").trim().toLowerCase();
  return authorizedUsers.find((user) =>
    String(user.login || "").trim().toLowerCase() === normalizedLogin &&
    String(user.senha || "") === String(password || "") &&
    isActiveUser(user)
  );
}

function showProtectedContent(user) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ login: user.login, nome: user.nome || user.login }));
  el("loginPanel").classList.add("hidden");
  el("protectedContent").classList.remove("hidden");
  renderUpdates();
}

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  el("protectedContent").classList.add("hidden");
  el("loginPanel").classList.remove("hidden");
}

function migrateArchiveIfNeeded() {
  const visible = loadUpdates();
  const archive = loadArchiveUpdates();
  if (archive.length === 0 && visible.length > 0) {
    saveArchiveUpdates(visible);
  }
}

function getUpdatesData() {
  migrateArchiveIfNeeded();
  return {
    visible: loadUpdates(),
    all: loadArchiveUpdates().length ? loadArchiveUpdates() : loadUpdates(),
  };
}

function renderUpdates() {
  const payload = getUpdatesData();
  const updates = payload.visible.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
  const allUpdates = payload.all.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
  el("updatesCount").textContent = updates.length;
  el("lastUpdateLabel").textContent = allUpdates[0] ? formatDateTime(allUpdates[0].registeredAt) : "nenhuma";
  el("updatesList").innerHTML = updates.length
    ? updates.map((update) => `
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
          ${update.notes ? `<p><strong>Observações:</strong> ${escapeHtml(update.notes)}</p>` : ""}
        </article>
      `).join("")
    : `<article class="update-item"><strong>Nenhuma atualização visível.</strong><p>Volte ao painel principal e use "Atualizar status" em um KR. A exportação mantém todo o histórico já registrado.</p></article>`;
}

function excelCell(value) {
  return `<Cell><Data ss:Type="String">${escapeHtml(value)}</Data></Cell>`;
}

function worksheetXml(name, rows) {
  const body = rows.map((row) => `<Row>${row.map(excelCell).join("")}</Row>`).join("");
  return `<Worksheet ss:Name="${escapeHtml(name)}"><Table>${body}</Table></Worksheet>`;
}

function exportUpdatesExcel() {
  const archive = loadArchiveUpdates();
  const updates = (archive.length ? archive : loadUpdates()).sort((a, b) => new Date(a.registeredAt) - new Date(b.registeredAt));
  const headers = [
    "ID atualização",
    "Data/hora do registro",
    "ID KR",
    "Ano de referência",
    "Resultado-Chave",
    "UDI",
    "Status anterior",
    "Novo status",
    "Responsável pela atualização",
    "E-mail/Matrícula",
    "Descrição da atualização",
    "Nome do arquivo de comprovação",
    "Tipo do arquivo",
    "Tamanho do arquivo (bytes)",
    "Observações",
    "Fonte",
  ];
  const rows = updates.map((u) => [
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
  ]);
  const summaryRows = [
    ["Indicador", "Valor"],
    ["Total de atualizações", updates.length],
    ["Última atualização", updates[updates.length - 1] ? formatDateTime(updates[updates.length - 1].registeredAt) : "nenhuma"],
  ];
  const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  ${worksheetXml("Resumo", summaryRows)}
  ${worksheetXml("Lista de Atualizações", [headers, ...rows])}
</Workbook>`;
  const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `banco-atualizacoes-krs-lista-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function clearUpdates() {
  const ok = window.confirm("Deseja limpar apenas a visualização do site? O histórico continuará disponível na exportação para Excel.");
  if (!ok) return;
  saveUpdates([]);
  renderUpdates();
}

async function initAuth() {
  await loadAuthorizedUsers();
  const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  if (session?.login) {
    const user = authorizedUsers.find((item) => String(item.login).toLowerCase() === String(session.login).toLowerCase());
    if (user && isActiveUser(user)) {
      showProtectedContent(user);
    }
  }
  el("loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const user = authenticate(el("loginInput").value, el("passwordInput").value);
    if (!user) {
      el("loginMessage").textContent = "Login ou senha inválidos.";
      return;
    }
    el("loginMessage").textContent = "";
    showProtectedContent(user);
  });
  el("logoutButton").addEventListener("click", logout);
  el("exportUpdates").addEventListener("click", exportUpdatesExcel);
  el("clearUpdates").addEventListener("click", clearUpdates);
}

initAuth();
