(function () {
  const config = window.MessengerConfig || {};
  const state = {
    currentUser: null,
    rooms: [],
    contacts: [],
    notifications: [],
    notificationCounts: {},
    dismissedNotificationIds: new Set(),
    dismissedNotificationStorageKey: "",
    shownBrowserNotificationIds: new Set(),
    notificationPermissionRequested: false,
    userProfilesById: {},
    roomHistory: [],
    preferences: {
      rememberPosition: true,
      showTyping: true,
      enterToSend: true,
    },
    activeRoomId: Number(config.requestedRoomId || 0),
    activeRoom: null,
    isOpen: false,
    initialized: false,
    notificationMenuOpen: false,
    filter: "all",
    search: "",
    sidebarMode: "rooms",
    roomMoreMenuOpen: false,
    contextMenuOpen: false,
    composerPopover: "",
    messagesByRoom: {},
    oldestCursorByRoom: {},
    loadingHistoryRooms: {},
    typingByRoom: {},
    modalMode: "dm",
    selectedContacts: new Set(),
    highlightMessageId: 0,
    socket: null,
    reconnectTimer: 0,
    heartbeatTimer: 0,
    typingTimer: 0,
    typingStopTimer: 0,
    popupOffsetX: 0,
    popupOffsetY: 0,
    popupPersistTimer: 0,
    dragActive: false,
    dragStartX: 0,
    dragStartY: 0,
    dragStartOffsetX: 0,
    dragStartOffsetY: 0,
    dragRectLeft: 0,
    dragRectTop: 0,
    dragRectWidth: 0,
    dragRectHeight: 0,
    call: {
      roomCallsById: {},
      joinedRoomId: 0,
      joining: false,
      requestedMode: "",
      audioEnabled: true,
      cameraEnabled: false,
      sharingScreen: false,
      liveRoom: null,
      liveRoomName: "",
      liveParticipantIdentity: "",
      clientId: "",
      cameraStream: null,
      screenStream: null,
      localStream: null,
      peersByUserId: {},
      remoteStreamsByUserId: {},
      pendingSignalsByUserId: {},
    },
  };

  const dom = {};
  const EMOJI_SET = ["😀", "😁", "😂", "🙂", "😊", "😍", "👍", "🙏", "🎉", "🔥", "💡", "✅", "🚀", "👏", "💬", "❤️"];
  const DEFAULT_ICE_SERVERS = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  const ROOM_AVATAR_PRESETS = Array.from({ length: 10 }, function (_value, index) {
    const itemNo = index + 1;
    return {
      label: "Preset " + itemNo,
      url: "/static/img/messenger-room-presets/preset-" + String(itemNo).padStart(2, "0") + ".svg",
    };
  });

  function $(id) {
    return document.getElementById(id);
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function avatarInitialFor(displayName, fallback) {
    const text = normalizeText(displayName || fallback || "U");
    return text ? text.charAt(0).toUpperCase() : "U";
  }

  function escapeAttribute(value) {
    return escapeHtml(String(value || ""));
  }

  function parseAttachment(message) {
    if (!message) return null;
    const messageType = normalizeText(message.message_type).toLowerCase();
    if (messageType !== "file" && messageType !== "image") return null;
    let payload = {};
    try {
      payload = JSON.parse(String(message.content || "{}")) || {};
    } catch (_) {
      payload = {};
    }
    if (!payload || typeof payload !== "object") return null;
    const url = normalizeText(payload.url);
    const name = normalizeText(payload.name || payload.filename) || (url ? url.split("/").pop() : "");
    return {
      kind: messageType,
      url: url,
      name: name,
      raw: String(message.content || ""),
      title: name,
      meta: normalizeText(payload.size_text) || normalizeText(payload.content_type) || messageType,
      size_text: normalizeText(payload.size_text),
      content_type: normalizeText(payload.content_type),
      icon: messageType === "image" ? "bi-image-fill" : (/\.pdf$/i.test(name) ? "bi-file-earmark-pdf-fill" : "bi-file-earmark-fill"),
    };
  }

  function formatRichText(text) {
    const escaped = escapeHtml(String(text || ""));
    const withLinks = escaped.replace(/(https?:\/\/[^\s<>"']+)/g, function (match) {
      return '<a href="' + match + '" target="_blank" rel="noopener noreferrer">' + match + "</a>";
    });
    const withBold = withLinks.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const withMentions = withBold.replace(/(^|[\s(])(@[A-Za-z0-9._\-가-힣]+)/g, '$1<span class="messenger-inline-mention">$2</span>');
    return withMentions.replace(/\n/g, "<br>");
  }

  function roomAvatarHtml(room) {
    if (!room) return "A";
    if (room.avatar_url) {
      return '<img src="' + escapeAttribute(room.avatar_url) + '" alt="' + escapeHtml(room.title || "대화방") + '">';
    }
    return escapeHtml(room.avatar_initial || "A");
  }

  function findContactByUserId(userId) {
    const targetUserId = normalizeText(userId);
    if (!targetUserId) return null;
    return (state.contacts || []).find(function (contact) {
      return normalizeText((contact || {}).user_id) === targetUserId;
    }) || null;
  }

  function findMemberByUserId(room, userId) {
    const targetUserId = normalizeText(userId);
    const targetRoom = room || state.activeRoom;
    if (!targetUserId || !targetRoom || !Array.isArray(targetRoom.members)) return null;
    return targetRoom.members.find(function (member) {
      return normalizeText((member || {}).user_id) === targetUserId;
    }) || null;
  }

  function buildUserProfile(userId, message) {
    const targetUserId = normalizeText(userId || (message && message.sender_user_id));
    if (!targetUserId) return null;
    const roomMember = findMemberByUserId(state.activeRoom, targetUserId) || {};
    const contact = findContactByUserId(targetUserId) || {};
    const currentUser = normalizeText((state.currentUser || {}).user_id) === targetUserId ? (state.currentUser || {}) : {};
    const fromMessage = message ? {
      user_id: targetUserId,
      display_name: message.sender_display_name,
      nickname: message.sender_nickname,
      name: message.sender_name,
      department: message.sender_department,
      role_label: message.sender_role_label,
      presence_label: message.sender_presence_label,
      presence_page_text: message.sender_presence_page_text,
      presence_tone: message.sender_presence_tone,
      profile_image_url: message.sender_avatar_url,
      avatar_initial: message.sender_avatar_initial,
    } : {};
    const merged = Object.assign({}, contact, roomMember, currentUser, fromMessage);
    merged.user_id = targetUserId;
    merged.display_name = normalizeText(merged.display_name || merged.nickname || merged.name || targetUserId);
    merged.nickname = normalizeText(merged.nickname);
    merged.name = normalizeText(merged.name);
    merged.department = normalizeText(merged.department);
    merged.role_label = normalizeText(merged.role_label || "USER");
    merged.presence_label = normalizeText(merged.presence_label || merged.presence_page_text || "오프라인");
    merged.presence_page_text = normalizeText(merged.presence_page_text);
    merged.profile_image_url = normalizeText(merged.profile_image_url);
    merged.avatar_initial = normalizeText(merged.avatar_initial || avatarInitialFor(merged.display_name, targetUserId));
    merged.is_self = normalizeText((state.currentUser || {}).user_id) === targetUserId || !!merged.is_self;
    return merged;
  }

  async function fetchUserProfile(userId, message) {
    const targetUserId = normalizeText(userId || (message && message.sender_user_id));
    if (!targetUserId) return null;
    if (state.userProfilesById[targetUserId]) {
      return Object.assign({}, state.userProfilesById[targetUserId]);
    }
    try {
      const payload = await api("/api/messenger/users/" + encodeURIComponent(targetUserId) + "/profile");
      const profile = (payload && payload.profile) || null;
      if (profile && profile.user_id) {
        state.userProfilesById[targetUserId] = Object.assign({}, profile);
        return Object.assign({}, profile);
      }
    } catch (_) {}
    const fallbackProfile = buildUserProfile(targetUserId, message);
    if (fallbackProfile && fallbackProfile.user_id) {
      state.userProfilesById[targetUserId] = Object.assign({}, fallbackProfile);
    }
    return fallbackProfile;
  }

  function profileAvatarHtml(profile) {
    const userProfile = profile || {};
    if (userProfile.profile_image_url) {
      return '<img src="' + escapeAttribute(userProfile.profile_image_url) + '" alt="' + escapeHtml(userProfile.display_name || userProfile.user_id || "사용자") + '">';
    }
    return escapeHtml(userProfile.avatar_initial || avatarInitialFor(userProfile.display_name, userProfile.user_id));
  }

  async function showUserProfileModal(userId, message) {
    const profile = await fetchUserProfile(userId, message);
    if (!profile) return;
    const metaRows = [
      { label: "이름", value: profile.name || "-" },
      { label: "아이디", value: profile.user_id || "-" },
      { label: "부서", value: profile.department || "-" },
      { label: "권한", value: profile.role_label || "-" },
      { label: "상태", value: profile.presence_label || "-" },
    ];
    await fireDialog({
      title: "프로필 정보",
      width: "34rem",
      confirmButtonText: "닫기",
      html: [
        '<div class="messenger-profile-modal">',
        '<div class="messenger-profile-modal__hero">',
        '<span class="messenger-profile-modal__avatar">' + profileAvatarHtml(profile) + "</span>",
        '<div class="messenger-profile-modal__copy">',
        '<strong>' + escapeHtml(profile.display_name || profile.user_id || "사용자") + '</strong>',
        '<span>' + escapeHtml(profile.department || profile.user_id || "-") + '</span>',
        "</div>",
        profile.is_self ? '<span class="messenger-profile-modal__badge">Me</span>' : "",
        "</div>",
        '<div class="messenger-profile-modal__grid">',
        metaRows.map(function (row) {
          return [
            '<div class="messenger-profile-modal__item">',
            '<span>' + escapeHtml(row.label) + '</span>',
            '<strong>' + escapeHtml(row.value) + "</strong>",
            "</div>",
          ].join("");
        }).join(""),
        "</div>",
        '<div class="messenger-profile-modal__intro">',
        '<span>소개</span>',
        '<strong>' + escapeHtml(profile.bio || "소개가 없습니다.") + '</strong>',
        "</div>",
        "</div>",
      ].join(""),
    });
  }

  function canEditRoomAvatar(room) {
    if (!room) return false;
    return !!room.can_edit_avatar;
  }

  function canManageRoom(room) {
    return !!(room && room.can_manage_room);
  }

  function canEditMessage(message) {
    return !!(message && message.can_edit && message.is_mine);
  }

  function canDeleteMessage(message) {
    return !!(message && message.can_delete);
  }

  function findRoomById(roomId) {
    const targetRoomId = Number(roomId || 0);
    return state.rooms.find(function (room) {
      return Number(room.id || 0) === targetRoomId;
    }) || null;
  }

  function findMessageById(roomId, messageId) {
    const messages = state.messagesByRoom[Number(roomId || 0)] || [];
    const targetMessageId = Number(messageId || 0);
    return messages.find(function (message) {
      return Number(message.id || 0) === targetMessageId;
    }) || null;
  }

  function replaceMessage(roomId, nextMessage) {
    if (!nextMessage || !nextMessage.id) return;
    const targetRoomId = Number(roomId || nextMessage.room_id || 0);
    if (targetRoomId <= 0) return;
    const messages = state.messagesByRoom[targetRoomId] || [];
    const index = messages.findIndex(function (message) {
      return Number(message.id || 0) === Number(nextMessage.id || 0);
    });
    if (index === -1) {
      appendMessage(targetRoomId, nextMessage);
      return;
    }
    messages[index] = Object.assign({}, messages[index], nextMessage);
    state.messagesByRoom[targetRoomId] = messages;
  }

  function removeMessageFromRoom(roomId, messageId) {
    const targetRoomId = Number(roomId || 0);
    const targetMessageId = Number(messageId || 0);
    if (targetRoomId <= 0 || targetMessageId <= 0) return;
    state.messagesByRoom[targetRoomId] = (state.messagesByRoom[targetRoomId] || []).filter(function (message) {
      return Number(message.id || 0) !== targetMessageId;
    });
  }

  function setContextMenuOpen(open) {
    state.contextMenuOpen = !!open;
    if (!dom.contextMenu) return;
    dom.contextMenu.classList.toggle("is-open", state.contextMenuOpen);
    dom.contextMenu.setAttribute("aria-hidden", state.contextMenuOpen ? "false" : "true");
    if (!state.contextMenuOpen) {
      dom.contextMenu.innerHTML = "";
      dom.contextMenu.style.left = "";
      dom.contextMenu.style.top = "";
    }
  }

  function openContextMenu(event, items) {
    if (!dom.contextMenu || !Array.isArray(items) || !items.length) return;
    event.preventDefault();
    event.stopPropagation();
    dom.contextMenu.innerHTML = items.map(function (item) {
      const classes = ["messenger-context-menu__item"];
      if (item.danger) classes.push("is-danger");
      const attrs = Object.keys(item.data || {}).map(function (key) {
        const attrName = String(key || "").replace(/[A-Z]/g, function (match) {
          return "-" + match.toLowerCase();
        });
        return ' data-' + escapeAttribute(attrName) + '="' + escapeAttribute(item.data[key]) + '"';
      }).join("");
      return [
        '<button type="button" class="' + classes.join(" ") + '" data-context-action="' + escapeAttribute(item.action || "") + '"' + attrs + '>',
        '<i class="bi ' + escapeAttribute(item.icon || "bi-dot") + '"></i>',
        '<span>' + escapeHtml(item.label || "") + "</span>",
        "</button>",
      ].join("");
    }).join("");
    setContextMenuOpen(true);
    window.requestAnimationFrame(function () {
      if (!dom.contextMenu) return;
      const margin = 12;
      const width = dom.contextMenu.offsetWidth || 220;
      const height = dom.contextMenu.offsetHeight || 160;
      const left = clampNumber(Number(event.clientX || 0), margin, window.innerWidth - width - margin);
      const top = clampNumber(Number(event.clientY || 0), margin, window.innerHeight - height - margin);
      dom.contextMenu.style.left = String(left) + "px";
      dom.contextMenu.style.top = String(top) + "px";
    });
  }

  async function copyText(text) {
    const value = normalizeText(text);
    if (!value) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {}

    const helper = document.createElement("textarea");
    helper.value = value;
    helper.setAttribute("readonly", "readonly");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (_) {
      copied = false;
    }
    document.body.removeChild(helper);
    return copied;
  }

  function canUseBrowserNotifications() {
    return typeof window !== "undefined" && typeof window.Notification !== "undefined";
  }

  async function requestBrowserNotificationPermission(triggeredByUser) {
    if (!canUseBrowserNotifications()) return false;
    if (window.Notification.permission === "granted") return true;
    if (window.Notification.permission === "denied") return false;
    if (!triggeredByUser || state.notificationPermissionRequested) return false;
    state.notificationPermissionRequested = true;
    try {
      const permission = await window.Notification.requestPermission();
      return permission === "granted";
    } catch (_) {
      return false;
    }
  }

  function trimShownBrowserNotificationIds() {
    const values = Array.from(state.shownBrowserNotificationIds || []);
    if (values.length <= 240) return;
    state.shownBrowserNotificationIds = new Set(values.slice(values.length - 160));
  }

  function shouldShowBrowserNotification() {
    if (!canUseBrowserNotifications()) return false;
    if (window.Notification.permission !== "granted") return false;
    return document.hidden || !document.hasFocus();
  }

  function showBrowserNotification(item) {
    const payload = item || {};
    const notificationId = notificationItemId(payload);
    if (!notificationId || state.shownBrowserNotificationIds.has(notificationId)) return;
    if (!shouldShowBrowserNotification()) return;
    const roomId = Number(payload.room_id || 0);
    const messageId = Number(payload.message_id || 0);
    if (roomId <= 0 || messageId <= 0) return;

    const title = normalizeText(payload.room_title || payload.sender_display_name || "새 메시지");
    const body = normalizeText(payload.summary || payload.preview || "새 메시지가 도착했습니다.");
    const icon = normalizeText(payload.sender_avatar_url || payload.room_avatar_url || "");
    let notification = null;
    try {
      notification = new window.Notification(title, {
        body: body,
        icon: icon || undefined,
        tag: notificationId,
        renotify: false,
      });
    } catch (_) {
      return;
    }

    state.shownBrowserNotificationIds.add(notificationId);
    trimShownBrowserNotificationIds();
    notification.onclick = function (event) {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      try {
        window.focus();
      } catch (_) {}
      openRoom(roomId, messageId);
      try {
        notification.close();
      } catch (_) {}
    };
    window.setTimeout(function () {
      try {
        notification.close();
      } catch (_) {}
    }, 7000);
  }

  function hasSwal() {
    return !!(window.Swal && typeof window.Swal.fire === "function");
  }

  async function fireDialog(options) {
    const incoming = options || {};
    const isToast = !!incoming.toast;
    const settings = Object.assign({
      confirmButtonText: "확인",
      cancelButtonText: "취소",
      reverseButtons: true,
      buttonsStyling: false,
    }, incoming);
    if (!Object.prototype.hasOwnProperty.call(incoming, "width")) {
      settings.width = isToast ? undefined : ((incoming.input || incoming.html) ? "44rem" : "32rem");
    }
    settings.customClass = Object.assign(
      isToast
        ? {
            popup: "app-swal-toast",
            title: "app-swal-toast-title",
            htmlContainer: "app-swal-toast-html",
          }
        : {
            popup: "app-swal-popup",
            title: "app-swal-title",
            htmlContainer: "app-swal-html",
            actions: "app-swal-actions",
            confirmButton: "btn btn-primary app-swal-confirm",
            cancelButton: "btn btn-outline-secondary app-swal-cancel",
            input: "form-control app-swal-input",
            validationMessage: "app-swal-validation",
          },
      incoming.customClass || {}
    );
    if (hasSwal()) {
      return window.Swal.fire(settings);
    }
    const title = normalizeText(settings.title);
    const text = normalizeText(settings.text);
    const message = [title, text].filter(Boolean).join("\n\n") || "알림";
    if (settings.showCancelButton) {
      const confirmed = window.confirm(message);
      return { isConfirmed: confirmed, isDismissed: !confirmed };
    }
    if (settings.input) {
      const fallbackValue = window.prompt(message, normalizeText(settings.inputValue));
      return { isConfirmed: fallbackValue !== null, value: fallbackValue };
    }
    window.alert(message);
    return { isConfirmed: true };
  }

  async function showError(text, title) {
    await fireDialog({
      icon: "error",
      title: normalizeText(title) || "처리 실패",
      text: normalizeText(text) || "요청을 처리하지 못했습니다.",
    });
  }

  async function showWarning(text, title) {
    await fireDialog({
      icon: "warning",
      title: normalizeText(title) || "확인 필요",
      text: normalizeText(text) || "입력 내용을 확인해주세요.",
    });
  }

  async function showToast(icon, title) {
    if (hasSwal()) {
      await fireDialog({
        toast: true,
        backdrop: false,
        position: "top-end",
        showConfirmButton: false,
        timer: 1800,
        timerProgressBar: true,
        icon: icon || "success",
        title: normalizeText(title) || "",
      });
      return;
    }
  }

  async function askConfirm(title, text, confirmText, icon) {
    const result = await fireDialog({
      icon: icon || "warning",
      title: normalizeText(title) || "확인",
      text: normalizeText(text) || "",
      showCancelButton: true,
      confirmButtonText: normalizeText(confirmText) || "확인",
      cancelButtonText: "취소",
    });
    return !!(result && result.isConfirmed);
  }

  async function promptText(options) {
    const settings = options || {};
    if (hasSwal()) {
      const fieldId = "swalMessengerPromptInput";
      const isTextarea = normalizeText(settings.input).toLowerCase() === "textarea";
      const inputType = normalizeText(settings.input).toLowerCase() === "url" ? "url" : "text";
      const result = await fireDialog({
        title: normalizeText(settings.title) || "입력",
        text: normalizeText(settings.text) || "",
        width: settings.width || (isTextarea ? "44rem" : "34rem"),
        html: [
          '<div class="app-swal-form">',
          settings.label ? '<div class="app-swal-field-group"><label class="form-label" for="' + fieldId + '">' + escapeHtml(settings.label) + '</label>' : '<div class="app-swal-field-group">',
          isTextarea
            ? '<textarea id="' + fieldId + '" class="form-control app-swal-field app-swal-field--textarea" maxlength="' + escapeAttribute(settings.maxLength || "") + '" placeholder="' + escapeAttribute(settings.placeholder || "") + '"></textarea>'
            : '<input id="' + fieldId + '" class="form-control app-swal-field" type="' + escapeAttribute(inputType || "text") + '" maxlength="' + escapeAttribute(settings.maxLength || "") + '" placeholder="' + escapeAttribute(settings.placeholder || "") + '">',
          "</div>",
          "</div>",
        ].join(""),
        showCancelButton: true,
        confirmButtonText: normalizeText(settings.confirmText) || "저장",
        cancelButtonText: "취소",
        focusConfirm: false,
        didOpen: function () {
          const input = document.getElementById(fieldId);
          if (!input) return;
          input.value = String(settings.value || "");
          try {
            input.focus();
            if (typeof input.select === "function") input.select();
          } catch (_) {}
        },
        preConfirm: function () {
          const input = document.getElementById(fieldId);
          const value = String((input && input.value) || "");
          const normalized = normalizeText(value);
          if (settings.required !== false && !normalized) {
            window.Swal.showValidationMessage(normalizeText(settings.requiredMessage) || "값을 입력해주세요.");
            return false;
          }
          if (settings.maxLength && String(value || "").length > Number(settings.maxLength || 0)) {
            window.Swal.showValidationMessage(String(settings.maxLength) + "자 이하로 입력해주세요.");
            return false;
          }
          return value;
        },
      });
      return result && result.isConfirmed ? String(result.value || "") : null;
    }
    const fallback = window.prompt(
      [normalizeText(settings.title), normalizeText(settings.text)].filter(Boolean).join("\n\n") || "입력",
      String(settings.value || "")
    );
    if (fallback === null) return null;
    return String(fallback || "");
  }

  async function promptRoomDetails(room) {
    const currentRoom = room || {};
    const currentName = normalizeText(currentRoom.title || currentRoom.name);
    const currentTopic = normalizeText(currentRoom.topic || "");
    if (!hasSwal()) {
      const fallbackName = window.prompt("대화방 이름을 입력해주세요.", currentName);
      if (fallbackName === null) return null;
      const normalizedName = normalizeText(fallbackName);
      if (!normalizedName) return null;
      const fallbackTopic = window.prompt("대화방 부제목 또는 설명을 입력해주세요.", currentTopic);
      if (fallbackTopic === null) return null;
      return {
        name: normalizedName,
        topic: normalizeText(fallbackTopic),
      };
    }
    const result = await fireDialog({
      title: "대화방 정보 수정",
      width: "44rem",
      html: [
        '<div class="app-swal-form">',
        '<div class="app-swal-field-group">',
        '<label class="form-label" for="swalMessengerRoomName">대화방 이름</label>',
        '<input id="swalMessengerRoomName" class="form-control app-swal-field" maxlength="80" placeholder="예: 서비스기획 TF">',
        '</div>',
        '<div class="app-swal-field-group">',
        '<label class="form-label" for="swalMessengerRoomTopic">방 설명</label>',
        '<textarea id="swalMessengerRoomTopic" class="form-control app-swal-field app-swal-field--textarea" maxlength="120" placeholder="대화 목적이나 주제를 간단히 적어주세요."></textarea>',
        '</div>',
        '</div>',
      ].join(""),
      showCancelButton: true,
      confirmButtonText: "저장",
      cancelButtonText: "취소",
      focusConfirm: false,
      didOpen: function () {
        const nameInput = document.getElementById("swalMessengerRoomName");
        const topicInput = document.getElementById("swalMessengerRoomTopic");
        if (nameInput) nameInput.value = currentName;
        if (topicInput) topicInput.value = currentTopic;
      },
      preConfirm: function () {
        const nameInput = document.getElementById("swalMessengerRoomName");
        const topicInput = document.getElementById("swalMessengerRoomTopic");
        const nextName = normalizeText(nameInput && nameInput.value);
        const nextTopic = normalizeText(topicInput && topicInput.value);
        if (!nextName) {
          window.Swal.showValidationMessage("대화방 이름을 입력해주세요.");
          return false;
        }
        if (nextName.length > 80) {
          window.Swal.showValidationMessage("대화방 이름은 80자 이하만 입력할 수 있습니다.");
          return false;
        }
        if (nextTopic.length > 120) {
          window.Swal.showValidationMessage("대화방 설명은 120자 이하만 입력할 수 있습니다.");
          return false;
        }
        return { name: nextName, topic: nextTopic };
      },
    });
    return result && result.isConfirmed ? result.value : null;
  }

  function popupStorageKey() {
    return "abbasMessengerPopupOffset";
  }

  function recentRoomsStorageKey() {
    return "abbasMessengerRecentRooms";
  }

  function preferencesStorageKey() {
    return "abbasMessengerPreferences";
  }

  function dismissedNotificationsStorageKey() {
    const userId = normalizeText((state.currentUser && state.currentUser.user_id) || "");
    return userId ? ("abbasMessengerDismissedNotifications:" + userId) : "";
  }

  function loadDismissedNotifications() {
    const storageKey = dismissedNotificationsStorageKey();
    if (!storageKey) {
      state.dismissedNotificationIds = new Set();
      state.dismissedNotificationStorageKey = "";
      return;
    }
    if (state.dismissedNotificationStorageKey === storageKey && state.dismissedNotificationIds instanceof Set) {
      return;
    }
    let values = [];
    try {
      values = JSON.parse(window.localStorage.getItem(storageKey) || "[]") || [];
    } catch (_) {
      values = [];
    }
    state.dismissedNotificationIds = new Set((values || []).map(function (value) {
      return normalizeText(value);
    }).filter(Boolean));
    state.dismissedNotificationStorageKey = storageKey;
  }

  function persistDismissedNotifications() {
    const storageKey = dismissedNotificationsStorageKey();
    if (!storageKey) return;
    const values = Array.from(state.dismissedNotificationIds || []).map(function (value) {
      return normalizeText(value);
    }).filter(Boolean).slice(-400);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(values));
      state.dismissedNotificationStorageKey = storageKey;
    } catch (_) {}
  }

  function loadRecentRooms() {
    let values = [];
    try {
      values = JSON.parse(window.localStorage.getItem(recentRoomsStorageKey()) || "[]") || [];
    } catch (_) {
      values = [];
    }
    state.roomHistory = values.map(function (value) {
      return Number(value || 0);
    }).filter(function (value) {
      return Number.isFinite(value) && value > 0;
    }).slice(0, 18);
  }

  function persistRecentRooms() {
    try {
      window.localStorage.setItem(recentRoomsStorageKey(), JSON.stringify((state.roomHistory || []).slice(0, 18)));
    } catch (_) {}
  }

  function rememberRecentRoom(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    state.roomHistory = [targetRoomId].concat((state.roomHistory || []).filter(function (value) {
      return Number(value || 0) !== targetRoomId;
    })).slice(0, 18);
    persistRecentRooms();
    if (state.sidebarMode === "recent") {
      renderRoomList();
    }
  }

  function loadPreferences() {
    let parsed = {};
    try {
      parsed = JSON.parse(window.localStorage.getItem(preferencesStorageKey()) || "{}") || {};
    } catch (_) {
      parsed = {};
    }
    state.preferences = {
      rememberPosition: parsed.rememberPosition !== false,
      showTyping: parsed.showTyping !== false,
      enterToSend: parsed.enterToSend !== false,
    };
  }

  function persistPreferences() {
    try {
      window.localStorage.setItem(preferencesStorageKey(), JSON.stringify(state.preferences || {}));
    } catch (_) {}
  }

  function updateComposerPlaceholder() {
    if (!dom.composerInput) return;
    dom.composerInput.setAttribute(
      "placeholder",
      state.preferences.enterToSend
        ? "메시지를 입력해주세요. Enter 전송, Shift+Enter 줄바꿈"
        : "메시지를 입력해주세요. Ctrl+Enter 전송, Enter 줄바꿈"
    );
  }

  function applyPreferences() {
    updateComposerPlaceholder();
    if (!state.preferences.rememberPosition) {
      state.popupOffsetX = 0;
      state.popupOffsetY = 0;
      applyPopupOffset();
      try {
        window.localStorage.removeItem(popupStorageKey());
      } catch (_) {}
    }
    if (state.sidebarMode === "settings") {
      renderRoomList();
    }
    renderTyping();
  }

  function schedulePopupOffsetPersist() {
    if (!state.preferences.rememberPosition) {
      return;
    }
    if (state.popupPersistTimer) {
      window.clearTimeout(state.popupPersistTimer);
    }
    state.popupPersistTimer = window.setTimeout(function () {
      state.popupPersistTimer = 0;
      try {
        window.localStorage.setItem(popupStorageKey(), JSON.stringify({
          x: Math.round(state.popupOffsetX || 0),
          y: Math.round(state.popupOffsetY || 0),
        }));
      } catch (_) {}
    }, 80);
  }

  function applyPopupOffset() {
    if (!dom.popupWindow) return;
    dom.popupWindow.style.setProperty("--mw-popup-offset-x", String(Math.round(state.popupOffsetX || 0)) + "px");
    dom.popupWindow.style.setProperty("--mw-popup-offset-y", String(Math.round(state.popupOffsetY || 0)) + "px");
  }

  function clampPopupOffset(nextX, nextY) {
    if (!dom.popupWindow) {
      return { x: 0, y: 0 };
    }
    const rect = dom.popupWindow.getBoundingClientRect();
    const width = Math.max(Number(state.dragRectWidth || rect.width || 0), 0);
    const height = Math.max(Number(state.dragRectHeight || rect.height || 0), 0);
    const baseLeft = Number(state.dragActive ? state.dragRectLeft : rect.left);
    const baseTop = Number(state.dragActive ? state.dragRectTop : rect.top);
    const left = baseLeft + (Number(nextX) - Number(state.dragActive ? state.dragStartOffsetX : state.popupOffsetX));
    const top = baseTop + (Number(nextY) - Number(state.dragActive ? state.dragStartOffsetY : state.popupOffsetY));
    const minLeft = 16;
    const maxLeft = Math.max(window.innerWidth - Math.min(width, 320), minLeft);
    const minTop = 16;
    const maxTop = Math.max(window.innerHeight - 88, minTop);
    const clampedLeft = clampNumber(left, minLeft, maxLeft);
    const clampedTop = clampNumber(top, minTop, maxTop);
    return {
      x: Number(nextX) + (clampedLeft - left),
      y: Number(nextY) + (clampedTop - top),
    };
  }

  function restorePopupOffset() {
    if (!dom.popupWindow) return;
    if (!state.preferences.rememberPosition) {
      state.popupOffsetX = 0;
      state.popupOffsetY = 0;
      applyPopupOffset();
      return;
    }
    if (window.innerWidth < 992) {
      state.popupOffsetX = 0;
      state.popupOffsetY = 0;
      applyPopupOffset();
      return;
    }
    let parsed = {};
    try {
      parsed = JSON.parse(window.localStorage.getItem(popupStorageKey()) || "{}") || {};
    } catch (_) {
      parsed = {};
    }
    const restoredX = Number(parsed.x || 0);
    const restoredY = Number(parsed.y || 0);
    if (!Number.isFinite(restoredX) || !Number.isFinite(restoredY)) {
      state.popupOffsetX = 0;
      state.popupOffsetY = 0;
      applyPopupOffset();
      return;
    }
    state.popupOffsetX = restoredX;
    state.popupOffsetY = restoredY;
    applyPopupOffset();
    const clamped = clampPopupOffset(state.popupOffsetX, state.popupOffsetY);
    state.popupOffsetX = clamped.x;
    state.popupOffsetY = clamped.y;
    applyPopupOffset();
  }

  function roomSortScore(room) {
    const lastMessageId = Number((room && room.last_message_id) || 0);
    const unread = Number((room && room.unread_count) || 0);
    return (lastMessageId * 100) + unread;
  }

  function sortRooms() {
    state.rooms.sort(function (a, b) {
      return roomSortScore(b) - roomSortScore(a) || Number(b.id || 0) - Number(a.id || 0);
    });
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

  async function api(path, options) {
    const response = await fetch(path, Object.assign({
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    }, options || {}));
    const payload = await response.json().catch(function () {
      return {};
    });
    if (!response.ok || !payload.ok) {
      throw new Error(normalizeText(payload.detail) || ("HTTP " + response.status));
    }
    return payload;
  }

  function setCounts(counts) {
    const roomTotal = Number((counts && counts.room_total) || 0);
    const unreadTotal = Number((counts && counts.unread_total) || 0);
    const unreadNotificationTotal = Number((counts && counts.unread_notification_total) || (state.notificationCounts && state.notificationCounts.unread_total) || 0);
    const launcherUnreadTotal = Math.max(unreadTotal, unreadNotificationTotal);
    if (dom.roomTotal) dom.roomTotal.textContent = String(roomTotal);
    if (dom.unreadTotal) dom.unreadTotal.textContent = String(unreadTotal);
    if (dom.onlineContacts) dom.onlineContacts.textContent = String((counts && counts.online_contacts) || 0);
    if (dom.channelCount) dom.channelCount.textContent = String((counts && counts.channel_total) || 0);
    if (dom.groupCount) dom.groupCount.textContent = String((counts && counts.group_total) || 0);
    if (dom.directCount) dom.directCount.textContent = String((counts && counts.direct_total) || 0);
    if (dom.railUnreadBadge) {
      if (unreadTotal > 0) {
        dom.railUnreadBadge.textContent = unreadTotal > 99 ? "99+" : String(unreadTotal);
        dom.railUnreadBadge.classList.remove("d-none");
      } else {
        dom.railUnreadBadge.textContent = "";
        dom.railUnreadBadge.classList.add("d-none");
      }
    }
    if (dom.railNotifyBadge) {
      if (unreadNotificationTotal > 0) {
        dom.railNotifyBadge.textContent = unreadNotificationTotal > 99 ? "99+" : String(unreadNotificationTotal);
        dom.railNotifyBadge.classList.remove("d-none");
      } else {
        dom.railNotifyBadge.textContent = "";
        dom.railNotifyBadge.classList.add("d-none");
      }
    }
    if (dom.headerUnreadBadge) {
      if (launcherUnreadTotal > 0) {
        dom.headerUnreadBadge.textContent = launcherUnreadTotal > 99 ? "99+" : String(launcherUnreadTotal);
        dom.headerUnreadBadge.classList.remove("d-none");
      } else {
        dom.headerUnreadBadge.textContent = "";
        dom.headerUnreadBadge.classList.add("d-none");
      }
    }
  }

  function notificationItemId(item) {
    const payload = item || {};
    const roomId = Number(payload.room_id || 0);
    const messageId = Number(payload.message_id || payload.id || 0);
    if (roomId > 0 && messageId > 0) {
      return "room-" + roomId + "-message-" + messageId;
    }
    const explicitId = normalizeText(payload.id);
    if (explicitId) return explicitId;
    return "";
  }

  function notificationSortScore(item) {
    const payload = item || {};
    const messageId = Number(payload.message_id || 0);
    if (messageId > 0) return messageId;
    const createdAt = Date.parse(String(payload.created_at || ""));
    return Number.isFinite(createdAt) ? createdAt : 0;
  }

  function notificationCountsFromItems(items) {
    const values = Array.isArray(items) ? items : [];
    return {
      total: values.length,
      unread_total: values.length,
      mention_total: values.filter(function (item) {
        return normalizeText(item && item.kind).toLowerCase() === "mention";
      }).length,
      unread_mention_total: values.filter(function (item) {
        return normalizeText(item && item.kind).toLowerCase() === "mention";
      }).length,
    };
  }

  function mergeNotificationItems(nextItems) {
    const existingMap = new Map();
    (state.notifications || []).forEach(function (item) {
      const id = notificationItemId(item);
      if (!id || state.dismissedNotificationIds.has(id)) return;
      const room = findRoomById(Number((item && item.room_id) || 0));
      if (room && room.is_muted) return;
      existingMap.set(id, Object.assign({}, item, { id: id }));
    });

    const mergedMap = new Map();
    (Array.isArray(nextItems) ? nextItems : []).forEach(function (item) {
      const id = notificationItemId(item);
      if (!id || state.dismissedNotificationIds.has(id)) return;
      const room = findRoomById(Number((item && item.room_id) || 0));
      if (room && room.is_muted) return;
      const previous = existingMap.get(id) || {};
      mergedMap.set(id, Object.assign({}, previous, item, {
        id: id,
        is_unread: !!(previous.is_unread || (item && item.is_unread) || true),
      }));
    });

    existingMap.forEach(function (item, id) {
      if (mergedMap.has(id)) return;
      mergedMap.set(id, item);
    });

    return Array.from(mergedMap.values()).sort(function (a, b) {
      return notificationSortScore(b) - notificationSortScore(a);
    }).slice(0, 40);
  }

  function applyNotificationItems(items, counts) {
    state.notifications = Array.isArray(items) ? items.slice() : [];
    state.notificationCounts = notificationCountsFromItems(state.notifications);
    if (counts) {
      setCounts(counts);
    } else {
      recalcCounts();
    }
    renderNotifications();
    if (state.sidebarMode === "inbox" || state.sidebarMode === "alerts") {
      renderRoomList();
    }
  }

  function dismissNotificationsForRoom(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    let changed = false;
    state.notifications = (state.notifications || []).filter(function (item) {
      if (Number((item && item.room_id) || 0) !== targetRoomId) {
        return true;
      }
      const id = notificationItemId(item);
      if (id) {
        state.dismissedNotificationIds.add(id);
      }
      changed = true;
      return false;
    });
    if (!changed) return;
    persistDismissedNotifications();
    applyNotificationItems(state.notifications, null);
  }

  function currentUserNotificationAliases() {
    const currentUser = state.currentUser || {};
    const seen = new Set();
    return [
      currentUser.user_id,
      currentUser.display_name,
      currentUser.nickname,
      currentUser.name,
    ].map(function (value) {
      return normalizeText(value);
    }).filter(function (value) {
      if (!value) return false;
      const lowered = value.toLowerCase();
      if (seen.has(lowered)) return false;
      seen.add(lowered);
      return true;
    });
  }

  function messageMentionsCurrentUser(content) {
    const text = String(content || "");
    if (!normalizeText(text)) return false;
    const lowered = text.toLowerCase();
    return currentUserNotificationAliases().some(function (alias) {
      const pattern = new RegExp("(^|[\\s(])@" + alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=$|[\\s.,!?;:)\\]}>\\\"])", "i");
      return pattern.test(text) || lowered.indexOf("@" + alias.toLowerCase()) !== -1;
    });
  }

  function buildNotificationItemFromMessage(message) {
    const payload = message || {};
    if (!payload || payload.is_mine) return null;
    const roomId = Number(payload.room_id || 0);
    if (roomId <= 0) return null;
    const room = findRoomById(roomId) || {};
    if (room && room.is_muted) return null;
    const kind = messageMentionsCurrentUser(payload.content) ? "mention" : "message";
    const senderDisplayName = normalizeText(payload.sender_display_name || payload.sender_name || payload.sender_user_id || "사용자");
    const preview = normalizeText(payload.preview_text || payload.content);
    return {
      id: notificationItemId(payload),
      room_id: roomId,
      message_id: Number(payload.id || 0),
      kind: kind,
      kind_label: kind === "mention" ? "멘션" : "새 메시지",
      is_unread: true,
      room_title: normalizeText(room.title || "대화방"),
      room_type: normalizeText(room.room_type || "group"),
      room_avatar_initial: normalizeText(room.avatar_initial || "C"),
      room_avatar_url: normalizeText(room.avatar_url),
      sender_display_name: senderDisplayName,
      sender_avatar_initial: normalizeText(payload.sender_avatar_initial || "U"),
      sender_avatar_url: normalizeText(payload.sender_avatar_url),
      sender_department: normalizeText(payload.sender_department),
      preview: preview,
      summary: senderDisplayName + (preview ? ": " + preview : ""),
      created_at: normalizeText(payload.created_at),
      time_text: normalizeText(payload.time_text),
    };
  }

  function upsertNotificationItem(item) {
    const mergedItems = mergeNotificationItems(item ? [item] : []);
    applyNotificationItems(mergedItems, null);
  }

  function recalcCounts() {
    setCounts({
      room_total: state.rooms.length,
      unread_total: state.rooms.reduce(function (sum, room) {
        return sum + Number(room.unread_count || 0);
      }, 0),
      channel_total: state.rooms.filter(function (room) { return !!room.is_channel; }).length,
      group_total: state.rooms.filter(function (room) { return !!room.is_group; }).length,
      direct_total: state.rooms.filter(function (room) { return !!room.is_direct; }).length,
      online_contacts: state.contacts.filter(function (contact) { return !!contact.is_online; }).length,
    });
  }

  function setNotificationMenuOpen(open) {
    state.notificationMenuOpen = !!open;
    if (dom.notifyRoot) {
      dom.notifyRoot.classList.toggle("is-open", state.notificationMenuOpen);
    }
    if (dom.notifyBtn) {
      dom.notifyBtn.setAttribute("aria-expanded", state.notificationMenuOpen ? "true" : "false");
    }
    if (dom.notifyMenu) {
      dom.notifyMenu.setAttribute("aria-hidden", state.notificationMenuOpen ? "false" : "true");
    }
  }

  function renderNotifications() {
    if (dom.notifyDot) {
      const unreadTotal = Number((state.notificationCounts && state.notificationCounts.unread_total) || 0);
      dom.notifyDot.classList.toggle("d-none", unreadTotal <= 0);
    }
    if (dom.notifyMeta) {
      const unreadTotal = Number((state.notificationCounts && state.notificationCounts.unread_total) || 0);
      const mentionTotal = Number((state.notificationCounts && state.notificationCounts.unread_mention_total) || 0);
      if (unreadTotal > 0) {
        dom.notifyMeta.textContent = "확인할 알림 " + unreadTotal + "건" + (mentionTotal > 0 ? " · 멘션 " + mentionTotal + "건" : "");
      } else {
        dom.notifyMeta.textContent = "최근 메시지와 멘션이 여기에 표시됩니다.";
      }
    }
    if (!dom.notifyList) return;
    if (!state.notifications.length) {
      dom.notifyList.innerHTML = [
        '<div class="topbar-notify-empty">',
        '<i class="bi bi-bell-slash"></i>',
        "<strong>새 알림이 없습니다.</strong>",
        "<span>최근 메시지와 멘션이 도착하면 여기에 표시됩니다.</span>",
        "</div>",
      ].join("");
      return;
    }

    dom.notifyList.innerHTML = state.notifications.map(function (item) {
      const avatar = item.sender_avatar_url
        ? '<img src="' + escapeHtml(item.sender_avatar_url) + '" alt="' + escapeHtml(item.sender_display_name || item.room_title) + '">'
        : escapeHtml(item.sender_avatar_initial || item.room_avatar_initial || "A");
      const kindClass = item.kind === "mention" ? " is-mention" : " is-message";
      const unreadClass = item.is_unread ? " is-unread" : "";
      return [
        '<button class="topbar-notify-item' + unreadClass + '" type="button" data-notify-room-id="' + Number(item.room_id || 0) + '" data-notify-message-id="' + Number(item.message_id || 0) + '">',
        '<span class="topbar-notify-item__avatar">' + avatar + "</span>",
        '<span class="topbar-notify-item__meta">',
        '<span class="topbar-notify-item__eyebrow">',
        '<span class="topbar-notify-item__badge' + kindClass + '">' + escapeHtml(item.kind_label || "새 메시지") + "</span>",
        '<span class="topbar-notify-item__room">' + escapeHtml(item.room_title || "대화방") + "</span>",
        "</span>",
        '<span class="topbar-notify-item__summary">' + escapeHtml(item.summary || item.preview || "") + "</span>",
        '<span class="topbar-notify-item__sub">' + escapeHtml(item.sender_department || "") + "</span>",
        "</span>",
        '<span class="topbar-notify-item__time">',
        '<span>' + escapeHtml(item.time_text || "") + "</span>",
        item.is_unread ? '<span class="topbar-notify-item__indicator"></span>' : "",
        "</span>",
        "</button>",
      ].join("");
    }).join("");

    Array.prototype.forEach.call(dom.notifyList.querySelectorAll("[data-notify-room-id]"), function (button) {
      button.addEventListener("click", function () {
        const roomId = Number(button.getAttribute("data-notify-room-id") || 0);
        const messageId = Number(button.getAttribute("data-notify-message-id") || 0);
        if (roomId > 0) {
          openRoom(roomId, messageId);
        }
      });
    });
  }

  function updateNotificationState(payload, counts) {
    const mergedItems = mergeNotificationItems(Array.isArray(payload && payload.items) ? payload.items : []);
    applyNotificationItems(mergedItems, counts);
  }

  function syncFilterTabs(filter) {
    if (!dom.filterTabs) return;
    Array.prototype.forEach.call(dom.filterTabs.querySelectorAll("[data-filter]"), function (button) {
      button.classList.toggle("is-active", normalizeText(button.getAttribute("data-filter")) === normalizeText(filter));
    });
  }

  function sidebarModeConfig(mode) {
    const unreadAlertCount = Number((state.notificationCounts && state.notificationCounts.unread_total) || 0);
    const mentionCount = Number((state.notificationCounts && state.notificationCounts.unread_mention_total) || 0);
    const recentCount = (state.roomHistory || []).length;
    if (mode === "inbox") {
      return {
        title: "수신함",
        metaHtml: "<span>알림 <strong>" + unreadAlertCount + "</strong></span>",
        hideFilters: true,
        hideSummary: true,
        hideQuick: true,
      };
    }
    if (mode === "unread") {
      return {
        title: "안 읽은 대화",
        metaHtml: "<span>대화 <strong>" + state.rooms.filter(function (room) { return Number(room.unread_count || 0) > 0; }).length + "</strong></span>",
        hideFilters: true,
        hideSummary: true,
        hideQuick: true,
      };
    }
    if (mode === "starred_shortcut") {
      return {
        title: "즐겨찾기",
        metaHtml: "<span>즐겨찾기 <strong>" + state.rooms.filter(function (room) { return !!room.is_starred; }).length + "</strong></span>",
        hideFilters: true,
        hideSummary: true,
        hideQuick: true,
      };
    }
    if (mode === "alerts") {
      return {
        title: "멘션 및 알림",
        metaHtml: "<span>멘션 <strong>" + mentionCount + "</strong></span><span>안 읽음 <strong>" + unreadAlertCount + "</strong></span>",
        hideFilters: true,
        hideSummary: true,
        hideQuick: true,
      };
    }
    if (mode === "recent") {
      return {
        title: "최근 본 대화",
        metaHtml: "<span>최근 기록 <strong>" + recentCount + "</strong></span>",
        hideFilters: true,
        hideSummary: true,
        hideQuick: true,
      };
    }
    if (mode === "guide") {
      return {
        title: "메신저 도움말",
        metaHtml: "<span>GUIDE</span>",
        hideFilters: true,
        hideSummary: true,
        hideQuick: true,
      };
    }
    if (mode === "settings") {
      return {
        title: "메신저 설정",
        metaHtml: "<span>LOCAL</span>",
        hideFilters: true,
        hideSummary: true,
        hideQuick: true,
      };
    }
    return {
      title: "채팅 목록",
      metaHtml: '<span>채널 <strong id="messengerChannelCount">' + String(state.rooms.filter(function (room) { return !!room.is_channel; }).length) + '</strong></span><span>그룹 <strong id="messengerGroupCount">' + String(state.rooms.filter(function (room) { return !!room.is_group; }).length) + '</strong></span>',
      hideFilters: false,
      hideSummary: false,
      hideQuick: false,
    };
  }

  function updateSidebarChrome() {
    const config = sidebarModeConfig(state.sidebarMode);
    if (dom.root) {
      dom.root.classList.toggle("is-inbox-mode", state.sidebarMode === "inbox" || state.sidebarMode === "alerts");
      dom.root.classList.toggle("is-utility-sidebar-mode", ["unread", "starred_shortcut", "alerts", "recent", "guide", "settings"].indexOf(state.sidebarMode) !== -1);
    }
    if (dom.filterTabs) dom.filterTabs.classList.toggle("d-none", !!config.hideFilters);
    if (dom.roomSummary) dom.roomSummary.classList.toggle("d-none", !!config.hideSummary);
    if (dom.quickSection) dom.quickSection.classList.toggle("d-none", !!config.hideQuick);
    if (dom.listSectionTitle) dom.listSectionTitle.textContent = config.title;
    if (dom.listSectionMeta) {
      dom.listSectionMeta.innerHTML = config.metaHtml || "";
      dom.listSectionMeta.classList.toggle("d-none", !config.metaHtml);
      dom.channelCount = $("messengerChannelCount");
      dom.groupCount = $("messengerGroupCount");
    }
  }

  function setSidebarMode(mode) {
    const allowedModes = {
      rooms: true,
      inbox: true,
      unread: true,
      starred_shortcut: true,
      alerts: true,
      recent: true,
      guide: true,
      settings: true,
    };
    state.sidebarMode = allowedModes[mode] ? mode : "rooms";
    if (dom.railRoomsBtn) dom.railRoomsBtn.classList.toggle("is-active", state.sidebarMode === "rooms");
    if (dom.railInboxBtn) dom.railInboxBtn.classList.toggle("is-active", state.sidebarMode === "inbox");
    if (dom.railUnreadBtn) dom.railUnreadBtn.classList.toggle("is-active", state.sidebarMode === "unread");
    if (dom.railStarredBtn) dom.railStarredBtn.classList.toggle("is-active", state.sidebarMode === "starred_shortcut");
    if (dom.railAlertsBtn) dom.railAlertsBtn.classList.toggle("is-active", state.sidebarMode === "alerts");
    if (dom.railRecentBtn) dom.railRecentBtn.classList.toggle("is-active", state.sidebarMode === "recent");
    if (dom.railGuideBtn) dom.railGuideBtn.classList.toggle("is-active", state.sidebarMode === "guide");
    if (dom.railSettingsBtn) dom.railSettingsBtn.classList.toggle("is-active", state.sidebarMode === "settings");
    updateSidebarChrome();
    renderRoomList();
  }

  function currentRoom() {
    return state.rooms.find(function (room) {
      return Number(room.id || 0) === Number(state.activeRoomId || 0);
    }) || null;
  }

  function filteredRooms() {
    const search = state.search.toLowerCase();
    return state.rooms.filter(function (room) {
      const filter = state.filter;
      if (filter === "starred" && !room.is_starred) return false;
      if (filter === "channel" && !room.is_channel) return false;
      if (filter === "group" && !room.is_group) return false;
      if (filter === "direct" && !room.is_direct) return false;

      if (!search) return true;
      const haystack = [
        room.title,
        room.subtitle,
        room.last_message_preview,
        room.member_names,
      ].join(" ").toLowerCase();
      return haystack.indexOf(search) !== -1;
    });
  }

  function filteredNotifications() {
    const search = state.search.toLowerCase();
    return (state.notifications || []).filter(function (item) {
      if (!search) return true;
      const haystack = [
        item.room_title,
        item.summary,
        item.preview,
        item.sender_display_name,
        item.sender_department,
      ].join(" ").toLowerCase();
      return haystack.indexOf(search) !== -1;
    });
  }

  function roomCardMarkup(room) {
    const unread = Number(room.unread_count || 0);
    const activeClass = Number(room.id || 0) === Number(state.activeRoomId || 0) ? " is-active" : "";
    const avatar = room.avatar_url
      ? '<img src="' + escapeAttribute(room.avatar_url) + '" alt="' + escapeHtml(room.title) + '">'
      : escapeHtml(room.avatar_initial || "C");
    const statusClass = room.is_direct
      ? ' class="messenger-avatar__status is-' + escapeHtml(room.presence_tone || "offline") + '"'
      : "";
    return [
      '<button class="messenger-room-card' + activeClass + '" type="button" data-room-id="' + Number(room.id || 0) + '">',
      '<span class="messenger-avatar">' + avatar + (room.is_direct ? '<span' + statusClass + '></span>' : "") + "</span>",
      '<span class="messenger-room-card__content">',
      '<span class="messenger-room-card__header">',
      '<strong class="messenger-room-card__title">' + escapeHtml(room.title) + "</strong>",
      '<span class="messenger-room-card__time">' + escapeHtml(room.last_message_time_text || "") + "</span>",
      "</span>",
      '<span class="messenger-room-card__subtitle">' + escapeHtml(room.subtitle || "") + "</span>",
      '<span class="messenger-room-card__preview">' + escapeHtml(room.last_message_preview || "대화를 시작해보세요.") + "</span>",
      "</span>",
      '<span class="messenger-room-card__aside">',
      room.is_starred ? '<i class="bi bi-star-fill messenger-room-card__star"></i>' : "",
      unread > 0 ? '<span class="messenger-room-card__unread">' + unread + "</span>" : "",
      "</span>",
      "</button>",
    ].join("");
  }

  function bindRoomListInteractions() {
    if (!dom.roomList) return;
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-room-id]"), function (button) {
      button.addEventListener("click", function () {
        const roomId = Number(button.getAttribute("data-room-id") || 0);
        if (roomId > 0) openRoom(roomId);
      });
      button.addEventListener("contextmenu", function (event) {
        showRoomContextMenu(event, findRoomById(Number(button.getAttribute("data-room-id") || 0)));
      });
    });
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-room-create]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        setModalMode(normalizeText(button.getAttribute("data-room-create")) || "dm");
        if (dom.newRoomModalInstance) dom.newRoomModalInstance.show();
      });
    });
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-guide-action]"), function (button) {
      button.addEventListener("click", function () {
        const action = normalizeText(button.getAttribute("data-guide-action"));
        if (action === "new-chat") {
          setModalMode("dm");
          if (dom.newRoomModalInstance) dom.newRoomModalInstance.show();
          return;
        }
        if (action === "open-inbox") {
          setSidebarMode("inbox");
          return;
        }
        if (action === "focus-search" && dom.roomSearch) {
          dom.roomSearch.focus();
          dom.roomSearch.select();
        }
      });
    });
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-pref-key]"), function (button) {
      button.addEventListener("click", function () {
        const key = normalizeText(button.getAttribute("data-pref-key"));
        if (!key) return;
        const nextValue = !state.preferences[key];
        state.preferences[key] = nextValue;
        persistPreferences();
        applyPreferences();
      });
    });
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-inbox-room-id]"), function (button) {
      button.addEventListener("click", function () {
        openRoom(
          Number(button.getAttribute("data-inbox-room-id") || 0),
          Number(button.getAttribute("data-inbox-message-id") || 0)
        );
      });
      button.addEventListener("contextmenu", function (event) {
        showRoomContextMenu(event, findRoomById(Number(button.getAttribute("data-inbox-room-id") || 0)));
      });
    });
  }

  function renderInboxList(items, emptyTitle, emptyCopy) {
    if (!dom.roomList) return;
    if (!items.length) {
      dom.roomList.innerHTML = [
        '<div class="messenger-empty-state">',
        '<i class="bi bi-inbox"></i>',
        "<strong>" + escapeHtml(emptyTitle) + "</strong>",
        "<span>" + escapeHtml(emptyCopy) + "</span>",
        "</div>",
      ].join("");
      return;
    }
    dom.roomList.innerHTML = items.map(function (item) {
      const avatar = item.sender_avatar_url
        ? '<img src="' + escapeAttribute(item.sender_avatar_url) + '" alt="' + escapeHtml(item.sender_display_name || item.room_title) + '">'
        : escapeHtml(item.sender_avatar_initial || "U");
      const unreadClass = item.is_unread ? " is-unread" : "";
      const badgeClass = item.kind === "mention" ? "messenger-inbox-card__badge is-mention" : "messenger-inbox-card__badge";
      return [
        '<button class="messenger-inbox-card' + unreadClass + '" type="button" data-inbox-room-id="' + Number(item.room_id || 0) + '" data-inbox-message-id="' + Number(item.message_id || 0) + '">',
        '<span class="messenger-contact-avatar">' + avatar + "</span>",
        '<span class="messenger-inbox-card__meta">',
        '<span class="messenger-inbox-card__eyebrow">',
        '<span class="' + badgeClass + '">' + escapeHtml(item.kind_label || "알림") + "</span>",
        '<strong class="messenger-inbox-card__room">' + escapeHtml(item.room_title || "대화방") + "</strong>",
        "</span>",
        '<span class="messenger-inbox-card__summary">' + escapeHtml(item.summary || item.preview || "") + "</span>",
        '<span class="messenger-inbox-card__sub">' + escapeHtml(item.sender_department || item.sender_display_name || "") + "</span>",
        "</span>",
        '<span class="messenger-inbox-card__time"><span>' + escapeHtml(item.time_text || "") + "</span>" + (item.is_unread ? '<span class="messenger-room-card__unread">N</span>' : "") + "</span>",
        "</button>",
      ].join("");
    }).join("");
  }

  function renderFlatRoomList(rooms, emptyTitle, emptyCopy) {
    if (!dom.roomList) return;
    if (!rooms.length) {
      dom.roomList.innerHTML = [
        '<div class="messenger-empty-state">',
        '<i class="bi bi-chat-left-dots"></i>',
        "<strong>" + escapeHtml(emptyTitle) + "</strong>",
        "<span>" + escapeHtml(emptyCopy) + "</span>",
        "</div>",
      ].join("");
      return;
    }
    dom.roomList.innerHTML = rooms.map(roomCardMarkup).join("");
  }

  function renderGuideList() {
    if (!dom.roomList) return;
    dom.roomList.innerHTML = [
      '<div class="messenger-side-stack">',
      '<section class="messenger-side-card">',
      '<strong>빠른 사용법</strong>',
      '<span>Enter 전송, Shift+Enter 줄바꿈, ESC 닫기. @ 버튼으로 멘션, 클립 버튼으로 파일 첨부를 사용할 수 있습니다.</span>',
      '</section>',
      '<section class="messenger-side-card">',
      '<strong>레이 버튼 안내</strong>',
      '<span>안 읽은 대화, 즐겨찾기, 멘션/알림, 최근 본 대화, 설정을 한 번에 이동할 수 있습니다.</span>',
      '</section>',
      '<section class="messenger-side-card messenger-side-card--actions">',
      '<button type="button" data-guide-action="new-chat"><i class="bi bi-plus-circle"></i><span>새 대화 시작</span></button>',
      '<button type="button" data-guide-action="open-inbox"><i class="bi bi-inbox"></i><span>수신함 열기</span></button>',
      '<button type="button" data-guide-action="focus-search"><i class="bi bi-search"></i><span>대화 검색 포커스</span></button>',
      '</section>',
      '</div>',
    ].join("");
  }

  function renderSettingsList() {
    if (!dom.roomList) return;
    const preferences = state.preferences || {};
    const row = function (key, title, copy) {
      return [
        '<button class="messenger-setting-row" type="button" data-pref-key="' + escapeAttribute(key) + '">',
        '<span class="messenger-setting-row__copy">',
        '<strong>' + escapeHtml(title) + "</strong>",
        '<span>' + escapeHtml(copy) + "</span>",
        "</span>",
        '<span class="messenger-setting-row__state' + (preferences[key] ? ' is-on' : '') + '">' + (preferences[key] ? 'ON' : 'OFF') + "</span>",
        "</button>",
      ].join("");
    };
    dom.roomList.innerHTML = [
      '<div class="messenger-side-stack">',
      '<section class="messenger-side-card">',
      '<strong>메신저 동작 설정</strong>',
      '<span>이 설정은 현재 브라우저에 저장되며 ABBAS Talk 팝업 동작에만 적용됩니다.</span>',
      '</section>',
      '<section class="messenger-side-card messenger-side-card--settings">',
      row("rememberPosition", "팝업 위치 기억", "메신저를 다시 열어도 마지막 위치를 유지합니다."),
      row("showTyping", "입력 중 표시", "상대가 입력 중일 때 하단 타이핑 바를 보여줍니다."),
      row("enterToSend", "Enter로 전송", "끄면 Ctrl+Enter 또는 Cmd+Enter로 전송합니다."),
      '</section>',
      '</div>',
    ].join("");
  }

  function renderRoomList() {
    if (!dom.roomList) return;
    updateSidebarChrome();
    if (state.sidebarMode === "inbox") {
      renderInboxList(
        filteredNotifications(),
        "수신함이 비어 있습니다.",
        "최근 메시지와 멘션이 여기에 모입니다."
      );
      bindRoomListInteractions();
      return;
    }
    if (state.sidebarMode === "alerts") {
      renderInboxList(
        filteredNotifications().filter(function (item) {
          return !!item.is_unread || item.kind === "mention";
        }),
        "확인할 멘션이나 알림이 없습니다.",
        "새 멘션과 읽지 않은 알림만 여기에 표시됩니다."
      );
      bindRoomListInteractions();
      return;
    }
    if (state.sidebarMode === "unread") {
      renderFlatRoomList(
        filteredRooms().filter(function (room) {
          return Number(room.unread_count || 0) > 0;
        }),
        "안 읽은 대화가 없습니다.",
        "새 메시지가 오면 이 목록에 바로 모입니다."
      );
      bindRoomListInteractions();
      return;
    }
    if (state.sidebarMode === "starred_shortcut") {
      renderFlatRoomList(
        filteredRooms().filter(function (room) {
          return !!room.is_starred;
        }),
        "즐겨찾기한 대화가 없습니다.",
        "대화방 헤더의 별 버튼으로 즐겨찾기를 추가할 수 있습니다."
      );
      bindRoomListInteractions();
      return;
    }
    if (state.sidebarMode === "recent") {
      const roomMap = {};
      state.rooms.forEach(function (room) {
        roomMap[Number(room.id || 0)] = room;
      });
      renderFlatRoomList(
        (state.roomHistory || []).map(function (roomId) {
          return roomMap[Number(roomId || 0)] || null;
        }).filter(Boolean),
        "최근 본 대화가 없습니다.",
        "대화를 열어보면 최근 기록이 여기에 저장됩니다."
      );
      bindRoomListInteractions();
      return;
    }
    if (state.sidebarMode === "guide") {
      renderGuideList();
      bindRoomListInteractions();
      return;
    }
    if (state.sidebarMode === "settings") {
      renderSettingsList();
      bindRoomListInteractions();
      return;
    }

    const rooms = filteredRooms();
    if (!rooms.length) {
      dom.roomList.innerHTML = [
        '<div class="messenger-empty-state">',
        '<i class="bi bi-chat-left-dots"></i>',
        "<strong>검색 결과가 없습니다.</strong>",
        "<span>조건을 바꾸거나 새 대화를 시작해보세요.</span>",
        "</div>",
      ].join("");
      return;
    }

    const groups = {
      starred: { label: "즐겨찾기", rooms: [], createMode: "" },
      channel: { label: "공개 그룹", rooms: [], createMode: "" },
      group: { label: "비공개 그룹", rooms: [], createMode: "group" },
      direct: { label: "다이렉트 메시지", rooms: [], createMode: "dm" },
    };

    rooms.forEach(function (room) {
      const key = room.section || (room.is_direct ? "direct" : (room.is_channel ? "channel" : "group"));
      if (groups[key]) groups[key].rooms.push(room);
    });

    const sections = ["starred", "channel", "group", "direct"].map(function (key) {
      const section = groups[key];
      if (!section.rooms.length) return "";
      const cards = section.rooms.map(roomCardMarkup).join("");

      return [
        '<section class="messenger-room-group">',
        '<div class="messenger-room-group__label"><span>' + escapeHtml(section.label) + "</span><div><strong>" + section.rooms.length + "</strong>" + (section.createMode ? '<button type="button" data-room-create="' + escapeHtml(section.createMode) + '" aria-label="새 대화"><i class="bi bi-plus-lg"></i></button>' : "") + "</div></div>",
        cards,
        "</section>",
      ].join("");
    }).join("");

    dom.roomList.innerHTML = sections;
    bindRoomListInteractions();
  }

  function messageExists(roomId, messageId) {
    const messages = state.messagesByRoom[roomId] || [];
    return messages.some(function (message) {
      return Number(message.id || 0) === Number(messageId || 0);
    });
  }

  function detectMessageAttachment(content) {
    const text = String(content || "");
    const urlMatch = text.match(/https?:\/\/[^\s<>"']+/i);
    if (urlMatch && urlMatch[0]) {
      const url = String(urlMatch[0] || "").trim();
      const cleaned = url.replace(/^https?:\/\//i, "");
      return {
        raw: url,
        kind: /\.(png|jpg|jpeg|gif|webp)$/i.test(cleaned) ? "image" : "link",
        title: cleaned,
        meta: "link",
        icon: /\.(png|jpg|jpeg|gif|webp)$/i.test(cleaned) ? "bi-image-fill" : "bi-link-45deg",
      };
    }
    const fileMatch = text.match(/(^|[\s(])([A-Za-z0-9._-]+\.(pdf|png|jpg|jpeg|gif|docx?|xlsx?|pptx?|zip|csv|txt))(?!\S)/i);
    if (fileMatch && fileMatch[2]) {
      const fileName = String(fileMatch[2] || "").trim();
      return {
        raw: fileName,
        kind: "file",
        title: fileName,
        meta: fileName.split(".").pop().toLowerCase(),
        icon: /\.pdf$/i.test(fileName) ? "bi-file-earmark-pdf-fill" : "bi-file-earmark-fill",
      };
    }
    return null;
  }

  function renderMessageBubbleContent(message) {
    const content = String((message && message.content) || "");
    const structuredAttachment = parseAttachment(message);
    const attachment = structuredAttachment || detectMessageAttachment(content);
    const cleanText = attachment
      ? normalizeText(content.replace(attachment.raw, " "))
      : content;
    const parts = [];
    if (cleanText) {
      parts.push('<div class="messenger-message-text">' + formatRichText(cleanText) + "</div>");
    }
    if (attachment) {
      const href = normalizeText(attachment.url || attachment.raw);
      parts.push([
        '<div class="messenger-attachment-card">',
        '<span class="messenger-attachment-card__icon"><i class="bi ' + escapeHtml(attachment.icon || "bi-link-45deg") + '"></i></span>',
        '<span class="messenger-attachment-card__meta">',
        '<strong>' + escapeHtml(attachment.title || "") + "</strong>",
        '<span>' + escapeHtml(attachment.meta || "") + "</span>",
        "</span>",
        href
          ? '<a class="messenger-attachment-card__action" href="' + escapeAttribute(href) + '" target="_blank" rel="noopener noreferrer"><i class="bi bi-box-arrow-up-right"></i></a>'
          : '<span class="messenger-attachment-card__action"><i class="bi bi-box-arrow-up-right"></i></span>',
        "</div>",
      ].join(""));
    }
    if (!parts.length) {
      parts.push('<div class="messenger-message-text">' + formatRichText(content) + "</div>");
    }
    return parts.join("");
  }

  function renderMessages() {
    if (!dom.messageList || !dom.conversationEmpty) return;
    const room = state.activeRoom;
    if (!room) {
      dom.conversationEmpty.classList.remove("d-none");
      dom.messageList.classList.add("d-none");
      dom.messageList.innerHTML = "";
      return;
    }

    const messages = state.messagesByRoom[room.id] || [];
    dom.conversationEmpty.classList.add("d-none");
    dom.messageList.classList.remove("d-none");

    let lastDate = "";
    const html = messages.map(function (message) {
      const pieces = [];
      const dateLabel = normalizeText(message.created_date);
      if (dateLabel && dateLabel !== lastDate) {
        lastDate = dateLabel;
        pieces.push('<div class="messenger-day-divider"><span>' + escapeHtml(dateLabel) + "</span></div>");
      }

      const mineClass = message.is_mine ? " is-mine" : "";
      const displayName = normalizeText(message.sender_display_name || message.sender_nickname || message.sender_user_id || "사용자");
      const secondaryMeta = [];
      if (normalizeText(message.sender_nickname) && normalizeText(message.sender_nickname) !== displayName) {
        secondaryMeta.push("@" + normalizeText(message.sender_nickname));
      } else if (normalizeText(message.sender_name) && normalizeText(message.sender_name) !== displayName) {
        secondaryMeta.push(normalizeText(message.sender_name));
      }
      if (normalizeText(message.sender_department)) {
        secondaryMeta.push(normalizeText(message.sender_department));
      }
      const avatar = message.sender_avatar_url
        ? '<img src="' + escapeHtml(message.sender_avatar_url) + '" alt="' + escapeHtml(message.sender_display_name) + '">'
        : escapeHtml(message.sender_avatar_initial || "U");
      const avatarButton = [
        '<button class="messenger-message-avatar messenger-message-avatar--button" type="button" data-user-profile-id="' + escapeAttribute(message.sender_user_id || "") + '" data-message-id="' + Number(message.id || 0) + '" aria-label="' + escapeAttribute(displayName + " 프로필 보기") + '">',
        avatar,
        "</button>",
      ].join("");
      const authorLine = [
        '<div class="messenger-message-author">',
        "<span>" + escapeHtml(displayName) + "</span>",
        secondaryMeta.length ? "<span>" + escapeHtml(secondaryMeta.join(" · ")) + "</span>" : "",
        "</div>",
      ].join("");

      pieces.push([
        '<div class="messenger-message-row' + mineClass + '" data-message-id="' + Number(message.id || 0) + '">',
        message.is_mine ? "" : avatarButton,
        '<div class="messenger-message-meta">',
        authorLine,
        '<div class="messenger-message-bubble">' + renderMessageBubbleContent(message) + "</div>",
        '<div class="messenger-message-foot"><span>' + escapeHtml(message.time_text || "") + "</span>" + (message.edited ? "<span>수정됨</span>" : "") + "</div>",
        "</div>",
        message.is_mine ? avatarButton : "",
        "</div>",
      ].join(""));
      return pieces.join("");
    }).join("");

    dom.messageList.innerHTML = html || [
      '<div class="messenger-empty-state messenger-empty-state--large">',
      '<i class="bi bi-chat-heart"></i>',
      "<strong>아직 메시지가 없습니다.</strong>",
      "<span>첫 메시지를 보내서 대화를 시작해보세요.</span>",
      "</div>",
    ].join("");
    Array.prototype.forEach.call(dom.messageList.querySelectorAll("[data-message-id]"), function (row) {
      row.addEventListener("contextmenu", function (event) {
        showMessageContextMenu(
          event,
          findMessageById(state.activeRoomId, Number(row.getAttribute("data-message-id") || 0))
        );
      });
    });
    Array.prototype.forEach.call(dom.messageList.querySelectorAll("[data-user-profile-id]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        const messageId = Number(button.getAttribute("data-message-id") || 0);
        showUserProfileModal(
          normalizeText(button.getAttribute("data-user-profile-id")),
          findMessageById(state.activeRoomId, messageId)
        );
      });
    });
    highlightPendingMessage();
  }

  function highlightPendingMessage() {
    const messageId = Number(state.highlightMessageId || 0);
    if (!messageId || !dom.messageList) return;
    const target = dom.messageList.querySelector('[data-message-id="' + messageId + '"]');
    if (!target) return;
    state.highlightMessageId = 0;
    window.requestAnimationFrame(function () {
      target.classList.add("is-focus-target");
      try {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (_) {
        target.scrollIntoView();
      }
      window.setTimeout(function () {
        target.classList.remove("is-focus-target");
      }, 1800);
    });
  }

  function renderTyping() {
    return;
  }

  function bindRoomInfoInteractions() {
    if (!dom.roomInfo) return;
    dom.roomInfo.oncontextmenu = function (event) {
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest("[data-room-avatar-action], [data-room-avatar-preset], button, a, input, textarea, select")) {
        return;
      }
      showRoomContextMenu(event, state.activeRoom);
    };
    Array.prototype.forEach.call(dom.roomInfo.querySelectorAll("[data-room-avatar-preset]"), function (button) {
      button.addEventListener("click", function () {
        const room = state.activeRoom;
        if (!canEditRoomAvatar(room)) return;
        updateRoomAvatarPreset(normalizeText(button.getAttribute("data-room-avatar-preset")));
      });
    });
    Array.prototype.forEach.call(dom.roomInfo.querySelectorAll("[data-room-avatar-action]"), function (button) {
      button.addEventListener("click", function () {
        const action = normalizeText(button.getAttribute("data-room-avatar-action"));
        if (action === "upload" && dom.roomAvatarInput) {
          dom.roomAvatarInput.click();
          return;
        }
        if (action === "clear") {
          updateRoomAvatarPreset("");
        }
      });
    });
    if (dom.participantList) {
      Array.prototype.forEach.call(dom.participantList.querySelectorAll("[data-participant-user-id]"), function (card) {
        card.addEventListener("contextmenu", function (event) {
          showParticipantContextMenu(event, normalizeText(card.getAttribute("data-participant-user-id")));
        });
      });
    }
  }

  function renderInspector() {
    if (!dom.roomInfo || !dom.participantList || !dom.participantCount || !dom.inspectorBadge) return;
    const room = state.activeRoom;
    if (!room) {
      dom.roomInfo.innerHTML = '<div class="messenger-empty-inline">대화방을 선택하면 상세 정보가 표시됩니다.</div>';
      dom.participantList.innerHTML = '<div class="messenger-empty-inline">참여자 목록이 여기에 표시됩니다.</div>';
      dom.participantCount.textContent = "0명";
      dom.inspectorBadge.textContent = "-";
      if (dom.inviteMemberBtn) {
        dom.inviteMemberBtn.classList.add("d-none");
        dom.inviteMemberBtn.disabled = true;
      }
      renderResourceList();
      return;
    }

    dom.inspectorBadge.textContent = room.is_direct ? "DM" : (room.is_channel ? "CHANNEL" : "GROUP");
    dom.participantCount.textContent = String(Number(room.member_count || 0)) + "명";
    if (dom.inviteMemberBtn) {
      const canInvite = canManageRoom(room) && !room.is_direct;
      const inviteCandidates = canInvite ? inviteCandidateContacts(room) : [];
      dom.inviteMemberBtn.classList.toggle("d-none", !canInvite);
      dom.inviteMemberBtn.disabled = !canInvite || !inviteCandidates.length;
      dom.inviteMemberBtn.setAttribute("title", inviteCandidates.length ? "구성원 초대" : "추가로 초대할 수 있는 구성원이 없습니다.");
    }

    dom.roomInfo.innerHTML = [
      canEditRoomAvatar(room) ? [
        '<div class="messenger-room-avatar-editor">',
        '<div class="messenger-room-avatar-editor__head">',
        '<span class="messenger-room-avatar-editor__preview">' + roomAvatarHtml(room) + "</span>",
        '<div class="messenger-room-avatar-editor__copy">',
        "<strong>방 프로필 이미지</strong>",
        "<span>기본 이미지 10종 또는 업로드 이미지로 채널/그룹방 대표 이미지를 바꿀 수 있습니다.</span>",
        "</div>",
        "</div>",
        '<div class="messenger-room-avatar-editor__actions">',
        '<button type="button" data-room-avatar-action="upload"><i class="bi bi-upload"></i><span>이미지 업로드</span></button>',
        '<button type="button" data-room-avatar-action="clear"><i class="bi bi-arrow-counterclockwise"></i><span>기본 상태로 초기화</span></button>',
        "</div>",
        '<div class="messenger-room-avatar-editor__presets">',
        ROOM_AVATAR_PRESETS.map(function (preset) {
          const activeClass = normalizeText(room.avatar_url) === preset.url ? " is-active" : "";
          return '<button class="messenger-room-avatar-preset' + activeClass + '" type="button" data-room-avatar-preset="' + escapeAttribute(preset.url) + '"><img src="' + escapeAttribute(preset.url) + '" alt="' + escapeAttribute(preset.label) + '"></button>';
        }).join(""),
        "</div>",
        "</div>",
      ].join("") : [
        '<div class="messenger-room-avatar-editor messenger-room-avatar-editor--readonly">',
        '<div class="messenger-room-avatar-editor__head">',
        '<span class="messenger-room-avatar-editor__preview">' + roomAvatarHtml(room) + "</span>",
        '<div class="messenger-room-avatar-editor__copy">',
        "<strong>프로필 이미지</strong>",
        "<span>1:1 대화는 상대 구성원 프로필 이미지를 사용합니다.</span>",
        "</div>",
        "</div>",
        "</div>",
      ].join(""),
      '<div class="messenger-room-info__hero">',
      "<strong>" + escapeHtml(room.title) + "</strong>",
      "<span>" + escapeHtml(room.topic || room.subtitle || "") + "</span>",
      "</div>",
      '<div class="messenger-room-info__meta">',
      '<div class="messenger-room-info__chip"><span>구분</span><strong>' + escapeHtml(room.is_direct ? "1:1 대화" : (room.is_channel ? "채널" : "그룹방")) + "</strong></div>",
      '<div class="messenger-room-info__chip"><span>참여자</span><strong>' + escapeHtml(String(room.member_count || 0) + "명") + "</strong></div>",
      '<div class="messenger-room-info__chip"><span>활성 멤버</span><strong>' + escapeHtml(String(room.active_member_count || 0) + "명") + "</strong></div>",
      '<div class="messenger-room-info__chip"><span>최근 메시지</span><strong>' + escapeHtml(room.last_message_time_text || "-") + "</strong></div>",
      "</div>",
    ].join("");
    bindRoomInfoInteractions();

    dom.participantList.innerHTML = (room.members || []).map(function (member) {
      const avatar = member.profile_image_url
        ? '<img src="' + escapeHtml(member.profile_image_url) + '" alt="' + escapeHtml(member.display_name) + '">'
        : escapeHtml(member.avatar_initial || "U");
      return [
        '<div class="messenger-participant-card" data-participant-user-id="' + escapeAttribute(member.user_id || "") + '">',
        '<span class="messenger-contact-avatar">' + avatar + '<span class="messenger-contact-avatar__status is-' + escapeHtml(member.presence_tone || "offline") + '"></span></span>',
        '<div class="messenger-participant-card__meta">',
        "<strong>" + escapeHtml(member.display_name || member.user_id) + "</strong>",
        "<span>" + escapeHtml(member.department || member.presence_label || "구성원") + "</span>",
        "</div>",
        '<span class="messenger-participant-card__badge">' + escapeHtml(member.member_role || "member") + "</span>",
        "</div>",
      ].join("");
    }).join("") || '<div class="messenger-empty-inline">참여자 목록이 없습니다.</div>';
    renderResourceList();
  }

  function renderQuickContacts() {
    if (!dom.quickContactList) return;
    const contacts = (state.contacts || []).slice(0, 6);
    if (!contacts.length) {
      dom.quickContactList.innerHTML = '<div class="messenger-empty-inline">표시할 구성원이 없습니다.</div>';
      return;
    }
    dom.quickContactList.innerHTML = contacts.map(function (contact) {
      const avatar = contact.profile_image_url
        ? '<img src="' + escapeHtml(contact.profile_image_url) + '" alt="' + escapeHtml(contact.display_name) + '">'
        : escapeHtml(contact.avatar_initial || "U");
      return [
        '<button class="messenger-contact-card" type="button" data-contact-id="' + escapeHtml(contact.user_id) + '">',
        '<span class="messenger-contact-avatar">' + avatar + '<span class="messenger-contact-avatar__status is-' + escapeHtml(contact.presence_tone || "offline") + '"></span></span>',
        '<span class="messenger-contact-card__meta">',
        "<strong>" + escapeHtml(contact.display_name) + "</strong>",
        "<span>" + escapeHtml(contact.department || contact.presence_label || "구성원") + "</span>",
        "</span>",
        '<span class="messenger-contact-card__badge">' + escapeHtml(contact.presence_label || "오프라인") + "</span>",
        "</button>",
      ].join("");
    }).join("");

    Array.prototype.forEach.call(dom.quickContactList.querySelectorAll("[data-contact-id]"), function (button) {
      button.addEventListener("click", function () {
        const targetUserId = normalizeText(button.getAttribute("data-contact-id"));
        if (targetUserId) createDirectRoom(targetUserId);
      });
    });
  }

  function buildResourceItems(roomId) {
    const messages = (state.messagesByRoom[roomId] || []).slice().reverse();
    const items = [];
    const seen = new Set();
    const filePattern = /(^|[\s(])([A-Za-z0-9._-]+\.(pdf|png|jpg|jpeg|gif|docx?|xlsx?|pptx?|zip|csv|txt))(?!\S)/ig;
    const urlPattern = /(https?:\/\/[^\s<>"']+)/ig;

    messages.forEach(function (message) {
      const structuredAttachment = parseAttachment(message);
      if (structuredAttachment && items.length < 8) {
        const key = "a:" + normalizeText(structuredAttachment.url || structuredAttachment.name);
        if (!seen.has(key)) {
          seen.add(key);
          items.push({
            type: structuredAttachment.kind,
            title: structuredAttachment.title || structuredAttachment.name,
            subtitle: (message.sender_display_name || "") + " · " + (message.time_text || ""),
            icon: structuredAttachment.icon,
            url: structuredAttachment.url || "",
          });
        }
        return;
      }
      const content = String((message && message.content) || "");
      urlPattern.lastIndex = 0;
      filePattern.lastIndex = 0;
      let match;
      while ((match = urlPattern.exec(content)) && items.length < 8) {
        const url = String(match[1] || "").trim();
        if (!url || seen.has("u:" + url)) continue;
        seen.add("u:" + url);
        items.push({
          type: "link",
          title: url.replace(/^https?:\/\//i, ""),
          subtitle: (message.sender_display_name || "") + " · " + (message.time_text || ""),
          icon: "bi-link-45deg",
          url: url,
        });
      }
      while ((match = filePattern.exec(content)) && items.length < 8) {
        const fileName = String(match[2] || "").trim();
        if (!fileName || seen.has("f:" + fileName)) continue;
        seen.add("f:" + fileName);
        items.push({
          type: "file",
          title: fileName,
          subtitle: (message.sender_display_name || "") + " · " + (message.time_text || ""),
          icon: /\.pdf$/i.test(fileName) ? "bi-file-earmark-pdf-fill" : "bi-file-earmark-fill",
          url: "",
        });
      }
    });
    return items;
  }

  function renderResourceList() {
    if (!dom.resourceList) return;
    const room = state.activeRoom;
    if (!room) {
      dom.resourceList.innerHTML = '<div class="messenger-empty-inline">메시지에 공유된 링크와 파일이 여기에 표시됩니다.</div>';
      return;
    }
    const resources = buildResourceItems(room.id);
    if (!resources.length) {
      dom.resourceList.innerHTML = '<div class="messenger-empty-inline">아직 공유된 링크나 파일이 없습니다.</div>';
      return;
    }
    dom.resourceList.innerHTML = resources.map(function (resource) {
      const tagName = resource.url ? "a" : "div";
      const hrefAttrs = resource.url
        ? ' href="' + escapeAttribute(resource.url) + '" target="_blank" rel="noopener noreferrer"'
        : "";
      return [
        "<" + tagName + ' class="messenger-resource-item" data-resource-url="' + escapeAttribute(resource.url || "") + '" data-resource-title="' + escapeAttribute(resource.title || "") + '"' + hrefAttrs + ">",
        '<span class="messenger-resource-item__thumb"><i class="bi ' + escapeHtml(resource.icon || "bi-link-45deg") + '"></i></span>',
        '<div class="messenger-resource-item__meta">',
        '<strong>' + escapeHtml(resource.title || "") + "</strong>",
        '<span>' + escapeHtml(resource.subtitle || "") + "</span>",
        "</div>",
        "</" + tagName + ">",
      ].join("");
    }).join("");
    Array.prototype.forEach.call(dom.resourceList.querySelectorAll("[data-resource-title]"), function (item) {
      item.addEventListener("contextmenu", function (event) {
        showResourceContextMenu(
          event,
          normalizeText(item.getAttribute("data-resource-url")),
          normalizeText(item.getAttribute("data-resource-title"))
        );
      });
    });
  }

  function roomDeepLink(room) {
    if (!room || !room.id) return "";
    return window.location.origin + "/message?room_id=" + Number(room.id || 0);
  }

  function setRoomMoreMenuOpen(open) {
    state.roomMoreMenuOpen = !!open && !!state.activeRoom;
    if (dom.roomMoreBtn) {
      dom.roomMoreBtn.setAttribute("aria-expanded", state.roomMoreMenuOpen ? "true" : "false");
    }
    if (dom.roomMoreMenu) {
      dom.roomMoreMenu.classList.toggle("is-open", state.roomMoreMenuOpen);
      dom.roomMoreMenu.setAttribute("aria-hidden", state.roomMoreMenuOpen ? "false" : "true");
    }
  }

  function setComposerPopover(type) {
    state.composerPopover = type || "";
    if (dom.emojiPicker) {
      dom.emojiPicker.classList.toggle("is-open", state.composerPopover === "emoji");
      dom.emojiPicker.setAttribute("aria-hidden", state.composerPopover === "emoji" ? "false" : "true");
    }
    if (dom.mentionPicker) {
      dom.mentionPicker.classList.toggle("is-open", state.composerPopover === "mention");
      dom.mentionPicker.setAttribute("aria-hidden", state.composerPopover === "mention" ? "false" : "true");
    }
  }

  function renderRoomMoreMenu() {
    if (!dom.roomMoreMenu) return;
    const room = state.activeRoom;
    if (!room) {
      dom.roomMoreMenu.innerHTML = "";
      setRoomMoreMenuOpen(false);
      return;
    }
    dom.roomMoreMenu.innerHTML = [
      '<button type="button" data-room-menu-action="copy-link"><i class="bi bi-link-45deg"></i><span>대화 링크 복사</span></button>',
      '<button type="button" data-room-menu-action="toggle-mute"><i class="bi ' + (room.is_muted ? 'bi-bell-fill' : 'bi-bell-slash') + '"></i><span>' + (room.is_muted ? '알림 켜기' : '알림 끄기') + '</span></button>',
      '<button type="button" data-room-menu-action="toggle-star"><i class="bi ' + (room.is_starred ? 'bi-star-fill' : 'bi-star') + '"></i><span>' + (room.is_starred ? '즐겨찾기 해제' : '즐겨찾기 추가') + '</span></button>',
      room.can_edit_room ? '<button type="button" data-room-menu-action="edit-room"><i class="bi bi-pencil-square"></i><span>대화방 정보 수정</span></button>' : '',
      room.can_delete_room ? '<button type="button" data-room-menu-action="delete-room"><i class="bi bi-trash3"></i><span>대화방 삭제</span></button>' : '',
      '<button type="button" data-room-menu-action="refresh-room"><i class="bi bi-arrow-repeat"></i><span>대화 새로고침</span></button>',
    ].join("");
  }

  function insertComposerText(text, wrapSuffix) {
    if (!dom.composerInput) return;
    const input = dom.composerInput;
    const prefix = String(text || "");
    const suffix = String(wrapSuffix || "");
    const start = Number(input.selectionStart || 0);
    const end = Number(input.selectionEnd || 0);
    const value = String(input.value || "");
    const selectedText = value.slice(start, end);
    const nextValue = value.slice(0, start) + prefix + selectedText + suffix + value.slice(end);
    input.value = nextValue;
    const caret = start + prefix.length + selectedText.length + suffix.length;
    input.focus();
    try {
      const nextSelectionStart = start + prefix.length;
      const nextSelectionEnd = start + prefix.length + selectedText.length;
      if (selectedText && suffix) {
        input.setSelectionRange(nextSelectionStart, nextSelectionEnd);
      } else {
        input.setSelectionRange(caret, caret);
      }
    } catch (_) {}
    resizeComposer();
    scheduleTypingEvent();
  }

  function renderEmojiPicker() {
    if (!dom.emojiPicker) return;
    dom.emojiPicker.innerHTML = '<div class="messenger-emoji-grid">' + EMOJI_SET.map(function (emoji) {
      return '<button type="button" data-emoji="' + escapeAttribute(emoji) + '">' + escapeHtml(emoji) + "</button>";
    }).join("") + "</div>";
    Array.prototype.forEach.call(dom.emojiPicker.querySelectorAll("[data-emoji]"), function (button) {
      button.addEventListener("click", function () {
        insertComposerText(String(button.getAttribute("data-emoji") || ""));
        setComposerPopover("");
      });
    });
  }

  function renderMentionPicker() {
    if (!dom.mentionPicker) return;
    const contacts = (state.contacts || []).slice(0, 16);
    if (!contacts.length) {
      dom.mentionPicker.innerHTML = '<div class="messenger-empty-inline">멘션할 구성원이 없습니다.</div>';
      return;
    }
    dom.mentionPicker.innerHTML = contacts.map(function (contact) {
      const avatar = contact.profile_image_url
        ? '<img src="' + escapeAttribute(contact.profile_image_url) + '" alt="' + escapeHtml(contact.display_name) + '">'
        : escapeHtml(contact.avatar_initial || "U");
      return [
        '<button class="messenger-mention-option" type="button" data-mention-name="' + escapeAttribute(contact.display_name || contact.user_id) + '">',
        '<span class="messenger-mention-option__avatar">' + avatar + "</span>",
        '<span class="messenger-mention-option__meta">',
        '<strong>' + escapeHtml(contact.display_name || contact.user_id) + "</strong>",
        '<span>' + escapeHtml(contact.department || contact.presence_label || "구성원") + "</span>",
        "</span>",
        "</button>",
      ].join("");
    }).join("");
    Array.prototype.forEach.call(dom.mentionPicker.querySelectorAll("[data-mention-name]"), function (button) {
      button.addEventListener("click", function () {
        insertComposerText("@" + normalizeText(button.getAttribute("data-mention-name")) + " ");
        setComposerPopover("");
      });
    });
  }

  function renderHeader() {
    const room = state.activeRoom;
    const avatar = room && room.avatar_url
      ? '<img src="' + escapeHtml(room.avatar_url) + '" alt="' + escapeHtml(room.title) + '">'
      : escapeHtml((room && room.avatar_initial) || "A");
    if (dom.activeRoomAvatar) dom.activeRoomAvatar.innerHTML = avatar;
    if (dom.activeRoomTitle) dom.activeRoomTitle.textContent = room ? normalizeText(room.title) : "대화방 선택";
    if (dom.activeRoomSubtitle) dom.activeRoomSubtitle.textContent = room ? normalizeText(room.subtitle || room.topic || "") : "왼쪽 목록에서 대화방을 선택하면 메시지를 볼 수 있습니다.";

    const enabled = !!room;
    if (dom.starToggleBtn) {
      dom.starToggleBtn.disabled = !enabled;
      dom.starToggleBtn.innerHTML = room && room.is_starred
        ? '<i class="bi bi-star-fill"></i>'
        : '<i class="bi bi-star"></i>';
      dom.starToggleBtn.setAttribute("title", room && room.is_starred ? "즐겨찾기 해제" : "즐겨찾기");
      dom.starToggleBtn.setAttribute("aria-label", room && room.is_starred ? "즐겨찾기 해제" : "즐겨찾기");
    }
    if (dom.roomRefreshBtn) dom.roomRefreshBtn.disabled = !enabled;
    if (dom.roomLinkBtn) dom.roomLinkBtn.disabled = !enabled;
    if (dom.roomMuteBtn) {
      dom.roomMuteBtn.disabled = !enabled;
      dom.roomMuteBtn.innerHTML = room && room.is_muted
        ? '<i class="bi bi-bell-slash-fill"></i>'
        : '<i class="bi bi-bell"></i>';
      dom.roomMuteBtn.setAttribute("title", room && room.is_muted ? "알림 켜기" : "알림 끄기");
      dom.roomMuteBtn.setAttribute("aria-label", room && room.is_muted ? "알림 켜기" : "알림 끄기");
    }
    if (dom.roomMoreBtn) dom.roomMoreBtn.disabled = !enabled;
    if (dom.composerInput) dom.composerInput.disabled = !enabled;
    if (dom.sendBtn) dom.sendBtn.disabled = !enabled;
    if (dom.attachBtn) dom.attachBtn.disabled = !enabled;
    if (dom.emojiBtn) dom.emojiBtn.disabled = !enabled;
    if (dom.mentionBtn) dom.mentionBtn.disabled = !enabled;
    if (dom.linkInsertBtn) dom.linkInsertBtn.disabled = !enabled;
    if (dom.formatBtn) dom.formatBtn.disabled = !enabled;
    renderRoomMoreMenu();
    renderCallUi();
  }

  function resizeComposer() {
    if (!dom.composerInput) return;
    dom.composerInput.style.height = "auto";
    dom.composerInput.style.height = Math.min(dom.composerInput.scrollHeight, 168) + "px";
  }

  function beginPopupDrag(event) {
    if (!dom.popupWindow || window.innerWidth < 992) return;
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, textarea, select, a, label, [data-no-drag]")) {
      return;
    }
    const rect = dom.popupWindow.getBoundingClientRect();
    state.dragActive = true;
    state.dragStartX = Number(event.clientX || 0);
    state.dragStartY = Number(event.clientY || 0);
    state.dragStartOffsetX = Number(state.popupOffsetX || 0);
    state.dragStartOffsetY = Number(state.popupOffsetY || 0);
    state.dragRectLeft = rect.left;
    state.dragRectTop = rect.top;
    state.dragRectWidth = rect.width;
    state.dragRectHeight = rect.height;
    dom.popupWindow.classList.add("is-dragging");
    event.preventDefault();
  }

  function movePopupDrag(event) {
    if (!state.dragActive) return;
    const nextX = state.dragStartOffsetX + (Number(event.clientX || 0) - state.dragStartX);
    const nextY = state.dragStartOffsetY + (Number(event.clientY || 0) - state.dragStartY);
    const clamped = clampPopupOffset(nextX, nextY);
    state.popupOffsetX = clamped.x;
    state.popupOffsetY = clamped.y;
    applyPopupOffset();
  }

  function endPopupDrag() {
    if (!state.dragActive) return;
    state.dragActive = false;
    if (dom.popupWindow) {
      dom.popupWindow.classList.remove("is-dragging");
    }
    schedulePopupOffsetPersist();
  }

  function setPopupOpen(open) {
    state.isOpen = !!open;
    if (dom.popupLayer) {
      dom.popupLayer.classList.toggle("is-open", state.isOpen);
      dom.popupLayer.setAttribute("aria-hidden", state.isOpen ? "false" : "true");
    }
    if (dom.launcherBtn) {
      dom.launcherBtn.setAttribute("aria-expanded", state.isOpen ? "true" : "false");
      dom.launcherBtn.classList.toggle("is-active", state.isOpen);
    }
    document.body.classList.toggle("messenger-popup-open", state.isOpen);
    if (state.isOpen) {
      setNotificationMenuOpen(false);
    }
    setRoomMoreMenuOpen(false);
    setContextMenuOpen(false);
    setComposerPopover("");

    if (!state.isOpen) {
      endPopupDrag();
      if (dom.newRoomModalInstance) {
        try {
          dom.newRoomModalInstance.hide();
        } catch (_) {}
      }
      emitTyping(false);
      return;
    }

    if (Number(state.activeRoomId || 0) > 0) {
      dismissNotificationsForRoom(state.activeRoomId);
    }
    renderHeader();
    renderInspector();
    renderMessages();
    renderTyping();
    markActiveRoomRead();
    window.setTimeout(function () {
      if (dom.composerInput && !dom.composerInput.disabled) {
        dom.composerInput.focus();
        return;
      }
      if (dom.roomSearch) {
        dom.roomSearch.focus();
      }
    }, 40);
  }

  function togglePopup() {
    setPopupOpen(!state.isOpen);
  }

  function mergeRoom(room) {
    if (!room || !room.id) return;
    const index = state.rooms.findIndex(function (item) {
      return Number(item.id || 0) === Number(room.id || 0);
    });
    if (index === -1) {
      state.rooms.unshift(room);
    } else {
      state.rooms[index] = Object.assign({}, state.rooms[index], room);
    }
    sortRooms();
    state.activeRoom = currentRoom();
    recalcCounts();
    renderRoomList();
    renderHeader();
    renderInspector();
  }

  function removeRoom(roomId) {
    delete state.call.roomCallsById[Number(roomId || 0)];
    state.rooms = state.rooms.filter(function (room) {
      return Number(room.id || 0) !== Number(roomId || 0);
    });
    state.roomHistory = (state.roomHistory || []).filter(function (value) {
      return Number(value || 0) !== Number(roomId || 0);
    });
    persistRecentRooms();
    if (Number(state.activeRoomId || 0) === Number(roomId || 0)) {
      state.activeRoomId = state.rooms.length ? Number(state.rooms[0].id || 0) : 0;
      state.activeRoom = currentRoom();
      if (state.activeRoom) {
        loadRoomMessages(state.activeRoom.id);
      } else {
        renderHeader();
        renderMessages();
        renderInspector();
      }
    }
    recalcCounts();
    renderRoomList();
  }

  async function loadBootstrap(roomId) {
    const requestedRoomId = Number(roomId || state.activeRoomId || 0);
    const payload = await api("/api/messenger/bootstrap?room_id=" + requestedRoomId);
    const data = (payload && payload.payload) || {};
    state.userProfilesById = {};
    state.currentUser = data.current_user || null;
    loadDismissedNotifications();
    state.rooms = Array.isArray(data.rooms) ? data.rooms.slice() : [];
    state.contacts = Array.isArray(data.contacts) ? data.contacts.slice() : [];
    sortRooms();
    updateNotificationState(data.notifications || {}, data.counts || {});
    renderQuickContacts();
    renderRoomList();
    renderMentionPicker();

    const nextRoomId = Number(data.active_room_id || state.activeRoomId || 0);
    state.activeRoomId = nextRoomId;
    state.activeRoom = currentRoom();
    renderHeader();
    renderInspector();
    renderMessages();
    if (state.activeRoomId > 0) {
      await loadRoomMessages(state.activeRoomId);
      sendSocket({ type: "call_sync", room_id: state.activeRoomId });
    }
    renderContactPicker();
  }

  async function loadRoomMessages(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    const payload = await api("/api/messenger/rooms/" + targetRoomId + "/messages");
    const data = (payload && payload.payload) || {};
    state.activeRoomId = targetRoomId;
    if (data.room) {
      mergeRoom(data.room);
      state.activeRoom = currentRoom();
    }
    state.messagesByRoom[targetRoomId] = Array.isArray(data.messages) ? data.messages.slice() : [];
    state.oldestCursorByRoom[targetRoomId] = Number(data.next_before_message_id || 0);
    rememberRecentRoom(targetRoomId);
    renderHeader();
    renderInspector();
    renderMessages();
    renderTyping();
    scrollMessagesToBottom(true);
    sendSocket({ type: "call_sync", room_id: targetRoomId });
    markActiveRoomRead();
  }

  async function loadOlderMessages(roomId) {
    const targetRoomId = Number(roomId || 0);
    const beforeMessageId = Number(state.oldestCursorByRoom[targetRoomId] || 0);
    if (targetRoomId <= 0 || beforeMessageId <= 0 || state.loadingHistoryRooms[targetRoomId]) return;
    state.loadingHistoryRooms[targetRoomId] = true;
    try {
      const payload = await api("/api/messenger/rooms/" + targetRoomId + "/messages?before_message_id=" + beforeMessageId + "&limit=50");
      const data = (payload && payload.payload) || {};
      const olderMessages = Array.isArray(data.messages) ? data.messages.slice() : [];
      if (!olderMessages.length) {
        state.oldestCursorByRoom[targetRoomId] = 0;
        return;
      }
      const existing = state.messagesByRoom[targetRoomId] || [];
      const olderOnly = olderMessages.filter(function (message) {
        return !messageExists(targetRoomId, message.id);
      });
      if (!olderOnly.length) {
        state.oldestCursorByRoom[targetRoomId] = 0;
        return;
      }
      state.messagesByRoom[targetRoomId] = olderOnly.concat(existing);
      state.oldestCursorByRoom[targetRoomId] = Number(data.next_before_message_id || 0);
      const prevHeight = dom.messageScroll ? dom.messageScroll.scrollHeight : 0;
      renderMessages();
      if (dom.messageScroll) {
        const nextHeight = dom.messageScroll.scrollHeight;
        dom.messageScroll.scrollTop = nextHeight - prevHeight;
      }
      renderInspector();
    } catch (_) {
    } finally {
      state.loadingHistoryRooms[targetRoomId] = false;
    }
  }

  async function selectRoom(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0 || Number(state.activeRoomId || 0) === targetRoomId) {
      state.activeRoom = currentRoom();
      renderRoomList();
      renderHeader();
      renderInspector();
      renderMessages();
      sendSocket({ type: "call_sync", room_id: targetRoomId });
      markActiveRoomRead();
      return;
    }
    state.activeRoomId = targetRoomId;
    state.activeRoom = currentRoom();
    renderRoomList();
    renderHeader();
    renderInspector();
    renderMessages();
    await loadRoomMessages(targetRoomId);
    sendSocket({ type: "call_sync", room_id: targetRoomId });
  }

  async function openRoom(roomId, messageId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    state.highlightMessageId = Number(messageId || 0);
    setNotificationMenuOpen(false);
    if (!state.initialized) {
      await init();
    }
    setPopupOpen(true);
    await selectRoom(targetRoomId);
    highlightPendingMessage();
    dismissNotificationsForRoom(targetRoomId);
  }

  function currentUserId() {
    return normalizeText((state.currentUser || {}).user_id);
  }

  function livekitSdk() {
    return window.LivekitClient || null;
  }

  function livekitConfigured() {
    return !!config.livekitEnabled && !!config.livekitWsUrl;
  }

  function livekitAvailable() {
    const sdk = livekitSdk();
    return !!(livekitConfigured() && sdk && typeof sdk.Room === "function");
  }

  function callClientStorageKey() {
    return "abbasMessengerCallClientId";
  }

  function callClientId() {
    if (state.call.clientId) return state.call.clientId;
    let value = "";
    try {
      value = normalizeText(window.sessionStorage.getItem(callClientStorageKey()));
    } catch (_) {
      value = "";
    }
    if (!value) {
      value = "call-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try {
        window.sessionStorage.setItem(callClientStorageKey(), value);
      } catch (_) {}
    }
    state.call.clientId = value;
    return value;
  }

  function currentLiveRoom() {
    return state.call.liveRoom || null;
  }

  function callParticipantCount(roomCall) {
    const liveRoom = currentLiveRoom();
    const liveCount = liveRoom ? (1 + Number((liveRoom.remoteParticipants && liveRoom.remoteParticipants.size) || 0)) : 0;
    const presenceCount = Number((roomCall && roomCall.participant_count) || 0);
    return Math.max(liveCount, presenceCount);
  }

  function callTrackPublication(participant, source) {
    const target = participant || null;
    if (!target || typeof target.getTrackPublication !== "function") return null;
    return target.getTrackPublication(source) || null;
  }

  function callPublicationTrack(publication) {
    const payload = publication || null;
    if (!payload) return null;
    return payload.videoTrack || payload.audioTrack || payload.track || null;
  }

  function syncLocalMediaStateFromLiveRoom() {
    const sdk = livekitSdk();
    const room = currentLiveRoom();
    if (!sdk || !room || !room.localParticipant) return;
    const micPublication = callTrackPublication(room.localParticipant, sdk.Track.Source.Microphone);
    const cameraPublication = callTrackPublication(room.localParticipant, sdk.Track.Source.Camera);
    const screenPublication = callTrackPublication(room.localParticipant, sdk.Track.Source.ScreenShare);
    state.call.audioEnabled = !!(micPublication && !micPublication.isMuted);
    state.call.cameraEnabled = !!(cameraPublication && !cameraPublication.isMuted);
    state.call.sharingScreen = !!(screenPublication && !screenPublication.isMuted);
  }

  async function requestCallSession(roomId, mode) {
    const payload = await api("/api/messenger/rooms/" + Number(roomId || 0) + "/call/session", {
      method: "POST",
      body: JSON.stringify({
        client_id: callClientId(),
        preferred_mode: normalizeText(mode).toLowerCase() === "video" ? "video" : "audio",
      }),
    });
    return (payload && payload.payload) || null;
  }

  function bindLiveRoomEvents(room) {
    const sdk = livekitSdk();
    const targetRoom = room || null;
    if (!sdk || !targetRoom || typeof targetRoom.on !== "function") return;

    const rerender = function () {
      syncLocalMediaStateFromLiveRoom();
      renderCallUi();
    };

    const bindEvent = function (eventName, handler) {
      if (!eventName) return;
      try {
        targetRoom.on(eventName, handler);
      } catch (_) {}
    };

    bindEvent(sdk.RoomEvent.TrackSubscribed, rerender);
    bindEvent(sdk.RoomEvent.TrackUnsubscribed, rerender);
    bindEvent(sdk.RoomEvent.TrackMuted, rerender);
    bindEvent(sdk.RoomEvent.TrackUnmuted, rerender);
    bindEvent(sdk.RoomEvent.LocalTrackPublished, rerender);
    bindEvent(sdk.RoomEvent.LocalTrackUnpublished, rerender);
    bindEvent(sdk.RoomEvent.ParticipantConnected, rerender);
    bindEvent(sdk.RoomEvent.ParticipantDisconnected, rerender);
    bindEvent(sdk.RoomEvent.ConnectionStateChanged, rerender);
    bindEvent(sdk.RoomEvent.ActiveSpeakersChanged, rerender);
    bindEvent(sdk.RoomEvent.MediaDevicesError, function (error) {
      showError((error && error.message) || "카메라 또는 마이크 장치를 사용할 수 없습니다.", "장치 오류");
      rerender();
    });
    bindEvent(sdk.RoomEvent.AudioPlaybackStatusChanged, function () {
      if (!targetRoom.canPlaybackAudio && typeof targetRoom.startAudio === "function") {
        targetRoom.startAudio().catch(function () {});
      }
    });
    bindEvent(sdk.RoomEvent.Disconnected, function () {
      if (state.call.liveRoom !== targetRoom) return;
      const roomId = Number(state.call.joinedRoomId || 0);
      state.call.liveRoom = null;
      state.call.liveRoomName = "";
      state.call.liveParticipantIdentity = "";
      state.call.joinedRoomId = 0;
      state.call.joining = false;
      state.call.audioEnabled = true;
      state.call.cameraEnabled = false;
      state.call.sharingScreen = false;
      renderCallUi();
      if (roomId > 0) {
        sendSocket({ type: "call_leave", room_id: roomId });
      }
    });
  }

  async function connectLiveKitRoom(roomId, mode) {
    const targetRoomId = Number(roomId || 0);
    const requestedMode = normalizeText(mode).toLowerCase() === "video" ? "video" : "audio";
    if (targetRoomId <= 0) return null;
    if (!livekitConfigured()) {
      throw new Error("LiveKit 통화 서버 설정이 아직 완료되지 않았습니다.");
    }
    if (!livekitAvailable()) {
      throw new Error("LiveKit 브라우저 SDK를 불러오지 못했습니다.");
    }

    const existingRoom = currentLiveRoom();
    if (existingRoom && Number(state.call.joinedRoomId || 0) === targetRoomId) {
      return existingRoom;
    }
    if (existingRoom && Number(state.call.joinedRoomId || 0) !== targetRoomId) {
      await disconnectLiveKitRoom(false);
    }

    const session = await requestCallSession(targetRoomId, requestedMode);
    if (!session || !session.server_url || !session.participant_token) {
      throw new Error("통화 세션 정보를 불러오지 못했습니다.");
    }

    const sdk = livekitSdk();
    const videoCaptureDefaults = sdk.VideoPresets && sdk.VideoPresets.h720
      ? { resolution: sdk.VideoPresets.h720.resolution }
      : undefined;
    const room = new sdk.Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: videoCaptureDefaults,
    });

    bindLiveRoomEvents(room);
    state.call.liveRoom = room;
    state.call.liveRoomName = normalizeText(session.room_name);
    state.call.liveParticipantIdentity = normalizeText(session.participant_identity);
    state.call.requestedMode = requestedMode;
    state.call.joinedRoomId = targetRoomId;
    if (typeof room.prepareConnection === "function") {
      room.prepareConnection(session.server_url, session.participant_token);
    }
    await room.connect(session.server_url, session.participant_token);
    try {
      if (typeof room.startAudio === "function") {
        await room.startAudio();
      }
    } catch (_) {}
    if (requestedMode === "video" && room.localParticipant.enableCameraAndMicrophone) {
      await room.localParticipant.enableCameraAndMicrophone();
    } else if (requestedMode === "video") {
      await room.localParticipant.setMicrophoneEnabled(true);
      await room.localParticipant.setCameraEnabled(true);
    } else {
      await room.localParticipant.setMicrophoneEnabled(true);
      await room.localParticipant.setCameraEnabled(false);
    }
    syncLocalMediaStateFromLiveRoom();
    return room;
  }

  async function disconnectLiveKitRoom(notifyServer) {
    const room = currentLiveRoom();
    const roomId = Number(state.call.joinedRoomId || 0);
    state.call.liveRoom = null;
    state.call.liveRoomName = "";
    state.call.liveParticipantIdentity = "";
    state.call.joinedRoomId = 0;
    state.call.joining = false;
    state.call.requestedMode = "";
    state.call.audioEnabled = true;
    state.call.cameraEnabled = false;
    state.call.sharingScreen = false;
    if (notifyServer && roomId > 0) {
      sendSocket({ type: "call_leave", room_id: roomId });
    }
    try {
      if (room && typeof room.disconnect === "function") {
        room.disconnect();
      }
    } catch (_) {}
    if (dom.callAudioSink) {
      dom.callAudioSink.innerHTML = "";
    }
  }

  function livekitParticipantDisplayName(participant, fallback) {
    const payload = participant || {};
    return normalizeText(payload.name || payload.identity || fallback || "참여자");
  }

  function livekitParticipantRenderItems(room) {
    const sdk = livekitSdk();
    const targetRoom = room || null;
    if (!sdk || !targetRoom) return [];
    const visualItems = [];
    const audioItems = [];
    const pushParticipant = function (participant, isLocal) {
      const displayName = livekitParticipantDisplayName(participant, isLocal ? "나" : "참여자");
      const micPublication = callTrackPublication(participant, sdk.Track.Source.Microphone);
      const cameraPublication = callTrackPublication(participant, sdk.Track.Source.Camera);
      const screenPublication = callTrackPublication(participant, sdk.Track.Source.ScreenShare);
      const micEnabled = !!(micPublication && !micPublication.isMuted);
      const cameraEnabled = !!(cameraPublication && !cameraPublication.isMuted);
      const screenEnabled = !!(screenPublication && !screenPublication.isMuted);
      if (cameraEnabled) {
        visualItems.push({
          id: normalizeText(participant.identity) + "::camera",
          kind: "camera",
          displayName: displayName,
          subtitle: "카메라",
          participant: participant,
          publication: cameraPublication,
          track: callPublicationTrack(cameraPublication),
          isLocal: !!isLocal,
          audioEnabled: micEnabled,
        });
      }
      if (screenEnabled) {
        visualItems.push({
          id: normalizeText(participant.identity) + "::screen",
          kind: "screen",
          displayName: displayName,
          subtitle: "화면 공유",
          participant: participant,
          publication: screenPublication,
          track: callPublicationTrack(screenPublication),
          isLocal: !!isLocal,
          audioEnabled: micEnabled,
        });
      }
      if (!cameraEnabled && !screenEnabled) {
        audioItems.push({
          id: normalizeText(participant.identity) + "::audio",
          kind: "audio",
          displayName: displayName,
          subtitle: micEnabled ? "음성 연결됨" : "대기 중",
          participant: participant,
          publication: null,
          track: null,
          isLocal: !!isLocal,
          audioEnabled: micEnabled,
        });
      }
    };
    if (targetRoom.localParticipant) {
      pushParticipant(targetRoom.localParticipant, true);
    }
    if (targetRoom.remoteParticipants && typeof targetRoom.remoteParticipants.forEach === "function") {
      targetRoom.remoteParticipants.forEach(function (participant) {
        pushParticipant(participant, false);
      });
    }
    return visualItems.length ? visualItems : audioItems;
  }

  function callGridDensity(itemCount) {
    const count = Number(itemCount || 0);
    if (count >= 41) return "ultra";
    if (count >= 25) return "dense";
    if (count >= 13) return "compact";
    return "default";
  }

  function renderCallPrompt(roomCall) {
    if (!dom.callGrid) return;
    const count = callParticipantCount(roomCall);
    dom.callGrid.setAttribute("data-density", "default");
    dom.callGrid.innerHTML = [
      '<div class="messenger-call-empty">',
      '<i class="bi bi-camera-video"></i>',
      '<strong>이 대화방 통화에 참여할 수 있습니다.</strong>',
      '<span>' + escapeHtml(count > 0 ? (count + "명이 이미 연결되어 있습니다. 참여 버튼을 눌러 바로 합류하세요.") : "음성 또는 영상 통화를 시작하면 카메라를 켠 참가자들이 모두 그리드에 표시됩니다.") + "</span>",
      "</div>",
    ].join("");
    if (dom.callAudioSink) {
      dom.callAudioSink.innerHTML = "";
    }
  }

  function attachLiveKitTrack(track, mountPoint, isLocal) {
    if (!track || !mountPoint || typeof track.attach !== "function") return false;
    while (mountPoint.firstChild) {
      mountPoint.removeChild(mountPoint.firstChild);
    }
    try {
      if (typeof track.detach === "function") {
        track.detach();
      }
    } catch (_) {}
    let element = null;
    try {
      element = track.attach();
    } catch (_) {
      element = null;
    }
    if (!element) return false;
    if (element instanceof HTMLMediaElement) {
      element.autoplay = true;
      element.playsInline = true;
      element.muted = !!isLocal;
    }
    element.classList.add("messenger-call-card__video");
    mountPoint.appendChild(element);
    return true;
  }

  function renderCallAudioSink(room) {
    const sdk = livekitSdk();
    const targetRoom = room || null;
    if (!dom.callAudioSink) return;
    dom.callAudioSink.innerHTML = "";
    if (!sdk || !targetRoom || !targetRoom.remoteParticipants) return;
    targetRoom.remoteParticipants.forEach(function (participant) {
      const publication = callTrackPublication(participant, sdk.Track.Source.Microphone);
      const track = callPublicationTrack(publication);
      if (!publication || publication.isMuted || !track || typeof track.attach !== "function") return;
      try {
        if (typeof track.detach === "function") {
          track.detach();
        }
      } catch (_) {}
      let element = null;
      try {
        element = track.attach();
      } catch (_) {
        element = null;
      }
      if (!element) return;
      if (element instanceof HTMLMediaElement) {
        element.autoplay = true;
        element.playsInline = true;
      }
      dom.callAudioSink.appendChild(element);
    });
  }

  function callForRoom(roomId) {
    return state.call.roomCallsById[Number(roomId || 0)] || null;
  }

  function activeRoomCall() {
    return state.activeRoom ? callForRoom(state.activeRoom.id) : null;
  }

  function callParticipant(call, userId) {
    const targetUserId = normalizeText(userId);
    if (!call || !targetUserId || !Array.isArray(call.participants)) return null;
    return call.participants.find(function (item) {
      return normalizeText((item || {}).user_id) === targetUserId;
    }) || null;
  }

  function userInCall(call, userId) {
    return !!callParticipant(call, userId);
  }

  function callMediaMode(participant) {
    const payload = participant || {};
    if (payload.sharing_screen) return "screen";
    if (payload.video_enabled) return "video";
    return "audio";
  }

  function resolveIceServers() {
    return Array.isArray(config.iceServers) && config.iceServers.length ? config.iceServers : DEFAULT_ICE_SERVERS;
  }

  function localAudioTrack() {
    const stream = state.call.cameraStream;
    return stream && stream.getAudioTracks ? (stream.getAudioTracks()[0] || null) : null;
  }

  function localCameraTrack() {
    const stream = state.call.cameraStream;
    return stream && stream.getVideoTracks ? (stream.getVideoTracks()[0] || null) : null;
  }

  function localScreenTrack() {
    const stream = state.call.screenStream;
    return stream && stream.getVideoTracks ? (stream.getVideoTracks()[0] || null) : null;
  }

  function activeLocalVideoTrack() {
    return state.call.sharingScreen ? localScreenTrack() : localCameraTrack();
  }

  function stopStreamTracks(stream) {
    if (!stream || typeof stream.getTracks !== "function") return;
    stream.getTracks().forEach(function (track) {
      try {
        track.onended = null;
      } catch (_) {}
      try {
        track.stop();
      } catch (_) {}
    });
  }

  function closePeerConnection(peerUserId) {
    const targetUserId = normalizeText(peerUserId);
    const peer = state.call.peersByUserId[targetUserId];
    if (!peer) return;
    try {
      if (peer.pc) {
        peer.pc.onicecandidate = null;
        peer.pc.ontrack = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.close();
      }
    } catch (_) {}
    delete state.call.peersByUserId[targetUserId];
    delete state.call.remoteStreamsByUserId[targetUserId];
    delete state.call.pendingSignalsByUserId[targetUserId];
  }

  function closeAllPeerConnections() {
    Object.keys(state.call.peersByUserId || {}).forEach(function (peerUserId) {
      closePeerConnection(peerUserId);
    });
    state.call.peersByUserId = {};
    state.call.remoteStreamsByUserId = {};
    state.call.pendingSignalsByUserId = {};
  }

  function refreshLocalTrackState() {
    const audioTrack = localAudioTrack();
    const cameraTrack = localCameraTrack();
    const screenTrack = localScreenTrack();
    if (audioTrack) {
      audioTrack.enabled = !!state.call.audioEnabled;
    }
    if (cameraTrack) {
      cameraTrack.enabled = !state.call.sharingScreen && !!state.call.cameraEnabled;
    }
    if (screenTrack) {
      screenTrack.enabled = !!state.call.sharingScreen;
    }
  }

  function rebuildLocalCallStream() {
    refreshLocalTrackState();
    const nextStream = new MediaStream();
    const audioTrack = localAudioTrack();
    const videoTrack = activeLocalVideoTrack();
    if (audioTrack) {
      nextStream.addTrack(audioTrack);
    }
    if (videoTrack) {
      nextStream.addTrack(videoTrack);
    }
    state.call.localStream = nextStream;
    return nextStream;
  }

  async function ensureCameraStream(options) {
    const settings = options || {};
    const needAudio = settings.audio !== false;
    const needVideo = !!settings.video;
    const currentStream = state.call.cameraStream;
    const hasAudio = !!(currentStream && currentStream.getAudioTracks && currentStream.getAudioTracks().length);
    const hasVideo = !!(currentStream && currentStream.getVideoTracks && currentStream.getVideoTracks().length);
    if (currentStream && (!needAudio || hasAudio) && (!needVideo || hasVideo)) {
      return currentStream;
    }
    if (!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function")) {
      throw new Error("이 브라우저에서는 음성/영상 통화를 지원하지 않습니다.");
    }
    if (currentStream) {
      stopStreamTracks(currentStream);
      state.call.cameraStream = null;
    }
    state.call.cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: needAudio,
      video: needVideo,
    });
    return state.call.cameraStream;
  }

  function callPreviewSubtitle(participant) {
    const payload = participant || {};
    if (payload.sharing_screen) return "화면 공유 중";
    if (payload.video_enabled) return "영상 연결됨";
    if (payload.audio_enabled) return "음성 연결됨";
    return "대기 중";
  }

  function setCallButton(button, iconClass, label) {
    if (!button) return;
    button.innerHTML = '<i class="bi ' + escapeAttribute(iconClass || "bi-circle") + '"></i><span>' + escapeHtml(label || "") + "</span>";
  }

  function streamHasLiveVideo(stream) {
    if (!stream || typeof stream.getVideoTracks !== "function") return false;
    return stream.getVideoTracks().some(function (track) {
      return !!track && track.readyState !== "ended" && track.enabled !== false;
    });
  }

  function queuedSignals(peerUserId) {
    const targetUserId = normalizeText(peerUserId);
    const queued = state.call.pendingSignalsByUserId[targetUserId];
    if (Array.isArray(queued)) return queued.slice();
    return [];
  }

  function shouldInitiateOffer(selfParticipant, peerParticipant) {
    const selfJoinedAt = Number((selfParticipant || {}).joined_at || 0);
    const peerJoinedAt = Number((peerParticipant || {}).joined_at || 0);
    if (selfJoinedAt !== peerJoinedAt) {
      return selfJoinedAt > peerJoinedAt;
    }
    return normalizeText((selfParticipant || {}).user_id) > normalizeText((peerParticipant || {}).user_id);
  }

  async function syncPeerConnectionTracks(peer) {
    const target = peer || {};
    if (!target.pc) return;
    rebuildLocalCallStream();
    const currentLocalStream = state.call.localStream;
    const desiredTracks = {
      audio: localAudioTrack(),
      video: activeLocalVideoTrack(),
    };
    await Promise.all(["audio", "video"].map(async function (kind) {
      const sender = target.pc.getSenders().find(function (item) {
        return item && item.track && item.track.kind === kind;
      }) || null;
      const nextTrack = desiredTracks[kind];
      if (sender) {
        if (sender.track !== nextTrack) {
          try {
            await sender.replaceTrack(nextTrack || null);
          } catch (_) {}
        }
        return;
      }
      if (nextTrack && currentLocalStream) {
        try {
          target.pc.addTrack(nextTrack, currentLocalStream);
        } catch (_) {}
      }
    }));
  }

  async function ensurePeerConnection(peerUserId) {
    const targetUserId = normalizeText(peerUserId);
    if (!targetUserId) return null;
    let peer = state.call.peersByUserId[targetUserId];
    if (peer && peer.pc) {
      return peer;
    }
    const pc = new RTCPeerConnection({ iceServers: resolveIceServers() });
    peer = {
      pc: pc,
      remoteStream: new MediaStream(),
      offerStarted: false,
    };
    state.call.peersByUserId[targetUserId] = peer;
    state.call.remoteStreamsByUserId[targetUserId] = peer.remoteStream;
    pc.onicecandidate = function (event) {
      if (!event.candidate || !state.call.joinedRoomId) return;
      sendSocket({
        type: "call_signal",
        room_id: state.call.joinedRoomId,
        target_user_id: targetUserId,
        signal: { candidate: (event.candidate.toJSON ? event.candidate.toJSON() : event.candidate) },
      });
    };
    pc.ontrack = function (event) {
      const stream = event.streams && event.streams[0]
        ? event.streams[0]
        : (peer.remoteStream || new MediaStream());
      if (!event.streams || !event.streams[0]) {
        try {
          stream.addTrack(event.track);
        } catch (_) {}
      }
      peer.remoteStream = stream;
      state.call.remoteStreamsByUserId[targetUserId] = stream;
      renderCallUi();
    };
    pc.onconnectionstatechange = function () {
      const currentState = normalizeText(pc.connectionState).toLowerCase();
      if (currentState === "failed" || currentState === "closed") {
        closePeerConnection(targetUserId);
      }
      renderCallUi();
    };
    await syncPeerConnectionTracks(peer);
    const queued = queuedSignals(targetUserId);
    delete state.call.pendingSignalsByUserId[targetUserId];
    for (const signal of queued) {
      await applySignalToPeer(targetUserId, signal);
    }
    return peer;
  }

  async function sendOfferToPeer(peerUserId) {
    const peer = await ensurePeerConnection(peerUserId);
    if (!peer || !peer.pc || !state.call.joinedRoomId) return;
    await syncPeerConnectionTracks(peer);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    sendSocket({
      type: "call_signal",
      room_id: state.call.joinedRoomId,
      target_user_id: normalizeText(peerUserId),
      signal: { description: (peer.pc.localDescription && peer.pc.localDescription.toJSON ? peer.pc.localDescription.toJSON() : peer.pc.localDescription) },
    });
  }

  async function applySignalToPeer(peerUserId, signal) {
    const targetUserId = normalizeText(peerUserId);
    const payload = signal || {};
    if (!targetUserId || !payload) return;
    const peer = await ensurePeerConnection(targetUserId);
    if (!peer || !peer.pc) return;
    if (payload.description) {
      await peer.pc.setRemoteDescription(payload.description);
      if (normalizeText((payload.description || {}).type).toLowerCase() === "offer") {
        await syncPeerConnectionTracks(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        sendSocket({
          type: "call_signal",
          room_id: state.call.joinedRoomId,
          target_user_id: targetUserId,
          signal: { description: (peer.pc.localDescription && peer.pc.localDescription.toJSON ? peer.pc.localDescription.toJSON() : peer.pc.localDescription) },
        });
      }
      return;
    }
    if (payload.candidate) {
      try {
        await peer.pc.addIceCandidate(payload.candidate);
      } catch (_) {}
    }
  }

  async function syncAllPeerConnections() {
    for (const peerUserId of Object.keys(state.call.peersByUserId || {})) {
      await syncPeerConnectionTracks(state.call.peersByUserId[peerUserId]);
    }
  }

  async function syncPeersFromCall(call) {
    const roomCall = call || null;
    const selfUserId = currentUserId();
    if (!roomCall || !selfUserId || Number(roomCall.room_id || 0) !== Number(state.call.joinedRoomId || 0)) {
      closeAllPeerConnections();
      return;
    }
    const selfParticipant = callParticipant(roomCall, selfUserId);
    if (!selfParticipant) {
      closeAllPeerConnections();
      return;
    }
    const activePeerIds = new Set();
    for (const participant of (roomCall.participants || [])) {
      const peerUserId = normalizeText((participant || {}).user_id);
      if (!peerUserId || peerUserId === selfUserId) continue;
      activePeerIds.add(peerUserId);
      const peer = await ensurePeerConnection(peerUserId);
      if (!peer) continue;
      if (shouldInitiateOffer(selfParticipant, participant) && !peer.offerStarted) {
        peer.offerStarted = true;
        try {
          await sendOfferToPeer(peerUserId);
        } catch (_) {
          peer.offerStarted = false;
        }
      }
    }
    Object.keys(state.call.peersByUserId || {}).forEach(function (peerUserId) {
      if (!activePeerIds.has(peerUserId)) {
        closePeerConnection(peerUserId);
      }
    });
  }

  async function cleanupLocalCallSession() {
    await disconnectLiveKitRoom(false);
    closeAllPeerConnections();
    stopStreamTracks(state.call.screenStream);
    stopStreamTracks(state.call.cameraStream);
    state.call.screenStream = null;
    state.call.cameraStream = null;
    state.call.localStream = null;
    renderCallUi();
  }

  function emitCallMediaState() {
    if (!state.call.joinedRoomId) return;
    sendSocket({
      type: "call_media_state",
      room_id: state.call.joinedRoomId,
      media_mode: (state.call.sharingScreen || state.call.cameraEnabled) ? "video" : "audio",
      audio_enabled: !!state.call.audioEnabled,
      video_enabled: !!(state.call.sharingScreen || state.call.cameraEnabled),
      sharing_screen: !!state.call.sharingScreen,
      source: state.call.sharingScreen ? "screen" : "camera",
    });
  }

  async function stopScreenShare() {
    const room = currentLiveRoom();
    if (!room || !state.call.sharingScreen) return;
    await room.localParticipant.setScreenShareEnabled(false);
    syncLocalMediaStateFromLiveRoom();
    emitCallMediaState();
    renderCallUi();
  }

  function bindScreenShareLifecycle(stream) {
    const track = stream && stream.getVideoTracks ? (stream.getVideoTracks()[0] || null) : null;
    if (!track) return;
    track.onended = function () {
      stopScreenShare().catch(function () {});
    };
  }

  async function startOrJoinCall(mode) {
    const room = state.activeRoom;
    if (!room) return;
    const targetRoomId = Number(room.id || 0);
    if (targetRoomId <= 0) return;
    if (state.call.joinedRoomId && Number(state.call.joinedRoomId || 0) !== targetRoomId) {
      await showWarning("현재는 한 번에 하나의 대화방 통화만 지원합니다. 먼저 기존 통화에서 나가주세요.");
      return;
    }
    const nextMode = normalizeText(mode).toLowerCase() === "video" ? "video" : "audio";
    state.call.joining = true;
    renderCallUi();
    try {
      await connectLiveKitRoom(targetRoomId, nextMode);
      syncLocalMediaStateFromLiveRoom();
      sendSocket({
        type: "call_join",
        room_id: targetRoomId,
        media_mode: nextMode,
        audio_enabled: !!state.call.audioEnabled,
        video_enabled: !!state.call.cameraEnabled,
        sharing_screen: !!state.call.sharingScreen,
        source: state.call.sharingScreen ? "screen" : "camera",
      });
      sendSocket({ type: "call_sync", room_id: targetRoomId });
    } catch (error) {
      await showError(error.message || "통화 시작에 실패했습니다.", "통화 준비 실패");
      await cleanupLocalCallSession();
    } finally {
      state.call.joining = false;
      renderCallUi();
    }
  }

  async function leaveCurrentCall() {
    const roomId = Number(state.call.joinedRoomId || 0);
    if (roomId <= 0) return;
    await disconnectLiveKitRoom(true);
    await cleanupLocalCallSession();
  }

  async function toggleCallMute() {
    const room = currentLiveRoom();
    if (!room || !state.call.joinedRoomId) return;
    await room.localParticipant.setMicrophoneEnabled(!state.call.audioEnabled);
    syncLocalMediaStateFromLiveRoom();
    emitCallMediaState();
    renderCallUi();
  }

  async function toggleCallCamera() {
    const room = currentLiveRoom();
    if (!room || !state.call.joinedRoomId) return;
    await room.localParticipant.setCameraEnabled(!state.call.cameraEnabled);
    syncLocalMediaStateFromLiveRoom();
    emitCallMediaState();
    renderCallUi();
  }

  async function toggleScreenShare() {
    const room = currentLiveRoom();
    if (!room || !state.call.joinedRoomId) return;
    await room.localParticipant.setScreenShareEnabled(!state.call.sharingScreen);
    syncLocalMediaStateFromLiveRoom();
    emitCallMediaState();
    renderCallUi();
  }

  function renderCallGrid(roomCall) {
    if (!dom.callGrid) return;
    const call = roomCall || null;
    const liveRoom = currentLiveRoom();
    const joinedHere = !!liveRoom && Number(state.call.joinedRoomId || 0) === Number((state.activeRoom && state.activeRoom.id) || 0);
    if (!joinedHere) {
      renderCallPrompt(call);
      return;
    }

    const items = livekitParticipantRenderItems(liveRoom);
    if (!items.length) {
      renderCallPrompt(call);
      return;
    }
    dom.callGrid.setAttribute("data-density", callGridDensity(items.length));
    dom.callGrid.innerHTML = items.map(function (item) {
      const avatarInitial = normalizeText(avatarInitialFor(item.displayName, item.displayName));
      const pillItems = [
        '<span class="messenger-call-card__pill ' + (item.audioEnabled ? 'is-on' : 'is-off') + '">' + (item.audioEnabled ? 'MIC ON' : 'MIC OFF') + '</span>',
        '<span class="messenger-call-card__pill ' + (item.track ? 'is-on' : 'is-off') + '">' + (item.track ? 'VIDEO ON' : 'VIDEO OFF') + '</span>',
        item.kind === "screen" ? '<span class="messenger-call-card__pill is-screen">SCREEN</span>' : "",
      ].join("");
      return [
        '<article class="messenger-call-card" data-call-card-user="' + escapeAttribute(item.id) + '">',
        '<div class="messenger-call-card__placeholder">' + escapeHtml(avatarInitial || "U") + "</div>",
        '<div class="messenger-call-card__media-slot" data-call-media-user="' + escapeAttribute(item.id) + '"></div>',
        '<div class="messenger-call-card__meta">',
        '<div class="messenger-call-card__identity">',
        '<strong>' + escapeHtml(item.displayName) + (item.isLocal ? ' (나)' : "") + "</strong>",
        '<span>' + escapeHtml(item.subtitle || (item.track ? '영상 연결됨' : '대기 중')) + "</span>",
        "</div>",
        '<div class="messenger-call-card__state">' + pillItems + "</div>",
        "</div>",
        "</article>",
      ].join("");
    }).join("");

    Array.prototype.forEach.call(dom.callGrid.querySelectorAll("[data-call-media-user]"), function (slot) {
      const item = items.find(function (entry) {
        return entry.id === normalizeText(slot.getAttribute("data-call-media-user"));
      }) || null;
      const card = slot.closest("[data-call-card-user]");
      const attached = !!(item && item.track && attachLiveKitTrack(item.track, slot, item.isLocal));
      if (card) {
        card.classList.toggle("has-video", attached);
      }
    });
    renderCallAudioSink(liveRoom);
  }

  function renderCallUi() {
    if (!dom.callStrip || !dom.callStage || !dom.callStatusBadge || !dom.callStatusTitle || !dom.callStatusMeta) return;
    const room = state.activeRoom;
    const roomCall = activeRoomCall();
    const joinedRoomId = Number(state.call.joinedRoomId || 0);
    const joinedHere = !!room && joinedRoomId > 0 && joinedRoomId === Number(room.id || 0);
    const joinedElsewhere = joinedRoomId > 0 && !joinedHere;
    const amInRoomCall = joinedHere && !!currentLiveRoom();
    const callConfigured = livekitConfigured();
    const callReady = livekitAvailable();
    const participantCount = callParticipantCount(roomCall);

    dom.callStrip.classList.toggle("d-none", !room);
    dom.callStage.classList.toggle("d-none", !room || (!roomCall && !amInRoomCall));
    if (!room) {
      return;
    }

    dom.callStatusBadge.classList.remove("is-live", "is-ringing");
    if (!callConfigured) {
      dom.callStatusBadge.textContent = "SETUP";
      dom.callStatusTitle.textContent = "그룹 통화 서버 설정이 필요합니다.";
      dom.callStatusMeta.textContent = "LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET를 설정하면 50명급 그룹 통화에 연결할 수 있습니다.";
    } else if (!callReady) {
      dom.callStatusBadge.textContent = "LOAD";
      dom.callStatusTitle.textContent = "통화 SDK를 불러오는 중입니다.";
      dom.callStatusMeta.textContent = "잠시 후 다시 시도해주세요.";
    } else if (amInRoomCall) {
      dom.callStatusBadge.textContent = "LIVE";
      dom.callStatusBadge.classList.add("is-live");
      dom.callStatusTitle.textContent = "LiveKit 그룹 통화에 참여 중입니다.";
      dom.callStatusMeta.textContent = String(participantCount || 1) + "명이 연결되어 있고, 카메라를 켠 참가자는 전부 그리드에 표시됩니다.";
    } else if (roomCall && participantCount > 0) {
      dom.callStatusBadge.textContent = "JOIN";
      dom.callStatusBadge.classList.add("is-ringing");
      dom.callStatusTitle.textContent = "이 대화방에서 통화가 진행 중입니다.";
      dom.callStatusMeta.textContent = String(participantCount) + "명이 연결되어 있습니다.";
    } else if (joinedElsewhere) {
      dom.callStatusBadge.textContent = "BUSY";
      dom.callStatusTitle.textContent = "다른 대화방 통화에 참여 중입니다.";
      dom.callStatusMeta.textContent = "현재 방에서는 새 통화를 시작할 수 없습니다.";
    } else {
      dom.callStatusBadge.textContent = "READY";
      dom.callStatusTitle.textContent = "이 대화방에서 통화가 없습니다.";
      dom.callStatusMeta.textContent = "음성 또는 영상 통화를 시작할 수 있습니다.";
    }

    setCallButton(dom.audioCallBtn, "bi-telephone", roomCall && !amInRoomCall ? "음성으로 참여" : "음성 통화");
    setCallButton(dom.videoCallBtn, "bi-camera-video", roomCall && !amInRoomCall ? "영상으로 참여" : "영상 통화");
    setCallButton(dom.toggleMicBtn, state.call.audioEnabled ? "bi-mic" : "bi-mic-mute", state.call.audioEnabled ? "마이크" : "음소거 해제");
    setCallButton(dom.toggleCameraBtn, state.call.cameraEnabled ? "bi-camera-video" : "bi-camera-video-off", state.call.cameraEnabled ? "카메라" : "카메라 켜기");
    setCallButton(dom.screenShareBtn, state.call.sharingScreen ? "bi-display-fill" : "bi-display", state.call.sharingScreen ? "공유 중지" : "화면 공유");
    setCallButton(dom.leaveCallBtn, "bi-telephone-x", "나가기");

    if (dom.audioCallBtn) dom.audioCallBtn.disabled = !room || !callReady || state.call.joining || joinedElsewhere || amInRoomCall;
    if (dom.videoCallBtn) dom.videoCallBtn.disabled = !room || !callReady || state.call.joining || joinedElsewhere || amInRoomCall;
    if (dom.toggleMicBtn) {
      dom.toggleMicBtn.disabled = !joinedHere;
      dom.toggleMicBtn.classList.toggle("is-active", joinedHere && !!state.call.audioEnabled);
    }
    if (dom.toggleCameraBtn) {
      dom.toggleCameraBtn.disabled = !joinedHere;
      dom.toggleCameraBtn.classList.toggle("is-active", joinedHere && !!state.call.cameraEnabled);
    }
    if (dom.screenShareBtn) {
      dom.screenShareBtn.disabled = !joinedHere;
      dom.screenShareBtn.classList.toggle("is-active", joinedHere && !!state.call.sharingScreen);
    }
    if (dom.leaveCallBtn) dom.leaveCallBtn.disabled = !joinedHere;

    renderCallGrid(roomCall);
  }

  async function handleCallStateUpdate(call) {
    const roomCall = call || null;
    const roomId = Number((roomCall && roomCall.room_id) || 0);
    if (roomId <= 0) return;
    state.call.roomCallsById[roomId] = roomCall;
    renderCallUi();
  }

  async function handleCallCleared(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    delete state.call.roomCallsById[targetRoomId];
    renderCallUi();
  }

  async function handleIncomingCallSignal(payload) {
    return;
  }

  function scrollMessagesToBottom(force) {
    if (!dom.messageScroll) return;
    if (force) {
      dom.messageScroll.scrollTop = dom.messageScroll.scrollHeight;
      return;
    }
    const threshold = 140;
    const distance = dom.messageScroll.scrollHeight - (dom.messageScroll.scrollTop + dom.messageScroll.clientHeight);
    if (distance <= threshold) {
      dom.messageScroll.scrollTop = dom.messageScroll.scrollHeight;
    }
  }

  async function markActiveRoomRead() {
    const room = state.activeRoom;
    if (!room) return;
    const messages = state.messagesByRoom[room.id] || [];
    const lastMessage = messages.length ? messages[messages.length - 1] : null;
    const messageId = Number((lastMessage && lastMessage.id) || room.last_message_id || 0);
    if (messageId <= 0) return;
    try {
      await api("/api/messenger/rooms/" + room.id + "/read", {
        method: "POST",
        body: JSON.stringify({ message_id: messageId }),
      });
      room.unread_count = 0;
      dismissNotificationsForRoom(room.id);
      recalcCounts();
      renderRoomList();
    } catch (_) {}
  }

  function appendMessage(roomId, message) {
    if (!message || !message.id) return;
    state.messagesByRoom[roomId] = state.messagesByRoom[roomId] || [];
    if (messageExists(roomId, message.id)) return;
    state.messagesByRoom[roomId].push(message);
    state.messagesByRoom[roomId].sort(function (a, b) {
      return Number(a.id || 0) - Number(b.id || 0);
    });
  }

  async function sendMessage() {
    const room = state.activeRoom;
    if (!room || !dom.composerInput) return;
    const content = normalizeText(dom.composerInput.value);
    if (!content) return;

    dom.sendBtn.disabled = true;
    try {
      const payload = await api("/api/messenger/rooms/" + room.id + "/messages", {
        method: "POST",
        body: JSON.stringify({ content: content }),
      });
      if (payload && payload.message) {
        appendMessage(room.id, payload.message);
        renderMessages();
        scrollMessagesToBottom(true);
      }
      dom.composerInput.value = "";
      resizeComposer();
      emitTyping(false);
      markActiveRoomRead();
    } catch (error) {
      await showError(error.message || "메시지 전송에 실패했습니다.");
    } finally {
      dom.sendBtn.disabled = false;
    }
  }

  async function toggleStar() {
    const room = state.activeRoom;
    if (!room) return;
    try {
      const payload = await api("/api/messenger/rooms/" + room.id + "/star", {
        method: "POST",
        body: JSON.stringify({ starred: !room.is_starred }),
      });
      if (payload && payload.room) {
        mergeRoom(payload.room);
      }
    } catch (error) {
      await showError(error.message || "중요 표시 변경에 실패했습니다.");
    }
  }

  async function copyRoomLink() {
    const room = state.activeRoom;
    if (!room) return;
    const copied = await copyText(roomDeepLink(room));
    if (!copied) {
      await showError("대화 링크 복사에 실패했습니다.");
      return;
    }
    await showToast("success", "대화 링크를 복사했습니다.");
  }

  async function toggleMuteRoom() {
    const room = state.activeRoom;
    if (!room) return;
    try {
      const payload = await api("/api/messenger/rooms/" + room.id + "/mute", {
        method: "POST",
        body: JSON.stringify({ muted: !room.is_muted }),
      });
      if (payload && payload.room) {
        mergeRoom(payload.room);
      }
    } catch (error) {
      await showError(error.message || "알림 설정 변경에 실패했습니다.");
    }
  }

  async function uploadAttachment(file) {
    const room = state.activeRoom;
    if (!room || !file) return;
    const formData = new FormData();
    formData.append("attachment", file);
    if (dom.attachBtn) dom.attachBtn.disabled = true;
    try {
      const response = await fetch("/api/messenger/rooms/" + room.id + "/attachments", {
        method: "POST",
        body: formData,
        cache: "no-store",
      });
      const payload = await response.json().catch(function () {
        return {};
      });
      if (!response.ok || !payload.ok) {
        throw new Error(normalizeText(payload.detail) || ("HTTP " + response.status));
      }
      if (payload && payload.message) {
        appendMessage(room.id, payload.message);
        renderMessages();
        renderInspector();
        scrollMessagesToBottom(true);
      }
      markActiveRoomRead();
    } catch (error) {
      await showError(error.message || "첨부 파일 전송에 실패했습니다.");
    } finally {
      if (dom.attachBtn) dom.attachBtn.disabled = !state.activeRoom;
      if (dom.attachInput) dom.attachInput.value = "";
    }
  }

  async function updateRoomAvatarPreset(avatarPath) {
    const room = state.activeRoom;
    if (!canEditRoomAvatar(room)) return;
    try {
      const payload = await api("/api/messenger/rooms/" + room.id + "/avatar", {
        method: "POST",
        body: JSON.stringify({ avatar_path: normalizeText(avatarPath) }),
      });
      if (payload && payload.room) {
        mergeRoom(payload.room);
      }
    } catch (error) {
      await showError(error.message || "방 이미지 변경에 실패했습니다.");
      return;
    }
    await showToast("success", "방 프로필 이미지를 변경했습니다.");
  }

  async function uploadRoomAvatar(file) {
    const room = state.activeRoom;
    if (!canEditRoomAvatar(room) || !file) return;
    const formData = new FormData();
    formData.append("avatar", file);
    try {
      const response = await fetch("/api/messenger/rooms/" + room.id + "/avatar/upload", {
        method: "POST",
        body: formData,
        cache: "no-store",
      });
      const payload = await response.json().catch(function () {
        return {};
      });
      if (!response.ok || !payload.ok) {
        throw new Error(normalizeText(payload.detail) || ("HTTP " + response.status));
      }
      if (payload && payload.room) {
        mergeRoom(payload.room);
      }
      await showToast("success", "방 프로필 이미지를 업로드했습니다.");
    } catch (error) {
      await showError(error.message || "방 이미지 업로드에 실패했습니다.");
    } finally {
      if (dom.roomAvatarInput) {
        dom.roomAvatarInput.value = "";
      }
    }
  }

  function roomContextMenuItems(room) {
    if (!room) return [];
    const items = [
      { action: "room-open", label: "대화 열기", icon: "bi-chat-dots", data: { roomId: room.id } },
      { action: "room-copy-link", label: "대화 링크 복사", icon: "bi-link-45deg", data: { roomId: room.id } },
      { action: "room-toggle-star", label: room.is_starred ? "즐겨찾기 해제" : "즐겨찾기 추가", icon: room.is_starred ? "bi-star-fill" : "bi-star", data: { roomId: room.id } },
      { action: "room-toggle-mute", label: room.is_muted ? "알림 켜기" : "알림 끄기", icon: room.is_muted ? "bi-bell-fill" : "bi-bell-slash", data: { roomId: room.id } },
    ];
    if (room.can_edit_room) {
      items.push({ action: "room-edit", label: "대화방 정보 수정", icon: "bi-pencil-square", data: { roomId: room.id } });
    }
    if (room.can_delete_room) {
      items.push({ action: "room-delete", label: "대화방 삭제", icon: "bi-trash3", data: { roomId: room.id }, danger: true });
    }
    return items;
  }

  function showRoomContextMenu(event, room) {
    const items = roomContextMenuItems(room);
    if (!items.length) return;
    openContextMenu(event, items);
  }

  function showMessageContextMenu(event, message) {
    if (!message) return;
    const items = [
      { action: "message-copy", label: "메시지 복사", icon: "bi-copy", data: { roomId: message.room_id, messageId: message.id } },
    ];
    if (canEditMessage(message)) {
      items.push({ action: "message-edit", label: "메시지 수정", icon: "bi-pencil-square", data: { roomId: message.room_id, messageId: message.id } });
    }
    if (canDeleteMessage(message)) {
      items.push({ action: "message-delete", label: "메시지 삭제", icon: "bi-trash3", data: { roomId: message.room_id, messageId: message.id }, danger: true });
    }
    openContextMenu(event, items);
  }

  function showParticipantContextMenu(event, userId) {
    const targetUserId = normalizeText(userId);
    if (!targetUserId) return;
    const items = [];
    if (!state.currentUser || normalizeText((state.currentUser && state.currentUser.user_id) || "") !== targetUserId) {
      items.push({ action: "participant-dm", label: "1:1 대화 열기", icon: "bi-chat-left-text", data: { userId: targetUserId } });
    }
    if (state.activeRoom && canManageRoom(state.activeRoom) && !state.activeRoom.is_direct) {
      items.push({ action: "room-invite", label: "다른 구성원 초대", icon: "bi-person-plus", data: { roomId: state.activeRoom.id } });
    }
    if (!items.length) return;
    openContextMenu(event, items);
  }

  function showResourceContextMenu(event, resourceUrl, resourceTitle) {
    const url = normalizeText(resourceUrl);
    const title = normalizeText(resourceTitle);
    const items = [];
    if (url) {
      items.push({ action: "resource-open", label: "링크 열기", icon: "bi-box-arrow-up-right", data: { url: url } });
      items.push({ action: "resource-copy-link", label: "링크 복사", icon: "bi-copy", data: { url: url } });
    }
    if (title) {
      items.push({ action: "resource-copy-title", label: "이름 복사", icon: "bi-files", data: { title: title } });
    }
    if (!items.length) return;
    openContextMenu(event, items);
  }

  function inviteCandidateContacts(room) {
    const targetRoom = room || state.activeRoom;
    if (!targetRoom || targetRoom.is_direct) return [];
    const existingMemberIds = new Set((targetRoom.members || []).map(function (member) {
      return normalizeText((member || {}).user_id);
    }).filter(Boolean));
    return (state.contacts || []).filter(function (contact) {
      const userId = normalizeText((contact || {}).user_id);
      return !!userId && !existingMemberIds.has(userId);
    });
  }

  function inviteCandidateMarkup(contact, selected) {
    const avatar = contact.profile_image_url
      ? '<img src="' + escapeHtml(contact.profile_image_url) + '" alt="' + escapeHtml(contact.display_name) + '">'
      : escapeHtml(contact.avatar_initial || "U");
    return [
      '<button class="messenger-contact-picker__item' + (selected ? ' is-selected' : '') + '" type="button" data-invite-user-id="' + escapeAttribute(contact.user_id) + '">',
      '<span class="messenger-contact-picker__avatar">' + avatar + "</span>",
      '<span class="messenger-contact-picker__meta">',
      "<strong>" + escapeHtml(contact.display_name || contact.user_id) + "</strong>",
      "<span>" + escapeHtml(contact.department || contact.presence_label || "구성원") + "</span>",
      "</span>",
      '<span class="messenger-contact-picker__checkbox"><i class="bi bi-check-lg"></i></span>',
      "</button>",
    ].join("");
  }

  async function promptInviteMembers(room) {
    const targetRoom = room || state.activeRoom;
    const candidates = inviteCandidateContacts(targetRoom);
    if (!candidates.length) {
      await showWarning("추가로 초대할 수 있는 구성원이 없습니다.");
      return null;
    }
    if (!hasSwal()) {
      await showWarning("초대 창을 열 수 없습니다.");
      return null;
    }

    const selectedUserIds = new Set();
    const result = await fireDialog({
      title: "멤버 초대",
      width: "44rem",
      html: [
        '<div class="app-swal-form">',
        '<div class="app-swal-field-group">',
        '<label class="form-label" for="swalMessengerInviteSearch">초대할 구성원</label>',
        '<input id="swalMessengerInviteSearch" class="form-control app-swal-field app-swal-contact-search" type="search" placeholder="이름, 닉네임, 부서로 찾기">',
        '</div>',
        '<div class="messenger-contact-picker app-swal-contact-picker" id="swalMessengerInviteList"></div>',
        '</div>',
      ].join(""),
      showCancelButton: true,
      confirmButtonText: "초대",
      cancelButtonText: "취소",
      focusConfirm: false,
      didOpen: function () {
        const searchInput = document.getElementById("swalMessengerInviteSearch");
        const list = document.getElementById("swalMessengerInviteList");
        if (!list) return;

        const renderList = function () {
          const query = normalizeText(searchInput && searchInput.value).toLowerCase();
          const filtered = candidates.filter(function (contact) {
            if (!query) return true;
            const haystack = [
              contact.display_name,
              contact.department,
              contact.user_id,
            ].join(" ").toLowerCase();
            return haystack.indexOf(query) !== -1;
          });
          if (!filtered.length) {
            list.innerHTML = '<div class="messenger-empty-inline">검색 결과가 없습니다.</div>';
            return;
          }
          list.innerHTML = filtered.map(function (contact) {
            return inviteCandidateMarkup(contact, selectedUserIds.has(normalizeText(contact.user_id)));
          }).join("");
        };

        list.addEventListener("click", function (event) {
          const button = event.target instanceof Element ? event.target.closest("[data-invite-user-id]") : null;
          if (!button) return;
          const userId = normalizeText(button.getAttribute("data-invite-user-id"));
          if (!userId) return;
          if (selectedUserIds.has(userId)) {
            selectedUserIds.delete(userId);
          } else {
            selectedUserIds.add(userId);
          }
          renderList();
        });

        if (searchInput) {
          searchInput.addEventListener("input", renderList);
          searchInput.focus();
        }
        renderList();
      },
      preConfirm: function () {
        if (!selectedUserIds.size) {
          window.Swal.showValidationMessage("초대할 구성원을 선택해주세요.");
          return false;
        }
        return Array.from(selectedUserIds);
      },
    });
    return result && result.isConfirmed ? (result.value || []) : null;
  }

  async function inviteMembersToRoom(room) {
    const targetRoom = room || state.activeRoom;
    if (!targetRoom || !canManageRoom(targetRoom) || targetRoom.is_direct) return;
    const memberIds = await promptInviteMembers(targetRoom);
    if (!Array.isArray(memberIds) || !memberIds.length) return;
    try {
      const payload = await api("/api/messenger/rooms/" + targetRoom.id + "/members", {
        method: "POST",
        body: JSON.stringify({ member_ids: memberIds }),
      });
      if (payload && payload.room) {
        mergeRoom(payload.room);
        state.activeRoom = currentRoom();
        renderHeader();
        renderInspector();
      }
      await showToast("success", "멤버를 초대했습니다.");
    } catch (error) {
      await showError(error.message || "멤버 초대에 실패했습니다.");
    }
  }

  async function editRoomDetails(room) {
    const targetRoom = room || state.activeRoom;
    if (!targetRoom || !targetRoom.can_edit_room) return;
    const roomDetails = await promptRoomDetails(targetRoom);
    if (!roomDetails) return;
    try {
      const payload = await api("/api/messenger/rooms/" + targetRoom.id, {
        method: "PATCH",
        body: JSON.stringify({
          name: normalizeText(roomDetails.name),
          topic: normalizeText(roomDetails.topic),
        }),
      });
      if (payload && payload.room) {
        mergeRoom(payload.room);
      }
      await showToast("success", "대화방 정보를 저장했습니다.");
    } catch (error) {
      await showError(error.message || "대화방 수정에 실패했습니다.");
    }
  }

  async function deleteRoom(room) {
    const targetRoom = room || state.activeRoom;
    if (!targetRoom || !targetRoom.can_delete_room) return;
    const confirmed = await askConfirm(
      "대화방 삭제",
      "대화방을 삭제하면 메시지와 첨부 기록도 함께 사라집니다.",
      "삭제",
      "warning"
    );
    if (!confirmed) return;
    try {
      await api("/api/messenger/rooms/" + targetRoom.id, {
        method: "DELETE",
      });
      removeRoom(targetRoom.id);
      await showToast("success", "대화방을 삭제했습니다.");
    } catch (error) {
      await showError(error.message || "대화방 삭제에 실패했습니다.");
    }
  }

  async function editMessageItem(message) {
    if (!message || !canEditMessage(message)) return;
    const nextContent = await promptText({
      title: "메시지 수정",
      text: "메시지 내용을 수정해주세요.",
      value: String(message.content || ""),
      input: "textarea",
      confirmText: "저장",
      requiredMessage: "메시지 내용을 입력해주세요.",
      maxLength: 4000,
    });
    if (nextContent === null) return;
    try {
      const payload = await api("/api/messenger/messages/" + message.id, {
        method: "PATCH",
        body: JSON.stringify({ content: nextContent }),
      });
      if (payload && payload.message) {
        replaceMessage(message.room_id, payload.message);
        if (Number(state.activeRoomId || 0) === Number(message.room_id || 0)) {
          renderMessages();
          renderInspector();
        }
      }
      await showToast("success", "메시지를 수정했습니다.");
    } catch (error) {
      await showError(error.message || "메시지 수정에 실패했습니다.");
    }
  }

  async function deleteMessageItem(message) {
    if (!message || !canDeleteMessage(message)) return;
    if (!await askConfirm("메시지 삭제", "이 메시지를 삭제할까요?", "삭제", "warning")) return;
    try {
      await api("/api/messenger/messages/" + message.id, {
        method: "DELETE",
      });
      removeMessageFromRoom(message.room_id, message.id);
      if (Number(state.activeRoomId || 0) === Number(message.room_id || 0)) {
        renderMessages();
        renderInspector();
      }
      await showToast("success", "메시지를 삭제했습니다.");
    } catch (error) {
      await showError(error.message || "메시지 삭제에 실패했습니다.");
    }
  }

  async function copyMessageText(message) {
    if (!message) return;
    const copied = await copyText(String(message.content || ""));
    if (!copied) {
      await showError("메시지 복사에 실패했습니다.");
      return;
    }
    await showToast("success", "메시지를 복사했습니다.");
  }

  async function handleContextAction(button) {
    if (!(button instanceof Element)) return;
    const action = normalizeText(button.getAttribute("data-context-action"));
    const roomId = Number(button.getAttribute("data-room-id") || 0);
    const messageId = Number(button.getAttribute("data-message-id") || 0);
    const userId = normalizeText(button.getAttribute("data-user-id"));
    const url = normalizeText(button.getAttribute("data-url"));
    const title = normalizeText(button.getAttribute("data-title"));
    setContextMenuOpen(false);
    if (action === "room-open") return openRoom(roomId);
    if (action === "room-copy-link") {
      const copied = await copyText(roomDeepLink(findRoomById(roomId) || state.activeRoom));
      if (!copied) {
        await showError("대화 링크 복사에 실패했습니다.");
        return;
      }
      await showToast("success", "대화 링크를 복사했습니다.");
      return;
    }
    if (action === "room-toggle-star") {
      const room = findRoomById(roomId);
      if (!room) return;
      const activeBackup = state.activeRoom;
      state.activeRoom = room;
      await toggleStar();
      state.activeRoom = currentRoom() || activeBackup;
      return;
    }
    if (action === "room-toggle-mute") {
      const room = findRoomById(roomId);
      if (!room) return;
      const activeBackup = state.activeRoom;
      state.activeRoom = room;
      await toggleMuteRoom();
      state.activeRoom = currentRoom() || activeBackup;
      return;
    }
    if (action === "room-edit") return editRoomDetails(findRoomById(roomId));
    if (action === "room-delete") return deleteRoom(findRoomById(roomId));
    if (action === "message-copy") return copyMessageText(findMessageById(roomId, messageId));
    if (action === "message-edit") return editMessageItem(findMessageById(roomId, messageId));
    if (action === "message-delete") return deleteMessageItem(findMessageById(roomId, messageId));
    if (action === "participant-dm" && userId) return createDirectRoom(userId);
    if (action === "room-invite") return inviteMembersToRoom(findRoomById(roomId) || state.activeRoom);
    if (action === "resource-open" && url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    if (action === "resource-copy-link" && url) {
      const copied = await copyText(url);
      if (!copied) {
        await showError("링크 복사에 실패했습니다.");
        return;
      }
      await showToast("success", "링크를 복사했습니다.");
      return;
    }
    if (action === "resource-copy-title" && title) {
      const copied = await copyText(title);
      if (!copied) {
        await showError("이름 복사에 실패했습니다.");
        return;
      }
      await showToast("success", "이름을 복사했습니다.");
    }
  }

  function setModalMode(mode) {
    state.modalMode = mode === "group" ? "group" : "dm";
    state.selectedContacts.clear();
    if (dom.groupNameWrap) dom.groupNameWrap.classList.toggle("d-none", state.modalMode !== "group");
    if (dom.groupTopicWrap) dom.groupTopicWrap.classList.toggle("d-none", state.modalMode !== "group");
    if (dom.newRoomMode) {
      Array.prototype.forEach.call(dom.newRoomMode.querySelectorAll("[data-mode]"), function (button) {
        button.classList.toggle("is-active", normalizeText(button.getAttribute("data-mode")) === state.modalMode);
      });
    }
    if (dom.createRoomSubmitBtn) {
      dom.createRoomSubmitBtn.textContent = state.modalMode === "group" ? "그룹방 만들기" : "대화 시작";
    }
    renderContactPicker();
  }

  function filteredContactsForPicker() {
    const search = normalizeText(dom.contactSearch && dom.contactSearch.value).toLowerCase();
    return (state.contacts || []).filter(function (contact) {
      if (!search) return true;
      const haystack = [contact.display_name, contact.department, contact.user_id].join(" ").toLowerCase();
      return haystack.indexOf(search) !== -1;
    });
  }

  function renderContactPicker() {
    if (!dom.contactPicker) return;
    const contacts = filteredContactsForPicker();
    if (!contacts.length) {
      dom.contactPicker.innerHTML = '<div class="messenger-empty-inline">검색 결과가 없습니다.</div>';
      return;
    }

    dom.contactPicker.innerHTML = contacts.map(function (contact) {
      const selected = state.selectedContacts.has(contact.user_id);
      const avatar = contact.profile_image_url
        ? '<img src="' + escapeHtml(contact.profile_image_url) + '" alt="' + escapeHtml(contact.display_name) + '">'
        : escapeHtml(contact.avatar_initial || "U");
      return [
        '<button class="messenger-contact-picker__item' + (selected ? ' is-selected' : '') + '" type="button" data-picker-id="' + escapeHtml(contact.user_id) + '">',
        '<span class="messenger-contact-picker__avatar">' + avatar + "</span>",
        '<span class="messenger-contact-picker__meta">',
        "<strong>" + escapeHtml(contact.display_name) + "</strong>",
        "<span>" + escapeHtml(contact.department || contact.presence_label || "구성원") + "</span>",
        "</span>",
        '<span class="messenger-contact-picker__checkbox"><i class="bi bi-check-lg"></i></span>',
        "</button>",
      ].join("");
    }).join("");

    Array.prototype.forEach.call(dom.contactPicker.querySelectorAll("[data-picker-id]"), function (button) {
      button.addEventListener("click", function () {
        const userId = normalizeText(button.getAttribute("data-picker-id"));
        if (!userId) return;
        if (state.modalMode === "dm") {
          state.selectedContacts = new Set([userId]);
        } else if (state.selectedContacts.has(userId)) {
          state.selectedContacts.delete(userId);
        } else {
          state.selectedContacts.add(userId);
        }
        renderContactPicker();
      });
    });
  }

  async function createDirectRoom(targetUserId) {
    try {
      const payload = await api("/api/messenger/rooms", {
        method: "POST",
        body: JSON.stringify({ mode: "dm", target_user_id: targetUserId }),
      });
      const roomId = Number((payload && payload.room_id) || (payload.room && payload.room.id) || 0);
      if (roomId > 0) {
        await loadBootstrap(roomId);
      }
    } catch (error) {
      await showError(error.message || "대화 시작에 실패했습니다.");
    }
  }

  async function submitCreateRoom() {
    const selected = Array.from(state.selectedContacts);
    if (!selected.length) {
      await showWarning("대화할 사용자를 선택해주세요.");
      return;
    }

    try {
      let payload;
      if (state.modalMode === "dm") {
        payload = await api("/api/messenger/rooms", {
          method: "POST",
          body: JSON.stringify({
            mode: "dm",
            target_user_id: selected[0],
          }),
        });
      } else {
        const name = normalizeText(dom.groupNameInput && dom.groupNameInput.value);
        const topic = normalizeText(dom.groupTopicInput && dom.groupTopicInput.value);
        payload = await api("/api/messenger/rooms", {
          method: "POST",
          body: JSON.stringify({
            mode: "group",
            name: name,
            topic: topic,
            member_ids: selected,
          }),
        });
      }
      const roomId = Number((payload && payload.room_id) || (payload.room && payload.room.id) || 0);
      if (dom.newRoomModalInstance) dom.newRoomModalInstance.hide();
      if (dom.groupNameInput) dom.groupNameInput.value = "";
      if (dom.groupTopicInput) dom.groupTopicInput.value = "";
      if (dom.contactSearch) dom.contactSearch.value = "";
      state.selectedContacts.clear();
      renderContactPicker();
      if (roomId > 0) {
        await loadBootstrap(roomId);
      }
    } catch (error) {
      await showError(error.message || "대화방 생성에 실패했습니다.");
    }
  }

  function setSocketConnected(connected) {
    const room = state.activeRoom;
    if (!room || !dom.activeRoomSubtitle) return;
    const baseText = normalizeText(room.subtitle || room.topic || "");
    dom.activeRoomSubtitle.textContent = connected ? baseText : (baseText ? baseText + " · 연결 재시도 중" : "연결 재시도 중");
  }

  function sendSocket(payload) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    try {
      state.socket.send(JSON.stringify(payload));
    } catch (_) {}
  }

  function stopHeartbeat() {
    if (!state.heartbeatTimer) return;
    window.clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = 0;
  }

  function scheduleReconnect() {
    if (state.reconnectTimer) return;
    state.reconnectTimer = window.setTimeout(function () {
      state.reconnectTimer = 0;
      connectSocket();
    }, 1500);
  }

  async function handleSocketMessage(event) {
    let payload = {};
    try {
      payload = JSON.parse(event.data || "{}");
    } catch (_) {
      payload = {};
    }
    const type = normalizeText(payload.type).toLowerCase();
    if (type === "pong" || type === "connected") {
      setSocketConnected(true);
      return;
    }
    if (type === "bootstrap" && payload.payload) {
      const data = payload.payload;
      state.userProfilesById = {};
      state.currentUser = data.current_user || state.currentUser;
      loadDismissedNotifications();
      state.rooms = Array.isArray(data.rooms) ? data.rooms.slice() : state.rooms;
      state.contacts = Array.isArray(data.contacts) ? data.contacts.slice() : state.contacts;
      sortRooms();
      updateNotificationState(data.notifications || {}, data.counts || {});
      recalcCounts();
      renderQuickContacts();
      renderRoomList();
      renderMentionPicker();
      state.activeRoom = currentRoom();
      renderHeader();
      renderInspector();
      return;
    }
    if (type === "notifications_updated") {
      updateNotificationState(payload.notifications || {}, payload.counts || null);
      return;
    }
    if (type === "room_updated" && payload.room) {
      mergeRoom(payload.room);
      if (Number((payload.room && payload.room.id) || 0) === Number(state.activeRoomId || 0)) {
        state.activeRoom = currentRoom();
        renderHeader();
        renderInspector();
      }
      return;
    }
    if (type === "room_removed") {
      removeRoom(Number(payload.room_id || 0));
      return;
    }
    if (type === "message_created" && payload.message) {
      const roomId = Number(payload.room_id || (payload.message && payload.message.room_id) || 0);
      if (roomId <= 0) return;
      const isActivelyViewingRoom = state.isOpen && !document.hidden && Number(state.activeRoomId || 0) === roomId;
      appendMessage(roomId, payload.message);
      if (!payload.message.is_mine && !isActivelyViewingRoom) {
        const notificationItem = buildNotificationItemFromMessage(payload.message);
        upsertNotificationItem(notificationItem);
        showBrowserNotification(notificationItem);
      }
      if (Number(state.activeRoomId || 0) === roomId) {
        renderMessages();
        scrollMessagesToBottom(false);
        markActiveRoomRead();
      }
      return;
    }
    if (type === "message_updated" && payload.message) {
      const roomId = Number(payload.room_id || (payload.message && payload.message.room_id) || 0);
      if (roomId <= 0) return;
      replaceMessage(roomId, payload.message);
      if (Number(state.activeRoomId || 0) === roomId) {
        renderMessages();
        renderInspector();
      }
      return;
    }
    if (type === "message_deleted") {
      const roomId = Number(payload.room_id || 0);
      const messageId = Number(payload.message_id || 0);
      if (roomId <= 0 || messageId <= 0) return;
      removeMessageFromRoom(roomId, messageId);
      if (Number(state.activeRoomId || 0) === roomId) {
        renderMessages();
        renderInspector();
      }
      return;
    }
    if (type === "call_state" && payload.call) {
      await handleCallStateUpdate(payload.call);
      return;
    }
    if (type === "call_cleared") {
      await handleCallCleared(Number(payload.room_id || 0));
      return;
    }
    if (type === "call_joined") {
      if (payload.call) {
        await handleCallStateUpdate(payload.call);
      }
      return;
    }
    if (type === "call_signal") {
      await handleIncomingCallSignal(payload);
      return;
    }
    if (type === "typing") {
      return;
    }
  }

  function connectSocket() {
    const socketUrl = resolveWsUrl("/ws/messenger");
    if (!socketUrl) return;
    if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) return;

    try {
      state.socket = new WebSocket(socketUrl);
    } catch (_) {
      scheduleReconnect();
      return;
    }

    state.socket.addEventListener("open", function () {
      stopHeartbeat();
      state.heartbeatTimer = window.setInterval(function () {
        sendSocket({ type: "ping" });
      }, 12000);
      sendSocket({ type: "ping" });
      if (state.call.joinedRoomId > 0) {
        sendSocket({
          type: "call_join",
          room_id: state.call.joinedRoomId,
          media_mode: (state.call.sharingScreen || state.call.cameraEnabled) ? "video" : "audio",
          audio_enabled: !!state.call.audioEnabled,
          video_enabled: !!(state.call.sharingScreen || state.call.cameraEnabled),
          sharing_screen: !!state.call.sharingScreen,
          source: state.call.sharingScreen ? "screen" : "camera",
        });
        sendSocket({ type: "call_sync", room_id: state.call.joinedRoomId });
      }
      if (state.activeRoomId > 0) {
        sendSocket({ type: "refresh_room", room_id: state.activeRoomId });
      }
      setSocketConnected(true);
    });

    state.socket.addEventListener("message", function (event) {
      handleSocketMessage(event).catch(function () {});
    });
    state.socket.addEventListener("close", function () {
      stopHeartbeat();
      state.socket = null;
      setSocketConnected(false);
      scheduleReconnect();
    });
    state.socket.addEventListener("error", function () {
      try {
        if (state.socket) state.socket.close();
      } catch (_) {}
    });
  }

  function emitTyping(isTyping) {
    return;
  }

  function scheduleTypingEvent() {
    return;
  }

  function bindEvents() {
    if (dom.launcherBtn) {
      dom.launcherBtn.addEventListener("click", function () {
        requestBrowserNotificationPermission(true);
        togglePopup();
      });
    }
    if (dom.notifyBtn) {
      dom.notifyBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        requestBrowserNotificationPermission(true);
        setNotificationMenuOpen(!state.notificationMenuOpen);
      });
    }
    if (dom.notifyOpenMessengerBtn) {
      dom.notifyOpenMessengerBtn.addEventListener("click", function () {
        requestBrowserNotificationPermission(true);
        setNotificationMenuOpen(false);
        setPopupOpen(true);
      });
    }
    if (dom.popupBackdrop) {
      dom.popupBackdrop.addEventListener("click", function () {
        setPopupOpen(false);
      });
    }
    if (dom.closeBtn) {
      dom.closeBtn.addEventListener("click", function () {
        setPopupOpen(false);
      });
    }
    if (dom.minimizeBtn) {
      dom.minimizeBtn.addEventListener("click", function () {
        setPopupOpen(false);
      });
    }
    if (dom.dragHandle) {
      dom.dragHandle.addEventListener("mousedown", beginPopupDrag);
    }

    if (dom.railRoomsBtn) {
      dom.railRoomsBtn.addEventListener("click", function () {
        setSidebarMode("rooms");
      });
    }

    if (dom.railInboxBtn) {
      dom.railInboxBtn.addEventListener("click", function () {
        setSidebarMode("inbox");
      });
    }

    if (dom.railUnreadBtn) {
      dom.railUnreadBtn.addEventListener("click", function () {
        setSidebarMode("unread");
      });
    }

    if (dom.railStarredBtn) {
      dom.railStarredBtn.addEventListener("click", function () {
        setSidebarMode("starred_shortcut");
      });
    }

    if (dom.railAlertsBtn) {
      dom.railAlertsBtn.addEventListener("click", function () {
        setSidebarMode("alerts");
      });
    }

    if (dom.railComposeBtn) {
      dom.railComposeBtn.addEventListener("click", function () {
        setModalMode("dm");
        if (dom.newRoomModalInstance) dom.newRoomModalInstance.show();
      });
    }

    if (dom.railRecentBtn) {
      dom.railRecentBtn.addEventListener("click", function () {
        setSidebarMode("recent");
      });
    }

    if (dom.railGuideBtn) {
      dom.railGuideBtn.addEventListener("click", function () {
        setSidebarMode("guide");
      });
    }

    if (dom.railSettingsBtn) {
      dom.railSettingsBtn.addEventListener("click", function () {
        setSidebarMode("settings");
      });
    }

    if (dom.sidebarSearchBtn) {
      dom.sidebarSearchBtn.addEventListener("click", function () {
        if (!dom.roomSearch) return;
        dom.roomSearch.focus();
        dom.roomSearch.select();
      });
    }

    if (dom.roomSearch) {
      dom.roomSearch.addEventListener("input", function () {
        state.search = normalizeText(dom.roomSearch.value);
        renderRoomList();
      });
    }

    if (dom.filterTabs) {
      Array.prototype.forEach.call(dom.filterTabs.querySelectorAll("[data-filter]"), function (button) {
        button.addEventListener("click", function () {
          if (state.sidebarMode !== "rooms") {
            setSidebarMode("rooms");
          }
          state.filter = normalizeText(button.getAttribute("data-filter")) || "all";
          syncFilterTabs(state.filter);
          renderRoomList();
        });
      });
    }

    if (dom.sendBtn) dom.sendBtn.addEventListener("click", sendMessage);
    if (dom.starToggleBtn) dom.starToggleBtn.addEventListener("click", toggleStar);
    if (dom.roomLinkBtn) dom.roomLinkBtn.addEventListener("click", copyRoomLink);
    if (dom.roomMuteBtn) dom.roomMuteBtn.addEventListener("click", toggleMuteRoom);
    if (dom.roomMoreBtn) {
      dom.roomMoreBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        if (dom.roomMoreBtn.disabled) return;
        setRoomMoreMenuOpen(!state.roomMoreMenuOpen);
      });
    }
    if (dom.audioCallBtn) {
      dom.audioCallBtn.addEventListener("click", function () {
        startOrJoinCall("audio");
      });
    }
    if (dom.videoCallBtn) {
      dom.videoCallBtn.addEventListener("click", function () {
        startOrJoinCall("video");
      });
    }
    if (dom.toggleMicBtn) {
      dom.toggleMicBtn.addEventListener("click", function () {
        toggleCallMute().catch(function (error) {
          showError(error.message || "마이크 상태를 바꾸지 못했습니다.");
        });
      });
    }
    if (dom.toggleCameraBtn) {
      dom.toggleCameraBtn.addEventListener("click", function () {
        toggleCallCamera().catch(function (error) {
          showError(error.message || "카메라 상태를 바꾸지 못했습니다.");
        });
      });
    }
    if (dom.screenShareBtn) {
      dom.screenShareBtn.addEventListener("click", function () {
        toggleScreenShare().catch(function (error) {
          showError(error.message || "화면 공유 상태를 바꾸지 못했습니다.");
        });
      });
    }
    if (dom.leaveCallBtn) {
      dom.leaveCallBtn.addEventListener("click", function () {
        leaveCurrentCall().catch(function (error) {
          showError(error.message || "통화에서 나가지 못했습니다.");
        });
      });
    }
    if (dom.chatHeader) {
      dom.chatHeader.addEventListener("contextmenu", function (event) {
        const target = event.target instanceof Element ? event.target : null;
        if (target && target.closest("button, a, input, textarea, select")) {
          return;
        }
        showRoomContextMenu(event, state.activeRoom);
      });
    }
    if (dom.messageScroll) {
      dom.messageScroll.addEventListener("contextmenu", function (event) {
        const target = event.target instanceof Element ? event.target : null;
        if (target && target.closest("[data-message-id], button, a, input, textarea, select")) {
          return;
        }
        showRoomContextMenu(event, state.activeRoom);
      });
    }
    if (dom.roomMoreMenu) {
      dom.roomMoreMenu.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target.closest("[data-room-menu-action]") : null;
        if (!target) return;
        const action = normalizeText(target.getAttribute("data-room-menu-action"));
        setRoomMoreMenuOpen(false);
        if (action === "copy-link") copyRoomLink();
        if (action === "toggle-mute") toggleMuteRoom();
        if (action === "toggle-star") toggleStar();
        if (action === "edit-room") editRoomDetails(state.activeRoom);
        if (action === "delete-room") deleteRoom(state.activeRoom);
        if (action === "refresh-room" && state.activeRoomId > 0) {
          loadRoomMessages(state.activeRoomId).catch(function (error) {
            showError(error.message || "대화 새로고침에 실패했습니다.");
          });
        }
      });
    }
    if (dom.contextMenu) {
      dom.contextMenu.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target.closest("[data-context-action]") : null;
        if (!target) return;
        handleContextAction(target).catch(function (error) {
          showError(error.message || "메뉴 작업에 실패했습니다.");
        });
      });
    }
    if (dom.refreshBtn) dom.refreshBtn.addEventListener("click", function () {
      loadBootstrap(state.activeRoomId).catch(function (error) {
        showError(error.message || "메신저 새로고침에 실패했습니다.");
      });
    });
    if (dom.roomRefreshBtn) dom.roomRefreshBtn.addEventListener("click", function () {
      if (state.activeRoomId > 0) {
        loadRoomMessages(state.activeRoomId).catch(function (error) {
          showError(error.message || "대화 새로고침에 실패했습니다.");
        });
      }
    });
    if (dom.inviteMemberBtn) {
      dom.inviteMemberBtn.addEventListener("click", function () {
        if (dom.inviteMemberBtn.disabled) return;
        inviteMembersToRoom(state.activeRoom);
      });
    }

    if (dom.composerInput) {
      dom.composerInput.addEventListener("input", function () {
        resizeComposer();
        scheduleTypingEvent();
      });
      dom.composerInput.addEventListener("keydown", function (event) {
        const shouldSend = state.preferences.enterToSend
          ? (event.key === "Enter" && !event.shiftKey)
          : (event.key === "Enter" && !event.shiftKey && (event.ctrlKey || event.metaKey));
        if (shouldSend) {
          event.preventDefault();
          sendMessage();
        }
      });
      dom.composerInput.addEventListener("blur", function () {
        emitTyping(false);
      });
    }

    if (dom.attachBtn) {
      dom.attachBtn.addEventListener("click", function () {
        if (dom.attachBtn.disabled || !dom.attachInput) return;
        dom.attachInput.click();
      });
    }

    if (dom.attachInput) {
      dom.attachInput.addEventListener("change", function () {
        const file = dom.attachInput.files && dom.attachInput.files[0];
        if (file) {
          uploadAttachment(file);
        }
      });
    }

    if (dom.roomAvatarInput) {
      dom.roomAvatarInput.addEventListener("change", function () {
        const file = dom.roomAvatarInput.files && dom.roomAvatarInput.files[0];
        if (file) {
          uploadRoomAvatar(file);
        }
      });
    }

    if (dom.emojiBtn) {
      dom.emojiBtn.addEventListener("click", function () {
        if (dom.emojiBtn.disabled) return;
        if (!dom.emojiPicker.innerHTML) renderEmojiPicker();
        setRoomMoreMenuOpen(false);
        setComposerPopover(state.composerPopover === "emoji" ? "" : "emoji");
      });
    }

    if (dom.mentionBtn) {
      dom.mentionBtn.addEventListener("click", function () {
        if (dom.mentionBtn.disabled) return;
        renderMentionPicker();
        setRoomMoreMenuOpen(false);
        setComposerPopover(state.composerPopover === "mention" ? "" : "mention");
      });
    }

    if (dom.linkInsertBtn) {
      dom.linkInsertBtn.addEventListener("click", async function () {
        if (dom.linkInsertBtn.disabled) return;
        const url = normalizeText(await promptText({
          title: "링크 삽입",
          text: "메시지에 넣을 링크를 입력해주세요.",
          value: "https://",
          input: "url",
          confirmText: "삽입",
          requiredMessage: "링크를 입력해주세요.",
          maxLength: 500,
        }));
        if (!url) return;
        insertComposerText(url + " ");
      });
    }

    if (dom.formatBtn) {
      dom.formatBtn.addEventListener("click", function () {
        if (dom.formatBtn.disabled) return;
        const input = dom.composerInput;
        if (!input) return;
        const hasSelection = Number(input.selectionStart || 0) !== Number(input.selectionEnd || 0);
        if (hasSelection) {
          insertComposerText("**", "**");
          return;
        }
        insertComposerText("**강조 텍스트**");
      });
    }

    if (dom.messageScroll) {
      dom.messageScroll.addEventListener("scroll", function () {
        if (!state.activeRoom || !dom.messageScroll) return;
        if (dom.messageScroll.scrollTop <= 36) {
          loadOlderMessages(state.activeRoom.id);
        }
      });
    }

    if (dom.newChatBtn) {
      dom.newChatBtn.addEventListener("click", function () {
        if (dom.newRoomModalInstance) dom.newRoomModalInstance.show();
      });
    }

    if (dom.newRoomMode) {
      Array.prototype.forEach.call(dom.newRoomMode.querySelectorAll("[data-mode]"), function (button) {
        button.addEventListener("click", function () {
          setModalMode(normalizeText(button.getAttribute("data-mode")));
        });
      });
    }

    if (dom.contactSearch) {
      dom.contactSearch.addEventListener("input", renderContactPicker);
    }

    if (dom.createRoomSubmitBtn) {
      dom.createRoomSubmitBtn.addEventListener("click", submitCreateRoom);
    }

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        markActiveRoomRead();
      }
    });

    document.addEventListener("click", function (event) {
      const target = event.target;
      if (state.notificationMenuOpen && dom.notifyRoot && target instanceof Node && !dom.notifyRoot.contains(target)) {
        setNotificationMenuOpen(false);
      }
      if (state.roomMoreMenuOpen && dom.roomMoreMenu && target instanceof Node && !dom.roomMoreMenu.contains(target) && (!dom.roomMoreBtn || !dom.roomMoreBtn.contains(target))) {
        setRoomMoreMenuOpen(false);
      }
      if (state.contextMenuOpen && dom.contextMenu && target instanceof Node && !dom.contextMenu.contains(target)) {
        setContextMenuOpen(false);
      }
      if (state.composerPopover && target instanceof Node) {
        const withinEmoji = !!(dom.emojiPicker && dom.emojiPicker.contains(target));
        const withinMention = !!(dom.mentionPicker && dom.mentionPicker.contains(target));
        const withinEmojiBtn = !!(dom.emojiBtn && dom.emojiBtn.contains(target));
        const withinMentionBtn = !!(dom.mentionBtn && dom.mentionBtn.contains(target));
        if (!withinEmoji && !withinMention && !withinEmojiBtn && !withinMentionBtn) {
          setComposerPopover("");
        }
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && state.notificationMenuOpen) {
        setNotificationMenuOpen(false);
        return;
      }
      if (event.key === "Escape" && state.contextMenuOpen) {
        setContextMenuOpen(false);
        return;
      }
      if (event.key === "Escape" && state.roomMoreMenuOpen) {
        setRoomMoreMenuOpen(false);
        return;
      }
      if (event.key === "Escape" && state.composerPopover) {
        setComposerPopover("");
        return;
      }
      if (event.key === "Escape" && state.isOpen) {
        const modalOpen = !!document.querySelector(".messenger-modal.show");
        if (modalOpen) return;
        setPopupOpen(false);
      }
    });

    window.addEventListener("mousemove", movePopupDrag);
    window.addEventListener("mouseup", endPopupDrag);
    window.addEventListener("resize", function () {
      restorePopupOffset();
    });

    window.addEventListener("pagehide", function () {
      endPopupDrag();
      stopHeartbeat();
      if (state.call.joinedRoomId) {
        disconnectLiveKitRoom(true).catch(function () {});
      }
      try {
        if (state.socket) state.socket.close();
      } catch (_) {}
    });
  }

  function cacheDom() {
    dom.popupLayer = $("messengerPopupLayer");
    dom.popupBackdrop = $("messengerPopupBackdrop");
    dom.popupWindow = dom.popupLayer ? dom.popupLayer.querySelector(".messenger-popup-window") : null;
    dom.dragHandle = $("messengerDragHandle");
    dom.launcherBtn = $("messengerLauncherBtn");
    dom.headerUnreadBadge = $("messengerHeaderUnreadBadge");
    dom.railRoomsBtn = $("messengerRailRoomsBtn");
    dom.railInboxBtn = $("messengerRailInboxBtn");
    dom.railUnreadBtn = $("messengerRailUnreadBtn");
    dom.railStarredBtn = $("messengerRailStarredBtn");
    dom.railAlertsBtn = $("messengerRailAlertsBtn");
    dom.railComposeBtn = $("messengerRailComposeBtn");
    dom.railRecentBtn = $("messengerRailRecentBtn");
    dom.railGuideBtn = $("messengerRailGuideBtn");
    dom.railSettingsBtn = $("messengerRailSettingsBtn");
    dom.railUnreadBadge = $("messengerRailUnreadBadge");
    dom.railNotifyBadge = $("messengerRailNotifyBadge");
    dom.sidebarSearchBtn = $("messengerSidebarSearchBtn");
    dom.notifyRoot = $("topbarNotifyRoot");
    dom.notifyBtn = $("topbarNotifyBtn");
    dom.notifyDot = $("topbarNotifyDot");
    dom.notifyMenu = $("topbarNotifyMenu");
    dom.notifyMeta = $("topbarNotifyMeta");
    dom.notifyList = $("topbarNotifyList");
    dom.notifyOpenMessengerBtn = $("topbarNotifyOpenMessengerBtn");
    dom.contextMenu = $("messengerContextMenu");
    dom.closeBtn = $("messengerCloseBtn");
    dom.minimizeBtn = $("messengerMinimizeBtn");
    dom.root = $("messengerPageRoot");
    dom.roomTotal = $("messengerRoomTotal");
    dom.unreadTotal = $("messengerUnreadTotal");
    dom.onlineContacts = $("messengerOnlineContacts");
    dom.roomSummary = $("messengerRoomSummary");
    dom.channelCount = $("messengerChannelCount");
    dom.groupCount = $("messengerGroupCount");
    dom.directCount = $("messengerDirectCount");
    dom.quickSection = $("messengerQuickSection");
    dom.listSection = $("messengerListSection");
    dom.listSectionTitle = $("messengerListSectionTitle");
    dom.listSectionMeta = $("messengerListSectionMeta");
    dom.roomList = $("messengerRoomList");
    dom.roomSearch = $("messengerRoomSearch");
    dom.filterTabs = $("messengerFilterTabs");
    dom.activeRoomAvatar = $("messengerActiveRoomAvatar");
    dom.activeRoomTitle = $("messengerActiveRoomTitle");
    dom.activeRoomSubtitle = $("messengerActiveRoomSubtitle");
    dom.chatHeader = $("messengerChatHeader");
    dom.callStrip = $("messengerCallStrip");
    dom.callStatusBadge = $("messengerCallStatusBadge");
    dom.callStatusTitle = $("messengerCallStatusTitle");
    dom.callStatusMeta = $("messengerCallStatusMeta");
    dom.audioCallBtn = $("messengerAudioCallBtn");
    dom.videoCallBtn = $("messengerVideoCallBtn");
    dom.toggleMicBtn = $("messengerToggleMicBtn");
    dom.toggleCameraBtn = $("messengerToggleCameraBtn");
    dom.screenShareBtn = $("messengerScreenShareBtn");
    dom.leaveCallBtn = $("messengerLeaveCallBtn");
    dom.callStage = $("messengerCallStage");
    dom.callGrid = $("messengerCallGrid");
    dom.callAudioSink = $("messengerCallAudioSink");
    dom.messageScroll = $("messengerMessageScroll");
    dom.messageList = $("messengerMessageList");
    dom.conversationEmpty = $("messengerConversationEmpty");
    dom.typingBar = $("messengerTypingBar");
    dom.composerInput = $("messengerComposerInput");
    dom.sendBtn = $("messengerSendBtn");
    dom.starToggleBtn = $("messengerStarToggleBtn");
    dom.refreshBtn = $("messengerRefreshBtn");
    dom.roomRefreshBtn = $("messengerRoomRefreshBtn");
    dom.roomLinkBtn = $("messengerRoomLinkBtn");
    dom.roomMuteBtn = $("messengerRoomMuteBtn");
    dom.roomMoreBtn = $("messengerRoomMoreBtn");
    dom.roomMoreMenu = $("messengerRoomMoreMenu");
    dom.roomInfo = $("messengerRoomInfo");
    dom.participantList = $("messengerParticipantList");
    dom.participantCount = $("messengerParticipantCount");
    dom.inviteMemberBtn = $("messengerInviteMemberBtn");
    dom.inspectorBadge = $("messengerInspectorBadge");
    dom.resourceList = $("messengerResourceList");
    dom.quickContactList = $("messengerQuickContactList");
    dom.roomAvatarInput = $("messengerRoomAvatarInput");
    dom.attachInput = $("messengerAttachInput");
    dom.attachBtn = $("messengerAttachBtn");
    dom.emojiBtn = $("messengerEmojiBtn");
    dom.mentionBtn = $("messengerMentionBtn");
    dom.linkInsertBtn = $("messengerLinkInsertBtn");
    dom.formatBtn = $("messengerFormatBtn");
    dom.emojiPicker = $("messengerEmojiPicker");
    dom.mentionPicker = $("messengerMentionPicker");
    dom.newChatBtn = $("messengerNewChatBtn");
    dom.newRoomMode = $("messengerNewRoomMode");
    dom.groupNameWrap = $("messengerGroupNameWrap");
    dom.groupTopicWrap = $("messengerGroupTopicWrap");
    dom.groupNameInput = $("messengerGroupNameInput");
    dom.groupTopicInput = $("messengerGroupTopicInput");
    dom.contactSearch = $("messengerContactSearch");
    dom.contactPicker = $("messengerContactPicker");
    dom.createRoomSubmitBtn = $("messengerCreateRoomSubmitBtn");
    const modalElement = $("messengerNewRoomModal");
    dom.newRoomModalInstance = modalElement && window.bootstrap ? new bootstrap.Modal(modalElement) : null;
  }

  async function init() {
    if (state.initialized) return;
    state.initialized = true;
    cacheDom();
    if (!dom.root) return;
    loadPreferences();
    loadRecentRooms();
    applyPreferences();
    restorePopupOffset();
    bindEvents();
    syncFilterTabs(state.filter);
    setSidebarMode("rooms");
    setModalMode("dm");
    resizeComposer();
    renderEmojiPicker();
    renderMentionPicker();
    connectSocket();
    try {
      await loadBootstrap(Number(dom.root.getAttribute("data-requested-room-id") || 0));
      setPopupOpen(String(dom.root.getAttribute("data-auto-open") || "0") === "1" || !!config.autoOpen);
    } catch (error) {
      if (dom.roomList) {
        dom.roomList.innerHTML = [
          '<div class="messenger-empty-state">',
          '<i class="bi bi-exclamation-circle"></i>',
          "<strong>메신저를 불러오지 못했습니다.</strong>",
          "<span>" + escapeHtml(error.message || "잠시 후 다시 시도해주세요.") + "</span>",
          "</div>",
        ].join("");
      }
      setPopupOpen(String(dom.root.getAttribute("data-auto-open") || "0") === "1" || !!config.autoOpen || state.isOpen);
    }
  }

  window.ABBASMessenger = {
    isReady: function () {
      return !!state.initialized;
    },
    open: function () {
      if (!state.initialized) {
        init();
      }
      setPopupOpen(true);
    },
    close: function () {
      setPopupOpen(false);
    },
    toggle: function () {
      if (!state.initialized) {
        init();
      }
      togglePopup();
    },
    openRoom: function (roomId, messageId) {
      return openRoom(roomId, messageId);
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.addEventListener("pageshow", function () {
    if (!state.initialized) {
      init();
    }
  });
})();
