const STORAGE_KEYS = {
  accounts: "ctgptm.mail.accounts",
  categories: "ctgptm.mail.categories",
  refreshQueue: "ctgptm.mail.refreshQueue",
  refreshSettings: "ctgptm.mail.refreshSettings",
};

const EMPTY_CATEGORY_LABEL = "未分组";
const storedRefreshQueue = loadJson(STORAGE_KEYS.refreshQueue, []);
const normalizedRefreshQueue = normalizeQueue(storedRefreshQueue);
if (JSON.stringify(storedRefreshQueue) !== JSON.stringify(normalizedRefreshQueue)) {
  saveJson(STORAGE_KEYS.refreshQueue, normalizedRefreshQueue);
}

const state = {
  accounts: loadJson(STORAGE_KEYS.accounts, []),
  categories: loadJson(STORAGE_KEYS.categories, []),
  queue: normalizedRefreshQueue,
  selectedAccounts: new Set(),
  selectedQueue: new Set(),
  jobs: new Map(),
  poller: undefined,
  sourcePage: 1,
  savedRefreshResults: new Map(),
};

const els = {
  sourceTotal: document.querySelector("#sourceTotal"),
  sourceSearch: document.querySelector("#sourceSearch"),
  sourceType: document.querySelector("#sourceType"),
  sourceCategory: document.querySelector("#sourceCategory"),
  sourceSelectAll: document.querySelector("#sourceSelectAll"),
  addSelected: document.querySelector("#addSelected"),
  sourcePageSize: document.querySelector("#sourcePageSize"),
  sourcePrev: document.querySelector("#sourcePrev"),
  sourceNext: document.querySelector("#sourceNext"),
  sourcePageText: document.querySelector("#sourcePageText"),
  sourceList: document.querySelector("#sourceList"),
  startSelected: document.querySelector("#startSelected"),
  retryFailed: document.querySelector("#retryFailed"),
  exportCpa: document.querySelector("#exportCpa"),
  exportSub2: document.querySelector("#exportSub2"),
  clearQueue: document.querySelector("#clearQueue"),
  useProxy: document.querySelector("#useProxy"),
  proxyUrl: document.querySelector("#proxyUrl"),
  loginStrategy: document.querySelector("#loginStrategy"),
  loginConcurrency: document.querySelector("#loginConcurrency"),
  queueTotal: document.querySelector("#queueTotal"),
  queueIdle: document.querySelector("#queueIdle"),
  queueRunning: document.querySelector("#queueRunning"),
  queueSuccess: document.querySelector("#queueSuccess"),
  queueFailed: document.querySelector("#queueFailed"),
  queueProgress: document.querySelector("#queueProgress"),
  queueBody: document.querySelector("#queueBody"),
  clearLogs: document.querySelector("#clearLogs"),
  logHint: document.querySelector("#logHint"),
  logList: document.querySelector("#logList"),
  toast: document.querySelector("#toast"),
  autoUpdateCpa: document.querySelector("#autoUpdateCpa"),
  cpaBaseUrl: document.querySelector("#cpaBaseUrl"),
  cpaManagementKey: document.querySelector("#cpaManagementKey"),
  taskMode: document.querySelector("#taskMode"),
};

const settings = loadJson(STORAGE_KEYS.refreshSettings, {});
els.useProxy.checked = true;
els.proxyUrl.value = settings.proxy_url || "";
if (els.loginStrategy) els.loginStrategy.value = "protocol";
els.loginConcurrency.value = String(Math.min(2, Math.max(1, Number(settings.login_concurrency || 1))));
if (els.autoUpdateCpa) els.autoUpdateCpa.checked = Boolean(settings.auto_update_cpa);
if (els.cpaBaseUrl) els.cpaBaseUrl.value = settings.cpa_base_url || "";
if (els.cpaManagementKey) els.cpaManagementKey.value = settings.cpa_management_key || "";
if (els.taskMode) els.taskMode.value = settings.task_mode || "login";
if (els.loginStrategy) els.loginStrategy.value = "protocol";
if (els.taskMode) els.taskMode.value = "login";

