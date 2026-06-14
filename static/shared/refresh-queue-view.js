(function initRefreshQueueView() {
  function createRefreshQueueView(config = {}) {
    const {
      state,
      els,
      rowState,
      inferErrorCode,
      errorCodeLabel,
      compactText,
    } = config;

    function loginLabel(status) {
      return {
        idle: "等待",
        queued: "排队",
        running: "登录中",
        success: "成功",
        failed: "失败",
        challenge: "安全验证",
        canceled: "已终止",
      }[status] || status || "等待";
    }

    function displayStatus(job) {
      if (job.status === "failed" && job.error_code === "login_cancelled") return "canceled";
      if (job.status === "failed" && job.error_code === "openai_turnstile_challenge") return "challenge";
      return job.status || "idle";
    }

    function queueFilterStatus(row) {
      const status = rowState(row).status || "idle";
      if (status === "queued") return "idle";
      return status;
    }

    function invalidateQueueRowsCache() {
      state.filteredQueueCacheKey = "";
      state.filteredQueueCacheRows = [];
    }

    function queueRowsCacheKey() {
      return JSON.stringify([
        state.queue.length,
        state.queue[0]?.id || "",
        state.queue[state.queue.length - 1]?.id || "",
        state.queueFilter || "all",
        state.queue.map((row) => `${row.id}:${rowState(row).status || "idle"}`).join("|"),
      ]);
    }

    function queueRowsForCurrentFilter() {
      const cacheKey = queueRowsCacheKey();
      if (cacheKey === state.filteredQueueCacheKey) return state.filteredQueueCacheRows;
      let rows;
      if (state.queueFilter === "all") return state.queue;
      if (state.queueFilter === "running") {
        rows = state.queue.filter((row) => ["queued", "running"].includes(rowState(row).status || "idle"));
      } else {
        rows = state.queue.filter((row) => queueFilterStatus(row) === state.queueFilter);
      }
      state.filteredQueueCacheKey = cacheKey;
      state.filteredQueueCacheRows = rows;
      return rows;
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

    function summarizeJobError(job) {
      const code = inferErrorCode(job);
      if (code) return errorCodeLabel(code);
      const detail = compactText(job.error_hint || job.error || "", 90);
      if (detail) return errorCodeLabel("login_failed");
      return "-";
    }

    return {
      loginLabel,
      displayStatus,
      queueFilterStatus,
      invalidateQueueRowsCache,
      queueRowsCacheKey,
      queueRowsForCurrentFilter,
      renderQueueProgress,
      summarizeJobError,
    };
  }

  window.GAM = window.GAM || {};
  window.GAM.refreshQueueView = { createRefreshQueueView };
}());
