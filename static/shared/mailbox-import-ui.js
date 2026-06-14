(function initMailboxImportUi() {
  function createMailboxImportUiHelper(config = {}) {
    const {
      parseLines,
      sourceMeta = {},
    } = config;

    function summarizeRows(rows, options = {}) {
      const {
        includeDuplicates = false,
        includeMissing = false,
      } = options;
      const temp = rows.filter((row) => row.source === "temp").length;
      const microsoft = rows.filter((row) => row.source === "microsoft").length;
      const generic = rows.filter((row) => row.source === "generic").length;
      const duplicateCount = rows.length - new Set(rows.map((row) => row.id)).size;
      const missing = rows.filter((row) =>
        row.source === "temp" ? !row.jwt
          : row.source === "generic" ? !row.password
            : (!row.password || !row.client_id || !row.refresh_token)
      ).length;
      return {
        total: rows.length,
        temp,
        microsoft,
        generic,
        duplicateCount,
        missing,
        issues: (includeMissing ? missing : 0),
      };
    }

    function previewState({ source = "auto", text = "", options = {} }) {
      const meta = sourceMeta[source] || sourceMeta.auto || {};
      const cleanText = String(text || "");
      if (!cleanText.trim()) {
        return {
          className: "import-preview",
          text: options.emptyText || "粘贴后会先预检格式。",
          tempMode: Boolean(meta.tempMode),
          placeholder: meta.placeholder || "",
          meta,
          rows: [],
          errors: [],
          summary: null,
        };
      }
      const { rows, errors } = parseLines(cleanText, source);
      const summary = summarizeRows(rows, options);
      summary.issues += errors.length;
      const parts = [
        `识别 ${summary.total} 个账号`,
        summary.microsoft ? `Outlook ${summary.microsoft}` : "",
        summary.temp ? `临时邮箱 ${summary.temp}` : "",
        summary.generic ? `其他邮箱 ${summary.generic}` : "",
        options.includeDuplicates && summary.duplicateCount ? `重复 ${summary.duplicateCount}` : "",
        options.includeMissing && summary.missing ? `缺少凭证 ${summary.missing}` : "",
        errors.length ? `格式错误 ${errors.length}` : "",
      ].filter(Boolean);
      return {
        className: `import-preview ${summary.issues ? "warning" : "ok"}`,
        text: parts.join(" · ") || "没有识别到账号",
        tempMode: Boolean(meta.tempMode),
        placeholder: meta.placeholder || "",
        meta,
        rows,
        errors,
        summary,
      };
    }

    function applyPreviewState(targets, nextState) {
      const {
        previewEl,
        textInput,
        tempApiField,
        tempSitePasswordField,
      } = targets;
      if (textInput && nextState.placeholder) {
        textInput.placeholder = nextState.placeholder;
        textInput.dataset.i18nOriginalPlaceholder = nextState.placeholder;
      }
      if (tempApiField) tempApiField.hidden = !nextState.tempMode;
      if (tempSitePasswordField) tempSitePasswordField.hidden = !nextState.tempMode;
      if (previewEl) {
        previewEl.className = nextState.className;
        previewEl.textContent = nextState.text;
      }
      return nextState;
    }

    function setModalOpen(modal, open) {
      if (!modal) return;
      modal.hidden = !open;
      document.body.classList.toggle("modal-open", open);
    }

    return {
      summarizeRows,
      previewState,
      applyPreviewState,
      setModalOpen,
    };
  }

  window.GAM = window.GAM || {};
  window.GAM.mailboxImportUi = { createMailboxImportUiHelper };
})();
