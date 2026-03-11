(function () {
  const $ = (id) => document.getElementById(id);

  const elCustomer = $('customerFilter');
  const elFind = $('btnFindDevices');
  const elSelect = $('deviceSelect');
  const elNoDeviceResult = $('noDeviceResult');

  const elSaveBox = $('saveBox');
  const elSaveName = $('inputDeviceName');
  const elSaveCustomer = $('inputCustomer');
  const elSaveBtn = $('btnSaveDevice');
  const elSaveMsg = $('saveMsg');
  const elSaveResultBanner = $('saveResultBanner');

  const elPower = $('metricPower');
  const elTime = $('metricTime');

  const elClear = $('btnClearConsole');
  const elBadge = $('consoleBadge');
  const elBox = $('consoleBox');
  const elPre = $('consolePre');

  let savedDevices = [];
  let discoveredDevices = [];
  let hasSearched = false;

  let tailCursor = 0;
  let pollTimer = null;
  let activeIp = '';
  let activeCustomer = '';
  let activeToken = '';
  let activeDeviceId = '';
  let lastStatus = '';

  function showLoadingUI(label) {
    if (window.AppUI && typeof window.AppUI.showLoading === 'function') {
      window.AppUI.showLoading(label || '처리 중...');
    }
  }
  function hideLoadingUI() {
    if (window.AppUI && typeof window.AppUI.hideLoading === 'function') {
      window.AppUI.hideLoading();
    }
  }

  function setBadge(status) {
    if (!elBadge) return;
    elBadge.textContent = status || '대기';
    elBadge.classList.remove('text-bg-success', 'text-bg-secondary', 'text-bg-danger', 'text-bg-light');
    elBadge.classList.add('text-bg-light', 'border');

    if (status === 'Online') {
      elBadge.classList.remove('text-bg-light');
      elBadge.classList.add('text-bg-success');
    } else if (status === 'Offline') {
      elBadge.classList.remove('text-bg-light');
      elBadge.classList.add('text-bg-secondary');
    } else if (status === 'Error') {
      elBadge.classList.remove('text-bg-light');
      elBadge.classList.add('text-bg-danger');
    }
  }

  function safeText(v) {
    return (v === null || v === undefined) ? '' : String(v);
  }

  async function fetchJSON(url, options) {
    try {
      const res = await fetch(url, options);
      if (res.status === 401) {
        const p = (location.pathname || "");
        if (!(p.startsWith("/login") || p.startsWith("/signup"))) {
          const next = encodeURIComponent(location.pathname + location.search);
          location.href = `/login?next=${next}`;
          return { ok: false, status: 401, data: { detail: "unauthorized" } };
        }
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, status: res.status, data };
      }
      return data;
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  function getFilterCustomer() {
    if (!elCustomer) return '';
    return elCustomer.value || '';
  }

  function updateCustomerOptions(customers, selected) {
    if (!elCustomer) return;
    const sel = selected || elCustomer.value || '';
    const opts = [''].concat(customers || []);
    elCustomer.innerHTML = '';
    for (const c of opts) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c ? c : '전체 거래처';
      if (c === sel) opt.selected = true;
      elCustomer.appendChild(opt);
    }
  }

  function keyOf(d) {
    const did = safeText(d.device_id || d.deviceId);
    if (did) return did;
    const ip = safeText(d.ip);
    if (ip) return ip;
    const t = safeText(d.token);
    if (t) return t;
    return `${safeText(d.customer)}|${safeText(d.name)}|${safeText(d.ip)}`;
  }

  function renderSelect(keepSelection = true) {
    if (!elSelect) return;

    // 요구사항(최종): "찾기" 버튼을 누르기 전까지는 dropdownlist에
    // 아무것도 뜨면 안 된다. (저장/등록된 디바이스 포함)
    // 또한 다른 페이지 이동 후 다시 돌아와도 초기 상태(빈 목록)로 유지.
    if (!hasSearched) {
      elSelect.innerHTML = '';
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '찾기 버튼을 눌러 디바이스를 검색해 주세요';
      elSelect.appendChild(opt);

      // 검색 전에는 저장 UI/선택 상태도 숨김
      showSaveBox(false);
      activeToken = '';
      activeDeviceId = '';
      activeIp = '';
      activeCustomer = '';
      tailCursor = 0;
      clearConsole(true);
      if (elPower) elPower.textContent = '-';
      if (elTime) elTime.textContent = '-';
      setBadge('대기');
      if (elNoDeviceResult) elNoDeviceResult.classList.add('d-none');
      return;
    }

    const currentValue = keepSelection ? elSelect.value : '';
    const filterCustomer = getFilterCustomer();

    const options = [];

    // Discovered devices (online): only unsaved devices should be listed here.
    let discoveredFiltered = 0;
    let savedFiltered = 0;
    for (const d of (discoveredDevices || [])) {
      const ip = safeText(d.ip);
      const customer = safeText(d.customer) || '-';
      if (filterCustomer && customer !== filterCustomer) continue;
      discoveredFiltered += 1;

      const deviceId = safeText(d.device_id) || '';
      const token = safeText(d.token) || '';
      const name = safeText(d.name || d.device_name || d.model) || deviceId || ip;
      const status = safeText(d.status || 'Online');
      const isSaved = !!d.saved;
      if (isSaved) {
        savedFiltered += 1;
        continue;
      }

      options.push({
        saved: false,
        ip,
        customer,
        token,
        deviceId,
        name,
        status,
        label: `미등록: ${name} / ${ip} (${customer})${status ? ` [${status}]` : ''}`,
      });
    }

    // (검색 결과 0개 표시)
    if (elNoDeviceResult) {
      const hasAny = options.length > 0;
      if (hasSearched && !hasAny) {
        const msgEl = elNoDeviceResult.querySelector('span');
        if (msgEl) {
          msgEl.textContent = (discoveredFiltered === 0)
            ? '검색 결과가 없습니다. (디바이스가 온라인인지 확인해 주세요)'
            : (savedFiltered === discoveredFiltered)
              ? '이미 저장된 디바이스만 검색되었습니다.'
              : '표시할 미등록 디바이스가 없습니다.';
        }
        elNoDeviceResult.classList.remove('d-none');
      } else {
        elNoDeviceResult.classList.add('d-none');
      }
    }

    elSelect.innerHTML = '';
    if (options.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = hasSearched ? '검색 결과 없음' : '디바이스 없음';
      elSelect.appendChild(opt);
      onSelectChanged();
      return;
    }

    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.deviceId || o.ip;
      opt.textContent = o.label;
      opt.dataset.customer = o.customer;
      opt.dataset.ip = o.ip;
      opt.dataset.token = o.token || '';
      opt.dataset.deviceId = o.deviceId || '';
      opt.dataset.name = o.name;
      opt.dataset.status = o.status || '';
      opt.dataset.saved = o.saved ? '1' : '0';
      elSelect.appendChild(opt);
    }

    // selection 유지
    if (keepSelection && currentValue) {
      const found = Array.from(elSelect.options).find((o) => o.value === currentValue);
      if (found) elSelect.value = currentValue;
    }

    onSelectChanged();
  }

  function showSaveBox(show, ip, customer, suggestedName) {
    if (!elSaveBox) return;
    if (!show) {
      elSaveBox.classList.add('d-none');
      return;
    }
    elSaveBox.classList.remove('d-none');
    if (elSaveName && suggestedName) elSaveName.value = suggestedName;
    if (elSaveCustomer) elSaveCustomer.value = customer || getFilterCustomer() || '';
    if (elSaveMsg) elSaveMsg.textContent = ip ? `IP: ${ip}` : '';
  }

  function clearConsole(keepCursor) {
    if (elPre) elPre.textContent = '';
    if (!keepCursor) tailCursor = 0;
  }

  function localLog(msg) {
    if (!elPre) return;
    const d = new Date();
    const t = d.toTimeString().split(' ')[0];
    elPre.textContent += `[${t}] ${msg}\n`;
    if (elBox) elBox.scrollTop = elBox.scrollHeight;
  }

  let lastDeviceLine = '';
  let lastDeviceLineAt = 0;

  function appendConsole(lines) {
    if (!elPre || !lines || lines.length === 0) return;

    const shouldStickBottom = elBox ? (elBox.scrollTop + elBox.clientHeight >= elBox.scrollHeight - 32) : true;

    let buf = '';
    for (const row of lines) {
      const t = safeText(row.t);
      const line = safeText(row.line);
      if (!line) continue;
      if (t) buf += `[${t}] ${line}\n`;
      else buf += `${line}\n`;
    }
    if (buf) elPre.textContent += buf;

    if (elBox && shouldStickBottom) {
      elBox.scrollTop = elBox.scrollHeight;
    }
  }

  function onSelectChanged() {
    if (!elSelect) return;

    const opt = elSelect.options[elSelect.selectedIndex];
    const token = opt ? safeText(opt.dataset.token) : '';
    const deviceId = opt ? safeText(opt.dataset.deviceId) : '';
    const ip = opt ? safeText(opt.dataset.ip) : '';
    const customer = opt ? safeText(opt.dataset.customer) : '';

    activeToken = token;
    activeDeviceId = deviceId;
    activeIp = ip;
    activeCustomer = customer;

    tailCursor = -1;
    clearConsole(true);

    // 저장 UI
    const isSaved = opt ? (opt.dataset.saved === '1') : true;
    const suggestedName = opt ? safeText(opt.dataset.name) : '';
    showSaveBox(!isSaved && !!ip, ip, customer, suggestedName);

    // 초기 메트릭 초기화
    if (elPower) elPower.textContent = '-';
    if (elTime) elTime.textContent = '-';

    setBadge('대기');
  }

  async function refreshSaved() {
    // Saved devices + current runtime status (Online/Offline/Error)
    const resp = await fetchJSON('/api/device-status');
    if (resp && resp.ok) {
      savedDevices = resp.devices || [];
      updateCustomerOptions(resp.customers || [], getFilterCustomer());
    } else {
      // fallback
      const r2 = await fetchJSON('/api/devices/saved');
      if (r2 && r2.ok) {
        savedDevices = r2.devices || [];
        updateCustomerOptions(r2.customers || [], getFilterCustomer());
      }
    }
  }

  async function refreshDiscovered() {
    const resp = await fetchJSON('/api/devices/discovered');
    if (resp && resp.ok) {
      discoveredDevices = resp.devices || [];
    } else {
      discoveredDevices = [];
    }
  }

  async function doSaveSelected() {
    if (!elSelect) return;

    const opt = elSelect.options[elSelect.selectedIndex];
    const token = opt ? safeText(opt.dataset.token) : '';
    const deviceId = opt ? safeText(opt.dataset.deviceId) : '';
    const ip = opt ? safeText(opt.dataset.ip) : '';
    const customer = (elSaveCustomer ? elSaveCustomer.value : '') || safeText(opt.dataset.customer) || '-';
    const name = (elSaveName ? elSaveName.value : '') || safeText(opt.dataset.name) || ip;

    if (!ip) return;

    showLoadingUI('디바이스 저장 중...');
    if (elSaveMsg) elSaveMsg.textContent = '저장 중...';
    if (elSaveResultBanner) {
      elSaveResultBanner.classList.add('d-none');
      elSaveResultBanner.textContent = '';
    }

    const payload = { name, ip, customer, token, device_id: deviceId };
    const resp = await fetchJSON('/api/devices/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (resp && resp.ok) {
      if (elSaveMsg) elSaveMsg.textContent = resp.existing ? '저장 완료(기존 등록)' : '저장 완료';
      localLog(`저장 완료: ${name} / ${ip} (${customer})`);
      if (elSaveResultBanner) {
        elSaveResultBanner.textContent = `등록된 token: ${safeText(resp.token || '')}`;
        localLog(`token: ${safeText(resp.token || '')}`);
        elSaveResultBanner.classList.remove('d-none');
      }
      hideLoadingUI();
      await refreshSaved();
      renderSelect(true);
      showSaveBox(false);
    } else {
      hideLoadingUI();
      if (elSaveMsg) elSaveMsg.textContent = '저장 실패';
    }
  }

  async function pollTail() {
    if (!activeDeviceId && !activeIp) {
      setBadge('대기');
      return;
    }

    const url = `/api/device/tail?device_id=${encodeURIComponent(activeDeviceId || '')}&token=${encodeURIComponent(activeToken || '')}&ip=${encodeURIComponent(activeIp || '')}&customer=${encodeURIComponent(activeCustomer || '-')}&cursor=${encodeURIComponent(String(tailCursor))}`;
    const resp = await fetchJSON(url);
    if (!resp || resp.ok === false) {
      setBadge('오류');
      return;
    }

    const curStatus = resp.status || '대기';
    setBadge(curStatus);
    if (curStatus !== lastStatus) {
      lastStatus = curStatus;
      localLog(`상태: ${curStatus}`);
    }

    if (elPower) elPower.textContent = safeText(resp.power || '-');
    if (elTime) elTime.textContent = safeText(resp.time_sec || '-');

    appendConsole(resp.logs || []);

    const next = Number(resp.next_cursor || 0);
    if (!Number.isNaN(next)) tailCursor = next;
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollTail, 1000);
    pollTail();
  }

  function bind() {
    if (elSelect) {
      elSelect.addEventListener('change', onSelectChanged);
    }
    if (elFind) {
      elFind.addEventListener('click', async function () {
        showLoadingUI('디바이스 검색 중...');
        setBadge('찾는 중');
        localLog('디바이스 찾기 시작');
	        hasSearched = true;
        await refreshDiscovered();

        const filterCustomer = getFilterCustomer();
        const list = (discoveredDevices || []).filter((d) => {
          const c = safeText(d.customer) || '-';
          if (filterCustomer && c !== filterCustomer) return false;
          return true;
        });

        if (list.length === 0) {
          localLog('검색 결과가 없습니다. (디바이스가 온라인인지 확인해 주세요)');
        } else {
          for (const d of list) {
            const ip = safeText(d.ip);
            const dev = safeText(d.name || d.device_name || d.model || d.device_id) || 'Device';
            const cust = safeText(d.customer) || '-';
            localLog(`발견: ${dev} / ${ip} (${cust})`);
          }
        }

        renderSelect(true);
        setBadge('대기');
        hideLoadingUI();
      });
    }
    if (elCustomer) {
      elCustomer.addEventListener('change', function () {
        renderSelect(true);
      });
    }
    if (elSaveBtn) {
      elSaveBtn.addEventListener('click', doSaveSelected);
    }
    if (elClear) {
      elClear.addEventListener('click', function () {
        clearConsole(true);
      });
    }
  }

  function resetSearchState() {
    // 다른 페이지로 이동 후 돌아왔을 때(BFCache/pageshow 포함)
    // dropdownlist가 저장 디바이스로 채워지거나, 이전 검색 결과가 남지 않도록
    // 항상 "찾기 전" 상태로 초기화한다.
    hasSearched = false;
    discoveredDevices = [];
    renderSelect(false);
  }

  async function init() {
    bind();
    await refreshSaved();
    // 최초 진입은 반드시 "찾기 전" 상태(빈 dropdown)로
    resetSearchState();
    startPolling();
  }

  // BFCache로 돌아오는 경우에도 초기 상태 유지
  window.addEventListener('pageshow', function () {
    resetSearchState();
  });

  // DOMReady
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