const authQueryToken = new URLSearchParams(window.location.search).get("token") || "";
if (authQueryToken) {
  localStorage.setItem("ctgptm.admin.toolToken", authQueryToken);
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function rememberedAdminToken() {
  return authQueryToken || localStorage.getItem("ctgptm.admin.toolToken") || "";
}

function apiHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = rememberedAdminToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function withAdminToken(url) {
  const token = rememberedAdminToken();
  if (!token || !url || /^https?:\/\//i.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function epochSecondsFromValue(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric > 1e11 ? numeric / 1000 : numeric);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : undefined;
}

function toast(text) {
  els.toast.textContent = text;
  els.toast.classList.add("show");
  clearTimeout(els.toast._timer);
  els.toast._timer = setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function parseErrorPayload(data, fallback = "启动失败") {
  return {
    error: data?.error || data?.message || fallback,
    error_code: data?.error_code || data?.code || "",
    error_hint: data?.error_hint || data?.hint || "",
  };
}

function accountEmailKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isCodePickupError(code, text = "") {
  const rawCode = String(code || "").toLowerCase();
  const rawText = String(text || "").toLowerCase();
  return rawCode === "verification_code_missing"
    || rawCode === "email_code_missing"
    || rawCode === "otp_missing"
    || rawText.includes("verification code")
    || rawText.includes("no verification code")
    || rawText.includes("验证码")
    || rawText.includes("接码");
}

function isPhoneVerificationError(code, text = "") {
  const rawCode = String(code || "").toLowerCase();
  const rawText = String(text || "").toLowerCase();
  return rawCode === "phone_verification_required"
    || rawCode === "mfa_required"
    || rawText.includes("phone verification")
    || rawText.includes("phone number")
    || rawText.includes("mobile")
    || rawText.includes("手机号")
    || rawText.includes("手机验证")
    || rawText.includes("手机号码")
    || rawText.includes("接手机验证码");
}

async function readJsonResponse(response, fallback = "请求失败") {
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
  }
  if (!response.ok) {
    const details = parseErrorPayload(data, fallback);
    const error = new Error(details.error || fallback);
    error.details = details;
    throw error;
  }
  return data;
}

function proxyFormatError(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  const netloc = withScheme.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/, 1)[0];
  if (!netloc.includes("@") && netloc.split(":").length >= 4) {
    return "代理格式错误：请使用 http://用户名:密码@host:port，不能写成 http://host:port:用户名:密码";
  }
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return "代理地址无法识别。正确格式是 http://用户名:密码@host:port";
  }
  if (!parsed.hostname || !parsed.port) {
    return "代理地址需要包含主机和端口。正确格式是 http://用户名:密码@host:port";
  }
  if (!parsed.username && parsed.host.split(":").length > 2) {
    return "代理格式错误：请使用 http://用户名:密码@host:port，不能写成 http://host:port:用户名:密码";
  }
  return "";
}

function failRow(row, details) {
  row.status = "failed";
  row.error = details.error || "启动失败";
  row.error_code = details.error_code || "";
  row.error_hint = details.error_hint || "";
  state.jobs.set(row.id, {
    status: "failed",
    jobId: row.jobId || "",
    error: row.error,
    error_code: row.error_code,
    error_hint: row.error_hint,
    logs: row.logs || [],
  });
  saveQueue();
  renderQueue();
  addLog(`${row.email} ${formatJobError(rowState(row))}`, "error");
}

function saveSettings() {
  saveJson(STORAGE_KEYS.refreshSettings, {
    use_proxy: true,
    proxy_url: els.proxyUrl.value.trim(),
    login_strategy: "protocol",
    login_concurrency: Math.min(2, Math.max(1, Number(els.loginConcurrency?.value || 1))),
    auto_update_cpa: els.autoUpdateCpa ? els.autoUpdateCpa.checked : false,
    cpa_base_url: els.cpaBaseUrl ? els.cpaBaseUrl.value.trim() : "",
    cpa_management_key: els.cpaManagementKey ? els.cpaManagementKey.value.trim() : "",
    task_mode: els.taskMode ? els.taskMode.value : "login",
  });
}

function isLegacyPasswordMissingError(value) {
  return /缺少登录密码|缺少\s*OpenAI\s*登录密码|请导入\s*Outlook\s*四段/i.test(String(value || ""));
}

function sanitizeLegacyRefreshRow(row) {
  const logs = Array.isArray(row.logs) ? row.logs : [];
  const hasLegacyPasswordError = isLegacyPasswordMissingError(row.error)
    || logs.some((entry) => isLegacyPasswordMissingError(entry?.message || entry));
  if (!hasLegacyPasswordError) {
    return { row, changed: false };
  }
  const cleanLogs = logs.filter((entry) => !isLegacyPasswordMissingError(entry?.message || entry));
  return {
    changed: true,
    row: {
      ...row,
      status: "idle",
      error: "",
      error_code: "",
      error_hint: "",
      jobId: "",
      logs: cleanLogs,
    },
  };
}

