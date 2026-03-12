(function () {
  const root = document.getElementById("firmwareManageRoot");
  if (!root) return;

  const state = {
    payload: null,
    selectedReleaseId: 0,
    filter: "",
  };

  const $id = (id) => document.getElementById(id);
  const els = {
    releaseCount: $id("fwReleaseCount"),
    deviceCount: $id("fwDeviceCount"),
    assignedCount: $id("fwAssignedCount"),
    failureCount: $id("fwFailureCount"),
    releaseTbody: $id("fwReleaseTbody"),
    deviceTbody: $id("fwDeviceTbody"),
    selectedReleaseText: $id("fwSelectedReleaseText"),
    deleteBtn: $id("fwDeleteBtn"),
    refreshBtn: $id("fwRefreshBtn"),
    assignBtn: $id("fwAssignBtn"),
    clearBtn: $id("fwClearTargetBtn"),
    filterInput: $id("fwDeviceFilter"),
    releaseSelectAll: $id("fwSelectAllReleases"),
    selectAll: $id("fwSelectAllDevices"),
    uploadForm: $id("firmwareUploadForm"),
    familyInput: $id("fwFamily"),
    versionInput: $id("fwVersion"),
    buildInput: $id("fwBuildId"),
    notesInput: $id("fwNotes"),
    fileInput: $id("fwFile"),
    forceInput: $id("fwForceUpdate"),
  };

  const defaultFamily = String(root.getAttribute("data-default-family") || "").trim();

  function escHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatBytes(bytes) {
    const num = Number(bytes || 0);
    if (!Number.isFinite(num) || num <= 0) return "-";
    if (num >= 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(2)} MB`;
    if (num >= 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${num} B`;
  }

  function shortHash(value) {
    const text = String(value || "").trim();
    if (!text) return "-";
    return `${text.slice(0, 12)}...`;
  }

  function stateBadgeHtml(value) {
    const stateText = String(value || "idle").trim().toLowerCase();
    let klass = "text-bg-light border";
    if (stateText === "success" || stateText === "up_to_date" || stateText === "idle") {
      klass = "text-bg-success-subtle border border-success-subtle text-success-emphasis";
    } else if (stateText === "pending_user") {
      klass = "text-bg-info-subtle border border-info-subtle text-info-emphasis";
    } else if (stateText === "approved") {
      klass = "text-bg-primary-subtle border border-primary-subtle text-primary-emphasis";
    } else if (stateText === "available" || stateText === "downloading" || stateText === "applying" || stateText === "rebooting") {
      klass = "text-bg-warning-subtle border border-warning-subtle text-warning-emphasis";
    } else if (stateText === "skipped") {
      klass = "text-bg-secondary-subtle border border-secondary-subtle text-secondary-emphasis";
    } else if (stateText === "failed" || stateText === "error") {
      klass = "text-bg-danger-subtle border border-danger-subtle text-danger-emphasis";
    }
    return `<span class="badge ${klass}">${escHtml(stateText || "idle")}</span>`;
  }

  function releaseLabel(row) {
    if (!row) return "선택된 릴리스 없음";
    const family = String(row.family || "").trim();
    const version = String(row.version || "").trim();
    const build = String(row.build_id || "").trim();
    return `${family} ${version}${build ? ` (${build})` : ""}`;
  }

  function getSelectedRelease() {
    const releases = (state.payload && state.payload.releases) || [];
    return releases.find((row) => Number(row.id || 0) === Number(state.selectedReleaseId || 0)) || null;
  }

  function renderSummary(summary) {
    summary = summary || {};
    if (els.releaseCount) els.releaseCount.textContent = String(summary.release_count || 0);
    if (els.deviceCount) els.deviceCount.textContent = String(summary.device_count || 0);
    if (els.assignedCount) els.assignedCount.textContent = String(summary.assigned_count || 0);
    if (els.failureCount) els.failureCount.textContent = String(summary.failure_count || 0);
  }

  function renderReleases(releases) {
    const rows = Array.isArray(releases) ? releases : [];
    if (!rows.length) {
      state.selectedReleaseId = 0;
      if (els.releaseTbody) {
        els.releaseTbody.innerHTML = '<tr><td colspan="10" class="text-center text-secondary py-4">등록된 릴리스가 없습니다.</td></tr>';
      }
      if (els.selectedReleaseText) {
        els.selectedReleaseText.textContent = "선택된 릴리스 없음";
      }
      if (els.releaseSelectAll) {
        els.releaseSelectAll.checked = false;
      }
      return;
    }

    const hasSelected = rows.some((row) => Number(row.id || 0) === Number(state.selectedReleaseId || 0));
    if (!hasSelected) {
      state.selectedReleaseId = Number(rows[0].id || 0);
    }

    if (els.releaseTbody) {
      els.releaseTbody.innerHTML = rows.map((row) => {
        const rid = Number(row.id || 0);
        const checked = rid === Number(state.selectedReleaseId || 0) ? "checked" : "";
        return '' +
          `<tr class="fw-release-row" data-release-id="${rid}">` +
            `<td class="ps-3"><input class="fwReleaseDeleteCheck" type="checkbox" value="${rid}"></td>` +
            `<td class="ps-3"><input type="radio" name="selectedRelease" value="${rid}" ${checked}></td>` +
            `<td>${escHtml(row.family || "-")}</td>` +
            `<td>${escHtml(row.version || "-")}</td>` +
            `<td>${escHtml(row.build_id || "-")}</td>` +
            `<td>${escHtml(row.filename || "-")}</td>` +
            `<td>${escHtml(formatBytes(row.size_bytes))}</td>` +
            `<td><code>${escHtml(shortHash(row.sha256))}</code></td>` +
            `<td>${row.force_update ? '<span class="badge text-bg-danger-subtle border border-danger-subtle text-danger-emphasis">force</span>' : '<span class="badge text-bg-light border">normal</span>'}</td>` +
            `<td class="pe-3">${escHtml(row.created_at || "-")}</td>` +
          `</tr>`;
      }).join("");
    }

    if (els.releaseSelectAll) {
      els.releaseSelectAll.checked = false;
    }

    if (els.selectedReleaseText) {
      els.selectedReleaseText.textContent = releaseLabel(getSelectedRelease());
    }
  }

  function deviceMatchesFilter(row) {
    if (!state.filter) return true;
    const haystack = [
      row.device_name,
      row.device_id,
      row.customer,
      row.current_fw_text,
      row.current_version,
      row.target_version,
    ].join(" ").toLowerCase();
    return haystack.includes(state.filter);
  }

  function renderDevices(devices) {
    const rows = (Array.isArray(devices) ? devices : []).filter(deviceMatchesFilter);
    if (!rows.length) {
      if (els.deviceTbody) {
        els.deviceTbody.innerHTML = '<tr><td colspan="8" class="text-center text-secondary py-4">표시할 장비가 없습니다.</td></tr>';
      }
      return;
    }

    if (els.deviceTbody) {
      els.deviceTbody.innerHTML = rows.map((row) => {
        const targetText = Number(row.target_release_id || 0) > 0
          ? `${escHtml(row.target_family || "")} ${escHtml(row.target_version || "")}${row.target_build_id ? ` (${escHtml(row.target_build_id)})` : ""}`
          : "-";
        const message = String(row.ota_message || "").trim();
        return '' +
          `<tr data-device-id="${escHtml(row.device_id || "")}">` +
            `<td class="ps-3"><input class="fwDeviceCheck" type="checkbox" value="${escHtml(row.device_id || "")}"></td>` +
            `<td><div class="fw-semibold">${escHtml(row.device_name || "-")}</div><div class="small text-secondary">${escHtml(row.customer || "-")}</div></td>` +
            `<td><code>${escHtml(row.device_id || "-")}</code></td>` +
            `<td><div>${escHtml(row.current_fw_text || "-")}</div><div class="small text-secondary">${escHtml(row.ip || "")}</div></td>` +
            `<td>${targetText}</td>` +
            `<td>${stateBadgeHtml(row.ota_state)}${message ? `<div class="small text-secondary mt-1">${escHtml(message)}</div>` : ""}</td>` +
            `<td>${escHtml(row.last_check_at || "-")}</td>` +
            `<td class="pe-3">${escHtml(row.last_report_at || "-")}</td>` +
          `</tr>`;
      }).join("");
    }
  }

  function renderAll() {
    const payload = state.payload || {};
    renderSummary(payload.summary || {});
    renderReleases(payload.releases || []);
    renderDevices(payload.devices || []);
  }

  function getCheckedDeviceIds() {
    return Array.from(document.querySelectorAll(".fwDeviceCheck:checked"))
      .map((el) => String(el.value || "").trim())
      .filter(Boolean);
  }

  function getCheckedReleaseIds() {
    return Array.from(document.querySelectorAll(".fwReleaseDeleteCheck:checked"))
      .map((el) => Number(el.value || 0))
      .filter((value) => Number.isFinite(value) && value > 0);
  }

  function getCheckedReleaseRows() {
    const releaseIds = new Set(getCheckedReleaseIds());
    const releases = (state.payload && state.payload.releases) || [];
    return releases.filter((row) => releaseIds.has(Number(row.id || 0)));
  }

  function buildDeleteReleaseListHtml(releases) {
    const rows = Array.isArray(releases) ? releases : [];
    return rows.map((row, index) => {
      const label = releaseLabel(row);
      const filename = String(row.filename || "-").trim() || "-";
      const sizeText = formatBytes(row.size_bytes);
      return '' +
        `<div class="${index > 0 ? 'border-top pt-2 mt-2' : ''}">` +
          `<div><strong>${escHtml(label)}</strong></div>` +
          `<div class="text-secondary">${escHtml(filename)}</div>` +
          `<div class="text-secondary">크기: ${escHtml(sizeText)}</div>` +
        `</div>`;
    }).join("");
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options || {});
    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }
    if (!response.ok) {
      throw new Error(String(data.detail || `HTTP ${response.status}`));
    }
    return data;
  }

  async function loadPayload() {
    if (window.AppUI && window.AppUI.showLoading) window.AppUI.showLoading("펌웨어 관리 데이터를 불러오는 중...");
    try {
      const payload = await fetchJson("/api/firmware/payload", { cache: "no-store" });
      state.payload = payload;
      renderAll();
    } finally {
      if (window.AppUI && window.AppUI.hideLoading) window.AppUI.hideLoading();
    }
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!els.uploadForm) return;
    const fd = new FormData(els.uploadForm);
    if (els.forceInput && els.forceInput.checked) fd.set("force_update", "1");
    else fd.set("force_update", "0");

    if (window.AppUI && window.AppUI.showLoading) window.AppUI.showLoading("펌웨어 업로드 중...");
    try {
      const payload = await fetchJson("/api/firmware/releases", {
        method: "POST",
        body: fd,
      });
      const release = payload.release || {};
      alert(`릴리스 업로드 완료: ${releaseLabel(release)}`);
      if (els.uploadForm) els.uploadForm.reset();
      if (els.familyInput) els.familyInput.value = defaultFamily;
      state.selectedReleaseId = Number(release.id || 0);
      await loadPayload();
    } catch (error) {
      alert(`업로드 실패: ${error.message}`);
    } finally {
      if (window.AppUI && window.AppUI.hideLoading) window.AppUI.hideLoading();
    }
  }

  async function handleAssign() {
    const release = getSelectedRelease();
    if (!release) {
      alert("먼저 릴리스를 선택하세요.");
      return;
    }
    const deviceIds = getCheckedDeviceIds();
    if (!deviceIds.length) {
      alert("배정할 장비를 선택하세요.");
      return;
    }
    if (!window.confirm(`${deviceIds.length}대 장비에 ${releaseLabel(release)} 릴리스를 배정합니다.`)) {
      return;
    }

    if (window.AppUI && window.AppUI.showLoading) window.AppUI.showLoading("릴리스를 장비에 배정하는 중...");
    try {
      await fetchJson(`/api/firmware/releases/${Number(release.id || 0)}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_ids: deviceIds }),
      });
      await loadPayload();
    } catch (error) {
      alert(`배정 실패: ${error.message}`);
    } finally {
      if (window.AppUI && window.AppUI.hideLoading) window.AppUI.hideLoading();
    }
  }

  async function handleClearTargets() {
    const deviceIds = getCheckedDeviceIds();
    if (!deviceIds.length) {
      alert("배정 해제할 장비를 선택하세요.");
      return;
    }
    if (!window.confirm(`${deviceIds.length}대 장비의 목표 릴리스를 해제합니다.`)) {
      return;
    }

    if (window.AppUI && window.AppUI.showLoading) window.AppUI.showLoading("장비 배정을 해제하는 중...");
    try {
      await fetchJson("/api/firmware/devices/clear-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_ids: deviceIds }),
      });
      await loadPayload();
    } catch (error) {
      alert(`배정 해제 실패: ${error.message}`);
    } finally {
      if (window.AppUI && window.AppUI.hideLoading) window.AppUI.hideLoading();
    }
  }

  async function handleDeleteReleases() {
    const releases = getCheckedReleaseRows();
    if (!releases.length) {
      if (window.Swal) {
        await Swal.fire({ icon: "warning", title: "삭제할 릴리스 없음", text: "삭제할 릴리스를 선택하세요." });
      } else {
        alert("삭제할 릴리스를 선택하세요.");
      }
      return;
    }

    let confirmed = true;
    if (window.Swal) {
      const result = await Swal.fire({
        icon: "warning",
        title: "삭제하시겠습니까?",
        html:
          '<div class="text-start small mb-2">선택된 릴리스가 삭제됩니다.</div>' +
          '<div class="border rounded p-3 text-start small" style="max-height:260px; overflow-y:auto;">' +
            buildDeleteReleaseListHtml(releases) +
          '</div>',
        showCancelButton: true,
        confirmButtonText: "삭제",
        cancelButtonText: "취소",
        reverseButtons: true,
        focusCancel: true,
      });
      confirmed = !!result.isConfirmed;
    } else {
      confirmed = window.confirm(`${releases.length}개 릴리스를 삭제하시겠습니까?`);
    }

    if (!confirmed) return;

    if (window.AppUI && window.AppUI.showLoading) window.AppUI.showLoading("릴리스를 삭제하는 중...");
    try {
      const payload = await fetchJson("/api/firmware/releases/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ release_ids: releases.map((row) => Number(row.id || 0)) }),
      });
      await loadPayload();
      if (window.Swal) {
        await Swal.fire({
          icon: "success",
          title: "삭제 완료",
          text: `${Number(payload.deleted || 0)}개 릴리스가 삭제되었습니다.`,
        });
      } else {
        alert(`${Number(payload.deleted || 0)}개 릴리스가 삭제되었습니다.`);
      }
    } catch (error) {
      if (window.Swal) {
        await Swal.fire({ icon: "error", title: "삭제 실패", text: String(error.message || "요청 실패") });
      } else {
        alert(`삭제 실패: ${error.message}`);
      }
    } finally {
      if (window.AppUI && window.AppUI.hideLoading) window.AppUI.hideLoading();
    }
  }

  function bindEvents() {
    document.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.matches('input[name="selectedRelease"]')) {
        state.selectedReleaseId = Number(target.getAttribute("value") || 0);
        if (els.selectedReleaseText) {
          els.selectedReleaseText.textContent = releaseLabel(getSelectedRelease());
        }
      }

      if (target === els.releaseSelectAll) {
        const checked = !!els.releaseSelectAll.checked;
        document.querySelectorAll(".fwReleaseDeleteCheck").forEach((el) => {
          el.checked = checked;
        });
      }

      if (target === els.selectAll) {
        const checked = !!els.selectAll.checked;
        document.querySelectorAll(".fwDeviceCheck").forEach((el) => {
          el.checked = checked;
        });
      }
    });

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".fwReleaseDeleteCheck")) return;
      const row = target.closest(".fw-release-row");
      if (!row) return;
      const rid = Number(row.getAttribute("data-release-id") || 0);
      if (rid <= 0) return;
      state.selectedReleaseId = rid;
      const radio = row.querySelector('input[name="selectedRelease"]');
      if (radio) radio.checked = true;
      if (els.selectedReleaseText) {
        els.selectedReleaseText.textContent = releaseLabel(getSelectedRelease());
      }
    });

    if (els.uploadForm) {
      els.uploadForm.addEventListener("submit", handleUpload);
    }
    if (els.refreshBtn) {
      els.refreshBtn.addEventListener("click", () => { loadPayload().catch((error) => alert(`새로고침 실패: ${error.message}`)); });
    }
    if (els.deleteBtn) {
      els.deleteBtn.addEventListener("click", () => { handleDeleteReleases().catch((error) => {
        if (window.Swal) Swal.fire({ icon: "error", title: "삭제 실패", text: String(error.message || "요청 실패") });
        else alert(`삭제 실패: ${error.message}`);
      }); });
    }
    if (els.assignBtn) {
      els.assignBtn.addEventListener("click", () => { handleAssign().catch((error) => alert(`배정 실패: ${error.message}`)); });
    }
    if (els.clearBtn) {
      els.clearBtn.addEventListener("click", () => { handleClearTargets().catch((error) => alert(`배정 해제 실패: ${error.message}`)); });
    }
    if (els.filterInput) {
      els.filterInput.addEventListener("input", () => {
        state.filter = String(els.filterInput.value || "").trim().toLowerCase();
        renderDevices((state.payload && state.payload.devices) || []);
      });
    }
  }

  bindEvents();
  loadPayload().catch((error) => {
    alert(`Firmware Manage 초기화 실패: ${error.message}`);
  });
})();
