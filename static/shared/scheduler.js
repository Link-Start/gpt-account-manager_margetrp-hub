(function initSharedScheduler() {
  function debounce(fn, waitMs = 250) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, waitMs);
    };
  }

  function createLatestOnlyRequest(task) {
    let latestId = 0;
    let controller = null;
    return async function runLatest(payload) {
      latestId += 1;
      const requestId = latestId;
      if (controller) controller.abort();
      controller = new AbortController();
      try {
        const result = await task({ payload, signal: controller.signal, requestId });
        if (requestId !== latestId) return { ignored: true, stale: true };
        return { ignored: false, result };
      } catch (error) {
        if (error?.name === "AbortError") return { ignored: true, aborted: true };
        throw error;
      }
    };
  }

  function createPollLoop(task, options = {}) {
    const intervalMs = Math.max(250, Number(options.intervalMs || 2000));
    let active = false;
    let running = false;
    let timer = null;

    const clearTimer = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    };

    const scheduleNext = () => {
      if (!active) return;
      clearTimer();
      timer = setTimeout(runOnce, intervalMs);
    };

    const runOnce = async () => {
      if (!active || running) return;
      running = true;
      try {
        await task();
      } finally {
        running = false;
        scheduleNext();
      }
    };

    return {
      start() {
        if (active) return;
        active = true;
        runOnce();
      },
      stop() {
        active = false;
        clearTimer();
      },
      isActive() {
        return active;
      },
    };
  }

  window.GAM = window.GAM || {};
  window.GAM.scheduler = {
    debounce,
    createLatestOnlyRequest,
    createPollLoop,
  };
}());