function normalizeQueue(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(Boolean).map((row) => {
    const normalized = {
      ...row,
      id: String(row.id || `refresh:${row.email || row.name || crypto.randomUUID()}`),
      email: String(row.email || ""),
      name: String(row.name || row.email || ""),
      source_kind: row.source_kind || "local",
      source: row.source || (row.source_kind === "cpa" ? "cpa" : "local"),
      service: row.service || (row.source_kind === "cpa" ? "CPA" : ""),
      cpa_name: row.cpa_name || "",
      auth_index: row.auth_index || "",
      cpa_base_url: row.cpa_base_url || "",
      cpa_management_key: row.cpa_management_key || "",
      use_proxy: Boolean(row.use_proxy),
      proxy_url: row.proxy_url || "",
      login_strategy: "protocol",
      status: row.status || "idle",
      error: row.error || "",
      error_code: row.error_code || "",
      error_hint: row.error_hint || "",
      logs: Array.isArray(row.logs) ? row.logs : [],
    };
    return sanitizeLegacyRefreshRow(normalized).row;
  });
}

function saveQueue() {
  saveJson(STORAGE_KEYS.refreshQueue, state.queue);
}

function sourceLabel(account) {
  if (account.source === "microsoft") return account.service || "Outlook";
  return "临时邮箱";
}

function sourceTone(account) {
  if (account.service === "Cloud Mail") return "cloud";
  return account.source === "microsoft" ? "ms" : "temp";
}

function sourceRefreshState(account) {
  const key = accountEmailKey(account.email);
  if (!key) return { status: "idle", label: "未处理", tone: "idle", message: "" };
  const saved = state.savedRefreshResults.get(key);
  const rows = state.queue.filter((row) => accountEmailKey(row.email || row.name) === key);
  if (saved?.auth_file || rows.some((row) => row.auth_file || rowState(row).status === "success")) {
    return { status: "success", label: "成功", tone: "success", message: "已生成 auth_file" };
  }
  const failed = rows.find((row) => {
    const job = rowState(row);
    return job.status === "failed" && isPhoneVerificationError(job.error_code, `${job.error || ""} ${job.error_hint || ""}`);
  });
  if (failed) {
    return { status: "failed", label: "手机验证", tone: "failed", message: formatJobError(rowState(failed)) };
  }
  const needsCode = rows.find((row) => {
    const job = rowState(row);
    return job.status === "failed" && isCodePickupError(job.error_code, `${job.error || ""} ${job.error_hint || ""}`);
  });
  if (needsCode) {
    return { status: "needs_code", label: "需要接码", tone: "needs-code", message: formatJobError(rowState(needsCode)) };
  }
  const anyFailed = rows.find((row) => rowState(row).status === "failed");
  if (anyFailed) {
    return { status: "failed", label: "失败", tone: "failed", message: formatJobError(rowState(anyFailed)) };
  }
  if (rows.some((row) => ["queued", "running"].includes(rowState(row).status))) {
    return { status: "running", label: "执行中", tone: "running", message: "" };
  }
  return { status: "idle", label: "未处理", tone: "idle", message: "" };
}

