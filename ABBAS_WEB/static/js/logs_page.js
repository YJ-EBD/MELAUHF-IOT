(function () {
  const cardWrap = document.getElementById("logDeviceCards");
  const modalEl = document.getElementById("deviceLogModal");
  if (!cardWrap || !modalEl || !window.bootstrap) return;

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  const modalTitle = document.getElementById("logModalTitle");
  const modalMeta = document.getElementById("logModalMeta");
  const logFileContent = document.getElementById("logFileContent");
  const analysisSummaryTitle = document.getElementById("logAnalysisSummaryTitle");
  const analysisTimelineTitle = document.getElementById("logAnalysisTimelineTitle");
  const analysisSummary = document.getElementById("logAnalysisSummary");
  const analysisTimeline = document.getElementById("logAnalysisTimeline");
  const analysisWrap = document.getElementById("logAnalysisWrap");
  const btnDeleteActivity = document.getElementById("btnDeleteActivityLogFile");
  const btnDeleteEnergy = document.getElementById("btnDeleteEnergyLogFile");
  const btnReload = document.getElementById("btnReloadLogFile");
  const btnDownload = document.getElementById("btnDownloadLogFile");
  const btnTabActivity = document.getElementById("logTabActivity");
  const btnTabEnergy = document.getElementById("logTabEnergy");

  let activeDevice = null;
  let activeLogTab = "activity";
  let deleteBusy = false;
  let remoteDeleteSupported = false;

  const LOG_TABS = {
    activity: {
      label: "동작로그",
      filename: "MELAUHF_Log.txt",
      path: "/MELAUHF_Log.txt",
      analyzable: true,
      summaryTitle: "분석 요약",
      timelineTitle: "동작 해석",
      loadingMessage: "로그를 분석 중입니다...",
    },
    energy: {
      label: "에너지로그",
      filename: "TotalEnergy.txt",
      path: "/TotalEnergy.txt",
      analyzable: true,
      summaryTitle: "분석 요약",
      timelineTitle: "에너지 해석",
      loadingMessage: "에너지 로그를 분석 중입니다...",
    },
  };

  const PAGE_LABELS = {
    57: "동작 상세",
    61: "구독/진입",
    62: "동작 화면",
    63: "Wi-Fi 스캔",
    65: "Wi-Fi 정보",
    66: "Wi-Fi 연결 준비",
    67: "Wi-Fi 연결 시도",
    68: "메인/대기",
  };

  const KEY_LABELS = {
    "0A01": "입력",
    "0A03": "입력",
    "0A04": "입력",
    "0A05": "입력",
    "0B01": "확인",
    "4101": "이전",
    "4102": "다음",
    "4111": "선택/진입",
    "4444": "Wi-Fi 스캔",
    "5001": "확인",
    "8001": "확인",
    "8002": "다음/증가",
    "8003": "이전/감소",
    "8004": "이동",
    "8005": "이동",
    "8006": "이동",
    "8008": "입력",
    "8009": "입력",
    "8010": "입력",
    "8011": "입력",
    "8012": "입력",
    "8013": "입력",
    "8014": "동작 진입",
    "8015": "편집 진입",
    "8058": "복귀",
    "AAA4": "Wi-Fi 연결 시작",
    "AAA6": "다음 단계",
    "BB04": "입력",
    "BB08": "입력",
    "BB09": "입력",
    "BB14": "입력",
    "CC01": "연결 대기",
  };

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sdInserted(v) {
    return v === true || v === "true" || v === 1 || v === "1";
  }

  function tsLabel(e) {
    if (!e) return "-";
    if (e.tsRaw) return e.tsRaw;
    return `line ${e.lineNo || "-"}`;
  }

  function pageLabel(page) {
    const p = Number(page);
    const name = PAGE_LABELS[p];
    if (!name) return `page ${p}`;
    return `page ${p} (${name})`;
  }

  function keyLabel(code) {
    const c = String(code || "").toUpperCase();
    return KEY_LABELS[c] || "-";
  }

  function toNum(v, fallback) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    return fallback;
  }

  function formatCap(mb) {
    const n = Math.max(toNum(mb, 0), 0);
    if (n >= 1024) return `${(n / 1024).toFixed(2)} GB`;
    return `${Math.round(n)} MB`;
  }

  function formatEnergyJ(v) {
    const n = Math.max(Math.round(toNum(v, 0)), 0);
    return `${n.toLocaleString()} J`;
  }

  function capLabel(d, keyMb, keyLabel, inserted) {
    if (!inserted) return "-";
    const label = (d && d[keyLabel]) ? String(d[keyLabel]) : "";
    if (label) return label;
    return formatCap(d ? d[keyMb] : 0);
  }

  function buildCardHtml(d) {
    const online = String((d && d.status) || "") === "Online";
    const inserted = online && sdInserted(d.sd_inserted);
    const usedPct = inserted ? Math.max(0, Math.min(100, toNum(d.sd_used_percent, 0))) : 0;

    const ipRaw = String((d && d.ip) || "");
    const deviceIdRaw = String((d && d.device_id) || "");
    const tokenRaw = String((d && d.token) || "");
    const nameRaw = String((d && (d.name || ipRaw || "-")) || "-");
    const customerRaw = String((d && d.customer) || "-");
    const sdBadgeClass = !online ? "disconnected" : (inserted ? "on" : "off");
    const sdBadgeLabel = !online ? "Disconnected" : (inserted ? "Inserted" : "Not inserted");

    const name = esc(nameRaw);
    const customer = esc(customerRaw);
    const ip = esc(ipRaw || "-");
    const deviceId = esc(deviceIdRaw || "-");
    const token = esc(tokenRaw);
    const totalLabel = esc(capLabel(d, "sd_total_mb", "sd_total_label", inserted));
    const usedLabel = esc(capLabel(d, "sd_used_mb", "sd_used_label", inserted));
    const freeLabel = esc(capLabel(d, "sd_free_mb", "sd_free_label", inserted));

    return `
      <div class="col-12 col-md-6 col-xl-4">
        <button
          type="button"
          class="log-card-btn btnOpenLogModal"
          data-device-id="${esc(deviceIdRaw)}"
          data-device-name="${name}"
          data-ip="${esc(ipRaw)}"
          data-customer="${esc(customerRaw)}"
          data-token="${token}"
        >
          <div class="card shadow-sm h-100">
            <div class="card-body">
              <div class="d-flex align-items-start justify-content-between gap-2">
                <div>
                  <div class="fw-semibold">${name}</div>
                  <div class="small text-secondary">거래처: ${customer}</div>
                </div>
                <span class="sd-badge ${sdBadgeClass}">${sdBadgeLabel}</span>
              </div>

              <hr class="my-3">

              <div class="small">
                <div class="text-secondary">IP</div>
                <div class="fw-semibold">${ip}</div>
              </div>
              <div class="small mt-2">
                <div class="text-secondary">MAC(Device ID)</div>
                <div class="fw-semibold">${deviceId}</div>
              </div>

              <div class="small mt-3">
                <div class="text-secondary">Total</div>
                <div class="fw-semibold">${totalLabel}</div>
              </div>
              <div class="small mt-2">
                <div class="text-secondary">Used</div>
                <div class="fw-semibold">${usedLabel}</div>
              </div>
              <div class="small mt-2">
                <div class="text-secondary">Remaining</div>
                <div class="fw-semibold">${freeLabel}</div>
              </div>

              <div class="mt-3">
                <div class="d-flex justify-content-between small text-secondary mb-1">
                  <span>사용량</span>
                  <span>${usedPct.toFixed(1)}%</span>
                </div>
                <div class="sd-progress">
                  <span class="sd-progress-fill" style="width:${usedPct}%;"></span>
                </div>
              </div>
            </div>
          </div>
        </button>
      </div>
    `;
  }

  function renderCards(devices) {
    const list = Array.isArray(devices) ? devices : [];
    if (!list.length) {
      cardWrap.innerHTML = `
        <div class="col-12">
          <div class="alert alert-warning mb-0">
            저장된 디바이스가 없습니다. <a href="/control-panel" class="alert-link">제어 패널</a>에서 디바이스를 등록해주세요.
          </div>
        </div>
      `;
      return;
    }
    cardWrap.innerHTML = list.map(buildCardHtml).join("");
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

  function buildDeviceParams(device) {
    const params = new URLSearchParams();
    params.set("device_id", device.deviceId || "");
    params.set("ip", device.ip || "");
    params.set("customer", device.customer || "-");
    params.set("token", device.token || "");
    return params;
  }

  function setLogViewer(text) {
    if (!logFileContent) return;
    logFileContent.textContent = text || "";
  }

  function setAnalysis(summaryHtml, timelineHtml) {
    if (analysisSummary) analysisSummary.innerHTML = summaryHtml;
    if (analysisTimeline) analysisTimeline.innerHTML = timelineHtml;
  }

  function activeLogSpec() {
    return LOG_TABS[activeLogTab] || LOG_TABS.activity;
  }

  function setAnalysisVisibility(show) {
    if (!analysisWrap) return;
    analysisWrap.classList.toggle("d-none", !show);
  }

  function syncDeleteButtons() {
    const activityOn = activeLogTab === "activity";
    const energyOn = activeLogTab === "energy";
    const deleteDisabled = deleteBusy || !remoteDeleteSupported;
    const deleteTitle = remoteDeleteSupported ? "" : "원격 SD 삭제는 비활성화되어 있습니다. 현재는 서버 저장 로그만 조회 가능합니다.";

    if (btnDeleteActivity) {
      btnDeleteActivity.classList.toggle("d-none", !activityOn);
      btnDeleteActivity.classList.toggle("btn-danger", activityOn);
      btnDeleteActivity.classList.toggle("btn-outline-danger", !activityOn);
      btnDeleteActivity.disabled = deleteDisabled;
      btnDeleteActivity.title = deleteTitle;
    }
    if (btnDeleteEnergy) {
      btnDeleteEnergy.classList.toggle("d-none", !energyOn);
      btnDeleteEnergy.classList.toggle("btn-danger", energyOn);
      btnDeleteEnergy.classList.toggle("btn-outline-danger", !energyOn);
      btnDeleteEnergy.disabled = deleteDisabled;
      btnDeleteEnergy.title = deleteTitle;
    }
  }

  function logSourceLabel(source) {
    if (source === "device_sd") return "원격 SD 원본";
    if (source === "server_uploaded_raw") return "서버 적재 원본";
    if (source === "server_energy_summary") return "서버 저장 에너지요약";
    return "서버 저장 동작로그";
  }

  function setAnalysisTitles(spec) {
    const resolved = spec || activeLogSpec();
    if (analysisSummaryTitle) {
      analysisSummaryTitle.innerHTML = `<i class="bi bi-bar-chart-line me-1"></i>${esc(resolved.summaryTitle || "분석 요약")}`;
    }
    if (analysisTimelineTitle) {
      analysisTimelineTitle.innerHTML = `<i class="bi bi-diagram-3 me-1"></i>${esc(resolved.timelineTitle || "분석 해석")}`;
    }
  }

  function setLogTab(tabKey) {
    activeLogTab = Object.prototype.hasOwnProperty.call(LOG_TABS, tabKey) ? tabKey : "activity";
    if (btnTabActivity) {
      const on = activeLogTab === "activity";
      btnTabActivity.classList.toggle("active", on);
      btnTabActivity.setAttribute("aria-selected", on ? "true" : "false");
    }
    if (btnTabEnergy) {
      const on = activeLogTab === "energy";
      btnTabEnergy.classList.toggle("active", on);
      btnTabEnergy.setAttribute("aria-selected", on ? "true" : "false");
    }
    setAnalysisVisibility(activeLogSpec().analyzable);
    setAnalysisTitles(activeLogSpec());
    syncDeleteButtons();
  }

  function setAnalysisMessage(msg) {
    const m = esc(msg || "분석 정보가 없습니다.");
    setAnalysis(`<span class="analysis-empty">${m}</span>`, `<span class="analysis-empty">${m}</span>`);
  }

  function parseSdLogText(text) {
    const raw = String(text || "");
    const lines = raw.split(/\r?\n/);
    const out = [];

    for (let i = 0; i < lines.length; i += 1) {
      const row = lines[i];
      const trimmed = row.trim();
      if (!trimmed) continue;

      let tsRaw = "";
      let msg = trimmed;
      const m = trimmed.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (m) {
        tsRaw = String(m[1] || "").trim();
        msg = String(m[2] || "").trim();
      }
      if (!msg) continue;

      const entry = {
        lineNo: i + 1,
        tsRaw,
        msg,
        synced: false,
        unsyncSec: null,
        epochMs: null,
        type: "misc",
        page: null,
        keyCode: "",
      };

      if (tsRaw) {
        const u = tsRaw.match(/^UNSYNC\+(\d+)s$/i);
        if (u) {
          entry.unsyncSec = Number(u[1]);
        } else {
          entry.synced = true;
          const d = new Date(tsRaw.replace(" ", "T"));
          if (!Number.isNaN(d.getTime())) {
            entry.epochMs = d.getTime();
          }
        }
      }

      const pageM = msg.match(/^page\s+(\d{1,3})$/i);
      if (pageM) {
        entry.type = "page";
        entry.page = Number(pageM[1]);
      }

      const keyM = msg.match(/^RKC\s*:\s*0x([0-9a-fA-F]{1,4})$/i);
      if (keyM) {
        entry.type = "rkc";
        entry.keyCode = keyM[1].toUpperCase().padStart(4, "0");
      }

      if (/^BOOT:/i.test(msg)) {
        entry.type = "boot";
      }

      out.push(entry);
    }

    return out;
  }

  function pageFlow(entries) {
    const seq = [];
    for (const e of entries) {
      if (e.type !== "page" || !Number.isFinite(e.page)) continue;
      if (!seq.length || seq[seq.length - 1] !== e.page) {
        seq.push(e.page);
      }
    }
    return seq;
  }

  function topKeyCounts(entries, limit) {
    const m = new Map();
    for (const e of entries) {
      if (e.type !== "rkc" || !e.keyCode) continue;
      m.set(e.keyCode, (m.get(e.keyCode) || 0) + 1);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit);
  }

  function hasWifiSignal(flow) {
    if (!flow) return false;
    return Boolean(flow.scan || flow.select || flow.page65 || flow.page66 || flow.connect || flow.page67);
  }

  function detectWifiFlows(entries) {
    const flows = [];
    let flow = null;

    for (const e of entries) {
      if (e.type === "page" && e.page === 63) {
        if (flow && hasWifiSignal(flow)) {
          flow.end = flow.end || e;
          flows.push(flow);
        }
        flow = {
          start: e,
          end: null,
          scan: false,
          select: false,
          page65: false,
          page66: false,
          connect: false,
          page67: false,
        };
        continue;
      }

      if (!flow) continue;

      if ((e.lineNo - flow.start.lineNo) > 140) {
        if (hasWifiSignal(flow)) {
          flow.end = flow.end || e;
          flows.push(flow);
        }
        flow = null;
        continue;
      }

      if (e.type === "rkc") {
        if (e.keyCode === "4444") flow.scan = true;
        if (e.keyCode === "4111") flow.select = true;
        if (e.keyCode === "AAA4") flow.connect = true;
      } else if (e.type === "page") {
        if (e.page === 65) flow.page65 = true;
        if (e.page === 66) flow.page66 = true;
        if (e.page === 67) {
          flow.page67 = true;
          flow.end = e;
          if (hasWifiSignal(flow)) flows.push(flow);
          flow = null;
          continue;
        }
      }
    }

    if (flow && hasWifiSignal(flow)) {
      flow.end = flow.end || flow.start;
      flows.push(flow);
    }

    return flows;
  }

  function detectRunCycles(entries) {
    const cycles = [];
    for (let i = 0; i < entries.length; i += 1) {
      const e = entries[i];
      if (e.type !== "rkc" || e.keyCode !== "8014") continue;

      const cycle = {
        start: e,
        end: e,
        saw57: false,
        saw8058: false,
        saw62: false,
      };

      for (let j = i + 1; j < entries.length && j < (i + 90); j += 1) {
        const n = entries[j];
        if (n.type === "rkc" && n.keyCode === "8014") break;
        if (n.type === "page" && n.page === 57) cycle.saw57 = true;
        if (n.type === "rkc" && n.keyCode === "8058") cycle.saw8058 = true;
        if (n.type === "page" && n.page === 62) {
          cycle.saw62 = true;
          cycle.end = n;
          if (cycle.saw8058) break;
        }
      }

      if (cycle.saw57 || cycle.saw8058 || cycle.saw62) {
        cycles.push(cycle);
      }
    }
    return cycles;
  }

  function renderSdAnalysis(text) {
    if (!analysisSummary || !analysisTimeline) return;

    const entries = parseSdLogText(text);
    if (!entries.length) {
      setAnalysisMessage("분석할 로그가 없습니다.");
      return;
    }

    const pageEvents = entries.filter((e) => e.type === "page");
    const keyEvents = entries.filter((e) => e.type === "rkc");
    const unsynced = entries.filter((e) => e.unsyncSec !== null);
    const firstSynced = entries.find((e) => e.synced);
    const flow = pageFlow(entries);
    const keyTop = topKeyCounts(entries, 10);
    const wifiFlows = detectWifiFlows(entries);
    const runCycles = detectRunCycles(entries);
    const first = entries[0];
    const last = entries[entries.length - 1];

    const flowForUi = flow.length > 18 ? flow.slice(0, 18).concat(["..."]) : flow;
    const flowText = flowForUi.map((p) => (typeof p === "number" ? pageLabel(p) : "...")).join(" → ");

    const keyPills = keyTop.length
      ? keyTop.map(([code, cnt]) => {
          const label = keyLabel(code);
          const detail = label !== "-" ? ` · ${esc(label)}` : "";
          return `<span class="analysis-pill">0x${esc(code)} × ${cnt}${detail}</span>`;
        }).join("")
      : '<span class="analysis-empty">RKC 키 이벤트 없음</span>';

    const summaryHtml = `
      <div class="mb-2"><strong>라인 수</strong>: ${entries.length}줄</div>
      <div class="mb-2"><strong>시간 범위</strong>: ${esc(tsLabel(first))} → ${esc(tsLabel(last))}</div>
      <div class="mb-2"><strong>페이지 이벤트</strong>: ${pageEvents.length}회 / <strong>RKC 이벤트</strong>: ${keyEvents.length}회</div>
      <div class="mb-2"><strong>UNSYNC 구간</strong>: ${unsynced.length}줄${firstSynced ? ` (동기화 시작: ${esc(tsLabel(firstSynced))})` : ""}</div>
      <div class="mb-2"><strong>Wi-Fi 설정 흐름</strong>: ${wifiFlows.length}회 / <strong>동작 사이클</strong>: ${runCycles.length}회</div>
      <div class="mb-2"><strong>페이지 흐름</strong>: ${flowText ? esc(flowText) : "-"}</div>
      <div><strong>자주 눌린 키</strong><br>${keyPills}</div>
    `;

    const timeline = [];
    if (unsynced.length > 0) {
      if (firstSynced) {
        timeline.push(`초기 ${unsynced.length}줄은 RTC 미동기화(UNSYNC) 상태이며, ${tsLabel(firstSynced)}부터 절대 시각으로 기록됩니다.`);
      } else {
        timeline.push(`현재 파일은 전부 UNSYNC 기준으로만 기록되어 있어 시간 동기화 이전 로그입니다.`);
      }
    }

    if (wifiFlows.length > 0) {
      wifiFlows.forEach((f, idx) => {
        const steps = [];
        if (f.scan) steps.push("스캔(0x4444)");
        if (f.select || f.page65) steps.push("SSID 선택(0x4111 / page65)");
        if (f.page66) steps.push("연결 준비(page66)");
        if (f.connect) steps.push("연결 요청(0xAAA4)");
        if (f.page67) steps.push("연결 진행(page67)");
        timeline.push(`Wi-Fi 설정 #${idx + 1} [${tsLabel(f.start)} → ${tsLabel(f.end || f.start)}]: ${steps.join(" → ") || "세부 단계 없음"}`);
      });
    }

    if (runCycles.length > 0) {
      runCycles.forEach((c, idx) => {
        const steps = [];
        steps.push("0x8014");
        if (c.saw57) steps.push("page57");
        if (c.saw8058) steps.push("0x8058");
        if (c.saw62) steps.push("page62");
        timeline.push(`동작 사이클 #${idx + 1} [${tsLabel(c.start)} → ${tsLabel(c.end)}]: ${steps.join(" → ")}`);
      });
    }

    if (!timeline.length) {
      timeline.push("규칙 기반으로 인식된 패턴이 없습니다. 원문 로그를 확인해 주세요.");
    }

    const timelineHtml = `<ol class="analysis-list">${timeline.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>`;
    setAnalysis(summaryHtml, timelineHtml);
  }

  function parseEnergyLogText(text) {
    const raw = String(text || "");
    const lines = raw.split(/\r?\n/);
    const out = {
      lines: [],
      sessions: [],
      dailyTotals: [],
      deviceTotals: [],
      misc: [],
    };

    for (let i = 0; i < lines.length; i += 1) {
      const row = String(lines[i] || "").trim();
      if (!row) continue;

      const sessionM = row.match(/^\[SESSION\]\s+DATE=(\d{4}-\d{2}-\d{2})\s+START=(\d{2}:\d{2}:\d{2})\s+END=(\d{2}:\d{2}:\d{2})\s+ENERGY=(\d+)\s+J$/i);
      if (sessionM) {
        const entry = {
          lineNo: i + 1,
          raw: row,
          date: sessionM[1],
          start: sessionM[2],
          end: sessionM[3],
          energyJ: Number(sessionM[4]),
        };
        out.sessions.push(entry);
        out.lines.push({ type: "session", ...entry });
        continue;
      }

      const dailyM = row.match(/^\[DAILY_TOTAL\]\s+DATE=(\d{4}-\d{2}-\d{2})\s+TOTAL=(\d+)\s+J$/i);
      if (dailyM) {
        const entry = {
          lineNo: i + 1,
          raw: row,
          date: dailyM[1],
          totalJ: Number(dailyM[2]),
        };
        out.dailyTotals.push(entry);
        out.lines.push({ type: "daily", ...entry });
        continue;
      }

      const deviceM = row.match(/^\[DEVICE_TOTAL\]\s+(\d+)\s+J$/i);
      if (deviceM) {
        const entry = {
          lineNo: i + 1,
          raw: row,
          totalJ: Number(deviceM[1]),
        };
        out.deviceTotals.push(entry);
        out.lines.push({ type: "device_total", ...entry });
        continue;
      }

      out.misc.push({ lineNo: i + 1, raw: row });
      out.lines.push({ type: "misc", lineNo: i + 1, raw: row });
    }

    return out;
  }

  function finalDailyEnergyRows(entries) {
    const order = [];
    const lastByDate = new Map();
    for (const e of entries) {
      if (!lastByDate.has(e.date)) order.push(e.date);
      lastByDate.set(e.date, e);
    }
    return order.map((date) => lastByDate.get(date)).filter(Boolean);
  }

  function renderEnergyAnalysis(text) {
    if (!analysisSummary || !analysisTimeline) return;

    const parsed = parseEnergyLogText(text);
    if (!parsed.lines.length) {
      setAnalysisMessage("분석할 에너지 로그가 없습니다.");
      return;
    }

    const finalDaily = finalDailyEnergyRows(parsed.dailyTotals);
    const latestDevice = parsed.deviceTotals.length ? parsed.deviceTotals[parsed.deviceTotals.length - 1].totalJ : 0;
    const latestDaily = finalDaily.length ? finalDaily[finalDaily.length - 1] : null;
    const totalDailySum = finalDaily.reduce((sum, item) => sum + item.totalJ, 0);
    const avgDaily = finalDaily.length ? Math.round(totalDailySum / finalDaily.length) : 0;
    const maxDaily = finalDaily.reduce((max, item) => (max && max.totalJ >= item.totalJ ? max : item), null);
    const minDaily = finalDaily.reduce((min, item) => (min && min.totalJ <= item.totalJ ? min : item), null);
    const dailyOverwriteCount = Math.max(parsed.dailyTotals.length - finalDaily.length, 0);
    const deviceOverwriteCount = Math.max(parsed.deviceTotals.length - (parsed.deviceTotals.length ? 1 : 0), 0);
    const firstDate = finalDaily.length ? finalDaily[0].date : "-";
    const lastDate = finalDaily.length ? finalDaily[finalDaily.length - 1].date : "-";

    const summaryHtml = `
      <div class="mb-2"><strong>라인 수</strong>: ${parsed.lines.length}줄</div>
      <div class="mb-2"><strong>세션 기록</strong>: ${parsed.sessions.length}개 / <strong>일별 합계</strong>: ${finalDaily.length}일</div>
      <div class="mb-2"><strong>기록 기간</strong>: ${esc(firstDate)} → ${esc(lastDate)}</div>
      <div class="mb-2"><strong>최신 누적 사용량</strong>: ${formatEnergyJ(latestDevice)}</div>
      <div class="mb-2"><strong>최근 일일 합계</strong>: ${latestDaily ? `${esc(latestDaily.date)} · ${formatEnergyJ(latestDaily.totalJ)}` : "-"}</div>
      <div class="mb-2"><strong>일평균</strong>: ${formatEnergyJ(avgDaily)}</div>
      <div class="mb-2"><strong>최대 사용일</strong>: ${maxDaily ? `${esc(maxDaily.date)} · ${formatEnergyJ(maxDaily.totalJ)}` : "-"}</div>
      <div><strong>최소 사용일</strong>: ${minDaily ? `${esc(minDaily.date)} · ${formatEnergyJ(minDaily.totalJ)}` : "-"}</div>
    `;

    const timeline = [];
    if (parsed.sessions.length) {
      const recentSessions = parsed.sessions.slice(-5);
      recentSessions.forEach((entry, idx) => {
        timeline.push(`세션 #${parsed.sessions.length - recentSessions.length + idx + 1}: ${entry.date} ${entry.start}~${entry.end} · ${formatEnergyJ(entry.energyJ)}`);
      });
    } else {
      timeline.push("현재 파일에는 [SESSION] 라인이 없습니다. 압축 정리된 상태이거나 세션 기록이 없는 에너지 로그입니다.");
    }

    if (finalDaily.length) {
      const recentDaily = finalDaily.slice(-5);
      const dailyText = recentDaily.map((entry) => `${entry.date} · ${formatEnergyJ(entry.totalJ)}`).join(" / ");
      timeline.push(`최근 일별 합계: ${dailyText}`);
    }

    if (dailyOverwriteCount > 0) {
      timeline.push(`같은 날짜의 중간 DAILY_TOTAL 스냅샷 ${dailyOverwriteCount}개가 있었고, 분석은 날짜별 최종값 기준으로 계산했습니다.`);
    }
    if (deviceOverwriteCount > 0) {
      timeline.push(`DEVICE_TOTAL 갱신 기록 ${parsed.deviceTotals.length}개 중 마지막 1개(${formatEnergyJ(latestDevice)})를 현재 누적값으로 사용했습니다.`);
    }
    if (!timeline.length) {
      timeline.push("규칙 기반으로 인식된 에너지 패턴이 없습니다. 원문 로그를 확인해 주세요.");
    }

    const timelineHtml = `<ol class="analysis-list">${timeline.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>`;
    setAnalysis(summaryHtml, timelineHtml);
  }

  async function loadActiveLog() {
    if (!activeDevice) return;

    const spec = activeLogSpec();
    const params = buildDeviceParams(activeDevice);
    params.set("kind", activeLogTab);
    const query = params.toString();
    const downloadUrl = `/api/device/sd-log/download?${query}`;

    if (btnDownload) {
      btnDownload.setAttribute("href", downloadUrl);
      btnDownload.classList.remove("disabled");
    }

    if (modalTitle) {
      modalTitle.textContent = `${activeDevice.name || "디바이스"} ${spec.label}`;
    }
    if (modalMeta) {
      modalMeta.textContent = `${activeDevice.name || "-"} (${activeDevice.deviceId || "-"}) · IP ${activeDevice.ip || "-"} · ${spec.path}`;
    }
    setLogViewer("파일을 불러오는 중...");
    remoteDeleteSupported = false;
    syncDeleteButtons();
    if (spec.analyzable) {
      setAnalysisMessage(spec.loadingMessage || "로그를 분석 중입니다...");
    }

    const resp = await fetchJSON(`/api/device/sd-log?${query}`, { cache: "no-store" });
    if (!resp) {
      setLogViewer("파일 조회 실패: 응답 없음");
      if (spec.analyzable) setAnalysisMessage("로그 분석 실패: 응답 없음");
      return;
    }

    if (Object.prototype.hasOwnProperty.call(resp, "status")) {
      const detail = (resp.data && resp.data.detail) ? String(resp.data.detail) : `HTTP ${resp.status}`;
      setLogViewer(`파일 조회 실패: ${detail}`);
      remoteDeleteSupported = false;
      syncDeleteButtons();
      if (spec.analyzable) setAnalysisMessage(`로그 분석 실패: ${detail}`);
      return;
    }

    if (resp.ok !== true) {
      setLogViewer(`파일 조회 실패: ${resp.reason || "알 수 없는 오류"}`);
      remoteDeleteSupported = false;
      syncDeleteButtons();
      if (spec.analyzable) setAnalysisMessage(`로그 분석 실패: ${resp.reason || "알 수 없는 오류"}`);
      return;
    }

    remoteDeleteSupported = resp.remote_delete_supported === true;
    syncDeleteButtons();

    const text = String(resp.text || "");
    setLogViewer(text || "(파일이 비어 있습니다)");
    if (spec.analyzable) {
      if (activeLogTab === "energy") renderEnergyAnalysis(text);
      else renderSdAnalysis(text);
    }

    if (modalMeta) {
      const sizeBytes = toNum(resp.size_bytes, 0);
      modalMeta.textContent = `${activeDevice.name || "-"} (${activeDevice.deviceId || "-"}) · IP ${activeDevice.ip || "-"} · ${resp.filename || spec.filename} · ${sizeBytes} bytes · ${logSourceLabel(resp.source)}`;
    }
  }

  async function deleteLog(tabKey) {
    if (!activeDevice || deleteBusy) return;
    if (!remoteDeleteSupported) {
      window.alert("현재 로그는 서버 저장본 기준으로 조회되고 있어 원격 SD 삭제를 지원하지 않습니다.");
      return;
    }

    const deleteTab = Object.prototype.hasOwnProperty.call(LOG_TABS, tabKey) ? tabKey : activeLogTab;
    const spec = LOG_TABS[deleteTab] || LOG_TABS.activity;
    const actionText = deleteTab === "energy" ? "압축 정리" : "삭제";
    const confirmed = window.confirm(
      `${spec.label}(${spec.filename})를 ${actionText}합니다.\n` +
      `삭제 전 Trashcan에 ${LOG_TABS.activity.filename}, ${LOG_TABS.energy.filename} 백업을 저장합니다.\n` +
      `계속하시겠습니까?`
    );
    if (!confirmed) return;

    deleteBusy = true;
    if (btnDeleteActivity) btnDeleteActivity.disabled = true;
    if (btnDeleteEnergy) btnDeleteEnergy.disabled = true;
    if (deleteTab === activeLogTab) {
      setLogViewer(deleteTab === "energy" ? "백업 후 에너지 로그를 압축 정리하는 중..." : "백업 후 파일을 삭제하는 중...");
      setAnalysisMessage("삭제 작업 중입니다.");
    }

    const resp = await fetchJSON("/api/device/sd-log/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: activeDevice.deviceId || "",
        device_name: activeDevice.name || "",
        ip: activeDevice.ip || "",
        customer: activeDevice.customer || "-",
        token: activeDevice.token || "",
        kind: deleteTab,
      }),
    });

    deleteBusy = false;
    if (btnDeleteActivity) btnDeleteActivity.disabled = false;
    if (btnDeleteEnergy) btnDeleteEnergy.disabled = false;

    if (!resp) {
      window.alert("로그파일 삭제 실패: 응답 없음");
      if (deleteTab === activeLogTab) await loadActiveLog();
      return;
    }

    if (Object.prototype.hasOwnProperty.call(resp, "status")) {
      const detail = (resp.data && resp.data.detail) ? String(resp.data.detail) : `HTTP ${resp.status}`;
      window.alert(`로그파일 삭제 실패: ${detail}`);
      if (deleteTab === activeLogTab) await loadActiveLog();
      return;
    }

    if (resp.ok !== true) {
      const detail = String(resp.reason || "알 수 없는 오류");
      const backupDir = resp.backup_dir ? `\n백업 위치: ${resp.backup_dir}` : "";
      window.alert(`로그파일 삭제 실패: ${detail}${backupDir}`);
      if (deleteTab === activeLogTab) await loadActiveLog();
      return;
    }

    const backedUpFiles = Array.isArray(resp.backed_up_files) && resp.backed_up_files.length
      ? resp.backed_up_files.join(", ")
      : "-";
    const missingText = Array.isArray(resp.backup_missing) && resp.backup_missing.length
      ? `\n미백업: ${resp.backup_missing.map((item) => `${item.filename}(${item.reason})`).join(", ")}`
      : "";
    const resultText = resp.action === "compacted" ? "압축 정리 완료" : "삭제 완료";
    window.alert(
      `${spec.label} ${resultText}\n` +
      `백업 위치: ${resp.backup_dir || "-"}\n` +
      `백업 파일: ${backedUpFiles}${missingText}`
    );
    if (deleteTab === activeLogTab) {
      await loadActiveLog();
    }
  }

  cardWrap.addEventListener("click", function (e) {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const btn = target.closest(".btnOpenLogModal");
    if (!btn) return;

    activeDevice = {
      deviceId: btn.getAttribute("data-device-id") || "",
      name: btn.getAttribute("data-device-name") || "",
      ip: btn.getAttribute("data-ip") || "",
      customer: btn.getAttribute("data-customer") || "-",
      token: btn.getAttribute("data-token") || "",
    };

    setLogTab("activity");
    modal.show();
    loadActiveLog();
  });

  if (btnReload) {
    btnReload.addEventListener("click", function () {
      loadActiveLog();
    });
  }

  if (btnDeleteActivity) {
    btnDeleteActivity.addEventListener("click", function () {
      deleteLog("activity");
    });
  }

  if (btnDeleteEnergy) {
    btnDeleteEnergy.addEventListener("click", function () {
      deleteLog("energy");
    });
  }

  if (btnTabActivity) {
    btnTabActivity.addEventListener("click", function () {
      if (activeLogTab === "activity") return;
      setLogTab("activity");
      if (activeDevice) loadActiveLog();
    });
  }

  if (btnTabEnergy) {
    btnTabEnergy.addEventListener("click", function () {
      if (activeLogTab === "energy") return;
      setLogTab("energy");
      if (activeDevice) loadActiveLog();
    });
  }

  async function refreshCards() {
    const resp = await fetchJSON("/api/device-status", { cache: "no-store" });
    if (!resp || resp.ok === false) return;
    renderCards(resp.devices || []);
  }

  setLogTab("activity");
  refreshCards();
  setInterval(refreshCards, 4000);
})();
