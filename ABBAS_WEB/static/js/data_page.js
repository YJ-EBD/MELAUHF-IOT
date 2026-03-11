// for_rnd_web 데이터 페이지 (DB 기반)
// 요구사항:
// 1) 조회 결과 중복 제거: 커서 기반 페이지네이션 + __id 기반 클라이언트 중복 방지
// 2) 더 불러오기 버튼 정상 동작
// 3) 가로 잘림: CSS(admin.css)에서 .table-responsive overflow auto + nowrap
// 4) 컬럼 타이틀 한글 표시

(function () {
  const modalEl = document.getElementById("deviceDataModal");
  if (!modalEl) return;

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  const modalTitle = document.getElementById("modalDeviceTitle");
  const modalMeta = document.getElementById("modalDeviceMeta");

  // Procedure UI
  const procFilter = document.getElementById("procFilter");
  const procReload = document.getElementById("procReload");
  const procLoadMore = document.getElementById("procLoadMore");
  const procTheadRow = document.getElementById("procTheadRow");
  const procTbody = document.getElementById("procTbody");

  // Survey UI
  const surveyFilter = document.getElementById("surveyFilter");
  const surveyReload = document.getElementById("surveyReload");
  const surveyLoadMore = document.getElementById("surveyLoadMore");
  const surveyTheadRow = document.getElementById("surveyTheadRow");
  const surveyTbody = document.getElementById("surveyTbody");

  // Bootstrap tab buttons
  const tabProcBtn = document.getElementById("tabProc");
  const tabSurveyBtn = document.getElementById("tabSurvey");

  const COL_TITLES_KO = {
    "__file": "파일명",
    "saved_at_kst": "저장일시(KST)",
    "customer_name": "고객명",
    "gender": "성별",
    "phone": "연락처",
    "complaint_face": "얼굴 고민",
    "complaint_body": "바디 고민",
    "treatment_area": "시술 부위",
    "treatment_time_min": "시술 시간",
    "treatment_power_w": "시술 파워(W)",
    "post_effect": "사후 효과",
    "satisfaction": "만족도",
  };
  const HIDDEN_COLS = new Set(["__id"]);

  const state = {
    deviceId: "",
    deviceName: "",
    limit: 200,
    procedure: {
      cursor: null,
      hasMore: false,
      loading: false,
      cols: [],
      seen: new Set(),
      q: "",
    },
    survey: {
      cursor: null,
      hasMore: false,
      loading: false,
      cols: [],
      seen: new Set(),
      q: "",
    },
  };

  function kindState(kind) {
    return kind === "procedure" ? state.procedure : state.survey;
  }

  function elsForKind(kind) {
    if (kind === "procedure") {
      return {
        filter: procFilter,
        reload: procReload,
        loadMore: procLoadMore,
        theadRow: procTheadRow,
        tbody: procTbody,
      };
    }
    return {
      filter: surveyFilter,
      reload: surveyReload,
      loadMore: surveyLoadMore,
      theadRow: surveyTheadRow,
      tbody: surveyTbody,
    };
  }

  function setLoading(kind, loading) {
    const ks = kindState(kind);
    const els = elsForKind(kind);
    ks.loading = loading;
    els.reload.disabled = loading;
    els.loadMore.disabled = loading || !ks.hasMore;
  }

  function resetKind(kind) {
    const ks = kindState(kind);
    const els = elsForKind(kind);
    ks.cursor = null;
    ks.hasMore = false;
    ks.cols = [];
    ks.seen = new Set();
    els.theadRow.innerHTML = "";
    els.tbody.innerHTML = "";
    els.loadMore.disabled = true;
  }

  function inferColumns(rows) {
    if (!rows || rows.length === 0) return [];
    const keys = Object.keys(rows[0] || {});
    const cols = [];
    if (keys.includes("__file")) cols.push("__file");
    for (const k of keys) {
      if (k === "__file") continue;
      if (HIDDEN_COLS.has(k)) continue;
      cols.push(k);
    }
    return cols;
  }

  function renderHeader(kind, cols) {
    const { theadRow } = elsForKind(kind);
    theadRow.innerHTML = "";
    for (const c of cols) {
      const th = document.createElement("th");
      th.textContent = COL_TITLES_KO[c] || c;
      theadRow.appendChild(th);
    }
  }

  function renderRows(kind, rows) {
    if (!rows || rows.length === 0) return;
    const ks = kindState(kind);
    const { tbody } = elsForKind(kind);

    if (ks.cols.length === 0) {
      ks.cols = inferColumns(rows);
      renderHeader(kind, ks.cols);
    }

    for (const r of rows) {
      const rid = r.__id;
      if (rid != null) {
        if (ks.seen.has(rid)) continue;
        ks.seen.add(rid);
      }

      const tr = document.createElement("tr");
      for (const c of ks.cols) {
        const td = document.createElement("td");
        td.textContent = (r[c] == null) ? "" : String(r[c]);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  async function fetchRows(kind, append) {
    const ks = kindState(kind);
    const q = (ks.q || "").trim();

    const params = new URLSearchParams();
    params.set("device_id", state.deviceId);
    params.set("limit", String(state.limit));
    if (q) params.set("q", q);
    if (append && ks.cursor != null) params.set("cursor", String(ks.cursor));

    const url = kind === "procedure"
      ? `/api/data/procedure?${params.toString()}`
      : `/api/data/survey?${params.toString()}`;

    const resp = await fetch(url, { credentials: "same-origin" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }

  async function load(kind, append) {
    if (!state.deviceId) return;
    const ks = kindState(kind);
    if (ks.loading) return;

    setLoading(kind, true);
    try {
      if (!append) {
        resetKind(kind);
      }

      const data = await fetchRows(kind, append);
      const rows = data.rows || [];
      renderRows(kind, rows);

      ks.cursor = (data.next_cursor == null) ? null : data.next_cursor;
      ks.hasMore = Boolean(data.has_more);
      elsForKind(kind).loadMore.disabled = !ks.hasMore;

      // 상태 표시
      const total = ks.seen.size;
      const label = kind === "procedure" ? "시술" : "설문";
      if (modalMeta) {
        modalMeta.textContent = `${state.deviceName} (${state.deviceId}) · ${label} ${total}건${ks.hasMore ? " (더 불러오기 가능)" : ""}`;
      }
    } catch (e) {
      console.error(e);
      if (modalMeta) {
        modalMeta.textContent = "조회 실패: 서버/DB 상태를 확인하세요.";
      }
    } finally {
      setLoading(kind, false);
    }
  }

  // open buttons on card list
  document.querySelectorAll(".btnOpenDataModal").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.deviceId = btn.dataset.deviceId || "";
      state.deviceName = btn.dataset.deviceName || "";

      if (modalTitle) {
        modalTitle.textContent = `${state.deviceName || "디바이스"} 데이터`;
      }

      // reset both tabs
      resetKind("procedure");
      resetKind("survey");

      // sync filters
      state.procedure.q = (procFilter?.value || "").trim();
      state.survey.q = (surveyFilter?.value || "").trim();

      // always start at procedure tab
      if (tabProcBtn) {
        const tab = new bootstrap.Tab(tabProcBtn);
        tab.show();
      }

      modal.show();
      await load("procedure", false);
    });
  });

  // Reload / Filter handlers
  procReload.addEventListener("click", () => {
    state.procedure.q = (procFilter.value || "").trim();
    load("procedure", false);
  });
  procFilter.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      state.procedure.q = (procFilter.value || "").trim();
      load("procedure", false);
    }
  });
  procLoadMore.addEventListener("click", () => load("procedure", true));

  surveyReload.addEventListener("click", () => {
    state.survey.q = (surveyFilter.value || "").trim();
    load("survey", false);
  });
  surveyFilter.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      state.survey.q = (surveyFilter.value || "").trim();
      load("survey", false);
    }
  });
  surveyLoadMore.addEventListener("click", () => load("survey", true));

  // When switching tabs, if not loaded yet, load.
  tabSurveyBtn?.addEventListener("shown.bs.tab", () => {
    // load only if empty
    if (state.survey.seen.size === 0) {
      state.survey.q = (surveyFilter.value || "").trim();
      load("survey", false);
    }
  });
})();
