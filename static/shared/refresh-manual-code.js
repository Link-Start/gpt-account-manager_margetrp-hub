(function initRefreshManualCode() {
  function createRefreshManualCodeHelper(config = {}) {
    const {
      state,
      els,
      helpers,
      actions,
    } = config;

    const {
      rowState,
      isPhoneVerificationError,
      phoneEntryForRow,
      phoneCodeForRow,
      savePhonePool,
      saveQueue,
      renderQueue,
      renderSelectedPhoneCodePanel,
      addLog,
      toast,
      submitManualPhoneCode,
      queueManualEmailCodeSubmit,
      selectedSingleQueueRow,
    } = helpers;

    const {
      onOpenChange = null,
    } = actions;

    function openManualCodeDialog(row, kind = "email") {
      if (!row || !els.manualCodeModal || !els.manualCodeModalInput) return;
      state.manualCodeTarget = { rowId: row.id, kind };
      const isPhone = kind === "phone";
      const label = isPhone ? "手机验证码" : "邮箱验证码";
      const previous = isPhone
        ? (row.manual_phone_code || row.phone_code || "")
        : (row.manual_email_code || "");
      if (els.manualCodeModalEyebrow) {
        els.manualCodeModalEyebrow.textContent = isPhone ? "Phone Code" : "Email Code";
      }
      if (els.manualCodeModalTitle) {
        els.manualCodeModalTitle.textContent = `手动输入${label}`;
      }
      if (els.manualCodeModalHint) {
        const target = row.email || row.name || "当前账号";
        els.manualCodeModalHint.textContent = `${target} 需要${label}时，可以在这里补填后继续任务。`;
      }
      els.manualCodeModalInput.value = String(previous || "");
      els.manualCodeModal.hidden = false;
      if (typeof onOpenChange === "function") onOpenChange(true, row, kind);
      window.requestAnimationFrame(() => {
        els.manualCodeModalInput.focus();
        els.manualCodeModalInput.select();
      });
    }

    function closeManualCodeDialog() {
      state.manualCodeTarget = null;
      if (els.manualCodeModal) els.manualCodeModal.hidden = true;
      if (els.manualCodeModalInput) els.manualCodeModalInput.value = "";
      if (typeof onOpenChange === "function") onOpenChange(false, null, "");
    }

    function submitManualCodeDialog() {
      const target = state.manualCodeTarget;
      const input = els.manualCodeModalInput;
      if (!target || !input) return;
      const row = state.queue.find((item) => item.id === target.rowId);
      if (!row) {
        closeManualCodeDialog();
        toast("当前账号已不在队列中");
        return;
      }
      const code = String(input.value || "").trim();
      if (!/^\d{4,8}$/.test(code)) {
        toast("请输入 4-8 位验证码");
        input.focus();
        input.select();
        return;
      }
      if (target.kind === "phone") {
        const entry = phoneEntryForRow(row);
        row.manual_phone_code = code;
        row.phone_code = code;
        row.phone_code_checked_at = new Date().toISOString();
        if (entry) {
          entry.last_code = code;
          entry.last_checked_at = row.phone_code_checked_at;
          entry.status = "found";
        }
        savePhonePool();
        submitManualPhoneCode(row, code).catch((error) => {
          addLog(`${row.email} 手动手机验证码保存失败`, "warning", {
            email: row.email,
            error_code: "manual_phone_code_failed",
            error: error instanceof Error ? error.message : String(error),
          });
        });
      } else {
        row.manual_email_code = code;
        queueManualEmailCodeSubmit(row);
      }
      saveQueue();
      renderQueue();
      renderSelectedPhoneCodePanel();
      closeManualCodeDialog();
      addLog(`${row.email || row.name || "当前账号"} 已补填${target.kind === "phone" ? "手机" : "邮箱"}验证码`, "success", {
        step: target.kind === "phone" ? "manual_phone_code" : "manual_email_code",
        email: row.email,
      });
    }

    function promptCodeForRow(row) {
      const current = rowState(row);
      const phoneNeeded = isPhoneVerificationError(current.error_code || row.error_code, `${current.error || ""} ${current.error_hint || ""}`);
      openManualCodeDialog(row, phoneNeeded ? "phone" : "email");
    }

    function saveManualPhoneCodeForSelected() {
      const row = selectedSingleQueueRow();
      if (!row) {
        toast("请先只选中一个队列账号");
        return;
      }
      openManualCodeDialog(row, "phone");
    }

    return {
      openManualCodeDialog,
      closeManualCodeDialog,
      submitManualCodeDialog,
      promptCodeForRow,
      saveManualPhoneCodeForSelected,
    };
  }

  window.GAM = window.GAM || {};
  window.GAM.refreshManualCode = { createRefreshManualCodeHelper };
}());
