(function () {
  const root = document.getElementById("nasPageRoot");
  if (!root) return;

  const state = {
    currentPath: "/",
    items: [],
    drive: null,
    uploadFiles: [],
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
    suppressRowClick: false,
    nameEditorMode: "create",
    nameEditorTargetPath: "",
    nameEditorTargetType: "",
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
  const trashModal = (el.trashModal && window.bootstrap)
    ? bootstrap.Modal.getOrCreateInstance(el.trashModal)
    : null;
  const desktopHeightQuery = window.matchMedia
    ? window.matchMedia("(min-width: 1200px)")
    : null;
  let shellSyncFrame = 0;

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

  function displayNameForPath(path) {
    const value = String(path || "/").trim() || "/";
    if (value === "/") return "루트";
    const parts = value.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "현재 폴더";
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

  function fileKey(file) {
    return `${file.name}|${file.size}|${file.lastModified}`;
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

  function showContextMenu(x, y, options) {
    if (!el.contextMenu) return;
    ensureContextMenuLayer();
    const opts = options || {};
    const selectionPaths = Array.isArray(opts.selectionPaths)
      ? Array.from(new Set(opts.selectionPaths.map((value) => String(value || "").trim()).filter(Boolean)))
      : [];

    state.contextPaths = selectionPaths.length
      ? selectionPaths
      : (opts.path ? [String(opts.path)] : []);
    state.contextPath = state.contextPaths.length === 1 ? state.contextPaths[0] : "";
    state.contextType = state.contextPath
      ? (opts.type || findItem(state.contextPath)?.type || "")
      : "";

    const isDir = state.contextPaths.length === 1 && state.contextType === "directory";
    const isFile = state.contextPaths.length === 1 && state.contextType === "file";

    setContextItemVisible("open", isDir);
    setContextItemVisible("download", isFile);
    setContextItemVisible("rename", Boolean(state.contextPath));
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

      return `
        <tr class="nas-file-row ${isSelected ? "is-selected" : ""}" data-row-path="${escapeHtml(item.path)}" data-row-type="${escapeHtml(item.type)}" data-row-name="${escapeHtml(item.name)}">
          <td class="ps-3">
            <div class="nas-file-primary">
              <span class="nas-file-icon"><i class="${fileIcon(item)}"></i></span>
              <div class="min-w-0">
                <div class="nas-file-name">${escapeHtml(item.name)}</div>
                <div class="nas-file-sub">${isDir ? "폴더" : (item.extension || "파일")}</div>
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

  function renderQueue() {
    if (!el.uploadQueue) return;
    if (!state.uploadFiles.length) {
      el.uploadQueue.innerHTML = '<div class="nas-upload-empty">선택된 파일이 없습니다.</div>';
      return;
    }
    el.uploadQueue.innerHTML = state.uploadFiles.map((file, index) => {
      return `
        <div class="nas-upload-chip">
          <div class="min-w-0">
            <div class="fw-semibold text-truncate">${escapeHtml(file.name)}</div>
            <div class="small text-secondary">${escapeHtml(formatBytes(file.size))}</div>
          </div>
          <button class="btn btn-sm btn-outline-danger" type="button" data-action="remove-upload" data-index="${index}">
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
    const next = Array.from(files || []);
    if (!next.length) return;
    const known = new Set(state.uploadFiles.map((file) => fileKey(file)));
    next.forEach((file) => {
      const key = fileKey(file);
      if (!known.has(key)) {
        known.add(key);
        state.uploadFiles.push(file);
      }
    });
    renderQueue();
  }

  async function uploadFileBatch(files, options) {
    const batch = Array.from(files || []);
    const opts = options || {};
    if (!batch.length) {
      setAlert("warning", "먼저 업로드할 파일을 선택해주세요.");
      return false;
    }

    const formData = new FormData();
    formData.append("path", state.currentPath || "/");
    batch.forEach((file) => formData.append("files", file, file.name));

    setLoading(true, "파일을 업로드하는 중...");
    try {
      const res = await fetch("/api/nas/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await readError(res));
      const payload = await res.json();
      const successText = `업로드 완료: ${payload.saved_count || 0}개 저장`;
      const skippedText = payload.skipped_count ? `, ${payload.skipped_count}개 건너뜀` : "";
      setAlert("success", successText + skippedText);
      const uploadedKeys = new Set(batch.map((file) => fileKey(file)));
      state.uploadFiles = state.uploadFiles.filter((file) => !uploadedKeys.has(fileKey(file)));
      renderQueue();
      if (!opts.preserveInput && el.uploadInput) el.uploadInput.value = "";
      await loadFolder(state.currentPath || "/", { silent: true, keepAlert: true });
      return true;
    } catch (err) {
      setAlert("danger", err instanceof Error ? err.message : "업로드에 실패했습니다.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function uploadFiles() {
    return uploadFileBatch(state.uploadFiles);
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

  async function moveToTrash(target) {
    const paths = Array.isArray(target)
      ? Array.from(new Set(target.map((value) => String(value || "").trim()).filter(Boolean)))
      : [String(target || "").trim()].filter(Boolean);
    const items = paths.map((path) => findItem(path)).filter(Boolean);

    if (!paths.length || !items.length) {
      setAlert("warning", "휴지통으로 이동할 대상을 찾지 못했습니다.");
      return;
    }

    const confirmText = items.length === 1
      ? `${items[0].type === "directory" ? "폴더" : "파일"} "${items[0].name}" 을(를) 휴지통으로 이동할까요?`
      : `선택한 항목 ${items.length}개를 휴지통으로 이동할까요?`;
    if (!window.confirm(confirmText)) {
      return;
    }

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

  function onExplorerDropDrag(active) {
    if (!el.explorerDropTarget) return;
    el.explorerDropTarget.classList.toggle("is-dragover", active);
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
    const selectedPaths = selectionPathsFromRange(state.dragSelectStartLocalY, currentLocalY);
    setSelectedPaths(selectedPaths, { primaryPath: selectedPaths[selectedPaths.length - 1] || "" });
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
    if (!event.target.closest("#nasExplorerDropTarget")) return;

    hideContextMenu();
    state.dragSelectActive = true;
    state.dragSelectStarted = false;
    state.dragSelectStartLocalY = clientYToExplorerLocalY(event.clientY);
    state.dragSelectCurrentClientY = event.clientY;
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
        onDropzoneDrag(true);
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      el.dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        onDropzoneDrag(false);
      });
    });
    el.dropzone.addEventListener("drop", (event) => {
      const files = event.dataTransfer && event.dataTransfer.files;
      mergeUploadFiles(files);
    });
  }

  if (el.explorerDropTarget) {
    el.explorerDropTarget.addEventListener("mousedown", startDragSelection);
    el.explorerDropTarget.addEventListener("dragenter", (event) => {
      event.preventDefault();
      state.dropTargetDepth += 1;
      onExplorerDropDrag(true);
    });
    el.explorerDropTarget.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      onExplorerDropDrag(true);
    });
    el.explorerDropTarget.addEventListener("dragleave", (event) => {
      event.preventDefault();
      state.dropTargetDepth = Math.max(0, state.dropTargetDepth - 1);
      if (!state.dropTargetDepth || !el.explorerDropTarget.contains(event.relatedTarget)) {
        state.dropTargetDepth = 0;
        onExplorerDropDrag(false);
      }
    });
    el.explorerDropTarget.addEventListener("drop", async (event) => {
      event.preventDefault();
      state.dropTargetDepth = 0;
      onExplorerDropDrag(false);
      const files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) return;
      mergeUploadFiles(files);
      await uploadFileBatch(files, { preserveInput: true });
    });
  }

  if (el.uploadBtn) {
    el.uploadBtn.addEventListener("click", uploadFiles);
  }

  if (el.createFolderConfirmBtn) {
    el.createFolderConfirmBtn.addEventListener("click", submitNameEditor);
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
  }

  if (el.tableBody) {
    el.tableBody.addEventListener("click", (event) => {
      if (state.suppressRowClick) {
        state.suppressRowClick = false;
        event.preventDefault();
        return;
      }
      const row = event.target.closest("tr[data-row-path]");
      if (row) {
        setSelectedItem(row.getAttribute("data-row-path") || "", row.getAttribute("data-row-type") || "");
      }

      if (!row) return;
      const rowPath = row.getAttribute("data-row-path") || "/";
      const rowType = row.getAttribute("data-row-type") || "";
      if (rowType === "directory") {
        loadFolder(rowPath);
      } else if (rowType === "file") {
        window.location.href = `/api/nas/download?path=${encodeURIComponent(rowPath)}`;
      }
    });

    el.tableBody.addEventListener("contextmenu", (event) => {
      const row = event.target.closest("tr[data-row-path]");
      if (!row) return;
      event.preventDefault();
      const path = row.getAttribute("data-row-path") || "";
      const type = row.getAttribute("data-row-type") || "";
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
      const index = Number(button.getAttribute("data-index"));
      if (!Number.isFinite(index)) return;
      state.uploadFiles.splice(index, 1);
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
      } else if (action === "download" && targetPath && targetType === "file") {
        window.location.href = `/api/nas/download?path=${encodeURIComponent(targetPath)}`;
      } else if (action === "rename" && targetPath && targetType) {
        renameItem(targetPath, targetType);
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
  renderQueue();
  queueBrowserShellHeightSync();
  refreshDriveStatus().finally(() => loadFolder("/"));
})();
