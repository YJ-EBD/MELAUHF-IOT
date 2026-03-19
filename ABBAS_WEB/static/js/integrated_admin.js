(function () {
  const config = window.IntegratedAdminConfig || {};
  const statusMemory = new Map();
  let currentPayload = null;
  let isLoading = false;
  let systemWs = null;
  let systemWsReconnectTimer = 0;
  let systemWsClosedByClient = false;

  const els = {
    summaryTotalUsers: document.getElementById("summaryTotalUsers"),
    summaryApprovedUsers: document.getElementById("summaryApprovedUsers"),
    summaryPendingUsers: document.getElementById("summaryPendingUsers"),
    summaryActiveSessions: document.getElementById("summaryActiveSessions"),
    summaryUsbDevices: document.getElementById("summaryUsbDevices"),
    generatedAtText: document.getElementById("generatedAtText"),
    systemPlatform: document.getElementById("systemPlatform"),
    systemUptime: document.getElementById("systemUptime"),
    systemHostname: document.getElementById("systemHostname"),
    healthMetricsGrid: document.getElementById("healthMetricsGrid"),
    systemOverviewPanel: document.getElementById("systemOverviewPanel"),
    focusMetricPanel: document.getElementById("focusMetricPanel"),
    activeUsersCount: document.getElementById("activeUsersCount"),
    activeUsersTableBody: document.getElementById("activeUsersTableBody"),
    pendingUsersGrid: document.getElementById("pendingUsersGrid"),
    usbCountText: document.getElementById("usbCountText"),
    usbDevicesList: document.getElementById("usbDevicesList"),
    approvedUsersTableBody: document.getElementById("approvedUsersTableBody"),
    dashboardSearchInput: document.getElementById("dashboardSearchInput"),
  };

  const palette = {
    cpu: { line: "#7566ff", soft: "rgba(117, 102, 255, 0.28)" },
    memory: { line: "#1fe4b0", soft: "rgba(31, 228, 176, 0.28)" },
    disk: { line: "#ffb357", soft: "rgba(255, 179, 87, 0.28)" },
    network: { line: "#58c8ff", soft: "rgba(88, 200, 255, 0.28)" },
    default: { line: "#7566ff", soft: "rgba(117, 102, 255, 0.28)" },
  };

  const sparklineSeeds = {
    cpu: [24, 30, 26, 38, 31, 45, 33, 52],
    memory: [42, 38, 44, 40, 47, 43, 48, 46],
    disk: [18, 22, 20, 26, 29, 31, 34, 36],
    network: [14, 20, 17, 26, 18, 30, 22, 28],
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function formatText(value, fallback) {
    const text = normalizeText(value);
    return text || (fallback || "-");
  }

  function presenceState(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "live" || normalized === "background" || normalized === "inactive") {
      return normalized;
    }
    return "inactive";
  }

  function getStatus(userId) {
    const cached = statusMemory.get(userId);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      statusMemory.delete(userId);
      return null;
    }
    return cached;
  }

  function setStatus(userId, text, type) {
    statusMemory.set(userId, {
      text: text || "",
      type: type || "",
      expiresAt: Date.now() + 3600,
    });
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, Object.assign({
      headers: {
        Accept: "application/json",
      },
    }, options || {}));

    if (response.redirected && response.url && response.url.indexOf("/login") !== -1) {
      window.location.href = response.url;
      throw new Error("로그인 페이지로 이동합니다.");
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.indexOf("application/json") === -1) {
      if (response.status === 401 || response.status === 403) {
        window.location.href = "/login";
      }
      throw new Error("JSON 응답을 받지 못했습니다.");
    }

    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.detail || data.message || "요청에 실패했습니다.");
    }
    return data;
  }

  function wsUrlFromPath(path) {
    const normalized = normalizeText(path);
    if (!normalized) return "";
    if (normalized.indexOf("ws://") === 0 || normalized.indexOf("wss://") === 0) {
      return normalized;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return protocol + "//" + window.location.host + normalized;
  }

  function currentSearchTerm() {
    if (!(els.dashboardSearchInput instanceof HTMLInputElement)) return "";
    return normalizeText(els.dashboardSearchInput.value).toLowerCase();
  }

  function matchesSearchUser(item, searchTerm) {
    if (!searchTerm) return true;
    const haystack = [
      item.user_id,
      item.display_name,
      item.email,
      item.role_label,
      item.approval_label,
      item.approved_by,
      item.presence_label,
      item.presence_detail_text,
      item.presence_page_text,
      item.session_ttl_text,
    ].map(normalizeText).join(" ").toLowerCase();
    return haystack.indexOf(searchTerm) !== -1;
  }

  function matchesSearchUsb(item, searchTerm) {
    if (!searchTerm) return true;
    const haystack = [
      item.name,
      item.id,
      item.bus,
      item.device,
      item.source,
    ].map(normalizeText).join(" ").toLowerCase();
    return haystack.indexOf(searchTerm) !== -1;
  }

  function filteredData(payload) {
    const source = payload || {};
    const searchTerm = currentSearchTerm();
    return {
      summary: source.summary || {},
      generated_at: source.generated_at || "",
      system: source.system || {},
      users: (source.users || []).filter(function (item) { return matchesSearchUser(item, searchTerm); }),
      pending_users: (source.pending_users || []).filter(function (item) { return matchesSearchUser(item, searchTerm); }),
      active_users: (source.active_users || []).filter(function (item) { return matchesSearchUser(item, searchTerm); }),
      usb_devices: (source.usb_devices || []).filter(function (item) { return matchesSearchUsb(item, searchTerm); }),
    };
  }

  function colorForMetric(key) {
    return palette[key] || palette.default;
  }

  function metricSparkline(metric) {
    const key = normalizeText(metric.key) || "default";
    const seed = sparklineSeeds[key] || sparklineSeeds.cpu;
    const percent = Number(metric.percent || 0);
    const values = seed.map(function (value, index) {
      const boosted = value + ((Number.isFinite(percent) ? percent : 0) * (index % 2 === 0 ? 0.16 : 0.09));
      return Math.max(8, Math.min(92, boosted));
    });

    const max = Math.max.apply(null, values);
    const min = Math.min.apply(null, values);
    const width = 180;
    const height = 34;
    const points = values.map(function (value, index) {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const normalized = max === min ? 0.5 : (value - min) / (max - min);
      const y = height - (normalized * (height - 6)) - 3;
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");

    const color = colorForMetric(key);
    return (
      '<svg class="ia-sparkline" viewBox="0 0 180 34" preserveAspectRatio="none" aria-hidden="true">' +
        '<polyline fill="none" stroke="' + color.soft + '" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" points="' + points + '"></polyline>' +
        '<polyline fill="none" stroke="' + color.line + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="' + points + '"></polyline>' +
      "</svg>"
    );
  }

  function renderSummary(summary) {
    if (els.summaryTotalUsers) els.summaryTotalUsers.textContent = String(summary.total_users || 0);
    if (els.summaryApprovedUsers) els.summaryApprovedUsers.textContent = String(summary.approved_users || 0);
    if (els.summaryPendingUsers) els.summaryPendingUsers.textContent = String(summary.pending_users || 0);
    if (els.summaryActiveSessions) els.summaryActiveSessions.textContent = String(summary.active_sessions || 0);
    if (els.summaryUsbDevices) els.summaryUsbDevices.textContent = String(summary.usb_devices || 0);
  }

  function renderRuntime(system, generatedAt) {
    if (els.generatedAtText) els.generatedAtText.textContent = formatText(generatedAt);
    if (els.systemPlatform) els.systemPlatform.textContent = formatText(system.platform);
    if (els.systemUptime) els.systemUptime.textContent = formatText(system.uptime_text);
    if (els.systemHostname) els.systemHostname.textContent = formatText(system.hostname);
  }

  function renderMetrics(metrics) {
    if (!els.healthMetricsGrid) return;
    if (!Array.isArray(metrics) || metrics.length === 0) {
      els.healthMetricsGrid.innerHTML = '<div class="ia-empty">표시할 시스템 메트릭이 없습니다.</div>';
      return;
    }

    els.healthMetricsGrid.innerHTML = metrics.map(function (metric) {
      const label = formatText(metric.label, "Metric");
      const value = formatText(metric.center_text, "0%");
      const meta = formatText(metric.metric_text);
      const detail = formatText(metric.detail_text);
      return (
        '<article class="ia-health-card">' +
          '<div class="ia-health-card__top">' +
            '<div class="ia-health-card__main">' +
              '<div class="ia-health-card__value">' + escapeHtml(value) + '</div>' +
              '<div class="ia-health-card__label">' + escapeHtml(label) + '</div>' +
              '<div class="ia-health-card__meta">' + escapeHtml(meta) + '</div>' +
            '</div>' +
            '<div class="ia-health-card__delta">' + escapeHtml(detail) + '</div>' +
          '</div>' +
          metricSparkline(metric) +
        '</article>'
      );
    }).join("");
  }

  function renderSystemOverview(system, summary, metrics) {
    if (!els.systemOverviewPanel) return;
    if (!Array.isArray(metrics) || metrics.length === 0) {
      els.systemOverviewPanel.innerHTML = '<div class="ia-empty">시스템 개요를 표시할 데이터가 없습니다.</div>';
      return;
    }

    const bars = metrics.map(function (metric) {
      const rawPercent = Number(metric.percent || 0);
      const percent = Number.isFinite(rawPercent) ? Math.max(8, Math.min(100, rawPercent)) : 8;
      const color = colorForMetric(metric.key).line;
      return (
        '<div class="ia-overview-bar-col">' +
          '<div class="ia-overview-bar-value">' + escapeHtml(formatText(metric.center_text, "0%")) + '</div>' +
          '<div class="ia-overview-bar-track">' +
            '<div class="ia-overview-bar" style="--bar-height:' + percent.toFixed(1) + '%; --bar-color:' + color + ';"></div>' +
          '</div>' +
          '<div class="ia-overview-bar-label">' + escapeHtml(formatText(metric.label, "Metric")) + '</div>' +
        '</div>'
      );
    }).join("");

    const infoTiles = [
      { label: "Hostname", value: formatText(system.hostname) },
      { label: "Platform", value: formatText(system.platform) },
      { label: "Uptime", value: formatText(system.uptime_text) },
      { label: "Approved", value: String(summary.approved_users || 0) },
    ].map(function (tile) {
      return (
        '<div class="ia-info-tile">' +
          '<span>' + escapeHtml(tile.label) + '</span>' +
          '<strong>' + escapeHtml(tile.value) + '</strong>' +
        '</div>'
      );
    }).join("");

    els.systemOverviewPanel.innerHTML =
      '<div class="ia-overview-bars">' + bars + '</div>' +
      '<div class="ia-overview-grid">' + infoTiles + '</div>';
  }

  function renderFocusPanel(system, summary, metrics) {
    if (!els.focusMetricPanel) return;
    const list = Array.isArray(metrics) ? metrics.slice() : [];
    if (list.length === 0) {
      els.focusMetricPanel.innerHTML = '<div class="ia-empty">포커스 메트릭 데이터가 없습니다.</div>';
      return;
    }

    list.sort(function (a, b) {
      return Number(b.percent || 0) - Number(a.percent || 0);
    });

    const metric = list[0];
    const color = colorForMetric(metric.key).line;
    const rawPercent = Number(metric.percent || 0);
    const percent = Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, rawPercent)) : 0;
    const stats = [
      { label: "Metric", value: formatText(metric.metric_text) },
      { label: "Detail", value: formatText(metric.detail_text) },
      { label: "Pending", value: String(summary.pending_users || 0) },
      { label: "USB", value: String(summary.usb_devices || 0) },
    ].map(function (item) {
      return (
        '<div class="ia-focus-stat">' +
          '<span>' + escapeHtml(item.label) + '</span>' +
          '<strong>' + escapeHtml(item.value) + '</strong>' +
        '</div>'
      );
    }).join("");

    els.focusMetricPanel.innerHTML =
      '<div class="ia-focus-donut" style="--value:' + percent.toFixed(1) + '; --donut-color:' + color + ';">' +
        '<div class="ia-focus-donut__inner">' +
          '<strong>' + escapeHtml(formatText(metric.center_text, "0%")) + '</strong>' +
          '<span>' + escapeHtml(formatText(metric.label, "Focus")) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="ia-focus-copy">' +
        '<h3>' + escapeHtml(formatText(metric.label, "Focus")) + ' Focus</h3>' +
        '<p>' + escapeHtml(formatText(metric.detail_text)) + '</p>' +
        '<strong>' + escapeHtml(formatText(metric.metric_text)) + '</strong>' +
      '</div>' +
      '<div class="ia-focus-stats">' + stats + '</div>';
  }

  function renderActiveUsers(users, summary) {
    if (!els.activeUsersTableBody || !els.activeUsersCount) return;
    const list = Array.isArray(users) ? users : [];
    const liveCount = Number((summary || {}).active_sessions || 0);
    const fallbackCount = list.filter(function (user) {
      const state = presenceState(user && user.presence_state);
      return state === "live" || state === "background";
    }).length;
    els.activeUsersCount.textContent = String(liveCount > 0 ? liveCount : fallbackCount);

    if (list.length === 0) {
      els.activeUsersTableBody.innerHTML = '<tr><td colspan="3" class="ia-empty">조건에 맞는 접속 계정이 없습니다.</td></tr>';
      return;
    }

    els.activeUsersTableBody.innerHTML = list.map(function (user) {
      const state = presenceState(user.presence_state);
      const rowClass = state === "inactive" ? " is-inactive" : (state === "background" ? " is-background" : "");
      return (
        '<tr class="' + rowClass + '">' +
          "<td>" +
            '<div class="ia-user-line__name">' + escapeHtml(formatText(user.display_name, user.user_id)) + "</div>" +
            '<div class="ia-user-line__meta">' + escapeHtml(formatText(user.user_id)) + "</div>" +
          "</td>" +
          "<td><span class=\"ia-badge ia-badge--" + escapeHtml(normalizeText(user.role || "user")) + "\">" + escapeHtml(formatText(user.role_label)) + "</span></td>" +
          "<td><span class=\"ia-badge ia-badge--" + escapeHtml(state) + "\">" + escapeHtml(formatText(user.presence_label, "INACTIVE")) + "</span></td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderPendingUsers(users) {
    if (!els.pendingUsersGrid) return;
    const list = Array.isArray(users) ? users : [];

    if (list.length === 0) {
      els.pendingUsersGrid.innerHTML = '<div class="ia-empty">조건에 맞는 승인 대기 계정이 없습니다.</div>';
      return;
    }

    els.pendingUsersGrid.innerHTML = list.map(function (user) {
      const transient = getStatus(user.user_id);
      const statusClass = transient
        ? (transient.type === "success" ? "is-success" : (transient.type === "error" ? "is-error" : ""))
        : "";
      return (
        '<article class="ia-approval-card">' +
          '<div class="ia-approval-card__name">' + escapeHtml(formatText(user.display_name, user.user_id)) + '</div>' +
          '<div class="ia-approval-card__meta">' +
            'ID ' + escapeHtml(formatText(user.user_id)) +
            '<br>Email ' + escapeHtml(formatText(user.email)) +
            '<br>Join ' + escapeHtml(formatText(user.join_date)) +
          '</div>' +
          '<div class="ia-action-row">' +
            '<button class="ia-action-btn ia-action-btn--approve" data-action="approve" data-user-id="' + escapeHtml(user.user_id) + '">승인</button>' +
          '</div>' +
          '<div class="ia-micro-status ' + statusClass + '" data-status-user="' + escapeHtml(user.user_id) + '">' + escapeHtml(transient ? transient.text : "") + '</div>' +
        '</article>'
      );
    }).join("");
  }

  function renderUsbDevices(devices) {
    if (!els.usbDevicesList || !els.usbCountText) return;
    const list = Array.isArray(devices) ? devices : [];
    els.usbCountText.textContent = String(list.length);

    if (list.length === 0) {
      els.usbDevicesList.innerHTML = '<div class="ia-empty">조건에 맞는 USB 장치가 없습니다.</div>';
      return;
    }

    els.usbDevicesList.innerHTML = list.map(function (device) {
      const meta = [
        device.id ? "ID " + device.id : "",
        device.bus ? "Bus " + device.bus : "",
        device.device ? "Device " + device.device : "",
      ].filter(Boolean).join(" · ");

      return (
        '<article class="ia-usb-item">' +
          '<div class="ia-usb-item__title">' + escapeHtml(formatText(device.name, "USB Device")) + '</div>' +
          '<div class="ia-usb-item__meta">' + escapeHtml(meta || "-") + '</div>' +
          '<div class="ia-usb-item__meta">' + escapeHtml(formatText(device.source)) + '</div>' +
        '</article>'
      );
    }).join("");
  }

  function renderApprovedUsers(users) {
    if (!els.approvedUsersTableBody) return;
    const list = Array.isArray(users) ? users : [];

    if (list.length === 0) {
      els.approvedUsersTableBody.innerHTML = '<tr><td colspan="5" class="ia-empty">조건에 맞는 승인 완료 계정이 없습니다.</td></tr>';
      return;
    }

    els.approvedUsersTableBody.innerHTML = list.map(function (user) {
      const transient = getStatus(user.user_id);
      const microClass = transient
        ? (transient.type === "success" ? "is-success" : (transient.type === "error" ? "is-error" : ""))
        : "";
      const sessionBadgeClass = presenceState(user.presence_state);
      const sessionText = formatText(user.presence_label, "INACTIVE");
      return (
        "<tr>" +
          "<td>" +
            '<div class="ia-cell__name">' + escapeHtml(formatText(user.display_name, user.user_id)) + "</div>" +
            '<div class="ia-cell__sub">' + escapeHtml(formatText(user.user_id)) + "<br>" + escapeHtml(formatText(user.email)) + "</div>" +
          "</td>" +
          "<td>" +
            '<span class="ia-badge ia-badge--approved">' + escapeHtml(formatText(user.approval_label)) + "</span>" +
            '<div class="ia-cell__sub">' + escapeHtml(formatText(user.approved_at)) + (user.approved_by ? "<br>" + escapeHtml(user.approved_by) : "") + "</div>" +
          "</td>" +
          "<td><span class=\"ia-badge ia-badge--" + escapeHtml(normalizeText(user.role || "user")) + "\">" + escapeHtml(formatText(user.role_label)) + "</span></td>" +
          "<td>" +
            '<span class="ia-badge ia-badge--' + sessionBadgeClass + '">' + sessionText + "</span>" +
          "</td>" +
          "<td>" +
            '<div class="ia-action-row">' +
              '<button class="ia-action-btn ia-action-btn--promote" data-action="promote" data-user-id="' + escapeHtml(user.user_id) + '"' + (user.can_promote ? "" : " disabled") + ">승격</button>" +
              '<button class="ia-action-btn ia-action-btn--demote" data-action="demote" data-user-id="' + escapeHtml(user.user_id) + '"' + (user.can_demote ? "" : " disabled") + ">강등</button>" +
            "</div>" +
            '<div class="ia-micro-status ' + microClass + '" data-status-user="' + escapeHtml(user.user_id) + '">' +
              escapeHtml(transient ? transient.text : (user.is_current_user ? "현재 로그인한 계정" : "")) +
            "</div>" +
          "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderFailure(message) {
    const text = escapeHtml(message || "통합관리 데이터를 불러오지 못했습니다.");
    if (els.healthMetricsGrid) els.healthMetricsGrid.innerHTML = '<div class="ia-empty">' + text + "</div>";
    if (els.systemOverviewPanel) els.systemOverviewPanel.innerHTML = '<div class="ia-empty">' + text + "</div>";
    if (els.focusMetricPanel) els.focusMetricPanel.innerHTML = '<div class="ia-empty">' + text + "</div>";
    if (els.activeUsersTableBody) els.activeUsersTableBody.innerHTML = '<tr><td colspan="3" class="ia-empty">' + text + "</td></tr>";
    if (els.pendingUsersGrid) els.pendingUsersGrid.innerHTML = '<div class="ia-empty">' + text + "</div>";
    if (els.usbDevicesList) els.usbDevicesList.innerHTML = '<div class="ia-empty">' + text + "</div>";
    if (els.approvedUsersTableBody) els.approvedUsersTableBody.innerHTML = '<tr><td colspan="5" class="ia-empty">' + text + "</td></tr>";
  }

  function mergeRealtimeSnapshot(snapshot) {
    const payload = snapshot || {};
    const nextSummary = Object.assign({}, ((currentPayload || {}).summary || {}), (payload.summary || {}));
    currentPayload = Object.assign({}, currentPayload || {}, {
      generated_at: payload.generated_at || ((currentPayload || {}).generated_at || ""),
      system: payload.system || ((currentPayload || {}).system || {}),
      summary: nextSummary,
      users: Array.isArray(payload.users) ? payload.users : ((currentPayload || {}).users || []),
      active_users: Array.isArray(payload.active_users) ? payload.active_users : ((currentPayload || {}).active_users || []),
    });
    renderCurrent();
  }

  function renderCurrent() {
    const payload = filteredData(currentPayload);
    const metrics = ((payload.system || {}).metrics || []);
    renderSummary((currentPayload || {}).summary || {});
    renderRuntime(payload.system || {}, payload.generated_at || "");
    renderMetrics(metrics);
    renderSystemOverview(payload.system || {}, (currentPayload || {}).summary || {}, metrics);
    renderFocusPanel(payload.system || {}, (currentPayload || {}).summary || {}, metrics);
    renderActiveUsers(payload.active_users || [], (currentPayload || {}).summary || {});
    renderPendingUsers(payload.pending_users || []);
    renderUsbDevices(payload.usb_devices || []);
    renderApprovedUsers(payload.users || []);
  }

  async function loadOverview() {
    if (!config.overviewUrl || isLoading) return;
    isLoading = true;
    try {
      const data = await fetchJson(config.overviewUrl, { cache: "no-store" });
      currentPayload = data.payload || {};
      renderCurrent();
    } catch (error) {
      renderFailure(error && error.message ? error.message : "통합관리 데이터를 불러오지 못했습니다.");
    } finally {
      isLoading = false;
    }
  }

  function scheduleSystemWsReconnect() {
    if (systemWsClosedByClient) return;
    if (systemWsReconnectTimer) return;
    systemWsReconnectTimer = window.setTimeout(function () {
      systemWsReconnectTimer = 0;
      connectSystemWs();
    }, 1500);
  }

  function connectSystemWs() {
    const wsUrl = wsUrlFromPath(config.systemWsPath || "");
    if (!wsUrl) return;
    if (systemWs && (systemWs.readyState === WebSocket.OPEN || systemWs.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      systemWs = new WebSocket(wsUrl);
    } catch (_) {
      scheduleSystemWsReconnect();
      return;
    }

    systemWs.addEventListener("message", function (event) {
      try {
        const message = JSON.parse(String(event.data || "{}"));
        if ((message.type || "") !== "realtime_snapshot") return;
        mergeRealtimeSnapshot(message.payload || {});
      } catch (_) {}
    });

    systemWs.addEventListener("close", function () {
      systemWs = null;
      scheduleSystemWsReconnect();
    });

    systemWs.addEventListener("error", function () {
      try {
        if (systemWs) systemWs.close();
      } catch (_) {}
    });
  }

  function buttonsForUser(userId) {
    return Array.from(document.querySelectorAll("[data-user-id]")).filter(function (node) {
      return node.getAttribute("data-user-id") === userId;
    });
  }

  function setUserButtonsDisabled(userId, disabled) {
    buttonsForUser(userId).forEach(function (button) {
      button.disabled = !!disabled;
    });
  }

  function refreshStatusDecorations() {
    Array.from(document.querySelectorAll("[data-status-user]")).forEach(function (node) {
      const userId = node.getAttribute("data-status-user") || "";
      const transient = getStatus(userId);
      if (!transient) return;
      node.textContent = transient.text || "";
      node.classList.toggle("is-success", transient.type === "success");
      node.classList.toggle("is-error", transient.type === "error");
    });
  }

  async function performAction(userId, action) {
    if (!config.userActionPrefix) return;
    let refreshed = false;
    setUserButtonsDisabled(userId, true);
    setStatus(userId, "처리 중...", "");
    refreshStatusDecorations();

    try {
      const url = config.userActionPrefix + encodeURIComponent(userId) + "/" + encodeURIComponent(action);
      const data = await fetchJson(url, { method: "POST" });
      setStatus(userId, data.message || "완료", "success");
      await loadOverview();
      refreshed = true;
    } catch (error) {
      setStatus(userId, error && error.message ? error.message : "처리에 실패했습니다.", "error");
      refreshStatusDecorations();
    } finally {
      if (!refreshed) {
        setUserButtonsDisabled(userId, false);
      }
    }
  }

  function setupActions() {
    document.addEventListener("click", function (event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("[data-action][data-user-id]");
      if (!(button instanceof HTMLButtonElement)) return;
      event.preventDefault();
      if (button.disabled) return;
      const action = button.getAttribute("data-action") || "";
      const userId = button.getAttribute("data-user-id") || "";
      if (!action || !userId) return;
      performAction(userId, action);
    });
  }

  function setupSearch() {
    if (!(els.dashboardSearchInput instanceof HTMLInputElement)) return;
    els.dashboardSearchInput.addEventListener("input", function () {
      if (!currentPayload) return;
      renderCurrent();
    });
  }

  function init() {
    setupActions();
    setupSearch();
    loadOverview();
    connectSystemWs();
    const refreshMs = Number(config.refreshMs || 12000);
    window.setInterval(loadOverview, refreshMs > 2000 ? refreshMs : 12000);
    window.addEventListener("beforeunload", function () {
      systemWsClosedByClient = true;
      if (systemWsReconnectTimer) {
        window.clearTimeout(systemWsReconnectTimer);
        systemWsReconnectTimer = 0;
      }
      try {
        if (systemWs) systemWs.close();
      } catch (_) {}
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
