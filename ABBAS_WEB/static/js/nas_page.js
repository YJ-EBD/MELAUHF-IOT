(function () {
  const root = document.getElementById("nasPageRoot");
  if (!root) return;

  const state = {
    currentPath: "/",
    items: [],
    drive: null,
    uploadFiles: [],
    uploadDirectories: [],
    uploadInFlight: false,
    pendingDownloadPaths: [],
    pendingTrashPaths: [],
    pendingTrashItems: [],
    parentPath: null,
    truncated: false,
    selectedPaths: [],
    selectedPath: "",
    selectedType: "",
    contextPaths: [],
    contextPath: "",
    contextType: "",
    trashItems: [],
    dropTargetDepth: 0,
    dragSelectActive: false,
    dragSelectStarted: false,
    dragSelectStartLocalY: 0,
    dragSelectCurrentClientY: 0,
    dragAutoScroll: 0,
    dragAutoScrollRaf: 0,
    dragSelectBasePaths: [],
    dragSelectToggleMode: false,
    suppressRowClick: false,
    nameEditorMode: "create",
    nameEditorTargetPath: "",
    nameEditorTargetType: "",
    explorerKeyboardActive: false,
    dragMovePaths: [],
    dragMoveTargetPath: "",
    dragMoveCrumbPath: "",
    dragMoveCrumbButton: null,
    markEditorPaths: [],
    markEditorColor: "yellow",
    mobileTapPath: "",
    mobileTapType: "",
    mobileTapAt: 0,
  };

  const el = {
    browserShell: root.querySelector(".nas-browser-shell"),
    sideCard: root.querySelector(".nas-side-card"),
    alert: document.getElementById("nasAlert"),
    contextMenu: document.getElementById("nasContextMenu"),
    refreshBtn: document.getElementById("nasRefreshBtn"),
    quickUploadBtn: document.getElementById("nasQuickUploadBtn"),
    explorerRefreshBtn: document.getElementById("nasExplorerRefreshBtn"),
    explorerQuickUploadBtn: document.getElementById("nasExplorerQuickUploadBtn"),
    rootBtn: document.getElementById("nasRootBtn"),
    trashBtn: document.getElementById("nasTrashBtn"),
    newFolderBtn: document.getElementById("nasNewFolderBtn"),
    upBtn: document.getElementById("nasUpBtn"),
    searchInput: document.getElementById("nasSearchInput"),
    breadcrumbs: document.getElementById("nasBreadcrumbs"),
    paneLocation: document.getElementById("nasPaneLocation"),
    paneRootBtn: document.getElementById("nasPaneRootBtn"),
    paneCurrentBtn: document.getElementById("nasPaneCurrentBtn"),
    paneCurrentLabel: document.getElementById("nasPaneCurrentLabel"),
    paneUpBtn: document.getElementById("nasPaneUpBtn"),
    paneTrashShortcutBtn: document.getElementById("nasPaneTrashShortcutBtn"),
    paneStatusMirror: document.getElementById("nasPaneStatusMirror"),
    currentPath: document.getElementById("nasCurrentPath"),
    countsText: document.getElementById("nasCountsText"),
    updatedAt: document.getElementById("nasUpdatedAt"),
    tableBody: document.getElementById("nasTableBody"),
    explorerDropTarget: document.getElementById("nasExplorerDropTarget"),
    emptyState: document.getElementById("nasEmptyState"),
    heroLabel: document.getElementById("nasHeroLabel"),
    heroCapacity: document.getElementById("nasHeroCapacity"),
    heroItemCount: document.getElementById("nasHeroItemCount"),
    driveStatus: document.getElementById("nasDriveStatus"),
    driveLabel: document.getElementById("nasDriveLabel"),
    mountPath: document.getElementById("nasMountPath"),
    diskDevice: document.getElementById("nasDiskDevice"),
    transport: document.getElementById("nasTransport"),
    serial: document.getElementById("nasSerial"),
    usageText: document.getElementById("nasUsageText"),
    usageBar: document.getElementById("nasUsageBar"),
    usedText: document.getElementById("nasUsedText"),
    freeText: document.getElementById("nasFreeText"),
    totalText: document.getElementById("nasTotalText"),
    uploadInput: document.getElementById("nasUploadInput"),
    dropzone: document.getElementById("nasDropzone"),
    uploadTarget: document.getElementById("nasUploadTarget"),
    uploadQueue: document.getElementById("nasUploadQueue"),
    uploadBtn: document.getElementById("nasUploadBtn"),
    uploadProgressModal: document.getElementById("nasUploadProgressModal"),
    uploadProgressTitle: document.getElementById("nasUploadProgressTitle"),
    uploadProgressMeta: document.getElementById("nasUploadProgressMeta"),
    uploadProgressStatus: document.getElementById("nasUploadProgressStatus"),
    uploadProgressPercent: document.getElementById("nasUploadProgressPercent"),
    uploadProgressBar: document.getElementById("nasUploadProgressBar"),
    uploadProgressBytes: document.getElementById("nasUploadProgressBytes"),
    newFolderModal: document.getElementById("nasNewFolderModal"),
    nameEditorTitle: document.getElementById("nasNameEditorTitle"),
    nameEditorPathLabel: document.getElementById("nasNameEditorPathLabel"),
    newFolderPath: document.getElementById("nasFolderCreatePath"),
    nameEditorInputLabel: document.getElementById("nasNameEditorInputLabel"),
    newFolderInput: document.getElementById("nasNewFolderInput"),
    nameEditorHint: document.getElementById("nasNameEditorHint"),
    createFolderConfirmBtn: document.getElementById("nasCreateFolderConfirmBtn"),
    nameEditorConfirmIcon: document.getElementById("nasNameEditorConfirmIcon"),
    nameEditorConfirmText: document.getElementById("nasNameEditorConfirmText"),
    markModal: document.getElementById("nasMarkModal"),
    markTargetLabel: document.getElementById("nasMarkTargetLabel"),
    markColorOptions: document.getElementById("nasMarkColorOptions"),
    markConfirmBtn: document.getElementById("nasMarkConfirmBtn"),
    duplicateConflictModal: document.getElementById("nasDuplicateConflictModal"),
    duplicateConflictTitle: document.getElementById("nasDuplicateConflictTitle"),
    duplicateConflictMessage: document.getElementById("nasDuplicateConflictMessage"),
    duplicateConflictPath: document.getElementById("nasDuplicateConflictPath"),
    duplicateConflictMeta: document.getElementById("nasDuplicateConflictMeta"),
    duplicateConflictHint: document.getElementById("nasDuplicateConflictHint"),
    duplicateApplyAllWrap: document.getElementById("nasDuplicateApplyAllWrap"),
    duplicateApplyAll: document.getElementById("nasDuplicateApplyAll"),
    duplicateSkipBtn: document.getElementById("nasDuplicateSkipBtn"),
    duplicateOverwriteBtn: document.getElementById("nasDuplicateOverwriteBtn"),
    duplicateCancelBtn: document.getElementById("nasDuplicateCancelBtn"),
    emptyFolderModal: document.getElementById("nasEmptyFolderModal"),
    emptyFolderMessage: document.getElementById("nasEmptyFolderMessage"),
    emptyFolderMeta: document.getElementById("nasEmptyFolderMeta"),
    downloadConfirmModal: document.getElementById("nasDownloadConfirmModal"),
    downloadConfirmMessage: document.getElementById("nasDownloadConfirmMessage"),
    downloadConfirmMeta: document.getElementById("nasDownloadConfirmMeta"),
    downloadConfirmBtn: document.getElementById("nasDownloadConfirmBtn"),
    trashConfirmModal: document.getElementById("nasTrashConfirmModal"),
    trashConfirmMessage: document.getElementById("nasTrashConfirmMessage"),
    trashConfirmMeta: document.getElementById("nasTrashConfirmMeta"),
    trashConfirmConfirmBtn: document.getElementById("nasTrashConfirmConfirmBtn"),
    trashModal: document.getElementById("nasTrashModal"),
    trashTbody: document.getElementById("nasTrashTbody"),
    trashEmptyState: document.getElementById("nasTrashEmptyState"),
    trashRefreshBtn: document.getElementById("nasTrashRefreshBtn"),
    trashEmptyBtn: document.getElementById("nasTrashEmptyBtn"),
    statusPath: document.getElementById("nasStatusPath"),
    selectionText: document.getElementById("nasSelectionText"),
  };

  const newFolderModal = (el.newFolderModal && window.bootstrap)
    ? bootstrap.Modal.getOrCreateInstance(el.newFolderModal)
    : null;
  const markModal = (el.markModal && window.bootstrap)
    ? bootstrap.Modal.getOrCreateInstance(el.markModal)
    : null;
  const duplicateConflictModal = (el.duplicateConflictModal && window.bootstrap)
    ? bootstrap.Modal.getOrCreateInstance(el.duplicateConflictModal, { backdrop: "static", keyboard: false })
    : null;
  const emptyFolderModal = (el.emptyFolderModal && window.bootstrap)
    ? bootstrap.Modal.getOrCreateInstance(el.emptyFolderModal)
    : null;
  const downloadConfirmModal = (el.downloadConfirmModal && window.bootstrap)
    ? bootstrap.Modal.getOrCreateInstance(el.downloadConfirmModal)
    : null;
  const trashConfirmModal = (el.trashConfirmModal && window.bootstrap)
    ? bootstrap.Modal.getOrCreateInstance(el.trashConfirmModal)
    : null;
  const trashModal = (el.trashModal && window.bootstrap)
    ? bootstrap.Modal.getOrCreateInstance(el.trashModal)
    : null;
  const uploadProgressModal = (el.uploadProgressModal && window.bootstrap)
    ? bootstrap.Modal.getOrCreateInstance(el.uploadProgressModal, { backdrop: "static", keyboard: false })
    : null;
  const desktopHeightQuery = window.matchMedia
    ? window.matchMedia("(min-width: 1200px)")
    : null;
  const mobileInteractionQuery = window.matchMedia
    ? window.matchMedia("(hover: none) and (pointer: coarse)")
    : null;
  let shellSyncFrame = 0;
  const INTERNAL_NAS_DRAG_TYPE = "application/x-abbas-nas-paths";
  const MOBILE_DOUBLE_TAP_WINDOW_MS = 360;
  const MARK_COLOR_OPTIONS = {
    red: {
      label: "레드",
      sub: "긴급/주의 항목",
      accent: "#dc2626",
      soft: "rgba(220, 38, 38, 0.18)",
      rowBg: "rgba(248, 113, 113, 0.16)",
      rowHover: "rgba(248, 113, 113, 0.22)",
      rowSelected: "rgba(248, 113, 113, 0.28)",
      rowBorder: "rgba(220, 38, 38, 0.32)",
    },
    orange: {
      label: "오렌지",
      sub: "처리 예정 항목",
      accent: "#ea580c",
      soft: "rgba(234, 88, 12, 0.18)",
      rowBg: "rgba(251, 146, 60, 0.16)",
      rowHover: "rgba(251, 146, 60, 0.22)",
      rowSelected: "rgba(251, 146, 60, 0.28)",
      rowBorder: "rgba(234, 88, 12, 0.3)",
    },
    yellow: {
      label: "옐로",
      sub: "기본 중요 표시",
      accent: "#ca8a04",
      soft: "rgba(202, 138, 4, 0.18)",
      rowBg: "rgba(250, 204, 21, 0.16)",
      rowHover: "rgba(250, 204, 21, 0.22)",
      rowSelected: "rgba(250, 204, 21, 0.28)",
      rowBorder: "rgba(202, 138, 4, 0.3)",
    },
    green: {
      label: "그린",
      sub: "완료/보관 항목",
      accent: "#16a34a",
      soft: "rgba(22, 163, 74, 0.18)",
      rowBg: "rgba(74, 222, 128, 0.16)",
      rowHover: "rgba(74, 222, 128, 0.22)",
      rowSelected: "rgba(74, 222, 128, 0.28)",
      rowBorder: "rgba(22, 163, 74, 0.3)",
    },
    blue: {
      label: "블루",
      sub: "참조/공유 항목",
      accent: "#2563eb",
      soft: "rgba(37, 99, 235, 0.18)",
      rowBg: "rgba(96, 165, 250, 0.16)",
      rowHover: "rgba(96, 165, 250, 0.22)",
      rowSelected: "rgba(96, 165, 250, 0.28)",
      rowBorder: "rgba(37, 99, 235, 0.3)",
    },
    purple: {
      label: "퍼플",
      sub: "개인 중요 항목",
      accent: "#7c3aed",
      soft: "rgba(124, 58, 237, 0.18)",
      rowBg: "rgba(167, 139, 250, 0.16)",
      rowHover: "rgba(167, 139, 250, 0.22)",
      rowSelected: "rgba(167, 139, 250, 0.28)",
      rowBorder: "rgba(124, 58, 237, 0.3)",
    },
  };
  let duplicateConflictPending = null;

  function syncBrowserShellHeight() {
    if (!el.browserShell) return;
    if (desktopHeightQuery && !desktopHeightQuery.matches) {
      el.browserShell.style.removeProperty("height");
      return;
    }
    if (!el.sideCard) {
      el.browserShell.style.removeProperty("height");
      return;
    }
    const nextHeight = Math.ceil(el.sideCard.getBoundingClientRect().height || 0);
    if (!nextHeight) {
      el.browserShell.style.removeProperty("height");
      return;
    }
    el.browserShell.style.height = `${nextHeight}px`;
  }

  function queueBrowserShellHeightSync() {
    if (shellSyncFrame) {
      window.cancelAnimationFrame(shellSyncFrame);
    }
    shellSyncFrame = window.requestAnimationFrame(() => {
      shellSyncFrame = 0;
      syncBrowserShellHeight();
    });
  }

  function ensureContextMenuLayer() {
    if (!el.contextMenu || !document.body) return;
    if (el.contextMenu.parentElement !== document.body) {
      document.body.appendChild(el.contextMenu);
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeSelectorValue(value) {
    const raw = String(value || "");
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(raw);
    }
    return raw.replace(/["\\]/g, "\\$&");
  }

  function displayNameForPath(path) {
    const value = String(path || "/").trim() || "/";
    if (value === "/") return "루트";
    const parts = value.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "현재 폴더";
  }

  function normalizePathList(paths) {
    const next = [];
    const seen = new Set();
    Array.from(paths || []).forEach((value) => {
      const path = String(value || "").trim();
      if (!path || seen.has(path)) return;
      seen.add(path);
      next.push(path);
    });
    return next;
  }

  function isMobileNasInteraction() {
    if (mobileInteractionQuery) {
      return mobileInteractionQuery.matches;
    }
    const userAgent = String((window.navigator && window.navigator.userAgent) || "");
    return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  }

  function resetMobileTapState() {
    state.mobileTapPath = "";
    state.mobileTapType = "";
    state.mobileTapAt = 0;
  }

  function downloadFilenameFromDisposition(value) {
    const disposition = String(value || "");
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match && utf8Match[1]) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch (_) {
        return utf8Match[1];
      }
    }
    const basicMatch = disposition.match(/filename="?([^";]+)"?/i);
    return basicMatch && basicMatch[1] ? basicMatch[1] : "";
  }

  function triggerBlobDownload(blob, filename) {
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename || "nas_download.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60000);
  }

  function isToggleModifier(event) {
    return Boolean(event && (event.ctrlKey || event.metaKey));
  }

  function isSelectAllShortcut(event) {
    return Boolean(event && !event.altKey && isToggleModifier(event) && String(event.key || "").toLowerCase() === "a");
  }

  function isTextEditingTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable]"));
  }

  function focusExplorerSelectionScope() {
    if (!el.explorerDropTarget) return;
    state.explorerKeyboardActive = true;
    if (!el.explorerDropTarget.hasAttribute("tabindex")) {
      el.explorerDropTarget.setAttribute("tabindex", "0");
    }
    try {
      el.explorerDropTarget.focus({ preventScroll: true });
    } catch (_) {
      el.explorerDropTarget.focus();
    }
  }

  function clearExplorerSelectionScope() {
    state.explorerKeyboardActive = false;
  }

  function buildToggledPathList(basePaths, togglePaths) {
    const baseSet = new Set(Array.from(basePaths || []).map((value) => String(value || "").trim()).filter(Boolean));
    const toggleSet = new Set(Array.from(togglePaths || []).map((value) => String(value || "").trim()).filter(Boolean));
    return filteredItems()
      .map((item) => item.path)
      .filter((path) => baseSet.has(path) !== toggleSet.has(path));
  }

  function toggleSelectedItem(path, type) {
    const itemPath = String(path || "").trim();
    if (!itemPath) return;
    const nextPaths = buildToggledPathList(state.selectedPaths, [itemPath]);
    const keepPrimary = nextPaths.includes(itemPath);
    setSelectedPaths(nextPaths, {
      primaryPath: keepPrimary ? itemPath : "",
      primaryType: keepPrimary ? (type || findItem(itemPath)?.type || "") : "",
    });
  }

  function selectAllVisibleItems() {
    const nextPaths = filteredItems().map((item) => item.path);
    setSelectedPaths(nextPaths, {
      primaryPath: nextPaths[nextPaths.length - 1] || "",
      primaryType: nextPaths.length ? (findItem(nextPaths[nextPaths.length - 1])?.type || "") : "",
    });
  }

  function shouldHandleExplorerShortcut(event) {
    if (!state.explorerKeyboardActive || !el.explorerDropTarget) return false;
    if (isTextEditingTarget(event.target) || isTextEditingTarget(document.activeElement)) return false;
    return true;
  }

  function setAlert(kind, message) {
    if (!el.alert) return;
    if (!message) {
      el.alert.className = "alert d-none";
      el.alert.textContent = "";
      return;
    }
    const map = {
      success: "alert alert-success",
      warning: "alert alert-warning",
      danger: "alert alert-danger",
      info: "alert alert-info",
    };
    el.alert.className = map[kind] || map.info;
    el.alert.textContent = message;
  }

  async function readError(res) {
    try {
      const payload = await res.json();
      return payload.detail || payload.message || `HTTP ${res.status}`;
    } catch (_) {
      return `HTTP ${res.status}`;
    }
  }

  async function downloadItems(target) {
    const paths = normalizePathList(Array.isArray(target) ? target : [target]);
    if (!paths.length) {
      setAlert("warning", "다운로드할 항목을 선택해주세요.");
      return;
    }

    if (paths.length === 1) {
      const singleItem = findItem(paths[0]);
      if (singleItem && singleItem.type === "file") {
        window.location.href = `/api/nas/download?path=${encodeURIComponent(paths[0])}`;
        return;
      }
    }

    const selectedItems = paths.map((path) => findItem(path)).filter(Boolean);
    const loadingLabel = paths.length === 1
      ? "폴더 다운로드를 준비하는 중..."
      : "선택한 항목을 압축하는 중...";

    setLoading(true, loadingLabel);
    try {
      const res = await fetch("/api/nas/download-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ paths }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const blob = await res.blob();
      const filename = downloadFilenameFromDisposition(res.headers.get("content-disposition"))
        || (paths.length === 1
          ? `${displayNameForPath(paths[0]) || "nas_item"}.zip`
          : "nas_selection.zip");
      triggerBlobDownload(blob, filename);

      if (paths.length > 1) {
        setAlert("success", `선택한 ${paths.length}개 항목 다운로드를 시작했습니다.`);
      } else if (selectedItems[0] && selectedItems[0].type === "directory") {
        setAlert("success", `${selectedItems[0].name} 다운로드를 시작했습니다.`);
      }
    } catch (err) {
      setAlert("danger", err instanceof Error ? err.message : "다운로드에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function setLoading(active, label) {
    if (!window.AppUI) return;
    if (active && typeof window.AppUI.showLoading === "function") {
      window.AppUI.showLoading(label || "NAS 정보를 불러오는 중...");
      return;
    }
    if (!active && typeof window.AppUI.hideLoading === "function") {
      window.AppUI.hideLoading();
    }
  }

  function parseJsonText(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function readXhrError(xhr) {
    const payload = parseJsonText(xhr && xhr.responseText);
    if (payload && typeof payload === "object") {
      return payload.detail || payload.message || `HTTP ${xhr.status}`;
    }
    return `HTTP ${xhr && xhr.status ? xhr.status : 0}`;
  }

  function setUploadProgressVisible(active) {
    if (uploadProgressModal) {
      if (active) {
        if (el.uploadProgressModal) {
          el.uploadProgressModal.dataset.pendingHide = "false";
        }
        uploadProgressModal.show();
      } else {
        if (el.uploadProgressModal) {
          el.uploadProgressModal.dataset.pendingHide = "true";
        }
        uploadProgressModal.hide();
        window.setTimeout(() => {
          if (!el.uploadProgressModal) return;
          if (el.uploadProgressModal.dataset.pendingHide !== "true") return;
          forceHideUploadProgressModal();
        }, 250);
      }
      return;
    }
    if (!el.uploadProgressModal) return;
    if (active) {
      el.uploadProgressModal.classList.add("show");
      el.uploadProgressModal.style.display = "block";
      el.uploadProgressModal.setAttribute("aria-hidden", "false");
      el.uploadProgressModal.dataset.pendingHide = "false";
      return;
    }
    el.uploadProgressModal.dataset.pendingHide = "true";
    forceHideUploadProgressModal();
  }

  function forceHideUploadProgressModal() {
    if (!el.uploadProgressModal) return;
    el.uploadProgressModal.classList.remove("show");
    el.uploadProgressModal.style.display = "none";
    el.uploadProgressModal.setAttribute("aria-hidden", "true");
    el.uploadProgressModal.removeAttribute("aria-modal");
    el.uploadProgressModal.dataset.pendingHide = "false";
    if (document.body) {
      const hasVisibleModal = Array.from(document.querySelectorAll(".modal.show"))
        .some((modal) => modal !== el.uploadProgressModal);
      if (!hasVisibleModal) {
        document.body.classList.remove("modal-open");
        document.body.style.removeProperty("padding-right");
        document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
          backdrop.remove();
        });
      }
    }
  }

  function setUploadProgressStage(stage) {
    const currentStage = String(stage || "uploading");
    const statusMap = {
      uploading: "전송 진행률",
      finalizing: "서버 저장 확인 중",
      complete: "업로드 완료",
    };
    if (el.uploadProgressStatus) {
      el.uploadProgressStatus.textContent = statusMap[currentStage] || statusMap.uploading;
    }
    if (el.uploadProgressBar) {
      const animate = currentStage === "uploading";
      el.uploadProgressBar.classList.toggle("progress-bar-striped", animate);
      el.uploadProgressBar.classList.toggle("progress-bar-animated", animate);
    }
  }

  function updateUploadProgress(loadedBytes, totalBytes) {
    const safeTotal = Math.max(Number(totalBytes || 0), 0);
    const safeLoaded = safeTotal > 0
      ? Math.min(Math.max(Number(loadedBytes || 0), 0), safeTotal)
      : Math.max(Number(loadedBytes || 0), 0);
    const percent = safeTotal > 0
      ? Math.max(0, Math.min(100, Math.round((safeLoaded / safeTotal) * 100)))
      : (safeLoaded > 0 ? 100 : 0);
    if (el.uploadProgressPercent) el.uploadProgressPercent.textContent = `${percent}%`;
    if (el.uploadProgressBytes) {
      el.uploadProgressBytes.textContent = `${formatBytes(safeLoaded)} / ${formatBytes(safeTotal)}`;
    }
    if (el.uploadProgressBar) {
      el.uploadProgressBar.style.width = `${percent}%`;
      el.uploadProgressBar.textContent = `${percent}%`;
      el.uploadProgressBar.setAttribute("aria-valuenow", String(percent));
    }
  }

  function showUploadProgress(files, label, options) {
    const batch = normalizeUploadEntries(files);
    const opts = options || {};
    const directoryCount = normalizeUploadDirectoryPaths(opts.directories).length;
    const targetPath = state.currentPath || "/";
    const totalBytes = batch.reduce((sum, entry) => sum + Number(entry.size || 0), 0);
    if (el.uploadProgressTitle) {
      el.uploadProgressTitle.textContent = label || "파일을 업로드하는 중...";
    }
    if (el.uploadProgressMeta) {
      const parts = [];
      if (batch.length) parts.push(`파일 ${batch.length}개`);
      if (directoryCount) parts.push(`폴더 ${directoryCount}개`);
      if (!parts.length) parts.push("항목 0개");
      parts.push(`대상 ${targetPath}`);
      el.uploadProgressMeta.textContent = parts.join(" · ");
    }
    if (el.uploadProgressBytes && !totalBytes) {
      el.uploadProgressBytes.textContent = "0 B / 0 B";
    }
    setUploadProgressStage("uploading");
    updateUploadProgress(0, totalBytes);
    setUploadProgressVisible(true);
  }

  function markUploadProgressFinalizing(totalBytes, options) {
    const total = Math.max(Number(totalBytes || 0), 0);
    const opts = options || {};
    setUploadProgressStage("finalizing");
    if (el.uploadProgressTitle) {
      el.uploadProgressTitle.textContent = opts.label || "업로드를 마무리하는 중...";
    }
    if (total > 0) {
      updateUploadProgress(total, total);
      return;
    }
    if (el.uploadProgressPercent) el.uploadProgressPercent.textContent = "100%";
    if (el.uploadProgressBar) {
      el.uploadProgressBar.style.width = "100%";
      el.uploadProgressBar.textContent = "100%";
      el.uploadProgressBar.setAttribute("aria-valuenow", "100");
    }
    if (el.uploadProgressBytes) {
      el.uploadProgressBytes.textContent = "서버에서 폴더 구조를 저장하는 중...";
    }
  }

  function hideUploadProgress() {
    setUploadProgressVisible(false);
  }

  function sendNasUploadRequest(formData, options) {
    const opts = options || {};
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      const finish = (kind, value) => {
        if (settled) return;
        settled = true;
        if (kind === "resolve") {
          resolve(value);
          return;
        }
        reject(value);
      };
      xhr.open("POST", "/api/nas/upload");
      xhr.responseType = "text";
      xhr.upload.addEventListener("progress", (event) => {
        if (typeof opts.onProgress === "function") {
          opts.onProgress(event);
        }
      });
      xhr.upload.addEventListener("load", () => {
        if (typeof opts.onTransferComplete === "function") {
          opts.onTransferComplete();
        }
      });
      xhr.addEventListener("readystatechange", () => {
        if (xhr.readyState !== XMLHttpRequest.DONE || settled) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          finish("resolve", parseJsonText(xhr.responseText) || {});
          return;
        }
        if (xhr.status) {
          finish("reject", new Error(readXhrError(xhr)));
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          finish("resolve", parseJsonText(xhr.responseText) || {});
          return;
        }
        finish("reject", new Error(readXhrError(xhr)));
      });
      xhr.addEventListener("error", () => {
        finish("reject", new Error("업로드 요청 전송에 실패했습니다."));
      });
      xhr.addEventListener("abort", () => {
        finish("reject", new Error("업로드가 중단되었습니다."));
      });
      xhr.send(formData);
    });
  }

  async function sendNasDirectoryUploadRequest(payload) {
    const res = await fetch("/api/nas/upload/directories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload || {}),
    });
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  }

  function fallbackDrive(extra) {
    return Object.assign({
      label: root.dataset.modelHint || "Seagate Backup+ Desk",
      connected: false,
      mounted: false,
      mount_path: "",
      mount_device: "",
      disk_device: "",
      transport: "",
      serial: "",
      usage_percent: 0,
      used_label: "-",
      free_label: "-",
      total_label: "-",
    }, extra || {});
  }

  function fileIcon(item) {
    const kind = item.kind || item.type || "file";
    if (kind === "folder" || item.type === "directory") return "bi bi-folder2-open";
    if (kind === "image") return "bi bi-file-earmark-image";
    if (kind === "video") return "bi bi-file-earmark-play";
    if (kind === "audio") return "bi bi-file-earmark-music";
    if (kind === "archive") return "bi bi-file-earmark-zip";
    if (kind === "pdf") return "bi bi-file-earmark-pdf";
    if (kind === "text") return "bi bi-file-earmark-text";
    if (kind === "binary") return "bi bi-file-earmark-binary";
    return "bi bi-file-earmark";
  }

  function isFileLike(value) {
    return Boolean(
      value
      && typeof value === "object"
      && typeof value.name === "string"
      && typeof value.size === "number"
      && typeof value.slice === "function"
    );
  }

  function normalizeUploadRelativePath(value) {
    const raw = String(value || "").replace(/\\/g, "/").trim();
    if (!raw) return "";
    const parts = raw.split("/")
      .map((part) => String(part || "").trim())
      .filter(Boolean);
    if (!parts.length) return "";
    if (parts.some((part) => part === "." || part === "..")) return "";
    return parts.join("/");
  }

  function normalizeUploadDirectoryPaths(paths) {
    const next = [];
    const seen = new Set();
    Array.from(paths || []).forEach((value) => {
      const relativePath = normalizeUploadRelativePath(value);
      if (!relativePath || seen.has(relativePath)) return;
      seen.add(relativePath);
      next.push(relativePath);
    });
    return next;
  }

  function hasNasPathPrefix(path, prefix) {
    const normalizedPath = String(path || "").trim();
    const normalizedPrefix = String(prefix || "").trim();
    if (!normalizedPath || !normalizedPrefix) return false;
    return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
  }

  function collapsePathSelection(paths) {
    const next = normalizePathList(paths).sort((a, b) => {
      const depthDiff = a.split("/").filter(Boolean).length - b.split("/").filter(Boolean).length;
      if (depthDiff !== 0) return depthDiff;
      return a.localeCompare(b);
    });
    return next.filter((path, index) => !next.slice(0, index).some((parentPath) => hasNasPathPrefix(path, parentPath)));
  }

  function hasUploadPathPrefix(path, prefix) {
    const normalizedPath = normalizeUploadRelativePath(path);
    const normalizedPrefix = normalizeUploadRelativePath(prefix);
    if (!normalizedPath || !normalizedPrefix) return false;
    return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
  }

  function getMarkTone(color) {
    const key = String(color || "").trim().toLowerCase();
    return MARK_COLOR_OPTIONS[key] || null;
  }

  function markStyleVars(color) {
    const tone = getMarkTone(color);
    if (!tone) return "";
    return [
      `--nas-mark-bg:${tone.rowBg}`,
      `--nas-mark-hover:${tone.rowHover}`,
      `--nas-mark-selected:${tone.rowSelected}`,
      `--nas-mark-border:${tone.rowBorder}`,
      `--nas-mark-accent:${tone.accent}`,
    ].join(";");
  }

  function buildUploadEntry(file, relativePath) {
    if (!isFileLike(file)) return null;
    const fallbackName = String(file.name || "").trim();
    const normalizedPath = normalizeUploadRelativePath(relativePath || file.webkitRelativePath || fallbackName);
    const effectivePath = normalizedPath || normalizeUploadRelativePath(fallbackName);
    if (!fallbackName || !effectivePath) return null;
    const size = Number(file.size || 0);
    const lastModified = Number(file.lastModified || 0);
    const parts = effectivePath.split("/");
    const displayName = parts[parts.length - 1] || fallbackName;
    return {
      file,
      key: `${effectivePath}|${size}|${lastModified}`,
      name: displayName,
      relativePath: effectivePath,
      size,
      lastModified,
    };
  }

  function normalizeUploadEntries(files) {
    return Array.from(files || [])
      .map((value) => {
        if (value && isFileLike(value.file)) {
          return buildUploadEntry(value.file, value.relativePath || value.name || value.file.webkitRelativePath || value.file.name);
        }
        if (isFileLike(value)) {
          return buildUploadEntry(value, value.webkitRelativePath || value.name);
        }
        return null;
      })
      .filter(Boolean);
  }

  function fileKey(file) {
    const entry = normalizeUploadEntries([file])[0] || file;
    return entry && entry.key
      ? entry.key
      : `${String(file && file.name || "")}|${Number(file && file.size || 0)}|${Number(file && file.lastModified || 0)}`;
  }

  function findItem(path) {
    return state.items.find((item) => item.path === path) || null;
  }

  function getSelectedItems() {
    if (!state.selectedPaths.length) return [];
    const selected = new Set(state.selectedPaths);
    return state.items.filter((item) => selected.has(item.path));
  }

  function isPathSelected(path) {
    return Boolean(path) && state.selectedPaths.includes(path);
  }

  function isItemPinned(path) {
    return Boolean(findItem(path)?.pinned);
  }

  function syncPrimarySelection(preferredPath, preferredType) {
    if (preferredPath && state.selectedPaths.includes(preferredPath)) {
      state.selectedPath = preferredPath;
      state.selectedType = preferredType || findItem(preferredPath)?.type || "";
      return;
    }

    const first = getSelectedItems()[0] || null;
    state.selectedPath = first?.path || "";
    state.selectedType = first?.type || "";
  }

  function samePathList(a, b) {
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
  }

  function paintSelectionRows() {
    if (!el.tableBody) return;
    const selected = new Set(state.selectedPaths);
    el.tableBody.querySelectorAll("tr[data-row-path]").forEach((row) => {
      const rowPath = row.getAttribute("data-row-path") || "";
      row.classList.toggle("is-selected", selected.has(rowPath));
    });
  }

  function setSelectedPaths(paths, options) {
    const opts = options || {};
    const visible = new Set(state.items.map((item) => item.path));
    const next = [];
    const seen = new Set();

    Array.from(paths || []).forEach((value) => {
      const path = String(value || "").trim();
      if ((!path) || seen.has(path) || (!visible.has(path))) return;
      seen.add(path);
      next.push(path);
    });

    const primaryPath = String(opts.primaryPath || "").trim();
    const primaryType = String(opts.primaryType || "").trim();
    const changed = !samePathList(state.selectedPaths, next);

    state.selectedPaths = next;
    syncPrimarySelection(primaryPath, primaryType);

    if (changed) {
      paintSelectionRows();
    }
    renderSelectionSummary();
  }

  function setSelectedItem(path, type) {
    setSelectedPaths(path ? [path] : [], { primaryPath: path, primaryType: type });
  }

  function renderSelectionSummary() {
    if (!el.selectionText) return;
    const selectedItems = getSelectedItems();
    if (!selectedItems.length) {
      el.selectionText.textContent = "선택된 항목 없음";
      return;
    }

    if (selectedItems.length === 1) {
      const selected = selectedItems[0];
      const label = selected.type === "directory"
        ? `폴더 선택: ${selected.name}`
        : `파일 선택: ${selected.name} · ${selected.size_label || "-"}`;
      el.selectionText.textContent = label;
      return;
    }

    const dirCount = selectedItems.filter((item) => item.type === "directory").length;
    const fileCount = selectedItems.length - dirCount;
    const parts = [];
    if (dirCount) parts.push(`폴더 ${dirCount}개`);
    if (fileCount) parts.push(`파일 ${fileCount}개`);
    el.selectionText.textContent = `${parts.join(" · ")} 선택`;
  }

  function hideContextMenu() {
    state.contextPaths = [];
    state.contextPath = "";
    state.contextType = "";
    if (!el.contextMenu) return;
    el.contextMenu.classList.add("d-none");
    el.contextMenu.style.visibility = "hidden";
    el.contextMenu.setAttribute("aria-hidden", "true");
  }

  function setContextItemVisible(action, visible) {
    if (!el.contextMenu) return;
    const button = el.contextMenu.querySelector(`[data-menu-action="${action}"]`);
    if (!button) return;
    button.classList.toggle("d-none", !visible);
  }

  function contextMenuItems() {
    return state.contextPaths.map((path) => findItem(path)).filter(Boolean);
  }

  function showContextMenu(x, y, options) {
    if (!el.contextMenu) return;
    ensureContextMenuLayer();
    const opts = options || {};
    const selectionPaths = Array.isArray(opts.selectionPaths)
      ? normalizePathList(opts.selectionPaths)
      : [];

    state.contextPaths = selectionPaths.length
      ? selectionPaths
      : (opts.path ? [String(opts.path)] : []);
    state.contextPath = state.contextPaths.length === 1 ? state.contextPaths[0] : "";
    state.contextType = state.contextPath
      ? (opts.type || findItem(state.contextPath)?.type || "")
      : "";

    const hasSelection = state.contextPaths.length > 0;
    const isDir = state.contextPaths.length === 1 && state.contextType === "directory";
    const contextItems = contextMenuItems();
    const anyPinned = contextItems.some((item) => Boolean(item.pinned));
    const anyUnpinned = contextItems.some((item) => !item.pinned);
    const anyMarked = contextItems.some((item) => Boolean(item.marked));
    const anyUnmarked = contextItems.some((item) => !item.marked);

    setContextItemVisible("open", isDir);
    setContextItemVisible("download", hasSelection);
    setContextItemVisible("rename", Boolean(state.contextPath));
    setContextItemVisible("pin-top", Boolean(contextItems.length) && anyUnpinned);
    setContextItemVisible("unpin-top", Boolean(contextItems.length) && anyPinned);
    setContextItemVisible("mark", Boolean(contextItems.length) && anyUnmarked);
    setContextItemVisible("unmark", Boolean(contextItems.length) && anyMarked);
    setContextItemVisible("move-to-trash", Boolean(state.contextPaths.length));
    setContextItemVisible("new-folder", true);
    setContextItemVisible("open-trash", true);
    setContextItemVisible("refresh", true);

    el.contextMenu.classList.remove("d-none");
    el.contextMenu.setAttribute("aria-hidden", "false");
    el.contextMenu.style.visibility = "hidden";
    el.contextMenu.style.left = "0px";
    el.contextMenu.style.top = "0px";

    const menuRect = el.contextMenu.getBoundingClientRect();
    const pointerOffset = 6;
    let left = x + pointerOffset;
    let top = y + 4;

    if (left + menuRect.width > window.innerWidth - 8) {
      left = x - menuRect.width - pointerOffset;
    }
    if (top + menuRect.height > window.innerHeight - 8) {
      top = y - menuRect.height - pointerOffset;
    }

    left = Math.max(8, Math.min(left, window.innerWidth - menuRect.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - menuRect.height - 8));
    el.contextMenu.style.left = `${left}px`;
    el.contextMenu.style.top = `${top}px`;
    el.contextMenu.style.visibility = "visible";
  }

  function renderDrive(drive) {
    const current = (drive && typeof drive === "object") ? fallbackDrive(drive) : fallbackDrive();
    state.drive = current;
    const isConnected = Boolean(current.connected);
    const isMounted = Boolean(current.mounted);
    const statusLabel = isConnected ? "연결됨" : "연결안됨";
    if (el.driveStatus) {
      el.driveStatus.className = isConnected
        ? "badge rounded-pill text-bg-success-subtle border border-success-subtle text-success-emphasis"
        : "badge rounded-pill text-bg-danger-subtle border border-danger-subtle text-danger-emphasis";
      el.driveStatus.textContent = statusLabel;
    }

    const label = current.label || root.dataset.modelHint || "Seagate Backup+ Desk";
    if (el.driveLabel) el.driveLabel.textContent = label;
    if (el.heroLabel) el.heroLabel.textContent = label;
    if (el.paneStatusMirror) el.paneStatusMirror.textContent = label;
    if (el.mountPath) el.mountPath.textContent = (isMounted && current.mount_path) ? current.mount_path : "-";
    if (el.diskDevice) el.diskDevice.textContent = current.mount_device || current.disk_device || "-";
    if (el.transport) el.transport.textContent = (current.transport || "-").toUpperCase();
    if (el.serial) el.serial.textContent = current.serial || "-";
    if (el.usageText) el.usageText.textContent = isMounted ? `${current.usage_percent}% 사용 중` : "-";
    if (el.usageBar) el.usageBar.style.width = isMounted ? `${current.usage_percent || 0}%` : "0%";
    if (el.usedText) el.usedText.textContent = isMounted ? (current.used_label || "-") : "-";
    if (el.freeText) el.freeText.textContent = isMounted ? (current.free_label || "-") : "-";
    if (el.totalText) el.totalText.textContent = isMounted ? (current.total_label || "-") : "-";
    if (el.heroCapacity) el.heroCapacity.textContent = isMounted ? (current.total_label || "-") : "-";
    queueBrowserShellHeightSync();
  }

  async function refreshDriveStatus() {
    try {
      const res = await fetch("/api/nas/status", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      const payload = await res.json();
      renderDrive(payload.drive || null);
      return payload.drive || null;
    } catch (_) {
      renderDrive(null);
      return null;
    }
  }

  function renderBreadcrumbs(breadcrumbs) {
    if (!el.breadcrumbs) return;
    const items = Array.isArray(breadcrumbs) ? breadcrumbs : [{ name: "ROOT", path: "/" }];
    el.breadcrumbs.innerHTML = items.map((crumb) => {
      return `<button class="btn btn-sm btn-outline-secondary" type="button" data-action="crumb" data-path="${escapeHtml(crumb.path)}">${escapeHtml(crumb.name)}</button>`;
    }).join("");
    if (el.paneLocation) {
      el.paneLocation.innerHTML = items.map((crumb) => {
        return `<button class="btn btn-sm btn-outline-secondary" type="button" data-action="crumb" data-path="${escapeHtml(crumb.path)}">${escapeHtml(crumb.name)}</button>`;
      }).join("");
    }
  }

  function filteredItems() {
    const query = String(el.searchInput && el.searchInput.value || "").trim().toLowerCase();
    if (!query) return state.items.slice();
    return state.items.filter((item) => String(item.name || "").toLowerCase().includes(query));
  }

  function renderItems() {
    if (!el.tableBody || !el.emptyState) return;
    const items = filteredItems();
    const visible = new Set(items.map((item) => item.path));
    const nextSelectedPaths = state.selectedPaths.filter((path) => visible.has(path));
    if (!samePathList(state.selectedPaths, nextSelectedPaths)) {
      state.selectedPaths = nextSelectedPaths;
      syncPrimarySelection();
    }
    const countsText = `항목 ${items.length}개`;
    if (el.countsText) {
      const suffix = state.truncated ? " · 일부만 표시 중" : "";
      el.countsText.textContent = countsText + suffix;
    }
    if (el.heroItemCount) el.heroItemCount.textContent = String(items.length);

    if (!items.length) {
      el.tableBody.innerHTML = "";
      el.emptyState.classList.remove("d-none");
      renderSelectionSummary();
      queueBrowserShellHeightSync();
      return;
    }

    el.emptyState.classList.add("d-none");
    el.tableBody.innerHTML = items.map((item) => {
      const isDir = item.type === "directory";
      const isSelected = isPathSelected(item.path);
      const markTone = getMarkTone(item.mark_color);
      const rowStyle = item.marked ? markStyleVars(item.mark_color) : "";
      const markBadge = item.marked && markTone
        ? `<span class="nas-file-mark" title="${escapeHtml(`${markTone.label} 마킹됨`)}" style="--nas-mark-accent:${markTone.accent}"><i class="bi bi-bookmark-fill"></i></span>`
        : "";
      const pinnedBadge = item.pinned
        ? '<span class="nas-file-pin" title="상단 고정됨"><i class="bi bi-pin-angle-fill"></i></span>'
        : "";
      const baseSub = isDir ? "폴더" : (item.extension || "파일");
      const subParts = [baseSub];
      if (item.pinned) subParts.push("상단 고정");
      if (item.marked && markTone) subParts.push(`${markTone.label} 마킹`);
      const subLabel = subParts.join(" · ");
      const uploaderName = String(item.uploader_name || item.uploader_nickname || item.uploader_id || "-").trim() || "-";
      const uploaderId = String(item.uploader_id || "").trim();
      const uploaderImageUrl = String(item.uploader_profile_image_url || "").trim();
      const uploaderAvatarInitial = String(item.uploader_avatar_initial || uploaderName.charAt(0) || "U").trim() || "U";
      const uploaderIdLabel = uploaderId && uploaderId !== uploaderName
        ? `<div class="nas-uploader-id">ID: ${escapeHtml(uploaderId)}</div>`
        : "";
      const uploaderAvatar = uploaderImageUrl
        ? `<img class="nas-uploader-avatar__image" src="${escapeHtml(uploaderImageUrl)}" alt="${escapeHtml(uploaderName)}">`
        : `<span class="nas-uploader-avatar__fallback">${escapeHtml(uploaderAvatarInitial)}</span>`;

      return `
        <tr class="nas-file-row ${isSelected ? "is-selected" : ""} ${item.marked ? "is-marked" : ""}" data-row-path="${escapeHtml(item.path)}" data-row-type="${escapeHtml(item.type)}" data-row-name="${escapeHtml(item.name)}" draggable="true" ${rowStyle ? `style="${escapeHtml(rowStyle)}"` : ""}>
          <td class="ps-3">
            <div class="nas-file-primary">
              <span class="nas-file-icon"><i class="${fileIcon(item)}"></i></span>
              <div class="min-w-0">
                <div class="nas-file-name">${escapeHtml(item.name)}${markBadge}${pinnedBadge}</div>
                <div class="nas-file-sub">${escapeHtml(subLabel)}</div>
              </div>
            </div>
          </td>
          <td>
            <div class="nas-uploader-cell">
              <span class="nas-uploader-avatar">${uploaderAvatar}</span>
              <div class="nas-uploader-text">
                <div class="nas-uploader-name">${escapeHtml(uploaderName)}</div>
                ${uploaderIdLabel}
              </div>
            </div>
          </td>
          <td>${escapeHtml(item.modified_at || "-")}</td>
          <td>${isDir ? "폴더" : "파일"}</td>
          <td>${escapeHtml(item.size_label || "-")}</td>
        </tr>
      `;
    }).join("");

    paintSelectionRows();
    renderSelectionSummary();
    queueBrowserShellHeightSync();
  }

  function renderTrashItems() {
    if (!el.trashTbody || !el.trashEmptyState) return;
    const items = Array.isArray(state.trashItems) ? state.trashItems : [];
    if (!items.length) {
      el.trashTbody.innerHTML = "";
      el.trashEmptyState.classList.remove("d-none");
      return;
    }

    el.trashEmptyState.classList.add("d-none");
    el.trashTbody.innerHTML = items.map((item) => {
      return `
        <tr>
          <td class="ps-3 fw-semibold">${escapeHtml(item.name || "-")}</td>
          <td>${escapeHtml(item.original_path || "-")}</td>
          <td>${item.type === "directory" ? "폴더" : "파일"}</td>
          <td>${escapeHtml(item.deleted_at || "-")}</td>
          <td>${escapeHtml(item.size_label || "-")}</td>
          <td class="pe-3 text-end">
            <div class="d-inline-flex gap-2">
              <button class="btn btn-sm btn-outline-primary" type="button" data-trash-action="restore" data-trash-id="${escapeHtml(item.item_id)}">
                <i class="bi bi-arrow-counterclockwise me-1"></i>복원
              </button>
              <button class="btn btn-sm btn-outline-danger" type="button" data-trash-action="purge" data-trash-id="${escapeHtml(item.item_id)}">
                <i class="bi bi-trash me-1"></i>영구 삭제
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  function buildUploadQueueItems() {
    const directoryItems = normalizeUploadDirectoryPaths(state.uploadDirectories).map((relativePath) => {
      const normalizedPath = normalizeUploadRelativePath(relativePath);
      const name = normalizedPath.split("/").filter(Boolean).pop() || normalizedPath;
      const hasNestedFiles = state.uploadFiles.some((entry) => {
        const filePath = normalizeUploadRelativePath(entry.relativePath || entry.name || "");
        return Boolean(filePath) && filePath !== normalizedPath && hasUploadPathPrefix(filePath, normalizedPath);
      });
      return {
        kind: "directory",
        key: `dir:${normalizedPath}`,
        name,
        relativePath: normalizedPath,
        metaLabel: hasNestedFiles ? `${normalizedPath} · 폴더` : `${normalizedPath} · 빈 폴더`,
      };
    });
    const fileItems = state.uploadFiles.map((entry) => {
      const relativePath = entry.relativePath || entry.name || "";
      const metaLabel = relativePath && relativePath !== entry.name
        ? `${relativePath} · ${formatBytes(entry.size)}`
        : formatBytes(entry.size);
      return {
        kind: "file",
        key: entry.key || fileKey(entry),
        name: entry.name,
        relativePath,
        metaLabel,
      };
    });
    return [...directoryItems, ...fileItems];
  }

  function renderQueue() {
    if (!el.uploadQueue) return;
    const queueItems = buildUploadQueueItems();
    if (!queueItems.length) {
      el.uploadQueue.innerHTML = '<div class="nas-upload-empty">선택된 파일이나 폴더가 없습니다.</div>';
      return;
    }
    el.uploadQueue.innerHTML = queueItems.map((entry) => {
      const isDirectory = entry.kind === "directory";
      return `
        <div class="nas-upload-chip ${isDirectory ? "nas-upload-chip--directory" : ""}">
          <span class="nas-upload-chip__icon"><i class="bi ${isDirectory ? "bi-folder2-open" : "bi-file-earmark"}"></i></span>
          <div class="min-w-0">
            <div class="fw-semibold text-truncate" title="${escapeHtml(entry.relativePath || entry.name || "")}">${escapeHtml(entry.name || "")}</div>
            <div class="small text-secondary text-truncate">${escapeHtml(entry.metaLabel || "")}</div>
          </div>
          <button class="btn btn-sm btn-outline-danger" type="button" data-action="remove-upload" data-kind="${escapeHtml(entry.kind)}" data-key="${escapeHtml(entry.key)}">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      `;
    }).join("");
  }

  function formatBytes(size) {
    let value = Number(size || 0);
    const units = ["B", "KB", "MB", "GB", "TB"];
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    if (idx === 0) return `${Math.round(value)} ${units[idx]}`;
    return `${value.toFixed(2)} ${units[idx]}`;
  }

  function renderMarkColorOptions() {
    if (!el.markColorOptions) return;
    el.markColorOptions.innerHTML = Object.entries(MARK_COLOR_OPTIONS).map(([color, tone]) => {
      return `
        <button
          class="nas-mark-swatch ${state.markEditorColor === color ? "is-active" : ""}"
          type="button"
          data-mark-color="${escapeHtml(color)}"
          style="--nas-mark-accent:${tone.accent};--nas-mark-soft:${tone.soft};"
          aria-pressed="${state.markEditorColor === color ? "true" : "false"}"
        >
          <span class="nas-mark-swatch__dot"></span>
          <span class="nas-mark-swatch__meta">
            <span class="nas-mark-swatch__title d-block">${escapeHtml(tone.label)}</span>
            <span class="nas-mark-swatch__sub d-block">${escapeHtml(tone.sub)}</span>
          </span>
        </button>
      `;
    }).join("");
  }

  function resolveDuplicateConflictPending(result) {
    const pending = duplicateConflictPending;
    if (!pending) return;
    duplicateConflictPending = null;
    pending.resolve(result);
    if (duplicateConflictModal) {
      duplicateConflictModal.hide();
    } else if (el.duplicateConflictModal) {
      el.duplicateConflictModal.classList.remove("show");
      el.duplicateConflictModal.style.display = "none";
    }
  }

  function showEmptyFolderNotice(paths) {
    const normalizedPaths = normalizeUploadDirectoryPaths(paths);
    const folderCount = normalizedPaths.length;
    const firstLabel = displayNameForPath(normalizedPaths[0] || "");
    if (el.emptyFolderMessage) {
      el.emptyFolderMessage.textContent = folderCount <= 1
        ? `"${firstLabel}" 폴더는 빈 폴더입니다.`
        : `선택한 ${folderCount}개 폴더는 모두 빈 폴더입니다.`;
    }
    if (el.emptyFolderMeta) {
      el.emptyFolderMeta.textContent = folderCount <= 1
        ? "빈 폴더는 업로드되지 않습니다."
        : "빈 폴더들은 업로드되지 않습니다.";
    }
    if (emptyFolderModal) {
      emptyFolderModal.show();
      return;
    }
    window.alert(folderCount <= 1
      ? `"${firstLabel}" 폴더는 빈 폴더입니다.`
      : `선택한 ${folderCount}개 폴더는 모두 빈 폴더입니다.`);
  }

  async function promptDuplicateConflict(conflict, options) {
    const opts = options || {};
    const itemType = conflict && conflict.incoming_type === "directory" ? "폴더" : "파일";
    const existingType = conflict && conflict.existing_type === "directory" ? "폴더" : "파일";
    const canOverwrite = Boolean(conflict && conflict.can_overwrite);
    const targetPath = String(conflict && conflict.target_path || "/");
    const itemName = String(conflict && conflict.name || displayNameForPath(targetPath));
    const title = itemType === "directory" ? "중복된 폴더가 있습니다" : "중복된 파일이 있습니다";
    const message = `"${itemName}" ${itemType}가 이미 존재하는 ${existingType}와 이름이 겹칩니다.`;
    const hint = canOverwrite
      ? (itemType === "directory"
        ? "덮어쓰기를 누르면 기존 폴더와 병합하고 하위 항목 업로드를 계속 진행합니다."
        : "덮어쓰기를 누르면 기존 파일을 새 파일로 교체합니다.")
      : "기존 항목 종류가 달라서 이 경우에는 덮어쓰기를 사용할 수 없습니다. 건너뛰기 또는 취소를 선택해주세요.";

    if (!duplicateConflictModal || !el.duplicateConflictTitle || !el.duplicateConflictMessage) {
      if (!canOverwrite) return { action: "skip", applyAll: false };
      return { action: window.confirm(`${message}\n\n${targetPath}\n\n덮어쓸까요?`) ? "overwrite" : "skip", applyAll: false };
    }

    if (duplicateConflictPending) {
      resolveDuplicateConflictPending({ action: "cancel", applyAll: false });
    }

    if (el.duplicateConflictTitle) el.duplicateConflictTitle.innerHTML = `<i class="bi bi-exclamation-triangle me-2"></i>${escapeHtml(title)}`;
    if (el.duplicateConflictMessage) el.duplicateConflictMessage.textContent = message;
    if (el.duplicateConflictPath) el.duplicateConflictPath.textContent = targetPath;
    if (el.duplicateConflictMeta) {
      el.duplicateConflictMeta.textContent = `${opts.index || 1} / ${opts.total || 1} 충돌`;
    }
    if (el.duplicateConflictHint) {
      el.duplicateConflictHint.textContent = hint;
      el.duplicateConflictHint.classList.toggle("d-none", !hint);
    }
    if (el.duplicateApplyAllWrap) {
      el.duplicateApplyAllWrap.classList.toggle("d-none", (opts.total || 1) <= 1);
    }
    if (el.duplicateApplyAll) {
      el.duplicateApplyAll.checked = false;
    }
    if (el.duplicateOverwriteBtn) {
      el.duplicateOverwriteBtn.disabled = !canOverwrite;
    }

    return new Promise((resolve) => {
      duplicateConflictPending = { resolve };
      duplicateConflictModal.show();
    });
  }

  async function inspectUploadConflicts(batch, directoryPaths) {
    const payload = {
      path: state.currentPath || "/",
      directories: normalizeUploadDirectoryPaths(directoryPaths),
      file_paths: normalizeUploadEntries(batch).map((entry) => entry.relativePath).filter(Boolean),
    };
    const res = await fetch("/api/nas/upload/conflicts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await readError(res));
    const responsePayload = await res.json();
    return Array.isArray(responsePayload.conflicts) ? responsePayload.conflicts : [];
  }

  function isUploadPathSkipped(relativePath, skippedFiles, skippedDirectories) {
    const normalizedPath = normalizeUploadRelativePath(relativePath);
    if (!normalizedPath) return false;
    if (skippedFiles.has(normalizedPath)) return true;
    return Array.from(skippedDirectories).some((directoryPath) => hasUploadPathPrefix(normalizedPath, directoryPath));
  }

  async function resolveUploadConflicts(batch, directoryPaths) {
    const conflicts = await inspectUploadConflicts(batch, directoryPaths);
    if (!conflicts.length) {
      return {
        entries: batch,
        directories: directoryPaths,
        overwritePaths: [],
      };
    }

    const skippedFiles = new Set();
    const skippedDirectories = new Set();
    const overwritePaths = new Set();
    let applyAllAction = "";

    for (let index = 0; index < conflicts.length; index += 1) {
      const conflict = conflicts[index];
      const relativePath = normalizeUploadRelativePath(conflict && conflict.relative_path);
      if (!relativePath || isUploadPathSkipped(relativePath, skippedFiles, skippedDirectories)) {
        continue;
      }

      let action = "";
      if (applyAllAction) {
        if (applyAllAction === "overwrite" && !conflict.can_overwrite) {
          action = "";
        } else {
          action = applyAllAction;
        }
      }

      if (!action) {
        const decision = await promptDuplicateConflict(conflict, { index: index + 1, total: conflicts.length });
        if (!decision || decision.action === "cancel") {
          return null;
        }
        action = decision.action;
        if (decision.applyAll) {
          applyAllAction = action;
        }
      }

      if (action === "overwrite" && conflict.can_overwrite) {
        overwritePaths.add(relativePath);
        continue;
      }
      if (conflict.incoming_type === "directory") {
        skippedDirectories.add(relativePath);
      } else {
        skippedFiles.add(relativePath);
      }
    }

    return {
      entries: batch.filter((entry) => !isUploadPathSkipped(entry.relativePath || entry.name || "", skippedFiles, skippedDirectories)),
      directories: directoryPaths.filter((path) => !isUploadPathSkipped(path, skippedFiles, skippedDirectories)),
      overwritePaths: Array.from(overwritePaths),
    };
  }

  function renderPayload(payload) {
    state.currentPath = payload.current_path || "/";
    state.parentPath = payload.parent_path || null;
    state.items = Array.isArray(payload.items) ? payload.items : [];
    state.truncated = Boolean(payload.truncated);
    const visible = new Set(state.items.map((item) => item.path));
    const nextSelectedPaths = state.selectedPaths.filter((path) => visible.has(path));
    if (!samePathList(state.selectedPaths, nextSelectedPaths)) {
      state.selectedPaths = nextSelectedPaths;
    }
    syncPrimarySelection();
    renderDrive(payload.drive || null);
    renderBreadcrumbs(payload.breadcrumbs || []);
    if (el.currentPath) el.currentPath.textContent = state.currentPath;
    if (el.statusPath) el.statusPath.textContent = state.currentPath;
    if (el.paneCurrentLabel) el.paneCurrentLabel.textContent = displayNameForPath(state.currentPath);
    if (el.updatedAt) el.updatedAt.textContent = payload.updated_at || "-";
    if (el.uploadTarget) el.uploadTarget.textContent = state.currentPath;
    if (el.newFolderPath) el.newFolderPath.textContent = state.currentPath;
    if (el.upBtn) el.upBtn.disabled = !state.parentPath;
    if (el.paneUpBtn) el.paneUpBtn.disabled = !state.parentPath;
    renderItems();
  }

  async function loadFolder(path, options) {
    const opts = options || {};
    hideContextMenu();
    setLoading(!opts.silent, "NAS 폴더를 불러오는 중...");
    try {
      const res = await fetch(`/api/nas/browse?path=${encodeURIComponent(path || "/")}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      const payload = await res.json();
      renderPayload(payload);
      if (!opts.keepAlert) setAlert("", "");
    } catch (err) {
      await refreshDriveStatus();
      state.items = [];
      renderItems();
      setAlert("danger", err instanceof Error ? err.message : "NAS 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function loadTrash(options) {
    const opts = options || {};
    if (!opts.silent) setLoading(true, "휴지통을 불러오는 중...");
    try {
      const res = await fetch("/api/nas/trash", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      const payload = await res.json();
      state.trashItems = Array.isArray(payload.items) ? payload.items : [];
      renderTrashItems();
    } catch (err) {
      state.trashItems = [];
      renderTrashItems();
      setAlert("danger", err instanceof Error ? err.message : "휴지통을 불러오지 못했습니다.");
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }

  function mergeUploadFiles(files) {
    const next = normalizeUploadEntries(files);
    if (!next.length) return;
    const known = new Set(state.uploadFiles.map((entry) => entry.key || fileKey(entry)));
    next.forEach((entry) => {
      const key = entry.key || fileKey(entry);
      if (!known.has(key)) {
        known.add(key);
        state.uploadFiles.push(entry);
      }
    });
    renderQueue();
  }

  function mergeUploadDirectories(paths) {
    const next = normalizeUploadDirectoryPaths(paths);
    if (!next.length) return;
    const known = new Set(normalizeUploadDirectoryPaths(state.uploadDirectories));
    next.forEach((relativePath) => {
      if (known.has(relativePath)) return;
      known.add(relativePath);
      state.uploadDirectories.push(relativePath);
    });
    renderQueue();
  }

  async function uploadDirectoryBatch(directories, options) {
    const opts = options || {};
    let directoryPaths = normalizeUploadDirectoryPaths(directories);
    if (state.uploadInFlight) {
      setAlert("warning", "이미 업로드가 진행 중입니다. 잠시만 기다려주세요.");
      return false;
    }
    if (!directoryPaths.length) {
      setAlert("warning", "먼저 업로드할 폴더를 선택해주세요.");
      return false;
    }

    try {
      const conflictPlan = await resolveUploadConflicts([], directoryPaths);
      if (!conflictPlan) {
        setAlert("info", "업로드를 취소했습니다.");
        return false;
      }
      directoryPaths = normalizeUploadDirectoryPaths(conflictPlan.directories);
      opts.overwritePaths = Array.from(new Set(
        Array.from(conflictPlan.overwritePaths || [])
          .map((value) => normalizeUploadRelativePath(value))
          .filter(Boolean)
      ));
    } catch (err) {
      setAlert("danger", err instanceof Error ? err.message : "업로드 충돌 확인에 실패했습니다.");
      return false;
    }

    if (!directoryPaths.length) {
      setAlert("warning", "모든 중복 폴더를 건너뛰어 업로드할 대상이 없습니다.");
      return false;
    }

    const progressLabel = opts.label || "폴더를 업로드하는 중...";
    state.uploadInFlight = true;
    showUploadProgress([], progressLabel, { directories: directoryPaths });
    try {
      markUploadProgressFinalizing(0);
      let payload = null;
      try {
        payload = await sendNasDirectoryUploadRequest({
          path: state.currentPath || "/",
          directories: directoryPaths,
          overwrite_paths: Array.from(opts.overwritePaths || []),
        });
      } catch (_) {
        const fallbackFormData = new FormData();
        fallbackFormData.append("path", state.currentPath || "/");
        directoryPaths.forEach((directoryPath) => fallbackFormData.append("directories", directoryPath));
        Array.from(opts.overwritePaths || []).forEach((overwritePath) => fallbackFormData.append("overwrite_paths", overwritePath));
        payload = await sendNasUploadRequest(fallbackFormData, {
          onTransferComplete() {
            markUploadProgressFinalizing(0);
          },
        });
      }
      markUploadProgressFinalizing(0, { label: "업로드 완료" });
      setUploadProgressStage("complete");
      hideUploadProgress();
      const resultParts = [];
      if (payload.created_directory_count) resultParts.push(`폴더 ${payload.created_directory_count}개 생성`);
      if (!resultParts.length) resultParts.push("처리 완료");
      const skippedText = payload.skipped_count ? `, ${payload.skipped_count}개 건너뜀` : "";
      setAlert("success", `업로드 완료: ${resultParts.join(", ")}${skippedText}`);
      const uploadedDirectories = new Set(directoryPaths);
      state.uploadDirectories = state.uploadDirectories.filter((directoryPath) => !uploadedDirectories.has(normalizeUploadRelativePath(directoryPath)));
      renderQueue();
      await loadFolder(state.currentPath || "/", { silent: true, keepAlert: true });
      return true;
    } catch (err) {
      hideUploadProgress();
      setAlert("danger", err instanceof Error ? err.message : "폴더 업로드에 실패했습니다.");
      return false;
    } finally {
      state.uploadInFlight = false;
      hideUploadProgress();
    }
  }

  async function uploadFileBatch(files, options) {
    let batch = normalizeUploadEntries(files);
    const opts = options || {};
    let directoryPaths = normalizeUploadDirectoryPaths(
      Object.prototype.hasOwnProperty.call(opts, "directories") ? opts.directories : state.uploadDirectories
    );
    if (state.uploadInFlight) {
      setAlert("warning", "이미 업로드가 진행 중입니다. 잠시만 기다려주세요.");
      return false;
    }
    if (!batch.length && !directoryPaths.length) {
      setAlert("warning", "먼저 업로드할 파일이나 폴더를 선택해주세요.");
      return false;
    }
    if (!batch.length) {
      return uploadDirectoryBatch(directoryPaths, opts);
    }

    try {
      const conflictPlan = await resolveUploadConflicts(batch, directoryPaths);
      if (!conflictPlan) {
        setAlert("info", "업로드를 취소했습니다.");
        return false;
      }
      batch = normalizeUploadEntries(conflictPlan.entries);
      directoryPaths = normalizeUploadDirectoryPaths(conflictPlan.directories);
      opts.overwritePaths = Array.from(new Set(
        Array.from(conflictPlan.overwritePaths || [])
          .map((value) => normalizeUploadRelativePath(value))
          .filter(Boolean)
      ));
    } catch (err) {
      setAlert("danger", err instanceof Error ? err.message : "업로드 충돌 확인에 실패했습니다.");
      return false;
    }

    if (!batch.length && !directoryPaths.length) {
      setAlert("warning", "모든 중복 항목을 건너뛰어 업로드할 대상이 없습니다.");
      return false;
    }

    const totalFileBytes = batch.reduce((sum, entry) => sum + Number(entry.size || 0), 0);
    const progressLabel = opts.label || (directoryPaths.length ? "폴더를 업로드하는 중..." : "파일을 업로드하는 중...");
    state.uploadInFlight = true;
    showUploadProgress(batch, progressLabel, { directories: directoryPaths });
    try {
      const formData = new FormData();
      formData.append("path", state.currentPath || "/");
      directoryPaths.forEach((directoryPath) => formData.append("directories", directoryPath));
      Array.from(opts.overwritePaths || []).forEach((overwritePath) => formData.append("overwrite_paths", overwritePath));
      batch.forEach((entry) => {
        formData.append("file_paths", entry.relativePath);
        formData.append("files", entry.file, entry.name);
      });
      const payload = await sendNasUploadRequest(formData, {
        onProgress(event) {
          if (!event) return;
          if (event.lengthComputable && event.total > 0 && totalFileBytes > 0) {
            const ratio = Math.max(0, Math.min(1, event.loaded / event.total));
            updateUploadProgress(Math.round(totalFileBytes * ratio), totalFileBytes);
            return;
          }
          updateUploadProgress(Math.min(Number(event.loaded || 0), totalFileBytes), totalFileBytes);
        },
        onTransferComplete() {
          markUploadProgressFinalizing(totalFileBytes);
        },
      });
      updateUploadProgress(totalFileBytes, totalFileBytes);
      setUploadProgressStage("complete");
      hideUploadProgress();
      const resultParts = [];
      if (payload.saved_count) resultParts.push(`파일 ${payload.saved_count}개 저장`);
      if (payload.created_directory_count) resultParts.push(`폴더 ${payload.created_directory_count}개 생성`);
      if (!resultParts.length) resultParts.push("처리 완료");
      const successText = `업로드 완료: ${resultParts.join(", ")}`;
      const skippedText = payload.skipped_count ? `, ${payload.skipped_count}개 건너뜀` : "";
      setAlert("success", successText + skippedText);
      const uploadedKeys = new Set(batch.map((entry) => entry.key || fileKey(entry)));
      const uploadedDirectories = new Set(directoryPaths);
      state.uploadFiles = state.uploadFiles.filter((entry) => !uploadedKeys.has(entry.key || fileKey(entry)));
      state.uploadDirectories = state.uploadDirectories.filter((directoryPath) => !uploadedDirectories.has(normalizeUploadRelativePath(directoryPath)));
      renderQueue();
      if (!opts.preserveInput && el.uploadInput) el.uploadInput.value = "";
      await loadFolder(state.currentPath || "/", { silent: true, keepAlert: true });
      return true;
    } catch (err) {
      hideUploadProgress();
      setAlert("danger", err instanceof Error ? err.message : "업로드에 실패했습니다.");
      return false;
    } finally {
      state.uploadInFlight = false;
      hideUploadProgress();
    }
  }

  async function uploadFiles() {
    return uploadFileBatch(state.uploadFiles, { directories: state.uploadDirectories });
  }

  async function readDirectoryEntries(reader) {
    const entries = [];
    while (reader && typeof reader.readEntries === "function") {
      const chunk = await new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (!chunk || !chunk.length) break;
      entries.push(...chunk);
    }
    return entries;
  }

  async function collectUploadEntriesFromWebkitEntry(entry, parentPath, bucket, directories) {
    if (!entry) return;
    const entryRelativePath = normalizeUploadRelativePath(String(entry.fullPath || "").replace(/^\/+/, ""));
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => {
        entry.file(resolve, reject);
      });
      const uploadEntry = buildUploadEntry(
        file,
        entryRelativePath || (parentPath ? `${parentPath}/${file.name}` : file.name)
      );
      if (uploadEntry) bucket.push(uploadEntry);
      return;
    }
    if (!entry.isDirectory) return;
    const directoryPath = entryRelativePath || normalizeUploadRelativePath(parentPath ? `${parentPath}/${entry.name}` : entry.name);
    if (directoryPath) directories.add(directoryPath);
    const children = await readDirectoryEntries(entry.createReader());
    for (const child of children) {
      await collectUploadEntriesFromWebkitEntry(child, directoryPath, bucket, directories);
    }
  }

  async function collectUploadEntriesFromHandle(handle, parentPath, bucket, directories) {
    if (!handle) return;
    if (handle.kind === "file") {
      const file = await handle.getFile();
      const uploadEntry = buildUploadEntry(file, parentPath ? `${parentPath}/${handle.name}` : handle.name);
      if (uploadEntry) bucket.push(uploadEntry);
      return;
    }
    if (handle.kind !== "directory" || typeof handle.values !== "function") return;
    const directoryPath = normalizeUploadRelativePath(parentPath ? `${parentPath}/${handle.name}` : handle.name);
    if (directoryPath) directories.add(directoryPath);
    for await (const childHandle of handle.values()) {
      await collectUploadEntriesFromHandle(childHandle, directoryPath, bucket, directories);
    }
  }

  async function extractDroppedUploadPayload(dataTransfer) {
    const directories = new Set();
    const collected = [];
    const fallbackFiles = Array.from(dataTransfer && dataTransfer.files || []);
    const items = Array.from(dataTransfer && dataTransfer.items || [])
      .filter((item) => item && item.kind === "file");
    let usedStructuredItems = false;

    for (const item of items) {
      if (typeof item.webkitGetAsEntry === "function") {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          usedStructuredItems = true;
          await collectUploadEntriesFromWebkitEntry(entry, "", collected, directories);
          continue;
        }
      }
      if (typeof item.getAsFileSystemHandle === "function") {
        try {
          const handle = await item.getAsFileSystemHandle();
          if (handle) {
            usedStructuredItems = true;
            await collectUploadEntriesFromHandle(handle, "", collected, directories);
            continue;
          }
        } catch (_) {
        }
      }
    }

    const normalizedStructuredEntries = normalizeUploadEntries(collected);
    const normalizedFallbackEntries = normalizeUploadEntries(fallbackFiles);
    const structuredDirectoryPaths = new Set(normalizeUploadDirectoryPaths(Array.from(directories)));
    const filteredFallbackEntries = normalizedFallbackEntries.filter((entry) => {
      const relativePath = normalizeUploadRelativePath(entry && (entry.relativePath || entry.name || ""));
      return relativePath && !structuredDirectoryPaths.has(relativePath);
    });
    const normalizedEntries = usedStructuredItems
      ? normalizedStructuredEntries
      : filteredFallbackEntries;
    return {
      directories: Array.from(directories),
      entries: normalizedEntries,
      used_structured_items: usedStructuredItems,
    };
  }

  async function handleDroppedUpload(dataTransfer, options) {
    const opts = options || {};
    let payload = null;
    setLoading(true, "업로드할 항목을 준비하는 중...");
    try {
      payload = await extractDroppedUploadPayload(dataTransfer);
    } catch (err) {
      setAlert("danger", err instanceof Error ? err.message : "드롭한 항목을 읽지 못했습니다.");
      return false;
    } finally {
      setLoading(false);
    }

    const entries = normalizeUploadEntries(payload && payload.entries);
    const directories = normalizeUploadDirectoryPaths(payload && payload.directories);
    if (!entries.length && !directories.length) {
      setAlert("warning", "업로드할 파일이나 폴더를 찾지 못했습니다.");
      return false;
    }
    if (!entries.length && directories.length) {
      showEmptyFolderNotice(directories);
      return false;
    }

    if (opts.autoUpload === false) {
      mergeUploadDirectories(directories);
      mergeUploadFiles(entries);
      return true;
    }

    return uploadFileBatch(entries, {
      directories,
      label: directories.length ? "폴더를 업로드하는 중..." : "파일을 업로드하는 중...",
      preserveInput: true,
    });
  }

  function configureNameEditor(mode, options) {
    const opts = options || {};
    const editorMode = mode === "rename" ? "rename" : "create";
    const isRename = editorMode === "rename";
    const currentPath = String(opts.currentPath || state.currentPath || "/").trim() || "/";
    const itemType = String(opts.type || "").trim();
    const itemLabel = itemType === "directory" ? "폴더" : "파일";
    const currentName = String(opts.currentName || "").trim();

    state.nameEditorMode = editorMode;
    state.nameEditorTargetPath = isRename ? String(opts.path || "").trim() : "";
    state.nameEditorTargetType = isRename ? itemType : "";

    if (el.nameEditorTitle) {
      el.nameEditorTitle.innerHTML = isRename
        ? `<i class="bi bi-pencil-square me-2"></i>${itemLabel} 이름 변경`
        : '<i class="bi bi-folder-plus me-2"></i>새 폴더 만들기';
    }
    if (el.nameEditorPathLabel) {
      el.nameEditorPathLabel.textContent = isRename ? "변경 위치" : "생성 위치";
    }
    if (el.newFolderPath) {
      el.newFolderPath.textContent = currentPath;
    }
    if (el.nameEditorInputLabel) {
      el.nameEditorInputLabel.textContent = isRename ? "새 이름" : "폴더 이름";
    }
    if (el.newFolderInput) {
      el.newFolderInput.value = isRename ? currentName : "";
      el.newFolderInput.placeholder = "예: 신규 프로젝트";
    }
    if (el.nameEditorHint) {
      el.nameEditorHint.textContent = "슬래시(/, \\\\) 없이 이름만 입력하면 됩니다.";
    }
    if (el.nameEditorConfirmIcon) {
      el.nameEditorConfirmIcon.className = isRename
        ? "bi bi-pencil-square me-1"
        : "bi bi-check2-circle me-1";
    }
    if (el.nameEditorConfirmText) {
      el.nameEditorConfirmText.textContent = isRename ? "이름 변경" : "폴더 생성";
    }
  }

  function openNewFolderModal() {
    configureNameEditor("create");
    if (newFolderModal) newFolderModal.show();
  }

  function openTrashModal() {
    if (trashModal) trashModal.show();
    loadTrash();
  }

  function resolveTrashTargets(target) {
    const paths = Array.isArray(target)
      ? Array.from(new Set(target.map((value) => String(value || "").trim()).filter(Boolean)))
      : [String(target || "").trim()].filter(Boolean);
    const items = paths.map((path) => findItem(path)).filter(Boolean);
    return { paths, items };
  }

  async function setPinnedState(target, pinned) {
    const { paths, items } = resolveTrashTargets(target);
    if (!paths.length || !items.length) {
      setAlert("warning", pinned ? "상단 고정할 대상을 찾지 못했습니다." : "상단 고정을 해제할 대상을 찾지 못했습니다.");
      return;
    }

    setLoading(true, pinned ? "상단 고정하는 중..." : "상단 고정을 해제하는 중...");
    try {
      const res = await fetch("/api/nas/pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(paths.length === 1 ? { path: paths[0], pinned } : { paths, pinned }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const payload = await res.json();
      hideContextMenu();
      await loadFolder(state.currentPath || "/", { silent: true, keepAlert: true });
      setSelectedPaths(paths, {
        primaryPath: paths[0] || "",
        primaryType: items[0]?.type || "",
      });
      if (items.length === 1) {
        setAlert("success", pinned
          ? `${items[0].name} 항목을 상단에 고정했습니다.`
          : `${items[0].name} 항목의 상단 고정을 해제했습니다.`);
      } else {
        setAlert("success", pinned
          ? `${payload.count || items.length}개 항목을 상단에 고정했습니다.`
          : `${payload.count || items.length}개 항목의 상단 고정을 해제했습니다.`);
      }
    } catch (err) {
      setAlert("danger", err instanceof Error ? err.message : (pinned ? "상단 고정에 실패했습니다." : "상단 고정 해제에 실패했습니다."));
    } finally {
      setLoading(false);
    }
  }

  function resetMarkEditor() {
    state.markEditorPaths = [];
    state.markEditorColor = "yellow";
    if (el.markTargetLabel) {
      el.markTargetLabel.textContent = "선택한 항목";
    }
    renderMarkColorOptions();
  }

  function openMarkModal(target) {
    const { paths, items } = resolveTrashTargets(target);
    if (!paths.length || !items.length) {
      setAlert("warning", "마킹할 대상을 찾지 못했습니다.");
      return;
    }

    const selectedColors = Array.from(new Set(items.map((item) => String(item.mark_color || "").trim()).filter(Boolean)));
    state.markEditorPaths = paths.slice();
    state.markEditorColor = selectedColors.length === 1 ? selectedColors[0] : "yellow";
    if (el.markTargetLabel) {
      el.markTargetLabel.textContent = items.length === 1
        ? `${items[0].name} 항목`
        : `선택한 ${items.length}개 항목`;
    }
    renderMarkColorOptions();
    if (markModal) {
      markModal.show();
    }
  }

  async function setMarkState(target, color) {
    const { paths, items } = resolveTrashTargets(target);
    const selectedColor = String(color || "").trim().toLowerCase();
    const isClear = !selectedColor;
    if (!paths.length || !items.length) {
      setAlert("warning", isClear ? "마킹을 해제할 대상을 찾지 못했습니다." : "마킹할 대상을 찾지 못했습니다.");
      return;
    }

    setLoading(true, isClear ? "마킹을 해제하는 중..." : "마킹을 적용하는 중...");
    try {
      const body = paths.length === 1
        ? (isClear ? { path: paths[0], clear: true } : { path: paths[0], color: selectedColor })
        : (isClear ? { paths, clear: true } : { paths, color: selectedColor });
      const res = await fetch("/api/nas/mark", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readError(res));
      const payload = await res.json();
      hideContextMenu();
      await loadFolder(state.currentPath || "/", { silent: true, keepAlert: true });
      setSelectedPaths(paths, {
        primaryPath: paths[0] || "",
        primaryType: items[0]?.type || "",
      });
      if (items.length === 1) {
        setAlert("success", isClear
          ? `${items[0].name} 항목의 마킹을 해제했습니다.`
          : `${items[0].name} 항목에 ${getMarkTone(payload.color)?.label || "마킹"} 색상을 적용했습니다.`);
      } else {
        setAlert("success", isClear
          ? `${payload.count || items.length}개 항목의 마킹을 해제했습니다.`
          : `${payload.count || items.length}개 항목에 마킹을 적용했습니다.`);
      }
    } catch (err) {
      setAlert("danger", err instanceof Error ? err.message : (isClear ? "마킹 해제에 실패했습니다." : "마킹 적용에 실패했습니다."));
    } finally {
      setLoading(false);
    }
  }

  function canMovePathsToDestination(paths, destinationPath) {
    const normalizedDestination = String(destinationPath || "").trim();
    if (!normalizedDestination) return false;
    return collapsePathSelection(paths).every((path) => {
      const normalizedPath = String(path || "").trim();
      return normalizedPath && normalizedPath !== normalizedDestination && !hasNasPathPrefix(normalizedDestination, normalizedPath);
    });
  }

  async function moveItemsToDirectory(paths, destinationPath) {
    const normalizedPaths = collapsePathSelection(Array.isArray(paths) ? paths : [paths]);
    const destination = String(destinationPath || "").trim();
    if (!normalizedPaths.length || !destination) {
      setAlert("warning", "이동할 항목이나 대상 폴더를 찾지 못했습니다.");
      return false;
    }
    if (!canMovePathsToDestination(normalizedPaths, destination)) {
      setAlert("warning", "폴더를 자기 자신 또는 하위 폴더 안으로 이동할 수 없습니다.");
      return false;
    }

    setLoading(true, "항목을 이동하는 중...");
    try {
      const res = await fetch("/api/nas/move", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(normalizedPaths.length === 1
          ? { path: normalizedPaths[0], destination }
          : { paths: normalizedPaths, destination }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const payload = await res.json();
      setSelectedPaths([]);
      await loadFolder(state.currentPath || "/", { silent: true, keepAlert: true });
      setAlert("success", normalizedPaths.length === 1
        ? `${payload.name || displayNameForPath(normalizedPaths[0])} 항목을 이동했습니다.`
        : `${payload.moved_count || normalizedPaths.length}개 항목을 이동했습니다.`);
      return true;
    } catch (err) {
      setAlert("danger", err instanceof Error ? err.message : "항목 이동에 실패했습니다.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  function resetTrashConfirmState() {
    state.pendingTrashPaths = [];
    state.pendingTrashItems = [];
    if (el.trashConfirmMessage) {
      el.trashConfirmMessage.textContent = "삭제할까요?";
    }
    if (el.trashConfirmMeta) {
      el.trashConfirmMeta.textContent = "예를 누르면 휴지통으로 이동합니다.";
    }
  }

  function resetDownloadConfirmState() {
    state.pendingDownloadPaths = [];
    if (el.downloadConfirmMessage) {
      el.downloadConfirmMessage.textContent = "다운로드할까요?";
    }
    if (el.downloadConfirmMeta) {
      el.downloadConfirmMeta.textContent = "확인을 누르면 다운로드를 시작합니다.";
    }
  }

  function openDownloadConfirm(target) {
    if (el.downloadConfirmModal && el.downloadConfirmModal.classList.contains("show")) return;
    const paths = normalizePathList(Array.isArray(target) ? target : [target]);
    const items = paths.map((path) => findItem(path)).filter(Boolean);
    if (!paths.length || !items.length) {
      setAlert("warning", "다운로드할 파일을 찾지 못했습니다.");
      return;
    }

    const confirmText = items.length === 1
      ? `${items[0].type === "directory" ? "폴더" : "파일"} "${items[0].name}" 을(를) 다운로드할까요?`
      : `선택한 항목 ${items.length}개를 다운로드할까요?`;
    const confirmMeta = items.length === 1
      ? `확인을 누르면 ${items[0].type === "directory" ? "폴더" : "파일"} "${items[0].name}" 다운로드를 시작합니다.`
      : `확인을 누르면 선택한 ${items.length}개 항목 다운로드를 시작합니다.`;

    state.pendingDownloadPaths = paths.slice();
    if (el.downloadConfirmMessage) {
      el.downloadConfirmMessage.textContent = confirmText;
    }
    if (el.downloadConfirmMeta) {
      el.downloadConfirmMeta.textContent = confirmMeta;
    }
    hideContextMenu();

    if (downloadConfirmModal) {
      downloadConfirmModal.show();
      return;
    }

    if (!window.confirm(confirmText)) {
      resetDownloadConfirmState();
      return;
    }
    void submitDownloadConfirm();
  }

  async function submitDownloadConfirm() {
    const paths = state.pendingDownloadPaths.slice();
    if (!paths.length) {
      if (downloadConfirmModal) downloadConfirmModal.hide();
      resetDownloadConfirmState();
      return;
    }

    if (downloadConfirmModal) {
      downloadConfirmModal.hide();
    }
    resetDownloadConfirmState();
    await downloadItems(paths);
  }

  function handleMobileRowActivation(path, type) {
    if (!isMobileNasInteraction()) {
      resetMobileTapState();
      return false;
    }

    const rowPath = String(path || "").trim();
    const rowType = String(type || "").trim();
    if (!rowPath || !rowType) {
      resetMobileTapState();
      return false;
    }

    const now = Date.now();
    const isDoubleTap = state.mobileTapPath === rowPath
      && state.mobileTapType === rowType
      && (now - Number(state.mobileTapAt || 0) <= MOBILE_DOUBLE_TAP_WINDOW_MS);

    state.mobileTapPath = rowPath;
    state.mobileTapType = rowType;
    state.mobileTapAt = now;

    if (!isDoubleTap) {
      return false;
    }

    resetMobileTapState();
    if (rowType === "directory") {
      loadFolder(rowPath);
      return true;
    }
    if (rowType === "file") {
      openDownloadConfirm(rowPath);
      return true;
    }
    return false;
  }

  function renameItem(path, type) {
    const item = findItem(path);
    if (!item) {
      setAlert("warning", "이름을 변경할 대상을 찾지 못했습니다.");
      return;
    }

    configureNameEditor("rename", {
      path,
      type: type || item.type || "",
      currentName: item.name || "",
      currentPath: state.currentPath || "/",
    });
    if (newFolderModal) newFolderModal.show();
  }

  function moveToTrash(target) {
    if (el.trashConfirmModal && el.trashConfirmModal.classList.contains("show")) return;
    const { paths, items } = resolveTrashTargets(target);
    if (!paths.length || !items.length) {
      setAlert("warning", "휴지통으로 이동할 대상을 찾지 못했습니다.");
      return;
    }

    const confirmText = items.length === 1
      ? `${items[0].type === "directory" ? "폴더" : "파일"} "${items[0].name}" 을(를) 삭제할까요?`
      : `선택한 항목 ${items.length}개를 삭제할까요?`;
    const confirmMeta = items.length === 1
      ? `예를 누르면 ${items[0].type === "directory" ? "폴더" : "파일"} "${items[0].name}" 이(가) 휴지통으로 이동합니다.`
      : `예를 누르면 선택한 ${items.length}개 항목이 휴지통으로 이동합니다.`;

    state.pendingTrashPaths = paths.slice();
    state.pendingTrashItems = items.map((item) => ({
      path: item.path,
      name: item.name,
      type: item.type,
    }));
    if (el.trashConfirmMessage) {
      el.trashConfirmMessage.textContent = confirmText;
    }
    if (el.trashConfirmMeta) {
      el.trashConfirmMeta.textContent = confirmMeta;
    }
    hideContextMenu();

    if (trashConfirmModal) {
      trashConfirmModal.show();
      return;
    }

    if (!window.confirm(confirmText)) {
      resetTrashConfirmState();
      return;
    }
    void submitTrashConfirm();
  }

  async function submitTrashConfirm() {
    const paths = state.pendingTrashPaths.slice();
    const items = state.pendingTrashItems.slice();
    if (!paths.length || !items.length) {
      if (trashConfirmModal) trashConfirmModal.hide();
      resetTrashConfirmState();
      return;
    }

    if (trashConfirmModal) {
      trashConfirmModal.hide();
    }
    resetTrashConfirmState();
    await moveToTrashConfirmed(paths, items);
  }

  async function moveToTrashConfirmed(paths, items) {
    setLoading(true, "휴지통으로 이동하는 중...");
    try {
      const res = await fetch("/api/nas/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(paths.length === 1 ? { path: paths[0] } : { paths }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const payload = await res.json();
      setSelectedPaths([]);
      hideContextMenu();
      if (items.length === 1) {
        setAlert("success", `${payload.original_name || items[0].name} 항목을 휴지통으로 이동했습니다.`);
      } else {
        setAlert("success", `${payload.moved_count || items.length}개 항목을 휴지통으로 이동했습니다.`);
      }
      await loadFolder(state.currentPath || "/", { silent: true, keepAlert: true });
      if (el.trashModal && el.trashModal.classList.contains("show")) {
        await loadTrash({ silent: true });
      }
    } catch (err) {
      setAlert("danger", err instanceof Error ? err.message : "휴지통 이동에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function restoreTrashItem(itemId) {
    setLoading(true, "휴지통 항목을 복원하는 중...");
    try {
      const res = await fetch("/api/nas/trash/restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ item_id: itemId }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const payload = await res.json();
      setAlert("success", `복원 완료: ${payload.path}`);
      await loadTrash({ silent: true });
      await loadFolder(state.currentPath || "/", { silent: true, keepAlert: true });
    } catch (err) {
      setAlert("danger", err instanceof Error ? err.message : "휴지통 복원에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function purgeTrashItem(itemId) {
    if (!window.confirm("이 항목을 휴지통에서 영구 삭제할까요?")) {
      return;
    }

    setLoading(true, "휴지통 항목을 영구 삭제하는 중...");
    try {
      const res = await fetch("/api/nas/trash/purge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ item_id: itemId }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setAlert("success", "휴지통 항목을 영구 삭제했습니다.");
      await loadTrash({ silent: true });
    } catch (err) {
      setAlert("danger", err instanceof Error ? err.message : "휴지통 영구 삭제에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function emptyTrash() {
    if (!window.confirm("휴지통을 모두 비울까요? 이 작업은 되돌릴 수 없습니다.")) {
      return;
    }

    setLoading(true, "휴지통을 비우는 중...");
    try {
      const res = await fetch("/api/nas/trash/empty", { method: "POST" });
      if (!res.ok) throw new Error(await readError(res));
      const payload = await res.json();
      setAlert("success", `휴지통 비우기 완료: ${payload.removed_count || 0}개 처리`);
      await loadTrash({ silent: true });
    } catch (err) {
      setAlert("danger", err instanceof Error ? err.message : "휴지통 비우기에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function resetNewFolderForm() {
    state.nameEditorMode = "create";
    state.nameEditorTargetPath = "";
    state.nameEditorTargetType = "";
    configureNameEditor("create");
  }

  async function submitNameEditor() {
    const name = String(el.newFolderInput && el.newFolderInput.value || "").trim();
    if (!name) {
      setAlert("warning", state.nameEditorMode === "rename" ? "새 이름을 입력해주세요." : "새 폴더 이름을 입력해주세요.");
      if (el.newFolderInput) el.newFolderInput.focus();
      return;
    }

    if (state.nameEditorMode === "rename") {
      const targetPath = state.nameEditorTargetPath || "";
      const targetType = state.nameEditorTargetType || "";
      const item = findItem(targetPath);
      if (!item || !targetPath) {
        setAlert("warning", "이름을 변경할 대상을 찾지 못했습니다.");
        return;
      }

      const currentName = String(item.name || "").trim();
      if (name === currentName) {
        if (newFolderModal) newFolderModal.hide();
        return;
      }

      setLoading(true, "이름을 변경하는 중...");
      try {
        const res = await fetch("/api/nas/rename", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path: targetPath, name }),
        });
        if (!res.ok) throw new Error(await readError(res));
        const payload = await res.json();
        if (newFolderModal) newFolderModal.hide();
        resetNewFolderForm();
        setAlert("success", `이름 변경 완료: ${payload.old_name || currentName} -> ${payload.name || name}`);
        await loadFolder(state.currentPath || "/", { silent: true, keepAlert: true });
        setSelectedPaths([payload.path], { primaryPath: payload.path, primaryType: payload.type || targetType || item.type || "" });
      } catch (err) {
        setAlert("danger", err instanceof Error ? err.message : "이름 변경에 실패했습니다.");
        if (el.newFolderInput) el.newFolderInput.focus();
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true, "새 폴더를 만드는 중...");
    try {
      const res = await fetch("/api/nas/mkdir", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: state.currentPath || "/",
          name,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const payload = await res.json();
      if (newFolderModal) newFolderModal.hide();
      resetNewFolderForm();
      setAlert("success", `폴더 생성 완료: ${payload.name}`);
      await loadFolder(state.currentPath || "/", { silent: true, keepAlert: true });
    } catch (err) {
      setAlert("danger", err instanceof Error ? err.message : "폴더 생성에 실패했습니다.");
      if (el.newFolderInput) el.newFolderInput.focus();
    } finally {
      setLoading(false);
    }
  }

  function onDropzoneDrag(active) {
    if (!el.dropzone) return;
    el.dropzone.classList.toggle("is-dragover", active);
  }

  function syncExplorerDropOverlayPosition() {
    if (!el.explorerDropTarget) return;
    const scrollTop = Math.max(Number(el.explorerDropTarget.scrollTop || 0), 0);
    el.explorerDropTarget.style.setProperty("--nas-drop-overlay-offset", `${scrollTop}px`);
  }

  function onExplorerDropDrag(active) {
    if (!el.explorerDropTarget) return;
    el.explorerDropTarget.classList.toggle("is-dragover", active);
    if (active) {
      syncExplorerDropOverlayPosition();
      return;
    }
    el.explorerDropTarget.style.setProperty("--nas-drop-overlay-offset", "0px");
  }

  function paintDragSourceRows() {
    if (!el.tableBody) return;
    const dragPaths = new Set(state.dragMovePaths);
    el.tableBody.querySelectorAll("tr[data-row-path]").forEach((row) => {
      const rowPath = row.getAttribute("data-row-path") || "";
      row.classList.toggle("is-drag-source", dragPaths.has(rowPath));
    });
  }

  function clearMoveDropTarget() {
    if (!el.tableBody) {
      state.dragMoveTargetPath = "";
      return;
    }
    if (state.dragMoveTargetPath) {
      const activeRow = el.tableBody.querySelector(`tr[data-row-path="${escapeSelectorValue(state.dragMoveTargetPath)}"]`);
      if (activeRow) activeRow.classList.remove("is-move-target");
    }
    state.dragMoveTargetPath = "";
  }

  function clearCrumbDropTarget() {
    const activeButton = state.dragMoveCrumbButton;
    if (activeButton && typeof activeButton.classList?.remove === "function") {
      activeButton.classList.remove("is-move-target");
    }
    state.dragMoveCrumbButton = null;
    state.dragMoveCrumbPath = "";
  }

  function setCrumbDropTarget(button) {
    if (!(button instanceof Element)) {
      clearCrumbDropTarget();
      return;
    }
    if (state.dragMoveCrumbButton === button) return;
    clearCrumbDropTarget();
    button.classList.add("is-move-target");
    state.dragMoveCrumbButton = button;
    state.dragMoveCrumbPath = button.getAttribute("data-path") || "";
  }

  function setMoveDropTarget(path) {
    const targetPath = String(path || "").trim();
    if (!el.tableBody) return;
    if (state.dragMoveTargetPath === targetPath) return;
    clearMoveDropTarget();
    if (!targetPath) return;
    const nextRow = el.tableBody.querySelector(`tr[data-row-path="${escapeSelectorValue(targetPath)}"]`);
    if (!nextRow) return;
    nextRow.classList.add("is-move-target");
    state.dragMoveTargetPath = targetPath;
  }

  function clearInternalDragState() {
    state.dragMovePaths = [];
    clearMoveDropTarget();
    clearCrumbDropTarget();
    paintDragSourceRows();
  }

  function isInternalNasDrag(dataTransfer) {
    if (state.dragMovePaths.length) return true;
    const types = Array.from(dataTransfer && dataTransfer.types || []);
    return types.includes(INTERNAL_NAS_DRAG_TYPE);
  }

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function ensureSelectionBand() {
    if (!el.explorerDropTarget) return null;
    if (el.selectionBand && el.selectionBand.isConnected) return el.selectionBand;
    const band = document.createElement("div");
    band.className = "nas-selection-band d-none";
    el.explorerDropTarget.appendChild(band);
    el.selectionBand = band;
    return band;
  }

  function showSelectionBand(top, bottom) {
    const band = ensureSelectionBand();
    if (!band || !el.explorerDropTarget) return;
    const height = Math.max(1, bottom - top);
    band.classList.remove("d-none");
    band.style.top = `${top}px`;
    band.style.left = "0px";
    band.style.width = `${Math.max(el.explorerDropTarget.scrollWidth, el.explorerDropTarget.clientWidth)}px`;
    band.style.height = `${height}px`;
  }

  function hideSelectionBand() {
    if (!el.selectionBand) return;
    el.selectionBand.classList.add("d-none");
  }

  function clientYToExplorerLocalY(clientY) {
    if (!el.explorerDropTarget) return 0;
    const rect = el.explorerDropTarget.getBoundingClientRect();
    const max = Math.max(el.explorerDropTarget.scrollHeight, el.explorerDropTarget.clientHeight);
    return clampNumber(clientY - rect.top + el.explorerDropTarget.scrollTop, 0, max);
  }

  function selectionPathsFromRange(startLocalY, endLocalY) {
    if (!el.explorerDropTarget || !el.tableBody) return [];
    const rect = el.explorerDropTarget.getBoundingClientRect();
    const top = Math.min(startLocalY, endLocalY);
    const bottom = Math.max(startLocalY, endLocalY);
    return Array.from(el.tableBody.querySelectorAll("tr[data-row-path]"))
      .filter((row) => {
        const rowRect = row.getBoundingClientRect();
        const rowTop = rowRect.top - rect.top + el.explorerDropTarget.scrollTop;
        const rowCenter = rowTop + (rowRect.height / 2);
        return rowCenter >= top && rowCenter <= bottom;
      })
      .map((row) => row.getAttribute("data-row-path") || "")
      .filter(Boolean);
  }

  function updateDragSelection() {
    if (!state.dragSelectActive) return;
    const currentLocalY = clientYToExplorerLocalY(state.dragSelectCurrentClientY);
    const top = Math.min(state.dragSelectStartLocalY, currentLocalY);
    const bottom = Math.max(state.dragSelectStartLocalY, currentLocalY);
    showSelectionBand(top, bottom);
    const rangePaths = selectionPathsFromRange(state.dragSelectStartLocalY, currentLocalY);
    const nextPaths = state.dragSelectToggleMode
      ? buildToggledPathList(state.dragSelectBasePaths, rangePaths)
      : rangePaths;
    const primaryPath = rangePaths[rangePaths.length - 1] || "";
    setSelectedPaths(nextPaths, {
      primaryPath: nextPaths.includes(primaryPath) ? primaryPath : "",
      primaryType: nextPaths.includes(primaryPath) ? (findItem(primaryPath)?.type || "") : "",
    });
  }

  function stopDragAutoScroll() {
    state.dragAutoScroll = 0;
    if (state.dragAutoScrollRaf) {
      window.cancelAnimationFrame(state.dragAutoScrollRaf);
      state.dragAutoScrollRaf = 0;
    }
  }

  function stepDragAutoScroll() {
    if (!state.dragSelectActive || !state.dragAutoScroll || !el.explorerDropTarget) {
      state.dragAutoScrollRaf = 0;
      return;
    }
    const container = el.explorerDropTarget;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const nextScrollTop = clampNumber(container.scrollTop + state.dragAutoScroll, 0, maxScrollTop);
    if (nextScrollTop !== container.scrollTop) {
      container.scrollTop = nextScrollTop;
      updateDragSelection();
    }
    state.dragAutoScrollRaf = window.requestAnimationFrame(stepDragAutoScroll);
  }

  function updateDragAutoScroll(clientY) {
    if (!el.explorerDropTarget) return;
    const rect = el.explorerDropTarget.getBoundingClientRect();
    const threshold = 56;
    let nextSpeed = 0;

    if (clientY > rect.bottom - threshold) {
      nextSpeed = Math.ceil(((clientY - (rect.bottom - threshold)) / threshold) * 18);
    } else if (clientY < rect.top + threshold) {
      nextSpeed = -Math.ceil((((rect.top + threshold) - clientY) / threshold) * 18);
    }

    state.dragAutoScroll = nextSpeed;
    if (!nextSpeed) {
      stopDragAutoScroll();
      return;
    }
    if (!state.dragAutoScrollRaf) {
      state.dragAutoScrollRaf = window.requestAnimationFrame(stepDragAutoScroll);
    }
  }

  function swallowNextDocumentClick() {
    let cleared = false;
    let timeoutId = 0;

    const clear = () => {
      if (cleared) return;
      cleared = true;
      document.removeEventListener("click", onClickCapture, true);
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };

    const onClickCapture = (event) => {
      clear();
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("click", onClickCapture, true);
    timeoutId = window.setTimeout(clear, 250);
  }

  function finishDragSelection(event) {
    const didRangeSelect = state.dragSelectActive && state.dragSelectStarted;
    if (didRangeSelect && event && typeof event.clientY === "number") {
      state.dragSelectCurrentClientY = event.clientY;
      updateDragSelection();
      paintSelectionRows();
      renderSelectionSummary();
      event.preventDefault();
    }

    state.dragSelectActive = false;
    state.dragSelectStarted = false;
    state.dragSelectBasePaths = [];
    state.dragSelectToggleMode = false;
    hideSelectionBand();
    stopDragAutoScroll();
    root.classList.remove("is-range-selecting");
    document.removeEventListener("mousemove", onDragSelectionMove, true);
    document.removeEventListener("mouseup", finishDragSelection, true);

    if (didRangeSelect) {
      swallowNextDocumentClick();
      window.requestAnimationFrame(() => {
        state.suppressRowClick = false;
      });
    }
  }

  function onDragSelectionMove(event) {
    if (!state.dragSelectActive) return;
    state.dragSelectCurrentClientY = event.clientY;
    const delta = Math.abs(clientYToExplorerLocalY(event.clientY) - state.dragSelectStartLocalY);
    if (!state.dragSelectStarted && delta < 4) {
      return;
    }

    if (!state.dragSelectStarted) {
      state.dragSelectStarted = true;
      state.suppressRowClick = true;
      root.classList.add("is-range-selecting");
    }

    updateDragSelection();
    updateDragAutoScroll(event.clientY);
    event.preventDefault();
  }

  function startDragSelection(event) {
    if (event.button !== 0 || !el.explorerDropTarget) return;
    if (event.target.closest(".btn, button, input, textarea, label, a")) return;
    if (event.target.closest("tr[data-row-path]")) return;
    if (!event.target.closest("#nasExplorerDropTarget")) return;

    focusExplorerSelectionScope();
    hideContextMenu();
    state.dragSelectActive = true;
    state.dragSelectStarted = false;
    state.dragSelectStartLocalY = clientYToExplorerLocalY(event.clientY);
    state.dragSelectCurrentClientY = event.clientY;
    state.dragSelectBasePaths = state.selectedPaths.slice();
    state.dragSelectToggleMode = isToggleModifier(event);
    document.addEventListener("mousemove", onDragSelectionMove, true);
    document.addEventListener("mouseup", finishDragSelection, true);
    event.preventDefault();
  }

  if (el.refreshBtn) {
    el.refreshBtn.addEventListener("click", () => loadFolder(state.currentPath || "/"));
  }

  if (el.explorerRefreshBtn) {
    el.explorerRefreshBtn.addEventListener("click", () => loadFolder(state.currentPath || "/"));
  }

  if (el.quickUploadBtn && el.uploadInput) {
    el.quickUploadBtn.addEventListener("click", () => el.uploadInput.click());
  }

  if (el.explorerQuickUploadBtn && el.uploadInput) {
    el.explorerQuickUploadBtn.addEventListener("click", () => el.uploadInput.click());
  }

  if (el.rootBtn) {
    el.rootBtn.addEventListener("click", () => loadFolder("/"));
  }

  if (el.paneRootBtn) {
    el.paneRootBtn.addEventListener("click", () => loadFolder("/"));
  }

  if (el.paneCurrentBtn) {
    el.paneCurrentBtn.addEventListener("click", () => loadFolder(state.currentPath || "/"));
  }

  if (el.trashBtn) {
    el.trashBtn.addEventListener("click", () => {
      openTrashModal();
    });
  }

  if (el.paneTrashShortcutBtn) {
    el.paneTrashShortcutBtn.addEventListener("click", () => {
      openTrashModal();
    });
  }

  if (el.newFolderBtn) {
    el.newFolderBtn.addEventListener("click", () => {
      openNewFolderModal();
    });
  }

  if (el.upBtn) {
    el.upBtn.addEventListener("click", () => {
      if (state.parentPath) loadFolder(state.parentPath);
    });
  }

  if (el.paneUpBtn) {
    el.paneUpBtn.addEventListener("click", () => {
      if (state.parentPath) loadFolder(state.parentPath);
    });
  }

  if (el.searchInput) {
    el.searchInput.addEventListener("input", () => renderItems());
  }

  if (el.uploadInput) {
    el.uploadInput.addEventListener("change", (event) => {
      mergeUploadFiles(event.target && event.target.files);
    });
  }

  if (el.dropzone && el.uploadInput) {
    el.dropzone.addEventListener("click", () => el.uploadInput.click());
    ["dragenter", "dragover"].forEach((type) => {
      el.dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        if (isInternalNasDrag(event.dataTransfer)) return;
        onDropzoneDrag(true);
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      el.dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        if (isInternalNasDrag(event.dataTransfer)) return;
        onDropzoneDrag(false);
      });
    });
    el.dropzone.addEventListener("drop", async (event) => {
      if (isInternalNasDrag(event.dataTransfer)) return;
      await handleDroppedUpload(event.dataTransfer, { autoUpload: true });
    });
  }

  if (el.explorerDropTarget) {
    el.explorerDropTarget.setAttribute("tabindex", "0");
    el.explorerDropTarget.addEventListener("mousedown", (event) => {
      if (event.target.closest(".btn, button, input, textarea, label, a")) return;
      focusExplorerSelectionScope();
    });
    el.explorerDropTarget.addEventListener("mousedown", startDragSelection);
    el.explorerDropTarget.addEventListener("dragenter", (event) => {
      event.preventDefault();
      if (isInternalNasDrag(event.dataTransfer)) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        return;
      }
      state.dropTargetDepth += 1;
      onExplorerDropDrag(true);
    });
    el.explorerDropTarget.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (isInternalNasDrag(event.dataTransfer)) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        return;
      }
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      syncExplorerDropOverlayPosition();
      onExplorerDropDrag(true);
    });
    el.explorerDropTarget.addEventListener("scroll", () => {
      if (el.explorerDropTarget.classList.contains("is-dragover")) {
        syncExplorerDropOverlayPosition();
      }
    }, { passive: true });
    el.explorerDropTarget.addEventListener("dragleave", (event) => {
      event.preventDefault();
      if (isInternalNasDrag(event.dataTransfer)) {
        return;
      }
      state.dropTargetDepth = Math.max(0, state.dropTargetDepth - 1);
      if (!state.dropTargetDepth || !el.explorerDropTarget.contains(event.relatedTarget)) {
        state.dropTargetDepth = 0;
        onExplorerDropDrag(false);
      }
    });
    el.explorerDropTarget.addEventListener("drop", async (event) => {
      event.preventDefault();
      if (isInternalNasDrag(event.dataTransfer)) {
        clearMoveDropTarget();
        return;
      }
      state.dropTargetDepth = 0;
      onExplorerDropDrag(false);
      await handleDroppedUpload(event.dataTransfer, { autoUpload: true });
    });
  }

  if (el.uploadBtn) {
    el.uploadBtn.addEventListener("click", uploadFiles);
  }

  if (el.createFolderConfirmBtn) {
    el.createFolderConfirmBtn.addEventListener("click", submitNameEditor);
  }

  if (el.trashConfirmConfirmBtn) {
    el.trashConfirmConfirmBtn.addEventListener("click", () => {
      submitTrashConfirm();
    });
  }

  if (el.downloadConfirmBtn) {
    el.downloadConfirmBtn.addEventListener("click", () => {
      submitDownloadConfirm();
    });
  }

  if (el.trashRefreshBtn) {
    el.trashRefreshBtn.addEventListener("click", () => loadTrash());
  }

  if (el.trashEmptyBtn) {
    el.trashEmptyBtn.addEventListener("click", emptyTrash);
  }

  if (el.newFolderModal) {
    el.newFolderModal.addEventListener("shown.bs.modal", () => {
      if (el.newFolderInput) {
        el.newFolderInput.focus();
        el.newFolderInput.select();
      }
    });
    el.newFolderModal.addEventListener("hidden.bs.modal", () => {
      resetNewFolderForm();
    });
  }

  if (el.markColorOptions) {
    el.markColorOptions.addEventListener("click", (event) => {
      const button = event.target.closest("[data-mark-color]");
      if (!button) return;
      const color = button.getAttribute("data-mark-color") || "yellow";
      state.markEditorColor = color;
      renderMarkColorOptions();
    });
  }

  if (el.markConfirmBtn) {
    el.markConfirmBtn.addEventListener("click", async () => {
      const targetPaths = state.markEditorPaths.slice();
      const color = state.markEditorColor;
      if (markModal) {
        markModal.hide();
      }
      await setMarkState(targetPaths, color);
    });
  }

  if (el.markModal) {
    el.markModal.addEventListener("hidden.bs.modal", () => {
      resetMarkEditor();
    });
  }

  if (el.duplicateSkipBtn) {
    el.duplicateSkipBtn.addEventListener("click", () => {
      resolveDuplicateConflictPending({
        action: "skip",
        applyAll: Boolean(el.duplicateApplyAll && el.duplicateApplyAll.checked),
      });
    });
  }

  if (el.duplicateOverwriteBtn) {
    el.duplicateOverwriteBtn.addEventListener("click", () => {
      resolveDuplicateConflictPending({
        action: "overwrite",
        applyAll: Boolean(el.duplicateApplyAll && el.duplicateApplyAll.checked),
      });
    });
  }

  if (el.duplicateCancelBtn) {
    el.duplicateCancelBtn.addEventListener("click", () => {
      resolveDuplicateConflictPending({ action: "cancel", applyAll: false });
    });
  }

  if (el.duplicateConflictModal) {
    el.duplicateConflictModal.addEventListener("hidden.bs.modal", () => {
      if (duplicateConflictPending) {
        const pending = duplicateConflictPending;
        duplicateConflictPending = null;
        pending.resolve({ action: "cancel", applyAll: false });
      }
    });
  }

  if (el.uploadProgressModal) {
    el.uploadProgressModal.addEventListener("shown.bs.modal", () => {
      if (el.uploadProgressModal.dataset.pendingHide === "true") {
        hideUploadProgress();
      }
    });
    el.uploadProgressModal.addEventListener("hidden.bs.modal", () => {
      forceHideUploadProgressModal();
    });
  }

  if (el.downloadConfirmModal) {
    el.downloadConfirmModal.addEventListener("shown.bs.modal", () => {
      if (el.downloadConfirmBtn) {
        el.downloadConfirmBtn.focus();
      }
    });
    el.downloadConfirmModal.addEventListener("hidden.bs.modal", () => {
      resetDownloadConfirmState();
    });
  }

  if (el.trashConfirmModal) {
    el.trashConfirmModal.addEventListener("shown.bs.modal", () => {
      if (el.trashConfirmConfirmBtn) {
        el.trashConfirmConfirmBtn.focus();
      }
    });
    el.trashConfirmModal.addEventListener("hidden.bs.modal", () => {
      resetTrashConfirmState();
    });
  }

  if (el.newFolderInput) {
    el.newFolderInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      submitNameEditor();
    });
  }

  if (el.trashModal) {
    el.trashModal.addEventListener("shown.bs.modal", () => {
      loadTrash();
    });
  }

  if (el.breadcrumbs) {
    el.breadcrumbs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action='crumb']");
      if (!button) return;
      loadFolder(button.getAttribute("data-path") || "/");
    });
  }

  if (el.paneLocation) {
    el.paneLocation.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action='crumb']");
      if (!button) return;
      loadFolder(button.getAttribute("data-path") || "/");
    });
    el.paneLocation.addEventListener("dragover", (event) => {
      if (!isInternalNasDrag(event.dataTransfer)) return;
      const button = event.target.closest("[data-action='crumb'][data-path]");
      if (!button) {
        clearCrumbDropTarget();
        return;
      }
      const targetPath = button.getAttribute("data-path") || "";
      if (!canMovePathsToDestination(state.dragMovePaths, targetPath)) {
        clearCrumbDropTarget();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setCrumbDropTarget(button);
    });
    el.paneLocation.addEventListener("dragleave", (event) => {
      if (!isInternalNasDrag(event.dataTransfer)) return;
      const button = event.target.closest("[data-action='crumb'][data-path]");
      if (!button) return;
      if (button.contains(event.relatedTarget)) return;
      if (state.dragMoveCrumbButton === button) {
        clearCrumbDropTarget();
      }
    });
    el.paneLocation.addEventListener("drop", async (event) => {
      if (!isInternalNasDrag(event.dataTransfer)) return;
      const button = event.target.closest("[data-action='crumb'][data-path]");
      clearCrumbDropTarget();
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const targetPath = button.getAttribute("data-path") || "";
      const dragPaths = collapsePathSelection(state.dragMovePaths);
      await moveItemsToDirectory(dragPaths, targetPath);
      clearInternalDragState();
    });
  }

  if (el.tableBody) {
    el.tableBody.addEventListener("dragstart", (event) => {
      const row = event.target.closest("tr[data-row-path]");
      if (!row || !event.dataTransfer) return;
      const path = row.getAttribute("data-row-path") || "";
      const type = row.getAttribute("data-row-type") || "";
      if (!path) {
        event.preventDefault();
        return;
      }
      focusExplorerSelectionScope();
      hideContextMenu();
      if (!isPathSelected(path)) {
        setSelectedItem(path, type);
      }
      const dragPaths = collapsePathSelection(isPathSelected(path) ? state.selectedPaths.slice() : [path]);
      if (!dragPaths.length) {
        event.preventDefault();
        return;
      }
      state.dragMovePaths = dragPaths.slice();
      clearMoveDropTarget();
      paintDragSourceRows();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(INTERNAL_NAS_DRAG_TYPE, JSON.stringify(dragPaths));
      event.dataTransfer.setData("text/plain", dragPaths.join("\n"));
    });

    el.tableBody.addEventListener("dragend", () => {
      clearInternalDragState();
    });

    el.tableBody.addEventListener("dragover", (event) => {
      const row = event.target.closest("tr[data-row-path]");
      if (!row || !isInternalNasDrag(event.dataTransfer)) return;
      const targetPath = row.getAttribute("data-row-path") || "";
      const targetType = row.getAttribute("data-row-type") || "";
      if (targetType !== "directory" || !canMovePathsToDestination(state.dragMovePaths, targetPath)) {
        clearMoveDropTarget();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setMoveDropTarget(targetPath);
    });

    el.tableBody.addEventListener("dragleave", (event) => {
      const row = event.target.closest("tr[data-row-path]");
      if (!row || !isInternalNasDrag(event.dataTransfer)) return;
      if (row.contains(event.relatedTarget)) return;
      const rowPath = row.getAttribute("data-row-path") || "";
      if (state.dragMoveTargetPath === rowPath) {
        clearMoveDropTarget();
      }
    });

    el.tableBody.addEventListener("drop", async (event) => {
      const row = event.target.closest("tr[data-row-path]");
      if (!row || !isInternalNasDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      const targetPath = row.getAttribute("data-row-path") || "";
      const targetType = row.getAttribute("data-row-type") || "";
      clearMoveDropTarget();
      if (targetType !== "directory") {
        clearInternalDragState();
        return;
      }
      const dragPaths = collapsePathSelection(state.dragMovePaths);
      await moveItemsToDirectory(dragPaths, targetPath);
      clearInternalDragState();
    });

    el.tableBody.addEventListener("click", (event) => {
      if (state.suppressRowClick) {
        state.suppressRowClick = false;
        event.preventDefault();
        return;
      }
      const row = event.target.closest("tr[data-row-path]");
      if (row) {
        const rowPath = row.getAttribute("data-row-path") || "";
        const rowType = row.getAttribute("data-row-type") || "";
        focusExplorerSelectionScope();
        if (isToggleModifier(event)) {
          toggleSelectedItem(rowPath, rowType);
          return;
        }
        setSelectedItem(rowPath, rowType);
        handleMobileRowActivation(rowPath, rowType);
      }
    });

    el.tableBody.addEventListener("dblclick", (event) => {
      if (isMobileNasInteraction()) return;
      if (state.suppressRowClick) return;
      if (isToggleModifier(event)) return;
      const row = event.target.closest("tr[data-row-path]");
      if (!row) return;
      const rowPath = row.getAttribute("data-row-path") || "/";
      const rowType = row.getAttribute("data-row-type") || "";
      focusExplorerSelectionScope();
      setSelectedItem(rowPath, rowType);
      if (rowType === "directory") {
        loadFolder(rowPath);
      }
    });

    el.tableBody.addEventListener("contextmenu", (event) => {
      const row = event.target.closest("tr[data-row-path]");
      if (!row) return;
      event.preventDefault();
      const path = row.getAttribute("data-row-path") || "";
      const type = row.getAttribute("data-row-type") || "";
      focusExplorerSelectionScope();
      const selectionPaths = isPathSelected(path) ? state.selectedPaths.slice() : [path];
      if (!isPathSelected(path)) {
        setSelectedItem(path, type);
      }
      showContextMenu(event.clientX, event.clientY, {
        path: selectionPaths.length === 1 ? path : "",
        type: selectionPaths.length === 1 ? type : "",
        selectionPaths,
      });
    });
  }

  if (el.uploadQueue) {
    el.uploadQueue.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action='remove-upload']");
      if (!button) return;
      const kind = button.getAttribute("data-kind") || "file";
      const key = button.getAttribute("data-key") || "";
      if (!key) return;
      if (kind === "directory") {
        const directoryPath = key.replace(/^dir:/, "");
        state.uploadDirectories = state.uploadDirectories.filter((value) => normalizeUploadRelativePath(value) !== directoryPath);
      } else {
        state.uploadFiles = state.uploadFiles.filter((entry) => (entry.key || fileKey(entry)) !== key);
      }
      renderQueue();
    });
  }

  if (el.trashTbody) {
    el.trashTbody.addEventListener("click", (event) => {
      const button = event.target.closest("[data-trash-action]");
      if (!button) return;
      const action = button.getAttribute("data-trash-action");
      const itemId = button.getAttribute("data-trash-id") || "";
      if (action === "restore") {
        restoreTrashItem(itemId);
      } else if (action === "purge") {
        purgeTrashItem(itemId);
      }
    });
  }

  if (el.browserShell) {
    el.browserShell.addEventListener("contextmenu", (event) => {
      if (event.target.closest("tr[data-row-path]")) return;
      if (event.target.closest(".modal")) return;
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, {
        path: "",
        type: "",
        selectionPaths: state.selectedPaths.slice(),
      });
    });
  }

  if (el.contextMenu) {
    el.contextMenu.addEventListener("click", (event) => {
      const button = event.target.closest("[data-menu-action]");
      if (!button) return;
      const action = button.getAttribute("data-menu-action");
      const targetPath = state.contextPath || state.selectedPath || "";
      const targetType = state.contextType || state.selectedType || "";
      const targetPaths = state.contextPaths.length
        ? state.contextPaths.slice()
        : (targetPath ? [targetPath] : state.selectedPaths.slice());
      hideContextMenu();

      if (action === "open" && targetPath && targetType === "directory") {
        loadFolder(targetPath);
      } else if (action === "download" && targetPaths.length) {
        downloadItems(targetPaths);
      } else if (action === "rename" && targetPath && targetType) {
        renameItem(targetPath, targetType);
      } else if (action === "pin-top" && targetPaths.length) {
        setPinnedState(targetPaths, true);
      } else if (action === "unpin-top" && targetPaths.length) {
        setPinnedState(targetPaths, false);
      } else if (action === "mark" && targetPaths.length) {
        openMarkModal(targetPaths);
      } else if (action === "unmark" && targetPaths.length) {
        setMarkState(targetPaths, "");
      } else if (action === "new-folder") {
        openNewFolderModal();
      } else if (action === "open-trash") {
        openTrashModal();
      } else if (action === "refresh") {
        loadFolder(state.currentPath || "/");
      } else if (action === "move-to-trash" && targetPaths.length) {
        moveToTrash(targetPaths);
      }
    });
  }

  document.addEventListener("mousedown", (event) => {
    if (event.target.closest("#nasExplorerDropTarget")) return;
    if (event.target.closest("#nasContextMenu")) return;
    clearExplorerSelectionScope();
  });

  document.addEventListener("click", (event) => {
    const insideContextMenu = Boolean(event.target.closest("#nasContextMenu"));

    if (el.contextMenu && !el.contextMenu.classList.contains("d-none") && !insideContextMenu) {
      hideContextMenu();
    }

    if (!state.selectedPaths.length || state.dragSelectActive || state.suppressRowClick) return;
    if (insideContextMenu) return;
    if (event.target.closest("tr[data-row-path]")) return;
    setSelectedPaths([]);
  });

  document.addEventListener("keydown", (event) => {
    if (event.target instanceof Element && event.target.closest(".modal.show")) {
      return;
    }

    if (isSelectAllShortcut(event) && shouldHandleExplorerShortcut(event)) {
      event.preventDefault();
      selectAllVisibleItems();
      return;
    }

    if (event.key === "Delete" && shouldHandleExplorerShortcut(event)) {
      if (!state.selectedPaths.length || state.dragSelectActive) return;
      event.preventDefault();
      moveToTrash(state.selectedPaths);
      return;
    }

    if (event.key === "Escape") {
      hideContextMenu();
    }
  });

  window.addEventListener("scroll", hideContextMenu, true);
  window.addEventListener("resize", () => {
    hideContextMenu();
    queueBrowserShellHeightSync();
  });

  if (el.sideCard && typeof ResizeObserver !== "undefined") {
    const sideCardObserver = new ResizeObserver(() => {
      queueBrowserShellHeightSync();
    });
    sideCardObserver.observe(el.sideCard);
  }

  ensureContextMenuLayer();
  renderMarkColorOptions();
  renderQueue();
  queueBrowserShellHeightSync();
  refreshDriveStatus().finally(() => loadFolder("/"));
})();
