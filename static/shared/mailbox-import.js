(function initMailboxImport() {
  function defaultLooksLikeUrl(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    if (/^https?:\/\//i.test(text)) return true;
    if (/^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?(\/|$)/i.test(text)) return true;
    return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(:\d+)?(\/|$)/i.test(text);
  }

  function createMailboxImportHelper(config = {}) {
    const {
      serviceMap = {},
      normalizeStoredAccount = (account) => account,
      normalizeTempWorkerUrl = (value) => String(value || "").trim(),
      normalizeGenericMode = (value) => String(value || "auto").trim().toLowerCase(),
      isGenericApiMode = () => false,
      looksLikeJwt = (value) => String(value || "").split(".").length >= 3,
      looksLikeUrl = defaultLooksLikeUrl,
      looksLikeMicrosoftClientId = () => false,
      looksLikeMicrosoftRefreshToken = () => false,
      serviceForParsedParts = null,
      structuredArrayKeys = ["accounts", "addresses", "items"],
      allowSingleStructuredObject = false,
      allowJsonLines = false,
      requireStructuredStart = false,
      flexibleTempFields = false,
    } = config;

    function csvParts(line) {
      const parts = [];
      let current = "";
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
          if (quoted && line[index + 1] === '"') {
            current += '"';
            index += 1;
          } else {
            quoted = !quoted;
          }
          continue;
        }
        if (char === "," && !quoted) {
          parts.push(current.trim());
          current = "";
          continue;
        }
        current += char;
      }
      parts.push(current.trim());
      return parts;
    }

    function pickValue(item, keys) {
      for (const key of keys) {
        const value = item?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== "") {
          return String(value).trim();
        }
      }
      return "";
    }

    function resolveService(source, fallback = "generic") {
      return serviceMap[source] || serviceMap[fallback] || { source: source || fallback, label: source || fallback };
    }

    function detectStructuredRowSource(item, source) {
      const selected = resolveService(source, "auto");
      if (selected.source !== "auto") return selected.source;
      const hasMicrosoft = pickValue(item, ["client_id", "clientId"]) || pickValue(item, ["refresh_token", "refreshToken"]);
      const hasTempJwt = looksLikeJwt(pickValue(item, ["jwt", "token", "access_token", "credential"]));
      return hasMicrosoft ? "microsoft" : (hasTempJwt ? "temp" : "generic");
    }

    function structuredRowsFromObjects(items, source) {
      const rows = [];
      const errors = [];
      items.forEach((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          errors.push(`第 ${index + 1} 项不是对象`);
          return;
        }
        const email = pickValue(item, ["email", "mail", "email_address", "address", "username"]);
        if (!email.includes("@")) {
          errors.push(`第 ${index + 1} 项缺少有效邮箱`);
          return;
        }
        const category = pickValue(item, ["category", "label", "group", "tag"]);
        const rowSource = detectStructuredRowSource(item, source);
        const rowService = resolveService(rowSource, "generic");
        if (rowSource === "temp") {
          rows.push(normalizeStoredAccount({
            source: "temp",
            service: rowService.label,
            email,
            jwt: pickValue(item, ["jwt", "token", "access_token", "credential"]),
            base_url: normalizeTempWorkerUrl(pickValue(item, ["base_url", "baseUrl", "api", "api_url", "worker_url"])),
            site_password: pickValue(item, ["site_password", "sitePassword", "x-custom-auth", "custom_auth"]),
            category,
            selected: true,
          }));
          return;
        }
        if (rowSource === "generic") {
          rows.push(normalizeStoredAccount({
            source: "generic",
            service: rowService.label,
            email,
            password: pickValue(item, ["password", "pass", "token", "app_password", "appPassword"]),
            username: pickValue(item, ["username", "user", "mailbox"]),
            mode: pickValue(item, ["mode", "provider", "type"]),
            imap_host: pickValue(item, ["imap_host", "imapHost", "base_url", "baseUrl", "api_url", "apiUrl", "host"]),
            imap_port: pickValue(item, ["imap_port", "imapPort", "port"]),
            pop3_host: pickValue(item, ["pop3_host", "pop3Host"]),
            pop3_port: pickValue(item, ["pop3_port", "pop3Port"]),
            category,
            selected: true,
          }));
          return;
        }
        rows.push(normalizeStoredAccount({
          source: "microsoft",
          service: rowService.label,
          email,
          password: pickValue(item, ["password", "pass"]),
          client_id: pickValue(item, ["client_id", "clientId"]),
          refresh_token: pickValue(item, ["refresh_token", "refreshToken"]),
          category,
          selected: true,
        }));
      });
      return { rows: rows.filter(Boolean), errors };
    }

    function parseStructuredText(text, source) {
      const clean = String(text || "").trim();
      if (!clean) return null;
      if (requireStructuredStart && !/^[\[{]/.test(clean)) return null;
      try {
        const parsed = JSON.parse(clean);
        let items = [];
        if (Array.isArray(parsed)) {
          items = parsed;
        } else {
          for (const key of structuredArrayKeys) {
            if (Array.isArray(parsed?.[key])) {
              items = parsed[key];
              break;
            }
          }
          if (!items.length && allowSingleStructuredObject && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            items = [parsed];
          }
        }
        return structuredRowsFromObjects(Array.isArray(items) ? items : [], source);
      } catch {
        if (!allowJsonLines) return null;
        const objectLines = clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!objectLines.length || !objectLines.every((line) => line.startsWith("{") && line.endsWith("}"))) {
          return null;
        }
        const rows = [];
        const errors = [];
        objectLines.forEach((line, index) => {
          try {
            const parsed = JSON.parse(line);
            const result = structuredRowsFromObjects([parsed], source);
            rows.push(...result.rows);
            errors.push(...result.errors.map((message) => `第 ${index + 1} 行 ${message}`));
          } catch {
            errors.push(`第 ${index + 1} 行 JSON 解析失败`);
          }
        });
        return { rows, errors };
      }
    }

    function detectLineService(parts, source) {
      if (typeof serviceForParsedParts === "function") {
        return serviceForParsedParts(parts, source) || resolveService(source, "auto");
      }
      const selected = resolveService(source, "auto");
      if (selected.source !== "auto") return selected;
      const maybeClientId = String(parts[2] || "").trim();
      const maybeRefreshToken = String(parts[3] || "").trim();
      const looksMicrosoft = parts.length >= 4
        && !looksLikeUrl(maybeClientId)
        && !looksLikeJwt(parts[1] || "")
        && ((looksLikeMicrosoftClientId(maybeClientId) && looksLikeMicrosoftRefreshToken(maybeRefreshToken))
          || String(maybeRefreshToken || "").length > 20);
      if (looksMicrosoft) return resolveService("microsoft", "microsoft");
      return looksLikeJwt(parts[1] || "") ? resolveService("temp", "temp") : resolveService("generic", "generic");
    }

    function parseTempParts(parts, service, email) {
      let jwt = parts[1] || "";
      let baseUrl = "";
      let sitePassword = "";
      let category = "";
      if (flexibleTempFields) {
        if (parts.length >= 5) {
          baseUrl = normalizeTempWorkerUrl(parts[2] || "");
          sitePassword = parts[3] || "";
          category = parts[4] || "";
        } else if (parts.length === 4) {
          if (looksLikeUrl(parts[2])) {
            baseUrl = normalizeTempWorkerUrl(parts[2] || "");
            sitePassword = parts[3] || "";
          } else {
            category = parts[2] || "";
            sitePassword = parts[3] || "";
          }
        } else if (parts.length === 3) {
          if (looksLikeUrl(parts[2])) {
            baseUrl = normalizeTempWorkerUrl(parts[2] || "");
          } else {
            category = parts[2] || "";
          }
        }
      } else {
        baseUrl = normalizeTempWorkerUrl(parts[2] || "");
        sitePassword = parts[3] || "";
        category = parts[4] || "";
      }
      return normalizeStoredAccount({
        source: "temp",
        service: service.label,
        email,
        jwt,
        base_url: baseUrl,
        site_password: sitePassword,
        category,
        selected: true,
      });
    }

    function parseGenericParts(parts, service, email) {
      const password = parts[1] || "";
      const third = parts[2] || "";
      const fourth = parts[3] || "";
      const fifth = parts[4] || "";
      const sixth = parts[5] || "";
      let mode = normalizeGenericMode(fourth && !/^\d+$/.test(fourth) ? fourth : fifth);
      let host = third && !/^\d+$/.test(third) ? third : "";
      let category = "";
      let username = "";
      if (mode === "auto" && isGenericApiMode(third)) {
        mode = normalizeGenericMode(third);
        host = "";
      }
      if (/^\d+$/.test(fourth)) {
        category = isGenericApiMode(fifth) ? sixth : fifth;
      } else if (isGenericApiMode(mode)) {
        username = mode === "luckmail" ? fifth : "";
        category = mode === "luckmail" ? sixth : fifth;
      } else {
        category = fifth;
      }
      return normalizeStoredAccount({
        source: "generic",
        service: service.label,
        email,
        password,
        username,
        mode,
        imap_host: mode === "pop3" ? "" : host,
        imap_port: /^\d+$/.test(fourth) ? Number(fourth) : 993,
        pop3_host: mode === "pop3" ? host : "",
        pop3_port: /^\d+$/.test(fourth) ? Number(fourth) : 995,
        category,
        selected: true,
      });
    }

    function parseLines(text, source) {
      const structured = parseStructuredText(text, source);
      if (structured) return structured;
      const rows = [];
      const errors = [];
      String(text || "").split(/\r?\n/).forEach((line, index) => {
        const clean = line.trim().replace(/^\ufeff/, "");
        if (!clean || clean.startsWith("#")) return;
        const parts = clean.includes("----")
          ? clean.split("----").map((part) => part.trim())
          : csvParts(clean);
        const email = parts[0] || "";
        if (!email.includes("@")) {
          errors.push(`第 ${index + 1} 行邮箱格式不正确`);
          return;
        }
        const rowService = detectLineService(parts, source);
        if (rowService.source === "temp") {
          rows.push(parseTempParts(parts, rowService, email));
          return;
        }
        if (rowService.source === "generic") {
          rows.push(parseGenericParts(parts, rowService, email));
          return;
        }
        rows.push(normalizeStoredAccount({
          source: "microsoft",
          service: rowService.label,
          email,
          password: parts[1] || "",
          client_id: parts[2] || "",
          refresh_token: parts[3] || "",
          category: parts[4] || "",
          selected: true,
        }));
      });
      return { rows: rows.filter(Boolean), errors };
    }

    return {
      csvParts,
      pickValue,
      looksLikeUrl,
      structuredRowsFromObjects,
      parseStructuredText,
      parseTempParts,
      parseGenericParts,
      parseLines,
    };
  }

  window.GAM = window.GAM || {};
  window.GAM.mailboxImport = { createMailboxImportHelper };
})();
