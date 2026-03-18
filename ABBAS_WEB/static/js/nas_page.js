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
    selectedPath: "",
    selectedType: "",
    contextPath: "",
    contextType: "",
    trashItems: [],
    dropTargetDepth: 0,
  };

  const el = {
    browserShell: root.querySelector(".nas-browser-shell"),
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
    paneDriveLabel: document.getElementById("nasPaneDriveLabel"),
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
    newFolderPath: document.getElementById("nasFolderCreatePath"),
    newFolderInput: document.getElementById("nasNewFolderInput"),
    createFolderConfirmBtn: document.getElementById("nasCreateFolderConfirmBtn"),
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

  function setSelectedItem(path, type) {
    state.selectedPath = path || "";
    state.selectedType = type || "";
    renderItems();
    renderSelectionSummary();
  }

  function renderSelectionSummary() {
    if (!el.selectionText) return;
    const selected = findItem(state.selectedPath);
    if (!selected) {
      el.selectionText.textContent = "선택된 항목 없음";
      return;
    }

    const label = selected.type === "directory"
      ? `폴더 선택: ${selected.name}`
      : `파일 선택: ${selected.name} · ${selected.size_label || "-"}`;
    el.selectionText.textContent = label;
  }

  function hideContextMenu() {
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
    state.contextPath = opts.path || "";
    state.contextType = opts.type || "";

    const isDir = state.contextType === "directory";
    const isFile = state.contextType === "file";

    setContextItemVisible("open", isDir);
    setContextItemVisible("download", isFile);
    setContextItemVisible("move-to-trash", Boolean(state.contextPath));
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
    state.drive = drive || null;
    const statusLabel = drive ? "연결됨" : "미연결";
    if (el.driveStatus) {
      el.driveStatus.className = drive
        ? "badge rounded-pill text-bg-success-subtle border border-success-subtle text-success-emphasis"
        : "badge rounded-pill text-bg-danger-subtle border border-danger-subtle text-danger-emphasis";
      el.driveStatus.textContent = statusLabel;
    }

    const label = (drive && drive.label) || root.dataset.modelHint || "NAS";
    if (el.driveLabel) el.driveLabel.textContent = label;
    if (el.heroLabel) el.heroLabel.textContent = label;
    if (el.paneDriveLabel) el.paneDriveLabel.textContent = label;
    if (el.paneStatusMirror) el.paneStatusMirror.textContent = label;
    if (el.mountPath) el.mountPath.textContent = (drive && drive.mount_path) || "-";
    if (el.diskDevice) el.diskDevice.textContent = (drive && (drive.mount_device || drive.disk_device)) || "-";
    if (el.transport) el.transport.textContent = ((drive && drive.transport) || "-").toUpperCase();
    if (el.serial) el.serial.textContent = (drive && drive.serial) || "-";
    if (el.usageText) el.usageText.textContent = drive ? `${drive.usage_percent}% 사용 중` : "-";
    if (el.usageBar) el.usageBar.style.width = drive ? `${drive.usage_percent || 0}%` : "0%";
    if (el.usedText) el.usedText.textContent = (drive && drive.used_label) || "-";
    if (el.freeText) el.freeText.textContent = (drive && drive.free_label) || "-";
    if (el.totalText) el.totalText.textContent = (drive && drive.total_label) || "-";
    if (el.heroCapacity) el.heroCapacity.textContent = (drive && drive.total_label) || "-";
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
    const selectedVisible = items.some((item) => item.path === state.selectedPath);
    if (!selectedVisible) {
      state.selectedPath = "";
      state.selectedType = "";
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
      return;
    }

    el.emptyState.classList.add("d-none");
    el.tableBody.innerHTML = items.map((item) => {
      const isDir = item.type === "directory";
      const isSelected = state.selectedPath === item.path;

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

    renderSelectionSummary();
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
    if (!state.items.some((item) => item.path === state.selectedPath)) {
      state.selectedPath = "";
      state.selectedType = "";
    }
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
      renderDrive(null);
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

  function openNewFolderModal() {
    resetNewFolderForm();
    if (newFolderModal) newFolderModal.show();
  }

  function openTrashModal() {
    if (trashModal) trashModal.show();
    loadTrash();
  }

  async function moveToTrash(path) {
    const item = findItem(path);
    if (!item) {
      setAlert("warning", "휴지통으로 이동할 대상을 찾지 못했습니다.");
      return;
    }
    const label = item.type === "directory" ? "폴더" : "파일";
    if (!window.confirm(`${label} "${item.name}" 을(를) 휴지통으로 이동할까요?`)) {
      return;
    }

    setLoading(true, "휴지통으로 이동하는 중...");
    try {
      const res = await fetch("/api/nas/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const payload = await res.json();
      if (state.selectedPath === path) {
        state.selectedPath = "";
        state.selectedType = "";
      }
      hideContextMenu();
      setAlert("success", `${payload.original_name || item.name} 항목을 휴지통으로 이동했습니다.`);
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
    if (el.newFolderInput) el.newFolderInput.value = "";
    if (el.newFolderPath) el.newFolderPath.textContent = state.currentPath || "/";
  }

  async function createFolder() {
    const name = String(el.newFolderInput && el.newFolderInput.value || "").trim();
    if (!name) {
      setAlert("warning", "새 폴더 이름을 입력해주세요.");
      if (el.newFolderInput) el.newFolderInput.focus();
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
      resetNewFolderForm();
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
    el.createFolderConfirmBtn.addEventListener("click", createFolder);
  }

  if (el.trashRefreshBtn) {
    el.trashRefreshBtn.addEventListener("click", () => loadTrash());
  }

  if (el.trashEmptyBtn) {
    el.trashEmptyBtn.addEventListener("click", emptyTrash);
  }

  if (el.newFolderModal) {
    el.newFolderModal.addEventListener("shown.bs.modal", () => {
      resetNewFolderForm();
      if (el.newFolderInput) el.newFolderInput.focus();
    });
    el.newFolderModal.addEventListener("hidden.bs.modal", () => {
      resetNewFolderForm();
    });
  }

  if (el.newFolderInput) {
    el.newFolderInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      createFolder();
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
      setSelectedItem(path, type);
      showContextMenu(event.clientX, event.clientY, { path, type });
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
      showContextMenu(event.clientX, event.clientY, { path: "", type: "" });
    });
  }

  if (el.contextMenu) {
    el.contextMenu.addEventListener("click", (event) => {
      const button = event.target.closest("[data-menu-action]");
      if (!button) return;
      const action = button.getAttribute("data-menu-action");
      const targetPath = state.contextPath || state.selectedPath || "";
      const targetType = state.contextType || state.selectedType || "";
      hideContextMenu();

      if (action === "open" && targetPath && targetType === "directory") {
        loadFolder(targetPath);
      } else if (action === "download" && targetPath && targetType === "file") {
        window.location.href = `/api/nas/download?path=${encodeURIComponent(targetPath)}`;
      } else if (action === "new-folder") {
        openNewFolderModal();
      } else if (action === "open-trash") {
        openTrashModal();
      } else if (action === "refresh") {
        loadFolder(state.currentPath || "/");
      } else if (action === "move-to-trash" && targetPath) {
        moveToTrash(targetPath);
      }
    });
  }

  document.addEventListener("click", (event) => {
    if (!el.contextMenu || el.contextMenu.classList.contains("d-none")) return;
    if (event.target.closest("#nasContextMenu")) return;
    hideContextMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideContextMenu();
    }
  });

  window.addEventListener("scroll", hideContextMenu, true);
  window.addEventListener("resize", hideContextMenu);

  ensureContextMenuLayer();
  renderQueue();
  loadFolder("/");
})();
