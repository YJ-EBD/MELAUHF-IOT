(function () {
  const $ = (id) => document.getElementById(id);

  // Command console elements (avoid collisions with existing control_panel.js IDs)
  const elSelect = $('onlineDeviceSelectCmd');
  const elBtnConnect = $('btnConnectCmd');
  const elBtnDisconnect = $('btnDisconnectCmd');
  const elDot = $('connDotCmd');
  const elConnText = $('connTextCmd');

  const elCmd = $('cmdInputCmd');
  const elSend = $('btnSendCmd');
  const elClear = $('btnClearCmdConsole');
  const elBadge = $('cmdConsoleBadge');
  const elConsoleBox = $('cmdConsoleBox');
  const elPre = $('cmdConsolePre');

  const POLL_MS = 2500;
  const WS_PATH = '/ws/control-panel';

  let ws = null;
  let wsReady = false;
  let wsReconnectTimer = null;

  let pollTimer = null;

  let connState = 'disconnected'; // disconnected | connecting | connected
  let connectedKey = '';
  let pendingUserConnect = false;

  function nowStamp() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function appendLog(line) {
    if (!elPre) return;
    const text = (line === null || line === undefined) ? '' : String(line);
    elPre.textContent += `[${nowStamp()}] ${text}\n`;
    if (elConsoleBox) elConsoleBox.scrollTop = elConsoleBox.scrollHeight;
  }

  function clearLog() {
    if (elPre) elPre.textContent = '';
  }

  function setBadge(text, kind) {
    if (!elBadge) return;
    elBadge.textContent = text || '대기';
    elBadge.classList.remove('text-bg-success', 'text-bg-secondary', 'text-bg-danger', 'text-bg-warning', 'text-bg-light');
    elBadge.classList.add('border');
    if (kind === 'success') elBadge.classList.add('text-bg-success');
    else if (kind === 'danger') elBadge.classList.add('text-bg-danger');
    else if (kind === 'warning') elBadge.classList.add('text-bg-warning');
    else if (kind === 'secondary') elBadge.classList.add('text-bg-secondary');
    else elBadge.classList.add('text-bg-light');
  }

  function setConnUI(state) {
    connState = state;
    if (!elDot || !elConnText) return;
    elDot.classList.remove('disconnected', 'connecting', 'connected');

    if (state === 'connected') {
      elDot.classList.add('connected');
      elConnText.textContent = 'Connected';
      setBadge('Connected', 'success');
      if (elBtnDisconnect) elBtnDisconnect.disabled = false;
    } else if (state === 'connecting') {
      elDot.classList.add('connecting');
      elConnText.textContent = 'connecting...';
      setBadge('connecting...', 'warning');
      if (elBtnDisconnect) elBtnDisconnect.disabled = true;
    } else {
      elDot.classList.add('disconnected');
      elConnText.textContent = 'Disconnect';
      setBadge('대기', 'light');
      if (elBtnDisconnect) elBtnDisconnect.disabled = true;
    }
  }

  async function fetchJSON(url, options) {
    try {
      const res = await fetch(url, options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, data };
      return data;
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  function getWsUrl() {
    const proto = (location.protocol === 'https:') ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${WS_PATH}`;
  }

  function wsSend(obj) {
    if (!ws || !wsReady) {
      appendLog('[UI] WebSocket 연결이 아직 준비되지 않았습니다.');
      return false;
    }
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch (e) {
      appendLog(`[UI] 전송 실패: ${String(e)}`);
      return false;
    }
  }

  function openWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
      ws = new WebSocket(getWsUrl());
    } catch (e) {
      appendLog(`[WS] 생성 실패: ${String(e)}`);
      scheduleWsReconnect();
      return;
    }

    wsReady = false;

    ws.onopen = () => {
      wsReady = true;
      appendLog('[WS] ready');
    };

    ws.onclose = () => {
      wsReady = false;
      appendLog('[WS] closed');
      connectedKey = '';
      pendingUserConnect = false;
      setConnUI('disconnected');
      scheduleWsReconnect();
    };

    ws.onerror = () => {
      appendLog('[WS] error');
    };

    ws.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch (e) { msg = { type: 'raw', line: String(ev.data || '') }; }

      const t = msg && msg.type ? msg.type : 'raw';
      if (t === 'status') {
        const st = String(msg.state || '');
        const msgKey = String(msg.key || '');

        // Device TCP connection must only become active after an explicit
        // user click on "연결하기". Ignore any unexpected connect status.
        if ((st === 'connecting' || st === 'connected') && !pendingUserConnect && !connectedKey) {
          appendLog('[WS] unexpected connect status ignored');
          wsSend({ type: 'disconnect' });
          setConnUI('disconnected');
          return;
        }

        if (st === 'connected') {
          if (msgKey) connectedKey = msgKey;
          pendingUserConnect = false;
          setConnUI('connected');
        } else if (st === 'connecting') {
          if (msgKey) connectedKey = msgKey;
          setConnUI('connecting');
        } else {
          connectedKey = '';
          pendingUserConnect = false;
          setConnUI('disconnected');
        }

        if (msg.message) appendLog(String(msg.message));
      } else if (t === 'log') {
        appendLog(String(msg.line || ''));
      } else if (t === 'error') {
        appendLog(`[ERR] ${String(msg.message || 'unknown error')}`);
        pendingUserConnect = false;
        setBadge('Error', 'danger');
      } else {
        appendLog(String(msg.line || msg.message || ev.data || ''));
      }
    };
  }

  function scheduleWsReconnect() {
    if (wsReconnectTimer) return;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      openWs();
    }, 1200);
  }

  function updateDeviceSelect(devices) {
    if (!elSelect) return;
    const current = elSelect.value || '';

    const online = (devices || []).filter((d) => String(d.status || '') === 'Online');

    elSelect.innerHTML = '';
    if (online.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Online 디바이스 없음';
      elSelect.appendChild(opt);
      return;
    }

    for (const d of online) {
      const opt = document.createElement('option');
      const ip = String(d.ip || '').trim();
      const did = String(d.device_id || '').trim();
      const token = String(d.token || '').trim();
      const customer = String(d.customer || '-').trim() || '-';
      const name = String(d.name || did || ip || 'device').trim();

      opt.value = did || ip;
      opt.textContent = `${name} (${customer}) - ${ip}`;
      opt.dataset.ip = ip;
      opt.dataset.deviceId = did;
      opt.dataset.token = token;
      opt.dataset.customer = customer;
      elSelect.appendChild(opt);
    }

    if (current) {
      const found = Array.from(elSelect.options).find((o) => o.value === current);
      if (found) elSelect.value = current;
    }
  }

  async function pollOnlineDevices() {
    const data = await fetchJSON('/api/device-status');
    if (!data || data.ok === false) return;
    updateDeviceSelect(data.devices || []);
  }

  function connectSelected() {
    if (!elSelect) return;
    const opt = elSelect.selectedOptions && elSelect.selectedOptions[0];
    if (!opt || !opt.dataset) {
      appendLog('[UI] Online 디바이스를 선택해 주세요.');
      return;
    }
    const ip = String(opt.dataset.ip || '').trim();
    const deviceId = String(opt.dataset.deviceId || '').trim();
    const token = String(opt.dataset.token || '').trim();
    const customer = String(opt.dataset.customer || '-').trim() || '-';

    if (!ip) {
      appendLog('[UI] 디바이스 IP가 비어 있습니다.');
      return;
    }

    pendingUserConnect = true;
    connectedKey = '';
    setConnUI('connecting');
    if (!wsSend({ type: 'connect', ip, device_id: deviceId, token, customer })) {
      pendingUserConnect = false;
      setConnUI('disconnected');
      openWs();
    }
  }

  function disconnect() {
    pendingUserConnect = false;
    wsSend({ type: 'disconnect' });
    appendLog('[UI] 연결 종료');
    connectedKey = '';
    setConnUI('disconnected');
  }

  function sendCmd() {
    const cmd = (elCmd ? elCmd.value : '').trim();
    if (!cmd) return;

    if (connState !== 'connected') {
      appendLog('[UI] 연결 필요: 먼저 디바이스를 연결해 주세요.');
      try { window.alert('연결 필요: 먼저 디바이스를 연결해 주세요.'); } catch (e) {}
      return;
    }

    wsSend({ type: 'send', cmd });
    if (elCmd) elCmd.value = '';
  }

  function bind() {
    if (elBtnConnect) elBtnConnect.addEventListener('click', connectSelected);
    if (elBtnDisconnect) elBtnDisconnect.addEventListener('click', disconnect);
    if (elSend) elSend.addEventListener('click', sendCmd);
    if (elClear) elClear.addEventListener('click', clearLog);

    if (elCmd) {
      elCmd.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendCmd();
        }
      });
    }
  }

  function init() {
    bind();
    openWs();
    pollOnlineDevices();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollOnlineDevices, POLL_MS);
    setConnUI('disconnected');
    setBadge('대기', 'light');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
