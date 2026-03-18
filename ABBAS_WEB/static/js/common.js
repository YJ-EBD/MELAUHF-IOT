// 공통 JS (UI/UX 확장용) — 기존 기능 유지 + 점진적 개선
(function () {
  const $id = (id) => document.getElementById(id);

  function setTheme(theme) {
    const t = (theme === "dark") ? "dark" : "light";
    document.documentElement.setAttribute("data-bs-theme", t);
    document.documentElement.style.colorScheme = t;
    try { localStorage.setItem("appTheme", t); } catch (_) {}

    const btn = $id("themeToggle");
    if (btn) {
      const icon = btn.querySelector("i");
      if (icon) {
        icon.className = (t === "dark") ? "bi bi-sun" : "bi bi-moon-stars";
      }
    }
  }

  function initTheme() {
    let saved = "";
    try { saved = localStorage.getItem("appTheme") || ""; } catch (_) {}
    if (saved === "dark" || saved === "light") {
      setTheme(saved);
      return;
    }
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(prefersDark ? "dark" : "light");
  }

  function setupThemeToggle() {
    const btn = $id("themeToggle");
    if (!btn) return;

    btn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-bs-theme") || "light";
      setTheme(cur === "dark" ? "light" : "dark");
    });
  }

  function setupRipple() {
    // 버튼 클릭 시 ripple (절제된 효과)
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      const btn = target.closest(".btn");
      if (!btn) return;
      if (btn.classList.contains("btn-link")) return;
      if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return;

      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.1;
      const x = (e.clientX - rect.left) - (size / 2);
      const y = (e.clientY - rect.top) - (size / 2);

      const ripple = document.createElement("span");
      ripple.className = "ripple";
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;

      btn.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 560);
    }, { passive: true });
  }

  function setupClock() {
    const el = $id("clockNow");
    if (!el) return;

    const pad = (n) => String(n).padStart(2, "0");
    const tick = () => {
      const d = new Date();
      el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    tick();
    window.setInterval(tick, 1000);
  }

  function setApiPill(state, text) {
    const dot = $id("apiConnDot");
    const txt = $id("apiConnText");
    if (txt) txt.textContent = text || "";

    if (dot) {
      dot.classList.remove("led--online", "led--offline", "led--error", "led--pending");
      if (state === "online") dot.classList.add("led--online");
      else if (state === "error") dot.classList.add("led--error");
      else if (state === "offline") dot.classList.add("led--offline");
      else dot.classList.add("led--pending");
    }
  }

  async function checkApi() {
    // 가장 안정적으로 존재하는 엔드포인트로 "서버 응답성"만 체크
    setApiPill("pending", "API 확인 중");
    try {
      const res = await fetch("/api/devices/saved", { cache: "no-store" });
      if (res.status === 401) {
        // 로그인 페이지에서는 리다이렉트 루프 방지
        const p = (location.pathname || "");
        if (!(p.startsWith("/login") || p.startsWith("/signup"))) {
          const next = encodeURIComponent(location.pathname + location.search);
          location.href = `/login?next=${next}`;
          return;
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setApiPill("online", "API 연결됨");
    } catch (e) {
      setApiPill("error", "API 연결 실패");
    }
  }

  function setupApiHealth() {
    if (!$id("apiConnDot") && !$id("apiConnText")) return;
    checkApi();
    window.setInterval(checkApi, 15000);
  }

  function setupToast() {
    const btnSave = $id("btnSaveSettings");
    const toastEl = $id("saveToast");
    if (btnSave && toastEl && window.bootstrap) {
      const toast = new bootstrap.Toast(toastEl, { delay: 1800 });
      btnSave.addEventListener("click", () => toast.show());
    }
  }

  function setupGlobalLoading() {
    const overlay = $id("appLoadingOverlay");

    function showLoading(label) {
      if (!overlay) return;
      const msg = overlay.querySelector(".small");
      if (msg && label) msg.textContent = label;
      overlay.classList.remove("d-none");
    }
    function hideLoading() {
      if (!overlay) return;
      overlay.classList.add("d-none");
    }

    // 페이지 JS에서 선택적으로 사용 가능
    window.AppUI = window.AppUI || {};
    window.AppUI.showLoading = showLoading;
    window.AppUI.hideLoading = hideLoading;
  }



  function setupModalLayerFix() {
    // Fix: When modal markup lives inside an element with transform/animation,
    // Bootstrap backdrop (appended to <body>) can end up above the modal.
    // Strategy:
    //  1) Always move .modal to <body> on open
    //  2) Re-apply sane z-index ordering (supports stacked modals)
    if (!window.bootstrap) return;

    const getBaseZ = () => {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--bs-modal-zindex').trim();
        const n = parseInt(v || '1800', 10);
        return Number.isFinite(n) ? n : 1800;
      } catch (_) {
        return 1800;
      }
    };

    document.addEventListener('show.bs.modal', (ev) => {
      const modal = ev.target;
      if (!(modal instanceof HTMLElement)) return;
      if (!modal.classList.contains('modal')) return;

      // Move to body to avoid stacking-context traps
      if (modal.parentElement && modal.parentElement !== document.body) {
        document.body.appendChild(modal);
      }

      // Make sure it can receive pointer events
      modal.style.pointerEvents = 'auto';
    });

    document.addEventListener('shown.bs.modal', (ev) => {
      const modal = ev.target;
      if (!(modal instanceof HTMLElement)) return;
      if (!modal.classList.contains('modal')) return;

      const base = getBaseZ();
      const openModals = Array.from(document.querySelectorAll('.modal.show'));
      const idx = Math.max(0, openModals.length - 1);
      const modalZ = base + (idx * 10);
      const backdropZ = modalZ - 5;

      modal.style.zIndex = String(modalZ);

      // Backdrop is appended at the end; adjust the last one
      const backdrops = document.querySelectorAll('.modal-backdrop');
      const lastBackdrop = backdrops.length ? backdrops[backdrops.length - 1] : null;
      if (lastBackdrop && lastBackdrop instanceof HTMLElement) {
        lastBackdrop.style.zIndex = String(backdropZ);
      }
    });

    document.addEventListener('hidden.bs.modal', (ev) => {
      const modal = ev.target;
      if (!(modal instanceof HTMLElement)) return;
      if (!modal.classList.contains('modal')) return;
      modal.style.zIndex = '';
      modal.style.pointerEvents = '';
    });
  }
  // DOMReady
  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    setupThemeToggle();
    setupRipple();
    setupClock();
    setupApiHealth();
    setupToast();
    setupGlobalLoading();
    setupModalLayerFix();
  });
})();