function accountOptions(active) {
  const options = [
    ["all", "全部状态"],
    ["success", "成功"],
    ["failed", "失败"],
    ["needs_code", "需要接码"],
  ];
  return options.map(([value, label]) => {
    return `<option value="${escapeHtml(value)}"${value === active ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function filteredAccounts() {
  const query = els.sourceSearch.value.trim().toLowerCase();
  const type = els.sourceType.value;
  const category = els.sourceCategory.value;
  return state.accounts.filter((account) => {
    if (type !== "all" && account.source !== type) return false;
    const refreshState = sourceRefreshState(account);
    if (category !== "all" && refreshState.status !== category) return false;
    if (query && !String(account.email || "").toLowerCase().includes(query)) return false;
    return true;
  });
}

function renderSources() {
  els.sourceCategory.innerHTML = accountOptions(els.sourceCategory.value || "all");
  const accounts = filteredAccounts();
  els.sourceTotal.textContent = String(accounts.length);
  const size = Number(els.sourcePageSize.value || 20);
  const pages = Math.max(1, Math.ceil(accounts.length / size));
  state.sourcePage = Math.min(Math.max(1, state.sourcePage), pages);
  const pageItems = accounts.slice((state.sourcePage - 1) * size, state.sourcePage * size);
  els.sourcePageText.textContent = `${state.sourcePage} / ${pages}`;
  els.sourcePrev.disabled = state.sourcePage <= 1;
  els.sourceNext.disabled = state.sourcePage >= pages;
  if (!pageItems.length) {
    els.sourceList.className = "mailbox-list empty";
    els.sourceList.textContent = state.accounts.length ? "没有匹配的邮箱" : "请先在账号管理页导入邮箱";
    return;
  }
  els.sourceList.className = "mailbox-list";
  els.sourceList.innerHTML = pageItems.map((account) => {
    const refreshState = sourceRefreshState(account);
    return `
      <div class="mailbox-row refresh-state-${escapeHtml(refreshState.tone)}" data-id="${escapeHtml(account.id)}" title="${escapeHtml(refreshState.message)}">
        <label class="mailbox-check">
          <input type="checkbox" ${state.selectedAccounts.has(account.id) ? "checked" : ""}>
          <span>
            <strong>${escapeHtml(account.email)}</strong>
            <em><b class="source-badge ${escapeHtml(sourceTone(account))}">${escapeHtml(sourceLabel(account))}</b></em>
          </span>
        </label>
        <span class="source-badge refresh-badge ${escapeHtml(refreshState.tone)}">${escapeHtml(refreshState.label)}</span>
      </div>
    `;
  }).join("");
}

function queueKey(account) {
  return [
    account.source_kind || account.source || "local",
    String(account.email || account.name || "").toLowerCase(),
    String(account.cpa_name || account.auth_index || ""),
  ].join("|");
}

function addSelectedToQueue() {
  const selected = state.accounts.filter((account) => state.selectedAccounts.has(account.id));
  if (!selected.length) {
    toast("先在左侧选择邮箱");
    return;
  }
  const byEmail = new Map(state.queue.map((row) => [queueKey(row), row]));
  let added = 0;
  selected.forEach((account) => {
    const key = queueKey(account);
    if (byEmail.has(key)) {
      state.selectedQueue.add(byEmail.get(key).id);
      return;
    }
    const row = {
      id: `refresh:${account.id}`,
      source_kind: "local",
      email: account.email,
      name: account.email,
      account_id: account.id,
      source: account.source,
      service: sourceLabel(account),
      status: "idle",
      error: "",
      logs: [],
      auth_file: account.auth_file || null,
    };
    byEmail.set(key, row);
    state.selectedQueue.add(row.id);
    added += 1;
  });
  state.queue = [...byEmail.values()];
  saveQueue();
  renderQueue();
  addLog(`加入刷新队列：${selected.length} 个账号，新增 ${added} 个`, "info");
}

function rowState(row) {
  return state.jobs.get(row.id) || {
    status: row.status || "idle",
    jobId: row.jobId || "",
    error: row.error || "",
    error_code: row.error_code || "",
    error_hint: row.error_hint || "",
    logs: row.logs || [],
  };
}

function loginLabel(status) {
  return {
    idle: "等待",
    queued: "排队",
    running: "登录中",
    success: "成功",
    failed: "失败",
    challenge: "安全验证",
  }[status] || status || "等待";
}

function formatJobError(job) {
  const parts = [];
  if (job.error_code) parts.push(`[${job.error_code}]`);
  if (job.error) parts.push(job.error);
  if (job.error_hint) parts.push(`建议：${job.error_hint}`);
  return parts.join(" ") || "-";
}

function displayStatus(job) {
  if (job.status === "failed" && job.error_code === "openai_turnstile_challenge") {
    return "challenge";
  }
  return job.status || "idle";
}

function renderQueueProgress(counts) {
  if (!els.queueProgress) return;
  const total = state.queue.length;
  const done = (counts.success || 0) + (counts.failed || 0);
  const running = (counts.queued || 0) + (counts.running || 0);
  const percent = total ? Math.round((done / total) * 100) : 0;
  const visualPercent = running && percent === 0 ? 8 : percent;
  const bar = els.queueProgress.querySelector("i");
  const label = els.queueProgress.querySelector("em");
  els.queueProgress.hidden = total === 0;
  if (bar) bar.style.width = `${visualPercent}%`;
  if (label) label.textContent = running ? `${done} / ${total} · 执行中 ${running}` : `${done} / ${total}`;
}

function renderQueue() {
  const counts = { idle: 0, queued: 0, running: 0, success: 0, failed: 0 };
  state.queue.forEach((row) => {
    const status = rowState(row).status || "idle";
    counts[status] = (counts[status] || 0) + 1;
  });
  els.queueTotal.textContent = String(state.queue.length);
  els.queueIdle.textContent = String(counts.idle || 0);
  els.queueRunning.textContent = String((counts.queued || 0) + (counts.running || 0));
  els.queueSuccess.textContent = String(counts.success || 0);
  els.queueFailed.textContent = String(counts.failed || 0);
  renderQueueProgress(counts);
  if (!state.queue.length) {
    els.queueBody.innerHTML = '<tr><td colspan="6" class="empty-cell">从左侧选择邮箱加入刷新队列。</td></tr>';
    return;
  }
  els.queueBody.innerHTML = state.queue.map((row) => {
    const job = rowState(row);
    const status = displayStatus(job);
    const rawStatus = job.status || "idle";
    const errorText = formatJobError(job);
    return `
      <tr data-id="${escapeHtml(row.id)}">
        <td><input class="abnormal-check queue-check" type="checkbox" ${state.selectedQueue.has(row.id) ? "checked" : ""}></td>
        <td>
          <strong>${escapeHtml(row.email || row.name || "-")}</strong>
          <em>${escapeHtml(row.service || "本地邮箱")}</em>
        </td>
        <td><span class="source-badge ${escapeHtml(row.source === "microsoft" ? "ms" : "temp")}">${escapeHtml(row.service || "本地邮箱")}</span></td>
        <td><span class="login-status ${escapeHtml(status)}">${escapeHtml(loginLabel(status))}</span></td>
        <td><div class="login-error" title="${escapeHtml(errorText)}">${escapeHtml(errorText)}</div></td>
        <td><button class="login-one" type="button" ${rawStatus === "running" || rawStatus === "queued" ? "disabled" : ""}>执行</button></td>
      </tr>
    `;
  }).join("");
}

function selectedQueueRows({ failedOnly = false } = {}) {
  const chosen = state.queue.filter((row) => state.selectedQueue.has(row.id));
  const base = chosen.length ? chosen : state.queue;
  return failedOnly ? base.filter((row) => rowState(row).status === "failed") : base;
}

function accountForRow(row) {
  if (row.account_id) {
    const byId = state.accounts.find((account) => account.id === row.account_id);
    if (byId) return byId;
  }
  const email = String(row.email || "").toLowerCase();
  return state.accounts.find((account) => String(account.email || "").toLowerCase() === email) || null;
}

function loginPayload(row) {
  const account = accountForRow(row) || row;
  const email = account.email || row.email;
  const sameEmail = state.accounts.filter((item) => String(item.email || "").toLowerCase() === String(email || "").toLowerCase());
  const isCpa = row.source_kind === "cpa";
  const mode = els.taskMode ? els.taskMode.value : "login";
  
  let base_url = isCpa ? row.cpa_base_url || "" : "";
  let management_key = isCpa ? row.cpa_management_key || "" : "";
  
  if (els.autoUpdateCpa && els.autoUpdateCpa.checked) {
    if (!base_url) base_url = els.cpaBaseUrl.value.trim();
    if (!management_key) management_key = els.cpaManagementKey.value.trim();
  }

  let password = account.password || row.password || "";
  if (mode === "signup" && !password) {
    // Generate a secure random password if empty during registration
    password = Math.random().toString(36).slice(-8) + "aA1!";
  }

  return {
    mode,
    login_only: true,
    base_url,
    management_key,
    name: row.cpa_name || row.name || email,
    use_proxy: true,
    proxy_url: isCpa ? row.proxy_url || els.proxyUrl.value.trim() : els.proxyUrl.value.trim(),
    login_strategy: "protocol",
    email,
    password,
    row: {
      ...row,
      name: row.cpa_name || row.name || email,
      email,
      source: row.source_kind || "local",
    },
    accounts: sameEmail
      .filter((item) => item.source === "microsoft")
      .map((item) => ({
        email: item.email,
        password: item.password,
        client_id: item.client_id,
        refresh_token: item.refresh_token,
      })),
    temp_addresses: sameEmail
      .filter((item) => item.source === "temp")
      .map((item) => ({
        email: item.email,
        jwt: item.jwt,
        base_url: item.base_url,
        site_password: item.site_password,
      })),
  };
}

function addLog(message, type = "info", meta = {}) {
  if (els.logList.firstElementChild?.textContent === "等待操作。") {
    els.logList.innerHTML = "";
  }
  const item = document.createElement("div");
  item.className = `client-log-item ${type}`;
  const snapshotUrl = meta.snapshot_url || meta.snapshotUrl || "";
  const snapshotAction = snapshotUrl
    ? `<a class="log-snapshot-link" href="${escapeHtml(withAdminToken(snapshotUrl))}" target="_blank" rel="noreferrer">打开截图</a>`
    : "";
  item.innerHTML = `
    <span>${escapeHtml(new Date().toLocaleTimeString())}</span>
    <strong>${escapeHtml(type.toUpperCase())}</strong>
    <em>${escapeHtml(message)}${snapshotAction}</em>
  `;
  els.logList.prepend(item);
  while (els.logList.children.length > 300) {
    els.logList.lastElementChild.remove();
  }
  els.logHint.textContent = message;
}

async function startLogin(row) {
  const payload = loginPayload(row);
  if (!payload.proxy_url) {
    toast("凭证刷新必须填写代理 URL");
    failRow(row, { error: "凭证刷新必须填写代理 URL", error_code: "proxy_required", error_hint: "示例：http://USER:PASS@host:port 或 socks5://USER:PASS@host:port" });
    return;
  }
  const localProxyError = proxyFormatError(payload.proxy_url);
  if (localProxyError) {
    failRow(row, {
      error: localProxyError,
      error_code: "proxy_format_invalid",
      error_hint: "示例：http://USER:PASS@us.rrp.bestgo.work:10000；用户名和密码必须写在 @ 前面。",
    });
    return;
  }
  row.status = "queued";
  row.error = "";
  row.error_code = "";
  row.error_hint = "";
  state.jobs.set(row.id, { status: "queued", error: "", logs: [] });
  saveQueue();
  renderQueue();
  addLog(`${row.email} 启动邮箱登录账号`, "info");
  try {
    const response = await fetch("/client-api/cpa/login-start", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response, "启动失败");
    if (!data.success) {
      const details = parseErrorPayload(data, "启动失败");
      const error = new Error(details.error || "启动失败");
      error.details = details;
      throw error;
    }
    row.jobId = data.job?.job_id || "";
    row.status = data.job?.status || "queued";
    state.jobs.set(row.id, { status: row.status, jobId: row.jobId, error: "", logs: [] });
    saveQueue();
    startPolling();
  } catch (error) {
    failRow(row, error.details || { error: error.message || "启动失败" });
  }
  renderQueue();
}

async function startRows(rows) {
  if (!rows.length) {
    toast("没有可执行账号");
    return;
  }
  saveSettings();
  els.startSelected.disabled = true;
  els.retryFailed.disabled = true;
  const oldText = els.startSelected.textContent;
  els.startSelected.textContent = "执行中";
  const concurrency = Math.min(2, Math.max(1, Number(els.loginConcurrency?.value || 1)));
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor];
      cursor += 1;
      await startLogin(row);
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));
  } finally {
    els.startSelected.disabled = false;
    els.retryFailed.disabled = false;
    els.startSelected.textContent = oldText;
  }
}

function startPolling() {
  if (state.poller) return;
  state.poller = setInterval(pollJobs, 2000);
}

async function pollJobs() {
  const pending = state.queue.filter((row) => ["queued", "running"].includes(rowState(row).status));
  if (!pending.length) {
    clearInterval(state.poller);
    state.poller = undefined;
    return;
  }
  for (const row of pending) {
    const current = rowState(row);
    if (!current.jobId) continue;
    try {
      const response = await fetch(`/client-api/cpa/login-status?job_id=${encodeURIComponent(current.jobId)}`, { headers: apiHeaders(), cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "读取任务失败");
      const job = data.job || {};
      const oldCount = current.logs?.length || 0;
      (job.logs || []).slice(oldCount).forEach((entry) => addLog(`${row.email} ${entry.message || ""}`, entry.level || "info", entry));
      const result = job.result || {};
      const authFile = result.auth_file || result.result?.auth_file || null;
      if (authFile && typeof authFile === "object") {
        row.auth_file = authFile;
        const account = accountForRow(row);
        if (account) {
          account.auth_file = authFile;
          account.access_token = authFile.access_token || account.access_token || "";
          account.refresh_token = authFile.refresh_token || account.refresh_token || "";
          account.id_token = authFile.id_token || account.id_token || "";
          account.session_token = authFile.session_token || account.session_token || "";
          account.account_id = authFile.account_id || authFile.chatgpt_account_id || account.account_id || "";
          account.chatgpt_account_id = authFile.chatgpt_account_id || authFile.account_id || account.chatgpt_account_id || "";
          account.plan_type = authFile.plan_type || authFile.chatgpt_plan_type || account.plan_type || "";
          account.last_refresh = authFile.last_refresh || new Date().toISOString();
        }
      }
      
      const regPassword = result.registration_password || result.result?.registration_password;
      if (regPassword) {
        row.password = regPassword;
        const account = accountForRow(row);
        if (account) {
          account.password = regPassword;
        }
      }
      row.status = job.status || "running";
      row.error = job.error || "";
      row.error_code = job.error_code || "";
      if (row.status === "failed" && isPhoneVerificationError(row.error_code, row.error)) {
        row.error_code = "phone_verification_required";
        row.error = "需要手机验证，已按失败处理";
      }
      row.error_hint = job.error_hint || "";
      row.logs = job.logs || [];
      if (job.error_hint && row.status === "failed") {
        addLog(`${row.email} 建议：${job.error_hint}`, "warning");
      }
      state.jobs.set(row.id, {
        status: row.status,
        jobId: current.jobId,
        error: row.error,
        error_code: row.error_code,
        error_hint: row.error_hint,
        logs: row.logs,
      });
      if (row.status === "success" && row.auth_file) {
        state.savedRefreshResults.set(accountEmailKey(row.email), {
          email: row.email,
          name: row.name || row.email,
          auth_file: row.auth_file,
        });
      }
      saveJson(STORAGE_KEYS.accounts, state.accounts);
      saveQueue();
    } catch (error) {
      row.status = "failed";
      row.error = error.message || "读取任务失败";
      state.jobs.set(row.id, { status: "failed", jobId: current.jobId, error: row.error, logs: current.logs || [] });
      addLog(`${row.email} ${row.error}`, "error");
      saveQueue();
    }
  }
  renderAll();
}

function accountSub2apiItem(row, authFile) {
  const expiresAt = epochSecondsFromValue(authFile.expired);
  return compactObject({
    name: authFile.name || row.email,
    platform: "openai",
    type: "oauth",
    expires_at: expiresAt,
    auto_pause_on_expired: true,
    concurrency: 10,
    priority: 1,
    credentials: compactObject({
      access_token: authFile.access_token,
      refresh_token: authFile.refresh_token,
      id_token: authFile.id_token,
      session_token: authFile.session_token,
      chatgpt_account_id: authFile.chatgpt_account_id || authFile.account_id || "",
      email: authFile.email || row.email,
      expires_at: expiresAt,
      plan_type: authFile.plan_type || "",
    }),
    extra: compactObject({
      email: authFile.email || row.email,
      name: authFile.name || row.email,
      source: "gpt_account_manager_refresh",
      last_refresh: authFile.last_refresh || "",
    }),
  });
}

function downloadJsonFile(fileName, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function savedRefreshRows() {
  try {
    const response = await fetch("/api/refresh-results", { headers: apiHeaders(), cache: "no-store" });
    const data = await readJsonResponse(response, "读取已保存刷新结果失败");
    return (data.results || [])
      .filter((item) => item?.auth_file)
      .map((item) => ({
        row: {
          email: item.email || item.auth_file?.email || "",
          name: item.name || item.auth_file?.name || item.email || "",
          source: "saved",
        },
        authFile: item.auth_file,
      }));
  } catch (error) {
    addLog(`读取已保存刷新结果失败：${error.message || "unknown"}`, "warning");
    return [];
  }
}

async function syncRefreshResults() {
  try {
    const response = await fetch("/api/refresh-results", { headers: apiHeaders(), cache: "no-store" });
    const data = await readJsonResponse(response, "读取已保存刷新结果失败");
    state.savedRefreshResults = new Map(
      (data.results || [])
        .filter((item) => item?.auth_file)
        .map((item) => [accountEmailKey(item.email || item.auth_file?.email), item])
        .filter(([email]) => email)
    );
    renderSources();
  } catch (error) {
    addLog(`读取已保存刷新结果失败：${error.message || "unknown"}`, "warning");
  }
}

async function exportResults(format) {
  const selected = selectedQueueRows();
  let rows = selected.map((row) => ({ row, authFile: row.auth_file })).filter((item) => item.authFile);
  if (!rows.length) {
    rows = await savedRefreshRows();
  }
  if (!rows.length) {
    toast("没有可下载的刷新结果");
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (format === "cpa") {
    const files = rows.map((item) => item.authFile);
    downloadJsonFile(`gpt-account-manager-cpa-auth-${stamp}.json`, files.length === 1 ? files[0] : files);
    return;
  }
  downloadJsonFile(`gpt-account-manager-sub2api-accounts-${stamp}.json`, {
    exported_at: new Date().toISOString(),
    proxies: [],
    accounts: rows.map((item) => accountSub2apiItem(item.row, item.authFile)),
  });
}

function renderAll() {
  renderSources();
  renderQueue();
}

function normalizeServerAccount(item, source) {
  const email = String(item?.email || "").trim();
  if (!email) return null;
  return {
    id: String(source === "temp" ? `temp:${email.toLowerCase()}` : `microsoft:${email.toLowerCase()}`),
    email,
    name: email,
    source: source === "temp" ? "temp" : "microsoft",
    service: source === "temp" ? "Cloud Mail" : "Outlook",
    category: String(item?.label || item?.category || "").trim(),
    auth_file: null,
  };
}

async function syncAccountsFromServer() {
  if (!rememberedAdminToken()) return;
  try {
    const [accountsResponse, tempResponse] = await Promise.all([
      fetch("/api/accounts", { headers: apiHeaders(), cache: "no-store" }),
      fetch("/api/temp-addresses", { headers: apiHeaders(), cache: "no-store" }),
    ]);
    const [accountsData, tempData] = await Promise.all([
      accountsResponse.json(),
      tempResponse.json(),
    ]);
    if (!accountsResponse.ok) throw new Error(accountsData.error || accountsResponse.statusText || "Failed to load Outlook accounts");
    if (!tempResponse.ok) throw new Error(tempData.error || tempResponse.statusText || "Failed to load temp accounts");
    state.accounts = [
      ...((accountsData.accounts || []).map((item) => normalizeServerAccount(item, "microsoft")).filter(Boolean)),
      ...((tempData.addresses || []).map((item) => normalizeServerAccount(item, "temp")).filter(Boolean)),
    ];
    saveJson(STORAGE_KEYS.accounts, state.accounts);
    renderAll();
  } catch (error) {
    addLog(`Server sync failed: ${error.message || "unknown error"}`, "warning");
  }
}

els.sourceList.addEventListener("change", (event) => {
  const row = event.target.closest(".mailbox-row");
  if (!row || !event.target.matches("input[type='checkbox']")) return;
  if (event.target.checked) state.selectedAccounts.add(row.dataset.id);
  else state.selectedAccounts.delete(row.dataset.id);
});
els.sourceSelectAll.addEventListener("click", () => {
  const accounts = filteredAccounts();
  const allSelected = accounts.every((account) => state.selectedAccounts.has(account.id));
  accounts.forEach((account) => {
    if (allSelected) state.selectedAccounts.delete(account.id);
    else state.selectedAccounts.add(account.id);
  });
  renderSources();
});
els.addSelected.addEventListener("click", addSelectedToQueue);
els.sourcePrev.addEventListener("click", () => {
  state.sourcePage -= 1;
  renderSources();
});
els.sourceNext.addEventListener("click", () => {
  state.sourcePage += 1;
  renderSources();
});
[els.sourceSearch, els.sourceType, els.sourceCategory, els.sourcePageSize].forEach((input) => {
  input.addEventListener("input", () => {
    state.sourcePage = 1;
    renderSources();
  });
  input.addEventListener("change", () => {
    state.sourcePage = 1;
    renderSources();
  });
});
els.queueBody.addEventListener("change", (event) => {
  const input = event.target.closest(".queue-check");
  if (!input) return;
  const row = input.closest("tr");
  if (!row) return;
  if (input.checked) state.selectedQueue.add(row.dataset.id);
  else state.selectedQueue.delete(row.dataset.id);
  renderQueue();
});
els.queueBody.addEventListener("click", (event) => {
  const button = event.target.closest(".login-one");
  if (!button) return;
  const rowEl = button.closest("tr");
  const item = state.queue.find((row) => row.id === rowEl?.dataset.id);
  if (item) startRows([item]);
});
els.startSelected.addEventListener("click", () => startRows(selectedQueueRows()));
els.retryFailed.addEventListener("click", () => startRows(selectedQueueRows({ failedOnly: true })));
els.exportCpa.addEventListener("click", () => exportResults("cpa"));
els.exportSub2.addEventListener("click", () => exportResults("sub2"));
els.clearQueue.addEventListener("click", () => {
  state.queue = [];
  state.selectedQueue.clear();
  state.jobs.clear();
  saveQueue();
  renderQueue();
});
[els.useProxy, els.proxyUrl, els.loginStrategy, els.loginConcurrency, els.autoUpdateCpa, els.cpaBaseUrl, els.cpaManagementKey, els.taskMode].forEach((input) => {
  if (input) {
    input.addEventListener("input", saveSettings);
    input.addEventListener("change", saveSettings);
  }
});
els.clearLogs.addEventListener("click", () => {
  els.logList.innerHTML = '<div class="client-log-item">等待操作。</div>';
  els.logHint.textContent = "等待执行。";
});

renderAll();
syncAccountsFromServer();
syncRefreshResults();
