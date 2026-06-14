(function initRefreshPhonePool() {
  function createRefreshPhonePoolHelper(config = {}) {
    const {
      state,
      els,
      helpers,
      actions,
    } = config;

    const {
      escapeHtml,
      accountEmailKey,
      savePhonePool,
      saveQueue,
      renderQueue,
      renderSources,
      renderAll,
      renderSelectedPhoneCodePanel,
      toast,
      addLog,
      apiHeaders,
      readJsonResponse,
      currentPhoneMode,
      selectedSingleQueueRow,
    } = helpers;

    const {
      normalizePhoneDigits,
      phoneMatches,
    } = actions;

    function normalizePhonePool(value) {
      if (!Array.isArray(value)) return [];
      const seen = new Set();
      return value.map((item) => {
        const phone = String(item?.phone || "").trim();
        const apiUrl = String(item?.api_url || item?.apiUrl || "").trim();
        if (!phone || !apiUrl) return null;
        const id = String(item?.id || `phone:${phone.toLowerCase()}`);
        const key = id.toLowerCase();
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          id,
          mode: item?.mode === "bound" || item?.mode === "one_to_one" ? "bound" : "batch",
          phone,
          api_url: apiUrl,
          account_email: String(item?.account_email || item?.accountEmail || "").trim().toLowerCase(),
          last_code: String(item?.last_code || item?.lastCode || ""),
          last_message: String(item?.last_message || item?.lastMessage || ""),
          last_checked_at: String(item?.last_checked_at || item?.lastCheckedAt || ""),
          status: String(item?.status || "idle"),
        };
      }).filter(Boolean);
    }

    function phoneCodeForRow(row, entry = null) {
      return String(row?.manual_phone_code || row?.phone_code || entry?.last_code || "").trim();
    }

    function phonePoolPayload() {
      return state.phonePool.map((item) => ({
        id: item.id,
        mode: item.mode,
        phone: item.phone,
        api_url: item.api_url,
        account_email: item.account_email || "",
      }));
    }

    function phoneEntryForRow(row) {
      const key = accountEmailKey(row.email || row.name);
      if (row.phone_id) {
        const byId = state.phonePool.find((item) => item.id === row.phone_id);
        if (byId) return byId;
      }
      if (row.phone_number) {
        const byPhone = state.phonePool.find((item) => phoneMatches(item.phone, row.phone_number));
        if (byPhone) return byPhone;
      }
      if (key) {
        const bound = state.phonePool.find((item) => accountEmailKey(item.account_email) === key);
        if (bound) return bound;
      }
      return null;
    }

    function ensurePhoneEntryForRow(row) {
      const existing = phoneEntryForRow(row);
      if (existing) return existing;
      const used = new Set(state.queue.map((item) => item.phone_id).filter(Boolean));
      const entry = state.phonePool.find((item) => item.mode === "batch" && !accountEmailKey(item.account_email) && !used.has(item.id));
      if (!entry) return null;
      row.phone_id = entry.id;
      row.phone_number = entry.phone;
      row.phone_api_url = entry.api_url;
      saveQueue();
      return entry;
    }

    function formatPhoneTime(value) {
      const parsed = Date.parse(value || "");
      if (!Number.isFinite(parsed)) return "";
      return new Date(parsed).toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }

    function renderPhoneBindingList() {
      if (!els.phoneBindingList) return;
      if (!state.phonePool.length) {
        els.phoneBindingList.innerHTML = '<div class="phone-pool-empty">还没有手机号绑定关系。</div>';
        return;
      }
      const rows = [...state.phonePool].sort((a, b) => {
        const aBound = a.account_email ? 0 : 1;
        const bBound = b.account_email ? 0 : 1;
        if (aBound !== bBound) return aBound - bBound;
        return String(a.phone || "").localeCompare(String(b.phone || ""));
      });
      els.phoneBindingList.innerHTML = rows.map((item) => {
        const mode = item.mode === "bound" ? "1对1" : "批量";
        const email = item.account_email || "未绑定邮箱";
        const hint = item.last_code
          ? `最近验证码 ${item.last_code}${item.last_checked_at ? ` · ${formatPhoneTime(item.last_checked_at)}` : ""}`
          : (item.status === "error" ? "取码失败" : "等待取码");
        return `
          <div class="phone-binding-row">
            <strong>${escapeHtml(item.phone)}</strong>
            <span>${escapeHtml(email)}</span>
            <em>${escapeHtml(mode)} · ${escapeHtml(hint)}</em>
          </div>
        `;
      }).join("");
    }

    function renderPhonePool() {
      if (!els.phonePoolList) return;
      if (!state.phonePool.length) {
        els.phonePoolList.innerHTML = '<div class="phone-pool-empty">还没有长效手机。</div>';
        renderPhoneBindingList();
        renderSelectedPhoneCodePanel();
        return;
      }
      els.phonePoolList.innerHTML = state.phonePool.map((item) => {
        const status = item.last_code
          ? `最近验证码 ${item.last_code}${item.last_checked_at ? ` · ${formatPhoneTime(item.last_checked_at)}` : ""}`
          : (item.status === "error" ? "取码失败" : "等待取码");
        const mode = item.mode === "bound" ? "1对1" : "批量";
        const bound = item.account_email ? item.account_email : "未绑定账号";
        return `
          <div class="phone-pool-row" data-id="${escapeHtml(item.id)}">
            <div>
              <strong>${escapeHtml(item.phone)}</strong>
              <em>${escapeHtml(mode)} · ${escapeHtml(bound)} · ${escapeHtml(status)}</em>
            </div>
            <div class="phone-pool-actions">
              <button class="bind-phone" type="button">绑定选中</button>
              <button class="poll-phone" type="button">取码</button>
              <button class="remove-phone danger" type="button">删除</button>
            </div>
          </div>
        `;
      }).join("");
      renderPhoneBindingList();
      renderSelectedPhoneCodePanel();
    }

    function validPhoneApiUrl(value) {
      try {
        const url = new URL(String(value || "").trim()
          .replace(/\{phone\}/g, "10000000000")
          .replace(/\{email\}/g, "user@example.com")
          .replace(/\{account\}/g, "user@example.com")
          .replace(/\{since\}/g, "0")
          .replace(/\{ts\}/g, String(Date.now())));
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    }

    function addOrUpdatePhoneEntry() {
      const phone = els.phoneNumber ? els.phoneNumber.value.trim() : "";
      const apiUrl = els.phoneApiUrl ? els.phoneApiUrl.value.trim() : "";
      if (!phone || !apiUrl) {
        toast("请填写手机号和接码 API");
        return;
      }
      if (!validPhoneApiUrl(apiUrl)) {
        toast("接码 API 必须是 http/https URL");
        addLog("手机 API 格式错误", "error", { error_code: "phone_pool_api_invalid" });
        return;
      }
      const selected = selectedSingleQueueRow();
      const isOneToOne = currentPhoneMode() !== "batch";
      const accountEmail = isOneToOne && selected ? accountEmailKey(selected.email || selected.name) : "";
      const id = `phone:${phone.toLowerCase()}`;
      const existing = state.phonePool.find((item) => item.id === id || item.phone === phone);
      if (accountEmail) {
        state.phonePool.forEach((item) => {
          if (item.id !== id && accountEmailKey(item.account_email) === accountEmail) {
            item.account_email = "";
          }
        });
      }
      const next = {
        ...(existing || {}),
        id,
        mode: accountEmail ? "bound" : "batch",
        phone,
        api_url: apiUrl,
        account_email: accountEmail || existing?.account_email || "",
        status: existing?.status || "idle",
        last_code: existing?.last_code || "",
        last_message: existing?.last_message || "",
        last_checked_at: existing?.last_checked_at || "",
      };
      if (existing) {
        Object.assign(existing, next);
      } else {
        state.phonePool.push(next);
      }
      savePhonePool();
      renderAll();
      toast(accountEmail ? "手机号已加入并绑定选中账号" : "手机号已加入手机池");
    }

    function importPhoneBatchEntries() {
      const text = els.phoneBatchText ? els.phoneBatchText.value.trim() : "";
      if (!text) {
        toast("请先粘贴批量手机号");
        return;
      }
      let added = 0;
      let updated = 0;
      const errors = [];
      text.split(/\r?\n/).forEach((line, index) => {
        const raw = line.trim();
        if (!raw) return;
        const parts = raw.split(/----|\t|,/).map((part) => part.trim()).filter(Boolean);
        const [phone, apiUrl, email = ""] = parts;
        if (!phone || !apiUrl || !validPhoneApiUrl(apiUrl)) {
          errors.push(index + 1);
          return;
        }
        const id = `phone:${phone.toLowerCase()}`;
        const existing = state.phonePool.find((item) => item.id === id || item.phone === phone);
        const next = {
          ...(existing || {}),
          id,
          mode: email ? "bound" : "batch",
          phone,
          api_url: apiUrl,
          account_email: accountEmailKey(email),
          status: existing?.status || "idle",
          last_code: existing?.last_code || "",
          last_message: existing?.last_message || "",
          last_checked_at: existing?.last_checked_at || "",
        };
        if (existing) {
          Object.assign(existing, next);
          updated += 1;
        } else {
          state.phonePool.push(next);
          added += 1;
        }
      });
      savePhonePool();
      if (els.phoneBatchText && !errors.length) els.phoneBatchText.value = "";
      renderAll();
      toast(`手机池导入：新增 ${added}，更新 ${updated}${errors.length ? `，失败 ${errors.length}` : ""}`);
      if (errors.length) addLog(`手机池批量导入有 ${errors.length} 行格式错误`, "warning", { error_code: "phone_pool_api_invalid" });
    }

    function bindPhoneToSelected(phoneId) {
      const item = state.phonePool.find((entry) => entry.id === phoneId);
      const row = selectedSingleQueueRow();
      if (!item) return;
      if (!row) {
        toast("请只勾选一个队列账号再绑定");
        return;
      }
      const accountEmail = accountEmailKey(row.email || row.name);
      state.phonePool.forEach((entry) => {
        if (entry.id !== phoneId && accountEmailKey(entry.account_email) === accountEmail) {
          entry.account_email = "";
        }
      });
      item.mode = "bound";
      item.account_email = accountEmail;
      row.phone_id = item.id;
      row.phone_number = item.phone;
      row.phone_api_url = item.api_url;
      savePhonePool();
      saveQueue();
      renderAll();
      addLog(`${row.email} 已绑定长效手机`, "success", { step: "phone_pool", email: row.email });
    }

    function removePhoneEntry(phoneId) {
      const item = state.phonePool.find((entry) => entry.id === phoneId);
      if (!item) return;
      if (!confirm(`删除长效手机 ${item.phone}？不会删除账号，只会解除绑定。`)) return;
      state.phonePool = state.phonePool.filter((entry) => entry.id !== phoneId);
      state.queue.forEach((row) => {
        if (row.phone_id === phoneId || String(row.phone_number || "") === item.phone) {
          delete row.phone_id;
          delete row.phone_number;
          delete row.phone_api_url;
        }
      });
      savePhonePool();
      saveQueue();
      renderSources();
      renderQueue();
      renderSelectedPhoneCodePanel();
    }

    async function pollPhoneEntry(phoneId, rowId = "") {
      const item = state.phonePool.find((entry) => entry.id === phoneId);
      if (!item) return;
      const targetRow = state.queue.find((row) => row.id === rowId) || state.queue.find((row) => (
        row.phone_id === item.id
        || phoneMatches(item.phone, row.phone_number)
        || accountEmailKey(row.email || row.name) === accountEmailKey(item.account_email)
      ));
      item.status = "running";
      savePhonePool();
      renderPhonePool();
      try {
        const response = await fetch("/client-api/phone-code/poll", {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({
            phone: item.phone,
            api_url: item.api_url,
            account_email: targetRow?.email || item.account_email,
            since: item.last_checked_at || "",
          }),
        });
        const data = await readJsonResponse(response, "手机取码失败");
        item.last_checked_at = data.checked_at || new Date().toISOString();
        item.last_message = data.message || "";
        item.status = data.found ? "found" : "idle";
        if (data.code) item.last_code = String(data.code);
        if (targetRow) {
          targetRow.phone_id = item.id;
          targetRow.phone_number = item.phone;
          targetRow.phone_api_url = item.api_url;
          targetRow.phone_code = data.code ? String(data.code) : targetRow.phone_code || "";
          targetRow.phone_code_message = data.message || "";
          targetRow.phone_code_checked_at = data.checked_at || new Date().toISOString();
          if (!item.account_email && currentPhoneMode() !== "batch") item.account_email = accountEmailKey(targetRow.email || targetRow.name);
        }
        savePhonePool();
        saveQueue();
        renderPhonePool();
        renderQueue();
        if (data.found) {
          addLog(`${item.account_email || item.phone} 手机验证码：${data.code}`, "success", { step: "phone_code", email: item.account_email });
          toast(`收到手机验证码 ${data.code}`);
        } else {
          addLog(`${item.account_email || item.phone} 暂未收到手机验证码`, "warning", { error_code: "phone_code_missing", email: item.account_email });
          toast("暂未收到手机验证码");
        }
      } catch (error) {
        const details = error.details || { error: error.message || "手机取码失败", error_code: "phone_code_fetch_failed" };
        item.status = "error";
        item.last_message = details.error || "手机取码失败";
        item.last_checked_at = new Date().toISOString();
        savePhonePool();
        renderPhonePool();
        addLog(`${item.account_email || item.phone} 手机取码失败`, "error", {
          error_code: details.error_code || "phone_code_fetch_failed",
          email: item.account_email,
        });
        toast(details.error || "手机取码失败");
      }
    }

    function saveManualPhoneCodeForSelected() {
      const row = selectedSingleQueueRow();
      if (!row) {
        toast("请先只选中一个队列账号");
        return;
      }
      helpers.openManualCodeDialog(row, "phone");
    }

    async function pollSelectedPhoneCode() {
      const row = selectedSingleQueueRow();
      if (!row) {
        toast("请先只选中一个队列账号");
        return;
      }
      const entry = ensurePhoneEntryForRow(row);
      if (!entry) {
        toast("没有可用手机。请先添加 1 对 1 手机或批量池手机号");
        addLog(`${row.email} 没有可用手机`, "warning", { error_code: "phone_pool_empty", email: row.email });
        return;
      }
      await pollPhoneEntry(entry.id, row.id);
    }

    return {
      normalizePhonePool,
      phoneCodeForRow,
      phonePoolPayload,
      phoneEntryForRow,
      ensurePhoneEntryForRow,
      formatPhoneTime,
      renderPhoneBindingList,
      renderPhonePool,
      validPhoneApiUrl,
      addOrUpdatePhoneEntry,
      importPhoneBatchEntries,
      bindPhoneToSelected,
      removePhoneEntry,
      pollPhoneEntry,
      saveManualPhoneCodeForSelected,
      pollSelectedPhoneCode,
    };
  }

  window.GAM = window.GAM || {};
  window.GAM.refreshPhonePool = { createRefreshPhonePoolHelper };
}());
