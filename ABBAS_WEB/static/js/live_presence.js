(function () {
  const config = window.LivePresenceConfig || {};
  const heartbeatMs = Math.max(Number(config.heartbeatMs || 8000), 4000);
  const storageKey = "abbas.livePresence.clientId";
  let socket = null;
  let reconnectTimer = 0;
  let heartbeatTimer = 0;
  let closedByClient = false;
  let disconnectSent = false;

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function resolveWsUrl(path) {
    const normalized = normalizeText(path);
    if (!normalized) return "";
    if (normalized.indexOf("ws://") === 0 || normalized.indexOf("wss://") === 0) {
      return normalized;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return protocol + "//" + window.location.host + normalized;
  }

  function randomId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
      }
    } catch (_) {}
    return "presence-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function clientId() {
    try {
      const existing = sessionStorage.getItem(storageKey) || "";
      if (existing) return existing;
      const next = randomId();
      sessionStorage.setItem(storageKey, next);
      return next;
    } catch (_) {
      return randomId();
    }
  }

  function currentState() {
    return document.visibilityState === "hidden" ? "hidden" : "visible";
  }

  function currentPayload() {
    return JSON.stringify({
      type: "presence",
      state: currentState(),
      path: window.location.pathname + window.location.search,
      title: document.title || "",
    });
  }

  function sendPresence() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(currentPayload());
    } catch (_) {}
  }

  function stopHeartbeat() {
    if (!heartbeatTimer) return;
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = window.setInterval(sendPresence, heartbeatMs);
  }

  function scheduleReconnect() {
    if (closedByClient || reconnectTimer) return;
    reconnectTimer = window.setTimeout(function () {
      reconnectTimer = 0;
      connect();
    }, 1500);
  }

  function disconnectBeacon() {
    if (disconnectSent) return;
    disconnectSent = true;
    const disconnectUrl = normalizeText(config.disconnectUrl);
    if (!disconnectUrl || typeof navigator.sendBeacon !== "function") return;
    try {
      navigator.sendBeacon(disconnectUrl + "?client_id=" + encodeURIComponent(clientId()), "");
    } catch (_) {}
  }

  function closeSocket() {
    stopHeartbeat();
    try {
      if (socket) socket.close();
    } catch (_) {}
    socket = null;
  }

  function connect() {
    const wsBase = resolveWsUrl(config.wsPath || "");
    if (!wsBase) return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

    const separator = wsBase.indexOf("?") === -1 ? "?" : "&";
    try {
      socket = new WebSocket(wsBase + separator + "client_id=" + encodeURIComponent(clientId()));
    } catch (_) {
      scheduleReconnect();
      return;
    }

    socket.addEventListener("open", function () {
      disconnectSent = false;
      sendPresence();
      startHeartbeat();
    });

    socket.addEventListener("close", function () {
      stopHeartbeat();
      socket = null;
      scheduleReconnect();
    });

    socket.addEventListener("error", function () {
      try {
        if (socket) socket.close();
      } catch (_) {}
    });
  }

  document.addEventListener("visibilitychange", sendPresence);
  window.addEventListener("focus", sendPresence);
  window.addEventListener("pageshow", function () {
    if (closedByClient) {
      closedByClient = false;
      disconnectSent = false;
      connect();
      return;
    }
    sendPresence();
  });

  function finalizeClientClose() {
    closedByClient = true;
    disconnectBeacon();
    closeSocket();
  }

  window.addEventListener("pagehide", finalizeClientClose);
  window.addEventListener("beforeunload", finalizeClientClose);

  connect();
})();
