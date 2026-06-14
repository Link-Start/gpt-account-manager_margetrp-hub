(function initRefreshQueueModel() {
  function createRefreshQueueModel(config = {}) {
    const {
      serviceLabels = {},
      resolveAccount = null,
      cpaBaseUrl = "",
      cpaManagementKey = "",
    } = config;

    function compactObject(value) {
      return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
    }

    function queueKey(row) {
      return [
        row?.source_kind || row?.source || "local",
        String(row?.email || row?.name || "").toLowerCase(),
        String(row?.cpa_name || row?.auth_index || ""),
      ].join("|");
    }

    function accountLike(input) {
      if (!input || typeof input !== "object") return null;
      if (input.account && typeof input.account === "object") return input.account;
      if (input.email && input.source && input.source !== "cpa") return input;
      if (typeof resolveAccount === "function") return resolveAccount(input) || null;
      return null;
    }

    function serviceLabel(account, input) {
      if (input?.source_kind === "cpa" || input?.source === "cpa") return "CPA";
      if (account?.source === "microsoft") return account.service || serviceLabels.microsoft || "Outlook";
      if (account?.source === "generic") return account.service || serviceLabels.generic || "其他邮箱";
      if (account?.source === "temp") return account.service || serviceLabels.temp || "临时邮箱";
      return input?.service || serviceLabels.local || "本地邮箱";
    }

    function resolvedConfigValue(value) {
      return typeof value === "function" ? value() : value;
    }

    function buildQueueItem(input) {
      const account = accountLike(input);
      const email = String(input?.email || account?.email || "").trim();
      const cpaName = String(input?.cpa_name || "").trim();
      const authIndex = String(input?.auth_index || "").trim();
      if (!email && !cpaName && !authIndex) return null;
      const sourceKind = (input?.source_kind || input?.source) === "cpa" ? "cpa" : "local";
      return compactObject({
        id: sourceKind === "cpa"
          ? `cpa-refresh:${String(cpaName || authIndex || email || input?.id || crypto.randomUUID()).toLowerCase()}`
          : `refresh:${account?.id || input?.account_id || email || input?.id || crypto.randomUUID()}`,
        source_kind: sourceKind,
        source: sourceKind === "cpa" ? "cpa" : (account?.source || input?.source || "local"),
        service: serviceLabel(account, input),
        email,
        name: String(input?.name || account?.name || email).trim(),
        cpa_name: cpaName,
        auth_index: authIndex,
        account_id: account?.id || input?.account_id || "",
        cpa_base_url: sourceKind === "cpa" ? String(resolvedConfigValue(cpaBaseUrl) || "").trim() : "",
        cpa_management_key: sourceKind === "cpa" ? String(resolvedConfigValue(cpaManagementKey) || "") : "",
        status: input?.status || "idle",
        error: input?.error || "",
        logs: Array.isArray(input?.logs) ? input.logs : [],
        auth_file: input?.auth_file || account?.auth_file || null,
      });
    }

    function mergeQueueItems(existingQueue, inputs) {
      const byKey = new Map((Array.isArray(existingQueue) ? existingQueue : []).map((row) => [queueKey(row), row]));
      const touched = [];
      let added = 0;
      (Array.isArray(inputs) ? inputs : []).forEach((input) => {
        const item = buildQueueItem(input);
        if (!item) return;
        const key = queueKey(item);
        const previous = byKey.get(key);
        const next = {
          ...(previous || {}),
          ...item,
          status: previous?.status || item.status || "idle",
        };
        byKey.set(key, next);
        touched.push(next);
        if (!previous) added += 1;
      });
      return {
        queue: [...byKey.values()],
        added,
        touched,
        selectedIds: touched.map((row) => row.id).filter(Boolean),
      };
    }

    return {
      compactObject,
      queueKey,
      buildQueueItem,
      mergeQueueItems,
      serviceLabel,
    };
  }

  window.GAM = window.GAM || {};
  window.GAM.refreshQueueModel = { createRefreshQueueModel };
})();
