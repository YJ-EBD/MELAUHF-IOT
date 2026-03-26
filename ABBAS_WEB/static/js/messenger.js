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
    acceptingAscordInviteMessageIds: new Set(),
    ascordVoiceInvitePreviewByRoomId: {},
    ascordVoiceInviteLoadingByRoomId: {},
    ascordVoiceInviteSendingByRoomId: {},
    ascordVoiceInviteCloseTimersByRoomId: {},
    notificationPermissionRequested: false,
    userProfilesById: {},
    roomHistory: [],
    preferences: {
      rememberPosition: true,
      showTyping: true,
      enterToSend: true,
      hideMutedChannels: false,
    },
    ascordProfileMenuOpen: false,
    ascordProfileMenuLoading: false,
    viewMode: "talk",
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
    roomDrawerOpen: false,
    meetingNotes: {
      channels: [],
      loading: false,
      activeRoomId: 0,
      pendingViewerNote: null,
      viewerNote: null,
    },
    notiba: {
      transcriptsByRoomId: {},
      pendingByRoomId: {},
      callIdByRoomId: {},
      loadingByRoomId: {},
      settings: null,
      capture: {
        starting: false,
        roomId: 0,
        callId: "",
        deviceId: "",
        stream: null,
        peerConnection: null,
        dataChannel: null,
        sender: null,
        reconnectTimer: 0,
        itemTexts: {},
        itemSpokenAtMs: {},
        partialTimers: {},
        error: "",
      },
    },
    ascordCallDockVisibilityTimer: 0,
    ascordServerMenuOpen: false,
    composerPopover: "",
    messagesByRoom: {},
    oldestCursorByRoom: {},
    loadingHistoryRooms: {},
    typingByRoom: {},
    modalMode: "dm",
    ascordCreateKind: "voice",
    ascordCreatePrivate: false,
    selectedContacts: new Set(),
    highlightMessageId: 0,
    socket: null,
    reconnectTimer: 0,
    heartbeatTimer: 0,
    uiTicker: 0,
    typingTimer: 0,
    typingStopTimer: 0,
    popupOffsetX: 0,
    popupOffsetY: 0,
    popupPersistTimer: 0,
    initPromise: null,
    authLost: false,
    dragActive: false,
    dragStartX: 0,
    dragStartY: 0,
    dragStartOffsetX: 0,
    dragStartOffsetY: 0,
    dragRectLeft: 0,
    dragRectTop: 0,
    dragRectWidth: 0,
    dragRectHeight: 0,
    ascordVoiceDragRoomId: 0,
    ascordRoomClickTimer: 0,
    ascordPendingRoomId: 0,
    call: {
      roomCallsById: {},
      joinedRoomId: 0,
      joining: false,
      requestedMode: "",
      requestedAudioEnabled: true,
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
      deafened: false,
      pushToTalk: false,
      pushToTalkPressed: false,
      layoutMode: "grid",
      pinnedTrackId: "",
      participantVolumes: {},
      callSnapshotsByRoomId: {},
      incomingInvitesByRoomId: {},
      serverMutedRoomIds: {},
      devices: {
        audioinput: [],
        audiooutput: [],
        videoinput: [],
      },
      selectedDevices: {
        audioinput: "",
        audiooutput: "",
        videoinput: "",
      },
      audioOutputSupported: false,
      seenLiveCallIdsByRoomId: {},
      micBeforeDeafen: true,
      peersByUserId: {},
      remoteStreamsByUserId: {},
      pendingSignalsByUserId: {},
      lastRenderItems: [],
      lastAudioSinkSignature: "",
      participantOrderByRoomId: {},
      fullscreenTrackId: "",
      sharePickerMode: "application",
      uiAudioContext: null,
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
  const NOTIBA_AI_ICON_SRC = "/logo/Notiba_ai.png";
  const CALL_PERMISSION_OPTIONS = [
    { value: "member", label: "모든 멤버" },
    { value: "admin", label: "ADMIN 이상" },
    { value: "owner", label: "OWNER만" },
    { value: "none", label: "금지" },
  ];
  const CHANNEL_MODE_OPTIONS = [
    { value: "voice", label: "VOICE", help: "일반 음성채널처럼 누구나 바로 입장해서 마이크, 카메라, 화면공유를 사용할 수 있습니다." },
    { value: "stage", label: "STAGE", help: "스테이지 채널처럼 청중 중심으로 운영하고, 발언 권한은 운영자 위주로 제한할 수 있습니다." },
  ];
  const CALL_PERMISSION_FIELDS = [
    { key: "connect", label: "통화 참여", help: "채널에 입장해서 음성 통화에 연결할 수 있습니다." },
    { key: "start_call", label: "새 통화 열기", help: "아무도 연결되어 있지 않을 때 먼저 통화를 시작할 수 있습니다." },
    { key: "speak", label: "마이크 송출", help: "마이크를 켜고 음성을 송출할 수 있습니다." },
    { key: "video", label: "카메라 송출", help: "카메라 영상을 켜고 전체 그리드에 표시할 수 있습니다." },
    { key: "screen_share", label: "화면공유", help: "브라우저 화면 또는 창을 공유할 수 있습니다." },
    { key: "invite_members", label: "멤버 초대", help: "이 채널에 새로운 멤버를 초대할 수 있습니다." },
    { key: "moderate", label: "통화 운영", help: "서버 음소거, 화면 중지, 연결 종료 같은 운영 제어를 사용할 수 있습니다." },
  ];
  const DEFAULT_ROOM_CALL_PERMISSIONS = {
    connect: "member",
    start_call: "member",
    speak: "member",
    video: "member",
    screen_share: "member",
    invite_members: "admin",
    moderate: "admin",
  };
  const DEFAULT_DM_CALL_PERMISSIONS = {
    connect: "member",
    start_call: "member",
    speak: "member",
    video: "member",
    screen_share: "member",
    invite_members: "none",
    moderate: "none",
  };
  const DEFAULT_STAGE_CALL_PERMISSIONS = {
    connect: "member",
    start_call: "admin",
    speak: "admin",
    video: "none",
    screen_share: "none",
    invite_members: "admin",
    moderate: "admin",
  };
  const ASCORD_SOUND_PATHS = {
    join: "/sounds/ascord_join.mp3",
    out: "/sounds/ascord_out.mp3",
    mute: "/sounds/ascord_mute.mp3",
    unmute: "/sounds/ascord_unmute.mp3",
    streamStart: "/sounds/ascord_stream_start.mp3",
    streamStop: "/sounds/ascord_stream_stop.mp3",
  };
  const NOTIBA_STT_MERGE_WINDOW_MS = 5000;
  const NOTIBA_STT_MERGE_MAX_CHARS = 220;
  const NOTIBA_REALTIME_PARTIAL_PUSH_MS = 120;

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

  function delayMs(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  function transcriptEntriesForRoom(roomId) {
    return Array.isArray(state.notiba.transcriptsByRoomId[Number(roomId || 0)])
      ? state.notiba.transcriptsByRoomId[Number(roomId || 0)].slice()
      : [];
  }

  function sortTranscriptEntries(entries) {
    return (Array.isArray(entries) ? entries.slice() : []).sort(function (a, b) {
      return Number((a && a.spoken_at) || (a && a.created_at) || 0) - Number((b && b.spoken_at) || (b && b.created_at) || 0)
        || Number((a && a.created_at) || 0) - Number((b && b.created_at) || 0)
        || Number((a && a.id) || 0) - Number((b && b.id) || 0);
    });
  }

  function mergedTranscriptEntries(entries) {
    const sortedEntries = sortTranscriptEntries(entries);
    const merged = [];
    sortedEntries.forEach(function (entry) {
      const payload = entry && typeof entry === "object" ? Object.assign({}, entry) : null;
      if (!payload) return;
      const text = normalizeText(payload.text);
      if (!text) return;
      const previous = merged.length ? merged[merged.length - 1] : null;
      const previousUserId = normalizeText(previous && previous.user_id);
      const nextUserId = normalizeText(payload.user_id);
      const previousText = normalizeText(previous && previous.text);
      const previousSpokenAt = Number((previous && previous._notiba_last_spoken_at) || (previous && previous.spoken_at) || (previous && previous.created_at) || 0);
      const nextSpokenAt = Number(payload.spoken_at || payload.created_at || 0);
      const shouldMerge = !!previous
        && !!previousUserId
        && previousUserId === nextUserId
        && (nextSpokenAt <= 0 || previousSpokenAt <= 0 || ((nextSpokenAt - previousSpokenAt) * 1000) <= NOTIBA_STT_MERGE_WINDOW_MS)
        && ((previousText + " " + text).trim().length <= NOTIBA_STT_MERGE_MAX_CHARS);
      if (!shouldMerge) {
        payload._notiba_last_spoken_at = nextSpokenAt;
        merged.push(payload);
        return;
      }
      previous.text = (previousText + " " + text).replace(/\s+/g, " ").trim();
      previous.created_at = Math.max(Number(previous.created_at || 0), Number(payload.created_at || 0));
      previous.spoken_at = Number(previous.spoken_at || 0) || nextSpokenAt;
      previous._notiba_last_spoken_at = nextSpokenAt || previousSpokenAt;
      previous.duration_ms = Number(previous.duration_ms || 0) + Number(payload.duration_ms || 0);
    });
    return merged;
  }

  function setRoomTranscriptEntries(roomId, callId, entries) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    state.notiba.callIdByRoomId[targetRoomId] = normalizeText(callId);
    state.notiba.transcriptsByRoomId[targetRoomId] = sortTranscriptEntries(entries);
    if (state.roomDrawerOpen && Number((state.activeRoom && state.activeRoom.id) || state.activeRoomId || 0) === targetRoomId) {
      renderRoomDrawer();
    }
  }

  function appendRoomTranscriptEntry(roomId, callId, entry) {
    const targetRoomId = Number(roomId || 0);
    const payload = entry && typeof entry === "object" ? Object.assign({}, entry) : null;
    if (targetRoomId <= 0 || !payload) return;
    const normalizedCallId = normalizeText(callId || payload.call_id);
    const sourceItemId = normalizeText(payload.source_item_id || payload.item_id);
    const entryUserId = normalizeText(payload.user_id);
    const currentCallId = normalizeText(state.notiba.callIdByRoomId[targetRoomId]);
    const existing = Array.isArray(state.notiba.transcriptsByRoomId[targetRoomId])
      ? state.notiba.transcriptsByRoomId[targetRoomId].slice()
      : [];
    const nextEntries = currentCallId && normalizedCallId && currentCallId !== normalizedCallId
      ? []
      : existing.filter(function (item) {
        return Number((item && item.id) || 0) !== Number((payload && payload.id) || 0);
      });
    nextEntries.push(payload);
    setRoomTranscriptEntries(targetRoomId, normalizedCallId, nextEntries);
    if (sourceItemId && entryUserId) {
      clearPendingTranscriptEntry(targetRoomId, entryUserId, sourceItemId);
    }
  }

  function clearRoomTranscriptEntries(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    delete state.notiba.callIdByRoomId[targetRoomId];
    delete state.notiba.transcriptsByRoomId[targetRoomId];
    delete state.notiba.pendingByRoomId[targetRoomId];
    if (state.roomDrawerOpen && Number((state.activeRoom && state.activeRoom.id) || state.activeRoomId || 0) === targetRoomId) {
      renderRoomDrawer();
    }
  }

  function pendingTranscriptEntriesForRoom(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return [];
    const pendingMap = state.notiba.pendingByRoomId[targetRoomId] || {};
    return Object.keys(pendingMap).map(function (key) {
      return Object.assign({}, pendingMap[key]);
    }).sort(function (a, b) {
      return Number((a && a.spoken_at) || (a && a.created_at) || 0) - Number((b && b.spoken_at) || (b && b.created_at) || 0)
        || Number((a && a.created_at) || 0) - Number((b && b.created_at) || 0);
    });
  }

  function pendingTranscriptKey(userId, itemId) {
    return normalizeText(userId) + "::" + normalizeText(itemId);
  }

  function upsertPendingTranscriptEntry(roomId, callId, entry) {
    const targetRoomId = Number(roomId || 0);
    const payload = entry && typeof entry === "object" ? Object.assign({}, entry) : null;
    if (targetRoomId <= 0 || !payload) return;
    const normalizedCallId = normalizeText(callId || payload.call_id);
    const currentCallId = normalizeText(state.notiba.callIdByRoomId[targetRoomId]);
    if (currentCallId && normalizedCallId && currentCallId !== normalizedCallId) {
      return;
    }
    if (normalizedCallId) {
      state.notiba.callIdByRoomId[targetRoomId] = normalizedCallId;
    }
    const itemId = normalizeText(payload.item_id);
    const userId = normalizeText(payload.user_id);
    if (!itemId || !userId) return;
    const nextPending = Object.assign({}, state.notiba.pendingByRoomId[targetRoomId] || {});
    nextPending[pendingTranscriptKey(userId, itemId)] = {
      item_id: itemId,
      room_id: targetRoomId,
      call_id: normalizedCallId,
      user_id: userId,
      display_name: normalizeText(payload.display_name || payload.user_id || "참여자"),
      text: normalizeText(payload.text),
      spoken_at: Number(payload.spoken_at || payload.created_at || (Date.now() / 1000)),
      created_at: Number(payload.created_at || (Date.now() / 1000)),
      is_partial: true,
    };
    state.notiba.pendingByRoomId[targetRoomId] = nextPending;
    if (state.roomDrawerOpen && Number((state.activeRoom && state.activeRoom.id) || state.activeRoomId || 0) === targetRoomId) {
      renderRoomDrawer();
    }
  }

  function clearPendingTranscriptEntry(roomId, userId, itemId) {
    const targetRoomId = Number(roomId || 0);
    const key = pendingTranscriptKey(userId, itemId);
    if (targetRoomId <= 0 || !normalizeText(key)) return;
    const current = Object.assign({}, state.notiba.pendingByRoomId[targetRoomId] || {});
    if (!Object.prototype.hasOwnProperty.call(current, key)) return;
    delete current[key];
    if (Object.keys(current).length) {
      state.notiba.pendingByRoomId[targetRoomId] = current;
    } else {
      delete state.notiba.pendingByRoomId[targetRoomId];
    }
    if (state.roomDrawerOpen && Number((state.activeRoom && state.activeRoom.id) || state.activeRoomId || 0) === targetRoomId) {
      renderRoomDrawer();
    }
  }

  function clearRoomPendingTranscriptEntries(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    delete state.notiba.pendingByRoomId[targetRoomId];
    if (state.roomDrawerOpen && Number((state.activeRoom && state.activeRoom.id) || state.activeRoomId || 0) === targetRoomId) {
      renderRoomDrawer();
    }
  }

  async function loadRoomCallTranscripts(roomId, options) {
    const targetRoomId = Number(roomId || 0);
    const settings = options || {};
    if (targetRoomId <= 0) return [];
    if (!settings.force && state.notiba.loadingByRoomId[targetRoomId]) {
      return transcriptEntriesForRoom(targetRoomId);
    }
    state.notiba.loadingByRoomId[targetRoomId] = true;
    try {
      const payload = await api("/api/messenger/rooms/" + targetRoomId + "/call/transcripts");
      const entries = Array.isArray(payload.entries) ? payload.entries.slice() : [];
      if (payload.settings) {
        state.notiba.settings = payload.settings;
      }
      setRoomTranscriptEntries(targetRoomId, payload.call_id || "", entries);
      return entries;
    } finally {
      delete state.notiba.loadingByRoomId[targetRoomId];
    }
  }

  function normalizeCallPermissionLevel(value, fallback) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "member" || normalized === "admin" || normalized === "owner" || normalized === "none") {
      return normalized;
    }
    if (normalized === "all" || normalized === "everyone") return "member";
    if (normalized === "deny" || normalized === "disabled" || normalized === "nobody" || normalized === "off") return "none";
    return normalizeText(fallback).toLowerCase() || "member";
  }

  function normalizeChannelMode(value, fallback) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "stage") return "stage";
    if (normalized === "voice") return "voice";
    return normalizeText(fallback).toLowerCase() === "stage" ? "stage" : "voice";
  }

  function channelModeLabel(value) {
    return normalizeChannelMode(value, "voice") === "stage" ? "STAGE" : "VOICE";
  }

  function roomChannelMode(room) {
    const targetRoom = room || {};
    if (targetRoom.is_direct) return "voice";
    return normalizeChannelMode(targetRoom.channel_mode, "voice");
  }

  function roomAppDomain(room) {
    const targetRoom = room || {};
    const explicit = normalizeText(targetRoom.app_domain).toLowerCase();
    if (explicit === "ascord" || explicit === "talk") return explicit;
    const roomKey = normalizeText(targetRoom.room_key).toLowerCase();
    if (roomKey.indexOf("ascord:") === 0) return "ascord";
    return "talk";
  }

  function isAscordRoom(room) {
    return roomAppDomain(room) === "ascord";
  }

  function isTalkRoom(room) {
    return roomAppDomain(room) === "talk";
  }

  function roomSupportsCalls(room) {
    const targetRoom = room || {};
    if (Object.prototype.hasOwnProperty.call(targetRoom, "supports_calls")) {
      return !!targetRoom.supports_calls;
    }
    return isAscordRoom(targetRoom);
  }

  function isStageRoom(room) {
    return roomSupportsCalls(room) && roomChannelMode(room) === "stage";
  }

  function normalizeStageRole(value) {
    return normalizeText(value).toLowerCase() === "speaker" ? "speaker" : "audience";
  }

  function callParticipantStageRole(participant) {
    return normalizeStageRole(participant && participant.stage_role);
  }

  function callParticipantSpeakerRequested(participant) {
    return !!(participant && participant.speaker_requested);
  }

  function currentUserCallParticipant(room) {
    const targetRoom = room || state.activeRoom;
    if (!targetRoom) return null;
    return callParticipant(callForRoom(targetRoom.id), currentUserId());
  }

  function roomChannelCategory(room) {
    const targetRoom = room || {};
    return normalizeText(targetRoom.channel_category || "");
  }

  function defaultCallPermissionsForRoom(room) {
    const targetRoom = room || {};
    if (targetRoom && targetRoom.is_direct) return Object.assign({}, DEFAULT_DM_CALL_PERMISSIONS);
    if (roomChannelMode(targetRoom) === "stage") return Object.assign({}, DEFAULT_STAGE_CALL_PERMISSIONS);
    return Object.assign({}, DEFAULT_ROOM_CALL_PERMISSIONS);
  }

  function callPermissionLabel(value) {
    const normalized = normalizeCallPermissionLevel(value, "member");
    if (normalized === "admin") return "ADMIN 이상";
    if (normalized === "owner") return "OWNER만";
    if (normalized === "none") return "금지";
    return "모든 멤버";
  }

  function roomCallPermissions(room) {
    const targetRoom = room || {};
    const result = defaultCallPermissionsForRoom(targetRoom);
    const payload = targetRoom.call_permissions && typeof targetRoom.call_permissions === "object"
      ? targetRoom.call_permissions
      : {};
    CALL_PERMISSION_FIELDS.forEach(function (field) {
      result[field.key] = normalizeCallPermissionLevel(payload[field.key], result[field.key]);
    });
    return result;
  }

  function avatarInitialFor(displayName, fallback) {
    const text = normalizeText(displayName || fallback || "U");
    return text ? text.charAt(0).toUpperCase() : "U";
  }

  function hashedTextNumber(value) {
    const text = normalizeText(value);
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash * 31) + text.charCodeAt(index)) % 2147483647;
    }
    return Math.abs(hash);
  }

  function callCardToneStyle(item) {
    const payload = item || {};
    const seedText = normalizeText(payload.userId || payload.identity || payload.displayName || payload.id || "call-card");
    const seed = hashedTextNumber(seedText);
    const hue = seed % 360;
    const secondaryHue = (hue + 24 + (seed % 41)) % 360;
    return "--call-card-hue:" + String(hue) + ";--call-card-hue-alt:" + String(secondaryHue) + ";";
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

  function parseAscordInviteMessage(message) {
    if (!message) return null;
    if (normalizeText(message.message_type).toLowerCase() !== "ascord_invite") return null;
    const embedded = message.invite;
    if (embedded && typeof embedded === "object" && normalizeText(embedded.workspace_key).toLowerCase() === "ascord") {
      return embedded;
    }
    let payload = {};
    try {
      payload = JSON.parse(String(message.content || "{}")) || {};
    } catch (_) {
      payload = {};
    }
    if (!payload || typeof payload !== "object") return null;
    if (normalizeText(payload.workspace_key || "ascord").toLowerCase() !== "ascord") return null;
    return {
      workspace_key: "ascord",
      workspace_name: normalizeText(payload.workspace_name) || "ASCORD",
      invite_url: normalizeText(payload.invite_url),
      target_room_id: Number(payload.target_room_id || 0),
      target_room_title: normalizeText(payload.target_room_title) || "전체 채널",
      target_room_mode: normalizeText(payload.target_room_mode) === "stage" ? "stage" : "voice",
      invited_user_id: normalizeText(payload.invited_user_id),
      invited_by_user_id: normalizeText(payload.invited_by_user_id),
      card_title: normalizeText(payload.card_title) || "ASCORD 서버에 초대받았어요",
      card_detail: normalizeText(payload.card_detail) || "개인톡에서 바로 참가할 수 있습니다.",
      button_label: normalizeText(payload.button_label) || "음성 채널 참가하기",
    };
  }

  function isSystemMessage(message) {
    const payload = message || {};
    return normalizeText(payload.message_type).toLowerCase() === "system" || normalizeText(payload.sender_user_id).toLowerCase() === "system";
  }

  function formatRichText(text) {
    const escaped = escapeHtml(String(text || ""));
    const withLinks = escaped.replace(/(https?:\/\/[^\s<>"']+)/g, function (match) {
      return '<a href="' + match + '" target="_blank" rel="noopener noreferrer">' + match + "</a>";
    });
    const withBold = withLinks.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const withMentions = withBold.replace(/(^|[\s(])(@[A-Za-z0-9._\-\u3131-\u318E\uAC00-\uD7A3]+)/g, '$1<span class="messenger-inline-mention">$2</span>');
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

  function presenceToneValue(tone, label, isSelf) {
    const normalizedTone = normalizeText(tone).toLowerCase();
    const normalizedLabel = normalizeText(label);
    if (normalizedTone === "dnd") {
      return "dnd";
    }
    if (normalizedTone === "away") {
      return "away";
    }
    if (normalizedTone === "online") {
      return "online";
    }
    if (normalizedLabel.indexOf("방해 금지") !== -1) return "dnd";
    if (normalizedLabel.indexOf("자리비움") !== -1) return "away";
    if (normalizedLabel.indexOf("온라인") !== -1) return "online";
    if (normalizedTone === "offline" && normalizedLabel.indexOf("오프라인 표시") !== -1) {
      return "offline";
    }
    if (normalizedTone === "offline" && isSelf) {
      return "online";
    }
    if (normalizedTone === "offline") {
      return normalizedTone;
    }
    if (isSelf) return "online";
    return "offline";
  }

  function presenceLabelValue(label, tone, isSelf) {
    const normalizedLabel = normalizeText(label);
    if (normalizedLabel.indexOf("오프라인 표시") !== -1) return "오프라인 표시";
    const normalizedTone = presenceToneValue(tone, label, isSelf);
    if (normalizedTone === "dnd") return "방해 금지";
    if (normalizedTone === "away") return "자리비움";
    if (normalizedTone === "online") return "온라인";
    return "오프라인";
  }

  function currentPresenceStatusValue(tone, label, isSelf) {
    const normalizedLabel = normalizeText(label);
    if (normalizedLabel.indexOf("오프라인 표시") !== -1) return "invisible";
    const normalizedTone = presenceToneValue(tone, label, isSelf);
    if (normalizedTone === "dnd") return "dnd";
    if (normalizedTone === "away") return "away";
    return "online";
  }

  function currentUserPresenceStatusValue() {
    const currentUser = state.currentUser || {};
    const detailedProfile = state.userProfilesById[normalizeText(currentUser.user_id)] || currentUser;
    return currentPresenceStatusValue(
      detailedProfile.presence_tone || currentUser.presence_tone || "",
      detailedProfile.presence_label || currentUser.presence_label || "",
      true
    );
  }

  function currentUserBlocksPcAlerts() {
    return currentUserPresenceStatusValue() === "dnd";
  }

  function ascordPresenceStatusOptions() {
    return [
      { value: "online", label: "온라인", tone: "online", icon: "bi-circle-fill", subtitle: "" },
      { value: "away", label: "자리 비움", tone: "away", icon: "bi-moon-fill", subtitle: "" },
      { value: "dnd", label: "방해 금지", tone: "dnd", icon: "bi-dash-circle-fill", subtitle: "PC 알림을 받지 않기" },
      { value: "invisible", label: "오프라인 표시", tone: "offline", icon: "bi-circle", subtitle: "오프라인으로 표시돼요" },
    ];
  }

  function callPrejoinWantsMicrophone(room) {
    const targetRoom = room || state.activeRoom;
    if (!targetRoom || !canSpeakInCall(targetRoom)) return false;
    if (state.call.deafened) {
      return !!state.call.micBeforeDeafen;
    }
    return !!state.call.requestedAudioEnabled;
  }

  async function fetchUserProfile(userId, message) {
    const targetUserId = normalizeText(userId || (message && message.sender_user_id));
    if (!targetUserId) return null;
    if (state.userProfilesById[targetUserId] && Object.prototype.hasOwnProperty.call(state.userProfilesById[targetUserId], "bio")) {
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

  async function ensureDetailedUserProfile(userId, message) {
    const targetUserId = normalizeText(userId || (message && message.sender_user_id));
    if (!targetUserId) return null;
    const cached = state.userProfilesById[targetUserId];
    if (cached && Object.prototype.hasOwnProperty.call(cached, "bio")) {
      return Object.assign({}, cached);
    }
    return fetchUserProfile(targetUserId, message);
  }

  function setAscordProfileMenuOpen(open) {
    const nextOpen = !!open && state.viewMode === "ascord" && !!currentUserId();
    if (state.ascordProfileMenuOpen === nextOpen) return;
    state.ascordProfileMenuOpen = nextOpen;
    if (!nextOpen) {
      state.ascordProfileMenuLoading = false;
    }
    renderAscordVoiceDock();
  }

  async function openAscordProfileMenu() {
    const userId = currentUserId();
    if (!userId) return;
    state.ascordProfileMenuOpen = true;
    if (!state.userProfilesById[userId] || !Object.prototype.hasOwnProperty.call(state.userProfilesById[userId], "bio")) {
      state.ascordProfileMenuLoading = true;
    }
    renderAscordVoiceDock();
    if (!state.ascordProfileMenuLoading) return;
    try {
      await ensureDetailedUserProfile(userId);
    } catch (_) {
    } finally {
      state.ascordProfileMenuLoading = false;
      renderAscordVoiceDock();
    }
  }

  function ascordProfileStatusMenuMarkup(presenceTone, presenceLabel) {
    const activeStatus = currentPresenceStatusValue(presenceTone, presenceLabel, true);
    const options = ascordPresenceStatusOptions();
    const currentOption = options.find(function (option) {
      return option.value === activeStatus;
    }) || options[0];
    const selectableOptions = options.filter(function (option) {
      return option.value !== currentOption.value;
    });
    return [
      '<div class="messenger-ascord-profile-menu__status-menu" data-ascord-profile-status-menu>',
      [
        '<div class="messenger-ascord-profile-menu__status-current">',
        '<span class="messenger-ascord-profile-menu__status-option-icon is-' + escapeAttribute(currentOption.tone) + '"><i class="bi ' + escapeAttribute(currentOption.icon) + '"></i></span>',
        '<span class="messenger-ascord-profile-menu__status-option-copy">',
        '<strong>' + escapeHtml(currentOption.label) + '</strong>',
        currentOption.subtitle ? ('<span>' + escapeHtml(currentOption.subtitle) + '</span>') : "",
        '</span>',
        "</div>",
      ].join(""),
      (selectableOptions.length ? '<div class="messenger-ascord-profile-menu__status-divider"></div>' : ""),
      selectableOptions.map(function (option) {
        return [
          '<button type="button" class="messenger-ascord-profile-menu__status-option" data-ascord-profile-status-value="' + escapeAttribute(option.value) + '">',
          '<span class="messenger-ascord-profile-menu__status-option-icon is-' + escapeAttribute(option.tone) + '"><i class="bi ' + escapeAttribute(option.icon) + '"></i></span>',
          '<span class="messenger-ascord-profile-menu__status-option-copy">',
          '<strong>' + escapeHtml(option.label) + '</strong>',
          option.subtitle ? ('<span>' + escapeHtml(option.subtitle) + '</span>') : "",
          '</span>',
          '</button>',
        ].join("");
      }).join(""),
      "</div>",
    ].join("");
  }

  function ascordProfileMenuMarkup(profile, options) {
    const targetProfile = profile || {};
    const settings = options || {};
    const introText = normalizeText(targetProfile.bio) || "무엇을 듣고 있었나요?";
    const presenceTone = presenceToneValue(targetProfile.presence_tone, targetProfile.presence_label, !!targetProfile.is_self);
    const presenceLabel = presenceLabelValue(targetProfile.presence_label, targetProfile.presence_tone, !!targetProfile.is_self);
    return [
      '<div class="messenger-ascord-profile-menu' + (settings.loading ? ' is-loading' : '') + '" data-ascord-profile-menu style="' + escapeAttribute(callCardToneStyle({
        userId: targetProfile.user_id,
        displayName: settings.displayName || targetProfile.name || targetProfile.display_name || targetProfile.user_id,
      })) + '">',
      '<div class="messenger-ascord-profile-menu__banner"></div>',
      '<div class="messenger-ascord-profile-menu__hero">',
      '<span class="messenger-ascord-profile-menu__avatar">' + profileAvatarHtml(targetProfile) + '<span class="messenger-contact-avatar__status is-' + escapeAttribute(presenceTone) + '"></span></span>',
      '<div class="messenger-ascord-profile-menu__intro">',
      '<span class="messenger-ascord-profile-menu__intro-icon"><i class="bi bi-plus-circle-fill"></i></span>',
      '<strong>' + escapeHtml(settings.loading ? "소개를 불러오는 중..." : introText) + '</strong>',
      "</div>",
      "</div>",
      '<div class="messenger-ascord-profile-menu__body">',
      '<div class="messenger-ascord-profile-menu__identity">',
      '<strong>' + escapeHtml(settings.displayName || targetProfile.name || targetProfile.display_name || targetProfile.user_id || "나") + '</strong>',
      '<span>' + escapeHtml(settings.nickname || targetProfile.nickname || targetProfile.user_id || "사용자") + '</span>',
      "</div>",
      '<div class="messenger-ascord-profile-menu__panel">',
      '<button type="button" class="messenger-ascord-profile-menu__action" data-ascord-profile-menu-action="profile-edit"><i class="bi bi-pencil-fill"></i><span>프로필 편집</span></button>',
      '<div class="messenger-ascord-profile-menu__divider"></div>',
      '<div class="messenger-ascord-profile-menu__action-wrap messenger-ascord-profile-menu__action-wrap--status">',
      '<button type="button" class="messenger-ascord-profile-menu__action" data-ascord-profile-menu-action="status"><span class="messenger-ascord-profile-menu__status-dot is-' + escapeAttribute(presenceTone) + '"></span><span>' + escapeHtml(presenceLabel) + '</span><i class="bi bi-chevron-right"></i></button>',
      ascordProfileStatusMenuMarkup(presenceTone, presenceLabel),
      "</div>",
      "</div>",
      "</div>",
      "</div>",
    ].join("");
  }

  function applyCurrentUserProfile(profile) {
    const patch = profile || {};
    const targetUserId = normalizeText(patch.user_id || currentUserId());
    if (!targetUserId) return;
    state.currentUser = Object.assign({}, state.currentUser || {}, patch, { user_id: targetUserId });
    state.userProfilesById[targetUserId] = Object.assign({}, state.userProfilesById[targetUserId] || {}, patch, { user_id: targetUserId });
    state.contacts = (Array.isArray(state.contacts) ? state.contacts : []).map(function (contact) {
      if (normalizeText((contact || {}).user_id) !== targetUserId) return contact;
      return Object.assign({}, contact, patch, { user_id: targetUserId });
    });
    state.rooms = (Array.isArray(state.rooms) ? state.rooms : []).map(function (room) {
      if (!room || !Array.isArray(room.members)) return room;
      let changed = false;
      const nextMembers = room.members.map(function (member) {
        if (normalizeText((member || {}).user_id) !== targetUserId) return member;
        changed = true;
        return Object.assign({}, member, patch, { user_id: targetUserId });
      });
      if (!changed) return room;
      return Object.assign({}, room, { members: nextMembers });
    });
    state.activeRoom = currentRoom();
  }

  async function setCurrentUserPresenceStatus(statusValue) {
    const nextStatus = normalizeText(statusValue).toLowerCase();
    if (!nextStatus) return;
    const payload = await api("/api/messenger/presence-status", {
      method: "POST",
      body: JSON.stringify({ status: nextStatus }),
    });
    applyCurrentUserProfile((payload && payload.profile) || {});
    renderRoomList();
    renderInspector();
    renderMessages();
    renderContactPicker();
    renderCallUi();
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

  function normalizeMemberRole(role) {
    const value = normalizeText(role).toLowerCase();
    if (value === "owner" || value === "admin" || value === "member") return value;
    return "member";
  }

  function memberRoleRank(role) {
    const value = normalizeMemberRole(role);
    if (value === "owner") return 30;
    if (value === "admin") return 20;
    return 10;
  }

  function currentRoomMemberRole(room) {
    return normalizeMemberRole(room && room.member_role);
  }

  function canInviteMembers(room) {
    return !!(room && room.can_invite_members);
  }

  function canJoinCall(room) {
    return !!(room && roomSupportsCalls(room) && room.can_join_call !== false);
  }

  function canStartCall(room) {
    if (!room) return false;
    if (!roomSupportsCalls(room)) return false;
    return room.can_start_call !== false;
  }

  function canSpeakInCall(room) {
    if (!room) return false;
    if (!roomSupportsCalls(room)) return false;
    const participant = currentUserCallParticipant(room);
    if (isStageRoom(room) && participant) {
      return callParticipantStageRole(participant) === "speaker";
    }
    return room.can_speak_in_call !== false;
  }

  function canUseVideoInCall(room) {
    if (!room) return false;
    if (!roomSupportsCalls(room)) return false;
    const participant = currentUserCallParticipant(room);
    if (isStageRoom(room) && participant && callParticipantStageRole(participant) !== "speaker") {
      return false;
    }
    return room.can_use_video_in_call !== false;
  }

  function canShareScreenInCall(room) {
    if (!room) return false;
    if (!roomSupportsCalls(room)) return false;
    const participant = currentUserCallParticipant(room);
    if (isStageRoom(room) && participant && callParticipantStageRole(participant) !== "speaker") {
      return false;
    }
    return room.can_share_screen_in_call !== false;
  }

  function canModerateCall(room) {
    return !!(room && roomSupportsCalls(room) && room.can_moderate_call);
  }

  function canManageMembers(room) {
    return !!(room && room.can_manage_members);
  }

  function canManageMemberRoles(room) {
    return !!(room && room.can_manage_member_roles);
  }

  function canLeaveRoom(room) {
    return !!(room && !room.is_direct && !room.is_system_room);
  }

  function effectiveActorMemberRank(room) {
    if (!room) return 0;
    if (room.can_manage_room) return memberRoleRank("owner");
    return memberRoleRank(currentRoomMemberRole(room));
  }

  function canChangeTargetMemberRole(room, userId, nextRole) {
    const targetRoom = room || state.activeRoom;
    const targetUserId = normalizeText(userId);
    const normalizedNextRole = normalizeMemberRole(nextRole);
    if (!targetRoom || !targetUserId || !canManageMemberRoles(targetRoom)) return false;
    if (targetUserId === currentUserId()) return false;
    if (normalizedNextRole !== "admin" && normalizedNextRole !== "member") return false;
    const member = findMemberByUserId(targetRoom, targetUserId);
    if (!member) return false;
    const currentRole = normalizeMemberRole(member.member_role);
    const actorRank = effectiveActorMemberRank(targetRoom);
    const targetRank = memberRoleRank(currentRole);
    if (currentRole === "owner") return false;
    if (targetRank >= actorRank) return false;
    if (currentRole === normalizedNextRole) return false;
    return true;
  }

  function canRemoveTargetMember(room, userId) {
    const targetRoom = room || state.activeRoom;
    const targetUserId = normalizeText(userId);
    if (!targetRoom || !targetUserId || !canManageMembers(targetRoom)) return false;
    if (targetUserId === currentUserId()) return false;
    const member = findMemberByUserId(targetRoom, targetUserId);
    if (!member) return false;
    const targetRole = normalizeMemberRole(member.member_role);
    const actorRank = effectiveActorMemberRank(targetRoom);
    const targetRank = memberRoleRank(targetRole);
    if (targetRole === "owner") return false;
    if (targetRank >= actorRank) return false;
    return true;
  }

  function canTransferOwnerToTarget(room, userId) {
    const targetRoom = room || state.activeRoom;
    const targetUserId = normalizeText(userId);
    if (!targetRoom || !targetUserId) return false;
    if (targetUserId === currentUserId()) return false;
    if (targetRoom.is_direct || targetRoom.is_system_room) return false;
    if (!(canManageRoom(targetRoom) || currentRoomMemberRole(targetRoom) === "owner")) return false;
    const member = findMemberByUserId(targetRoom, targetUserId);
    if (!member) return false;
    return normalizeMemberRole(member.member_role) !== "owner";
  }

  function isServerMutedInRoom(roomId) {
    const targetRoomId = Number(roomId || state.call.joinedRoomId || 0);
    if (targetRoomId <= 0) return false;
    return !!state.call.serverMutedRoomIds[targetRoomId];
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

  function preferredAscordRoom(rooms) {
    const items = Array.isArray(rooms) ? rooms : currentViewRooms("ascord");
    const normalizedRooms = items.filter(function (room) {
      return !!room && isAscordRoom(room);
    });
    if (!normalizedRooms.length) return null;
    return normalizedRooms.find(function (room) {
      return normalizeText(room.room_key).toLowerCase() === "ascord:global";
    }) || normalizedRooms.find(function (room) {
      return normalizeText(room.title) === "전체 채널";
    }) || stableAscordVoiceRooms(normalizedRooms.filter(function (room) {
      return roomSupportsCalls(room);
    }))[0] || normalizedRooms[0] || null;
  }

  function roomMatchesView(room, mode) {
    const normalizedMode = sanitizeViewMode(mode || state.viewMode);
    return normalizedMode === "ascord" ? isAscordRoom(room) : isTalkRoom(room);
  }

  function currentViewRooms(mode) {
    return (state.rooms || []).filter(function (room) {
      return roomMatchesView(room, mode);
    });
  }

  function notificationMatchesView(item, mode) {
    const normalizedMode = sanitizeViewMode(mode || state.viewMode);
    const room = findRoomById(Number((item && item.room_id) || 0));
    if (room) {
      return roomMatchesView(room, normalizedMode);
    }
    const action = notificationActionType(item);
    if (action === "join-call" || action === "open-ascord") {
      return normalizedMode === "ascord";
    }
    return normalizedMode === "talk";
  }

  function currentViewNotificationItems(mode) {
    return (state.notifications || []).filter(function (item) {
      return notificationMatchesView(item, mode);
    });
  }

  function currentViewNotificationCounts(mode) {
    return notificationCountsFromItems(currentViewNotificationItems(mode));
  }

  function resolveActiveRoomIdForView(preferredId, mode) {
    const normalizedMode = sanitizeViewMode(mode || state.viewMode);
    const preferredRoom = findRoomById(Number(preferredId || 0));
    if (preferredRoom && roomMatchesView(preferredRoom, normalizedMode)) {
      return Number(preferredRoom.id || 0);
    }
    const joinedRoom = findRoomById(Number(state.call.joinedRoomId || 0));
    if (normalizedMode === "ascord" && joinedRoom && roomMatchesView(joinedRoom, normalizedMode)) {
      return Number(joinedRoom.id || 0);
    }
    const rooms = currentViewRooms(normalizedMode);
    if (normalizedMode === "ascord") {
      const preferredAscord = preferredAscordRoom(rooms);
      if (preferredAscord) {
        return Number(preferredAscord.id || 0);
      }
    }
    return rooms.length ? Number((rooms[0] && rooms[0].id) || 0) : 0;
  }

  function ensureActiveRoomForCurrentView(preferredId) {
    state.activeRoomId = resolveActiveRoomIdForView(preferredId, state.viewMode);
    state.activeRoom = currentRoom();
    return Number(state.activeRoomId || 0);
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
    if (currentUserBlocksPcAlerts()) return false;
    return document.hidden || !document.hasFocus();
  }

  function showBrowserNotification(item) {
    const payload = item || {};
    const notificationId = notificationItemId(payload);
    if (!notificationId || state.shownBrowserNotificationIds.has(notificationId)) return;
    if (!shouldShowBrowserNotification()) return;
    const roomId = Number(payload.room_id || 0);
    if (roomId <= 0) return;

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
      openNotificationItem(payload).catch(function () {});
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

  async function showPassiveToast(icon, title) {
    if (currentUserBlocksPcAlerts()) return;
    await showToast(icon, title);
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

  function roomPermissionSelectMarkup(field, currentValue) {
    const fieldKey = normalizeText(field && field.key);
    const fieldId = "swalMessengerPerm_" + fieldKey;
    return [
      '<label class="messenger-room-permission-field" for="' + escapeAttribute(fieldId) + '">',
      '<span class="messenger-room-permission-field__label">' + escapeHtml((field && field.label) || fieldKey) + "</span>",
      '<span class="messenger-room-permission-field__help">' + escapeHtml((field && field.help) || "") + "</span>",
      '<select id="' + escapeAttribute(fieldId) + '" class="form-control app-swal-field messenger-room-permission-field__select" data-room-permission-key="' + escapeAttribute(fieldKey) + '">',
      CALL_PERMISSION_OPTIONS.map(function (option) {
        const optionValue = normalizeCallPermissionLevel(option.value, "member");
        return '<option value="' + escapeAttribute(optionValue) + '"' + (normalizeCallPermissionLevel(currentValue, "member") === optionValue ? " selected" : "") + ">" + escapeHtml(option.label) + "</option>";
      }).join(""),
      "</select>",
      "</label>",
    ].join("");
  }

  function roomChannelModeSelectMarkup(currentValue) {
    const currentMode = normalizeChannelMode(currentValue, "voice");
    return [
      '<label class="messenger-room-permission-field" for="swalMessengerRoomMode">',
      '<span class="messenger-room-permission-field__label">ASCORD 채널 모드</span>',
      '<span class="messenger-room-permission-field__help">VOICE는 일반 음성채널, STAGE는 청중 중심 발표 채널처럼 동작합니다.</span>',
      '<select id="swalMessengerRoomMode" class="form-control app-swal-field messenger-room-permission-field__select">',
      CHANNEL_MODE_OPTIONS.map(function (option) {
        const optionValue = normalizeChannelMode(option.value, "voice");
        return '<option value="' + escapeAttribute(optionValue) + '"' + (currentMode === optionValue ? " selected" : "") + ">" + escapeHtml(option.label) + "</option>";
      }).join(""),
      "</select>",
      '<small class="messenger-room-permission-field__help" id="swalMessengerRoomModeHelp"></small>',
      "</label>",
    ].join("");
  }

  async function promptRoomDetails(room) {
    const currentRoom = room || {};
    const isAscord = isAscordRoom(currentRoom);
    const currentName = normalizeText(currentRoom.title || currentRoom.name);
    const currentTopic = normalizeText(currentRoom.topic || "");
    const currentCategory = roomChannelCategory(currentRoom);
    const currentChannelMode = roomChannelMode(currentRoom);
    const currentPermissions = roomCallPermissions(currentRoom);
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
        channel_category: isAscord ? currentCategory : "",
        channel_mode: isAscord ? currentChannelMode : "voice",
        call_permissions: isAscord ? currentPermissions : {},
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
        (isAscord ? [
          '<div class="app-swal-field-group">',
          '<label class="form-label" for="swalMessengerRoomCategory">카테고리</label>',
          '<input id="swalMessengerRoomCategory" class="form-control app-swal-field" maxlength="60" placeholder="예: PROJECT HUB, DESIGN, LIVE EVENTS">',
          '<p class="messenger-room-permission-grid__foot">ASCORD 왼쪽 목록에서 같은 카테고리끼리 묶여 보입니다.</p>',
          '</div>',
          '<div class="app-swal-field-group">',
          roomChannelModeSelectMarkup(currentChannelMode),
          '</div>',
          '<div class="app-swal-field-group">',
          '<label class="form-label">ASCORD 통화 권한</label>',
          '<div class="messenger-room-permission-grid">',
          CALL_PERMISSION_FIELDS.map(function (field) {
            return roomPermissionSelectMarkup(field, currentPermissions[field.key]);
          }).join(""),
          "</div>",
          '<p class="messenger-room-permission-grid__foot">채널마다 통화 참여, 마이크, 카메라, 화면공유, 초대, 운영 권한을 따로 조정할 수 있습니다.</p>',
          '</div>',
        ].join("") : ""),
        '</div>',
      ].join(""),
      showCancelButton: true,
      confirmButtonText: "저장",
      cancelButtonText: "취소",
      focusConfirm: false,
      didOpen: function () {
        const nameInput = document.getElementById("swalMessengerRoomName");
        const topicInput = document.getElementById("swalMessengerRoomTopic");
        const categoryInput = document.getElementById("swalMessengerRoomCategory");
        const modeSelect = document.getElementById("swalMessengerRoomMode");
        const modeHelp = document.getElementById("swalMessengerRoomModeHelp");
        if (nameInput) nameInput.value = currentName;
        if (topicInput) topicInput.value = currentTopic;
        if (categoryInput) categoryInput.value = currentCategory;
        if (!isAscord) return;
        function syncModePreset(shouldApplyPreset) {
          const nextMode = normalizeChannelMode(modeSelect && modeSelect.value, currentChannelMode);
          const nextDefaults = defaultCallPermissionsForRoom(Object.assign({}, currentRoom, { channel_mode: nextMode }));
          if (modeHelp) {
            const option = CHANNEL_MODE_OPTIONS.find(function (item) {
              return normalizeChannelMode(item.value, "voice") === nextMode;
            }) || CHANNEL_MODE_OPTIONS[0];
            modeHelp.textContent = normalizeText(option && option.help);
          }
          if (!shouldApplyPreset) return;
          CALL_PERMISSION_FIELDS.forEach(function (field) {
            const select = document.getElementById("swalMessengerPerm_" + field.key);
            if (select && nextDefaults[field.key]) select.value = nextDefaults[field.key];
          });
        }
        if (modeSelect) {
          modeSelect.value = currentChannelMode;
          modeSelect.addEventListener("change", function () {
            syncModePreset(true);
          });
        }
        syncModePreset(false);
      },
      preConfirm: function () {
        const nameInput = document.getElementById("swalMessengerRoomName");
        const topicInput = document.getElementById("swalMessengerRoomTopic");
        const categoryInput = document.getElementById("swalMessengerRoomCategory");
        const modeSelect = document.getElementById("swalMessengerRoomMode");
        const nextName = normalizeText(nameInput && nameInput.value);
        const nextTopic = normalizeText(topicInput && topicInput.value);
        const nextCategory = normalizeText(categoryInput && categoryInput.value);
        const nextChannelMode = normalizeChannelMode(modeSelect && modeSelect.value, currentChannelMode);
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
        if (isAscord && nextCategory.length > 60) {
          window.Swal.showValidationMessage("카테고리 이름은 60자 이하만 입력할 수 있습니다.");
          return false;
        }
        const nextPermissions = {};
        if (isAscord) {
          CALL_PERMISSION_FIELDS.forEach(function (field) {
            const select = document.getElementById("swalMessengerPerm_" + field.key);
            nextPermissions[field.key] = normalizeCallPermissionLevel(select && select.value, currentPermissions[field.key]);
          });
        }
        return {
          name: nextName,
          topic: nextTopic,
          channel_category: isAscord ? nextCategory : "",
          channel_mode: isAscord ? nextChannelMode : "voice",
          call_permissions: nextPermissions,
        };
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

  function viewModeStorageKey() {
    return "abbasMessengerViewMode";
  }

  function callSettingsStorageKey() {
    return "abbasMessengerCallSettings";
  }

  function localNotificationsStorageKey() {
    const userId = normalizeText((state.currentUser && state.currentUser.user_id) || "");
    return userId ? ("abbasMessengerLocalNotifications:" + userId) : "";
  }

  function sanitizeViewMode(value) {
    return normalizeText(value).toLowerCase() === "ascord" ? "ascord" : "talk";
  }

  function sanitizeCallLayout(value) {
    return normalizeText(value).toLowerCase() === "speaker" ? "speaker" : "grid";
  }

  function sanitizeParticipantVolumes(values) {
    const result = {};
    const payload = values && typeof values === "object" ? values : {};
    Object.keys(payload).forEach(function (key) {
      const normalizedKey = normalizeText(key);
      const normalizedValue = clampNumber(Number(payload[key]), 0, 1);
      if (!normalizedKey || !Number.isFinite(normalizedValue)) return;
      result[normalizedKey] = normalizedValue;
    });
    return result;
  }

  function sanitizeDeviceSelectionMap(values) {
    const payload = values && typeof values === "object" ? values : {};
    return {
      audioinput: normalizeText(payload.audioinput),
      audiooutput: normalizeText(payload.audiooutput),
      videoinput: normalizeText(payload.videoinput),
    };
  }

  function loadViewModePreference() {
    let value = "talk";
    try {
      value = window.localStorage.getItem(viewModeStorageKey()) || "talk";
    } catch (_) {
      value = "talk";
    }
    state.viewMode = sanitizeViewMode(value);
  }

  function persistViewModePreference() {
    try {
      window.localStorage.setItem(viewModeStorageKey(), sanitizeViewMode(state.viewMode));
    } catch (_) {}
  }

  function loadCallPreferences() {
    let parsed = {};
    try {
      parsed = JSON.parse(window.localStorage.getItem(callSettingsStorageKey()) || "{}") || {};
    } catch (_) {
      parsed = {};
    }
    state.call.pushToTalk = !!parsed.pushToTalk;
    state.call.layoutMode = sanitizeCallLayout(parsed.layoutMode);
    state.call.participantVolumes = sanitizeParticipantVolumes(parsed.participantVolumes);
    state.call.selectedDevices = sanitizeDeviceSelectionMap(parsed.selectedDevices);
  }

  function persistCallPreferences() {
    try {
      window.localStorage.setItem(callSettingsStorageKey(), JSON.stringify({
        pushToTalk: !!state.call.pushToTalk,
        layoutMode: sanitizeCallLayout(state.call.layoutMode),
        participantVolumes: sanitizeParticipantVolumes(state.call.participantVolumes),
        selectedDevices: sanitizeDeviceSelectionMap(state.call.selectedDevices),
      }));
    } catch (_) {}
  }

  function loadLocalNotifications() {
    const storageKey = localNotificationsStorageKey();
    if (!storageKey) return [];
    let values = [];
    try {
      values = JSON.parse(window.localStorage.getItem(storageKey) || "[]") || [];
    } catch (_) {
      values = [];
    }
    return (Array.isArray(values) ? values : []).filter(function (item) {
      return item && normalizeText(item.source) === "local_call";
    });
  }

  function persistLocalNotifications() {
    const storageKey = localNotificationsStorageKey();
    if (!storageKey) return;
    const values = (state.notifications || []).filter(function (item) {
      return normalizeText((item || {}).source) === "local_call";
    }).slice(0, 40);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(values));
    } catch (_) {}
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
      hideMutedChannels: parsed.hideMutedChannels === true,
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
    if (state.viewMode === "ascord") {
      renderRoomList();
      renderCallUi();
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
    if (response.status === 401) {
      handleSocketAuthFailure();
    }
    if (!response.ok || !payload.ok) {
      throw new Error(normalizeText(payload.detail) || ("HTTP " + response.status));
    }
    return payload;
  }

  function setCounts(counts) {
    const viewRooms = currentViewRooms();
    const roomTotal = Number(viewRooms.length || 0);
    const unreadTotal = Number(viewRooms.reduce(function (sum, room) {
      return sum + Number(room.unread_count || 0);
    }, 0));
    const viewNotificationCounts = currentViewNotificationCounts();
    const unreadNotificationTotal = Number(viewNotificationCounts.unread_total || 0);
    const launcherUnreadTotal = Math.max(unreadTotal, unreadNotificationTotal);
    const ascordRooms = currentViewRooms("ascord");
    const ascordLiveCount = unseenAscordLiveRoomCount(ascordRooms);
    const ascordPendingStageCount = ascordPendingStageRequestCount(ascordRooms);
    if (dom.roomTotal) dom.roomTotal.textContent = String(roomTotal);
    if (dom.unreadTotal) dom.unreadTotal.textContent = String(unreadTotal);
    if (dom.onlineContacts) dom.onlineContacts.textContent = String((counts && counts.online_contacts) || 0);
    if (dom.channelCount) dom.channelCount.textContent = String(viewRooms.filter(function (room) { return !!room.is_channel; }).length || 0);
    if (dom.groupCount) dom.groupCount.textContent = String(viewRooms.filter(function (room) { return !!room.is_group; }).length || 0);
    if (dom.directCount) dom.directCount.textContent = String(viewRooms.filter(function (room) { return !!room.is_direct; }).length || 0);
    if (dom.railUnreadBadge) {
      const badgeValue = state.viewMode === "ascord" ? ascordPendingStageCount : unreadTotal;
      if (badgeValue > 0) {
        dom.railUnreadBadge.textContent = badgeValue > 99 ? "99+" : String(badgeValue);
        dom.railUnreadBadge.classList.remove("d-none");
      } else {
        dom.railUnreadBadge.textContent = "";
        dom.railUnreadBadge.classList.add("d-none");
      }
    }
    if (dom.railNotifyBadge) {
      const badgeValue = state.viewMode === "ascord" ? ascordLiveCount : unreadNotificationTotal;
      if (badgeValue > 0) {
        dom.railNotifyBadge.textContent = badgeValue > 99 ? "99+" : String(badgeValue);
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
    persistLocalNotifications();
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
    if (isSystemMessage(payload)) return null;
    const roomId = Number(payload.room_id || 0);
    if (roomId <= 0) return null;
    const room = findRoomById(roomId) || {};
    if (room && !isTalkRoom(room)) return null;
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

  function roomDisplayInfo(roomId) {
    const room = findRoomById(roomId) || {};
    return {
      room: room,
      title: normalizeText(room.title || "대화방"),
      avatarInitial: normalizeText(room.avatar_initial || "C"),
      avatarUrl: normalizeText(room.avatar_url),
      roomType: normalizeText(room.room_type || (room.is_direct ? "direct" : (room.is_channel ? "channel" : "group"))),
    };
  }

  function callPrimaryParticipant(roomCall) {
    const participants = Array.isArray(roomCall && roomCall.participants) ? roomCall.participants : [];
    return participants.length ? (participants[0] || {}) : {};
  }

  function callTimeText(timestampValue) {
    const timestamp = Number(timestampValue || 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return "방금 전";
    const diffSeconds = Math.max(0, Math.round((Date.now() - (timestamp * 1000)) / 1000));
    if (diffSeconds < 60) return "방금 전";
    if (diffSeconds < 3600) return Math.max(1, Math.floor(diffSeconds / 60)) + "분 전";
    if (diffSeconds < 86400) return Math.max(1, Math.floor(diffSeconds / 3600)) + "시간 전";
    return Math.max(1, Math.floor(diffSeconds / 86400)) + "일 전";
  }

  function callPreferredMode(roomCall) {
    const participants = Array.isArray(roomCall && roomCall.participants) ? roomCall.participants : [];
    const hasVideo = participants.some(function (participant) {
      const mediaMode = normalizeText((participant || {}).media_mode).toLowerCase();
      return !!((participant && participant.video_enabled) || (participant && participant.sharing_screen) || mediaMode === "video");
    });
    return hasVideo ? "video" : "audio";
  }

  function buildCallNotificationItem(roomCall, kind) {
    const payload = roomCall || {};
    const roomId = Number(payload.room_id || 0);
    if (roomId <= 0) return null;
    const room = findRoomById(roomId);
    if (room && !isAscordRoom(room)) return null;
    const kindValue = normalizeText(kind).toLowerCase() === "missed_call" ? "missed_call" : "call";
    const info = roomDisplayInfo(roomId);
    const primaryParticipant = callPrimaryParticipant(payload);
    const callerName = normalizeText(primaryParticipant.display_name || info.title || "참여자");
    const participantCount = Math.max(1, Number(payload.participant_count || (payload.participants && payload.participants.length) || 0));
    const summary = kindValue === "missed_call"
      ? callerName + " 외 " + participantCount + "명이 통화를 시작했지만 응답하지 않았습니다."
      : callerName + " 외 " + participantCount + "명이 통화 중입니다.";
    return {
      id: "call-" + kindValue + "-" + normalizeText(payload.call_id || roomId + "-" + Date.now()),
      source: "local_call",
      call_id: normalizeText(payload.call_id || ""),
      room_id: roomId,
      message_id: 0,
      kind: kindValue,
      kind_label: kindValue === "missed_call" ? "부재중 통화" : "통화 초대",
      is_unread: true,
      room_title: info.title,
      room_type: info.roomType,
      room_avatar_initial: info.avatarInitial,
      room_avatar_url: info.avatarUrl,
      sender_display_name: callerName,
      sender_avatar_initial: normalizeText(primaryParticipant.avatar_initial || avatarInitialFor(callerName, "C")),
      sender_avatar_url: normalizeText(primaryParticipant.profile_image_url || ""),
      sender_department: normalizeText(primaryParticipant.department || ""),
      preview: kindValue === "missed_call" ? "통화 기록을 확인해보세요." : "지금 바로 참여할 수 있습니다.",
      summary: summary,
      created_at: new Date((Number(payload.updated_at || payload.started_at || 0) || (Date.now() / 1000)) * 1000).toISOString(),
      time_text: callTimeText(Number(payload.updated_at || payload.started_at || 0)),
      action_type: kindValue === "missed_call" ? "open-ascord" : "join-call",
      preferred_mode: callPreferredMode(payload),
    };
  }

  function buildStageRequestNotificationItem(room, roomCall, participant) {
    const targetRoom = room || findRoomById(Number((roomCall && roomCall.room_id) || 0)) || {};
    const payload = participant || {};
    const roomId = Number((roomCall && roomCall.room_id) || (targetRoom && targetRoom.id) || 0);
    const requesterUserId = normalizeText(payload.user_id);
    if (roomId <= 0 || !requesterUserId) return null;
    if (targetRoom && !isAscordRoom(targetRoom)) return null;
    const info = roomDisplayInfo(roomId);
    const profile = roomMemberProfile(targetRoom, requesterUserId, payload.display_name);
    const requesterName = normalizeText(profile.display_name || payload.display_name || requesterUserId || "참여자");
    return {
      id: "stage-request-" + normalizeText((roomCall && roomCall.call_id) || String(roomId)) + "-" + requesterUserId,
      source: "local_stage_request",
      room_id: roomId,
      message_id: 0,
      kind: "stage_request",
      kind_label: "발언 요청",
      is_unread: true,
      room_title: info.title,
      room_type: info.roomType,
      room_avatar_initial: info.avatarInitial,
      room_avatar_url: info.avatarUrl,
      user_id: requesterUserId,
      sender_user_id: requesterUserId,
      sender_display_name: requesterName,
      sender_avatar_initial: normalizeText(profile.avatar_initial || avatarInitialFor(requesterName, "U")),
      sender_avatar_url: normalizeText(profile.profile_image_url || ""),
      sender_department: normalizeText(profile.department || "ASCORD STAGE"),
      preview: requesterName + "님이 발표자로 발언 요청을 보냈습니다.",
      summary: requesterName + "님이 STAGE 발언 요청을 보냈습니다.",
      created_at: new Date().toISOString(),
      time_text: "방금 전",
      action_type: "open-ascord",
    };
  }

  function notificationActionType(item) {
    const explicit = normalizeText((item || {}).action_type);
    if (explicit) return explicit;
    const kind = normalizeText((item || {}).kind).toLowerCase();
    if (kind === "call") return "join-call";
    if (kind === "stage_request") return "open-ascord";
    return "open-room";
  }

  async function openNotificationItem(item) {
    const payload = item || {};
    const roomId = Number(payload.room_id || 0);
    const messageId = Number(payload.message_id || 0);
    if (roomId <= 0) return;
    const actionType = notificationActionType(payload);
    const room = findRoomById(roomId);
    if (actionType === "join-call") {
      await acceptIncomingCall(roomId, normalizeText(payload.preferred_mode) === "video" ? "video" : "audio");
      return;
    }
    if (actionType === "open-ascord") {
      await openAscordRoom(roomId);
      return;
    }
    if (room && isAscordRoom(room)) {
      await openAscordRoom(roomId);
      return;
    }
    await openRoom(roomId, messageId);
  }

  function removeLocalCallNotifications(callId, kinds) {
    const targetCallId = normalizeText(callId);
    if (!targetCallId) return;
    const allowedKinds = (Array.isArray(kinds) ? kinds : [kinds]).map(function (value) {
      return normalizeText(value).toLowerCase();
    }).filter(Boolean);
    let changed = false;
    state.notifications = (state.notifications || []).filter(function (item) {
      if (normalizeText((item || {}).source) !== "local_call") return true;
      if (normalizeText((item || {}).call_id) !== targetCallId) return true;
      if (allowedKinds.length && allowedKinds.indexOf(normalizeText((item || {}).kind).toLowerCase()) === -1) {
        return true;
      }
      changed = true;
      return false;
    });
    if (changed) {
      applyNotificationItems(state.notifications, null);
    }
  }

  function removeLocalStageRequestNotifications(roomId, userIds) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    const allowedUserIds = (Array.isArray(userIds) ? userIds : [userIds]).map(function (value) {
      return normalizeText(value);
    }).filter(Boolean);
    let changed = false;
    state.notifications = (state.notifications || []).filter(function (item) {
      if (normalizeText((item || {}).source) !== "local_stage_request") return true;
      if (Number((item && item.room_id) || 0) !== targetRoomId) return true;
      if (allowedUserIds.length && allowedUserIds.indexOf(normalizeText((item && item.sender_user_id) || "").trim()) === -1 && allowedUserIds.indexOf(normalizeText((item && item.user_id) || "").trim()) === -1) {
        return true;
      }
      changed = true;
      return false;
    });
    if (changed) {
      applyNotificationItems(state.notifications, null);
    }
  }

  function upsertNotificationItem(item) {
    const mergedItems = mergeNotificationItems(item ? [item] : []);
    applyNotificationItems(mergedItems, null);
  }

  function snapshotRoomCall(roomCall) {
    const payload = roomCall || null;
    const roomId = Number((payload && payload.room_id) || 0);
    if (roomId <= 0) return null;
    const participants = Array.isArray(payload && payload.participants) ? payload.participants : [];
    return {
      room_id: roomId,
      call_id: normalizeText(payload.call_id || ""),
      started_at: Number(payload.started_at || 0),
      updated_at: Number(payload.updated_at || payload.started_at || 0),
      participant_count: Math.max(0, Number(payload.participant_count || participants.length || 0)),
      speaker_count: Math.max(0, Number(payload.speaker_count || 0)),
      audience_count: Math.max(0, Number(payload.audience_count || 0)),
      speaker_request_count: Math.max(0, Number(payload.speaker_request_count || 0)),
      participants: participants.map(function (participant) {
        return {
          user_id: normalizeText((participant || {}).user_id),
          display_name: normalizeText((participant || {}).display_name),
          joined_at: Number((participant || {}).joined_at || 0),
          media_mode: normalizeText((participant || {}).media_mode || "audio"),
          audio_enabled: !!(participant && participant.audio_enabled),
          video_enabled: !!(participant && participant.video_enabled),
          sharing_screen: !!(participant && participant.sharing_screen),
          deafened: !!(participant && participant.deafened),
          server_muted: !!(participant && participant.server_muted),
          source: normalizeText((participant || {}).source || "camera"),
          stage_role: callParticipantStageRole(participant),
          speaker_requested: callParticipantSpeakerRequested(participant),
        };
      }),
    };
  }

  function currentUserInRoomCall(roomCall) {
    return userInCall(roomCall, currentUserId());
  }

  function incomingInviteForRoom(roomId) {
    return state.call.incomingInvitesByRoomId[Number(roomId || 0)] || null;
  }

  function removeIncomingCallInvite(roomId, options) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return null;
    const invite = incomingInviteForRoom(targetRoomId);
    if (!invite) return null;
    const settings = options || {};
    if (settings.dismiss) {
      invite.dismissed = true;
      invite.joined = false;
      invite.dismissedAt = Date.now();
      state.call.incomingInvitesByRoomId[targetRoomId] = invite;
      removeLocalCallNotifications(invite.callId, "call");
      return invite;
    }
    if (settings.joined) {
      invite.joined = true;
      invite.dismissed = true;
      invite.joinedAt = Date.now();
      state.call.incomingInvitesByRoomId[targetRoomId] = invite;
      removeLocalCallNotifications(invite.callId, "call");
      return invite;
    }
    delete state.call.incomingInvitesByRoomId[targetRoomId];
    if (invite.callId) {
      removeLocalCallNotifications(invite.callId, "call");
    }
    return invite;
  }

  function queueIncomingCallInvite(roomCall) {
    const snapshot = snapshotRoomCall(roomCall);
    const roomId = Number((snapshot && snapshot.room_id) || 0);
    if (roomId <= 0) return null;
    const room = findRoomById(roomId) || {};
    if (room && !isAscordRoom(room)) return null;
    if (room && room.is_muted) return null;
    const callId = normalizeText((snapshot && snapshot.call_id) || ("room-" + roomId));
    const existing = incomingInviteForRoom(roomId);
    const nextInvite = existing && normalizeText(existing.callId) === callId
      ? Object.assign({}, existing, { roomCall: snapshot, updatedAt: Date.now() })
      : {
          roomId: roomId,
          callId: callId,
          roomCall: snapshot,
          dismissed: false,
          joined: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
    state.call.incomingInvitesByRoomId[roomId] = nextInvite;
    if (!nextInvite.dismissed && !nextInvite.joined) {
      const notificationItem = buildCallNotificationItem(snapshot, "call");
      if (notificationItem) {
        upsertNotificationItem(notificationItem);
        showBrowserNotification(notificationItem);
      }
    }
    return nextInvite;
  }

  function renderIncomingCallInvites() {
    if (!dom.callInviteStack) return;
    if (state.viewMode !== "ascord") {
      dom.callInviteStack.innerHTML = "";
      dom.callInviteStack.classList.remove("is-visible");
      return;
    }
    const invites = Object.keys(state.call.incomingInvitesByRoomId || {}).map(function (key) {
      return state.call.incomingInvitesByRoomId[key];
    }).filter(function (invite) {
      const room = findRoomById(Number((invite && invite.roomId) || 0));
      return invite && !invite.dismissed && !invite.joined && invite.roomCall && (!room || isAscordRoom(room));
    }).sort(function (a, b) {
      return Number((b && b.roomCall && b.roomCall.updated_at) || 0) - Number((a && a.roomCall && a.roomCall.updated_at) || 0);
    });

    if (!invites.length) {
      dom.callInviteStack.innerHTML = "";
      dom.callInviteStack.classList.remove("is-visible");
      return;
    }

    dom.callInviteStack.classList.add("is-visible");
    dom.callInviteStack.innerHTML = invites.map(function (invite) {
      const roomCall = invite.roomCall || {};
      const info = roomDisplayInfo(invite.roomId);
      const primaryParticipant = callPrimaryParticipant(roomCall);
      const callerName = normalizeText(primaryParticipant.display_name || info.title || "참여자");
      const participantCount = Math.max(1, Number(roomCall.participant_count || (roomCall.participants && roomCall.participants.length) || 0));
      const preferredMode = callPreferredMode(roomCall);
      return [
        '<section class="messenger-call-invite" data-call-invite-room-id="' + invite.roomId + '">',
        '<div class="messenger-call-invite__copy">',
        '<span class="messenger-call-invite__badge">' + escapeHtml(preferredMode === "video" ? "VIDEO CALL" : "VOICE CALL") + "</span>",
        '<strong>' + escapeHtml(info.title) + "</strong>",
        '<span>' + escapeHtml(callerName + " 외 " + participantCount + "명이 연결 중입니다. 지금 바로 합류할 수 있습니다.") + "</span>",
        "</div>",
        '<div class="messenger-call-invite__actions">',
        '<button type="button" data-call-invite-action="join-audio" data-call-invite-room-id="' + invite.roomId + '"><i class="bi bi-telephone-fill"></i><span>음성 참여</span></button>',
        '<button type="button" data-call-invite-action="join-video" data-call-invite-room-id="' + invite.roomId + '"><i class="bi bi-camera-video-fill"></i><span>영상 참여</span></button>',
        '<button type="button" data-call-invite-action="open-ascord" data-call-invite-room-id="' + invite.roomId + '"><i class="bi bi-broadcast-pin"></i><span>채널 열기</span></button>',
        '<button type="button" class="is-dismiss" data-call-invite-action="dismiss" data-call-invite-room-id="' + invite.roomId + '"><i class="bi bi-x-lg"></i><span>거절</span></button>',
        "</div>",
        "</section>",
      ].join("");
    }).join("");
  }

  async function acceptIncomingCall(roomId, mode) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    const targetMode = normalizeText(mode).toLowerCase() === "video" ? "video" : "audio";
    if (!state.initialized) {
      await init();
    }
    setNotificationMenuOpen(false);
    setPopupOpen(true);
    setViewMode("ascord");
    await selectRoom(targetRoomId);
    dismissNotificationsForRoom(targetRoomId);

    const activeCall = callForRoom(targetRoomId) || (incomingInviteForRoom(targetRoomId) && incomingInviteForRoom(targetRoomId).roomCall) || null;
    if (!activeCall || Number(activeCall.participant_count || 0) <= 0) {
      removeIncomingCallInvite(targetRoomId);
      renderIncomingCallInvites();
      await showWarning("이미 종료된 통화입니다.", "통화 종료됨");
      return;
    }

    if (Number(state.call.joinedRoomId || 0) === targetRoomId && !!currentLiveRoom()) {
      if (targetMode === "video" && !state.call.cameraEnabled) {
        await toggleCallCamera();
      }
      removeIncomingCallInvite(targetRoomId, { joined: true });
      renderIncomingCallInvites();
      return;
    }

    await startOrJoinCall(targetMode);
    removeIncomingCallInvite(targetRoomId, { joined: true });
    renderIncomingCallInvites();
  }

  function handleIncomingRoomCallTransition(previousCall, nextCall) {
    const roomId = Number((nextCall && nextCall.room_id) || 0);
    if (roomId <= 0 || !nextCall || Number(nextCall.participant_count || 0) <= 0) return;
    if (currentUserInRoomCall(nextCall)) return;

    const nextCallId = normalizeText(nextCall.call_id || "");
    const previousCallId = normalizeText((previousCall && previousCall.call_id) || "");
    const previousActive = !!previousCall && Number(previousCall.participant_count || 0) > 0;
    const previousIncludedCurrentUser = currentUserInRoomCall(previousCall);
    const isFreshCall = !previousActive || !previousCallId || previousCallId !== nextCallId;
    if (!isFreshCall || previousIncludedCurrentUser) {
      const existingInvite = incomingInviteForRoom(roomId);
      if (existingInvite && normalizeText(existingInvite.callId) === nextCallId) {
        existingInvite.roomCall = nextCall;
        existingInvite.updatedAt = Date.now();
        state.call.incomingInvitesByRoomId[roomId] = existingInvite;
      }
      return;
    }

    queueIncomingCallInvite(nextCall);
  }

  function recalcCounts() {
    const viewRooms = currentViewRooms();
    setCounts({
      room_total: viewRooms.length,
      unread_total: viewRooms.reduce(function (sum, room) {
        return sum + Number(room.unread_count || 0);
      }, 0),
      channel_total: viewRooms.filter(function (room) { return !!room.is_channel; }).length,
      group_total: viewRooms.filter(function (room) { return !!room.is_group; }).length,
      direct_total: viewRooms.filter(function (room) { return !!room.is_direct; }).length,
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
    const visibleNotifications = currentViewNotificationItems();
    if (dom.notifyDot) {
      const unreadTotal = Number(notificationCountsFromItems(visibleNotifications).unread_total || 0);
      dom.notifyDot.classList.toggle("d-none", unreadTotal <= 0);
    }
    if (dom.notifyMeta) {
      const visibleCounts = notificationCountsFromItems(visibleNotifications);
      const unreadTotal = Number(visibleCounts.unread_total || 0);
      const mentionTotal = Number(visibleCounts.unread_mention_total || 0);
      if (unreadTotal > 0) {
        dom.notifyMeta.textContent = "확인할 알림 " + unreadTotal + "건" + (mentionTotal > 0 ? " · 멘션 " + mentionTotal + "건" : "");
      } else {
        dom.notifyMeta.textContent = "최근 메시지와 멘션이 여기에 표시됩니다.";
      }
    }
    if (!dom.notifyList) return;
    if (!visibleNotifications.length) {
      dom.notifyList.innerHTML = [
        '<div class="topbar-notify-empty">',
        '<i class="bi bi-bell-slash"></i>',
        "<strong>새 알림이 없습니다.</strong>",
        "<span>최근 메시지와 멘션이 도착하면 여기에 표시됩니다.</span>",
        "</div>",
      ].join("");
      return;
    }

    dom.notifyList.innerHTML = visibleNotifications.map(function (item) {
      const avatar = item.sender_avatar_url
        ? '<img src="' + escapeHtml(item.sender_avatar_url) + '" alt="' + escapeHtml(item.sender_display_name || item.room_title) + '">'
        : escapeHtml(item.sender_avatar_initial || item.room_avatar_initial || "A");
      const kindClass = item.kind === "mention"
        ? " is-mention"
        : (item.kind === "call"
          ? " is-call"
          : (item.kind === "missed_call"
            ? " is-missed"
            : (item.kind === "stage_request" ? " is-stage" : " is-message")));
      const unreadClass = item.is_unread ? " is-unread" : "";
      return [
        '<button class="topbar-notify-item' + unreadClass + '" type="button" data-notify-room-id="' + Number(item.room_id || 0) + '" data-notify-message-id="' + Number(item.message_id || 0) + '" data-notify-action="' + escapeAttribute(notificationActionType(item)) + '" data-notify-mode="' + escapeAttribute(item.preferred_mode || "audio") + '">',
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
        const item = {
          room_id: Number(button.getAttribute("data-notify-room-id") || 0),
          message_id: Number(button.getAttribute("data-notify-message-id") || 0),
          action_type: normalizeText(button.getAttribute("data-notify-action")),
          preferred_mode: normalizeText(button.getAttribute("data-notify-mode") || "audio"),
        };
        openNotificationItem(item).catch(function () {});
      });
    });
  }

  function updateNotificationState(payload, counts) {
    const mergedItems = mergeNotificationItems(loadLocalNotifications().concat(Array.isArray(payload && payload.items) ? payload.items : []));
    applyNotificationItems(mergedItems, counts);
  }

  function syncFilterTabs(filter) {
    if (!dom.filterTabs) return;
    Array.prototype.forEach.call(dom.filterTabs.querySelectorAll("[data-filter]"), function (button) {
      button.classList.toggle("is-active", normalizeText(button.getAttribute("data-filter")) === normalizeText(filter));
    });
  }

  function setRailButtonDisabled(button, disabled) {
    if (!button) return;
    button.disabled = !!disabled;
    button.classList.toggle("is-disabled", !!disabled);
  }

  function setRailButtonVisible(button, visible) {
    if (!button) return;
    button.classList.toggle("d-none", !visible);
  }

  function setRailButtonIcon(button, iconClass) {
    if (!button) return;
    const icon = button.querySelector("i");
    if (!icon) return;
    icon.className = "bi " + normalizeText(iconClass || "bi-circle-fill");
  }

  function setRailButtonLabel(button, label) {
    if (!button) return;
    const text = normalizeText(label);
    if (!text) return;
    button.setAttribute("aria-label", text);
    button.setAttribute("title", text);
  }

  function applyViewModeChrome() {
    const isAscord = state.viewMode === "ascord";
    if (dom.root) {
      dom.root.classList.toggle("is-ascord", isAscord);
      dom.root.classList.toggle("is-talk", !isAscord);
    }
    syncChatHeaderPlacement();
    if (dom.talkModeBtn) dom.talkModeBtn.classList.toggle("is-active", !isAscord);
    if (dom.ascordModeBtn) dom.ascordModeBtn.classList.toggle("is-active", isAscord);
    if (dom.modePrimaryChip) dom.modePrimaryChip.textContent = isAscord ? "Voice Channels" : "Team Messenger";
    if (dom.modeSecondaryChip) dom.modeSecondaryChip.textContent = isAscord ? "Discord Style Call Workspace" : "Realtime Collaboration";
    if (dom.windowTitle) dom.windowTitle.textContent = isAscord ? "ASCORD" : "ABBAS Talk";
    if (dom.newChatBtn) dom.newChatBtn.classList.remove("d-none");
    if (dom.roomSearch) dom.roomSearch.setAttribute("placeholder", isAscord ? "ASCORD 채널 검색" : "채팅방 또는 메시지 검색");
    setRailButtonVisible(dom.railRoomsBtn, true);
    setRailButtonVisible(dom.railInboxBtn, !isAscord);
    setRailButtonVisible(dom.railAlertsBtn, true);
    setRailButtonVisible(dom.railComposeBtn, !isAscord);
    setRailButtonVisible(dom.railRecentBtn, true);
    setRailButtonVisible(dom.railGuideBtn, true);
    setRailButtonVisible(dom.railSettingsBtn, true);
    setRailButtonVisible(dom.railUnreadBtn, !isAscord);
    setRailButtonVisible(dom.railStarredBtn, !isAscord);
    setRailButtonDisabled(dom.railInboxBtn, false);
    setRailButtonDisabled(dom.railAlertsBtn, false);
    setRailButtonDisabled(dom.railComposeBtn, false);
    setRailButtonDisabled(dom.railRecentBtn, false);
    setRailButtonDisabled(dom.railGuideBtn, false);
    setRailButtonDisabled(dom.railSettingsBtn, false);
    if (isAscord) {
      setRailButtonLabel(dom.railRoomsBtn, "ASCORD 채널");
      setRailButtonLabel(dom.railAlertsBtn, "발언 요청");
      setRailButtonLabel(dom.railRecentBtn, "최근 채널");
      setRailButtonLabel(dom.railGuideBtn, "ASCORD 가이드");
      setRailButtonLabel(dom.railSettingsBtn, "ASCORD 설정");
      setRailButtonIcon(dom.railRoomsBtn, "bi-volume-up-fill");
      setRailButtonIcon(dom.railAlertsBtn, "bi-megaphone-fill");
      setRailButtonIcon(dom.railRecentBtn, "bi-clock-history");
      setRailButtonIcon(dom.railGuideBtn, "bi-broadcast-pin");
      setRailButtonIcon(dom.railSettingsBtn, "bi-sliders");
      return;
    }
    setRailButtonLabel(dom.railRoomsBtn, "팀 메신저");
    setRailButtonLabel(dom.railInboxBtn, "수신함");
    setRailButtonLabel(dom.railUnreadBtn, "안 읽은 대화");
    setRailButtonLabel(dom.railStarredBtn, "즐겨찾기");
    setRailButtonLabel(dom.railAlertsBtn, "멘션 및 알림");
    setRailButtonLabel(dom.railComposeBtn, "빠른 새 대화");
    setRailButtonLabel(dom.railRecentBtn, "최근 본 대화");
    setRailButtonLabel(dom.railGuideBtn, "메신저 도움말");
    setRailButtonLabel(dom.railSettingsBtn, "메신저 설정");
    setRailButtonIcon(dom.railRoomsBtn, "bi-people-fill");
    setRailButtonIcon(dom.railInboxBtn, "bi-briefcase-fill");
    setRailButtonIcon(dom.railUnreadBtn, "bi-chat-left-dots");
    setRailButtonIcon(dom.railStarredBtn, "bi-bookmark-check");
    setRailButtonIcon(dom.railAlertsBtn, "bi-bell");
    setRailButtonIcon(dom.railComposeBtn, "bi-send");
    setRailButtonIcon(dom.railRecentBtn, "bi-clock-history");
    setRailButtonIcon(dom.railGuideBtn, "bi-book");
    setRailButtonIcon(dom.railSettingsBtn, "bi-gear");
  }

  function setViewMode(mode) {
    state.viewMode = sanitizeViewMode(mode);
    if (state.viewMode === "ascord") {
      state.sidebarMode = "rooms";
      state.filter = "all";
    }
    if (state.viewMode !== "ascord") {
      setAscordServerMenuOpen(false);
      state.call.fullscreenTrackId = "";
      if (dom.callFullscreen) {
        dom.callFullscreen.classList.add("d-none");
        dom.callFullscreen.setAttribute("aria-hidden", "true");
      }
      if (dom.callFullscreenMedia) {
        dom.callFullscreenMedia.innerHTML = "";
      }
    }
    ensureActiveRoomForCurrentView(state.activeRoomId);
    persistViewModePreference();
    applyViewModeChrome();
    recalcCounts();
    updateSidebarChrome();
    renderRoomList();
    renderHeader();
    renderInspector();
    renderMessages();
    renderCallUi();
  }

  function syncChatHeaderPlacement() {
    if (!dom.chatHeader || !dom.chatHeaderAnchor || !dom.callStageHeaderSlot) return;
    const shouldNestInStage = state.viewMode === "ascord" && dom.callStage && !dom.callStage.classList.contains("d-none");
    if (shouldNestInStage) {
      if (dom.chatHeader.parentNode !== dom.callStageHeaderSlot) {
        dom.callStageHeaderSlot.appendChild(dom.chatHeader);
      }
      return;
    }
    if (dom.chatHeaderAnchor.parentNode && (dom.chatHeader.parentNode !== dom.chatHeaderAnchor.parentNode || dom.chatHeader.previousElementSibling !== dom.chatHeaderAnchor)) {
      dom.chatHeaderAnchor.insertAdjacentElement("afterend", dom.chatHeader);
    }
  }

  function sidebarModeConfig(mode) {
    if (state.viewMode === "ascord") {
      const visibleRooms = filteredRooms();
      const liveRooms = ascordLiveRooms(visibleRooms);
      const pendingStageRooms = ascordPendingStageRooms(visibleRooms);
      const pendingStageRequestCount = ascordPendingStageRequestCount(visibleRooms);
      const recentRooms = ascordRecentRooms();
      if (mode === "rooms") {
        return {
          title: "ASCORD 채널",
          metaHtml: "<span>LIVE <strong>" + liveRooms.length + "</strong></span><span>ROOMS <strong>" + visibleRooms.length + "</strong></span>",
          hideFilters: true,
          hideSummary: true,
          hideQuick: true,
        };
      }
      if (mode === "alerts") {
        return {
          title: "발언 요청",
          metaHtml: "<span>QUEUES <strong>" + pendingStageRooms.length + "</strong></span><span>REQUESTS <strong>" + pendingStageRequestCount + "</strong></span>",
          hideFilters: true,
          hideSummary: true,
          hideQuick: true,
        };
      }
      if (mode === "recent") {
        return {
          title: "최근 채널",
          metaHtml: "<span>RECENT <strong>" + recentRooms.length + "</strong></span>",
          hideFilters: true,
          hideSummary: true,
          hideQuick: true,
        };
      }
      if (mode === "guide") {
        return {
          title: "ASCORD 가이드",
          metaHtml: "<span>VOICE · STAGE</span>",
          hideFilters: true,
          hideSummary: true,
          hideQuick: true,
        };
      }
      if (mode === "settings") {
        return {
          title: "ASCORD 설정",
          metaHtml: "<span>LOCAL</span>",
          hideFilters: true,
          hideSummary: true,
          hideQuick: true,
        };
      }
    }
    const visibleNotificationCounts = currentViewNotificationCounts();
    const unreadAlertCount = Number(visibleNotificationCounts.unread_total || 0);
    const mentionCount = Number(visibleNotificationCounts.unread_mention_total || 0);
    const visibleRooms = currentViewRooms();
    const visibleRoomIds = new Set(visibleRooms.map(function (room) {
      return Number(room.id || 0);
    }));
    const recentCount = (state.roomHistory || []).filter(function (roomId) {
      return visibleRoomIds.has(Number(roomId || 0));
    }).length;
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
        metaHtml: "<span>대화 <strong>" + visibleRooms.filter(function (room) { return Number(room.unread_count || 0) > 0; }).length + "</strong></span>",
        hideFilters: true,
        hideSummary: true,
        hideQuick: true,
      };
    }
    if (mode === "starred_shortcut") {
      return {
        title: "즐겨찾기",
        metaHtml: "<span>즐겨찾기 <strong>" + visibleRooms.filter(function (room) { return !!room.is_starred; }).length + "</strong></span>",
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
      metaHtml: '<span>채널 <strong id="messengerChannelCount">' + String(visibleRooms.filter(function (room) { return !!room.is_channel; }).length) + '</strong></span><span>그룹 <strong id="messengerGroupCount">' + String(visibleRooms.filter(function (room) { return !!room.is_group; }).length) + '</strong></span>',
      hideFilters: false,
      hideSummary: false,
      hideQuick: false,
    };
  }

  function updateSidebarChrome() {
    const config = sidebarModeConfig(state.sidebarMode);
    const workspaceName = ascordWorkspaceName();
    if (dom.root) {
      dom.root.classList.toggle("is-inbox-mode", state.sidebarMode === "inbox" || state.sidebarMode === "alerts");
      dom.root.classList.toggle("is-utility-sidebar-mode", ["unread", "starred_shortcut", "alerts", "recent", "guide", "settings"].indexOf(state.sidebarMode) !== -1);
    }
    if (dom.ascordWorkspaceBtn) {
      dom.ascordWorkspaceBtn.classList.toggle("is-ascord", state.viewMode === "ascord");
      const titleNode = dom.ascordWorkspaceBtn.querySelector("strong");
      const metaNode = dom.ascordWorkspaceBtn.querySelector("span span");
      if (titleNode) {
        titleNode.textContent = state.viewMode === "ascord" ? workspaceName : normalizeText((state.currentUser && (state.currentUser.display_name || state.currentUser.user_id)) || "");
      }
      if (metaNode) {
        metaNode.textContent = state.viewMode === "ascord"
          ? "ASCORD Workspace"
          : (((state.currentUser && state.currentUser.role_label) || "USER") + " · ABBAS Workspace");
      }
    }
    if (dom.ascordInviteBtn) {
      dom.ascordInviteBtn.classList.toggle("d-none", state.viewMode !== "ascord");
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
    renderAscordVoiceDock();
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
    if (state.viewMode === "ascord" && state.sidebarMode === "inbox") {
      state.sidebarMode = "rooms";
    }
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
    return currentViewRooms().filter(function (room) {
      if (state.viewMode === "ascord" && state.preferences.hideMutedChannels && room && room.is_muted) {
        return false;
      }
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
    return currentViewNotificationItems().filter(function (item) {
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

  async function persistAscordVoiceChannelOrder(roomIds) {
    const payload = await api("/api/messenger/rooms/ascord/voice-order", {
      method: "POST",
      body: JSON.stringify({ room_ids: roomIds }),
    });
    const rooms = Array.isArray(payload && payload.rooms) ? payload.rooms : [];
    rooms.forEach(function (room) {
      if (!room || !room.id) return;
      const index = state.rooms.findIndex(function (item) {
        return Number(item.id || 0) === Number(room.id || 0);
      });
      if (index === -1) return;
      state.rooms[index] = Object.assign({}, state.rooms[index], room);
    });
    renderRoomList();
    renderHeader();
    renderInspector();
  }

  function applyLocalAscordVoiceChannelOrder(roomIds) {
    const orderMap = {};
    (Array.isArray(roomIds) ? roomIds : []).forEach(function (roomId, index) {
      orderMap[Number(roomId || 0)] = index + 1;
    });
    state.rooms = (state.rooms || []).map(function (room) {
      const roomId = Number((room && room.id) || 0);
      if (!Object.prototype.hasOwnProperty.call(orderMap, roomId)) return room;
      return Object.assign({}, room, { channel_sort_order: orderMap[roomId] });
    });
  }

  function bindAscordVoiceChannelReorder() {
    if (!dom.roomList || state.viewMode !== "ascord" || state.sidebarMode !== "rooms" || !isAscordVoiceReorderAllowed()) {
      state.ascordVoiceDragRoomId = 0;
      return;
    }
    const wrappers = Array.prototype.slice.call(dom.roomList.querySelectorAll("[data-ascord-voice-room-id]"));
    if (!wrappers.length) return;
    const orderedIds = stableAscordVoiceRooms(currentViewRooms("ascord").filter(function (room) {
      return roomSupportsCalls(room);
    })).map(function (room) {
      return Number(room.id || 0);
    }).filter(function (roomId) {
      return roomId > 0;
    });
    wrappers.forEach(function (wrapper) {
      const roomId = Number(wrapper.getAttribute("data-ascord-voice-room-id") || 0);
      if (roomId <= 0) return;
      wrapper.addEventListener("dragstart", function (event) {
        state.ascordVoiceDragRoomId = roomId;
        wrapper.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(roomId));
        }
      });
      wrapper.addEventListener("dragend", function () {
        state.ascordVoiceDragRoomId = 0;
        wrappers.forEach(function (item) {
          item.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
        });
      });
      wrapper.addEventListener("dragover", function (event) {
        if (!state.ascordVoiceDragRoomId || state.ascordVoiceDragRoomId === roomId) return;
        event.preventDefault();
        const rect = wrapper.getBoundingClientRect();
        const after = Number(event.clientY || 0) > rect.top + rect.height / 2;
        wrappers.forEach(function (item) {
          if (item === wrapper) {
            item.classList.toggle("is-drop-before", !after);
            item.classList.toggle("is-drop-after", after);
            return;
          }
          item.classList.remove("is-drop-before", "is-drop-after");
        });
      });
      wrapper.addEventListener("drop", function (event) {
        if (!state.ascordVoiceDragRoomId || state.ascordVoiceDragRoomId === roomId) return;
        event.preventDefault();
        const rect = wrapper.getBoundingClientRect();
        const after = Number(event.clientY || 0) > rect.top + rect.height / 2;
        const movingId = Number(state.ascordVoiceDragRoomId || 0);
        const nextOrder = orderedIds.filter(function (value) {
          return value !== movingId;
        });
        const targetIndex = nextOrder.indexOf(roomId);
        if (targetIndex < 0) return;
        nextOrder.splice(after ? targetIndex + 1 : targetIndex, 0, movingId);
        const previousOrder = orderedIds.slice();
        state.ascordVoiceDragRoomId = 0;
        applyLocalAscordVoiceChannelOrder(nextOrder);
        renderRoomList();
        persistAscordVoiceChannelOrder(nextOrder).catch(function (error) {
          applyLocalAscordVoiceChannelOrder(previousOrder);
          renderRoomList();
          showError((error && error.message) || "음성채널 순서를 저장하지 못했습니다.");
        });
      });
    });
  }

  function clearPendingAscordRoomOpen() {
    if (state.ascordRoomClickTimer) {
      window.clearTimeout(state.ascordRoomClickTimer);
    }
    state.ascordRoomClickTimer = 0;
    state.ascordPendingRoomId = 0;
  }

  function scheduleAscordRoomOpen(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    clearPendingAscordRoomOpen();
    state.ascordPendingRoomId = targetRoomId;
    state.ascordRoomClickTimer = window.setTimeout(function () {
      const pendingRoomId = Number(state.ascordPendingRoomId || 0);
      clearPendingAscordRoomOpen();
      if (pendingRoomId <= 0) return;
      openAscordRoom(pendingRoomId).catch(function (error) {
        showError((error && error.message) || "ASCORD 채널을 열지 못했습니다.");
      });
    }, 220);
  }

  function bindRoomListInteractions() {
    if (!dom.roomList) return;
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-room-id]"), function (button) {
      button.addEventListener("click", function () {
        const roomId = Number(button.getAttribute("data-room-id") || 0);
        if (roomId <= 0) return;
        if (state.viewMode === "ascord") {
          const targetRoom = findRoomById(roomId);
          if (targetRoom && roomSupportsCalls(targetRoom)) {
            scheduleAscordRoomOpen(roomId);
            return;
          }
          clearPendingAscordRoomOpen();
          openAscordRoom(roomId).catch(function (error) {
            showError((error && error.message) || "ASCORD 채널을 열지 못했습니다.");
          });
          return;
        }
        openRoom(roomId);
      });
      button.addEventListener("contextmenu", function (event) {
        showRoomContextMenu(event, findRoomById(Number(button.getAttribute("data-room-id") || 0)));
      });
    });
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-ascord-voice-room-id], .messenger-voice-room-card"), function (card) {
      card.addEventListener("dblclick", function (event) {
        if (state.viewMode !== "ascord") return;
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        if (!target.closest(".messenger-ascord-channel-row, .messenger-voice-room-card")) return;
        if (target.closest("[data-ascord-join-room-id], [data-ascord-sidebar-action], [data-room-participant-user-id]")) return;
        const roomId = Number(
          card.getAttribute("data-ascord-voice-room-id")
          || (target.closest("[data-room-id]") && target.closest("[data-room-id]").getAttribute("data-room-id"))
          || 0
        );
        if (roomId <= 0) return;
        const targetRoom = findRoomById(roomId);
        if (!targetRoom || !roomSupportsCalls(targetRoom)) return;
        event.preventDefault();
        event.stopPropagation();
        clearPendingAscordRoomOpen();
        joinAscordVoiceChannel(roomId).catch(function (error) {
          showError((error && error.message) || "ASCORD 음성채널에 입장하지 못했습니다.");
        });
      });
    });
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-room-create]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        setModalMode(normalizeText(button.getAttribute("data-room-create")) || "dm");
        if (dom.newRoomModalInstance) dom.newRoomModalInstance.show();
      });
    });
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-ascord-join-room-id]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        const roomId = Number(button.getAttribute("data-ascord-join-room-id") || 0);
        if (roomId <= 0 || button.disabled) return;
        joinAscordVoiceChannel(roomId).catch(function (error) {
          showError((error && error.message) || "ASCORD 음성채널에 입장하지 못했습니다.");
        });
      });
    });
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-ascord-create-category]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        const category = normalizeText(button.getAttribute("data-ascord-create-category")) || ascordWorkspaceName();
        openAscordCreateModal({ category: category, channelMode: "voice" });
      });
    });
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-ascord-create-section]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        const section = normalizeText(button.getAttribute("data-ascord-create-section")).toLowerCase();
        if (section === "voice") {
          openAscordCreateModal({ category: ascordWorkspaceName(), channelMode: "voice" });
          return;
        }
        if (section === "text") {
          showWarning("현재 ASCORD 데이터 모델은 디스코드처럼 별도 텍스트 채널 타입을 아직 지원하지 않습니다. 우선 음성 채널 중심으로 생성됩니다.", "텍스트 채널 준비 중").catch(function () {});
        }
      });
    });
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-ascord-sidebar-action]"), function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        const action = normalizeText(button.getAttribute("data-ascord-sidebar-action")).toLowerCase();
        const targetRoomId = Number(button.getAttribute("data-ascord-room-id") || 0);
        const targetRoom = findRoomById(targetRoomId) || state.activeRoom || currentAscordWorkspaceRoom();
        if (!action) return;
        if (action === "meeting-notes") {
          openMeetingNotesModal().catch(function (error) {
            showError((error && error.message) || "회의록 화면을 열지 못했습니다.");
          });
          return;
        }
        if (action === "boost") {
          handleAscordServerAction("server-boost").catch(function (error) {
            showError((error && error.message) || "서버 부스트 화면을 열지 못했습니다.");
          });
          return;
        }
        if (action === "channel-status") {
          if (!targetRoom) return;
          editRoomDetails(targetRoom).catch(function (error) {
            showError((error && error.message) || "채널 상태 설정을 열지 못했습니다.");
          });
          return;
        }
        if (action === "voice-invite") {
          inviteMembersToRoom(targetRoom).catch(function (error) {
            showError((error && error.message) || "음성 초대를 열지 못했습니다.");
          });
        }
      });
    });
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-ascord-voice-invite-wrap]"), function (wrap) {
      const roomId = Number(wrap.getAttribute("data-ascord-voice-invite-room-id") || 0);
      const clearCloseTimer = function () {
        const timerId = Number(state.ascordVoiceInviteCloseTimersByRoomId[roomId] || 0);
        if (timerId > 0) {
          window.clearTimeout(timerId);
        }
        delete state.ascordVoiceInviteCloseTimersByRoomId[roomId];
      };
      const renderMenu = function () {
        renderAscordVoiceInviteMenu(roomId, wrap);
      };
      wrap.addEventListener("mouseenter", function () {
        clearCloseTimer();
        wrap.classList.add("is-open");
        const previewRequest = ensureAscordVoiceInvitePreview(findRoomById(roomId));
        renderMenu();
        Promise.resolve(previewRequest).then(function () {
          if (!document.body.contains(wrap)) return;
          renderMenu();
        });
      });
      wrap.addEventListener("mouseleave", function () {
        clearCloseTimer();
        state.ascordVoiceInviteCloseTimersByRoomId[roomId] = window.setTimeout(function () {
          wrap.classList.remove("is-open");
          delete state.ascordVoiceInviteCloseTimersByRoomId[roomId];
        }, 140);
      });
      wrap.addEventListener("click", function (event) {
        const quickInviteButton = event.target instanceof Element ? event.target.closest("[data-ascord-voice-invite-user-id]") : null;
        if (quickInviteButton) {
          event.preventDefault();
          event.stopPropagation();
          quickInviteUserToAscordRoom(
            roomId,
            normalizeText(quickInviteButton.getAttribute("data-ascord-voice-invite-user-id"))
          ).catch(function (error) {
            showError((error && error.message) || "음성 초대를 보내지 못했습니다.");
          });
          return;
        }
        const moreButton = event.target instanceof Element ? event.target.closest("[data-ascord-voice-invite-more]") : null;
        if (!moreButton) return;
        event.preventDefault();
        event.stopPropagation();
        inviteMembersToRoom(findRoomById(roomId) || state.activeRoom || currentAscordWorkspaceRoom()).catch(function (error) {
          showError((error && error.message) || "초대 모달을 열지 못했습니다.");
        });
      });
    });
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-room-participant-user-id]"), function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        const userId = normalizeText(button.getAttribute("data-room-participant-user-id"));
        if (!userId) return;
        const room = currentAscordWorkspaceRoom() || state.activeRoom;
        if (room) {
          showParticipantContextMenu(event, userId);
        }
      });
      button.addEventListener("contextmenu", function (event) {
        event.preventDefault();
        event.stopPropagation();
        const userId = normalizeText(button.getAttribute("data-room-participant-user-id"));
        if (!userId) return;
        showParticipantContextMenu(event, userId);
      });
    });
    Array.prototype.forEach.call(dom.roomList.querySelectorAll("[data-guide-action]"), function (button) {
      button.addEventListener("click", function () {
        const action = normalizeText(button.getAttribute("data-guide-action"));
        if (action === "new-chat") {
          setModalMode(defaultModalModeForCurrentView());
          if (dom.newRoomModalInstance) dom.newRoomModalInstance.show();
          return;
        }
        if (action === "open-alerts") {
          setSidebarMode("alerts");
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
    bindAscordVoiceChannelReorder();
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
    if (state.viewMode === "ascord") {
      if (state.sidebarMode === "alerts") {
        renderAscordStageRequestList();
        bindRoomListInteractions();
        return;
      }
      if (state.sidebarMode === "recent") {
        renderAscordRecentRoomList();
        bindRoomListInteractions();
        return;
      }
      if (state.sidebarMode === "guide") {
        renderAscordGuideList();
        bindRoomListInteractions();
        return;
      }
      if (state.sidebarMode === "settings") {
        renderAscordSettingsList();
        bindRoomListInteractions();
        return;
      }
      renderAscordRoomList();
      bindRoomListInteractions();
      return;
    }
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

  function roomTypeLabel(room) {
    const targetRoom = room || {};
    if (targetRoom.is_direct) return "DM";
    if (isAscordRoom(targetRoom)) return "CHANNEL";
    if (targetRoom.is_channel) return "CHANNEL";
    return "GROUP";
  }

  function ascordCategoryLabel(room) {
    const targetRoom = room || {};
    const explicitCategory = roomChannelCategory(targetRoom);
    if (explicitCategory) return explicitCategory;
    if (targetRoom.is_direct) return "DIRECT CALLS";
    return "WORKSPACE";
  }

  function ascordPrivacyLabel(room) {
    const targetRoom = room || {};
    if (targetRoom.is_direct) return "DM";
    if (isAscordRoom(targetRoom)) return "CHANNEL";
    if (targetRoom.is_channel) return "PUBLIC";
    return "PRIVATE";
  }

  function ascordModeLabel(room) {
    const targetRoom = room || {};
    if (targetRoom.is_direct) return "DM CALL";
    return channelModeLabel(roomChannelMode(targetRoom));
  }

  function currentAscordWorkspaceRoom() {
    if (state.activeRoom && isAscordRoom(state.activeRoom)) return state.activeRoom;
    return (currentViewRooms() || []).find(function (room) {
      return isAscordRoom(room);
    }) || null;
  }

  function ascordWorkspaceName() {
    return "ABBA-S Korea";
  }

  function isAscordVoiceReorderAllowed() {
    const role = normalizeText((state.currentUser && state.currentUser.role) || "").toLowerCase();
    return role === "admin" || role === "superuser";
  }

  function ascordVoiceSortOrder(room) {
    const explicit = Number((room && room.channel_sort_order) || 0);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    return Number((room && room.id) || 0);
  }

  function stableAscordVoiceRooms(rooms) {
    return (Array.isArray(rooms) ? rooms.slice() : []).sort(function (a, b) {
      return ascordVoiceSortOrder(a) - ascordVoiceSortOrder(b)
        || Number((a && a.id) || 0) - Number((b && b.id) || 0);
    });
  }

  function stableParticipantSummariesByCallOrder(room, roomCall, summaries) {
    const targetRoom = room || state.activeRoom;
    const targetRoomId = Number((targetRoom && targetRoom.id) || 0);
    const call = roomCall || callForRoom(targetRoom && targetRoom.id);
    const previousOrder = targetRoomId > 0 && Array.isArray(state.call.participantOrderByRoomId[targetRoomId])
      ? state.call.participantOrderByRoomId[targetRoomId].slice()
      : [];
    const liveIds = new Set((Array.isArray(summaries) ? summaries : []).map(function (summary) {
      return normalizeText(summary && summary.userId);
    }).filter(Boolean));
    const participants = Array.isArray(call && call.participants) ? call.participants : [];
    const nextOrder = previousOrder.filter(function (userId) {
      return liveIds.has(userId);
    });
    participants.forEach(function (participant) {
      const userId = normalizeText((participant || {}).user_id);
      if (!userId || !liveIds.has(userId) || nextOrder.indexOf(userId) !== -1) return;
      nextOrder.push(userId);
    });
    (Array.isArray(summaries) ? summaries : []).forEach(function (summary) {
      const userId = normalizeText(summary && summary.userId);
      if (!userId || nextOrder.indexOf(userId) !== -1) return;
      nextOrder.push(userId);
    });
    if (targetRoomId > 0) {
      if (nextOrder.length) {
        state.call.participantOrderByRoomId[targetRoomId] = nextOrder.slice();
      } else {
        delete state.call.participantOrderByRoomId[targetRoomId];
      }
    }
    const orderMap = {};
    nextOrder.forEach(function (userId, index) {
      orderMap[userId] = index;
    });
    return (Array.isArray(summaries) ? summaries.slice() : []).sort(function (a, b) {
      const orderA = Object.prototype.hasOwnProperty.call(orderMap, normalizeText(a && a.userId))
        ? Number(orderMap[normalizeText(a && a.userId)])
        : Number.MAX_SAFE_INTEGER;
      const orderB = Object.prototype.hasOwnProperty.call(orderMap, normalizeText(b && b.userId))
        ? Number(orderMap[normalizeText(b && b.userId)])
        : Number.MAX_SAFE_INTEGER;
      return orderA - orderB
        || Number(!!b.isLocal) - Number(!!a.isLocal)
        || normalizeText((a && a.displayName) || "").localeCompare(normalizeText((b && b.displayName) || ""), "ko");
    });
  }

  function toggleAscordSettingsSidebar() {
    if (state.viewMode !== "ascord") {
      setSidebarMode("settings");
      return;
    }
    setSidebarMode(state.sidebarMode === "settings" ? "rooms" : "settings");
  }

  function ensureAscordUiAudioContext() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (!state.call.uiAudioContext) {
      try {
        state.call.uiAudioContext = new AudioContextCtor();
      } catch (_) {
        state.call.uiAudioContext = null;
      }
    }
    const context = state.call.uiAudioContext;
    if (context && context.state === "suspended" && typeof context.resume === "function") {
      context.resume().catch(function () {});
    }
    return context || null;
  }

  function shouldPlayAscordSound(room) {
    return !!(room && isAscordRoom(room));
  }

  function playAscordSound(effectName, room) {
    if (!shouldPlayAscordSound(room)) return;
    const src = ASCORD_SOUND_PATHS[normalizeText(effectName)];
    if (!src || typeof Audio !== "function") return;
    ensureAscordUiAudioContext();
    try {
      const audio = new Audio(src);
      audio.preload = "auto";
      audio.volume = 1;
      audio.play().catch(function () {});
    } catch (_) {}
  }

  function playAscordJoinSound(room) {
    playAscordSound("join", room);
  }

  function playAscordOutSound(room) {
    playAscordSound("out", room);
  }

  function playAscordMuteSound(room) {
    playAscordSound("mute", room);
  }

  function playAscordUnmuteSound(room) {
    playAscordSound("unmute", room);
  }

  function playAscordStreamStartSound(room) {
    playAscordSound("streamStart", room);
  }

  function playAscordStreamStopSound(room) {
    playAscordSound("streamStop", room);
  }

  function workspaceInviteLink(room) {
    const targetRoom = room || currentAscordWorkspaceRoom();
    const roomId = Number((targetRoom && targetRoom.id) || 0);
    if (roomId <= 0) return window.location.origin + "/messenger";
    return window.location.origin + "/message?open_messenger=1&messenger_room_id=" + roomId;
  }

  function callElapsedText(startedAt) {
    const started = Number(startedAt || 0);
    if (!Number.isFinite(started) || started <= 0) return "00:00";
    const elapsedSec = Math.max(0, Math.floor(Date.now() / 1000 - started));
    const hours = Math.floor(elapsedSec / 3600);
    const minutes = Math.floor((elapsedSec % 3600) / 60);
    const seconds = elapsedSec % 60;
    if (hours > 0) {
      return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
    }
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function updateCallElapsedNodes(scope) {
    const root = scope || document;
    if (!root || typeof root.querySelectorAll !== "function") return;
    Array.prototype.forEach.call(root.querySelectorAll("[data-call-elapsed-started-at]"), function (node) {
      node.textContent = callElapsedText(node.getAttribute("data-call-elapsed-started-at"));
    });
  }

  function ensureUiTicker() {
    if (state.uiTicker) return;
    state.uiTicker = window.setInterval(function () {
      if (!state.isOpen || document.hidden) return;
      updateCallElapsedNodes(document);
    }, 1000);
  }

  function roomVoiceIcon(room) {
    const targetRoom = room || {};
    if (targetRoom.is_direct) return "bi-person-square";
    if (roomChannelMode(targetRoom) === "stage") return "bi-broadcast-pin";
    return "bi-volume-up-fill";
  }

  function ascordRoomState(room) {
    const targetRoom = room || {};
    const roomCall = callForRoom(targetRoom.id);
    const participantCount = callParticipantCount(roomCall, targetRoom.id);
    const joinedHere = Number(state.call.joinedRoomId || 0) === Number(targetRoom.id || 0) && !!currentLiveRoom();
    return {
      roomCall: roomCall,
      participantCount: participantCount,
      joinedHere: joinedHere,
      live: joinedHere || participantCount > 0,
    };
  }

  function sortAscordRooms(rooms) {
    return (Array.isArray(rooms) ? rooms.slice() : []).sort(function (a, b) {
      const stateA = ascordRoomState(a);
      const stateB = ascordRoomState(b);
      return Number(stateB.joinedHere) - Number(stateA.joinedHere)
        || Number(stateB.live) - Number(stateA.live)
        || roomSortScore(b) - roomSortScore(a)
        || Number(b.id || 0) - Number(a.id || 0);
    });
  }

  function ascordLiveRooms(rooms) {
    return sortAscordRooms((Array.isArray(rooms) ? rooms : filteredRooms()).filter(function (room) {
      return ascordRoomState(room).live;
    }));
  }

  function liveCallAlertKey(roomCall) {
    const payload = roomCall || null;
    const roomId = Number((payload && payload.room_id) || 0);
    if (roomId <= 0 || Number((payload && payload.participant_count) || 0) <= 0) return "";
    const callId = normalizeText(payload && payload.call_id);
    if (callId) return callId;
    return "room-" + roomId + "-" + Number((payload && payload.updated_at) || (payload && payload.started_at) || 0);
  }

  function markLiveRoomSeen(roomId, roomCall) {
    const targetRoomId = Number(roomId || (roomCall && roomCall.room_id) || 0);
    if (targetRoomId <= 0) return;
    const nextKey = liveCallAlertKey(roomCall || callForRoom(targetRoomId));
    if (!nextKey) {
      delete state.call.seenLiveCallIdsByRoomId[targetRoomId];
      return;
    }
    state.call.seenLiveCallIdsByRoomId[targetRoomId] = nextKey;
  }

  function unseenAscordLiveRoomCount(rooms) {
    return ascordLiveRooms(rooms).filter(function (room) {
      const roomId = Number((room && room.id) || 0);
      const roomCall = callForRoom(roomId);
      const nextKey = liveCallAlertKey(roomCall);
      if (!nextKey) return false;
      return normalizeText(state.call.seenLiveCallIdsByRoomId[roomId]) !== nextKey;
    }).length;
  }

  function roomPendingStageRequestCount(room) {
    const roomCall = callForRoom(room && room.id);
    if (!roomCall) return 0;
    const explicitCount = Math.max(0, Number(roomCall.speaker_request_count || 0));
    if (explicitCount > 0) return explicitCount;
    return Array.isArray(roomCall.participants) ? roomCall.participants.filter(function (participant) {
      return !!(participant && participant.speaker_requested);
    }).length : 0;
  }

  function roomHasPendingStageRequests(room) {
    const targetRoom = room || {};
    if (!isStageRoom(targetRoom)) return false;
    return roomPendingStageRequestCount(targetRoom) > 0;
  }

  function ascordPendingStageRooms(rooms) {
    return sortAscordRooms((Array.isArray(rooms) ? rooms : filteredRooms()).filter(roomHasPendingStageRequests));
  }

  function ascordPendingStageRequestCount(rooms) {
    return (Array.isArray(rooms) ? rooms : filteredRooms()).reduce(function (sum, room) {
      if (!roomHasPendingStageRequests(room)) return sum;
      return sum + roomPendingStageRequestCount(room);
    }, 0);
  }

  function ascordRecentRooms() {
    const roomMap = {};
    const visibleRoomIds = new Set(filteredRooms().map(function (room) {
      return Number(room.id || 0);
    }));
    state.rooms.forEach(function (room) {
      roomMap[Number(room.id || 0)] = room;
    });
    return (state.roomHistory || []).map(function (roomId) {
      return roomMap[Number(roomId || 0)] || null;
    }).filter(function (room) {
      return !!room && visibleRoomIds.has(Number(room.id || 0));
    });
  }

  function renderAscordUtilityRoomList(rooms, emptyIcon, emptyTitle, emptyCopy, options) {
    if (!dom.roomList) return;
    const items = Array.isArray(rooms) ? rooms : [];
    const settings = options || {};
    const sections = [];
    if (settings.introTitle || settings.introCopy) {
      sections.push([
        '<section class="messenger-side-card messenger-side-card--ascord-hero">',
        settings.introTitle ? ('<strong>' + escapeHtml(settings.introTitle) + '</strong>') : "",
        settings.introCopy ? ('<span>' + escapeHtml(settings.introCopy) + '</span>') : "",
        settings.introActionsHtml ? ('<div class="messenger-side-card--actions">' + settings.introActionsHtml + "</div>") : "",
        "</section>",
      ].join(""));
    }
    if (!items.length) {
      sections.push([
        '<div class="messenger-empty-state">',
        '<i class="bi ' + escapeAttribute(emptyIcon || "bi-broadcast") + '"></i>',
        "<strong>" + escapeHtml(emptyTitle) + "</strong>",
        "<span>" + escapeHtml(emptyCopy) + "</span>",
        "</div>",
      ].join(""));
      dom.roomList.innerHTML = sections.join("");
      return;
    }
    sections.push(items.map(ascordRoomCardMarkup).join(""));
    dom.roomList.innerHTML = sections.join("");
  }

  function ascordRoomParticipantsPreviewMarkup(room) {
    const targetRoom = room || {};
    const roomCall = callForRoom(targetRoom.id);
    const summaries = currentCallParticipantSummaries(targetRoom, roomCall).slice(0, 8);
    if (!summaries.length) return "";
    return [
      '<div class="messenger-voice-room-card__members">',
      summaries.map(function (summary) {
        const avatar = summary.profileImageUrl
          ? '<img src="' + escapeAttribute(summary.profileImageUrl) + '" alt="' + escapeAttribute(summary.displayName || summary.userId || "참여자") + '">'
          : escapeHtml(summary.avatarInitial || avatarInitialFor(summary.displayName, summary.userId || "U"));
        return [
          '<button class="messenger-voice-room-card__member' + (summary.isSpeaking ? ' is-speaking' : '') + '" type="button" data-room-participant-user-id="' + escapeAttribute(summary.userId || "") + '">',
          '<span class="messenger-voice-room-card__member-avatar">' + avatar + '</span>',
          '<span class="messenger-voice-room-card__member-meta">',
          '<strong>' + escapeHtml(summary.displayName || summary.userId || "참여자") + "</strong>",
          '<span>' + escapeHtml(summary.statusText || (summary.audioEnabled ? "음성 연결됨" : "대기 중")) + "</span>",
          "</span>",
          '<span class="messenger-voice-room-card__member-icons">',
          summary.videoEnabled ? '<i class="bi bi-camera-video-fill"></i>' : "",
          summary.sharingScreen ? '<i class="bi bi-display-fill"></i>' : "",
          "</span>",
          "</button>",
        ].join("");
      }).join(""),
      "</div>",
    ].join("");
  }

  function ascordSidebarShortcutMarkup(action, icon, label) {
    return [
      '<button class="messenger-ascord-sidebar-shortcut" type="button" data-ascord-sidebar-action="' + escapeAttribute(action) + '">',
      '<span class="messenger-ascord-sidebar-shortcut__icon"><i class="bi ' + escapeAttribute(icon) + '"></i></span>',
      '<span class="messenger-ascord-sidebar-shortcut__label">' + escapeHtml(label) + "</span>",
      "</button>",
    ].join("");
  }

  function ascordTextChannelRowMarkup(room) {
    const targetRoom = room || {};
    const activeClass = Number(targetRoom.id || 0) === Number(state.activeRoomId || 0) ? " is-active" : "";
    const unread = Number(targetRoom.unread_count || 0);
    return [
      '<button class="messenger-ascord-channel-row messenger-ascord-channel-row--text' + activeClass + '" type="button" data-room-id="' + Number(targetRoom.id || 0) + '">',
      '<span class="messenger-ascord-channel-row__icon"><i class="bi bi-hash"></i></span>',
      '<span class="messenger-ascord-channel-row__label">' + escapeHtml(targetRoom.title || "채널") + "</span>",
      unread > 0 ? ('<span class="messenger-ascord-channel-row__badge">' + unread + "</span>") : "",
      "</button>",
    ].join("");
  }

  function ascordVoiceParticipantsMarkup(room, roomState) {
    const targetRoom = room || {};
    const voiceState = roomState || ascordRoomState(targetRoom);
    const participants = currentCallParticipantSummaries(targetRoom, voiceState.roomCall);
    if (!participants.length) return "";
    return [
      '<div class="messenger-ascord-channel-members">',
      participants.map(function (summary) {
        const avatar = summary.profileImageUrl
          ? '<img src="' + escapeAttribute(summary.profileImageUrl) + '" alt="' + escapeAttribute(summary.displayName || summary.userId || "참여자") + '">'
          : escapeHtml(summary.avatarInitial || avatarInitialFor(summary.displayName, summary.userId || "U"));
        const rightIcons = [
          (!summary.audioEnabled || summary.serverMuted) ? '<i class="bi bi-mic-mute-fill" title="마이크 음소거"></i>' : "",
          summary.deafened ? '<i class="bi bi-headphones" title="소리 안 듣기"></i>' : "",
          summary.sharingScreen ? '<i class="bi bi-display-fill" title="화면 공유"></i>' : "",
          (summary.videoEnabled && !summary.sharingScreen) ? '<i class="bi bi-camera-video-fill" title="카메라"></i>' : "",
        ].join("");
        return [
          '<button class="messenger-ascord-channel-member' + (summary.isSpeaking ? ' is-speaking' : '') + '" type="button" data-room-participant-user-id="' + escapeAttribute(summary.userId || "") + '">',
          '<span class="messenger-ascord-channel-member__avatar">' + avatar + "</span>",
          '<span class="messenger-ascord-channel-member__label">' + escapeHtml(summary.displayName || summary.userId || "참여자") + "</span>",
          '<span class="messenger-ascord-channel-member__media">' + rightIcons + "</span>",
          "</button>",
        ].join("");
      }).join(""),
      "</div>",
    ].join("");
  }

  function ascordVoiceChannelRowMarkup(room) {
    const targetRoom = room || {};
    const roomState = ascordRoomState(targetRoom);
    const roomCall = roomState.roomCall;
    const activeClass = Number(targetRoom.id || 0) === Number(state.activeRoomId || 0) ? " is-active" : "";
    const joinedClass = roomState.joinedHere ? " is-joined" : "";
    const liveClass = roomState.live ? " is-live" : "";
    const canReorder = isAscordVoiceReorderAllowed();
    const joinedElsewhere = Number(state.call.joinedRoomId || 0) > 0 && !roomState.joinedHere;
    const elapsedText = roomCall && roomState.live ? callElapsedText(roomCall.started_at) : "";
    const rightMeta = elapsedText
      ? ('<span data-call-elapsed-started-at="' + escapeAttribute(roomCall && roomCall.started_at) + '">' + escapeHtml(elapsedText) + "</span>")
      : ((roomState.participantCount > 0 ? String(roomState.participantCount) : "") || "");
    const statusButton = roomState.joinedHere
      ? [
          '<button class="messenger-ascord-channel-row__status" type="button" data-ascord-sidebar-action="channel-status" data-ascord-room-id="' + Number(targetRoom.id || 0) + '">',
          '<span>채널 상태 설정</span>',
          '<i class="bi bi-pencil-fill"></i>',
          "</button>",
        ].join("")
      : "";
    const inviteButton = roomState.joinedHere
      ? [
          '<div class="messenger-ascord-channel-subaction-wrap" data-ascord-voice-invite-wrap data-ascord-voice-invite-room-id="' + Number(targetRoom.id || 0) + '">',
          '<button class="messenger-ascord-channel-subaction" type="button" data-ascord-sidebar-action="voice-invite" data-ascord-room-id="' + Number(targetRoom.id || 0) + '">',
          '<span class="messenger-ascord-channel-subaction__icon"><i class="bi bi-person-plus-fill"></i></span>',
          '<span class="messenger-ascord-channel-subaction__label">음성으로 초대하기</span>',
          '<i class="bi bi-chevron-right"></i>',
          "</button>",
          '<div class="messenger-ascord-voice-invite-menu" data-ascord-voice-invite-menu></div>',
          "</div>",
        ].join("")
      : "";
    const showChildren = roomState.live || roomState.joinedHere || (Number(state.activeRoomId || 0) === Number(targetRoom.id || 0) && roomState.participantCount > 0);
    return [
      '<div class="messenger-ascord-channel-wrap' + activeClass + joinedClass + liveClass + (showChildren ? ' is-expanded' : '') + (canReorder ? ' is-reorderable' : '') + '" data-ascord-voice-room-id="' + Number(targetRoom.id || 0) + '"' + (canReorder ? ' draggable="true"' : '') + '>',
      '<div class="messenger-ascord-channel-row messenger-ascord-channel-row--voice' + activeClass + joinedClass + liveClass + '">',
      '<button class="messenger-ascord-channel-row__main" type="button" data-room-id="' + Number(targetRoom.id || 0) + '">',
      '<span class="messenger-ascord-channel-row__icon"><i class="bi ' + escapeAttribute(roomVoiceIcon(targetRoom)) + '"></i></span>',
      '<span class="messenger-ascord-channel-row__label">' + escapeHtml(targetRoom.title || "음성 채널") + "</span>",
      rightMeta ? ('<span class="messenger-ascord-channel-row__meta">' + rightMeta + "</span>") : "",
      roomState.joinedHere ? '<span class="messenger-ascord-channel-row__indicator"><i class="bi bi-soundwave"></i></span>' : "",
      "</button>",
      (!roomState.joinedHere && !joinedElsewhere)
        ? ('<button class="messenger-ascord-channel-row__join" type="button" data-ascord-join-room-id="' + Number(targetRoom.id || 0) + '" aria-label="음성 입장"><i class="bi bi-volume-up-fill"></i></button>')
        : "",
      "</div>",
      showChildren ? ('<div class="messenger-ascord-channel-children">' + statusButton + inviteButton + ascordVoiceParticipantsMarkup(targetRoom, roomState) + "</div>") : "",
      "</div>",
    ].join("");
  }

  function renderAscordChannelSection(title, type, rooms) {
    const items = Array.isArray(rooms) ? rooms : [];
    if (!items.length) return "";
    const createKey = type === "text" ? "text" : "voice";
    const itemMarkup = type === "text" ? ascordTextChannelRowMarkup : ascordVoiceChannelRowMarkup;
    return [
      '<section class="messenger-ascord-channel-section">',
      '<div class="messenger-ascord-channel-section__head">',
      '<span>' + escapeHtml(title) + "</span>",
      '<button type="button" data-ascord-create-section="' + escapeAttribute(createKey) + '" aria-label="채널 만들기"><i class="bi bi-plus-lg"></i></button>',
      "</div>",
      '<div class="messenger-ascord-channel-section__body">',
      items.map(itemMarkup).join(""),
      "</div>",
      "</section>",
    ].join("");
  }

  function ascordRoomCardMarkup(room) {
    const targetRoom = room || {};
    const roomState = ascordRoomState(targetRoom);
    const activeClass = Number(targetRoom.id || 0) === Number(state.activeRoomId || 0) ? " is-active" : "";
    const joinedClass = roomState.joinedHere ? " is-joined" : "";
    const liveClass = roomState.live ? " is-live" : "";
    const joiningHere = !!state.call.joining && Number(state.activeRoomId || 0) === Number(targetRoom.id || 0);
    const modeLabel = ascordModeLabel(targetRoom);
    const privacyLabel = ascordPrivacyLabel(targetRoom);
    const subtitle = normalizeText(targetRoom.topic || targetRoom.subtitle || (roomState.live ? "통화 진행 중" : "음성 채널 대기 중"));
    const participantText = roomState.participantCount > 0
      ? String(roomState.participantCount) + "명 연결"
      : "아직 연결된 참여자 없음";
    const stageRequestCount = roomPendingStageRequestCount(targetRoom);
    const stageRequestText = isStageRoom(targetRoom) && stageRequestCount > 0
      ? (" · 요청 " + String(stageRequestCount) + "건")
      : "";
    const joinLabel = roomState.joinedHere ? "참여 중" : (joiningHere ? "연결 중" : "음성 입장");
    return [
      '<article class="messenger-voice-room-card' + activeClass + joinedClass + liveClass + '">',
      '<button class="messenger-voice-room-card__main" type="button" data-room-id="' + Number(targetRoom.id || 0) + '">',
      '<span class="messenger-voice-room-card__icon"><i class="bi ' + escapeAttribute(roomVoiceIcon(targetRoom)) + '"></i></span>',
      '<span class="messenger-voice-room-card__content">',
      '<span class="messenger-voice-room-card__title-line">',
      '<strong>' + escapeHtml(targetRoom.title || "채널") + "</strong>",
      '<span class="messenger-voice-room-card__badge">' + escapeHtml(modeLabel) + "</span>",
      "</span>",
      '<span class="messenger-voice-room-card__subtitle">' + escapeHtml(subtitle) + "</span>",
      '<span class="messenger-voice-room-card__meta">' + escapeHtml(privacyLabel + " · " + participantText + stageRequestText) + "</span>",
      "</span>",
      "</button>",
      ascordRoomParticipantsPreviewMarkup(targetRoom),
      '<div class="messenger-voice-room-card__actions">',
      '<span class="messenger-voice-room-card__aside">' + (roomState.joinedHere ? "연결됨" : (joiningHere ? "연결 중" : (roomState.live ? "참여 가능" : "대기 중"))) + "</span>",
      '<button class="messenger-voice-room-card__join" type="button" data-ascord-join-room-id="' + Number(targetRoom.id || 0) + '"' + ((roomState.joinedHere || state.call.joining) ? ' disabled' : "") + '><i class="bi bi-telephone-fill"></i><span>' + escapeHtml(joinLabel) + "</span></button>",
      "</div>",
      "</article>",
    ].join("");
  }

  function renderAscordRoomList() {
    if (!dom.roomList) return;
    const rooms = filteredRooms();
    if (!rooms.length) {
      dom.roomList.innerHTML = [
        '<div class="messenger-empty-state">',
        '<i class="bi bi-broadcast-pin"></i>',
        "<strong>표시할 ASCORD 채널이 없습니다.</strong>",
        "<span>검색 조건을 바꾸거나 새 ASCORD 채널을 만들어보세요.</span>",
        "</div>",
      ].join("");
      return;
    }
    const textRooms = sortAscordRooms(rooms.filter(function (room) {
      return !roomSupportsCalls(room);
    }));
    const voiceRooms = stableAscordVoiceRooms(rooms.filter(function (room) {
      return roomSupportsCalls(room);
    }));

    dom.roomList.innerHTML = [
      '<div class="messenger-ascord-sidebar-list">',
      '<div class="messenger-ascord-sidebar-shortcuts">',
      ascordSidebarShortcutMarkup("meeting-notes", "bi-journal-text", "회의록"),
      "</div>",
      '<div class="messenger-ascord-sidebar-divider"></div>',
      renderAscordChannelSection("채팅 채널", "text", textRooms),
      renderAscordChannelSection("음성 채널", "voice", voiceRooms),
      "</div>",
    ].join("");
  }

  function renderAscordStageRequestList() {
    renderAscordUtilityRoomList(
      ascordPendingStageRooms(filteredRooms()),
      "bi-megaphone",
      "대기 중인 발언 요청이 없습니다.",
      "STAGE 채널에서 청중이 손들면 여기에 요청이 모입니다.",
      {
        introTitle: "발언 요청 큐",
        introCopy: "운영자가 처리할 발표자 요청이 있는 STAGE 채널만 보여줍니다.",
        introActionsHtml: '<button type="button" data-guide-action="focus-search"><i class="bi bi-search"></i><span>채널 검색</span></button>',
      }
    );
  }

  function renderAscordRecentRoomList() {
    renderAscordUtilityRoomList(
      ascordRecentRooms(),
      "bi-clock-history",
      "최근 열어본 ASCORD 채널이 없습니다.",
      "채널에 입장하면 여기에 최근 기록으로 저장됩니다.",
      {
        introTitle: "최근 채널",
        introCopy: "최근에 확인하거나 입장했던 ASCORD 채널을 다시 빠르게 열 수 있습니다.",
      }
    );
  }

  function renderAscordGuideList() {
    if (!dom.roomList) return;
    dom.roomList.innerHTML = [
      '<div class="messenger-side-stack">',
      '<section class="messenger-side-card messenger-side-card--ascord-hero">',
      '<strong>ASCORD 사용 가이드</strong>',
      '<span>VOICE 채널은 일반 음성채널, STAGE 채널은 청중 중심 운영형입니다. 채널 카드를 눌러 먼저 선택하고, 음성 입장 버튼으로 실제 연결을 시작합니다.</span>',
      '<div class="messenger-side-card--actions">',
      '<button type="button" data-guide-action="open-alerts"><i class="bi bi-megaphone"></i><span>발언 요청 보기</span></button>',
      '</div>',
      '</section>',
      '<section class="messenger-side-card">',
      '<strong>VOICE 채널</strong>',
      '<span>일반 음성채널처럼 누구나 입장해서 마이크, 카메라, 화면공유를 사용할 수 있습니다.</span>',
      '</section>',
      '<section class="messenger-side-card">',
      '<strong>STAGE 채널</strong>',
      '<span>청중은 듣기 중심으로 입장하고, 발표자는 발언 요청과 운영자 승격으로 관리할 수 있습니다.</span>',
      '</section>',
      '<section class="messenger-side-card">',
      '<strong>채널 생성 팁</strong>',
      '<span>새 채널을 만들 때 카테고리와 VOICE/STAGE 모드를 먼저 정해두면 ASCORD 목록이 더 깔끔하게 정리됩니다.</span>',
      '</section>',
      '</div>',
    ].join("");
  }

  function renderAscordSettingsList() {
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
      '<strong>ASCORD 로컬 설정</strong>',
      '<span>현재 브라우저에서 음성채널 팝업과 입력 UX에만 적용되는 개인 설정입니다.</span>',
      '</section>',
      '<section class="messenger-side-card messenger-side-card--settings">',
      row("rememberPosition", "팝업 위치 기억", "ASCORD 창을 다시 열어도 마지막 위치를 유지합니다."),
      row("showTyping", "입력 중 표시", "ABBAS Talk와 전환해도 타이핑 표시를 유지합니다."),
      row("enterToSend", "Enter로 전송", "텍스트채팅 입력 시 Enter 전송, Shift+Enter 줄바꿈으로 동작합니다."),
      '</section>',
      '</div>',
    ].join("");
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
    if (isSystemMessage(message)) {
      return '<div class="messenger-system-message__text">' + formatRichText(content) + "</div>";
    }
    const ascordInvite = parseAscordInviteMessage(message);
    if (ascordInvite) {
      const inviteLink = normalizeText(ascordInvite.invite_url);
      const inviteRoomId = Number(ascordInvite.target_room_id || 0);
      const inviteRoomTitle = normalizeText(ascordInvite.target_room_title || "ASCORD 채널");
      const inviteRoomMode = normalizeText(ascordInvite.target_room_mode) === "stage" ? "stage" : "voice";
      const inviteIcon = roomVoiceIcon({ channel_mode: inviteRoomMode });
      const buttonLabel = message.is_mine
        ? "초대 보냄"
        : (state.acceptingAscordInviteMessageIds.has(Number(message.id || 0))
          ? "참가 중..."
          : normalizeText(ascordInvite.button_label || "음성 채널 참가하기"));
      return [
        inviteLink
          ? '<a class="messenger-ascord-invite-link" href="' + escapeAttribute(inviteLink) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(inviteLink) + "</a>"
          : "",
        '<div class="messenger-ascord-invite-card">',
        '<div class="messenger-ascord-invite-card__title">' + escapeHtml(ascordInvite.card_title || "ASCORD 서버에 초대받았어요") + "</div>",
        '<div class="messenger-ascord-invite-card__body">',
        '<div class="messenger-ascord-invite-card__room">',
        '<span class="messenger-ascord-invite-card__avatar">A</span>',
        '<span class="messenger-ascord-invite-card__meta">',
        '<strong><i class="bi ' + escapeAttribute(inviteIcon) + '"></i><span>' + escapeHtml(inviteRoomTitle) + "</span></strong>",
        '<span>' + escapeHtml(normalizeText(ascordInvite.card_detail || ascordInvite.workspace_name || "ASCORD")) + "</span>",
        "</span>",
        "</div>",
        message.is_mine
          ? '<span class="messenger-ascord-invite-card__sent">' + escapeHtml(buttonLabel) + "</span>"
          : '<button class="messenger-ascord-invite-card__action" type="button" data-ascord-invite-accept="' + Number(message.id || 0) + '"' + (state.acceptingAscordInviteMessageIds.has(Number(message.id || 0)) ? " disabled" : "") + ">" + escapeHtml(buttonLabel) + "</button>",
        "</div>",
        inviteRoomId > 0 ? '<input type="hidden" data-ascord-invite-room-id="' + inviteRoomId + '">' : "",
        "</div>",
      ].filter(Boolean).join("");
    }
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

  async function acceptAscordInviteMessage(messageId) {
    const targetMessageId = Number(messageId || 0);
    if (targetMessageId <= 0) return;
    if (state.acceptingAscordInviteMessageIds.has(targetMessageId)) return;
    state.acceptingAscordInviteMessageIds.add(targetMessageId);
    renderMessages();
    try {
      const payload = await api("/api/messenger/messages/" + targetMessageId + "/ascord-invite/accept", {
        method: "POST",
      });
      const roomId = Number((payload && payload.target_room_id) || (payload.room && payload.room.id) || 0);
      await showToast("success", "ASCORD 서버 초대를 수락했습니다.");
      if (roomId > 0) {
        setPopupOpen(true);
        setViewMode("ascord");
        await loadBootstrap(roomId);
        await selectRoom(roomId);
        await startOrJoinCall("audio");
      } else {
        await loadBootstrap(state.activeRoomId);
      }
    } catch (error) {
      await showError((error && error.message) || "ASCORD 서버 초대 수락에 실패했습니다.");
    } finally {
      state.acceptingAscordInviteMessageIds.delete(targetMessageId);
      renderMessages();
    }
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

      if (isSystemMessage(message)) {
        pieces.push([
          '<div class="messenger-system-message-row" data-message-id="' + Number(message.id || 0) + '">',
          '<div class="messenger-system-message">',
          '<span class="messenger-system-message__badge"><i class="bi bi-shield-check"></i><span>' + escapeHtml(message.system_badge_label || "SYSTEM") + '</span></span>',
          '<div class="messenger-system-message__body">' + renderMessageBubbleContent(message) + "</div>",
          '<div class="messenger-system-message__foot"><span>' + escapeHtml(message.time_text || "") + "</span></div>",
          "</div>",
          "</div>",
        ].join(""));
        return pieces.join("");
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
    Array.prototype.forEach.call(dom.messageList.querySelectorAll("[data-ascord-invite-accept]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        if (button.disabled) return;
        acceptAscordInviteMessage(Number(button.getAttribute("data-ascord-invite-accept") || 0)).catch(function (error) {
          showError((error && error.message) || "ASCORD 초대 수락에 실패했습니다.");
        });
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

  function callDeviceLabel(kind, device, index) {
    const payload = device || {};
    const fallbackIndex = Number(index || 0) + 1;
    if (normalizeText(payload.label)) return normalizeText(payload.label);
    if (kind === "audioinput") return "마이크 " + fallbackIndex;
    if (kind === "audiooutput") return "스피커 " + fallbackIndex;
    if (kind === "videoinput") return "카메라 " + fallbackIndex;
    return "장치 " + fallbackIndex;
  }

  function renderCallDeviceControl(kind, label, icon) {
    const selectedValue = normalizeText((state.call.selectedDevices || {})[kind]);
    const devices = (state.call.devices && state.call.devices[kind]) || [];
    const isAudioOutput = kind === "audiooutput";
    const disabled = isAudioOutput && !state.call.audioOutputSupported;
    const options = devices.length
      ? devices.map(function (device, index) {
        const deviceId = normalizeText(device.deviceId);
        const selected = selectedValue && selectedValue === deviceId ? ' selected' : '';
        return '<option value="' + escapeAttribute(deviceId) + '"' + selected + '>' + escapeHtml(callDeviceLabel(kind, device, index)) + "</option>";
      }).join("")
      : '<option value="">장치를 찾지 못했습니다.</option>';
    return [
      '<label class="messenger-device-control">',
      '<span class="messenger-device-control__label"><i class="bi ' + escapeAttribute(icon) + '"></i><span>' + escapeHtml(label) + "</span></span>",
      '<select data-call-device-kind="' + escapeAttribute(kind) + '"' + (disabled ? " disabled" : "") + ">" + options + "</select>",
      "</label>",
    ].join("");
  }

  function callJoinDeviceSelectId(kind) {
    return "swalMessengerJoinDevice_" + normalizeText(kind);
  }

  function renderCallJoinDeviceControl(kind, label, icon, options) {
    const settings = options || {};
    const devices = Array.isArray(settings.devices) ? settings.devices : [];
    const selectedValue = normalizeText(settings.selectedValue);
    const disabled = !!settings.disabled;
    const fieldId = callJoinDeviceSelectId(kind);
    const optionsMarkup = devices.length
      ? devices.map(function (device, index) {
        const deviceId = normalizeText((device || {}).deviceId);
        const isSelected = selectedValue && selectedValue === deviceId;
        return '<option value="' + escapeAttribute(deviceId) + '"' + (isSelected ? " selected" : "") + '>' + escapeHtml(callDeviceLabel(kind, device, index)) + "</option>";
      }).join("")
      : '<option value="">' + escapeHtml(settings.emptyLabel || "장치를 찾지 못했습니다.") + "</option>";
    return [
      '<label class="messenger-device-control" for="' + escapeAttribute(fieldId) + '">',
      '<span class="messenger-device-control__label"><i class="bi ' + escapeAttribute(icon) + '"></i><span>' + escapeHtml(label) + "</span></span>",
      '<select id="' + escapeAttribute(fieldId) + '"' + (disabled ? " disabled" : "") + ">" + optionsMarkup + "</select>",
      "</label>",
    ].join("");
  }

  function callJoinDeviceStatus(room, mode) {
    const targetRoom = room || state.activeRoom;
    const requestedMode = normalizeText(mode).toLowerCase() === "video" ? "video" : "audio";
    const devices = state.call.devices || {};
    const audioInputs = Array.isArray(devices.audioinput) ? devices.audioinput.slice() : [];
    const audioOutputs = Array.isArray(devices.audiooutput) ? devices.audiooutput.slice() : [];
    const wantsMic = !!targetRoom && canSpeakInCall(targetRoom) && !state.call.deafened && !!state.call.requestedAudioEnabled;
    return {
      requestedMode: requestedMode,
      wantsMic: wantsMic,
      audioInputMissing: wantsMic && !audioInputs.length,
      audioOutputMissing: !!state.call.audioOutputSupported && !audioOutputs.length,
      audioInputs: audioInputs,
      audioOutputs: audioOutputs,
      audioOutputSupported: !!state.call.audioOutputSupported,
    };
  }

  function renderCallJoinDeviceModalBody(status) {
    const targetStatus = status || {};
    const introParts = [];
    if (targetStatus.audioInputMissing) {
      introParts.push("마이크를 찾지 못했습니다. 그래도 참가를 누르면 듣기 전용으로 연결할 수 있습니다.");
    }
    if (targetStatus.audioOutputMissing) {
      introParts.push("스피커 또는 헤드셋을 찾지 못했습니다. 장치를 연결한 뒤 새로고침으로 다시 확인할 수 있습니다.");
    }
    if (!introParts.length) {
      introParts.push("현재 감지된 오디오 장치를 확인한 뒤 참가할 수 있습니다.");
    }
    const outputHelp = targetStatus.audioOutputSupported
      ? "출력 장치를 선택하면 연결 후 바로 해당 장치로 재생을 시도합니다."
      : "이 브라우저는 출력 장치 직접 전환을 제한해 시스템 기본 출력이 사용될 수 있습니다.";
    return [
      '<div class="messenger-device-stack">',
      '<div class="messenger-device-hint">',
      "<strong>장치 확인</strong>",
      '<span>' + escapeHtml(introParts.join(" ")) + "</span>",
      "</div>",
      renderCallJoinDeviceControl("audioinput", "마이크", "bi-mic", {
        devices: targetStatus.audioInputs,
        selectedValue: normalizeText((state.call.selectedDevices || {}).audioinput),
        emptyLabel: targetStatus.wantsMic
          ? "입력 장치를 찾지 못했습니다. 듣기 전용으로 참가할 수 있습니다."
          : "이 채널에서는 마이크 송출이 필요하지 않습니다.",
      }),
      renderCallJoinDeviceControl("audiooutput", "스피커 / 헤드셋", "bi-volume-up", {
        devices: targetStatus.audioOutputs,
        selectedValue: normalizeText((state.call.selectedDevices || {}).audiooutput),
        disabled: !targetStatus.audioOutputSupported,
        emptyLabel: targetStatus.audioOutputSupported
          ? "출력 장치를 찾지 못했습니다."
          : "브라우저 기본 출력이 사용됩니다.",
      }),
      '<div class="messenger-device-actions">',
      '<button type="button" class="btn btn-outline-secondary" data-call-join-device-refresh><i class="bi bi-arrow-repeat"></i><span>장치 새로고침</span></button>',
      "</div>",
      '<div class="messenger-device-hint">',
      "<strong>참가 안내</strong>",
      '<span>' + escapeHtml(outputHelp) + "</span>",
      "</div>",
      "</div>",
    ].join("");
  }

  async function ensureCallJoinDeviceSelection(room, mode) {
    const targetRoom = room || state.activeRoom;
    const requestedMode = normalizeText(mode).toLowerCase() === "video" ? "video" : "audio";
    await refreshCallDevices().catch(function () {});
    let status = callJoinDeviceStatus(targetRoom, requestedMode);
    if (!status.audioInputMissing && !status.audioOutputMissing) {
      return {
        enableMicrophone: !!status.wantsMic,
        warning: "",
      };
    }
    if (!hasSwal()) {
      return {
        enableMicrophone: !!status.wantsMic && !status.audioInputMissing,
        warning: status.audioInputMissing ? "마이크가 없어 듣기 전용으로 참가합니다." : "",
      };
    }

    const bodyId = "swalMessengerJoinDeviceBody";
    const result = await fireDialog({
      title: "오디오 장치 확인",
      width: "38rem",
      html: '<div class="app-swal-form"><div id="' + bodyId + '">' + renderCallJoinDeviceModalBody(status) + "</div></div>",
      showCancelButton: true,
      confirmButtonText: "참가",
      cancelButtonText: "취소",
      focusConfirm: false,
      didOpen: function () {
        const root = document.getElementById(bodyId);
        if (!root) return;
        root.addEventListener("click", function (event) {
          const button = event.target instanceof Element ? event.target.closest("[data-call-join-device-refresh]") : null;
          if (!button) return;
          event.preventDefault();
          button.setAttribute("disabled", "disabled");
          refreshCallDevices().then(function () {
            status = callJoinDeviceStatus(targetRoom, requestedMode);
            root.innerHTML = renderCallJoinDeviceModalBody(status);
          }).catch(function () {
            showWarning("장치 목록을 새로 가져오지 못했습니다.");
          }).finally(function () {
            button.removeAttribute("disabled");
          });
        });
      },
      preConfirm: function () {
        const audioInputSelect = document.getElementById(callJoinDeviceSelectId("audioinput"));
        const audioOutputSelect = document.getElementById(callJoinDeviceSelectId("audiooutput"));
        state.call.selectedDevices.audioinput = normalizeText(audioInputSelect && !audioInputSelect.disabled ? audioInputSelect.value : "");
        state.call.selectedDevices.audiooutput = normalizeText(audioOutputSelect && !audioOutputSelect.disabled ? audioOutputSelect.value : "");
        persistCallPreferences();
        status = callJoinDeviceStatus(targetRoom, requestedMode);
        return {
          enableMicrophone: !!status.wantsMic && !status.audioInputMissing,
          warning: status.audioInputMissing ? "마이크가 없어 듣기 전용으로 참가합니다." : "",
        };
      },
    });
    return result && result.isConfirmed ? (result.value || null) : null;
  }

  function renderAscordParticipantCard(summary) {
    const payload = summary || {};
    const avatar = payload.profileImageUrl
      ? '<img src="' + escapeAttribute(payload.profileImageUrl) + '" alt="' + escapeAttribute(payload.displayName || payload.userId || "참여자") + '">'
      : escapeHtml(payload.avatarInitial || avatarInitialFor(payload.displayName, payload.userId));
    const isStage = !!payload.isStage;
    const stageRole = normalizeStageRole(payload.stageRole);
    const speakerRequested = !!payload.speakerRequested;
    const secondaryText = [normalizeText(payload.department), normalizeText(payload.statusText)].filter(function (value, index, items) {
      return !!value && items.indexOf(value) === index;
    }).join(" · ") || "대기 중";
    const liveBadges = [];
    if (payload.isLocal) liveBadges.push('<span class="messenger-voice-member__chip">LOCAL</span>');
    if (isStage && stageRole === "speaker") liveBadges.push('<span class="messenger-voice-member__chip is-on">SPEAKER</span>');
    if (isStage && stageRole !== "speaker") liveBadges.push('<span class="messenger-voice-member__chip">AUDIENCE</span>');
    if (isStage && speakerRequested) liveBadges.push('<span class="messenger-voice-member__chip is-speaking">HAND RAISED</span>');
    if (payload.isSpeaking) liveBadges.push('<span class="messenger-voice-member__chip is-speaking">SPEAKING</span>');
    if (payload.serverMuted) liveBadges.push('<span class="messenger-voice-member__chip is-admin">SERVER MUTE</span>');
    if (payload.audioEnabled) liveBadges.push('<span class="messenger-voice-member__chip is-on">MIC</span>');
    if (payload.videoEnabled) liveBadges.push('<span class="messenger-voice-member__chip is-on">CAM</span>');
    if (payload.sharingScreen) liveBadges.push('<span class="messenger-voice-member__chip is-screen">SCREEN</span>');
    const volumeKey = normalizeText(payload.volumeKey || payload.identity || payload.userId);
    const volumeValue = Math.round(participantVolume(volumeKey) * 100);
    const canModerate = canModerateCall(state.activeRoom) && !payload.isLocal;
    const canPromoteToAdmin = canChangeTargetMemberRole(state.activeRoom, payload.userId, "admin");
    const canDemoteToMember = canChangeTargetMemberRole(state.activeRoom, payload.userId, "member");
    const canRemoveMemberAction = canRemoveTargetMember(state.activeRoom, payload.userId);
    const canTransferOwner = canTransferOwnerToTarget(state.activeRoom, payload.userId);
    const canGrantSpeaker = canModerate && isStage && stageRole !== "speaker";
    const canMoveToAudience = canModerate && isStage && stageRole === "speaker";
    const moderationButtons = canModerate ? [
      '<div class="messenger-voice-member__actions">',
      (canGrantSpeaker ? '<button type="button" data-call-admin-action="grant_speaker" data-call-admin-user-id="' + escapeAttribute(payload.userId || "") + '"><i class="bi bi-megaphone"></i><span>' + escapeHtml(speakerRequested ? "발언 요청 승인" : "발표자로 승격") + '</span></button>' : ""),
      (canMoveToAudience ? '<button type="button" data-call-admin-action="move_to_audience" data-call-admin-user-id="' + escapeAttribute(payload.userId || "") + '"><i class="bi bi-arrow-down-circle"></i><span>청중으로 내리기</span></button>' : ""),
      '<button type="button" data-call-admin-action="' + escapeAttribute(payload.serverMuted ? "server_unmute" : "server_mute") + '" data-call-admin-user-id="' + escapeAttribute(payload.userId || "") + '"><i class="bi ' + escapeAttribute(payload.serverMuted ? "bi-mic" : "bi-mic-mute") + '"></i><span>' + escapeHtml(payload.serverMuted ? "음소거 해제 허용" : "서버 음소거") + '</span></button>',
      (payload.videoEnabled ? '<button type="button" data-call-admin-action="disable_camera" data-call-admin-user-id="' + escapeAttribute(payload.userId || "") + '"><i class="bi bi-camera-video-off"></i><span>카메라 중지</span></button>' : ""),
      (payload.sharingScreen ? '<button type="button" data-call-admin-action="disable_screen_share" data-call-admin-user-id="' + escapeAttribute(payload.userId || "") + '"><i class="bi bi-display"></i><span>화면공유 중지</span></button>' : ""),
      '<button type="button" class="is-danger" data-call-admin-action="disconnect" data-call-admin-user-id="' + escapeAttribute(payload.userId || "") + '"><i class="bi bi-person-x"></i><span>통화 내보내기</span></button>',
      "</div>",
    ].join("") : "";
    const membershipButtons = (canTransferOwner || canPromoteToAdmin || canDemoteToMember || canRemoveMemberAction) ? [
      '<div class="messenger-voice-member__actions">',
      (canTransferOwner ? '<button type="button" data-room-member-transfer-owner="true" data-room-member-user-id="' + escapeAttribute(payload.userId || "") + '"><i class="bi bi-award"></i><span>OWNER 이전</span></button>' : ""),
      (canPromoteToAdmin ? '<button type="button" data-room-member-role="admin" data-room-member-user-id="' + escapeAttribute(payload.userId || "") + '"><i class="bi bi-shield-check"></i><span>ADMIN 지정</span></button>' : ""),
      (canDemoteToMember ? '<button type="button" data-room-member-role="member" data-room-member-user-id="' + escapeAttribute(payload.userId || "") + '"><i class="bi bi-person"></i><span>일반 멤버</span></button>' : ""),
      (canRemoveMemberAction ? '<button type="button" class="is-danger" data-room-member-remove="true" data-room-member-user-id="' + escapeAttribute(payload.userId || "") + '"><i class="bi bi-person-dash"></i><span>채널에서 제거</span></button>' : ""),
      "</div>",
    ].join("") : "";
    return [
      '<div class="messenger-voice-member' + (payload.isSpeaking ? ' is-speaking' : '') + '" data-participant-user-id="' + escapeAttribute(payload.userId || "") + '">',
      '<span class="messenger-contact-avatar messenger-contact-avatar--large">' + avatar + '<span class="messenger-contact-avatar__status is-' + escapeHtml((payload.isSpeaking || payload.audioEnabled || payload.videoEnabled || payload.sharingScreen) ? "online" : "offline") + '"></span></span>',
      '<div class="messenger-voice-member__meta">',
      '<div class="messenger-voice-member__title">',
      '<strong>' + escapeHtml(payload.displayName || payload.userId || "참여자") + "</strong>",
      '<span>' + escapeHtml(secondaryText) + "</span>",
      "</div>",
      '<div class="messenger-voice-member__chips">' + liveBadges.join("") + "</div>",
      (!payload.isLocal ? [
        '<label class="messenger-voice-member__volume">',
        "<span>볼륨</span>",
        '<input type="range" min="0" max="100" step="5" value="' + volumeValue + '" data-call-volume-id="' + escapeAttribute(volumeKey) + '">',
        '<strong>' + volumeValue + "%</strong>",
        "</label>",
      ].join("") : '<div class="messenger-voice-member__volume messenger-voice-member__volume--self"><span>내 장치 설정은 아래에서 조정합니다.</span></div>'),
      moderationButtons,
      membershipButtons,
      "</div>",
      '<span class="messenger-participant-card__badge">' + escapeHtml(payload.memberRole || ascordModeLabel(state.activeRoom)) + "</span>",
      "</div>",
    ].join("");
  }

  function renderAscordRecentCalls(room) {
    const targetRoom = room || {};
    const items = Array.isArray(targetRoom.recent_calls) ? targetRoom.recent_calls.slice(0, 6) : [];
    return [
      '<div class="messenger-ascord-call-history">',
      '<div class="messenger-ascord-call-history__head">',
      "<strong>최근 통화</strong>",
      '<span>' + escapeHtml(Number(targetRoom.missed_call_total || 0) > 0 ? ("부재중 " + Number(targetRoom.missed_call_total || 0) + "건") : "ASCORD LOG") + "</span>",
      "</div>",
      items.length ? items.map(function (item) {
        const status = normalizeText(item && item.status).toLowerCase() || "ended";
        const starterName = normalizeText(item && item.started_by_display_name) || "알 수 없음";
        const modeLabel = normalizeText(item && item.initiated_mode).toLowerCase() === "video" ? "VIDEO" : "VOICE";
        return [
          '<article class="messenger-ascord-call-history__item">',
          '<span class="messenger-ascord-call-history__status is-' + escapeAttribute(status) + '">' + escapeHtml(item.status_label || "통화") + "</span>",
          '<div class="messenger-ascord-call-history__body">',
          "<strong>" + escapeHtml(starterName) + "</strong>",
          "<span>" + escapeHtml(item.summary || "통화 기록") + "</span>",
          "</div>",
          '<div class="messenger-ascord-call-history__meta">',
          "<span>" + escapeHtml(item.time_text || "") + "</span>",
          "<span>" + escapeHtml(modeLabel) + "</span>",
          "</div>",
          "</article>",
        ].join("");
      }).join("") : '<div class="messenger-empty-inline">아직 이 채널의 통화 기록이 없습니다.</div>',
      "</div>",
    ].join("");
  }

  function renderAscordStageControls(room, roomCall, participantSummaries, joinedHere) {
    const targetRoom = room || state.activeRoom;
    if (!isStageRoom(targetRoom)) return "";
    const myParticipant = callParticipant(roomCall, currentUserId());
    const myStageRole = myParticipant ? callParticipantStageRole(myParticipant) : "audience";
    const mySpeakerRequested = callParticipantSpeakerRequested(myParticipant);
    const moderator = canModerateCall(targetRoom);
    const pendingRequests = (participantSummaries || []).filter(function (summary) {
      return !summary.isLocal && !!summary.speakerRequested;
    });
    const overviewText = roomCall
      ? ("발표자 " + String(Number(roomCall.speaker_count || 0)) + "명 · 청중 " + String(Number(roomCall.audience_count || 0)) + "명 · 요청 대기 " + String(Number(roomCall.speaker_request_count || 0)) + "건")
      : "아직 연결된 발표자와 청중이 없습니다.";
    let selfMessage = "이 채널에 입장하면 발언 요청과 발표자 전환을 사용할 수 있습니다.";
    const selfButtons = [];
    if (joinedHere) {
      if (myStageRole === "speaker") {
        selfMessage = "현재 발표자 권한으로 연결되어 있습니다. 필요하면 직접 청중으로 내려갈 수 있습니다.";
        selfButtons.push('<button type="button" data-ascord-action="move_self_to_audience"><i class="bi bi-arrow-down-circle"></i><span>청중으로 이동</span></button>');
      } else if (mySpeakerRequested) {
        selfMessage = "운영자가 발표자 승격을 승인하면 마이크가 다시 열립니다.";
        selfButtons.push('<button type="button" data-ascord-action="withdraw_request"><i class="bi bi-x-circle"></i><span>발언 요청 취소</span></button>');
      } else {
        selfMessage = "현재 청중으로 연결되어 있습니다. 손들기처럼 발언 요청을 보낼 수 있습니다.";
        selfButtons.push('<button type="button" data-ascord-action="request_speaker"><i class="bi bi-broadcast-pin"></i><span>발언 요청</span></button>');
      }
    }
    const requestQueueMarkup = moderator ? [
      '<section class="messenger-side-card">',
      '<strong>발언 요청 대기</strong>',
      '<span>' + escapeHtml(pendingRequests.length ? (String(pendingRequests.length) + "명이 발표 승격을 기다리고 있습니다.") : "현재 대기 중인 발언 요청이 없습니다.") + "</span>",
      pendingRequests.length ? '<div class="messenger-side-card--actions">' + pendingRequests.map(function (summary) {
        return '<button type="button" data-ascord-action="grant_speaker" data-stage-user-id="' + escapeAttribute(summary.userId || "") + '"><i class="bi bi-megaphone"></i><span>' + escapeHtml((summary.displayName || summary.userId || "참여자") + " 승인") + "</span></button>";
      }).join("") + "</div>" : "",
      '</section>',
    ].join("") : "";
    return [
      '<section class="messenger-side-card">',
      '<strong>STAGE 컨트롤</strong>',
      '<span>' + escapeHtml(overviewText) + "</span>",
      '<span>' + escapeHtml(selfMessage) + "</span>",
      selfButtons.length ? '<div class="messenger-side-card--actions">' + selfButtons.join("") + "</div>" : "",
      '</section>',
      requestQueueMarkup,
    ].join("");
  }

  function bindAscordInspectorInteractions() {
    if (dom.resourceList) {
      Array.prototype.forEach.call(dom.resourceList.querySelectorAll("[data-call-device-kind]"), function (select) {
        select.addEventListener("change", function () {
          const kind = normalizeText(select.getAttribute("data-call-device-kind"));
          switchCallDevice(kind, select.value).catch(function (error) {
            showError((error && error.message) || "장치를 전환하지 못했습니다.");
            refreshCallDevices().catch(function () {});
          });
        });
      });
      Array.prototype.forEach.call(dom.resourceList.querySelectorAll("[data-ascord-action]"), function (button) {
        button.addEventListener("click", function () {
          const action = normalizeText(button.getAttribute("data-ascord-action"));
          if (action === "refresh-devices") {
            refreshCallDevices().catch(function () {
              showWarning("장치 목록을 새로 가져오지 못했습니다.");
            });
            return;
          }
          const targetUserId = normalizeText(button.getAttribute("data-stage-user-id"));
          if (action === "request_speaker" || action === "withdraw_request" || action === "move_self_to_audience") {
            sendStageRequestAction(action, state.activeRoom).catch(function (error) {
              showError((error && error.message) || "STAGE 요청을 처리하지 못했습니다.");
            });
            return;
          }
          if ((action === "grant_speaker" || action === "move_to_audience") && targetUserId) {
            sendCallModerationAction(action, targetUserId, state.activeRoom).catch(function (error) {
              showError((error && error.message) || "STAGE 운영 작업을 적용하지 못했습니다.");
            });
          }
        });
      });
    }
    if (dom.participantList) {
      Array.prototype.forEach.call(dom.participantList.querySelectorAll("[data-call-volume-id]"), function (input) {
        input.addEventListener("input", function () {
          const identity = normalizeText(input.getAttribute("data-call-volume-id"));
          setParticipantVolume(identity, Number(input.value || 100) / 100);
        });
      });
      Array.prototype.forEach.call(dom.participantList.querySelectorAll("[data-call-admin-action]"), function (button) {
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          const action = normalizeText(button.getAttribute("data-call-admin-action")).toLowerCase();
          const userId = normalizeText(button.getAttribute("data-call-admin-user-id"));
          sendCallModerationAction(action, userId, state.activeRoom).catch(function (error) {
            showError((error && error.message) || "통화 운영 작업을 적용하지 못했습니다.");
          });
        });
      });
      Array.prototype.forEach.call(dom.participantList.querySelectorAll("[data-room-member-role]"), function (button) {
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          const nextRole = normalizeText(button.getAttribute("data-room-member-role")).toLowerCase();
          const userId = normalizeText(button.getAttribute("data-room-member-user-id"));
          updateRoomMemberRole(userId, nextRole, state.activeRoom).catch(function (error) {
            showError((error && error.message) || "멤버 역할을 변경하지 못했습니다.");
          });
        });
      });
      Array.prototype.forEach.call(dom.participantList.querySelectorAll("[data-room-member-remove]"), function (button) {
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          const userId = normalizeText(button.getAttribute("data-room-member-user-id"));
          removeMemberFromRoom(userId, state.activeRoom).catch(function (error) {
            showError((error && error.message) || "구성원을 제거하지 못했습니다.");
          });
        });
      });
      Array.prototype.forEach.call(dom.participantList.querySelectorAll("[data-room-member-transfer-owner]"), function (button) {
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          const userId = normalizeText(button.getAttribute("data-room-member-user-id"));
          transferRoomOwner(userId, state.activeRoom).catch(function (error) {
            showError((error && error.message) || "OWNER를 이전하지 못했습니다.");
          });
        });
      });
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
    const isAscord = state.viewMode === "ascord";
    if (!room) {
      dom.roomInfo.innerHTML = '<div class="messenger-empty-inline">대화방을 선택하면 상세 정보가 표시됩니다.</div>';
      dom.participantList.innerHTML = '<div class="messenger-empty-inline">참여자 목록이 여기에 표시됩니다.</div>';
      dom.participantCount.textContent = "0명";
      dom.inspectorBadge.textContent = "-";
      if (dom.participantPanelLabel) dom.participantPanelLabel.textContent = "참여자";
      if (dom.infoPanelLabel) dom.infoPanelLabel.textContent = isAscord ? "채널 상태" : "대화방 설명";
      if (dom.infoPanelCode) dom.infoPanelCode.textContent = isAscord ? "VOICE" : "INFO";
      if (dom.resourcePanelLabel) dom.resourcePanelLabel.textContent = isAscord ? "장치 및 컨트롤" : "파일, 링크 모아보기";
      if (dom.resourcePanelCode) dom.resourcePanelCode.textContent = isAscord ? "DEVICE" : "RECENT";
      if (dom.inviteMemberBtn) {
        dom.inviteMemberBtn.classList.add("d-none");
        dom.inviteMemberBtn.disabled = true;
      }
      if (isAscord) {
        dom.resourceList.innerHTML = '<div class="messenger-empty-inline">ASCORD 채널을 선택하면 장치 설정과 통화 컨트롤이 표시됩니다.</div>';
      } else {
        renderResourceList();
      }
      return;
    }

    if (isAscord) {
      const roomCall = callForRoom(room.id);
      const participantSummaries = currentCallParticipantSummaries(room, roomCall);
      const liveCount = participantSummaries.length || callParticipantCount(roomCall);
      const joinedHere = Number(state.call.joinedRoomId || 0) === Number(room.id || 0) && !!currentLiveRoom();
      const channelMode = roomChannelMode(room);
      const channelCategory = ascordCategoryLabel(room);
      const canInvite = canInviteMembers(room) && !room.is_direct;
      const canModerate = canModerateCall(room);
      const canManageMembership = canManageMembers(room);
      const canManageRoles = canManageMemberRoles(room);
      const inviteCandidates = canInvite ? inviteCandidateContacts(room) : [];
      dom.inspectorBadge.textContent = joinedHere ? (channelMode === "stage" ? "STAGE LIVE" : "VOICE LIVE") : "ASCORD";
      dom.participantCount.textContent = String(liveCount || Number(room.member_count || 0)) + "명";
      if (dom.participantPanelLabel) dom.participantPanelLabel.textContent = "라이브 참여자";
      if (dom.infoPanelLabel) dom.infoPanelLabel.textContent = "채널 상태";
      if (dom.infoPanelCode) dom.infoPanelCode.textContent = channelMode === "stage" ? "STAGE" : "VOICE";
      if (dom.resourcePanelLabel) dom.resourcePanelLabel.textContent = "장치 및 컨트롤";
      if (dom.resourcePanelCode) dom.resourcePanelCode.textContent = "DEVICE";
      if (dom.inviteMemberBtn) {
        dom.inviteMemberBtn.classList.toggle("d-none", !canInvite);
        dom.inviteMemberBtn.disabled = !canInvite || !inviteCandidates.length;
        dom.inviteMemberBtn.setAttribute("title", inviteCandidates.length ? "구성원 초대" : "추가로 초대할 수 있는 구성원이 없습니다.");
      }

      dom.roomInfo.innerHTML = [
        '<div class="messenger-ascord-room-hero">',
        '<span class="messenger-ascord-room-hero__avatar">' + roomAvatarHtml(room) + "</span>",
        '<div class="messenger-ascord-room-hero__copy">',
        "<strong>" + escapeHtml(room.title || "채널") + "</strong>",
        "<span>" + escapeHtml(room.topic || room.subtitle || "ASCORD 음성채널에서 음성, 영상, 화면공유를 운영할 수 있습니다.") + "</span>",
        "</div>",
        "</div>",
        '<div class="messenger-room-info__meta">',
        '<div class="messenger-room-info__chip"><span>모드</span><strong>' + escapeHtml(channelModeLabel(channelMode)) + "</strong></div>",
        '<div class="messenger-room-info__chip"><span>카테고리</span><strong>' + escapeHtml(channelCategory) + "</strong></div>",
        '<div class="messenger-room-info__chip"><span>연결 상태</span><strong>' + escapeHtml(joinedHere ? "현재 참여 중" : (liveCount > 0 ? "통화 진행 중" : "대기")) + "</strong></div>",
        '<div class="messenger-room-info__chip"><span>라이브 인원</span><strong>' + escapeHtml(String(liveCount || 0) + "명") + "</strong></div>",
        (channelMode === "stage" ? '<div class="messenger-room-info__chip"><span>발표자</span><strong>' + escapeHtml(String(Number((roomCall && roomCall.speaker_count) || 0)) + "명") + "</strong></div>" : ""),
        (channelMode === "stage" ? '<div class="messenger-room-info__chip"><span>발언 요청</span><strong>' + escapeHtml(String(Number((roomCall && roomCall.speaker_request_count) || 0)) + "건") + "</strong></div>" : ""),
        '<div class="messenger-room-info__chip"><span>레이아웃</span><strong>' + escapeHtml(state.call.layoutMode === "speaker" ? "Speaker View" : "Grid View") + "</strong></div>",
        "</div>",
        '<div class="messenger-ascord-room-notes">',
        '<div class="messenger-ascord-room-notes__item"><strong>채널 모드</strong><span>' + escapeHtml(channelMode === "stage" ? "STAGE 채널입니다. 일반 멤버는 청중으로 입장하고, 발언 권한은 운영자 중심으로 제한할 수 있습니다." : "VOICE 채널입니다. 권한이 허용된 멤버는 입장 후 바로 마이크, 카메라, 화면공유를 사용할 수 있습니다.") + "</span></div>",
        '<div class="messenger-ascord-room-notes__item"><strong>Push To Talk</strong><span>' + escapeHtml(state.call.pushToTalk ? "활성화됨 · ASCORD 화면에서 Space를 누르는 동안만 마이크가 열립니다." : "현재 비활성화됨 · 필요하면 상단 PTT 버튼으로 전환하세요.") + "</span></div>",
        '<div class="messenger-ascord-room-notes__item"><strong>고정 / 스피커뷰</strong><span>영상 타일을 클릭하면 고정되고, 레이아웃 버튼으로 그리드와 스피커뷰를 오갈 수 있습니다.</span></div>',
        '<div class="messenger-ascord-room-notes__item"><strong>권한</strong><span>' + escapeHtml(canManageRoles ? "owner 권한으로 멤버를 ADMIN으로 승격하거나 일반 멤버로 되돌리고, 통화 운영 제어도 함께 사용할 수 있습니다." : (canManageMembership ? "운영자 권한으로 일반 멤버를 채널에서 제거하고 통화 운영 제어를 사용할 수 있습니다." : (canModerate ? "운영자 권한으로 서버 음소거, 카메라/화면공유 중지, 통화 내보내기가 가능합니다." : (canInvite ? "이 채널에서 참여자 초대를 관리할 수 있습니다." : "진행 중인 통화에는 참여할 수 있지만 새 통화 시작은 제한될 수 있습니다.")))) + "</span></div>",
        "</div>",
        renderAscordRecentCalls(room),
      ].join("");

      dom.participantList.innerHTML = participantSummaries.length
        ? participantSummaries.map(renderAscordParticipantCard).join("")
        : '<div class="messenger-empty-inline">아직 이 채널에 연결된 참여자가 없습니다.</div>';

      dom.resourceList.innerHTML = [
        renderAscordStageControls(room, roomCall, participantSummaries, joinedHere),
        '<div class="messenger-device-stack">',
        renderCallDeviceControl("audioinput", "마이크", "bi-mic"),
        renderCallDeviceControl("audiooutput", "스피커", "bi-volume-up"),
        renderCallDeviceControl("videoinput", "카메라", "bi-camera-video"),
        '<div class="messenger-device-actions">',
        '<button class="messenger-panel__action" type="button" data-ascord-action="refresh-devices"><i class="bi bi-arrow-repeat"></i><span>장치 새로고침</span></button>',
        "</div>",
        '<div class="messenger-device-hint">',
        "<strong>팁</strong>",
        '<span>' + escapeHtml(state.call.audioOutputSupported ? "오디오 출력 장치도 이 패널에서 바로 전환할 수 있습니다." : "이 브라우저는 출력 장치 전환을 제한할 수 있습니다. 이 경우 시스템 기본 출력이 사용됩니다.") + "</span>",
        "</div>",
        "</div>",
      ].join("");
      bindAscordInspectorInteractions();
      return;
    }

    dom.inspectorBadge.textContent = room.is_direct ? "DM" : (room.is_channel ? "CHANNEL" : "GROUP");
    dom.participantCount.textContent = String(Number(room.member_count || 0)) + "명";
    if (dom.participantPanelLabel) dom.participantPanelLabel.textContent = "참여자";
    if (dom.infoPanelLabel) dom.infoPanelLabel.textContent = "대화방 설명";
    if (dom.infoPanelCode) dom.infoPanelCode.textContent = "INFO";
    if (dom.resourcePanelLabel) dom.resourcePanelLabel.textContent = "파일, 링크 모아보기";
    if (dom.resourcePanelCode) dom.resourcePanelCode.textContent = "RECENT";
    if (dom.inviteMemberBtn) {
      const canInvite = canInviteMembers(room) && !room.is_direct;
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

  function setAscordServerMenuOpen(open) {
    state.ascordServerMenuOpen = !!open && state.viewMode === "ascord";
    if (dom.ascordWorkspaceBtn) {
      dom.ascordWorkspaceBtn.setAttribute("aria-expanded", state.ascordServerMenuOpen ? "true" : "false");
    }
    if (dom.ascordServerMenu) {
      dom.ascordServerMenu.classList.toggle("is-open", state.ascordServerMenuOpen);
      dom.ascordServerMenu.setAttribute("aria-hidden", state.ascordServerMenuOpen ? "false" : "true");
    }
  }

  function openAscordCreateModal(options) {
    const settings = options || {};
    setViewMode("ascord");
    setModalMode("group");
    state.ascordCreateKind = "voice";
    state.ascordCreatePrivate = false;
    if (dom.groupNameInput) dom.groupNameInput.value = normalizeText(settings.name);
    if (dom.groupTopicInput) dom.groupTopicInput.value = normalizeText(settings.topic);
    if (dom.groupCategoryInput) dom.groupCategoryInput.value = normalizeText(settings.category || ascordWorkspaceName());
    if (dom.groupChannelModeInput) dom.groupChannelModeInput.value = normalizeChannelMode(settings.channelMode, "voice");
    if (dom.contactSearch) dom.contactSearch.value = "";
    state.selectedContacts.clear();
    renderContactPicker();
    syncAscordCreateModalUi();
    if (dom.newRoomModalInstance) dom.newRoomModalInstance.show();
  }

  async function handleAscordServerAction(action) {
    const targetAction = normalizeText(action).toLowerCase();
    const targetRoom = currentAscordWorkspaceRoom() || state.activeRoom;
    setAscordServerMenuOpen(false);
    if (!targetAction) return;
    if (targetAction === "invite") {
      await inviteMembersToRoom(targetRoom);
      return;
    }
    if (targetAction === "server-settings") {
      if (targetRoom && targetRoom.can_edit_room) {
        await editRoomDetails(targetRoom);
      } else {
        await showWarning("현재 선택한 채널은 수정 권한이 없습니다.", "서버 설정");
      }
      return;
    }
    if (targetAction === "create-channel") {
      openAscordCreateModal({ category: ascordWorkspaceName(), channelMode: "voice" });
      return;
    }
    if (targetAction === "create-category") {
      const nextCategory = await promptText({
        title: "카테고리 만들기",
        text: "새 카테고리 이름을 입력해주세요.",
        value: "",
        input: "text",
        confirmText: "다음",
        requiredMessage: "카테고리 이름을 입력해주세요.",
        maxLength: 60,
      });
      if (!nextCategory) return;
      openAscordCreateModal({ category: nextCategory, channelMode: "voice" });
      return;
    }
    if (targetAction === "create-event") {
      openAscordCreateModal({
        category: "LIVE EVENTS",
        channelMode: "stage",
        topic: "새 이벤트 채널",
      });
      return;
    }
    if (targetAction === "notification-settings") {
      const shouldOpen = state.sidebarMode !== "settings";
      toggleAscordSettingsSidebar();
      if (shouldOpen) {
        await showToast("success", "ASCORD 설정 패널에서 알림 동작을 조정할 수 있습니다.");
      }
      return;
    }
    if (targetAction === "privacy-settings") {
      await showWarning("웹 버전 ASCORD에서는 브라우저 권한과 채널 권한이 개인정보 보호 설정의 핵심입니다. 카메라/마이크 권한은 브라우저 주소창의 사이트 권한에서도 함께 조정해주세요.", "개인정보 보호 설정");
      return;
    }
    if (targetAction === "edit-profile") {
      window.location.href = "/profile-settings";
      return;
    }
    if (targetAction === "toggle-hide-muted") {
      state.preferences.hideMutedChannels = !state.preferences.hideMutedChannels;
      persistPreferences();
      applyPreferences();
      await showToast("success", state.preferences.hideMutedChannels ? "알림을 끈 채널을 숨깁니다." : "모든 채널을 다시 표시합니다.");
      return;
    }
    if (targetAction === "leave-server") {
      if (targetRoom && canLeaveRoom(targetRoom)) {
        await leaveRoom(targetRoom);
      } else {
        await showWarning("현재 구조에서는 채널 단위로만 나갈 수 있습니다. 떠날 수 있는 ASCORD 채널을 먼저 선택해주세요.", "서버 나가기");
      }
      return;
    }
    if (targetAction === "server-boost") {
      await showWarning("서버 부스트처럼 보이는 UI는 넣었지만, ABBAS_WEB의 ASCORD에는 디스코드 Nitro/Boost와 동일한 과금형 서버 강화 기능은 아직 없습니다.", "서버 부스트");
      return;
    }
    if (targetAction === "app-directory") {
      await showWarning("앱 디렉터리 UI는 준비할 수 있지만, 현재 ASCORD에는 디스코드 앱 디렉터리와 동일한 서드파티 앱 마켓플레이스는 연결되어 있지 않습니다.", "App 디렉터리");
    }
  }

  function renderAscordVoiceDock() {
    if (!dom.ascordVoiceDock) return;
    const isAscord = state.viewMode === "ascord";
    const room = state.activeRoom;
    const joinedHere = !!room && Number(state.call.joinedRoomId || 0) === Number(room.id || 0) && !!currentLiveRoom();
    const canSpeakHere = !!room && canSpeakInCall(room);
    const serverMuted = joinedHere && isServerMutedInRoom(room && room.id);
    const micEnabled = joinedHere
      ? (!!state.call.requestedAudioEnabled && !state.call.deafened && !serverMuted && canSpeakHere)
      : (!!room && !!state.call.requestedAudioEnabled && !state.call.deafened && canSpeakHere);
    const micDisabled = joinedHere
      ? (!!state.call.deafened || !!serverMuted || !canSpeakHere)
      : (!room || !!state.call.deafened || !canSpeakHere);
    dom.ascordVoiceDock.classList.toggle("d-none", !isAscord);
    if (!isAscord) {
      state.ascordProfileMenuOpen = false;
      state.ascordProfileMenuLoading = false;
      dom.ascordVoiceDock.innerHTML = "";
      return;
    }
    const currentUser = state.currentUser || {};
    const currentProfile = buildUserProfile(currentUser.user_id) || currentUser;
    const currentDisplayName = normalizeText(
      currentProfile.name ||
      currentUser.name ||
      currentProfile.display_name ||
      currentUser.display_name ||
      currentUser.user_id ||
      currentProfile.user_id ||
      "나"
    );
    const currentNickname = normalizeText(
      currentUser.nickname ||
      currentProfile.nickname ||
      currentUser.user_id ||
      currentProfile.user_id ||
      currentDisplayName
    );
    const rawPresenceLabel = normalizeText(currentProfile.presence_label || currentUser.presence_label || "");
    const rawPresenceTone = normalizeText(currentProfile.presence_tone || currentUser.presence_tone || "");
    const presenceTone = presenceToneValue(rawPresenceTone, rawPresenceLabel, true);
    const presenceLabel = presenceLabelValue(rawPresenceLabel, rawPresenceTone, true);
    const avatar = normalizeText(currentProfile.profile_image_url || currentUser.profile_image_url)
      ? '<img src="' + escapeAttribute(currentProfile.profile_image_url || currentUser.profile_image_url) + '" alt="' + escapeAttribute(currentDisplayName) + '">'
      : escapeHtml((normalizeText(currentProfile.avatar_initial || avatarInitialFor(currentDisplayName, currentUser.user_id || "U")).slice(0, 2) || "U").toUpperCase());
    const detailedProfile = state.userProfilesById[currentUser.user_id] || currentProfile;
    const roomCall = room ? callForRoom(room.id) : null;
    const connectionTitle = joinedHere
      ? (state.call.sharingScreen ? "화면 공유 중" : (state.call.cameraEnabled ? "영상 연결됨" : "음성 연결됨"))
      : "대기 중";
    const connectionMeta = room
      ? ((room.title || "채널") + " / " + ascordWorkspaceName())
      : "ASCORD";
    const elapsedText = joinedHere && roomCall ? callElapsedText(roomCall.started_at) : "";
    const elapsedMarkup = joinedHere && roomCall
      ? ('<span data-call-elapsed-started-at="' + escapeAttribute(roomCall.started_at) + '">' + escapeHtml(elapsedText) + "</span>")
      : "";
    const mutedHere = joinedHere
      ? !micEnabled
      : (!!state.call.deafened || (!!room && canSpeakHere && !state.call.requestedAudioEnabled));
    dom.ascordVoiceDock.innerHTML = [
      '<div class="messenger-ascord-voice-dock__connection' + (joinedHere ? ' is-live' : '') + '">',
      '<div class="messenger-ascord-voice-dock__signal"><i class="bi bi-broadcast"></i></div>',
      '<div class="messenger-ascord-voice-dock__copy">',
      '<strong>' + escapeHtml(connectionTitle) + '</strong>',
      '<span>' + escapeHtml(connectionMeta) + (elapsedMarkup ? " · " + elapsedMarkup : "") + "</span>",
      "</div>",
      '<button class="messenger-ascord-voice-dock__mini" type="button" data-ascord-dock-action="' + (joinedHere ? "leave" : "invite") + '">',
      '<i class="bi ' + (joinedHere ? "bi-telephone-x-fill" : "bi-person-plus-fill") + '"></i>',
      "</button>",
      "</div>",
      joinedHere
        ? [
            '<div class="messenger-ascord-voice-dock__action-row">',
            '<button type="button" data-ascord-dock-action="toggle-camera"><i class="bi ' + (state.call.cameraEnabled ? "bi-camera-video-fill" : "bi-camera-video-off-fill") + '"></i></button>',
            '<button type="button" data-ascord-dock-action="open-share"><i class="bi ' + (state.call.sharingScreen ? "bi-display-fill" : "bi-display") + '"></i></button>',
            '<button type="button" data-ascord-dock-action="layout"><i class="bi bi-grid-3x3-gap-fill"></i></button>',
            '<button type="button" data-ascord-dock-action="invite"' + (!room ? " disabled" : "") + '><i class="bi bi-person-plus-fill"></i></button>',
            "</div>",
          ].join("")
        : "",
      '<div class="messenger-ascord-voice-dock__profile-shell">',
      '<div class="messenger-ascord-voice-dock__profile">',
      '<div class="messenger-ascord-voice-dock__profile-main" data-ascord-profile-menu-toggle="true" aria-expanded="' + (state.ascordProfileMenuOpen ? "true" : "false") + '">',
      '<span class="messenger-ascord-voice-dock__avatar">' + avatar + '<span class="messenger-contact-avatar__status is-' + escapeAttribute(presenceTone) + '"></span></span>',
      '<span class="messenger-ascord-voice-dock__identity">',
      '<strong>' + escapeHtml(currentDisplayName) + "</strong>",
      '<span class="messenger-ascord-voice-dock__identity-flip" title="' + escapeAttribute(presenceLabel) + '">',
      '<span class="messenger-ascord-voice-dock__identity-flip-inner">',
      '<span class="messenger-ascord-voice-dock__identity-face messenger-ascord-voice-dock__identity-face--front">' + escapeHtml(currentNickname) + "</span>",
      '<span class="messenger-ascord-voice-dock__identity-face messenger-ascord-voice-dock__identity-face--back">' + escapeHtml(presenceLabel) + "</span>",
      "</span>",
      "</span>",
      "</span>",
      "</div>",
      '<div class="messenger-ascord-voice-dock__profile-actions">',
      '<button type="button" class="' + (mutedHere ? "is-muted" : "") + '" data-ascord-dock-action="toggle-mic"' + (micDisabled ? " disabled" : "") + ' aria-label="' + escapeAttribute(micEnabled ? "마이크 끄기" : "마이크 켜기") + '"><i class="bi ' + (micEnabled ? "bi-mic-fill" : "bi-mic-mute-fill") + '"></i></button>',
      '<button type="button" class="' + (state.call.deafened ? "is-deafened" : "") + '" data-ascord-dock-action="toggle-deafen"' + (!room ? " disabled" : "") + ' aria-label="' + escapeAttribute(state.call.deafened ? "올뮤트 해제" : "올뮤트") + '"><i class="bi bi-headphones"></i></button>',
      '<button type="button" class="messenger-ascord-voice-dock__settings-button" data-ascord-dock-action="settings" aria-label="설정"><i class="bi bi-gear-fill"></i></button>',
      "</div>",
      "</div>",
      (state.ascordProfileMenuOpen
        ? ascordProfileMenuMarkup(
            Object.assign({}, detailedProfile, {
              user_id: currentUser.user_id,
              name: currentDisplayName,
              nickname: currentNickname,
              profile_image_url: detailedProfile.profile_image_url || currentProfile.profile_image_url || currentUser.profile_image_url || "",
              avatar_initial: detailedProfile.avatar_initial || currentProfile.avatar_initial || avatarInitialFor(currentDisplayName, currentUser.user_id || "U"),
              presence_label: presenceLabel,
              presence_tone: presenceTone,
              is_self: true,
            }),
            {
              loading: state.ascordProfileMenuLoading,
              displayName: currentDisplayName,
              nickname: currentNickname,
            }
          )
        : ""),
      "</div>",
    ].join("");
  }

  function renderAscordCallDock() {
    if (!dom.ascordCallDock) return;
    const room = state.activeRoom;
    const isAscord = state.viewMode === "ascord";
    const joinedHere = !!room && Number(state.call.joinedRoomId || 0) === Number(room.id || 0) && !!currentLiveRoom();
    const canSpeakHere = !!room && canSpeakInCall(room);
    const serverMuted = joinedHere && isServerMutedInRoom(room && room.id);
    const micEnabled = joinedHere && !!state.call.requestedAudioEnabled && !state.call.deafened && !serverMuted && canSpeakHere;
    const micDisabled = !joinedHere || !!state.call.deafened || !!serverMuted || !canSpeakHere;
    dom.ascordCallDock.classList.toggle("d-none", !(isAscord && joinedHere));
    if (!(isAscord && joinedHere)) {
      dom.ascordCallDock.innerHTML = "";
      syncAscordCallDockVisibility();
      return;
    }
    dom.ascordCallDock.innerHTML = [
      '<div class="messenger-ascord-call-dock__group">',
      '<button type="button" class="' + (micEnabled ? "is-active" : "") + '" data-ascord-call-dock-action="toggle-mic"' + (micDisabled ? " disabled" : "") + '><i class="bi ' + (micEnabled ? "bi-mic-fill" : "bi-mic-mute-fill") + '"></i></button>',
      '<button type="button" class="' + (state.call.cameraEnabled ? "is-active" : "") + '" data-ascord-call-dock-action="toggle-camera"><i class="bi ' + (state.call.cameraEnabled ? "bi-camera-video-fill" : "bi-camera-video-off-fill") + '"></i></button>',
      '<button type="button" class="' + (state.call.sharingScreen ? "is-active" : "") + '" data-ascord-call-dock-action="open-share"><i class="bi ' + (state.call.sharingScreen ? "bi-display-fill" : "bi-display") + '"></i></button>',
      '<button type="button" data-ascord-call-dock-action="layout"><i class="bi bi-grid-3x3-gap-fill"></i></button>',
      '<button type="button" data-ascord-call-dock-action="invite"><i class="bi bi-person-plus-fill"></i></button>',
      "</div>",
      '<button type="button" class="messenger-ascord-call-dock__leave" data-ascord-call-dock-action="leave"><i class="bi bi-telephone-x-fill"></i></button>',
      '<div class="messenger-ascord-call-dock__group">',
      '<button type="button" class="' + (state.call.deafened ? "is-deafened" : "") + '" data-ascord-call-dock-action="toggle-deafen"><i class="bi bi-headset"></i></button>',
      '</div>',
    ].join("");
    syncAscordCallDockVisibility();
  }

  function shouldShowAscordCallDock() {
    if (!dom.root || !dom.callStage || !dom.ascordCallDock) return false;
    if (state.viewMode !== "ascord") return false;
    if (dom.ascordCallDock.classList.contains("d-none")) return false;
    if (!dom.root.classList.contains("is-ascord-call-joined")) return false;
    return dom.callStage.matches(":hover") || dom.ascordCallDock.matches(":hover");
  }

  function syncAscordCallDockVisibility() {
    if (!dom.root) return;
    dom.root.classList.toggle("is-ascord-call-dock-visible", shouldShowAscordCallDock());
  }

  function scheduleAscordCallDockVisibilitySync(delay) {
    if (state.ascordCallDockVisibilityTimer) {
      window.clearTimeout(state.ascordCallDockVisibilityTimer);
      state.ascordCallDockVisibilityTimer = 0;
    }
    state.ascordCallDockVisibilityTimer = window.setTimeout(function () {
      state.ascordCallDockVisibilityTimer = 0;
      syncAscordCallDockVisibility();
    }, Math.max(0, Number(delay) || 0));
  }

  function callRenderItemById(itemId) {
    const targetId = normalizeText(itemId);
    return (state.call.lastRenderItems || []).find(function (item) {
      return normalizeText(item && item.id) === targetId;
    }) || null;
  }

  function closeCallFullscreen() {
    state.call.fullscreenTrackId = "";
    if (dom.callFullscreen) {
      dom.callFullscreen.classList.add("d-none");
      dom.callFullscreen.setAttribute("aria-hidden", "true");
    }
    if (dom.callFullscreenMedia) {
      const slot = dom.callFullscreenMedia.querySelector("[data-call-fullscreen-slot]");
      clearMountedLiveKitTrack(slot);
      dom.callFullscreenMedia.classList.remove("has-video");
      dom.callFullscreenMedia.setAttribute("data-call-fullscreen-item", "");
      dom.callFullscreenMedia.innerHTML = "";
    }
    renderCallUi();
  }

  function openCallFullscreen(itemId) {
    const targetId = normalizeText(itemId);
    if (!targetId) return;
    state.call.fullscreenTrackId = targetId;
    renderCallFullscreenOverlay();
  }

  function renderCallFullscreenOverlay() {
    if (!dom.callFullscreen || !dom.callFullscreenMedia) return;
    const targetId = normalizeText(state.call.fullscreenTrackId);
    if (!targetId) {
      dom.callFullscreen.classList.add("d-none");
      dom.callFullscreen.setAttribute("aria-hidden", "true");
      const hiddenSlot = dom.callFullscreenMedia.querySelector("[data-call-fullscreen-slot]");
      clearMountedLiveKitTrack(hiddenSlot);
      dom.callFullscreenMedia.classList.remove("has-video");
      dom.callFullscreenMedia.setAttribute("data-call-fullscreen-item", "");
      dom.callFullscreenMedia.innerHTML = "";
      return;
    }
    const item = callRenderItemById(targetId);
    if (!item) {
      state.call.fullscreenTrackId = "";
      dom.callFullscreen.classList.add("d-none");
      dom.callFullscreen.setAttribute("aria-hidden", "true");
      const missingSlot = dom.callFullscreenMedia.querySelector("[data-call-fullscreen-slot]");
      clearMountedLiveKitTrack(missingSlot);
      dom.callFullscreenMedia.classList.remove("has-video");
      dom.callFullscreenMedia.setAttribute("data-call-fullscreen-item", "");
      dom.callFullscreenMedia.innerHTML = "";
      return;
    }
    dom.callFullscreen.classList.remove("d-none");
    dom.callFullscreen.setAttribute("aria-hidden", "false");
    if (dom.callFullscreenTitle) {
      dom.callFullscreenTitle.textContent = (item.displayName || "참여자") + (item.kind === "screen" ? " 화면" : " 영상");
    }
    if (dom.callFullscreenMeta) {
      dom.callFullscreenMeta.textContent = item.subtitle || (item.audioEnabled ? "음성 연결됨" : "대기 중");
    }
    const currentFullscreenItemId = normalizeText(dom.callFullscreenMedia.getAttribute("data-call-fullscreen-item"));
    let slot = dom.callFullscreenMedia.querySelector("[data-call-fullscreen-slot]");
    let placeholder = dom.callFullscreenMedia.querySelector(".messenger-call-fullscreen__placeholder");
    if (currentFullscreenItemId !== targetId || !slot || !placeholder) {
      clearMountedLiveKitTrack(slot);
      dom.callFullscreenMedia.setAttribute("data-call-fullscreen-item", targetId);
      dom.callFullscreenMedia.innerHTML = [
        '<div class="messenger-call-fullscreen__placeholder">' + escapeHtml(item.avatarInitial || avatarInitialFor(item.displayName, item.userId || "U")) + "</div>",
        '<div class="messenger-call-fullscreen__slot" data-call-fullscreen-slot="' + escapeAttribute(item.id) + '"></div>',
      ].join("");
      slot = dom.callFullscreenMedia.querySelector("[data-call-fullscreen-slot]");
      placeholder = dom.callFullscreenMedia.querySelector(".messenger-call-fullscreen__placeholder");
    } else {
      if (placeholder) {
        placeholder.textContent = item.avatarInitial || avatarInitialFor(item.displayName, item.userId || "U");
      }
      if (slot) {
        slot.setAttribute("data-call-fullscreen-slot", escapeAttribute(item.id));
      }
    }
    const attached = !!(slot && item.track && attachLiveKitTrack(item.track, slot, item.isLocal));
    if (!attached) {
      clearMountedLiveKitTrack(slot);
    }
    dom.callFullscreenMedia.classList.toggle("has-video", attached);
  }

  async function openAscordSharePicker() {
    if (!state.call.joinedRoomId || !currentLiveRoom()) {
      await showWarning("먼저 음성채널에 입장해주세요.", "화면 공유");
      return;
    }
    const selection = await fireDialog({
      title: "화면 공유",
      width: "68rem",
      showCancelButton: true,
      cancelButtonText: "닫기",
      showConfirmButton: false,
      customClass: {
        popup: "app-swal-popup messenger-share-picker",
        title: "app-swal-title messenger-share-picker__title",
        htmlContainer: "app-swal-html messenger-share-picker__html",
        actions: "app-swal-actions messenger-share-picker__actions",
      },
      html: [
        '<div class="messenger-share-picker__tabs">',
        '<button type="button" class="is-active" data-share-mode="application"><i class="bi bi-window"></i><span>애플리케이션</span></button>',
        '<button type="button" data-share-mode="screen"><i class="bi bi-display"></i><span>전체 화면</span></button>',
        '<button type="button" data-share-mode="device"><i class="bi bi-camera-video"></i><span>기기</span></button>',
        "</div>",
        '<div class="messenger-share-picker__body" id="messengerSharePickerBody"></div>',
      ].join(""),
      didOpen: function () {
        const body = document.getElementById("messengerSharePickerBody");
        const sharePickerActionMarkup = function (mode) {
          const isDevice = mode === "device";
          const title = isDevice
            ? "카메라 켜기"
            : (mode === "screen" ? "전체 화면 선택하기" : "창 또는 탭 선택하기");
          const description = isDevice
            ? "카메라 또는 연결된 기기를 바로 송출합니다."
            : (mode === "screen"
              ? "브라우저 공유 선택기에서 전체 화면을 고릅니다."
              : "브라우저 공유 선택기에서 앱 창 또는 탭을 고릅니다.");
          const icon = isDevice ? "bi-camera-video-fill" : "bi-display-fill";
          return [
            '<button type="button" class="messenger-share-picker__primary" data-share-select="' + escapeAttribute(mode) + '">',
            '<span class="messenger-share-picker__primary-icon"><i class="bi ' + escapeAttribute(icon) + '"></i></span>',
            '<span class="messenger-share-picker__primary-copy">',
            "<strong>" + escapeHtml(title) + "</strong>",
            "<span>" + escapeHtml(description) + "</span>",
            "</span>",
            "</button>",
          ].join("");
        };
        const renderBody = function (mode) {
          state.call.sharePickerMode = mode;
          Array.prototype.forEach.call(document.querySelectorAll("[data-share-mode]"), function (button) {
            const active = normalizeText(button.getAttribute("data-share-mode")) === mode;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
          });
          if (!body) return;
          if (mode === "device") {
            body.innerHTML = [
              '<div class="messenger-share-picker__hero">',
              '<strong>카메라 또는 연결된 기기를 바로 송출합니다.</strong>',
              '<span>브라우저 보안 정책상 디스코드처럼 창 목록 썸네일을 직접 렌더링할 수는 없지만, 카메라는 이 화면에서 바로 켤 수 있습니다.</span>',
              "</div>",
              sharePickerActionMarkup("device"),
            ].join("");
            return;
          }
          body.innerHTML = [
            '<div class="messenger-share-picker__hero">',
            '<strong>' + escapeHtml(mode === "screen" ? "모니터 전체를 공유합니다." : "브라우저 탭이나 앱 창을 공유합니다.") + "</strong>",
            '<span>다음 단계에서 브라우저의 기본 공유 선택기가 열립니다. 거기서 ' + escapeHtml(mode === "screen" ? "전체 화면" : "공유할 창 또는 탭") + '을 선택해주세요.</span>',
            "</div>",
            sharePickerActionMarkup(mode),
          ].join("");
        };
        document.querySelectorAll("[data-share-mode]").forEach(function (button) {
          button.addEventListener("click", function () {
            renderBody(normalizeText(button.getAttribute("data-share-mode")) || "application");
          });
        });
        if (body) {
          body.addEventListener("click", function (event) {
            const button = event.target instanceof Element ? event.target.closest("[data-share-select]") : null;
            if (!button) return;
            const mode = normalizeText(button.getAttribute("data-share-select")) || "application";
            if (window.Swal) window.Swal.close();
            if (mode === "device") {
              toggleCallCamera().catch(function (error) {
                showError((error && error.message) || "카메라를 켜지 못했습니다.");
              });
              return;
            }
            toggleScreenShare().catch(function (error) {
              showError((error && error.message) || "화면 공유를 시작하지 못했습니다.");
            });
          });
        }
        renderBody(state.call.sharePickerMode || "application");
      },
    });
    return selection;
  }

  async function handleAscordDockAction(action) {
    const targetAction = normalizeText(action).toLowerCase();
    if (!targetAction) return;
    if (targetAction === "invite") {
      await inviteMembersToRoom(currentAscordWorkspaceRoom() || state.activeRoom);
      return;
    }
    if (targetAction === "settings") {
      toggleAscordSettingsSidebar();
      return;
    }
    if (targetAction === "layout") {
      toggleCallLayout();
      return;
    }
    if (targetAction === "open-share") {
      await toggleScreenShare();
      return;
    }
    if (targetAction === "leave") {
      await leaveCurrentCall();
      return;
    }
    if (targetAction === "toggle-mic") {
      await toggleCallMute();
      return;
    }
    if (targetAction === "toggle-camera") {
      await toggleCallCamera();
      return;
    }
    if (targetAction === "toggle-deafen") {
      await toggleCallDeafen();
      return;
    }
    if (targetAction === "toggle-ptt") {
      await toggleCallPushToTalk();
    }
  }

  async function handleAscordProfileMenuAction(action) {
    const targetAction = normalizeText(action).toLowerCase();
    if (!targetAction) return;
    if (targetAction === "profile-edit") {
      setAscordProfileMenuOpen(false);
      window.location.href = "/profile-settings";
      return;
    }
    if (targetAction === "status") {
      return;
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
      canLeaveRoom(room) ? '<button type="button" data-room-menu-action="leave-room"><i class="bi bi-box-arrow-right"></i><span>채널 나가기</span></button>' : '',
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
    const roomCall = room ? callForRoom(room.id) : null;
    const joinedHere = !!room && Number(state.call.joinedRoomId || 0) === Number(room.id || 0) && !!currentLiveRoom();
    const participantCount = callParticipantCount(roomCall, room && room.id);
    const isAscord = state.viewMode === "ascord";
    const avatar = isAscord
      ? '<i class="bi ' + escapeAttribute(room ? roomVoiceIcon(room) : "bi-volume-up-fill") + '"></i>'
      : (room && room.avatar_url
        ? '<img src="' + escapeHtml(room.avatar_url) + '" alt="' + escapeHtml(room.title) + '">'
        : escapeHtml((room && room.avatar_initial) || "A"));
    if (dom.activeRoomAvatar) dom.activeRoomAvatar.innerHTML = avatar;
    if (dom.activeRoomTitle) dom.activeRoomTitle.textContent = room
      ? normalizeText(room.title)
      : (isAscord ? "ASCORD 채널 선택" : "대화방 선택");
    if (dom.activeRoomSubtitle) {
      if (!room) {
        dom.activeRoomSubtitle.textContent = isAscord
          ? "왼쪽 목록에서 ASCORD 음성채널을 선택하면 전체 화면으로 통화 상태를 볼 수 있습니다."
          : "왼쪽 목록에서 대화방을 선택하면 메시지를 볼 수 있습니다.";
      } else if (isAscord) {
        const baseParts = [
          channelModeLabel(roomChannelMode(room)),
          ascordCategoryLabel(room),
          participantCount > 0 ? (String(participantCount) + "명 연결") : "대기 중",
          joinedHere ? "현재 이 채널에 참여 중" : "채널 선택 후 음성 입장 버튼으로 연결",
        ];
        dom.activeRoomSubtitle.textContent = baseParts.join(" · ");
      } else {
        dom.activeRoomSubtitle.textContent = normalizeText(room.subtitle || room.topic || "");
      }
    }

    const enabled = !!room;
    if (!enabled && state.roomDrawerOpen) {
      setRoomDrawerOpen(false);
    }
    if (dom.starToggleBtn) {
      dom.starToggleBtn.disabled = !enabled;
      dom.starToggleBtn.innerHTML = room && room.is_starred
        ? '<i class="bi bi-star-fill"></i>'
        : '<i class="bi bi-star"></i>';
      dom.starToggleBtn.setAttribute("title", room && room.is_starred ? "즐겨찾기 해제" : "즐겨찾기");
      dom.starToggleBtn.setAttribute("aria-label", room && room.is_starred ? "즐겨찾기 해제" : "즐겨찾기");
    }
    if (dom.roomRefreshBtn) dom.roomRefreshBtn.disabled = !enabled;
    if (dom.roomLinkBtn) {
      dom.roomLinkBtn.disabled = !enabled;
      dom.roomLinkBtn.innerHTML = notibaAiIconMarkup("messenger-notiba-ai-icon--button");
      dom.roomLinkBtn.setAttribute("title", "Notiba AI");
      dom.roomLinkBtn.setAttribute("aria-label", "Notiba AI");
      dom.roomLinkBtn.setAttribute("aria-expanded", state.roomDrawerOpen ? "true" : "false");
    }
    if (dom.roomMuteBtn) {
      dom.roomMuteBtn.disabled = !enabled;
      dom.roomMuteBtn.innerHTML = room && room.is_muted
        ? '<i class="bi bi-bell-slash-fill"></i>'
        : '<i class="bi bi-bell"></i>';
      dom.roomMuteBtn.setAttribute("title", room && room.is_muted ? "알림 켜기" : "알림 끄기");
      dom.roomMuteBtn.setAttribute("aria-label", room && room.is_muted ? "알림 켜기" : "알림 끄기");
    }
    if (dom.roomMoreBtn) dom.roomMoreBtn.disabled = !enabled;
    if (dom.composerInput) dom.composerInput.disabled = !enabled || isAscord;
    if (dom.sendBtn) dom.sendBtn.disabled = !enabled || isAscord;
    if (dom.attachBtn) dom.attachBtn.disabled = !enabled || isAscord;
    if (dom.emojiBtn) dom.emojiBtn.disabled = !enabled || isAscord;
    if (dom.mentionBtn) dom.mentionBtn.disabled = !enabled || isAscord;
    if (dom.linkInsertBtn) dom.linkInsertBtn.disabled = !enabled || isAscord;
    if (dom.formatBtn) dom.formatBtn.disabled = !enabled || isAscord;
    renderRoomMoreMenu();
    renderRoomDrawer();
    renderCallUi();
    syncNotibaCapture();
  }

  function notibaAiIconMarkup(extraClass) {
    const className = ["messenger-notiba-ai-icon"];
    if (extraClass) className.push(extraClass);
    return '<img src="' + escapeAttribute(NOTIBA_AI_ICON_SRC) + '" alt="" class="' + escapeAttribute(className.join(" ")) + '" draggable="false">';
  }

  function roomDrawerIconMarkup(room) {
    return notibaAiIconMarkup("messenger-notiba-ai-icon--drawer");
  }

  function formatTranscriptClock(value) {
    const timestamp = Number(value || 0);
    if (!timestamp) return "";
    try {
      return new Date(timestamp * 1000).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return "";
    }
  }

  function roomDrawerTranscriptAvatarMarkup(room, entry) {
    const payload = entry || {};
    const profile = roomMemberProfile(room, payload.user_id, payload.display_name);
    if (profile.profile_image_url) {
      return '<img src="' + escapeAttribute(profile.profile_image_url) + '" alt="' + escapeAttribute(profile.display_name || payload.display_name || "참여자") + '">';
    }
    return escapeHtml(profile.avatar_initial || avatarInitialFor(payload.display_name || payload.user_id || "U", "U"));
  }

  function renderRoomDrawerBody(room) {
    if (!dom.roomDrawerBody) return;
    const targetRoom = room || null;
    const transcripts = targetRoom ? mergedTranscriptEntries(transcriptEntriesForRoom(targetRoom.id)) : [];
    const pending = targetRoom ? pendingTranscriptEntriesForRoom(targetRoom.id) : [];
    const currentCallId = normalizeText(state.notiba.callIdByRoomId[Number((targetRoom && targetRoom.id) || 0)]);
    const hasLiveCall = !!normalizeText((callForRoom((targetRoom && targetRoom.id) || 0) || {}).call_id || currentCallId);
    const captureError = normalizeText((state.notiba.capture || {}).error);
    const modelLabel = normalizeText((state.notiba.settings && state.notiba.settings.model) || "gpt-4o-transcribe");
    if (!targetRoom || !roomSupportsCalls(targetRoom)) {
      dom.roomDrawerBody.innerHTML = [
        '<div class="messenger-notiba-feed">',
        '<div class="messenger-notiba-feed__status"><span class="messenger-notiba-feed__dot"></span><strong>Notiba AI</strong><span>ASCORD 통화에서만 실시간 한국어 전사가 표시됩니다.</span></div>',
        '<div class="messenger-notiba-feed__empty">',
        '<i class="bi bi-soundwave"></i>',
        '<strong>음성채팅이 열리면 여기에 전사가 표시됩니다.</strong>',
        '<span>같은 채널 참여자가 말하면 화자별 텍스트가 실시간으로 누적됩니다.</span>',
        '</div>',
        '</div>',
      ].join("");
      return;
    }
    if (!transcripts.length && !pending.length) {
      dom.roomDrawerBody.innerHTML = [
        '<div class="messenger-notiba-feed">',
        '<div class="messenger-notiba-feed__status">',
        '<span class="messenger-notiba-feed__dot' + (hasLiveCall ? " is-live" : "") + '"></span>',
        '<strong>Notiba AI</strong>',
        '<span>한국어 실시간 전사 · ' + escapeHtml(modelLabel) + "</span>",
        "</div>",
        '<div class="messenger-notiba-feed__empty">',
        '<i class="bi bi-chat-quote"></i>',
        '<strong>' + escapeHtml(hasLiveCall ? "지금 말하는 내용이 여기에 바로 표시됩니다." : "현재 연결된 LIVE 채널이 없습니다.") + '</strong>',
        '<span>' + escapeHtml(
          captureError
            ? captureError
            : (hasLiveCall
              ? "A : 안녕 / B : 반가워요 같은 형식으로 화자별 텍스트가 누적됩니다."
              : "누군가 채널에 입장해 통화를 시작하면 여기에 실시간 전사가 표시됩니다.")
        ) + '</span>',
        "</div>",
        "</div>",
      ].join("");
      return;
    }
    dom.roomDrawerBody.innerHTML = [
      '<div class="messenger-notiba-feed">',
      '<div class="messenger-notiba-feed__status">',
      '<span class="messenger-notiba-feed__dot is-live"></span>',
      '<strong>Notiba AI</strong>',
      '<span>한국어 실시간 전사 · ' + escapeHtml(modelLabel) + '</span>',
      "</div>",
      '<div class="messenger-notiba-feed__list">',
      transcripts.concat(pending).map(function (entry) {
        const speaker = normalizeText((entry && entry.display_name) || (entry && entry.user_id) || "참여자");
        const clock = formatTranscriptClock((entry && entry.spoken_at) || (entry && entry.created_at) || 0);
        const isPartial = !!(entry && entry.is_partial);
        return [
          '<article class="messenger-notiba-feed__item' + (isPartial ? " is-live" : "") + '" data-notiba-entry-id="' + escapeAttribute((entry && entry.id) || (entry && entry.item_id) || "") + '">',
          '<span class="messenger-notiba-feed__avatar">' + roomDrawerTranscriptAvatarMarkup(targetRoom, entry) + "</span>",
          '<div class="messenger-notiba-feed__copy">',
          '<div class="messenger-notiba-feed__meta">',
          '<strong>' + escapeHtml(speaker) + "</strong>",
          '<span>' + escapeHtml(isPartial ? "입력 중" : clock) + "</span>",
          "</div>",
          '<p>' + escapeHtml(speaker) + " : " + escapeHtml((entry && entry.text) || "") + "</p>",
          "</div>",
          "</article>",
        ].join("");
      }).join(""),
      "</div>",
      "</div>",
    ].join("");
    try {
      dom.roomDrawerBody.scrollTop = dom.roomDrawerBody.scrollHeight;
    } catch (_) {}
  }

  function renderRoomDrawer() {
    if (!dom.roomDrawer || !dom.roomDrawerTitle || !dom.roomDrawerIcon) return;
    const room = state.activeRoom;
    if (!room) {
      dom.roomDrawer.classList.remove("is-open");
      dom.roomDrawer.setAttribute("aria-hidden", "true");
      if (dom.roomLinkBtn) {
        dom.roomLinkBtn.setAttribute("aria-expanded", "false");
      }
      if (dom.roomDrawerBody) {
        dom.roomDrawerBody.innerHTML = "";
      }
      return;
    }
    dom.roomDrawerIcon.innerHTML = roomDrawerIconMarkup(room);
    dom.roomDrawerTitle.textContent = "Notiba AI";
    dom.roomDrawer.classList.toggle("is-open", !!state.roomDrawerOpen);
    dom.roomDrawer.setAttribute("aria-hidden", state.roomDrawerOpen ? "false" : "true");
    if (dom.roomLinkBtn) {
      dom.roomLinkBtn.setAttribute("aria-expanded", state.roomDrawerOpen ? "true" : "false");
    }
    renderRoomDrawerBody(room);
  }

  function setRoomDrawerOpen(open) {
    state.roomDrawerOpen = !!open && !!state.activeRoom;
    renderRoomDrawer();
    if (state.roomDrawerOpen) {
      loadRoomCallTranscripts(Number((state.activeRoom && state.activeRoom.id) || state.activeRoomId || 0), { force: true }).catch(function () {});
      if (dom.roomLinkBtn && typeof dom.roomLinkBtn.blur === "function") {
        dom.roomLinkBtn.blur();
      }
      window.setTimeout(function () {
        if (!state.roomDrawerOpen || !dom.roomDrawerCloseBtn || typeof dom.roomDrawerCloseBtn.focus !== "function") return;
        try {
          dom.roomDrawerCloseBtn.focus({ preventScroll: true });
        } catch (_) {
          dom.roomDrawerCloseBtn.focus();
        }
      }, 0);
    }
  }

  function toggleRoomDrawer() {
    if (!state.activeRoom) return;
    setRoomDrawerOpen(!state.roomDrawerOpen);
  }

  function meetingNotesChannels() {
    return Array.isArray(state.meetingNotes.channels) ? state.meetingNotes.channels : [];
  }

  function meetingNotesChannelByRoomId(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId === 0) return null;
    return meetingNotesChannels().find(function (channel) {
      return Number((channel || {}).room_id || 0) === targetRoomId;
    }) || null;
  }

  function formatMeetingNoteTimestamp(value) {
    const text = normalizeText(value);
    if (!text) return "저장 시각 없음";
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/);
    if (!match) return text;
    return match[1] + "-" + match[2] + "-" + match[3] + " " + match[4] + ":" + match[5] + ":" + match[6];
  }

  function setMeetingNotesActiveRoom(roomId) {
    const nextRoomId = Number(roomId || 0);
    if (nextRoomId === Number(state.meetingNotes.activeRoomId || 0)) return;
    state.meetingNotes.activeRoomId = nextRoomId !== 0 ? nextRoomId : 0;
    renderMeetingNotesBrowser();
  }

  function renderMeetingNotesBrowser() {
    if (!dom.meetingNotesChannels || !dom.meetingNotesNotes) return;
    const channels = meetingNotesChannels();
    const activeChannel = meetingNotesChannelByRoomId(state.meetingNotes.activeRoomId);
    if (state.meetingNotes.loading && !channels.length) {
      dom.meetingNotesChannels.innerHTML = '<div class="messenger-empty-inline">회의록 채널을 불러오는 중입니다.</div>';
      dom.meetingNotesNotes.innerHTML = [
        '<div class="messenger-meeting-notes-browser__empty">',
        '<i class="bi bi-hourglass-split"></i>',
        '<strong>날짜별 회의록을 준비하고 있습니다.</strong>',
        '<span>저장된 채널 목록을 가져오는 중입니다.</span>',
        '</div>',
      ].join("");
      if (dom.meetingNotesBrowser) {
        dom.meetingNotesBrowser.classList.remove("has-active-channel");
      }
      return;
    }
    dom.meetingNotesChannels.innerHTML = channels.length
      ? channels.map(function (channel) {
          const targetChannel = channel || {};
          const roomId = Number(targetChannel.room_id || 0);
          const noteCount = Number(targetChannel.note_count || 0);
          const activeClass = roomId === Number(state.meetingNotes.activeRoomId || 0) ? " is-active" : "";
          const deletedBucket = !!targetChannel.deleted_bucket;
          const iconClass = deletedBucket ? "bi-trash3-fill" : "bi-volume-up-fill";
          return [
            '<button class="messenger-meeting-notes-browser__channel' + activeClass + (deletedBucket ? " is-deleted" : "") + '" type="button" data-meeting-room-id="' + roomId + '">',
            '<span class="messenger-meeting-notes-browser__channel-icon"><i class="bi ' + iconClass + '"></i></span>',
            '<span class="messenger-meeting-notes-browser__channel-copy">',
            '<strong>' + escapeHtml(targetChannel.room_title || "채널") + '</strong>',
            '<span>' + escapeHtml(
              deletedBucket
                ? ("삭제된 채널 회의록 " + noteCount + "개")
                : (noteCount > 0 ? ("회의록 " + noteCount + "개") : "저장된 회의록 없음")
            ) + '</span>',
            '</span>',
            '<i class="bi bi-chevron-right"></i>',
            '</button>',
          ].join("");
        }).join("")
      : '<div class="messenger-empty-inline">저장된 회의록 채널이 없습니다.</div>';
    if (!activeChannel) {
      dom.meetingNotesNotes.innerHTML = [
        '<div class="messenger-meeting-notes-browser__empty">',
        '<i class="bi bi-journal-richtext"></i>',
        '<strong>채널에 커서를 올리면 날짜별 회의록이 펼쳐집니다.</strong>',
        '<span>왼쪽 메뉴에서 원하는 음성 채널을 선택해 주세요.</span>',
        '</div>',
      ].join("");
      if (dom.meetingNotesBrowser) {
        dom.meetingNotesBrowser.classList.remove("has-active-channel");
      }
      return;
    }
    if (dom.meetingNotesBrowser) {
      dom.meetingNotesBrowser.classList.add("has-active-channel");
    }
    const notes = Array.isArray(activeChannel.notes) ? activeChannel.notes : [];
    dom.meetingNotesNotes.innerHTML = [
      '<div class="messenger-meeting-notes-browser__notes-head">',
      '<strong>' + escapeHtml(activeChannel.room_title || "채널") + '</strong>',
      '<span>' + escapeHtml(activeChannel.deleted_bucket ? "삭제된 채널 회의록" : "날짜별 회의록") + '</span>',
      '</div>',
      notes.length
        ? [
            '<div class="messenger-meeting-notes-browser__note-list">',
            notes.map(function (note) {
              const targetNote = note || {};
              const noteSubtext = activeChannel.deleted_bucket
                ? ((normalizeText(targetNote.channel_name) || "삭제된 채널") + " · " + (targetNote.file_name || "회의록.txt"))
                : (targetNote.file_name || "회의록.txt");
              return [
                '<button class="messenger-meeting-notes-browser__note" type="button" data-meeting-note-id="' + escapeAttribute(targetNote.note_id || "") + '">',
                '<span class="messenger-meeting-notes-browser__note-icon"><i class="bi bi-file-earmark-text"></i></span>',
                '<span class="messenger-meeting-notes-browser__note-copy">',
                '<strong>' + escapeHtml(formatMeetingNoteTimestamp(targetNote.timestamp || "")) + '</strong>',
                '<span>' + escapeHtml(noteSubtext) + '</span>',
                '</span>',
                '</button>',
              ].join("");
            }).join(""),
            '</div>',
          ].join("")
        : [
            '<div class="messenger-meeting-notes-browser__empty is-inline-empty">',
            '<i class="bi bi-journal-x"></i>',
            '<strong>' + escapeHtml(activeChannel.deleted_bucket ? "삭제된 채널 회의록이 없습니다." : "이 채널에는 아직 저장된 회의록이 없습니다.") + '</strong>',
            '<span>' + escapeHtml(activeChannel.deleted_bucket ? "삭제된 채널이 생기면 이 묶음에서 회의록을 계속 볼 수 있습니다." : "Notiba AI 전사가 누적되면 날짜별 회의록이 여기에 생성됩니다.") + '</span>',
            '</div>',
          ].join(""),
    ].join("");
  }

  async function loadMeetingNotes(force) {
    if (state.meetingNotes.loading && !force) return meetingNotesChannels();
    state.meetingNotes.loading = true;
    renderMeetingNotesBrowser();
    try {
      const payload = await api("/api/messenger/meeting-notes");
      state.meetingNotes.channels = Array.isArray(payload.channels) ? payload.channels : [];
      const activeRoomId = Number(state.meetingNotes.activeRoomId || 0);
      const hasActive = state.meetingNotes.channels.some(function (channel) {
        return Number((channel || {}).room_id || 0) === activeRoomId;
      });
      if (!hasActive) {
        state.meetingNotes.activeRoomId = 0;
      }
      renderMeetingNotesBrowser();
      return state.meetingNotes.channels;
    } finally {
      state.meetingNotes.loading = false;
      renderMeetingNotesBrowser();
    }
  }

  function renderMeetingNoteViewer() {
    if (!dom.meetingNoteViewerTitle || !dom.meetingNoteViewerMeta || !dom.meetingNoteViewerContent) return;
    const note = state.meetingNotes.viewerNote || {};
    dom.meetingNoteViewerTitle.textContent = normalizeText(note.channel_name) || "회의록";
    dom.meetingNoteViewerMeta.textContent = formatMeetingNoteTimestamp(note.timestamp || "");
    dom.meetingNoteViewerContent.textContent = normalizeText(note.content) || "회의록 내용이 없습니다.";
  }

  async function openMeetingNote(noteId) {
    const normalizedNoteId = normalizeText(noteId);
    if (!normalizedNoteId) return;
    const payload = await api("/api/messenger/meeting-notes/read?note_id=" + encodeURIComponent(normalizedNoteId));
    state.meetingNotes.pendingViewerNote = payload.note || null;
    if (dom.meetingNotesModalInstance) {
      dom.meetingNotesModalInstance.hide();
      return;
    }
    state.meetingNotes.viewerNote = state.meetingNotes.pendingViewerNote;
    state.meetingNotes.pendingViewerNote = null;
    renderMeetingNoteViewer();
    if (dom.meetingNoteViewerModalInstance) {
      dom.meetingNoteViewerModalInstance.show();
    }
  }

  async function openMeetingNotesModal() {
    state.meetingNotes.pendingViewerNote = null;
    await loadMeetingNotes(true);
    renderMeetingNotesBrowser();
    if (dom.meetingNotesModalInstance) {
      dom.meetingNotesModalInstance.show();
    }
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
    setAscordServerMenuOpen(false);
    setRoomMoreMenuOpen(false);
    setContextMenuOpen(false);
    setComposerPopover("");
    setRoomDrawerOpen(false);

    if (!state.isOpen) {
      endPopupDrag();
      state.call.fullscreenTrackId = "";
      if (dom.callFullscreen) {
        dom.callFullscreen.classList.add("d-none");
        dom.callFullscreen.setAttribute("aria-hidden", "true");
      }
      if (dom.callFullscreenMedia) {
        dom.callFullscreenMedia.innerHTML = "";
      }
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
    ensureActiveRoomForCurrentView(state.activeRoomId || room.id);
    enforceJoinedRoomPermissions(findRoomById(state.call.joinedRoomId) || room).catch(function () {});
    recalcCounts();
    renderRoomList();
    renderHeader();
    renderInspector();
  }

  function removeRoom(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    if (Number(state.call.joinedRoomId || 0) === targetRoomId) {
      disconnectLiveKitRoom(false, { playSound: false }).catch(function () {});
    }
    delete state.call.roomCallsById[targetRoomId];
    delete state.call.callSnapshotsByRoomId[targetRoomId];
    delete state.call.incomingInvitesByRoomId[targetRoomId];
    delete state.call.serverMutedRoomIds[targetRoomId];
    state.rooms = state.rooms.filter(function (room) {
      return Number(room.id || 0) !== targetRoomId;
    });
    state.roomHistory = (state.roomHistory || []).filter(function (value) {
      return Number(value || 0) !== targetRoomId;
    });
    persistRecentRooms();
    if (Number(state.activeRoomId || 0) === targetRoomId) {
      ensureActiveRoomForCurrentView(0);
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
    renderIncomingCallInvites();
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
    const nextRoomId = ensureActiveRoomForCurrentView(Number(data.active_room_id || state.activeRoomId || 0));
    renderRoomList();
    renderMentionPicker();
    enforceJoinedRoomPermissions(findRoomById(state.call.joinedRoomId)).catch(function () {});
    renderHeader();
    renderInspector();
    renderMessages();
    if (nextRoomId > 0) {
      await loadRoomMessages(nextRoomId);
    }
    syncKnownRoomCalls(state.rooms);
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
    if (state.roomDrawerOpen) {
      loadRoomCallTranscripts(targetRoomId, { force: true }).catch(function () {});
    }
    markActiveRoomRead();
  }

  function syncKnownRoomCalls(rooms) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    (Array.isArray(rooms) ? rooms : state.rooms).forEach(function (room) {
      const roomId = Number((room && room.id) || 0);
      if (roomId <= 0 || !roomSupportsCalls(room)) return;
      sendSocket({ type: "call_sync", room_id: roomId });
    });
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
    const targetRoom = findRoomById(targetRoomId);
    if (targetRoom) {
      state.viewMode = isAscordRoom(targetRoom) ? "ascord" : "talk";
      persistViewModePreference();
      applyViewModeChrome();
    }
    if (targetRoomId <= 0 || Number(state.activeRoomId || 0) === targetRoomId) {
      ensureActiveRoomForCurrentView(targetRoomId);
      if (state.viewMode === "ascord") {
        markLiveRoomSeen(targetRoomId, callForRoom(targetRoomId));
        recalcCounts();
      }
      renderRoomList();
      renderHeader();
      renderInspector();
      renderMessages();
      sendSocket({ type: "call_sync", room_id: targetRoomId });
      if (state.roomDrawerOpen && targetRoomId > 0) {
        loadRoomCallTranscripts(targetRoomId, { force: true }).catch(function () {});
      }
      markActiveRoomRead();
      return;
    }
    state.activeRoomId = targetRoomId;
    state.activeRoom = currentRoom();
    if (state.viewMode === "ascord") {
      markLiveRoomSeen(targetRoomId, callForRoom(targetRoomId));
      recalcCounts();
    }
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
    const targetRoom = findRoomById(targetRoomId);
    state.highlightMessageId = Number(messageId || 0);
    setNotificationMenuOpen(false);
    if (!state.initialized) {
      await init();
    }
    if (targetRoom && isAscordRoom(targetRoom)) {
      setViewMode("ascord");
    } else {
      setViewMode("talk");
    }
    setPopupOpen(true);
    await selectRoom(targetRoomId);
    highlightPendingMessage();
    dismissNotificationsForRoom(targetRoomId);
  }

  async function openAscordRoom(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    setNotificationMenuOpen(false);
    if (!state.initialized) {
      await init();
    }
    setPopupOpen(true);
    setViewMode("ascord");
    await selectRoom(targetRoomId);
    markLiveRoomSeen(targetRoomId, callForRoom(targetRoomId));
    recalcCounts();
  }

  function stageRequestQueueItems(room, roomCall) {
    const targetRoom = room || state.activeRoom;
    const targetCall = roomCall || activeRoomCall();
    return currentCallParticipantSummaries(targetRoom, targetCall).filter(function (summary) {
      return !!summary && !summary.isLocal && !!summary.speakerRequested;
    });
  }

  function stageQueueApprovalMarkup(summary) {
    const payload = summary || {};
    const avatar = payload.profileImageUrl
      ? '<img src="' + escapeAttribute(payload.profileImageUrl) + '" alt="' + escapeAttribute(payload.displayName || payload.userId || "참여자") + '">'
      : escapeHtml(payload.avatarInitial || avatarInitialFor(payload.displayName, payload.userId));
    return [
      '<div class="messenger-contact-picker__item" data-stage-queue-user-id="' + escapeAttribute(payload.userId || "") + '">',
      '<span class="messenger-contact-picker__avatar">' + avatar + "</span>",
      '<span class="messenger-contact-picker__meta">',
      '<strong>' + escapeHtml(payload.displayName || payload.userId || "참여자") + "</strong>",
      '<span>' + escapeHtml(payload.department || "ASCORD STAGE") + "</span>",
      "</span>",
      '<button type="button" class="btn btn-primary btn-sm" data-stage-queue-approve="' + escapeAttribute(payload.userId || "") + '">승인</button>',
      "</div>",
    ].join("");
  }

  async function openStageRequestQueue(room) {
    const targetRoom = room || state.activeRoom;
    const roomCall = activeRoomCall();
    if (!targetRoom || !isStageRoom(targetRoom) || !canModerateCall(targetRoom)) return;
    const pending = stageRequestQueueItems(targetRoom, roomCall);
    if (!hasSwal()) {
      if (!pending.length) {
        await showWarning("현재 대기 중인 발언 요청이 없습니다.");
        return;
      }
      await showWarning("이 브라우저에서는 요청 관리 팝업을 열 수 없습니다.");
      return;
    }
    await fireDialog({
      title: "발언 요청 관리",
      width: "40rem",
      html: [
        '<div class="app-swal-form">',
        '<div class="app-swal-field-group">',
        '<label class="form-label">대기 중인 요청</label>',
        '<div class="messenger-contact-picker app-swal-contact-picker" id="swalMessengerStageQueueList">',
        pending.length
          ? pending.map(stageQueueApprovalMarkup).join("")
          : '<div class="messenger-empty-inline">현재 대기 중인 발언 요청이 없습니다.</div>',
        "</div>",
        '</div>',
        '</div>',
      ].join(""),
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: "닫기",
      didOpen: function () {
        const list = document.getElementById("swalMessengerStageQueueList");
        if (!list) return;
        list.addEventListener("click", function (event) {
          const button = event.target instanceof Element ? event.target.closest("[data-stage-queue-approve]") : null;
          if (!button) return;
          const userId = normalizeText(button.getAttribute("data-stage-queue-approve"));
          if (!userId) return;
          button.setAttribute("disabled", "disabled");
          sendCallModerationAction("grant_speaker", userId, targetRoom).then(function () {
            const item = button.closest("[data-stage-queue-user-id]");
            if (item && item.parentNode) {
              item.parentNode.removeChild(item);
            }
            if (!list.querySelector("[data-stage-queue-user-id]")) {
              list.innerHTML = '<div class="messenger-empty-inline">현재 대기 중인 발언 요청이 없습니다.</div>';
            }
          }).catch(function (error) {
            button.removeAttribute("disabled");
            showError((error && error.message) || "발언 요청을 승인하지 못했습니다.");
          });
        });
      },
    });
  }

  async function joinAscordVoiceChannel(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    clearPendingAscordRoomOpen();
    ensureAscordUiAudioContext();
    if (!state.initialized) {
      await init();
    }
    setPopupOpen(true);
    setViewMode("ascord");
    await selectRoom(targetRoomId);
    markLiveRoomSeen(targetRoomId, callForRoom(targetRoomId));
    recalcCounts();
    if (Number(state.call.joinedRoomId || 0) === targetRoomId && !!currentLiveRoom()) {
      return;
    }
    await startOrJoinCall("audio");
  }

  function currentUserId() {
    return normalizeText((state.currentUser || {}).user_id);
  }

  function currentUserName() {
    return normalizeText((state.currentUser || {}).name || (state.currentUser || {}).display_name || currentUserId() || "나");
  }

  function livekitIdentityUserId(identity) {
    const normalized = normalizeText(identity);
    if (!normalized) return "";
    return normalizeText(normalized.split("__")[0] || normalized);
  }

  function participantVolume(identity) {
    const targetIdentity = normalizeText(identity);
    const storedValue = Number(state.call.participantVolumes[targetIdentity]);
    if (!targetIdentity || !Number.isFinite(storedValue)) return 1;
    return clampNumber(storedValue, 0, 1);
  }

  function setParticipantVolume(identity, value) {
    const targetIdentity = normalizeText(identity);
    if (!targetIdentity) return;
    state.call.participantVolumes[targetIdentity] = clampNumber(Number(value), 0, 1);
    persistCallPreferences();
    applyRemoteAudioPreferences();
    if (state.viewMode === "ascord") {
      renderInspector();
    }
  }

  function currentActiveSpeakerIdentities(room) {
    const targetRoom = room || null;
    return new Set((targetRoom && targetRoom.activeSpeakers ? targetRoom.activeSpeakers : []).map(function (participant) {
      return normalizeText((participant || {}).identity);
    }).filter(Boolean));
  }

  function roomMemberProfile(room, userId, fallbackDisplayName) {
    const targetRoom = room || state.activeRoom;
    const targetUserId = normalizeText(userId);
    const member = findMemberByUserId(targetRoom, targetUserId) || findContactByUserId(targetUserId) || {};
    const displayName = normalizeText(
      member.name ||
      ((state.currentUser && normalizeText(state.currentUser.user_id) === targetUserId) ? state.currentUser.name : "") ||
      fallbackDisplayName ||
      member.display_name ||
      member.nickname ||
      targetUserId ||
      "참여자"
    );
    return {
      user_id: targetUserId,
      display_name: displayName,
      profile_image_url: normalizeText(member.profile_image_url),
      avatar_initial: normalizeText(avatarInitialFor(displayName, targetUserId || "U")),
      presence_tone: normalizeText(member.presence_tone || "offline"),
      department: normalizeText(member.department || member.presence_label || ""),
      member_role: normalizeText(member.member_role || "member"),
    };
  }

  function currentCallParticipantSummaries(room, roomCall) {
    const targetRoom = room || state.activeRoom;
    const liveRoom = currentLiveRoom();
    const joinedHere = !!targetRoom && !!liveRoom && Number(state.call.joinedRoomId || 0) === Number(targetRoom.id || 0);
    const roomCallParticipants = Array.isArray(roomCall && roomCall.participants) ? roomCall.participants : [];
    if (joinedHere) {
      return stableParticipantSummariesByCallOrder(targetRoom, roomCall, livekitParticipantSummaries(liveRoom, targetRoom).map(function (summary) {
        const participant = roomCallParticipants.find(function (item) {
          return normalizeText((item || {}).user_id) === normalizeText(summary.userId);
        }) || {};
        const participantStatus = normalizeText((participant && participant.user_id) ? callPreviewSubtitle(participant, targetRoom) : summary.statusText);
        return Object.assign({}, summary, {
          isStage: isStageRoom(targetRoom),
          stageRole: callParticipantStageRole(participant),
          speakerRequested: callParticipantSpeakerRequested(participant),
          serverMuted: !!participant.server_muted,
          deafened: !!participant.deafened || (summary.isLocal && !!state.call.deafened),
          statusText: participantStatus || summary.statusText,
        });
      }));
    }
    if (!roomCall || !Array.isArray(roomCall.participants)) return [];
    return stableParticipantSummariesByCallOrder(targetRoom, roomCall, (roomCall.participants || []).map(function (participant) {
      const userId = normalizeText((participant || {}).user_id);
      const profile = roomMemberProfile(targetRoom, userId, participant.display_name);
      return {
        identity: userId,
        volumeKey: userId,
        userId: userId,
        displayName: profile.display_name,
        department: profile.department,
        memberRole: profile.member_role,
        profileImageUrl: profile.profile_image_url,
        avatarInitial: profile.avatar_initial,
        isLocal: currentUserId() === userId,
        isStage: isStageRoom(targetRoom),
        stageRole: callParticipantStageRole(participant),
        speakerRequested: callParticipantSpeakerRequested(participant),
        isSpeaking: false,
        audioEnabled: !!participant.audio_enabled,
        videoEnabled: !!participant.video_enabled,
        sharingScreen: !!participant.sharing_screen,
        deafened: !!participant.deafened,
        serverMuted: !!participant.server_muted,
        statusText: callPreviewSubtitle(participant, targetRoom),
      };
    }));
  }

  async function refreshCallDevices() {
    if (!(navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === "function")) {
      return;
    }
    let devices = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch (_) {
      devices = [];
    }
    const nextDevices = {
      audioinput: [],
      audiooutput: [],
      videoinput: [],
    };
    (devices || []).forEach(function (device) {
      const kind = normalizeText((device || {}).kind);
      if (!nextDevices[kind]) return;
      nextDevices[kind].push(device);
    });
    state.call.devices = nextDevices;
    state.call.audioOutputSupported = typeof HTMLMediaElement !== "undefined" && typeof HTMLMediaElement.prototype.setSinkId === "function";
    Object.keys(nextDevices).forEach(function (kind) {
      const selectedValue = normalizeText((state.call.selectedDevices || {})[kind]);
      const hasSelectedValue = !!selectedValue && nextDevices[kind].some(function (device) {
        return normalizeText(device.deviceId) === selectedValue;
      });
      if (!hasSelectedValue) {
        state.call.selectedDevices[kind] = normalizeText((nextDevices[kind][0] && nextDevices[kind][0].deviceId) || "");
      }
    });
    persistCallPreferences();
    applyRemoteAudioPreferences();
    if (state.viewMode === "ascord") {
      renderInspector();
    }
    syncNotibaCapture();
  }

  async function applySelectedInputDevices() {
    const room = currentLiveRoom();
    if (!room || typeof room.switchActiveDevice !== "function") return;
    const audioInputId = normalizeText((state.call.selectedDevices || {}).audioinput);
    const videoInputId = normalizeText((state.call.selectedDevices || {}).videoinput);
    if (audioInputId) {
      try {
        await room.switchActiveDevice("audioinput", audioInputId);
      } catch (_) {}
    }
    if (videoInputId && state.call.cameraEnabled) {
      try {
        await room.switchActiveDevice("videoinput", videoInputId);
      } catch (_) {}
    }
    syncNotibaCapture();
  }

  async function switchCallDevice(kind, deviceId) {
    const targetKind = normalizeText(kind);
    const nextDeviceId = normalizeText(deviceId);
    if (!targetKind) return;
    state.call.selectedDevices[targetKind] = nextDeviceId;
    persistCallPreferences();
    const room = currentLiveRoom();
    if (room && typeof room.switchActiveDevice === "function" && nextDeviceId) {
      try {
        await room.switchActiveDevice(targetKind, nextDeviceId);
      } catch (error) {
        if (targetKind === "audiooutput") {
          applyRemoteAudioPreferences();
        } else {
          throw error;
        }
      }
    }
    applyRemoteAudioPreferences();
    renderInspector();
    syncNotibaCapture();
  }

  function shouldKeepNotibaCaptureActive() {
    const roomId = Number(state.call.joinedRoomId || 0);
    const room = findRoomById(roomId) || state.activeRoom;
    return !!roomId
      && !!currentLiveRoom()
      && !!room
      && roomSupportsCalls(room)
      && canSpeakInCall(room);
  }

  function shouldSendNotibaCaptureAudio() {
    const roomId = Number(state.call.joinedRoomId || 0);
    return shouldKeepNotibaCaptureActive()
      && !!state.call.requestedAudioEnabled
      && !!state.call.audioEnabled
      && !state.call.deafened
      && !isServerMutedInRoom(roomId);
  }

  function clearNotibaPartialTimers() {
    const capture = state.notiba.capture;
    Object.keys(capture.partialTimers || {}).forEach(function (itemId) {
      const timerId = capture.partialTimers[itemId];
      if (timerId) {
        window.clearTimeout(timerId);
      }
    });
    capture.partialTimers = {};
  }

  function scheduleNotibaCaptureReconnect(message) {
    const capture = state.notiba.capture;
    if (capture.reconnectTimer || !shouldKeepNotibaCaptureActive()) {
      return;
    }
    if (message) {
      capture.error = normalizeText(message);
    }
    capture.reconnectTimer = window.setTimeout(function () {
      capture.reconnectTimer = 0;
      if (capture.peerConnection || capture.stream) {
        stopNotibaCapture(false);
      }
      if (!shouldKeepNotibaCaptureActive()) return;
      startNotibaCapture().catch(function () {});
    }, 700);
    if (state.roomDrawerOpen) {
      renderRoomDrawer();
    }
  }

  function notibaCaptureTrack(stream) {
    if (!stream || typeof stream.getAudioTracks !== "function") return null;
    return (stream.getAudioTracks()[0]) || null;
  }

  function updateNotibaCaptureTrackState() {
    const track = notibaCaptureTrack(state.notiba.capture.stream);
    if (!track) return;
    track.enabled = shouldSendNotibaCaptureAudio();
  }

  function clearPendingTranscriptsForUser(roomId, userId) {
    const targetRoomId = Number(roomId || 0);
    const normalizedUserId = normalizeText(userId);
    if (targetRoomId <= 0 || !normalizedUserId) return;
    const nextPending = {};
    let changed = false;
    Object.keys(state.notiba.pendingByRoomId[targetRoomId] || {}).forEach(function (key) {
      const entry = state.notiba.pendingByRoomId[targetRoomId][key];
      if (normalizeText(entry && entry.user_id) === normalizedUserId) {
        changed = true;
        return;
      }
      nextPending[key] = entry;
    });
    if (!changed) return;
    if (Object.keys(nextPending).length) {
      state.notiba.pendingByRoomId[targetRoomId] = nextPending;
    } else {
      delete state.notiba.pendingByRoomId[targetRoomId];
    }
    if (state.roomDrawerOpen && Number((state.activeRoom && state.activeRoom.id) || state.activeRoomId || 0) === targetRoomId) {
      renderRoomDrawer();
    }
  }

  function stopNotibaCapture(resetError) {
    const capture = state.notiba.capture;
    const previousRoomId = Number(capture.roomId || 0);
    const stream = capture.stream;
    const peerConnection = capture.peerConnection;
    const dataChannel = capture.dataChannel;
    if (capture.reconnectTimer) {
      window.clearTimeout(capture.reconnectTimer);
      capture.reconnectTimer = 0;
    }
    clearNotibaPartialTimers();
    clearPendingTranscriptsForUser(previousRoomId, currentUserId());
    capture.roomId = 0;
    capture.callId = "";
    capture.deviceId = "";
    capture.stream = null;
    capture.peerConnection = null;
    capture.dataChannel = null;
    capture.sender = null;
    capture.itemTexts = {};
    capture.itemSpokenAtMs = {};
    capture.starting = false;
    if (resetError) {
      capture.error = "";
    }
    if (dataChannel) {
      try {
        dataChannel.close();
      } catch (_) {}
    }
    if (stream && typeof stream.getTracks === "function") {
      stream.getTracks().forEach(function (track) {
        try {
          track.stop();
        } catch (_) {}
      });
    }
    if (peerConnection) {
      try {
        peerConnection.close();
      } catch (_) {}
    }
    if (state.roomDrawerOpen) {
      renderRoomDrawer();
    }
  }

  async function sendNotibaTranscriptEvent(roomId, payload) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0 || !payload || typeof payload !== "object") return null;
    let response = null;
    let responsePayload = {};
    try {
      response = await fetch("/api/messenger/rooms/" + targetRoomId + "/call/transcript-event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      responsePayload = await response.json().catch(function () {
        return {};
      });
    } catch (error) {
      state.notiba.capture.error = normalizeText((error && error.message) || "Notiba AI 전사 이벤트 전송에 실패했습니다.");
      if (state.roomDrawerOpen) {
        renderRoomDrawer();
      }
      return null;
    }
    if (responsePayload.settings) {
      state.notiba.settings = responsePayload.settings;
    }
    if (!response || !response.ok || !responsePayload.ok) {
      const detail = normalizeText(responsePayload.detail || "Notiba AI 전사 처리에 실패했습니다.");
      state.notiba.capture.error = detail;
      if (state.roomDrawerOpen) {
        renderRoomDrawer();
      }
      return null;
    }
    if (normalizeText(state.notiba.capture.error)) {
      state.notiba.capture.error = "";
      if (state.roomDrawerOpen) {
        renderRoomDrawer();
      }
    }
    return responsePayload;
  }

  function flushNotibaPartialEvent(roomId, callId, itemId) {
    const capture = state.notiba.capture;
    const targetRoomId = Number(roomId || 0);
    const normalizedCallId = normalizeText(callId);
    const normalizedItemId = normalizeText(itemId);
    const currentText = normalizeText(capture.itemTexts[normalizedItemId]);
    if (targetRoomId <= 0 || !normalizedCallId || !normalizedItemId || !currentText) return;
    upsertPendingTranscriptEntry(targetRoomId, normalizedCallId, {
      item_id: normalizedItemId,
      user_id: currentUserId(),
      display_name: currentUserName(),
      text: currentText,
      spoken_at: Number(capture.itemSpokenAtMs[normalizedItemId] || (Date.now() / 1000)),
      created_at: Date.now() / 1000,
    });
    sendNotibaTranscriptEvent(targetRoomId, {
      call_id: normalizedCallId,
      item_id: normalizedItemId,
      state: "partial",
      text: currentText,
      spoken_at_ms: Number(capture.itemSpokenAtMs[normalizedItemId] || Date.now()),
    }).catch(function () {});
  }

  function queueNotibaPartialFlush(roomId, callId, itemId) {
    const capture = state.notiba.capture;
    const normalizedItemId = normalizeText(itemId);
    if (!normalizedItemId) return;
    if (capture.partialTimers[normalizedItemId]) {
      window.clearTimeout(capture.partialTimers[normalizedItemId]);
    }
    capture.partialTimers[normalizedItemId] = window.setTimeout(function () {
      delete capture.partialTimers[normalizedItemId];
      flushNotibaPartialEvent(roomId, callId, normalizedItemId);
    }, NOTIBA_REALTIME_PARTIAL_PUSH_MS);
  }

  function handleNotibaRealtimeMessage(event) {
    const capture = state.notiba.capture;
    const roomId = Number(capture.roomId || 0);
    const callId = normalizeText(capture.callId || (callForRoom(roomId) || {}).call_id || state.notiba.callIdByRoomId[roomId]);
    let payload = {};
    try {
      payload = JSON.parse((event && event.data) || "{}");
    } catch (_) {
      payload = {};
    }
    const type = normalizeText(payload.type).toLowerCase();
    if (!type) return;
    if (type === "session.created" || type === "session.updated") {
      capture.error = "";
      if (payload.session) {
        state.notiba.settings = Object.assign({}, state.notiba.settings || {}, {
          provider: "openai_realtime",
          transport: "webrtc",
          type: normalizeText(payload.session.type || "transcription"),
          model: normalizeText((((payload.session.audio || {}).input || {}).transcription || {}).model || (state.notiba.settings && state.notiba.settings.model) || "gpt-4o-transcribe"),
          language: normalizeText((((payload.session.audio || {}).input || {}).transcription || {}).language || "ko"),
        });
      }
      if (state.roomDrawerOpen) {
        renderRoomDrawer();
      }
      return;
    }
    if (type === "error") {
      capture.error = normalizeText((((payload.error || {}).message) || payload.message) || "Notiba AI 연결 중 오류가 발생했습니다.");
      if (state.roomDrawerOpen) {
        renderRoomDrawer();
      }
      return;
    }
    const itemId = normalizeText(payload.item_id);
    if (!itemId || !roomId || !callId) return;
    if (type === "input_audio_buffer.committed") {
      capture.itemSpokenAtMs[itemId] = Date.now();
      return;
    }
    if (type === "conversation.item.input_audio_transcription.delta") {
      const delta = String(payload.delta || "");
      if (!delta) return;
      capture.itemTexts[itemId] = String(capture.itemTexts[itemId] || "") + delta;
      if (!capture.itemSpokenAtMs[itemId]) {
        capture.itemSpokenAtMs[itemId] = Date.now();
      }
      queueNotibaPartialFlush(roomId, callId, itemId);
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const finalText = normalizeText(payload.transcript || capture.itemTexts[itemId]);
      if (capture.partialTimers[itemId]) {
        window.clearTimeout(capture.partialTimers[itemId]);
        delete capture.partialTimers[itemId];
      }
      if (!finalText) {
        clearPendingTranscriptEntry(roomId, currentUserId(), itemId);
        delete capture.itemTexts[itemId];
        delete capture.itemSpokenAtMs[itemId];
        return;
      }
      capture.itemTexts[itemId] = finalText;
      upsertPendingTranscriptEntry(roomId, callId, {
        item_id: itemId,
        user_id: currentUserId(),
        display_name: currentUserName(),
        text: finalText,
        spoken_at: Number(capture.itemSpokenAtMs[itemId] || (Date.now() / 1000)),
        created_at: Date.now() / 1000,
      });
      sendNotibaTranscriptEvent(roomId, {
        call_id: callId,
        item_id: itemId,
        state: "final",
        text: finalText,
        spoken_at_ms: Number(capture.itemSpokenAtMs[itemId] || Date.now()),
      }).then(function (responsePayload) {
        if (!responsePayload || !responsePayload.entry) return;
        if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
          clearPendingTranscriptEntry(roomId, currentUserId(), itemId);
          appendRoomTranscriptEntry(roomId, responsePayload.call_id || callId, responsePayload.entry);
        }
      }).catch(function () {}).finally(function () {
        delete capture.itemTexts[itemId];
        delete capture.itemSpokenAtMs[itemId];
      });
    }
  }

  async function startNotibaCapture() {
    const capture = state.notiba.capture;
    if (capture.starting || capture.peerConnection || !shouldKeepNotibaCaptureActive()) return;
    const RTCPeerConnectionCtor = window.RTCPeerConnection || null;
    if (!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function") || !RTCPeerConnectionCtor) return;
    capture.starting = true;
    capture.error = "";
    const roomId = Number(state.call.joinedRoomId || 0);
    const callId = normalizeText((callForRoom(roomId) || {}).call_id || state.notiba.callIdByRoomId[roomId]);
    const deviceId = normalizeText((state.call.selectedDevices || {}).audioinput);
    try {
      const audioConstraints = {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      if (deviceId) {
        audioConstraints.deviceId = { exact: deviceId };
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
      if (!shouldKeepNotibaCaptureActive() || Number(state.call.joinedRoomId || 0) !== roomId) {
        if (typeof stream.getTracks === "function") {
          stream.getTracks().forEach(function (track) {
            try {
              track.stop();
            } catch (_) {}
          });
        }
        return;
      }
      const peerConnection = new RTCPeerConnectionCtor();
      const dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannel.addEventListener("message", handleNotibaRealtimeMessage);
      dataChannel.addEventListener("open", function () {
        capture.error = "";
        if (state.roomDrawerOpen) {
          renderRoomDrawer();
        }
      });
      dataChannel.addEventListener("close", function () {
        if (capture.dataChannel !== dataChannel) return;
        scheduleNotibaCaptureReconnect("Notiba AI 연결이 끊어져 다시 연결합니다.");
      });
      peerConnection.addEventListener("connectionstatechange", function () {
        if (capture.peerConnection !== peerConnection) return;
        const connectionState = normalizeText(peerConnection.connectionState).toLowerCase();
        if (connectionState === "failed" || connectionState === "disconnected" || connectionState === "closed") {
          scheduleNotibaCaptureReconnect("Notiba AI 연결이 끊어져 다시 연결합니다.");
        }
      });
      const track = notibaCaptureTrack(stream);
      if (!track) {
        throw new Error("Notiba AI용 마이크 트랙을 찾지 못했습니다.");
      }
      const sender = peerConnection.addTrack(track, stream);
      const sessionResponse = await fetch("/api/messenger/rooms/" + roomId + "/call/transcription/session", {
        method: "POST",
        cache: "no-store",
      });
      const sessionPayload = await sessionResponse.json().catch(function () {
        return {};
      });
      if (!sessionResponse.ok || !sessionPayload.ok) {
        const detail = normalizeText(sessionPayload.detail || "Notiba AI 세션을 열지 못했습니다.");
        throw new Error(detail);
      }
      if (sessionPayload.settings) {
        state.notiba.settings = sessionPayload.settings;
      }
      const ephemeralKey = normalizeText(sessionPayload.value);
      if (!ephemeralKey) {
        throw new Error("Notiba AI 세션 토큰을 받지 못했습니다.");
      }
      const openAiBaseUrl = normalizeText((sessionPayload.settings && sessionPayload.settings.api_base_url) || "https://api.openai.com").replace(/\/+$/, "");
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      const openAiResponse = await fetch(openAiBaseUrl + "/v1/realtime/calls", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + ephemeralKey,
          "Content-Type": "application/sdp",
        },
        body: String((offer && offer.sdp) || ""),
        cache: "no-store",
      });
      const rawAnswer = await openAiResponse.text();
      if (!openAiResponse.ok) {
        throw new Error(normalizeText(rawAnswer) || "OpenAI Realtime 연결에 실패했습니다.");
      }
      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: rawAnswer,
      });
      capture.roomId = roomId;
      capture.callId = callId;
      capture.deviceId = deviceId;
      capture.stream = stream;
      capture.peerConnection = peerConnection;
      capture.dataChannel = dataChannel;
      capture.sender = sender;
      capture.itemTexts = {};
      capture.itemSpokenAtMs = {};
      clearNotibaPartialTimers();
      updateNotibaCaptureTrackState();
    } catch (error) {
      capture.error = normalizeText((error && error.message) || "Notiba AI 실시간 전사를 시작하지 못했습니다.");
      stopNotibaCapture(false);
    } finally {
      capture.starting = false;
      if (state.roomDrawerOpen) {
        renderRoomDrawer();
      }
    }
  }

  function syncNotibaCapture() {
    const capture = state.notiba.capture;
    const roomId = Number(state.call.joinedRoomId || 0);
    const deviceId = normalizeText((state.call.selectedDevices || {}).audioinput);
    if (!shouldKeepNotibaCaptureActive()) {
      stopNotibaCapture(true);
      return;
    }
    if (capture.peerConnection && capture.stream && capture.roomId === roomId && capture.deviceId === deviceId) {
      updateNotibaCaptureTrackState();
      return;
    }
    if (capture.peerConnection && capture.stream && (capture.roomId !== roomId || capture.deviceId !== deviceId)) {
      stopNotibaCapture(true);
    }
    startNotibaCapture().catch(function () {});
  }

  async function sendCallModerationAction(action, targetUserId, room) {
    const targetRoom = room || state.activeRoom;
    const targetRoomId = Number((targetRoom && targetRoom.id) || 0);
    const normalizedAction = normalizeText(action).toLowerCase();
    const normalizedUserId = normalizeText(targetUserId);
    if (targetRoomId <= 0 || !normalizedAction || !normalizedUserId) return;
    const payload = await api("/api/messenger/rooms/" + targetRoomId + "/call/moderate", {
      method: "POST",
      body: JSON.stringify({
        action: normalizedAction,
        target_user_id: normalizedUserId,
      }),
    });
    if (payload && payload.call) {
      await handleCallStateUpdate(payload.call);
    }
    if (normalizedAction === "grant_speaker") {
      await showToast("success", "발표자 권한을 승인했습니다.");
      return;
    }
    if (normalizedAction === "move_to_audience") {
      await showToast("success", "청중 권한으로 전환했습니다.");
    }
  }

  async function sendStageRequestAction(action, room) {
    const targetRoom = room || state.activeRoom;
    const targetRoomId = Number((targetRoom && targetRoom.id) || 0);
    const normalizedAction = normalizeText(action).toLowerCase();
    if (targetRoomId <= 0 || !normalizedAction) return;
    const payload = await api("/api/messenger/rooms/" + targetRoomId + "/call/stage", {
      method: "POST",
      body: JSON.stringify({ action: normalizedAction }),
    });
    if (payload && payload.call) {
      await handleCallStateUpdate(payload.call);
    }
    if (normalizedAction === "request_speaker") {
      await showToast("success", "발언 요청을 보냈습니다.");
      return;
    }
    if (normalizedAction === "withdraw_request") {
      await showToast("success", "발언 요청을 취소했습니다.");
      return;
    }
    if (normalizedAction === "move_self_to_audience") {
      await showToast("success", "청중으로 전환했습니다.");
    }
  }

  async function updateRoomMemberRole(targetUserId, memberRole, room) {
    const targetRoom = room || state.activeRoom;
    const targetRoomId = Number((targetRoom && targetRoom.id) || 0);
    const normalizedUserId = normalizeText(targetUserId);
    const normalizedRole = normalizeMemberRole(memberRole);
    if (targetRoomId <= 0 || !normalizedUserId) return;
    const payload = await api("/api/messenger/rooms/" + targetRoomId + "/members/" + encodeURIComponent(normalizedUserId), {
      method: "PATCH",
      body: JSON.stringify({ member_role: normalizedRole }),
    });
    if (payload && payload.room) {
      mergeRoom(payload.room);
      state.activeRoom = currentRoom();
    }
    await showToast("success", normalizedRole === "admin" ? "ADMIN 권한을 부여했습니다." : "일반 멤버로 변경했습니다.");
  }

  async function removeMemberFromRoom(targetUserId, room) {
    const targetRoom = room || state.activeRoom;
    const targetRoomId = Number((targetRoom && targetRoom.id) || 0);
    const normalizedUserId = normalizeText(targetUserId);
    if (targetRoomId <= 0 || !normalizedUserId) return;
    const member = findMemberByUserId(targetRoom, normalizedUserId) || findContactByUserId(normalizedUserId) || {};
    const displayName = normalizeText(member.display_name || member.name || normalizedUserId);
    if (!await askConfirm("구성원 제거", displayName + "님을 이 채널에서 제거할까요?", "제거", "warning")) return;
    const payload = await api("/api/messenger/rooms/" + targetRoomId + "/members/" + encodeURIComponent(normalizedUserId), {
      method: "DELETE",
    });
    if (payload && payload.room) {
      mergeRoom(payload.room);
      state.activeRoom = currentRoom();
    }
    await showToast("success", "구성원을 채널에서 제거했습니다.");
  }

  async function transferRoomOwner(targetUserId, room) {
    const targetRoom = room || state.activeRoom;
    const targetRoomId = Number((targetRoom && targetRoom.id) || 0);
    const normalizedUserId = normalizeText(targetUserId);
    if (targetRoomId <= 0 || !normalizedUserId) return;
    const member = findMemberByUserId(targetRoom, normalizedUserId) || findContactByUserId(normalizedUserId) || {};
    const displayName = normalizeText(member.display_name || member.name || normalizedUserId);
    if (!await askConfirm("OWNER 이전", displayName + "님에게 OWNER 권한을 이전할까요?", "이전", "warning")) return;
    const payload = await api("/api/messenger/rooms/" + targetRoomId + "/members/" + encodeURIComponent(normalizedUserId) + "/transfer-owner", {
      method: "POST",
    });
    if (payload && payload.room) {
      mergeRoom(payload.room);
      state.activeRoom = currentRoom();
    }
    await showToast("success", "OWNER 권한을 이전했습니다.");
  }

  async function leaveRoom(room) {
    const targetRoom = room || state.activeRoom;
    const targetRoomId = Number((targetRoom && targetRoom.id) || 0);
    if (targetRoomId <= 0) return;
    if (!await askConfirm("채널 나가기", "이 채널에서 나갈까요?", "나가기", "warning")) return;
    const payload = await api("/api/messenger/rooms/" + targetRoomId + "/leave", {
      method: "POST",
    });
    if (payload && payload.room_id) {
      removeRoom(payload.room_id);
    }
    await showToast("success", "채널에서 나갔습니다.");
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

  function livekitConnectionErrorLooksTransient(error) {
    const message = normalizeText((error && error.message) || error).toLowerCase();
    return message.indexOf("client initiated disconnect") !== -1
      || message.indexOf("abort handler called") !== -1
      || message.indexOf("could not establish signal connection") !== -1;
  }

  function livekitPermissionDenied(error) {
    const name = normalizeText((error && error.name) || "").toLowerCase();
    const message = normalizeText((error && error.message) || error).toLowerCase();
    return name === "notallowederror"
      || name === "permissiondeniederror"
      || message.indexOf("permission denied") !== -1
      || message.indexOf("notallowederror") !== -1
      || message.indexOf("permission dismissed") !== -1;
  }

  function livekitDeviceMissing(error) {
    const name = normalizeText((error && error.name) || "").toLowerCase();
    const message = normalizeText((error && error.message) || error).toLowerCase();
    return name === "notfounderror"
      || message.indexOf("requested device not found") !== -1
      || message.indexOf("could not start video source") !== -1
      || message.indexOf("could not start audio source") !== -1
      || message.indexOf("device not found") !== -1;
  }

  function formatCallCaptureWarmupError(error, mode) {
    const requestedMode = normalizeText(mode).toLowerCase() === "video" ? "video" : "audio";
    if (livekitPermissionDenied(error)) {
      return requestedMode === "video"
        ? "브라우저에서 마이크 또는 카메라 권한이 차단되어 있습니다. 주소창 자물쇠 아이콘의 사이트 설정에서 마이크/카메라를 허용한 뒤 다시 시도해주세요."
        : "브라우저에서 마이크 권한이 차단되어 있습니다. 주소창 자물쇠 아이콘의 사이트 설정에서 마이크를 허용한 뒤 다시 시도해주세요.";
    }
    if (livekitDeviceMissing(error)) {
      return requestedMode === "video"
        ? "사용 가능한 마이크 또는 카메라 장치를 찾지 못했습니다. 장치 연결 상태를 확인한 뒤 다시 시도해주세요."
        : "사용 가능한 마이크 장치를 찾지 못했습니다. 장치 연결 상태를 확인한 뒤 다시 시도해주세요.";
    }
    return normalizeText((error && error.message) || error) || "통화에 필요한 장치를 준비하지 못했습니다.";
  }

  async function warmupCallCapturePermissions(mode, options) {
    const settings = options || {};
    const requestedMode = normalizeText(mode).toLowerCase() === "video" ? "video" : "audio";
    const audioRequired = settings.audioRequired !== false;
    if (!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function")) {
      return { effectiveMode: requestedMode, warning: "" };
    }

    const requestDevices = async function (constraints) {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stopStreamTracks(stream);
      return stream;
    };

    if (requestedMode === "video") {
      if (!audioRequired) {
        try {
          await requestDevices({ audio: false, video: true });
          await refreshCallDevices().catch(function () {});
          return { effectiveMode: "video", warning: "" };
        } catch (error) {
          await refreshCallDevices().catch(function () {});
          if (livekitPermissionDenied(error) || livekitDeviceMissing(error)) {
            return {
              effectiveMode: "audio",
              warning: livekitPermissionDenied(error)
                ? "카메라 권한이 없어 듣기 전용으로 입장합니다."
                : "카메라 장치를 준비하지 못해 듣기 전용으로 입장합니다.",
            };
          }
          throw error;
        }
      }
      try {
        await requestDevices({ audio: true, video: true });
        await refreshCallDevices().catch(function () {});
        return { effectiveMode: "video", warning: "" };
      } catch (error) {
        try {
          await requestDevices({ audio: true, video: false });
          await refreshCallDevices().catch(function () {});
          return {
            effectiveMode: "audio",
            warning: livekitPermissionDenied(error)
              ? "카메라 권한이 없어 음성으로 입장합니다."
              : "카메라 장치를 준비하지 못해 음성으로 입장합니다.",
          };
        } catch (audioError) {
          throw audioError || error;
        }
      }
    }

    if (!audioRequired) {
      await refreshCallDevices().catch(function () {});
      return { effectiveMode: "audio", warning: "" };
    }
    await requestDevices({ audio: true, video: false });
    await refreshCallDevices().catch(function () {});
    return { effectiveMode: "audio", warning: "" };
  }

  function formatLivekitConnectionError(error) {
    const rawMessage = normalizeText((error && error.message) || error);
    const message = rawMessage.toLowerCase();
    if (!rawMessage) {
      return "통화 시작에 실패했습니다.";
    }
    if (livekitPermissionDenied(error)) {
      return "브라우저에서 마이크/카메라 권한이 차단되어 통화에 연결하지 못했습니다. 주소창 자물쇠 아이콘의 사이트 설정에서 권한을 허용한 뒤 다시 시도해주세요.";
    }
    if (message.indexOf("could not establish pc connection") !== -1) {
      return "미디어 연결을 만들지 못했습니다. 브라우저 권한과 TURN/TLS 443 경로, 그리고 서버 릴레이 포트(30000-30100/UDP) 외부 개방 상태를 함께 확인해주세요.";
    }
    if (message.indexOf("could not establish signal connection") !== -1) {
      return "시그널 연결을 만들지 못했습니다. HTTPS/WSS 연결, LiveKit 서버 상태, TURN/TLS 443 경로, 그리고 브라우저 마이크/카메라 권한 차단 여부를 함께 확인해주세요.";
    }
    return rawMessage;
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

  function callParticipantCount(roomCall, roomId) {
    const targetRoomId = Number(roomId || (roomCall && roomCall.room_id) || 0);
    const liveRoom = targetRoomId > 0 && Number(state.call.joinedRoomId || 0) === targetRoomId ? currentLiveRoom() : null;
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
      if (roomId > 0) {
        delete state.call.serverMutedRoomIds[roomId];
      }
      state.call.liveRoom = null;
      state.call.liveRoomName = "";
      state.call.liveParticipantIdentity = "";
      state.call.joinedRoomId = 0;
      state.call.joining = false;
      state.call.requestedAudioEnabled = true;
      state.call.audioEnabled = true;
      state.call.cameraEnabled = false;
      state.call.sharingScreen = false;
      state.call.deafened = false;
      state.call.pushToTalkPressed = false;
      state.call.pinnedTrackId = "";
      renderCallUi();
      renderRoomList();
      renderInspector();
      if (roomId > 0) {
        sendSocket({ type: "call_leave", room_id: roomId });
      }
    });
  }

  async function connectLiveKitRoom(roomId, mode, mediaOptions) {
    const options = mediaOptions || {};
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
      await disconnectLiveKitRoom(false, { playSound: false });
      await delayMs(120);
    }
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await requestCallSession(targetRoomId, requestedMode);
      if (!session || !session.server_url || !session.participant_token) {
        throw new Error("통화 세션 정보를 불러오지 못했습니다.");
      }
      const effectiveMode = normalizeText(session.preferred_mode).toLowerCase() === "video" ? "video" : "audio";
      const shouldEnableMicrophone = options.enableMicrophone !== false;
      const shouldEnableCamera = effectiveMode === "video" && !!options.enableCamera;

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
      try {
        await room.connect(session.server_url, session.participant_token);
        state.call.liveRoom = room;
        state.call.liveRoomName = normalizeText(session.room_name);
        state.call.liveParticipantIdentity = normalizeText(session.participant_identity);
        state.call.requestedMode = effectiveMode;
        state.call.joinedRoomId = targetRoomId;
        try {
          if (typeof room.startAudio === "function") {
            await room.startAudio();
          }
        } catch (_) {}
        let mediaEnableError = null;
        try {
          if (shouldEnableCamera && shouldEnableMicrophone && room.localParticipant.enableCameraAndMicrophone) {
            await room.localParticipant.enableCameraAndMicrophone();
          } else {
            await room.localParticipant.setMicrophoneEnabled(shouldEnableMicrophone);
            await room.localParticipant.setCameraEnabled(shouldEnableCamera);
          }
        } catch (mediaError) {
          mediaEnableError = mediaError || null;
          try {
            await room.localParticipant.setCameraEnabled(false);
          } catch (_) {}
          try {
            await room.localParticipant.setMicrophoneEnabled(false);
          } catch (_) {}
          state.call.requestedAudioEnabled = false;
          state.call.micBeforeDeafen = false;
        }
        await applySelectedInputDevices();
        refreshCallDevices().catch(function () {});
        syncLocalMediaStateFromLiveRoom();
        if (mediaEnableError) {
          await showToast(
            "warning",
            livekitPermissionDenied(mediaEnableError)
              ? "마이크 또는 카메라 권한이 막혀 있어 듣기 전용으로 입장했습니다."
              : "마이크 또는 카메라를 켜지 못해 듣기 전용으로 입장했습니다."
          ).catch(function () {});
        }
        return room;
      } catch (error) {
        try {
          console.error("[ABBASMessenger:livekit-connect]", {
            roomId: targetRoomId,
            requestedMode: requestedMode,
            attempt: attempt + 1,
            serverUrl: session.server_url,
            error: error,
          });
        } catch (_) {}
        lastError = error;
        if (state.call.liveRoom === room) {
          await disconnectLiveKitRoom(false, { playSound: false });
        } else {
          try {
            const disconnectResult = room && typeof room.disconnect === "function" ? room.disconnect() : null;
            if (disconnectResult && typeof disconnectResult.then === "function") {
              await disconnectResult.catch(function () {});
            }
          } catch (_) {}
        }
        if (attempt === 0 && livekitConnectionErrorLooksTransient(error)) {
          await delayMs(180);
          continue;
        }
        throw error;
      }
    }
    throw lastError || new Error("통화 연결에 실패했습니다.");
  }

  async function disconnectLiveKitRoom(notifyServer, options) {
    const settings = options || {};
    const room = currentLiveRoom();
    const roomId = Number(state.call.joinedRoomId || 0);
    const roomMeta = findRoomById(roomId) || state.activeRoom;
    const shouldPlayOutSound = settings.playSound !== false && shouldPlayAscordSound(roomMeta);
    if (roomId > 0) {
      delete state.call.serverMutedRoomIds[roomId];
    }
    state.call.liveRoom = null;
    state.call.liveRoomName = "";
    state.call.liveParticipantIdentity = "";
    state.call.joinedRoomId = 0;
    state.call.joining = false;
    state.call.requestedMode = "";
    state.call.requestedAudioEnabled = true;
    state.call.audioEnabled = true;
    state.call.cameraEnabled = false;
    state.call.sharingScreen = false;
    state.call.deafened = false;
    state.call.pushToTalkPressed = false;
    state.call.pinnedTrackId = "";
    stopNotibaCapture(true);
    if (notifyServer && roomId > 0) {
      sendSocket({ type: "call_leave", room_id: roomId });
    }
    try {
      if (room && typeof room.disconnect === "function") {
        const disconnectResult = room.disconnect();
        if (disconnectResult && typeof disconnectResult.then === "function") {
          await disconnectResult.catch(function () {});
        }
      }
    } catch (_) {}
    if (dom.callAudioSink) {
      dom.callAudioSink.innerHTML = "";
    }
    state.call.lastAudioSinkSignature = "";
    if (shouldPlayOutSound) {
      playAscordOutSound(roomMeta);
    }
  }

  function livekitParticipantDisplayName(participant, fallback) {
    const payload = participant || {};
    return normalizeText(payload.name || payload.identity || fallback || "참여자");
  }

  function livekitParticipantSummaries(room, roomMeta) {
    const sdk = livekitSdk();
    const targetRoom = room || null;
    const targetRoomMeta = roomMeta || state.activeRoom;
    if (!sdk || !targetRoom) return [];
    const speakingIds = currentActiveSpeakerIdentities(targetRoom);
    const summaries = [];
    const pushParticipant = function (participant, isLocal) {
      const identity = normalizeText((participant || {}).identity);
      const userId = livekitIdentityUserId(identity);
      const rawDisplayName = livekitParticipantDisplayName(participant, isLocal ? "나" : "참여자");
      const micPublication = callTrackPublication(participant, sdk.Track.Source.Microphone);
      const cameraPublication = callTrackPublication(participant, sdk.Track.Source.Camera);
      const screenPublication = callTrackPublication(participant, sdk.Track.Source.ScreenShare);
      const profile = roomMemberProfile(targetRoomMeta, userId, rawDisplayName);
      summaries.push({
        identity: identity,
        volumeKey: identity,
        userId: userId,
        displayName: profile.display_name,
        department: profile.department,
        memberRole: profile.member_role,
        profileImageUrl: profile.profile_image_url,
        avatarInitial: profile.avatar_initial,
        isLocal: !!isLocal,
        isSpeaking: speakingIds.has(identity),
        audioEnabled: !!(micPublication && !micPublication.isMuted),
        videoEnabled: !!(cameraPublication && !cameraPublication.isMuted),
        sharingScreen: !!(screenPublication && !screenPublication.isMuted),
        deafened: !!isLocal && !!state.call.deafened,
        statusText: profile.department || (screenPublication && !screenPublication.isMuted ? "화면 공유 중" : (cameraPublication && !cameraPublication.isMuted ? "카메라 송출 중" : (micPublication && !micPublication.isMuted ? "음성 연결됨" : "대기 중"))),
      });
    };
    if (targetRoom.localParticipant) {
      pushParticipant(targetRoom.localParticipant, true);
    }
    if (targetRoom.remoteParticipants && typeof targetRoom.remoteParticipants.forEach === "function") {
      targetRoom.remoteParticipants.forEach(function (participant) {
        pushParticipant(participant, false);
      });
    }
    return sortStageAwareEntries(targetRoomMeta, summaries);
  }

  function livekitParticipantRenderItems(room) {
    const sdk = livekitSdk();
    const targetRoom = room || null;
    if (!sdk || !targetRoom) return [];
    const visualItems = [];
    const audioItems = [];
    const speakingIds = currentActiveSpeakerIdentities(targetRoom);
    const pushParticipant = function (participant, isLocal) {
      const identity = normalizeText((participant || {}).identity);
      const userId = livekitIdentityUserId(identity);
      const rawDisplayName = livekitParticipantDisplayName(participant, isLocal ? "나" : "참여자");
      const micPublication = callTrackPublication(participant, sdk.Track.Source.Microphone);
      const cameraPublication = callTrackPublication(participant, sdk.Track.Source.Camera);
      const screenPublication = callTrackPublication(participant, sdk.Track.Source.ScreenShare);
      const micEnabled = !!(micPublication && !micPublication.isMuted);
      const cameraEnabled = !!(cameraPublication && !cameraPublication.isMuted);
      const screenEnabled = !!(screenPublication && !screenPublication.isMuted);
      const profile = roomMemberProfile(findRoomById(state.call.joinedRoomId) || state.activeRoom, userId, rawDisplayName);
      if (cameraEnabled) {
        visualItems.push({
          id: identity + "::camera",
          identity: identity,
          userId: userId,
          kind: "camera",
          displayName: profile.display_name,
          subtitle: "카메라",
          participant: participant,
          publication: cameraPublication,
          track: callPublicationTrack(cameraPublication),
          isLocal: !!isLocal,
          audioEnabled: micEnabled,
          isSpeaking: speakingIds.has(identity),
        });
      }
      if (screenEnabled) {
        visualItems.push({
          id: identity + "::screen",
          identity: identity,
          userId: userId,
          kind: "screen",
          displayName: profile.display_name,
          subtitle: "화면 공유",
          participant: participant,
          publication: screenPublication,
          track: callPublicationTrack(screenPublication),
          isLocal: !!isLocal,
          audioEnabled: micEnabled,
          isSpeaking: speakingIds.has(identity),
        });
      }
      if (!cameraEnabled && !screenEnabled) {
        audioItems.push({
          id: identity + "::audio",
          identity: identity,
          userId: userId,
          kind: "audio",
          displayName: profile.display_name,
          subtitle: micEnabled ? "음성 연결됨" : "대기 중",
          participant: participant,
          publication: null,
          track: null,
          isLocal: !!isLocal,
          audioEnabled: micEnabled,
          isSpeaking: speakingIds.has(identity),
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
    return sortStageAwareEntries(
      findRoomById(state.call.joinedRoomId) || state.activeRoom,
      visualItems.concat(audioItems)
    );
  }

  function callGridDensity(itemCount) {
    const count = Number(itemCount || 0);
    if (count >= 41) return "ultra";
    if (count >= 25) return "dense";
    if (count >= 13) return "compact";
    return "default";
  }

  function callItemPriority(item) {
    const payload = item || {};
    let score = 0;
    if (normalizeText(payload.id) && normalizeText(payload.id) === normalizeText(state.call.pinnedTrackId)) score += 100;
    if (payload.kind === "screen") score += 40;
    if (payload.isSpeaking) score += 30;
    if (payload.track) score += 20;
    if (payload.audioEnabled) score += 8;
    if (payload.isLocal) score += 4;
    return score;
  }

  function orderedCallRenderItems(items) {
    const roomMeta = findRoomById(state.call.joinedRoomId) || state.activeRoom;
    const stageMode = isStageRoom(roomMeta);
    return (Array.isArray(items) ? items.slice() : []).sort(function (a, b) {
      const pinnedDiff = Number(normalizeText((b && b.id) || "") === normalizeText(state.call.pinnedTrackId)) - Number(normalizeText((a && a.id) || "") === normalizeText(state.call.pinnedTrackId));
      if (pinnedDiff !== 0) return pinnedDiff;
      if (stageMode) {
        const participantDiff = callParticipantOrderIndex(roomMeta, a && a.userId) - callParticipantOrderIndex(roomMeta, b && b.userId);
        if (participantDiff !== 0) return participantDiff;
      }
      return callItemPriority(b) - callItemPriority(a)
        || Number(!!b.isSpeaking) - Number(!!a.isSpeaking)
        || Number(!!b.track) - Number(!!a.track)
        || Number(!!b.audioEnabled) - Number(!!a.audioEnabled);
    });
  }

  function togglePinnedTrack(itemId) {
    const nextId = normalizeText(itemId);
    state.call.pinnedTrackId = state.call.pinnedTrackId === nextId ? "" : nextId;
    renderCallUi();
    if (state.viewMode === "ascord") {
      renderInspector();
    }
  }

  function renderCallPrompt(roomCall) {
    if (!dom.callGrid) return;
    state.call.lastRenderItems = [];
    state.call.lastAudioSinkSignature = "";
    dom.callGrid.classList.remove("is-empty-ascord");
    if (dom.callStage) {
      dom.callStage.classList.remove("is-empty-ascord");
    }
    Array.prototype.forEach.call(dom.callGrid.querySelectorAll(".messenger-call-card__media-slot"), function (slot) {
      clearMountedLiveKitTrack(slot);
    });
    const room = state.activeRoom;
    const count = callParticipantCount(roomCall);
    const isAscord = state.viewMode === "ascord";
    const joinedHere = !!room && Number(state.call.joinedRoomId || 0) === Number(room.id || 0) && !!currentLiveRoom();
    const canJoinNow = !!room && livekitConfigured() && livekitAvailable() && canJoinCall(room);
    const canLaunchCallNow = !!room && canJoinNow && (!!roomCall || canStartCall(room));
    dom.callGrid.setAttribute("data-density", "default");
    dom.callGrid.setAttribute("data-layout", sanitizeCallLayout(state.call.layoutMode));
    if (isAscord) {
      dom.callGrid.classList.add("is-empty-ascord");
      if (dom.callStage) {
        dom.callStage.classList.add("is-empty-ascord");
      }
      const joinLabel = roomChannelMode(room) === "stage"
        ? (count > 0 ? "스테이지 참가하기" : "스테이지 시작하기")
        : (Number(state.call.joinedRoomId || 0) > 0 && !joinedHere ? "이 채널로 전환하기" : "음성 채널 참가하기");
      const title = normalizeText((room && room.title) || "ASCORD 음성 채널");
      const description = count > 0
        ? ("현재 " + count + "명이 이 채널에 있어요.")
        : "현재 음성 채널에 아무도 없어요";
      dom.callGrid.innerHTML = [
        '<div class="messenger-call-empty messenger-call-empty--ascord">',
        '<div class="messenger-call-empty__orb"></div>',
        '<div class="messenger-call-empty__stage">',
        '<strong class="messenger-call-empty__title">' + escapeHtml(title) + "</strong>",
        '<span class="messenger-call-empty__copy">' + escapeHtml(description) + "</span>",
        '<button class="messenger-call-empty__join" type="button" data-call-prompt-action="join-audio"' + ((!canLaunchCallNow || joinedHere || state.call.joining) ? " disabled" : "") + '><span>' + escapeHtml(joinLabel) + "</span></button>",
        '</div>',
        "</div>",
      ].join("");
      if (dom.callAudioSink) {
        dom.callAudioSink.innerHTML = "";
      }
      return;
    }
    dom.callGrid.innerHTML = [
      '<div class="messenger-call-empty">',
      '<i class="bi bi-camera-video"></i>',
      '<strong>' + escapeHtml("이 대화방 통화에 참여할 수 있습니다.") + "</strong>",
      '<span>' + escapeHtml(count > 0 ? (count + "명이 이미 연결되어 있습니다. 참여 버튼을 눌러 바로 합류하세요.") : "음성 또는 영상 통화를 시작하면 카메라를 켠 참가자들이 모두 그리드에 표시됩니다.") + "</span>",
      "</div>",
    ].join("");
    if (dom.callAudioSink) {
      dom.callAudioSink.innerHTML = "";
    }
  }

  function attachLiveKitTrack(track, mountPoint, isLocal) {
    const nextTrackKey = liveKitTrackKey(track);
    if (!nextTrackKey || !mountPoint || typeof track.attach !== "function") return false;
    const existingElement = mountPoint.__livekitElement || mountPoint.firstElementChild || null;
    if (normalizeText(mountPoint.dataset.callTrackKey) === nextTrackKey && existingElement instanceof HTMLMediaElement) {
      existingElement.autoplay = true;
      existingElement.playsInline = true;
      existingElement.muted = !!isLocal;
      const hostCard = mountPoint.closest("[data-call-card-user], .messenger-call-fullscreen__media");
      const isReady = existingElement.classList.contains("is-ready") || existingElement.readyState >= 2;
      if (hostCard) {
        hostCard.classList.toggle("has-video", isReady);
      }
      return true;
    }
    clearMountedLiveKitTrack(mountPoint);
    if (!track || !mountPoint || typeof track.attach !== "function") return false;
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
      element.classList.add("is-pending");
      const markReady = function () {
        if (mountPoint.__livekitElement !== element) return;
        element.classList.remove("is-pending");
        element.classList.add("is-ready");
        const hostCard = mountPoint.closest("[data-call-card-user], .messenger-call-fullscreen__media");
        if (hostCard) {
          hostCard.classList.add("has-video");
        }
      };
      element.addEventListener("loadeddata", markReady, { once: true });
      element.addEventListener("canplay", markReady, { once: true });
      element.addEventListener("playing", markReady, { once: true });
      if (typeof element.requestVideoFrameCallback === "function") {
        try {
          element.requestVideoFrameCallback(function () {
            markReady();
          });
        } catch (_) {}
      }
      if (element.readyState >= 2) {
        markReady();
      } else {
        let readyPollCount = 0;
        const pollReadyState = function () {
          if (mountPoint.__livekitElement !== element) return;
          if (element.readyState >= 2 || (!element.paused && element.currentTime > 0)) {
            markReady();
            return;
          }
          readyPollCount += 1;
          if (readyPollCount >= 12) return;
          window.setTimeout(pollReadyState, 120);
        };
        window.setTimeout(pollReadyState, 120);
      }
    }
    element.classList.add("messenger-call-card__video");
    mountPoint.dataset.callTrackKey = nextTrackKey;
    mountPoint.__livekitTrack = track;
    mountPoint.__livekitElement = element;
    mountPoint.appendChild(element);
    return true;
  }

  function clearMountedLiveKitTrack(mountPoint) {
    if (!mountPoint) return;
    const previousTrack = mountPoint.__livekitTrack || null;
    const previousElement = mountPoint.__livekitElement || mountPoint.firstElementChild || null;
    if (previousTrack && typeof previousTrack.detach === "function") {
      try {
        previousTrack.detach(previousElement || undefined);
      } catch (_) {}
    }
    while (mountPoint.firstChild) {
      mountPoint.removeChild(mountPoint.firstChild);
    }
    mountPoint.__livekitTrack = null;
    mountPoint.__livekitElement = null;
    mountPoint.dataset.callTrackKey = "";
  }

  function liveKitTrackKey(track) {
    const payload = track || null;
    if (!payload) return "";
    const mediaStreamTrack = payload.mediaStreamTrack || null;
    return normalizeText(
      payload.sid
      || payload.id
      || (mediaStreamTrack && mediaStreamTrack.id)
      || payload.name
      || payload.source
      || ""
    );
  }

  function applyRemoteAudioPreferences() {
    if (!dom.callAudioSink) return;
    Array.prototype.forEach.call(dom.callAudioSink.querySelectorAll("audio, video"), function (element) {
      if (!(element instanceof HTMLMediaElement)) return;
      const identity = normalizeText(element.getAttribute("data-participant-identity"));
      element.muted = !!state.call.deafened;
      element.volume = participantVolume(identity);
      const sinkId = normalizeText((state.call.selectedDevices || {}).audiooutput);
      if (sinkId && typeof element.setSinkId === "function") {
        element.setSinkId(sinkId).catch(function () {});
      }
    });
  }

  function renderCallAudioSink(room) {
    const sdk = livekitSdk();
    const targetRoom = room || null;
    if (!dom.callAudioSink) return;
    const sinkItems = [];
    if (!sdk || !targetRoom || !targetRoom.remoteParticipants) return;
    targetRoom.remoteParticipants.forEach(function (participant) {
      const publication = callTrackPublication(participant, sdk.Track.Source.Microphone);
      const track = callPublicationTrack(publication);
      if (!publication || publication.isMuted || !track || typeof track.attach !== "function") return;
      sinkItems.push({
        identity: normalizeText((participant || {}).identity),
        track: track,
        trackKey: liveKitTrackKey(track),
      });
    });
    const signature = sinkItems.map(function (item) {
      return item.identity + "::" + item.trackKey;
    }).join("|");
    if (signature === state.call.lastAudioSinkSignature) {
      applyRemoteAudioPreferences();
      return;
    }
    state.call.lastAudioSinkSignature = signature;
    const fragment = document.createDocumentFragment();
    sinkItems.forEach(function (item) {
      let element = null;
      try {
        element = item.track.attach();
      } catch (_) {
        element = null;
      }
      if (!(element instanceof HTMLMediaElement)) return;
      element.autoplay = true;
      element.playsInline = true;
      element.setAttribute("data-participant-identity", item.identity);
      fragment.appendChild(element);
    });
    dom.callAudioSink.innerHTML = "";
    dom.callAudioSink.appendChild(fragment);
    applyRemoteAudioPreferences();
  }

  function callCardPillsMarkup(item) {
    const payload = item || {};
    return [
      '<span class="messenger-call-card__pill ' + (payload.audioEnabled ? 'is-on' : 'is-off') + '">' + (payload.audioEnabled ? 'MIC ON' : 'MIC OFF') + '</span>',
      '<span class="messenger-call-card__pill ' + (payload.track ? 'is-on' : 'is-off') + '">' + (payload.track ? 'VIDEO ON' : 'VIDEO OFF') + '</span>',
      payload.kind === "screen" ? '<span class="messenger-call-card__pill is-screen">SCREEN</span>' : "",
    ].join("");
  }

  function callCardMarkup(item, index) {
    const payload = item || {};
    const avatarInitial = normalizeText(payload.avatarInitial || avatarInitialFor(payload.displayName, payload.displayName));
    const isPinned = normalizeText(payload.id) === normalizeText(state.call.pinnedTrackId);
    const cardStyle = callCardToneStyle(payload);
    return [
      '<article class="messenger-call-card' + (payload.isSpeaking ? ' is-speaking' : '') + (isPinned ? ' is-pinned' : '') + (state.call.layoutMode === "speaker" && index === 0 ? ' is-primary' : '') + '" data-call-card-user="' + escapeAttribute(payload.id) + '" style="' + escapeAttribute(cardStyle) + '">',
      '<div class="messenger-call-card__placeholder">' + escapeHtml(avatarInitial || "U") + "</div>",
      '<div class="messenger-call-card__media-slot" data-call-media-user="' + escapeAttribute(payload.id) + '"></div>',
      (isPinned ? '<div class="messenger-call-card__pin-badge" aria-hidden="true"><i class="bi bi-pin-angle-fill"></i></div>' : ''),
      '<div class="messenger-call-card__hover-actions"><button type="button" data-call-card-expand="' + escapeAttribute(payload.id) + '" aria-label="전체화면"><i class="bi bi-fullscreen"></i></button></div>',
      '<div class="messenger-call-card__meta">',
      '<div class="messenger-call-card__identity">',
      '<strong>' + escapeHtml(payload.displayName) + (payload.isLocal ? ' (나)' : "") + "</strong>",
      '<span>' + escapeHtml(payload.subtitle || (payload.track ? '영상 연결됨' : '대기 중')) + "</span>",
      "</div>",
      '<div class="messenger-call-card__state">' + callCardPillsMarkup(payload) + "</div>",
      "</div>",
      "</article>",
    ].join("");
  }

  function createCallCardElement(item, index) {
    const template = document.createElement("template");
    template.innerHTML = callCardMarkup(item, index).trim();
    return template.content.firstElementChild;
  }

  function ensureCallCardExpandButton(card, item) {
    if (!card) return;
    const button = card.querySelector("[data-call-card-expand]");
    if (!button) return;
    button.setAttribute("data-call-card-expand", normalizeText((item || {}).id));
    button.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      openCallFullscreen(normalizeText((item || {}).id));
    };
  }

  function syncCallCardElement(card, item, index) {
    if (!card || !item) return;
    const payload = item || {};
    const cardId = normalizeText(payload.id);
    const isPinned = cardId === normalizeText(state.call.pinnedTrackId);
    const avatarInitial = normalizeText(payload.avatarInitial || avatarInitialFor(payload.displayName, payload.displayName)) || "U";
    card.setAttribute("data-call-card-user", cardId);
    card.setAttribute("style", callCardToneStyle(payload));
    card.classList.toggle("is-speaking", !!payload.isSpeaking);
    card.classList.toggle("is-pinned", isPinned);
    card.classList.toggle("is-primary", state.call.layoutMode === "speaker" && index === 0);
    const placeholder = card.querySelector(".messenger-call-card__placeholder");
    if (placeholder) {
      placeholder.textContent = avatarInitial;
    }
    const slot = card.querySelector(".messenger-call-card__media-slot");
    if (slot) {
      slot.setAttribute("data-call-media-user", cardId);
    }
    const strong = card.querySelector(".messenger-call-card__identity strong");
    if (strong) {
      strong.textContent = normalizeText(payload.displayName) + (payload.isLocal ? " (나)" : "");
    }
    const subtitle = card.querySelector(".messenger-call-card__identity span");
    if (subtitle) {
      subtitle.textContent = payload.subtitle || (payload.track ? "영상 연결됨" : "대기 중");
    }
    const stateBox = card.querySelector(".messenger-call-card__state");
    if (stateBox) {
      stateBox.innerHTML = callCardPillsMarkup(payload);
    }
    const existingPinBadge = card.querySelector(".messenger-call-card__pin-badge");
    if (isPinned && !existingPinBadge) {
      const hoverActions = card.querySelector(".messenger-call-card__hover-actions");
      const pinBadge = document.createElement("div");
      pinBadge.className = "messenger-call-card__pin-badge";
      pinBadge.setAttribute("aria-hidden", "true");
      pinBadge.innerHTML = '<i class="bi bi-pin-angle-fill"></i>';
      if (hoverActions) {
        card.insertBefore(pinBadge, hoverActions);
      } else {
        card.appendChild(pinBadge);
      }
    } else if (!isPinned && existingPinBadge) {
      existingPinBadge.remove();
    }
    ensureCallCardExpandButton(card, payload);
    card.onclick = function () {
      togglePinnedTrack(cardId);
    };
    const attached = !!(slot && payload.track && attachLiveKitTrack(payload.track, slot, payload.isLocal));
    if (!attached) {
      clearMountedLiveKitTrack(slot);
      card.classList.remove("has-video");
    }
  }

  function syncCallGridUtilityCard() {
    if (!dom.callGrid) return;
    let card = dom.callGrid.querySelector(".messenger-call-card--utility");
    if (state.viewMode !== "ascord") {
      if (card) card.remove();
      return;
    }
    if (!card) {
      const template = document.createElement("template");
      template.innerHTML = [
        '<article class="messenger-call-card messenger-call-card--utility">',
        '<div class="messenger-call-card__utility-hero">',
        '<div class="messenger-call-card__utility-art" aria-hidden="true">',
        '<span class="messenger-call-card__utility-shape is-gem"></span>',
        '<span class="messenger-call-card__utility-shape is-cup"><i class="bi bi-trophy-fill"></i></span>',
        '<span class="messenger-call-card__utility-shape is-dice"></span>',
        "</div>",
        '<div class="messenger-call-card__utility-actions">',
        '<button type="button" data-ascord-stage-action="invite"><i class="bi bi-person-plus-fill"></i><span>음성으로 초대하기</span></button>',
        '<button type="button" data-ascord-stage-action="activity"><i class="bi bi-grid-1x2-fill"></i><span>활동 선택하기</span></button>',
        "</div>",
        "</div>",
        "</article>",
      ].join("").trim();
      card = template.content.firstElementChild;
    }
    Array.prototype.forEach.call(card.querySelectorAll("[data-ascord-stage-action]"), function (button) {
      button.onclick = function () {
        handleAscordDockAction(normalizeText(button.getAttribute("data-ascord-stage-action"))).catch(function () {});
      };
    });
    dom.callGrid.appendChild(card);
  }

  function syncCallGridCards(items) {
    if (!dom.callGrid) return;
    const nextItems = Array.isArray(items) ? items.slice() : [];
    Array.prototype.forEach.call(dom.callGrid.querySelectorAll(".messenger-call-empty"), function (emptyState) {
      emptyState.remove();
    });
    const existingCards = new Map();
    Array.prototype.forEach.call(dom.callGrid.querySelectorAll("[data-call-card-user]"), function (card) {
      existingCards.set(normalizeText(card.getAttribute("data-call-card-user")), card);
    });
    nextItems.forEach(function (item, index) {
      const itemId = normalizeText(item && item.id);
      let card = existingCards.get(itemId) || null;
      if (!card) {
        card = createCallCardElement(item, index);
      }
      syncCallCardElement(card, item, index);
      dom.callGrid.appendChild(card);
      existingCards.delete(itemId);
    });
    existingCards.forEach(function (card) {
      const slot = card.querySelector(".messenger-call-card__media-slot");
      clearMountedLiveKitTrack(slot);
      card.remove();
    });
    syncCallGridUtilityCard();
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

  function callParticipantOrderIndex(room, userId) {
    const targetRoom = room || findRoomById(state.call.joinedRoomId) || state.activeRoom;
    const targetUserId = normalizeText(userId);
    if (!targetRoom || !targetUserId) return Number.MAX_SAFE_INTEGER;
    const roomCall = callForRoom(targetRoom.id);
    const participants = Array.isArray(roomCall && roomCall.participants) ? roomCall.participants : [];
    const index = participants.findIndex(function (item) {
      return normalizeText((item || {}).user_id) === targetUserId;
    });
    return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
  }

  function sortStageAwareEntries(room, items) {
    const targetRoom = room || findRoomById(state.call.joinedRoomId) || state.activeRoom;
    const stageMode = isStageRoom(targetRoom);
    return (Array.isArray(items) ? items.slice() : []).sort(function (a, b) {
      if (stageMode) {
        const orderDiff = callParticipantOrderIndex(targetRoom, b && b.userId) - callParticipantOrderIndex(targetRoom, a && a.userId);
        if (orderDiff !== 0) return -orderDiff;
      }
      return Number(!!b.isSpeaking) - Number(!!a.isSpeaking)
        || Number(!!b.audioEnabled) - Number(!!a.audioEnabled)
        || Number(!!b.isLocal) - Number(!!a.isLocal)
        || normalizeText((a && a.displayName) || "").localeCompare(normalizeText((b && b.displayName) || ""), "ko");
    });
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

  function callPreviewSubtitle(participant, room) {
    const payload = participant || {};
    if (isStageRoom(room)) {
      if (payload.server_muted) return "운영자 음소거";
      if (callParticipantSpeakerRequested(payload)) return "발언 요청 중";
      if (callParticipantStageRole(payload) === "speaker") {
        if (payload.sharing_screen) return "발표 중 · 화면 공유";
        if (payload.video_enabled) return "발표 중 · 영상";
        if (payload.audio_enabled) return "발표 중";
        return "발표자 대기";
      }
      return "청중으로 참여 중";
    }
    if (payload.server_muted) return "운영자 음소거";
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
    await disconnectLiveKitRoom(false, { playSound: false });
    closeAllPeerConnections();
    stopStreamTracks(state.call.screenStream);
    stopStreamTracks(state.call.cameraStream);
    stopNotibaCapture(true);
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
      video_enabled: !!state.call.cameraEnabled,
      sharing_screen: !!state.call.sharingScreen,
      deafened: !!state.call.deafened,
      source: state.call.sharingScreen ? "screen" : "camera",
    });
  }

  async function stopScreenShare() {
    const room = currentLiveRoom();
    if (!room || !state.call.sharingScreen) return;
    const roomMeta = findRoomById(state.call.joinedRoomId) || state.activeRoom;
    await room.localParticipant.setScreenShareEnabled(false);
    syncLocalMediaStateFromLiveRoom();
    emitCallMediaState();
    renderCallUi();
    playAscordStreamStopSound(roomMeta);
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
    if (state.call.joining) return;
    const roomCall = callForRoom(targetRoomId);
    if (!canJoinCall(room)) {
      await showWarning("이 채널은 현재 통화 참여 권한이 제한되어 있습니다.", "통화 참여 권한 없음");
      return;
    }
    if (!roomCall && !canStartCall(room)) {
      await showWarning("이 채널은 새 통화를 시작할 수 있는 역할이 제한되어 있습니다.", "통화 시작 권한 없음");
      return;
    }
    if (state.call.joinedRoomId && Number(state.call.joinedRoomId || 0) !== targetRoomId) {
      if (state.viewMode === "ascord") {
        await leaveCurrentCall();
      } else {
        await showWarning("현재는 한 번에 하나의 대화방 통화만 지원합니다. 먼저 기존 통화에서 나가주세요.");
        return;
      }
    }
    let nextMode = normalizeText(mode).toLowerCase() === "video" ? "video" : "audio";
    if (nextMode === "video" && !canUseVideoInCall(room)) {
      nextMode = "audio";
      await showToast("warning", "이 채널에서는 카메라 권한이 제한되어 음성으로만 입장합니다.");
    }
    const joinDeviceResult = await ensureCallJoinDeviceSelection(room, nextMode);
    if (!joinDeviceResult) {
      return;
    }
    const prejoinDeafened = !!state.call.deafened;
    const prejoinMicPreference = callPrejoinWantsMicrophone(room);
    state.call.requestedAudioEnabled = canSpeakInCall(room) && !!joinDeviceResult.enableMicrophone && prejoinMicPreference && !prejoinDeafened;
    state.call.micBeforeDeafen = canSpeakInCall(room) && !!joinDeviceResult.enableMicrophone && prejoinMicPreference;
    state.call.deafened = prejoinDeafened;
    state.call.pushToTalkPressed = false;
    state.call.pinnedTrackId = "";
    state.call.joining = true;
    renderCallUi();
    try {
      try {
        const warmupResult = await warmupCallCapturePermissions(nextMode, {
          audioRequired: !!state.call.requestedAudioEnabled,
        });
        nextMode = normalizeText((warmupResult && warmupResult.effectiveMode) || nextMode).toLowerCase() === "video" ? "video" : "audio";
        const joinWarning = normalizeText((joinDeviceResult && joinDeviceResult.warning) || (warmupResult && warmupResult.warning));
        if (joinWarning) {
          await showToast("warning", joinWarning);
        }
      } catch (error) {
        await showError(formatCallCaptureWarmupError(error, nextMode), "장치 권한 확인");
        return;
      }
      await connectLiveKitRoom(targetRoomId, nextMode, {
        enableMicrophone: !!state.call.requestedAudioEnabled,
        enableCamera: nextMode === "video",
      });
      if (state.call.pushToTalk || state.call.deafened || !state.call.requestedAudioEnabled) {
        await syncCallTransmitState();
      } else {
        syncLocalMediaStateFromLiveRoom();
      }
      sendSocket({
        type: "call_join",
        room_id: targetRoomId,
        media_mode: normalizeText(state.call.requestedMode || nextMode).toLowerCase() === "video" ? "video" : "audio",
        audio_enabled: !!state.call.audioEnabled,
        video_enabled: !!state.call.cameraEnabled,
        sharing_screen: !!state.call.sharingScreen,
        deafened: !!state.call.deafened,
        source: state.call.sharingScreen ? "screen" : "camera",
      });
      sendSocket({ type: "call_sync", room_id: targetRoomId });
      playAscordJoinSound(room);
    } catch (error) {
      await showError(formatLivekitConnectionError(error), "통화 준비 실패");
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

  async function syncCallTransmitState() {
    const room = currentLiveRoom();
    if (!room || !state.call.joinedRoomId) return;
    const serverMuted = isServerMutedInRoom(state.call.joinedRoomId);
    const roomMeta = findRoomById(state.call.joinedRoomId) || state.activeRoom;
    const shouldEnableMic = !!state.call.requestedAudioEnabled && canSpeakInCall(roomMeta) && !serverMuted && !state.call.deafened && (!state.call.pushToTalk || !!state.call.pushToTalkPressed);
    await room.localParticipant.setMicrophoneEnabled(shouldEnableMic);
    syncLocalMediaStateFromLiveRoom();
    emitCallMediaState();
    renderCallUi();
  }

  async function toggleCallMute() {
    const roomMeta = findRoomById(state.call.joinedRoomId) || state.activeRoom;
    if (!roomMeta) return;
    if (!state.call.joinedRoomId) {
      if (!canSpeakInCall(roomMeta)) {
        await showWarning("이 채널에서는 마이크 송출 권한이 제한되어 있습니다.", "마이크 권한 없음");
        return;
      }
      if (state.call.deafened) {
        return;
      }
      state.call.requestedAudioEnabled = !state.call.requestedAudioEnabled;
      state.call.micBeforeDeafen = state.call.requestedAudioEnabled;
      renderCallUi();
      renderRoomList();
      if (state.call.requestedAudioEnabled) {
        playAscordUnmuteSound(roomMeta);
        return;
      }
      playAscordMuteSound(roomMeta);
      return;
    }
    if (!canSpeakInCall(roomMeta)) {
      if (state.call.requestedAudioEnabled) {
        state.call.requestedAudioEnabled = false;
        state.call.micBeforeDeafen = false;
        await syncCallTransmitState();
      }
      await showWarning("이 채널에서는 마이크 송출 권한이 제한되어 있습니다.", "마이크 권한 없음");
      return;
    }
    if (isServerMutedInRoom(state.call.joinedRoomId) && !state.call.requestedAudioEnabled) {
      await showWarning("운영자가 현재 마이크 사용을 제한하고 있습니다.", "운영자 음소거");
      return;
    }
    state.call.requestedAudioEnabled = !state.call.requestedAudioEnabled;
    state.call.micBeforeDeafen = state.call.requestedAudioEnabled;
    await syncCallTransmitState();
    renderRoomList();
    if (state.call.requestedAudioEnabled) {
      playAscordUnmuteSound(roomMeta);
      return;
    }
    playAscordMuteSound(roomMeta);
  }

  async function toggleCallCamera() {
    const room = currentLiveRoom();
    if (!room || !state.call.joinedRoomId) return;
    const roomMeta = findRoomById(state.call.joinedRoomId) || state.activeRoom;
    if (!canUseVideoInCall(roomMeta) && !state.call.cameraEnabled) {
      await showWarning("이 채널에서는 카메라 송출 권한이 제한되어 있습니다.", "카메라 권한 없음");
      return;
    }
    await room.localParticipant.setCameraEnabled(!state.call.cameraEnabled);
    await applySelectedInputDevices();
    syncLocalMediaStateFromLiveRoom();
    emitCallMediaState();
    renderCallUi();
    renderRoomList();
  }

  async function toggleScreenShare() {
    const room = currentLiveRoom();
    if (!room || !state.call.joinedRoomId) return;
    const roomMeta = findRoomById(state.call.joinedRoomId) || state.activeRoom;
    const nextSharingState = !state.call.sharingScreen;
    if (!canShareScreenInCall(roomMeta) && !state.call.sharingScreen) {
      await showWarning("이 채널에서는 화면공유 권한이 제한되어 있습니다.", "화면공유 권한 없음");
      return;
    }
    await room.localParticipant.setScreenShareEnabled(nextSharingState);
    syncLocalMediaStateFromLiveRoom();
    emitCallMediaState();
    renderCallUi();
    renderRoomList();
    if (nextSharingState) {
      playAscordStreamStartSound(roomMeta);
      return;
    }
    playAscordStreamStopSound(roomMeta);
  }

  async function enforceJoinedRoomPermissions(room) {
    const joinedRoomId = Number(state.call.joinedRoomId || 0);
    const liveRoom = currentLiveRoom();
    const roomMeta = room && Number(room.id || 0) === joinedRoomId ? room : findRoomById(joinedRoomId);
    if (joinedRoomId <= 0 || !liveRoom || !roomMeta) return;
    if (!canJoinCall(roomMeta)) {
      await showWarning("이 채널의 통화 참여 권한이 변경되어 연결을 종료합니다.", "권한 변경");
      await leaveCurrentCall();
      return;
    }

    let shouldEmitMediaState = false;
    if (!canSpeakInCall(roomMeta) && state.call.requestedAudioEnabled) {
      state.call.requestedAudioEnabled = false;
      state.call.micBeforeDeafen = false;
      await syncCallTransmitState();
      showToast("warning", "이 채널에서는 마이크 송출 권한이 제한되었습니다.").catch(function () {});
    }
    if (!canUseVideoInCall(roomMeta) && state.call.cameraEnabled) {
      await liveRoom.localParticipant.setCameraEnabled(false);
      shouldEmitMediaState = true;
      showToast("warning", "이 채널에서는 카메라 송출 권한이 제한되었습니다.").catch(function () {});
    }
    if (!canShareScreenInCall(roomMeta) && state.call.sharingScreen) {
      await liveRoom.localParticipant.setScreenShareEnabled(false);
      shouldEmitMediaState = true;
      showToast("warning", "이 채널에서는 화면공유 권한이 제한되었습니다.").catch(function () {});
    }
    if (shouldEmitMediaState) {
      syncLocalMediaStateFromLiveRoom();
      emitCallMediaState();
      renderCallUi();
    }
  }

  async function toggleCallDeafen() {
    const roomMeta = findRoomById(state.call.joinedRoomId) || state.activeRoom;
    if (!roomMeta) return;
    const nextValue = !state.call.deafened;
    if (nextValue) {
      state.call.micBeforeDeafen = !!state.call.requestedAudioEnabled;
      state.call.requestedAudioEnabled = false;
    }
    state.call.deafened = nextValue;
    if (!nextValue) {
      state.call.requestedAudioEnabled = !!state.call.micBeforeDeafen && canSpeakInCall(roomMeta);
    }
    if (!state.call.joinedRoomId) {
      renderCallUi();
      renderRoomList();
      if (nextValue) {
        playAscordMuteSound(roomMeta);
        return;
      }
      playAscordUnmuteSound(roomMeta);
      return;
    }
    await syncCallTransmitState();
    applyRemoteAudioPreferences();
    renderRoomList();
    renderAscordVoiceDock();
    renderAscordCallDock();
    renderInspector();
    if (nextValue) {
      playAscordMuteSound(roomMeta);
      return;
    }
    playAscordUnmuteSound(roomMeta);
  }

  async function toggleCallPushToTalk() {
    state.call.pushToTalk = !state.call.pushToTalk;
    state.call.pushToTalkPressed = false;
    persistCallPreferences();
    if (state.call.joinedRoomId) {
      await syncCallTransmitState();
    } else {
      renderCallUi();
    }
    renderInspector();
  }

  function toggleCallLayout() {
    state.call.layoutMode = state.call.layoutMode === "speaker" ? "grid" : "speaker";
    persistCallPreferences();
    renderCallUi();
    renderInspector();
  }

  function renderCallGrid(roomCall) {
    if (!dom.callGrid) return;
    dom.callGrid.classList.remove("is-empty-ascord");
    if (dom.callStage) {
      dom.callStage.classList.remove("is-empty-ascord");
    }
    const call = roomCall || null;
    const liveRoom = currentLiveRoom();
    const joinedHere = !!liveRoom && Number(state.call.joinedRoomId || 0) === Number((state.activeRoom && state.activeRoom.id) || 0);
    if (!joinedHere) {
      renderCallPrompt(call);
      return;
    }

    const items = orderedCallRenderItems(livekitParticipantRenderItems(liveRoom));
    state.call.lastRenderItems = items.slice();
    if (!items.length) {
      renderCallPrompt(call);
      return;
    }
    dom.callGrid.setAttribute("data-density", state.call.layoutMode === "speaker" ? "default" : callGridDensity(items.length));
    dom.callGrid.setAttribute("data-layout", sanitizeCallLayout(state.call.layoutMode));
    syncCallGridCards(items);
    renderCallAudioSink(liveRoom);
  }

  function renderCallUi() {
    if (!dom.callStrip || !dom.callStage || !dom.callStatusBadge || !dom.callStatusTitle || !dom.callStatusMeta) return;
    const room = state.activeRoom;
    const supportsCalls = !!room && roomSupportsCalls(room);
    const roomCall = activeRoomCall();
    const joinedRoomId = Number(state.call.joinedRoomId || 0);
    const joinedHere = !!room && joinedRoomId > 0 && joinedRoomId === Number(room.id || 0);
    const joinedElsewhere = joinedRoomId > 0 && !joinedHere;
    const amInRoomCall = joinedHere && !!currentLiveRoom();
    const callConfigured = livekitConfigured();
    const callReady = livekitAvailable();
    const participantCount = callParticipantCount(roomCall, room && room.id);
    const isAscord = state.viewMode === "ascord";
    const channelMode = roomChannelMode(room);
    const serverMuted = joinedHere && isServerMutedInRoom(room && room.id);
    const canJoinRoomCall = !!room && canJoinCall(room);
    const canLaunchCall = !!room && canJoinRoomCall && (!!roomCall || canStartCall(room));
    const canUseCamera = !!room && canUseVideoInCall(room);
    const canShareScreenNow = !!room && canShareScreenInCall(room);
    const canSpeakNow = !!room && canSpeakInCall(room);
    const micUiEnabled = joinedHere && !!state.call.requestedAudioEnabled && !state.call.deafened && !serverMuted && canSpeakNow;
    const stageMode = !!room && isStageRoom(room);
    const myStageParticipant = stageMode ? callParticipant(roomCall, currentUserId()) : null;
    const pendingStageRequests = stageMode ? Number((roomCall && roomCall.speaker_request_count) || 0) : 0;
    const startCallRequirement = callPermissionLabel(roomCallPermissions(room).start_call);

    if (dom.root) {
      dom.root.classList.toggle("is-ascord-call-joined", isAscord && joinedHere);
      dom.root.classList.toggle("is-ascord-call-prejoin", isAscord && supportsCalls && !joinedHere);
    }
    dom.callStrip.classList.toggle("d-none", !supportsCalls || isAscord);
    dom.callStage.classList.toggle("d-none", !supportsCalls);
    syncChatHeaderPlacement();
    if (!supportsCalls) {
      state.call.lastRenderItems = [];
      renderAscordVoiceDock();
      renderAscordCallDock();
      renderCallFullscreenOverlay();
      return;
    }

    dom.callStatusBadge.classList.remove("is-live", "is-ringing");
    if (!callConfigured) {
      dom.callStatusBadge.textContent = "SETUP";
      dom.callStatusTitle.textContent = "그룹 통화 서버 설정이 필요합니다.";
      dom.callStatusMeta.textContent = "LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET를 설정하면 50명급 그룹 통화에 연결할 수 있습니다.";
    } else if (!canJoinRoomCall) {
      dom.callStatusBadge.textContent = "LOCK";
      dom.callStatusTitle.textContent = isAscord ? "이 ASCORD 채널은 통화 참여 권한이 제한되어 있습니다." : "이 대화방은 통화 참여 권한이 제한되어 있습니다.";
      dom.callStatusMeta.textContent = "채널 설정에서 통화 참여 권한을 올리면 음성/영상 입장이 가능합니다.";
    } else if (!callReady) {
      dom.callStatusBadge.textContent = "LOAD";
      dom.callStatusTitle.textContent = "통화 SDK를 불러오는 중입니다.";
      dom.callStatusMeta.textContent = "잠시 후 다시 시도해주세요.";
    } else if (amInRoomCall) {
      dom.callStatusBadge.textContent = "LIVE";
      dom.callStatusBadge.classList.add("is-live");
      dom.callStatusTitle.textContent = isAscord
        ? (channelMode === "stage" ? "ASCORD 스테이지 채널에 연결되어 있습니다." : "ASCORD 음성채널에 연결되어 있습니다.")
        : "LiveKit 그룹 통화에 참여 중입니다.";
      dom.callStatusMeta.textContent = String(participantCount || 1) + "명이 연결되어 있고, 참가자 카드와 캠/화면공유 카드가 모두 그리드에 표시됩니다." + (!canSpeakNow && channelMode === "stage" ? " 현재 청중 권한으로 연결되어 있습니다." : "") + (pendingStageRequests > 0 ? " 발언 요청 " + pendingStageRequests + "건이 대기 중입니다." : "") + (serverMuted ? " 현재 운영자 음소거 상태입니다." : "");
    } else if (roomCall && participantCount > 0) {
      dom.callStatusBadge.textContent = "JOIN";
      dom.callStatusBadge.classList.add("is-ringing");
      dom.callStatusTitle.textContent = isAscord
        ? (channelMode === "stage" ? "이 ASCORD 스테이지 채널에서 라이브가 진행 중입니다." : "이 ASCORD 채널에서 통화가 진행 중입니다.")
        : "이 대화방에서 통화가 진행 중입니다.";
      dom.callStatusMeta.textContent = String(participantCount) + "명이 연결되어 있습니다." + (channelMode === "stage" && !canSpeakNow ? " 지금 입장하면 청중으로 연결됩니다." : "") + (pendingStageRequests > 0 ? " 발언 요청 " + pendingStageRequests + "건이 대기 중입니다." : "");
    } else if (joinedElsewhere) {
      dom.callStatusBadge.textContent = "BUSY";
      dom.callStatusTitle.textContent = isAscord ? "다른 ASCORD 채널에 연결되어 있습니다." : "다른 대화방 통화에 참여 중입니다.";
      dom.callStatusMeta.textContent = isAscord ? "이 채널에서 음성 입장 버튼을 누르면 자동으로 전환됩니다." : "현재 방에서는 새 통화를 시작할 수 없습니다.";
    } else if (!canLaunchCall) {
      dom.callStatusBadge.textContent = "LOCK";
      dom.callStatusTitle.textContent = isAscord ? "이 ASCORD 채널은 새 통화 시작 권한이 제한되어 있습니다." : "이 대화방은 새 통화 시작 권한이 제한되어 있습니다.";
      dom.callStatusMeta.textContent = "현재 설정에서는 " + startCallRequirement + "만 새 통화를 시작할 수 있습니다.";
    } else {
      dom.callStatusBadge.textContent = "READY";
      dom.callStatusTitle.textContent = isAscord ? "이 ASCORD 채널은 지금 대기 중입니다." : "이 대화방에서 통화가 없습니다.";
      dom.callStatusMeta.textContent = isAscord
        ? (channelMode === "stage"
          ? "청중으로 먼저 입장하고, 운영 권한이 있으면 발언과 진행 제어를 이어서 사용할 수 있습니다."
          : "음성으로 먼저 입장한 뒤 카메라, 화면공유, PTT, 스피커뷰를 이어서 사용할 수 있습니다.")
        : "음성 또는 영상 통화를 시작할 수 있습니다.";
    }

    setCallButton(dom.audioCallBtn, "bi-telephone", roomCall && !amInRoomCall ? (channelMode === "stage" ? "청중으로 참여" : "음성으로 참여") : (isAscord ? (channelMode === "stage" ? "청중 입장" : "음성 입장") : "음성 통화"));
    setCallButton(dom.videoCallBtn, "bi-camera-video", !canUseCamera ? "영상 제한" : (roomCall && !amInRoomCall ? "영상으로 참여" : (isAscord ? "영상 입장" : "영상 통화")));
    if (dom.stageSelfBtn) {
      let stageSelfAction = "";
      let stageSelfIcon = "bi-broadcast-pin";
      let stageSelfLabel = "발언 요청";
      if (stageMode && joinedHere && myStageParticipant) {
        if (callParticipantStageRole(myStageParticipant) === "speaker") {
          stageSelfAction = "move_self_to_audience";
          stageSelfIcon = "bi-arrow-down-circle";
          stageSelfLabel = "청중 이동";
        } else if (callParticipantSpeakerRequested(myStageParticipant)) {
          stageSelfAction = "withdraw_request";
          stageSelfIcon = "bi-x-circle";
          stageSelfLabel = "요청 취소";
        } else {
          stageSelfAction = "request_speaker";
          stageSelfIcon = "bi-broadcast-pin";
          stageSelfLabel = "발언 요청";
        }
      }
      dom.stageSelfBtn.classList.toggle("d-none", !stageMode || !joinedHere);
      dom.stageSelfBtn.disabled = !stageMode || !joinedHere || !stageSelfAction;
      dom.stageSelfBtn.setAttribute("data-stage-self-action", stageSelfAction);
      dom.stageSelfBtn.classList.toggle("is-active", stageSelfAction === "withdraw_request");
      setCallButton(dom.stageSelfBtn, stageSelfIcon, stageSelfLabel);
    }
    if (dom.stageQueueBtn) {
      const queueVisible = stageMode && canModerateCall(room);
      dom.stageQueueBtn.classList.toggle("d-none", !queueVisible);
      dom.stageQueueBtn.disabled = !queueVisible;
      dom.stageQueueBtn.classList.toggle("is-active", queueVisible && pendingStageRequests > 0);
      setCallButton(dom.stageQueueBtn, "bi-megaphone", pendingStageRequests > 0 ? ("요청 " + pendingStageRequests + "건") : "요청 없음");
    }
    setCallButton(dom.toggleMicBtn, (!canSpeakNow || serverMuted || state.call.deafened || !state.call.requestedAudioEnabled) ? "bi-mic-mute-fill" : "bi-mic", !canSpeakNow ? "MIC 제한" : (serverMuted ? "운영자 음소거" : (state.call.deafened ? "올뮤트 중" : (state.call.requestedAudioEnabled ? "마이크" : "음소거 해제"))));
    setCallButton(dom.toggleCameraBtn, state.call.cameraEnabled ? "bi-camera-video" : "bi-camera-video-off", !canUseCamera ? "카메라 제한" : (state.call.cameraEnabled ? "카메라" : "카메라 켜기"));
    setCallButton(dom.screenShareBtn, state.call.sharingScreen ? "bi-display-fill" : "bi-display", !canShareScreenNow ? "공유 제한" : (state.call.sharingScreen ? "공유 중지" : "화면 공유"));
    setCallButton(dom.deafenBtn, "bi-headset", state.call.deafened ? "올뮤트 해제" : "올뮤트");
    setCallButton(dom.pushToTalkBtn, "bi-broadcast-pin", state.call.pushToTalk ? "PTT ON" : "PTT OFF");
    setCallButton(dom.callLayoutBtn, state.call.layoutMode === "speaker" ? "bi-layout-three-columns" : "bi-grid-3x3-gap", state.call.layoutMode === "speaker" ? "그리드" : "스피커뷰");
    setCallButton(dom.leaveCallBtn, "bi-telephone-x", "나가기");

    if (dom.audioCallBtn) dom.audioCallBtn.disabled = !room || !callReady || state.call.joining || ((!isAscord) && joinedElsewhere) || amInRoomCall || !canLaunchCall;
    if (dom.videoCallBtn) dom.videoCallBtn.disabled = !room || !callReady || state.call.joining || ((!isAscord) && joinedElsewhere) || amInRoomCall || !canLaunchCall || !canUseCamera;
    if (dom.toggleMicBtn) {
      dom.toggleMicBtn.disabled = !joinedHere || serverMuted || !canSpeakNow || !!state.call.deafened;
      dom.toggleMicBtn.classList.toggle("is-active", micUiEnabled);
    }
    if (dom.toggleCameraBtn) {
      dom.toggleCameraBtn.disabled = !joinedHere || !canUseCamera;
      dom.toggleCameraBtn.classList.toggle("is-active", joinedHere && !!state.call.cameraEnabled && canUseCamera);
    }
    if (dom.screenShareBtn) {
      dom.screenShareBtn.disabled = !joinedHere || !canShareScreenNow;
      dom.screenShareBtn.classList.toggle("is-active", joinedHere && !!state.call.sharingScreen && canShareScreenNow);
    }
    if (dom.deafenBtn) {
      dom.deafenBtn.disabled = !joinedHere;
      dom.deafenBtn.classList.remove("is-active");
      dom.deafenBtn.classList.toggle("is-deafened", joinedHere && !!state.call.deafened);
    }
    if (dom.pushToTalkBtn) {
      dom.pushToTalkBtn.disabled = !room;
      dom.pushToTalkBtn.classList.toggle("is-active", !!state.call.pushToTalk);
    }
    if (dom.callLayoutBtn) {
      dom.callLayoutBtn.disabled = !room;
      dom.callLayoutBtn.classList.toggle("is-active", state.call.layoutMode === "speaker");
    }
    if (dom.leaveCallBtn) dom.leaveCallBtn.disabled = !joinedHere;

    renderCallGrid(roomCall);
    renderAscordVoiceDock();
    renderAscordCallDock();
    renderCallFullscreenOverlay();
    syncNotibaCapture();
  }

  async function handleCallStateUpdate(call) {
    const roomCall = call || null;
    const roomId = Number((roomCall && roomCall.room_id) || 0);
    if (roomId <= 0) return;
    const roomMeta = findRoomById(roomId) || (Number(state.activeRoomId || 0) === roomId ? state.activeRoom : null);
    if (roomMeta && !isAscordRoom(roomMeta)) {
      await handleCallCleared(roomId);
      return;
    }
    const previousCall = snapshotRoomCall(state.call.callSnapshotsByRoomId[roomId] || state.call.roomCallsById[roomId]);
    const nextCall = snapshotRoomCall(roomCall);
    const previousTranscriptCallId = normalizeText(state.notiba.callIdByRoomId[roomId]);
    const nextTranscriptCallId = normalizeText((nextCall && nextCall.call_id) || "");
    state.call.roomCallsById[roomId] = roomCall;
    state.call.callSnapshotsByRoomId[roomId] = nextCall;
    if (!nextTranscriptCallId) {
      clearRoomTranscriptEntries(roomId);
    } else if (previousTranscriptCallId !== nextTranscriptCallId) {
      setRoomTranscriptEntries(roomId, nextTranscriptCallId, []);
      clearRoomPendingTranscriptEntries(roomId);
      if (state.roomDrawerOpen && Number(state.activeRoomId || 0) === roomId) {
        loadRoomCallTranscripts(roomId, { force: true }).catch(function () {});
      }
    }
    const previousMyParticipant = callParticipant(previousCall, currentUserId());
    const myParticipant = callParticipant(nextCall, currentUserId());
    if (liveCallAlertKey(nextCall)) {
      if (
        currentUserInRoomCall(nextCall)
        || Number(state.activeRoomId || 0) === roomId
        || (state.viewMode === "ascord" && state.sidebarMode === "inbox")
      ) {
        markLiveRoomSeen(roomId, nextCall);
      }
    } else {
      delete state.call.seenLiveCallIdsByRoomId[roomId];
    }
    if (myParticipant && myParticipant.server_muted) {
      state.call.serverMutedRoomIds[roomId] = true;
    } else {
      delete state.call.serverMutedRoomIds[roomId];
    }
    if (Number(state.call.joinedRoomId || 0) === roomId && myParticipant && typeof myParticipant.deafened !== "undefined") {
      state.call.deafened = !!myParticipant.deafened;
    }
    if (currentUserInRoomCall(nextCall)) {
      removeIncomingCallInvite(roomId, { joined: true });
    } else {
      handleIncomingRoomCallTransition(previousCall, nextCall);
    }
    recalcCounts();
    renderIncomingCallInvites();
    renderRoomList();
    if (Number(state.activeRoomId || 0) === roomId) {
      renderInspector();
    }
    const joinedThisRoom = Number(state.call.joinedRoomId || 0) === roomId && !!currentLiveRoom();
    const membershipChanged = !!previousMyParticipant !== !!myParticipant;
    const serverMuteChanged = !!(previousMyParticipant && previousMyParticipant.server_muted) !== !!(myParticipant && myParticipant.server_muted);
    const previousStageRole = previousMyParticipant ? callParticipantStageRole(previousMyParticipant) : "";
    const nextStageRole = myParticipant ? callParticipantStageRole(myParticipant) : "";
    const stageRoleChanged = previousStageRole !== nextStageRole;
    const previousSpeakerRequested = !!(previousMyParticipant && previousMyParticipant.speaker_requested);
    const nextSpeakerRequested = !!(myParticipant && myParticipant.speaker_requested);
    if (isStageRoom(roomMeta)) {
      const previousRequestedMap = new Map(((previousCall && previousCall.participants) || []).filter(function (participant) {
        return !!(participant && participant.speaker_requested);
      }).map(function (participant) {
        return [normalizeText((participant || {}).user_id), participant];
      }));
      const nextRequestedParticipants = ((nextCall && nextCall.participants) || []).filter(function (participant) {
        return !!(participant && participant.speaker_requested);
      });
      const newRequesters = nextRequestedParticipants.filter(function (participant) {
        return !previousRequestedMap.has(normalizeText((participant || {}).user_id));
      });
      const resolvedRequesterIds = Array.from(previousRequestedMap.keys()).filter(function (userId) {
        return !nextRequestedParticipants.some(function (participant) {
          return normalizeText((participant || {}).user_id) === userId;
        });
      });
      if (resolvedRequesterIds.length) {
        removeLocalStageRequestNotifications(roomId, resolvedRequesterIds);
      }
      if (roomMeta && canModerateCall(roomMeta)) {
        newRequesters.forEach(function (participant) {
          const requesterUserId = normalizeText((participant || {}).user_id);
          if (!requesterUserId || requesterUserId === currentUserId()) return;
          const notificationItem = buildStageRequestNotificationItem(roomMeta, nextCall, participant);
          if (!notificationItem) return;
          upsertNotificationItem(notificationItem);
          showBrowserNotification(notificationItem);
          if (Number(state.activeRoomId || 0) === roomId && state.viewMode === "ascord") {
            showPassiveToast("info", normalizeText((participant && participant.display_name) || requesterUserId) + "님이 발언 요청을 보냈습니다.").catch(function () {});
          }
        });
      }
    } else {
      removeLocalStageRequestNotifications(roomId);
    }
    if (joinedThisRoom && stageRoleChanged) {
      if (nextStageRole === "speaker" && previousSpeakerRequested) {
        state.call.requestedAudioEnabled = true;
        state.call.micBeforeDeafen = true;
      } else if (nextStageRole && nextStageRole !== "speaker") {
        state.call.requestedAudioEnabled = false;
        state.call.micBeforeDeafen = false;
      }
      await enforceJoinedRoomPermissions(roomMeta || state.activeRoom).catch(function () {});
    }
    if (joinedThisRoom && (membershipChanged || serverMuteChanged || stageRoleChanged)) {
      syncCallTransmitState().catch(function () {});
    }
    if (joinedThisRoom && previousSpeakerRequested !== nextSpeakerRequested) {
      renderCallUi();
    }
    renderCallUi();
  }

  async function handleCallCleared(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return;
    const roomMeta = findRoomById(targetRoomId) || (Number(state.activeRoomId || 0) === targetRoomId ? state.activeRoom : null);
    const previousCall = snapshotRoomCall(state.call.callSnapshotsByRoomId[targetRoomId] || state.call.roomCallsById[targetRoomId]);
    const invite = incomingInviteForRoom(targetRoomId);
    if (invite && !invite.joined && (!roomMeta || isAscordRoom(roomMeta))) {
      const missedItem = buildCallNotificationItem((invite && invite.roomCall) || previousCall, "missed_call");
      if (missedItem) {
        upsertNotificationItem(missedItem);
        showBrowserNotification(missedItem);
      }
    }
    if (invite && invite.callId) {
      removeLocalCallNotifications(invite.callId, "call");
    }
    removeLocalStageRequestNotifications(targetRoomId);
    delete state.call.seenLiveCallIdsByRoomId[targetRoomId];
    delete state.call.callSnapshotsByRoomId[targetRoomId];
    delete state.call.incomingInvitesByRoomId[targetRoomId];
    delete state.call.serverMutedRoomIds[targetRoomId];
    delete state.call.roomCallsById[targetRoomId];
    clearRoomTranscriptEntries(targetRoomId);
    clearRoomPendingTranscriptEntries(targetRoomId);
    recalcCounts();
    renderIncomingCallInvites();
    renderRoomList();
    if (Number(state.activeRoomId || 0) === targetRoomId) {
      renderInspector();
    }
    renderCallUi();
  }

  async function handleCallAdminControl(payload) {
    const action = normalizeText((payload && payload.action) || "").toLowerCase();
    const roomId = Number((payload && payload.room_id) || 0);
    if (roomId <= 0 || !action) return;
    if (action === "server_mute") {
      state.call.serverMutedRoomIds[roomId] = true;
      if (Number(state.call.joinedRoomId || 0) === roomId && !!currentLiveRoom()) {
        state.call.requestedAudioEnabled = false;
        state.call.micBeforeDeafen = false;
        await syncCallTransmitState().catch(function () {});
      }
      renderInspector();
      renderCallUi();
      showPassiveToast("warning", "운영자가 마이크를 서버 음소거했습니다.").catch(function () {});
      return;
    }
    if (action === "server_unmute") {
      delete state.call.serverMutedRoomIds[roomId];
      renderInspector();
      renderCallUi();
      showPassiveToast("success", "운영자가 마이크 제한을 해제했습니다.").catch(function () {});
      return;
    }
    if (action === "grant_speaker") {
      renderInspector();
      renderCallUi();
      showPassiveToast("success", "운영자가 발표자로 승격했습니다.").catch(function () {});
      return;
    }
    if (action === "move_to_audience") {
      if (Number(state.call.joinedRoomId || 0) === roomId && !!currentLiveRoom()) {
        state.call.requestedAudioEnabled = false;
        state.call.micBeforeDeafen = false;
        const liveRoom = currentLiveRoom();
        if (liveRoom && liveRoom.localParticipant) {
          try {
            await liveRoom.localParticipant.setCameraEnabled(false);
          } catch (_) {}
          try {
            await liveRoom.localParticipant.setScreenShareEnabled(false);
          } catch (_) {}
          syncLocalMediaStateFromLiveRoom();
          emitCallMediaState();
        }
        await syncCallTransmitState().catch(function () {});
      }
      renderInspector();
      renderCallUi();
      showPassiveToast("warning", "운영자가 현재 연결을 청중 권한으로 전환했습니다.").catch(function () {});
      return;
    }
    if (Number(state.call.joinedRoomId || 0) !== roomId || !currentLiveRoom()) return;
    if (action === "disable_camera") {
      if (state.call.cameraEnabled) {
        await toggleCallCamera().catch(function () {});
      }
      showPassiveToast("warning", "운영자가 카메라 송출을 중지했습니다.").catch(function () {});
      return;
    }
    if (action === "disable_screen_share") {
      if (state.call.sharingScreen) {
        await stopScreenShare().catch(function () {});
      }
      showPassiveToast("warning", "운영자가 화면공유를 중지했습니다.").catch(function () {});
      return;
    }
    if (action === "disconnect") {
      await leaveCurrentCall().catch(function () {});
      showPassiveToast("warning", "운영자가 현재 통화에서 내보냈습니다.").catch(function () {});
    }
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
    if (canLeaveRoom(room)) {
      items.push({ action: "room-leave", label: "채널 나가기", icon: "bi-box-arrow-right", data: { roomId: room.id }, danger: true });
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
    if (state.activeRoom && canInviteMembers(state.activeRoom) && !state.activeRoom.is_direct) {
      items.push({ action: "room-invite", label: "다른 구성원 초대", icon: "bi-person-plus", data: { roomId: state.activeRoom.id } });
    }
    if (state.activeRoom && !state.activeRoom.is_direct) {
      if (canTransferOwnerToTarget(state.activeRoom, targetUserId)) {
        items.push({ action: "room-transfer-owner", label: "OWNER 이전", icon: "bi-award", data: { roomId: state.activeRoom.id, userId: targetUserId }, danger: true });
      }
      if (canChangeTargetMemberRole(state.activeRoom, targetUserId, "admin")) {
        items.push({ action: "room-role-admin", label: "ADMIN 지정", icon: "bi-shield-check", data: { roomId: state.activeRoom.id, userId: targetUserId } });
      }
      if (canChangeTargetMemberRole(state.activeRoom, targetUserId, "member")) {
        items.push({ action: "room-role-member", label: "일반 멤버로 변경", icon: "bi-person", data: { roomId: state.activeRoom.id, userId: targetUserId } });
      }
      if (canRemoveTargetMember(state.activeRoom, targetUserId)) {
        items.push({ action: "room-remove-member", label: "채널에서 제거", icon: "bi-person-dash", data: { roomId: state.activeRoom.id, userId: targetUserId }, danger: true });
      }
    }
    if (state.activeRoom && canModerateCall(state.activeRoom) && !state.activeRoom.is_direct && normalizeText(currentUserId()) !== targetUserId) {
      const roomCall = activeRoomCall();
      const participant = callParticipant(roomCall, targetUserId) || {};
      if (normalizeText(participant.user_id)) {
        if (isStageRoom(state.activeRoom)) {
          if (callParticipantStageRole(participant) === "speaker") {
            items.push({ action: "call-move-audience", label: "청중으로 내리기", icon: "bi-arrow-down-circle", data: { roomId: state.activeRoom.id, userId: targetUserId } });
          } else {
            items.push({
              action: "call-grant-speaker",
              label: callParticipantSpeakerRequested(participant) ? "발언 요청 승인" : "발표자로 승격",
              icon: "bi-megaphone",
              data: { roomId: state.activeRoom.id, userId: targetUserId },
            });
          }
        }
        items.push({
          action: normalizeText(participant.server_muted) ? "call-server-unmute" : "call-server-mute",
          label: normalizeText(participant.server_muted) ? "서버 음소거 해제 허용" : "서버 음소거",
          icon: normalizeText(participant.server_muted) ? "bi-mic" : "bi-mic-mute",
          data: { roomId: state.activeRoom.id, userId: targetUserId },
        });
        if (participant.video_enabled) {
          items.push({ action: "call-disable-camera", label: "카메라 중지", icon: "bi-camera-video-off", data: { roomId: state.activeRoom.id, userId: targetUserId } });
        }
        if (participant.sharing_screen) {
          items.push({ action: "call-disable-screen-share", label: "화면공유 중지", icon: "bi-display", data: { roomId: state.activeRoom.id, userId: targetUserId } });
        }
        items.push({ action: "call-disconnect", label: "통화에서 내보내기", icon: "bi-person-x", data: { roomId: state.activeRoom.id, userId: targetUserId }, danger: true });
      }
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

  function inviteCandidateMarkup(contact, options) {
    const settings = options || {};
    const invited = !!settings.invited;
    const inviting = !!settings.inviting;
    const avatar = contact.profile_image_url
      ? '<img src="' + escapeAttribute(contact.profile_image_url) + '" alt="' + escapeAttribute(contact.display_name || contact.user_id || "구성원") + '">'
      : escapeHtml(contact.avatar_initial || "U");
    const secondaryText = normalizeText(contact.user_id || contact.department || contact.presence_label || "구성원");
    return [
      '<div class="messenger-discord-invite-modal__member">',
      '<span class="messenger-contact-avatar messenger-discord-invite-modal__member-avatar">' + avatar + '<span class="messenger-contact-avatar__status is-' + escapeAttribute(contact.presence_tone || "offline") + '"></span></span>',
      '<span class="messenger-discord-invite-modal__member-meta">',
      "<strong>" + escapeHtml(contact.display_name || contact.user_id) + "</strong>",
      "<span>" + escapeHtml(secondaryText) + "</span>",
      "</span>",
      '<button class="messenger-discord-invite-modal__member-action' + (invited ? ' is-sent' : '') + '" type="button" data-invite-user-id="' + escapeAttribute(contact.user_id) + '"' + ((invited || inviting) ? " disabled" : "") + ">" + escapeHtml(inviting ? "초대 중..." : (invited ? "초대됨" : "초대하기")) + "</button>",
      "</div>",
    ].join("");
  }

  function ascordVoiceInviteSendingUserIds(roomId) {
    const targetRoomId = Number(roomId || 0);
    if (targetRoomId <= 0) return new Set();
    if (!(state.ascordVoiceInviteSendingByRoomId[targetRoomId] instanceof Set)) {
      state.ascordVoiceInviteSendingByRoomId[targetRoomId] = new Set();
    }
    return state.ascordVoiceInviteSendingByRoomId[targetRoomId];
  }

  function ascordVoiceInvitePreview(roomId) {
    return state.ascordVoiceInvitePreviewByRoomId[Number(roomId || 0)] || null;
  }

  function ascordVoiceInviteCandidates(room, preview) {
    const targetRoom = room || state.activeRoom;
    const payload = preview || {};
    const roomState = ascordRoomState(targetRoom);
    const participantIds = new Set(currentCallParticipantSummaries(targetRoom, roomState.roomCall).map(function (summary) {
      return normalizeText(summary.userId);
    }).filter(Boolean));
    const seen = new Set([currentUserId()]);
    const candidates = [];
    const pushItem = function (item, section) {
      const userId = normalizeText(item && item.user_id);
      if (!userId || seen.has(userId) || participantIds.has(userId)) return;
      seen.add(userId);
      candidates.push(Object.assign({}, item, {
        quick_invite_section: section,
        workspace_invite_status: normalizeText(item && item.workspace_invite_status) || (section === "members" ? "active" : "available"),
      }));
    };
    (Array.isArray(payload.serverMembers) ? payload.serverMembers : []).forEach(function (item) {
      pushItem(item, "members");
    });
    (Array.isArray(payload.inviteCandidates) ? payload.inviteCandidates : []).forEach(function (item) {
      pushItem(item, "invite");
    });
    return candidates;
  }

  function ascordVoiceInviteMenuItemMarkup(contact, roomId) {
    const targetRoomId = Number(roomId || 0);
    const userId = normalizeText(contact && contact.user_id);
    const sending = ascordVoiceInviteSendingUserIds(targetRoomId).has(userId);
    const invited = !!contact.voice_invite_sent || normalizeText(contact && contact.workspace_invite_status).toLowerCase() === "invited";
    const avatar = contact.profile_image_url
      ? '<img src="' + escapeAttribute(contact.profile_image_url) + '" alt="' + escapeAttribute(contact.display_name || contact.user_id || "구성원") + '">'
      : escapeHtml(contact.avatar_initial || avatarInitialFor(contact.display_name, contact.user_id || "U"));
    const secondaryText = normalizeText(contact.user_id || contact.department || contact.presence_label || "ASCORD");
    const actionIcon = sending ? "bi-hourglass-split" : (invited ? "bi-check2" : "bi-person-plus-fill");
    const actionLabel = sending ? "전송 중" : (invited ? "초대됨" : "초대하기");
    return [
      '<div class="messenger-ascord-voice-invite-menu__item">',
      '<span class="messenger-contact-avatar messenger-ascord-voice-invite-menu__avatar">' + avatar + '<span class="messenger-contact-avatar__status is-' + escapeAttribute(contact.presence_tone || "offline") + '"></span></span>',
      '<span class="messenger-ascord-voice-invite-menu__meta">',
      "<strong>" + escapeHtml(contact.display_name || contact.user_id || "사용자") + "</strong>",
      "<span>" + escapeHtml(secondaryText) + "</span>",
      "</span>",
      '<button class="messenger-ascord-voice-invite-menu__action' + (invited ? ' is-sent' : '') + '" type="button" data-ascord-voice-invite-user-id="' + escapeAttribute(userId) + '"' + ((sending || invited) ? " disabled" : "") + ' aria-label="' + escapeAttribute(actionLabel) + '" title="' + escapeAttribute(actionLabel) + '"><i class="bi ' + escapeAttribute(actionIcon) + '"></i></button>',
      "</div>",
    ].join("");
  }

  function ascordVoiceInviteMenuMarkup(room) {
    const targetRoom = room || state.activeRoom;
    const roomId = Number((targetRoom && targetRoom.id) || 0);
    const preview = ascordVoiceInvitePreview(roomId);
    const loading = !!state.ascordVoiceInviteLoadingByRoomId[roomId];
    const errorText = normalizeText(preview && preview.error);
    if (loading && !preview) {
      return [
        '<div class="messenger-ascord-voice-invite-menu__state">',
        '<i class="bi bi-arrow-repeat"></i>',
        '<span>초대 목록을 불러오는 중입니다.</span>',
        "</div>",
      ].join("");
    }
    if (errorText) {
      return [
        '<div class="messenger-ascord-voice-invite-menu__state is-error">',
        '<i class="bi bi-exclamation-circle"></i>',
        '<span>' + escapeHtml(errorText) + "</span>",
        "</div>",
        '<button class="messenger-ascord-voice-invite-menu__more" type="button" data-ascord-voice-invite-more="' + roomId + '"><i class="bi bi-people-fill"></i><span>더 보기...</span></button>',
      ].join("");
    }
    const candidates = ascordVoiceInviteCandidates(targetRoom, preview);
    const visibleCandidates = candidates.slice(0, 5);
    return [
      visibleCandidates.length
        ? visibleCandidates.map(function (contact) {
            return ascordVoiceInviteMenuItemMarkup(contact, roomId);
          }).join("")
        : [
            '<div class="messenger-ascord-voice-invite-menu__state">',
            '<i class="bi bi-people"></i>',
            '<span>지금 바로 초대할 사용자가 없습니다.</span>',
            "</div>",
          ].join(""),
      '<button class="messenger-ascord-voice-invite-menu__more" type="button" data-ascord-voice-invite-more="' + roomId + '"><i class="bi bi-people-fill"></i><span>더 보기...</span></button>',
    ].join("");
  }

  function renderAscordVoiceInviteMenu(roomId, wrap) {
    const targetRoomId = Number(roomId || 0);
    const menuWrap = wrap || (dom.roomList ? dom.roomList.querySelector('[data-ascord-voice-invite-room-id="' + targetRoomId + '"]') : null);
    if (!menuWrap) return;
    const menu = menuWrap.querySelector("[data-ascord-voice-invite-menu]");
    if (!menu) return;
    menu.innerHTML = ascordVoiceInviteMenuMarkup(findRoomById(targetRoomId) || state.activeRoom || currentAscordWorkspaceRoom());
    if (menuWrap.classList.contains("is-open")) {
      positionAscordVoiceInviteMenu(menuWrap);
    }
  }

  function positionAscordVoiceInviteMenu(wrap) {
    const menuWrap = wrap || null;
    if (!menuWrap) return;
    const trigger = menuWrap.querySelector('[data-ascord-sidebar-action="voice-invite"]');
    const menu = menuWrap.querySelector("[data-ascord-voice-invite-menu]");
    if (!trigger || !menu) return;
    const popupWindow = menuWrap.closest(".messenger-popup-window");
    const boundsRect = popupWindow
      ? popupWindow.getBoundingClientRect()
      : {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        };
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const spacing = 18;
    const viewportPadding = 12;
    let left = (triggerRect.right - boundsRect.left) + spacing;
    if (left + menuRect.width > (boundsRect.width - viewportPadding)) {
      left = Math.max(viewportPadding, (triggerRect.left - boundsRect.left) - menuRect.width - spacing);
    }
    let top = (triggerRect.top - boundsRect.top);
    top = clampNumber(top, viewportPadding, Math.max(viewportPadding, boundsRect.height - menuRect.height - viewportPadding));
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
  }

  async function ensureAscordVoiceInvitePreview(room) {
    const targetRoom = room || state.activeRoom;
    const roomId = Number((targetRoom && targetRoom.id) || 0);
    if (roomId <= 0) return null;
    if (state.ascordVoiceInviteLoadingByRoomId[roomId]) {
      return state.ascordVoiceInviteLoadingByRoomId[roomId];
    }
    const cached = ascordVoiceInvitePreview(roomId);
    if (cached && !normalizeText(cached.error)) return cached;
    const request = api("/api/messenger/ascord/workspace-invite?room_id=" + roomId).then(function (payload) {
      const data = (payload && payload.payload) || {};
      const preview = {
        serverMembers: Array.isArray(data.server_members) ? data.server_members.slice() : [],
        inviteCandidates: Array.isArray(data.invite_candidates) ? data.invite_candidates.slice() : [],
        inviteLink: normalizeText(data.invite_link),
        error: "",
      };
      state.ascordVoiceInvitePreviewByRoomId[roomId] = preview;
      return preview;
    }).catch(function (error) {
      const preview = {
        serverMembers: [],
        inviteCandidates: [],
        inviteLink: "",
        error: normalizeText((error && error.message) || "초대 목록을 불러오지 못했습니다."),
      };
      state.ascordVoiceInvitePreviewByRoomId[roomId] = preview;
      return preview;
    }).finally(function () {
      delete state.ascordVoiceInviteLoadingByRoomId[roomId];
    });
    state.ascordVoiceInviteLoadingByRoomId[roomId] = request;
    return request;
  }

  async function quickInviteUserToAscordRoom(roomId, userId) {
    const targetRoomId = Number(roomId || 0);
    const targetUserId = normalizeText(userId);
    if (targetRoomId <= 0 || !targetUserId) return;
    const sendingUserIds = ascordVoiceInviteSendingUserIds(targetRoomId);
    if (sendingUserIds.has(targetUserId)) return;
    sendingUserIds.add(targetUserId);
    renderAscordVoiceInviteMenu(targetRoomId);
    try {
      await api("/api/messenger/ascord/workspace-invites", {
        method: "POST",
        body: JSON.stringify({
          room_id: targetRoomId,
          user_id: targetUserId,
        }),
      });
      const preview = ascordVoiceInvitePreview(targetRoomId);
      if (preview) {
        ["serverMembers", "inviteCandidates"].forEach(function (key) {
          (Array.isArray(preview[key]) ? preview[key] : []).forEach(function (contact) {
            if (normalizeText(contact && contact.user_id) !== targetUserId) return;
            contact.voice_invite_sent = true;
            if (key === "inviteCandidates") {
              contact.workspace_invite_status = "invited";
            }
          });
        });
      }
      showToast("success", "ABBAS Talk 개인톡으로 음성 초대를 보냈습니다.").catch(function () {});
    } finally {
      sendingUserIds.delete(targetUserId);
      renderAscordVoiceInviteMenu(targetRoomId);
    }
  }

  function ascordWorkspaceInviteMemberMarkup(contact, options) {
    const settings = options || {};
    const section = normalizeText(settings.section).toLowerCase() || "invite";
    const status = normalizeText(settings.status).toLowerCase() || (section === "members" ? "active" : "available");
    const inviting = !!settings.inviting;
    const avatar = contact.profile_image_url
      ? '<img src="' + escapeAttribute(contact.profile_image_url) + '" alt="' + escapeAttribute(contact.display_name || contact.user_id || "구성원") + '">'
      : escapeHtml(contact.avatar_initial || "U");
    const secondaryText = normalizeText(contact.user_id || contact.department || contact.presence_label || "구성원");
    const actionLabel = section === "members"
      ? "멤버"
      : (inviting ? "전송 중..." : (status === "invited" ? "초대됨" : "초대하기"));
    const disabled = section === "members" || status === "invited" || inviting;
    return [
      '<div class="messenger-discord-invite-modal__member">',
      '<span class="messenger-contact-avatar messenger-discord-invite-modal__member-avatar">' + avatar + '<span class="messenger-contact-avatar__status is-' + escapeAttribute(contact.presence_tone || "offline") + '"></span></span>',
      '<span class="messenger-discord-invite-modal__member-meta">',
      "<strong>" + escapeHtml(contact.display_name || contact.user_id) + "</strong>",
      "<span>" + escapeHtml(secondaryText) + "</span>",
      "</span>",
      '<button class="messenger-discord-invite-modal__member-action' + (section === "members" ? ' is-existing' : '') + (status === "invited" ? ' is-sent' : '') + '" type="button"' + (section === "invite" ? ' data-ascord-workspace-invite-user-id="' + escapeAttribute(contact.user_id) + '"' : "") + (disabled ? " disabled" : "") + ">" + escapeHtml(actionLabel) + "</button>",
      "</div>",
    ].join("");
  }

  function ascordWorkspaceInviteSectionMarkup(sectionKey, title, items, options) {
    const settings = options || {};
    const isOpen = !!settings.open;
    const section = normalizeText(sectionKey).toLowerCase();
    const rows = Array.isArray(items) ? items : [];
    const emptyTitle = normalizeText(settings.emptyTitle) || "표시할 사용자가 없습니다.";
    const emptyCopy = normalizeText(settings.emptyCopy) || "조건에 맞는 사용자가 아직 없습니다.";
    const bodyHtml = rows.length
      ? rows.map(function (item) {
          return ascordWorkspaceInviteMemberMarkup(item, {
            section: section,
            status: normalizeText(item.workspace_invite_status) || (section === "members" ? "active" : "available"),
            inviting: !!settings.invitingUserIds && settings.invitingUserIds.has(normalizeText(item.user_id)),
          });
        }).join("")
      : [
          '<div class="messenger-discord-invite-modal__empty messenger-discord-invite-modal__empty--compact">',
          '<strong>' + escapeHtml(emptyTitle) + "</strong>",
          '<span>' + escapeHtml(emptyCopy) + "</span>",
          "</div>",
        ].join("");
    return [
      '<section class="messenger-discord-invite-modal__section' + (isOpen ? ' is-open' : '') + '" data-ascord-workspace-section="' + escapeAttribute(section) + '">',
      '<button class="messenger-discord-invite-modal__section-toggle" type="button" data-ascord-workspace-toggle="' + escapeAttribute(section) + '">',
      '<span>' + escapeHtml(title) + "</span>",
      '<i class="bi ' + escapeAttribute(isOpen ? "bi-chevron-down" : "bi-chevron-right") + '"></i>',
      "</button>",
      '<div class="messenger-discord-invite-modal__section-body"' + (isOpen ? "" : " hidden") + '>',
      bodyHtml,
      "</div>",
      "</section>",
    ].join("");
  }

  async function promptInviteMembers(room) {
    const targetRoom = room || state.activeRoom;
    const candidates = inviteCandidateContacts(targetRoom);
    if (!targetRoom) {
      await showWarning("추가로 초대할 수 있는 구성원이 없습니다.");
      return null;
    }
    if (!hasSwal()) {
      await showWarning("초대 창을 열 수 없습니다.");
      return null;
    }

    const invitedUserIds = new Set();
    const invitingUserIds = new Set();
    const inviteLink = workspaceInviteLink(targetRoom);
    const destinationIcon = roomSupportsCalls(targetRoom) ? roomVoiceIcon(targetRoom) : "bi-hash";
    await fireDialog({
      title: "친구를 " + ascordWorkspaceName() + " 워크스페이스로 초대하기",
      width: "37rem",
      showConfirmButton: false,
      showCancelButton: false,
      showCloseButton: true,
      focusConfirm: false,
      customClass: {
        popup: "app-swal-popup messenger-discord-invite-modal",
        title: "app-swal-title messenger-discord-invite-modal__title",
        htmlContainer: "app-swal-html messenger-discord-invite-modal__html",
        actions: "app-swal-actions messenger-discord-invite-modal__actions",
        closeButton: "messenger-discord-invite-modal__close",
      },
      html: [
        '<div class="messenger-discord-invite-modal__subtitle">수신자는 <span class="messenger-discord-invite-modal__destination"><i class="bi ' + escapeAttribute(destinationIcon) + '"></i><span>' + escapeHtml((targetRoom && targetRoom.title) || "ASCORD 채널") + "</span></span>에 도착해요</div>",
        '<div class="app-swal-form messenger-discord-invite-modal__body">',
        '<div class="messenger-discord-invite-modal__search">',
        '<i class="bi bi-search"></i>',
        '<input id="swalMessengerInviteSearch" class="form-control app-swal-field app-swal-contact-search" type="search" placeholder="친구 찾기">',
        "</div>",
        '<div class="messenger-discord-invite-modal__label"><span>서버 멤버</span><i class="bi bi-chevron-down"></i></div>',
        '<div class="messenger-discord-invite-modal__list-wrap">',
        '<div class="messenger-discord-invite-modal__list" id="swalMessengerInviteList"></div>',
        "</div>",
        '<div class="messenger-discord-invite-modal__footer">',
        '<div class="messenger-discord-invite-modal__footer-copy">또는 친구에게 서버 초대 링크 전송하기</div>',
        '<div class="messenger-discord-invite-modal__copy-row">',
        '<input id="swalMessengerInviteLink" class="form-control app-swal-field" type="text" readonly value="' + escapeAttribute(inviteLink) + '">',
        '<button id="swalMessengerInviteCopyBtn" class="btn btn-primary" type="button">복사</button>',
        "</div>",
        '<div class="messenger-discord-invite-modal__footer-help">초대 링크는 현재 채널로 빠르게 이동하는 용도로 사용됩니다.</div>',
        "</div>",
        '</div>',
      ].join(""),
      didOpen: function () {
        const searchInput = document.getElementById("swalMessengerInviteSearch");
        const list = document.getElementById("swalMessengerInviteList");
        const copyButton = document.getElementById("swalMessengerInviteCopyBtn");
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
            list.innerHTML = [
              '<div class="messenger-discord-invite-modal__empty">',
              '<i class="bi bi-search"></i>',
              '<strong>검색 결과가 없습니다.</strong>',
              '<span>다른 이름이나 아이디로 다시 찾아보세요.</span>',
              "</div>",
            ].join("");
            return;
          }
          list.innerHTML = filtered.map(function (contact) {
            const userId = normalizeText(contact.user_id);
            return inviteCandidateMarkup(contact, {
              invited: invitedUserIds.has(userId),
              inviting: invitingUserIds.has(userId),
            });
          }).join("");
        };

        list.addEventListener("click", function (event) {
          const button = event.target instanceof Element ? event.target.closest("[data-invite-user-id]") : null;
          if (!button) return;
          const userId = normalizeText(button.getAttribute("data-invite-user-id"));
          if (!userId) return;
          if (invitedUserIds.has(userId) || invitingUserIds.has(userId)) return;
          invitingUserIds.add(userId);
          renderList();
          api("/api/messenger/rooms/" + targetRoom.id + "/members", {
            method: "POST",
            body: JSON.stringify({ member_ids: [userId] }),
          }).then(function (payload) {
            invitingUserIds.delete(userId);
            invitedUserIds.add(userId);
            if (payload && payload.room) {
              mergeRoom(payload.room);
              state.activeRoom = currentRoom();
              renderHeader();
              renderInspector();
            }
            showToast("success", "멤버를 초대했습니다.").catch(function () {});
            renderList();
          }).catch(function (error) {
            invitingUserIds.delete(userId);
            renderList();
            showToast("warning", (error && error.message) || "멤버 초대에 실패했습니다.").catch(function () {});
          });
        });

        if (searchInput) {
          searchInput.addEventListener("input", renderList);
          searchInput.focus();
        }
        if (copyButton) {
          copyButton.addEventListener("click", function () {
            copyText(inviteLink).then(function (copied) {
              if (!copied) return;
              copyButton.textContent = "복사됨";
              window.setTimeout(function () {
                copyButton.textContent = "복사";
              }, 1400);
            });
          });
        }
        renderList();
      },
    });
    return true;
  }

  async function promptAscordWorkspaceInvite(room) {
    const targetRoom = room || state.activeRoom;
    if (!targetRoom) {
      await showWarning("ASCORD 채널을 먼저 선택해주세요.");
      return null;
    }
    if (!hasSwal()) {
      await showWarning("초대 창을 열 수 없습니다.");
      return null;
    }

    let payload;
    try {
      payload = await api("/api/messenger/ascord/workspace-invite?room_id=" + Number(targetRoom.id || 0));
    } catch (error) {
      await showError((error && error.message) || "ASCORD 서버 초대 정보를 불러오지 못했습니다.");
      return null;
    }

    const data = (payload && payload.payload) || {};
    const serverMembers = Array.isArray(data.server_members) ? data.server_members.slice() : [];
    const inviteCandidates = Array.isArray(data.invite_candidates) ? data.invite_candidates.slice() : [];
    const invitingUserIds = new Set();
    const inviteStatusByUserId = {};
    inviteCandidates.forEach(function (item) {
      const userId = normalizeText(item && item.user_id);
      if (!userId) return;
      inviteStatusByUserId[userId] = normalizeText(item.workspace_invite_status) || "available";
    });
    const workspaceName = normalizeText((data.workspace && data.workspace.name) || ascordWorkspaceName());
    const inviteLink = normalizeText(data.invite_link) || workspaceInviteLink(targetRoom);
    let openSection = "invite";

    await fireDialog({
      title: "친구를 " + workspaceName + " 그룹으로 초대하기",
      width: "39rem",
      showConfirmButton: false,
      showCancelButton: false,
      showCloseButton: true,
      focusConfirm: false,
      customClass: {
        popup: "app-swal-popup messenger-discord-invite-modal",
        title: "app-swal-title messenger-discord-invite-modal__title",
        htmlContainer: "app-swal-html messenger-discord-invite-modal__html",
        actions: "app-swal-actions messenger-discord-invite-modal__actions",
        closeButton: "messenger-discord-invite-modal__close",
      },
      html: [
        '<div class="messenger-discord-invite-modal__subtitle">수신자는 <span class="messenger-discord-invite-modal__destination"><i class="bi ' + escapeAttribute(roomVoiceIcon(targetRoom)) + '"></i><span>' + escapeHtml((targetRoom && targetRoom.title) || "ASCORD 채널") + "</span></span>에 도착해요</div>",
        '<div class="app-swal-form messenger-discord-invite-modal__body">',
        '<div class="messenger-discord-invite-modal__search">',
        '<i class="bi bi-search"></i>',
        '<input id="swalMessengerWorkspaceInviteSearch" class="form-control app-swal-field app-swal-contact-search" type="search" placeholder="친구 찾기">',
        "</div>",
        '<div class="messenger-discord-invite-modal__list-wrap">',
        '<div class="messenger-discord-invite-modal__list messenger-discord-invite-modal__list--directory" id="swalMessengerWorkspaceInviteDirectory"></div>',
        "</div>",
        '<div class="messenger-discord-invite-modal__footer">',
        '<div class="messenger-discord-invite-modal__footer-copy">또는 친구에게 서버 초대 링크 전송하기</div>',
        '<div class="messenger-discord-invite-modal__copy-row">',
        '<input id="swalMessengerWorkspaceInviteLink" class="form-control app-swal-field" type="text" readonly value="' + escapeAttribute(inviteLink) + '">',
        '<button id="swalMessengerWorkspaceInviteCopyBtn" class="btn btn-primary" type="button">복사</button>',
        "</div>",
        '<div class="messenger-discord-invite-modal__footer-help">초대 링크는 개인톡 없이도 ASCORD 채널로 바로 이동하는 용도로 사용됩니다.</div>',
        "</div>",
        "</div>",
      ].join(""),
      didOpen: function () {
        const searchInput = document.getElementById("swalMessengerWorkspaceInviteSearch");
        const directory = document.getElementById("swalMessengerWorkspaceInviteDirectory");
        const copyButton = document.getElementById("swalMessengerWorkspaceInviteCopyBtn");
        if (!directory) return;

        const filterItems = function (items) {
          const query = normalizeText(searchInput && searchInput.value).toLowerCase();
          return (items || []).filter(function (item) {
            if (!query) return true;
            const haystack = [
              item.display_name,
              item.department,
              item.user_id,
            ].join(" ").toLowerCase();
            return haystack.indexOf(query) !== -1;
          });
        };

        const renderDirectory = function () {
          const filteredMembers = filterItems(serverMembers);
          const filteredInviteCandidates = filterItems(inviteCandidates).map(function (item) {
            return Object.assign({}, item, {
              workspace_invite_status: inviteStatusByUserId[normalizeText(item.user_id)] || normalizeText(item.workspace_invite_status) || "available",
            });
          });
          directory.innerHTML = [
            ascordWorkspaceInviteSectionMarkup("members", "서버 멤버", filteredMembers, {
              open: openSection === "members",
              emptyTitle: "현재 ASCORD 서버 멤버가 없습니다.",
              emptyCopy: "서버에 참가한 사용자가 여기에 표시됩니다.",
            }),
            ascordWorkspaceInviteSectionMarkup("invite", "서버에 초대하기", filteredInviteCandidates, {
              open: openSection !== "members",
              invitingUserIds: invitingUserIds,
              emptyTitle: "추가로 초대할 사용자가 없습니다.",
              emptyCopy: "모든 사용자가 이미 초대되었거나 서버 멤버입니다.",
            }),
          ].join("");
        };

        directory.addEventListener("click", function (event) {
          const toggle = event.target instanceof Element ? event.target.closest("[data-ascord-workspace-toggle]") : null;
          if (toggle) {
            const nextSection = normalizeText(toggle.getAttribute("data-ascord-workspace-toggle")).toLowerCase();
            openSection = nextSection === "members" ? "members" : "invite";
            renderDirectory();
            return;
          }
          const button = event.target instanceof Element ? event.target.closest("[data-ascord-workspace-invite-user-id]") : null;
          if (!button) return;
          const userId = normalizeText(button.getAttribute("data-ascord-workspace-invite-user-id"));
          if (!userId) return;
          if (inviteStatusByUserId[userId] === "invited" || invitingUserIds.has(userId)) return;
          invitingUserIds.add(userId);
          renderDirectory();
          api("/api/messenger/ascord/workspace-invites", {
            method: "POST",
            body: JSON.stringify({
              room_id: Number(targetRoom.id || 0),
              user_id: userId,
            }),
          }).then(function () {
            inviteStatusByUserId[userId] = "invited";
            invitingUserIds.delete(userId);
            renderDirectory();
            showToast("success", "ABBAS Talk 개인톡으로 서버 초대를 보냈습니다.").catch(function () {});
          }).catch(function (error) {
            invitingUserIds.delete(userId);
            renderDirectory();
            showToast("warning", (error && error.message) || "서버 초대 전송에 실패했습니다.").catch(function () {});
          });
        });

        if (searchInput) {
          searchInput.addEventListener("input", renderDirectory);
          searchInput.focus();
        }
        if (copyButton) {
          copyButton.addEventListener("click", function () {
            copyText(inviteLink).then(function (copied) {
              if (!copied) return;
              copyButton.textContent = "복사됨";
              window.setTimeout(function () {
                copyButton.textContent = "복사";
              }, 1400);
            });
          });
        }
        renderDirectory();
      },
    });
    return true;
  }

  async function inviteMembersToRoom(room) {
    const targetRoom = room || state.activeRoom;
    if (!targetRoom || !canInviteMembers(targetRoom) || targetRoom.is_direct) return;
    if (isAscordRoom(targetRoom)) {
      await promptAscordWorkspaceInvite(targetRoom);
      return;
    }
    await promptInviteMembers(targetRoom);
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
          channel_category: normalizeText(roomDetails.channel_category),
          channel_mode: normalizeChannelMode(roomDetails.channel_mode, roomChannelMode(targetRoom)),
          call_permissions: roomDetails.call_permissions || roomCallPermissions(targetRoom),
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
    if (action === "room-leave") return leaveRoom(findRoomById(roomId));
    if (action === "message-copy") return copyMessageText(findMessageById(roomId, messageId));
    if (action === "message-edit") return editMessageItem(findMessageById(roomId, messageId));
    if (action === "message-delete") return deleteMessageItem(findMessageById(roomId, messageId));
    if (action === "participant-dm" && userId) return createDirectRoom(userId);
    if (action === "room-invite") return inviteMembersToRoom(findRoomById(roomId) || state.activeRoom);
    if (action === "room-transfer-owner" && userId) return transferRoomOwner(userId, findRoomById(roomId) || state.activeRoom);
    if (action === "room-role-admin" && userId) return updateRoomMemberRole(userId, "admin", findRoomById(roomId) || state.activeRoom);
    if (action === "room-role-member" && userId) return updateRoomMemberRole(userId, "member", findRoomById(roomId) || state.activeRoom);
    if (action === "room-remove-member" && userId) return removeMemberFromRoom(userId, findRoomById(roomId) || state.activeRoom);
    if (action === "call-grant-speaker" && userId) return sendCallModerationAction("grant_speaker", userId, findRoomById(roomId) || state.activeRoom);
    if (action === "call-move-audience" && userId) return sendCallModerationAction("move_to_audience", userId, findRoomById(roomId) || state.activeRoom);
    if (action === "call-server-mute" && userId) return sendCallModerationAction("server_mute", userId, findRoomById(roomId) || state.activeRoom);
    if (action === "call-server-unmute" && userId) return sendCallModerationAction("server_unmute", userId, findRoomById(roomId) || state.activeRoom);
    if (action === "call-disable-camera" && userId) return sendCallModerationAction("disable_camera", userId, findRoomById(roomId) || state.activeRoom);
    if (action === "call-disable-screen-share" && userId) return sendCallModerationAction("disable_screen_share", userId, findRoomById(roomId) || state.activeRoom);
    if (action === "call-disconnect" && userId) return sendCallModerationAction("disconnect", userId, findRoomById(roomId) || state.activeRoom);
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

  function ascordCreateKindMeta(kind) {
    const normalized = normalizeText(kind).toLowerCase();
    if (normalized === "text") {
      return {
        key: "text",
        label: "텍스트",
        inputIcon: "bi-hash",
        channelMode: "voice",
        subtitle: ".텍스트 채널에 속해 있음",
        supported: false,
      };
    }
    if (normalized === "forum") {
      return {
        key: "forum",
        label: "포럼",
        inputIcon: "bi-chat-square-text-fill",
        channelMode: "voice",
        subtitle: ".포럼 채널에 속해 있음",
        supported: false,
      };
    }
    return {
      key: "voice",
      label: "음성",
      inputIcon: "bi-volume-up-fill",
      channelMode: "voice",
      subtitle: ".음성 채널에 속해 있음",
      supported: true,
    };
  }

  function publicAscordMemberIds() {
    const seen = new Set();
    return (state.contacts || []).map(function (contact) {
      return normalizeText(contact && contact.user_id);
    }).filter(function (userId) {
      if (!userId || seen.has(userId)) return false;
      seen.add(userId);
      return true;
    });
  }

  function updateCreateRoomSubmitState() {
    if (!dom.createRoomSubmitBtn) return;
    let disabled = false;
    if (state.modalMode === "dm") {
      disabled = state.selectedContacts.size <= 0;
    } else {
      disabled = normalizeText(dom.groupNameInput && dom.groupNameInput.value).length < 2;
    }
    dom.createRoomSubmitBtn.disabled = disabled;
  }

  function syncAscordCreateModalUi() {
    const isAscordGroup = state.viewMode === "ascord" && state.modalMode === "group";
    const showPrivatePicker = state.modalMode === "group" && isAscordGroup && !!state.ascordCreatePrivate;
    const kindMeta = ascordCreateKindMeta(state.ascordCreateKind);
    if (dom.ascordCreateLayout) {
      dom.ascordCreateLayout.classList.toggle("d-none", !isAscordGroup);
    }
    if (dom.talkCreateLayout) {
      dom.talkCreateLayout.classList.toggle("d-none", isAscordGroup);
    }
    if (dom.ascordCreateSubtitle) {
      dom.ascordCreateSubtitle.textContent = kindMeta.subtitle;
    }
    if (dom.ascordCreateNamePrefix) {
      dom.ascordCreateNamePrefix.classList.toggle("d-none", !isAscordGroup);
      dom.ascordCreateNamePrefix.innerHTML = '<i class="bi ' + escapeAttribute(kindMeta.inputIcon) + '"></i>';
    }
    if (dom.ascordCreateEmojiBtn) {
      dom.ascordCreateEmojiBtn.classList.toggle("d-none", !isAscordGroup);
    }
    if (dom.ascordPrivateWrap) {
      dom.ascordPrivateWrap.classList.toggle("d-none", !isAscordGroup);
      dom.ascordPrivateWrap.classList.toggle("is-active", !!state.ascordCreatePrivate);
    }
    if (dom.ascordPrivateToggle) {
      dom.ascordPrivateToggle.classList.toggle("is-on", !!state.ascordCreatePrivate);
      dom.ascordPrivateToggle.setAttribute("aria-pressed", state.ascordCreatePrivate ? "true" : "false");
    }
    if (dom.groupNameInput) {
      dom.groupNameInput.setAttribute("placeholder", isAscordGroup ? "새로운 채널" : "예: 서비스기획 TF");
    }
    if (dom.contactSearch) {
      dom.contactSearch.setAttribute("placeholder", isAscordGroup ? "이름, 닉네임, 부서로 찾기" : "이름, 닉네임, 부서로 찾기");
    }
    if (dom.ascordChannelTypeList) {
      Array.prototype.forEach.call(dom.ascordChannelTypeList.querySelectorAll("[data-ascord-channel-kind]"), function (button) {
        const active = normalizeText(button.getAttribute("data-ascord-channel-kind")) === kindMeta.key;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }
    if (dom.groupTopicWrap) {
      dom.groupTopicWrap.classList.toggle("d-none", state.modalMode !== "group" || isAscordGroup);
    }
    if (dom.groupCategoryWrap) {
      dom.groupCategoryWrap.classList.add("d-none");
    }
    if (dom.groupChannelModeWrap) {
      dom.groupChannelModeWrap.classList.add("d-none");
    }
    if (dom.contactSearchWrap) {
      dom.contactSearchWrap.classList.toggle("d-none", state.modalMode === "group" && isAscordGroup && !state.ascordCreatePrivate);
    }
    if (dom.contactPickerWrap) {
      dom.contactPickerWrap.classList.toggle("d-none", state.modalMode === "group" && isAscordGroup && !state.ascordCreatePrivate);
    }
    if (dom.contactPicker) {
      dom.contactPicker.classList.toggle("is-ascord-private", showPrivatePicker);
    }
    if (dom.groupChannelModeInput) {
      dom.groupChannelModeInput.value = kindMeta.channelMode;
    }
    updateCreateRoomSubmitState();
  }

  async function setAscordCreateChannelKind(kind) {
    const meta = ascordCreateKindMeta(kind);
    if (!meta.supported) {
      await showWarning("현재 ASCORD는 음성 채널 생성만 지원합니다.", meta.label + " 채널 준비 중");
      return;
    }
    state.ascordCreateKind = meta.key;
    syncAscordCreateModalUi();
  }

  function setAscordCreatePrivate(enabled) {
    state.ascordCreatePrivate = !!enabled;
    if (!state.ascordCreatePrivate) {
      state.selectedContacts.clear();
      if (dom.contactSearch) dom.contactSearch.value = "";
    }
    renderContactPicker();
    syncAscordCreateModalUi();
  }

  function setModalMode(mode) {
    state.modalMode = state.viewMode === "ascord" ? "group" : (mode === "group" ? "group" : "dm");
    state.selectedContacts.clear();
    const modalElement = document.getElementById("messengerNewRoomModal");
    if (modalElement) {
      const isAscordGroup = state.viewMode === "ascord" && state.modalMode === "group";
      modalElement.classList.toggle("messenger-modal--ascord", state.viewMode === "ascord");
      const modalTitle = modalElement.querySelector(".modal-title");
      if (modalTitle) {
        modalTitle.textContent = state.viewMode === "ascord"
          ? "채널 만들기"
          : (state.modalMode === "group" ? "새 그룹방 만들기" : "새 대화 시작");
      }
      const groupModeButton = modalElement.querySelector('[data-mode="group"]');
      const groupNameLabel = modalElement.querySelector('label[for="messengerGroupNameInput"]');
      const contactSearchLabel = modalElement.querySelector('label[for="messengerContactSearch"]');
      if (groupModeButton) {
        groupModeButton.textContent = state.viewMode === "ascord" ? "채널" : "그룹방";
      }
      if (groupNameLabel) {
        groupNameLabel.textContent = state.viewMode === "ascord" ? "채널 이름" : "그룹방 이름";
        groupNameLabel.classList.toggle("messenger-ascord-create-layout__eyebrow", isAscordGroup);
      }
      if (contactSearchLabel) {
        contactSearchLabel.textContent = isAscordGroup ? "멤버 선택" : "대화 상대 선택";
      }
    }
    if (dom.groupNameWrap) dom.groupNameWrap.classList.toggle("d-none", state.modalMode !== "group");
    if (dom.newRoomMode) {
      Array.prototype.forEach.call(dom.newRoomMode.querySelectorAll("[data-mode]"), function (button) {
        const buttonMode = normalizeText(button.getAttribute("data-mode"));
        const hidden = state.viewMode === "ascord" && buttonMode === "dm";
        button.classList.toggle("d-none", hidden);
        button.classList.toggle("is-active", !hidden && buttonMode === state.modalMode);
      });
    }
    if (dom.createRoomSubmitBtn) {
      dom.createRoomSubmitBtn.textContent = state.modalMode === "group"
        ? (state.viewMode === "ascord" ? "채널 만들기" : "그룹방 만들기")
        : "대화 시작";
    }
    renderContactPicker();
    syncAscordCreateModalUi();
  }

  function defaultModalModeForCurrentView() {
    return state.viewMode === "ascord" ? "group" : "dm";
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
    const useAscordPrivateStyle = state.viewMode === "ascord" && state.modalMode === "group" && !!state.ascordCreatePrivate;
    if (!contacts.length) {
      dom.contactPicker.innerHTML = '<div class="messenger-empty-inline">검색 결과가 없습니다.</div>';
      updateCreateRoomSubmitState();
      return;
    }

    dom.contactPicker.innerHTML = contacts.map(function (contact) {
      const selected = state.selectedContacts.has(contact.user_id);
      const presenceLabel = normalizeText(contact.presence_label) || (
        normalizeText(contact.presence_tone) === "online" ? "온라인"
          : normalizeText(contact.presence_tone) === "away" ? "자리 비움"
          : normalizeText(contact.presence_tone) === "dnd" ? "방해 금지"
          : "오프라인"
      );
      const avatarImage = contact.profile_image_url
        ? '<img src="' + escapeHtml(contact.profile_image_url) + '" alt="' + escapeHtml(contact.display_name) + '">'
        : escapeHtml(contact.avatar_initial || "U");
      const avatar = useAscordPrivateStyle
        ? '<span class="messenger-contact-picker__avatar messenger-discord-invite-modal__member-avatar">' + avatarImage + '<span class="messenger-contact-avatar__status is-' + escapeAttribute(contact.presence_tone || "offline") + '"></span></span>'
        : '<span class="messenger-contact-picker__avatar">' + avatarImage + "</span>";
      return [
        '<button class="messenger-contact-picker__item' + (selected ? ' is-selected' : '') + (useAscordPrivateStyle ? ' is-ascord-private-item' : '') + '" type="button" data-picker-id="' + escapeHtml(contact.user_id) + '">',
        avatar,
        '<span class="messenger-contact-picker__meta' + (useAscordPrivateStyle ? ' messenger-discord-invite-modal__member-meta' : '') + '">',
        "<strong>" + escapeHtml(contact.display_name) + "</strong>",
        "<span>" + escapeHtml(useAscordPrivateStyle ? presenceLabel : (contact.department || contact.presence_label || "구성원")) + "</span>",
        "</span>",
        '<span class="messenger-contact-picker__checkbox' + (useAscordPrivateStyle ? ' is-ascord-private-check' : '') + '"><i class="bi bi-check-lg"></i></span>',
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
    updateCreateRoomSubmitState();
  }

  async function createDirectRoom(targetUserId) {
    try {
      const payload = await api("/api/messenger/rooms", {
        method: "POST",
        body: JSON.stringify({ mode: "dm", target_user_id: targetUserId }),
      });
      const roomId = Number((payload && payload.room_id) || (payload.room && payload.room.id) || 0);
      if (roomId > 0) {
        setViewMode("talk");
        await loadBootstrap(roomId);
      }
    } catch (error) {
      await showError(error.message || "대화 시작에 실패했습니다.");
    }
  }

  async function submitCreateRoom() {
    const selected = Array.from(state.selectedContacts);
    const creatingAscordRoom = state.viewMode === "ascord";
    const ascordMemberIds = creatingAscordRoom
      ? (state.ascordCreatePrivate ? selected : publicAscordMemberIds())
      : selected;
    if (!selected.length && !creatingAscordRoom) {
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
        const channelCategory = normalizeText(dom.groupCategoryInput && dom.groupCategoryInput.value);
        const channelMode = normalizeChannelMode(dom.groupChannelModeInput && dom.groupChannelModeInput.value, "voice");
        payload = await api("/api/messenger/rooms", {
          method: "POST",
          body: JSON.stringify({
            mode: creatingAscordRoom ? "channel" : "group",
            app_domain: creatingAscordRoom ? "ascord" : "talk",
            name: name,
            topic: topic,
            channel_category: channelCategory,
            channel_mode: channelMode,
            call_permissions: defaultCallPermissionsForRoom({ channel_mode: channelMode }),
            member_ids: ascordMemberIds,
          }),
        });
      }
      const roomId = Number((payload && payload.room_id) || (payload.room && payload.room.id) || 0);
      if (dom.newRoomModalInstance) dom.newRoomModalInstance.hide();
      if (dom.groupNameInput) dom.groupNameInput.value = "";
      if (dom.groupTopicInput) dom.groupTopicInput.value = "";
      if (dom.groupCategoryInput) dom.groupCategoryInput.value = "";
      if (dom.groupChannelModeInput) dom.groupChannelModeInput.value = "voice";
      if (dom.contactSearch) dom.contactSearch.value = "";
      state.ascordCreateKind = "voice";
      state.ascordCreatePrivate = false;
      state.selectedContacts.clear();
      renderContactPicker();
      syncAscordCreateModalUi();
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
    let baseText = "";
    if (state.viewMode === "ascord") {
      const roomCall = callForRoom(room.id);
      const joinedHere = !!room && Number(state.call.joinedRoomId || 0) === Number(room.id || 0) && !!currentLiveRoom();
      const participantCount = callParticipantCount(roomCall, room && room.id);
      baseText = [
        channelModeLabel(roomChannelMode(room)),
        ascordCategoryLabel(room),
        participantCount > 0 ? (String(participantCount) + "명 연결") : "대기 중",
        joinedHere ? "현재 이 채널에 참여 중" : "채널 선택 후 음성 입장 버튼으로 연결",
      ].join(" · ");
    } else {
      baseText = normalizeText(room.subtitle || room.topic || "");
    }
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

  function clearReconnectTimer() {
    if (!state.reconnectTimer) return;
    window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = 0;
  }

  function markSocketAuthLost() {
    state.authLost = true;
    clearReconnectTimer();
    stopHeartbeat();
    setSocketConnected(false);
  }

  function handleSocketAuthFailure() {
    const activeSocket = state.socket;
    state.socket = null;
    markSocketAuthLost();
    try {
      if (activeSocket && (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING)) {
        activeSocket.close();
      }
    } catch (_) {}
  }

  function scheduleReconnect() {
    if (state.authLost || state.reconnectTimer) return;
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
      ensureActiveRoomForCurrentView(Number(data.active_room_id || state.activeRoomId || 0));
      renderRoomList();
      renderMentionPicker();
      enforceJoinedRoomPermissions(findRoomById(state.call.joinedRoomId)).catch(function () {});
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
    if (type === "call_transcript" && payload.entry) {
      const completedEntry = payload.entry || {};
      clearPendingTranscriptEntry(
        Number(payload.room_id || 0),
        normalizeText(completedEntry.user_id),
        normalizeText(payload.item_id || completedEntry.source_item_id || completedEntry.item_id)
      );
      appendRoomTranscriptEntry(Number(payload.room_id || 0), payload.call_id || "", payload.entry);
      if (dom.meetingNotesModal && dom.meetingNotesModal.classList.contains("show")) {
        loadMeetingNotes(true).catch(function () {});
      }
      return;
    }
    if (type === "call_transcript_partial" && payload.entry) {
      upsertPendingTranscriptEntry(Number(payload.room_id || 0), payload.call_id || "", payload.entry);
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
    if (type === "call_admin_control") {
      await handleCallAdminControl(payload);
      return;
    }
    if (type === "typing") {
      return;
    }
  }

  function connectSocket() {
    const socketUrl = resolveWsUrl("/ws/messenger");
    if (!socketUrl || state.authLost) return;
    if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) return;

    try {
      state.socket = new WebSocket(socketUrl);
    } catch (_) {
      scheduleReconnect();
      return;
    }

    state.socket.addEventListener("open", function () {
      state.authLost = false;
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
          video_enabled: !!state.call.cameraEnabled,
          sharing_screen: !!state.call.sharingScreen,
          deafened: !!state.call.deafened,
          source: state.call.sharingScreen ? "screen" : "camera",
        });
        sendSocket({ type: "call_sync", room_id: state.call.joinedRoomId });
      }
      if (state.activeRoomId > 0) {
        sendSocket({ type: "refresh_room", room_id: state.activeRoomId });
      }
      syncKnownRoomCalls(state.rooms);
      setSocketConnected(true);
    });

    state.socket.addEventListener("message", function (event) {
      handleSocketMessage(event).catch(function () {});
    });
    state.socket.addEventListener("close", function (event) {
      stopHeartbeat();
      state.socket = null;
      if (event && (Number(event.code || 0) === 4401 || Number(event.code || 0) === 4403)) {
        markSocketAuthLost();
        return;
      }
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

    if (dom.talkModeBtn) {
      dom.talkModeBtn.addEventListener("click", function () {
        setViewMode("talk");
      });
    }

    if (dom.ascordModeBtn) {
      dom.ascordModeBtn.addEventListener("click", function () {
        setViewMode("ascord");
      });
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
        setModalMode(defaultModalModeForCurrentView());
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
        if (state.viewMode === "ascord") {
          toggleAscordSettingsSidebar();
          return;
        }
        setSidebarMode("settings");
      });
    }

    if (dom.ascordWorkspaceBtn) {
      dom.ascordWorkspaceBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        setAscordServerMenuOpen(!state.ascordServerMenuOpen);
      });
    }

    if (dom.ascordServerMenu) {
      dom.ascordServerMenu.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target.closest("[data-ascord-server-action]") : null;
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        handleAscordServerAction(target.getAttribute("data-ascord-server-action")).catch(function (error) {
          showError((error && error.message) || "ASCORD 서버 메뉴 작업을 처리하지 못했습니다.");
        });
      });
    }

    if (dom.ascordInviteBtn) {
      dom.ascordInviteBtn.addEventListener("click", function () {
        inviteMembersToRoom(currentAscordWorkspaceRoom() || state.activeRoom).catch(function (error) {
          showError((error && error.message) || "초대 모달을 열지 못했습니다.");
        });
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
    if (dom.roomLinkBtn) {
      dom.roomLinkBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleRoomDrawer();
      });
    }
    if (dom.roomDrawerCloseBtn) {
      dom.roomDrawerCloseBtn.addEventListener("click", function () {
        setRoomDrawerOpen(false);
      });
    }
    if (dom.meetingNotesChannels) {
      dom.meetingNotesChannels.addEventListener("mouseover", function (event) {
        const target = event.target instanceof Element ? event.target.closest("[data-meeting-room-id]") : null;
        if (!target) return;
        const roomId = Number(target.getAttribute("data-meeting-room-id") || 0);
        if (roomId === 0) return;
        setMeetingNotesActiveRoom(roomId);
      });
      dom.meetingNotesChannels.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target.closest("[data-meeting-room-id]") : null;
        if (!target) return;
        event.preventDefault();
        const roomId = Number(target.getAttribute("data-meeting-room-id") || 0);
        if (roomId === 0) return;
        setMeetingNotesActiveRoom(roomId);
      });
    }
    if (dom.meetingNotesNotes) {
      dom.meetingNotesNotes.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target.closest("[data-meeting-note-id]") : null;
        if (!target) return;
        event.preventDefault();
        openMeetingNote(target.getAttribute("data-meeting-note-id")).catch(function (error) {
          showError((error && error.message) || "회의록을 열지 못했습니다.");
        });
      });
    }
    if (dom.meetingNotesModal) {
      dom.meetingNotesModal.addEventListener("hidden.bs.modal", function () {
        if (!state.meetingNotes.pendingViewerNote) return;
        state.meetingNotes.viewerNote = state.meetingNotes.pendingViewerNote;
        state.meetingNotes.pendingViewerNote = null;
        renderMeetingNoteViewer();
        if (dom.meetingNoteViewerModalInstance) {
          dom.meetingNoteViewerModalInstance.show();
        }
      });
    }
    if (dom.meetingNoteViewerModal) {
      dom.meetingNoteViewerModal.addEventListener("show.bs.modal", function () {
        renderMeetingNoteViewer();
      });
    }
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
    if (dom.stageSelfBtn) {
      dom.stageSelfBtn.addEventListener("click", function () {
        const action = normalizeText(dom.stageSelfBtn.getAttribute("data-stage-self-action")).toLowerCase();
        if (!action) return;
        sendStageRequestAction(action, state.activeRoom).catch(function (error) {
          showError(error.message || "STAGE 요청을 처리하지 못했습니다.");
        });
      });
    }
    if (dom.stageQueueBtn) {
      dom.stageQueueBtn.addEventListener("click", function () {
        openStageRequestQueue(state.activeRoom).catch(function (error) {
          showError(error.message || "발언 요청 목록을 열지 못했습니다.");
        });
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
    if (dom.deafenBtn) {
      dom.deafenBtn.addEventListener("click", function () {
        toggleCallDeafen().catch(function (error) {
          showError(error.message || "디슨 상태를 바꾸지 못했습니다.");
        });
      });
    }
    if (dom.pushToTalkBtn) {
      dom.pushToTalkBtn.addEventListener("click", function () {
        toggleCallPushToTalk().catch(function (error) {
          showError(error.message || "Push To Talk 상태를 바꾸지 못했습니다.");
        });
      });
    }
    if (dom.callLayoutBtn) {
      dom.callLayoutBtn.addEventListener("click", function () {
        toggleCallLayout();
      });
    }
    if (dom.callInviteStack) {
      dom.callInviteStack.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target.closest("[data-call-invite-action]") : null;
        if (!target) return;
        const action = normalizeText(target.getAttribute("data-call-invite-action")).toLowerCase();
        const roomId = Number(target.getAttribute("data-call-invite-room-id") || 0);
        if (roomId <= 0) return;
        if (action === "join-audio") {
          acceptIncomingCall(roomId, "audio").catch(function (error) {
            showError(error.message || "통화에 참여하지 못했습니다.");
          });
          return;
        }
        if (action === "join-video") {
          acceptIncomingCall(roomId, "video").catch(function (error) {
            showError(error.message || "영상 통화에 참여하지 못했습니다.");
          });
          return;
        }
        if (action === "open-ascord") {
          setViewMode("ascord");
          openAscordRoom(roomId).catch(function (error) {
            showError(error.message || "ASCORD 채널을 열지 못했습니다.");
          });
          return;
        }
        if (action === "dismiss") {
          removeIncomingCallInvite(roomId, { dismiss: true });
          renderIncomingCallInvites();
        }
      });
    }
    if (dom.leaveCallBtn) {
      dom.leaveCallBtn.addEventListener("click", function () {
        leaveCurrentCall().catch(function (error) {
          showError(error.message || "통화에서 나가지 못했습니다.");
        });
      });
    }
    if (dom.ascordVoiceDock) {
      dom.ascordVoiceDock.addEventListener("click", function (event) {
        const profileStatus = event.target instanceof Element ? event.target.closest("[data-ascord-profile-status-value]") : null;
        if (profileStatus) {
          event.preventDefault();
          event.stopPropagation();
          setCurrentUserPresenceStatus(profileStatus.getAttribute("data-ascord-profile-status-value")).catch(function (error) {
            showError((error && error.message) || "현재 상태를 바꾸지 못했습니다.");
          });
          return;
        }
        const profileAction = event.target instanceof Element ? event.target.closest("[data-ascord-profile-menu-action]") : null;
        if (profileAction) {
          event.preventDefault();
          event.stopPropagation();
          handleAscordProfileMenuAction(profileAction.getAttribute("data-ascord-profile-menu-action")).catch(function (error) {
            showError((error && error.message) || "프로필 메뉴 작업을 처리하지 못했습니다.");
          });
          return;
        }
        const profileToggle = event.target instanceof Element ? event.target.closest("[data-ascord-profile-menu-toggle]") : null;
        if (profileToggle) {
          event.preventDefault();
          event.stopPropagation();
          if (state.ascordProfileMenuOpen) {
            setAscordProfileMenuOpen(false);
          } else {
            openAscordProfileMenu().catch(function (error) {
              showError((error && error.message) || "프로필 메뉴를 열지 못했습니다.");
            });
          }
          return;
        }
        const target = event.target instanceof Element ? event.target.closest("[data-ascord-dock-action]") : null;
        if (!target || target.hasAttribute("disabled")) return;
        handleAscordDockAction(target.getAttribute("data-ascord-dock-action")).catch(function (error) {
          showError((error && error.message) || "음성채널 도크 작업을 처리하지 못했습니다.");
        });
      });
    }
    if (dom.ascordCallDock) {
      dom.ascordCallDock.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target.closest("[data-ascord-call-dock-action]") : null;
        if (!target || target.hasAttribute("disabled")) return;
        handleAscordDockAction(target.getAttribute("data-ascord-call-dock-action")).catch(function (error) {
          showError((error && error.message) || "통화 도크 작업을 처리하지 못했습니다.");
        });
      });
      dom.ascordCallDock.addEventListener("pointerenter", function () {
        syncAscordCallDockVisibility();
      });
      dom.ascordCallDock.addEventListener("pointerleave", function () {
        scheduleAscordCallDockVisibilitySync(24);
      });
    }
    if (dom.callStage) {
      dom.callStage.addEventListener("pointerenter", function () {
        syncAscordCallDockVisibility();
      });
      dom.callStage.addEventListener("pointerleave", function () {
        scheduleAscordCallDockVisibilitySync(24);
      });
      dom.callStage.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target.closest("[data-call-prompt-action]") : null;
        if (target && !target.hasAttribute("disabled")) {
          const action = normalizeText(target.getAttribute("data-call-prompt-action")).toLowerCase();
          if (action === "join-audio") {
            startOrJoinCall("audio").catch(function (error) {
              showError((error && error.message) || "음성채널에 입장하지 못했습니다.");
            });
          }
          return;
        }
        const stageAction = event.target instanceof Element ? event.target.closest("[data-ascord-stage-action]") : null;
        if (stageAction && !stageAction.hasAttribute("disabled")) {
          const action = normalizeText(stageAction.getAttribute("data-ascord-stage-action")).toLowerCase();
          if (action === "invite") {
            inviteMembersToRoom(currentAscordWorkspaceRoom() || state.activeRoom).catch(function (error) {
              showError((error && error.message) || "초대 모달을 열지 못했습니다.");
            });
            return;
          }
          if (action === "activity") {
            showWarning("활동 선택 UI는 열 수 있지만, 현재 ABBAS ASCORD에는 Discord Activities와 동일한 앱형 활동 생태계는 아직 연결되어 있지 않습니다.", "활동 선택").catch(function () {});
          }
        }
      });
    }
    if (dom.callFullscreen) {
      dom.callFullscreen.addEventListener("click", function (event) {
        const closeTarget = event.target instanceof Element ? event.target.closest("[data-call-fullscreen-close]") : null;
        if (closeTarget || event.target === dom.callFullscreen) {
          closeCallFullscreen();
        }
      });
    }
    if (dom.callFullscreenCloseBtn) {
      dom.callFullscreenCloseBtn.addEventListener("click", function () {
        closeCallFullscreen();
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
        if (action === "leave-room") leaveRoom(state.activeRoom);
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
        if (state.viewMode === "ascord") {
          openAscordCreateModal({ category: ascordWorkspaceName(), channelMode: "voice" });
          return;
        }
        setModalMode(defaultModalModeForCurrentView());
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

    if (dom.groupNameInput) {
      dom.groupNameInput.addEventListener("input", updateCreateRoomSubmitState);
    }

    if (dom.ascordChannelTypeList) {
      Array.prototype.forEach.call(dom.ascordChannelTypeList.querySelectorAll("[data-ascord-channel-kind]"), function (button) {
        button.addEventListener("click", function () {
          setAscordCreateChannelKind(button.getAttribute("data-ascord-channel-kind")).catch(function (error) {
            showError((error && error.message) || "채널 유형을 바꾸지 못했습니다.");
          });
        });
      });
    }

    if (dom.ascordPrivateToggle) {
      dom.ascordPrivateToggle.addEventListener("click", function () {
        setAscordCreatePrivate(!state.ascordCreatePrivate);
      });
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
      if (state.ascordServerMenuOpen && target instanceof Node && ((!dom.ascordServerMenu || !dom.ascordServerMenu.contains(target)) && (!dom.ascordWorkspaceBtn || !dom.ascordWorkspaceBtn.contains(target)))) {
        setAscordServerMenuOpen(false);
      }
      if (state.ascordProfileMenuOpen && target instanceof Element) {
        const withinProfileMenu = !!target.closest("[data-ascord-profile-menu]");
        const withinProfileToggle = !!target.closest("[data-ascord-profile-menu-toggle]");
        if (!withinProfileMenu && !withinProfileToggle) {
          setAscordProfileMenuOpen(false);
        }
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
      const target = event.target;
      const editingTarget = target instanceof Element && !!target.closest("input, textarea, select, [contenteditable='true']");
      if (state.viewMode === "ascord" && state.call.pushToTalk && state.call.joinedRoomId && event.code === "Space" && !editingTarget) {
        if (!state.call.pushToTalkPressed) {
          state.call.pushToTalkPressed = true;
          syncCallTransmitState().catch(function () {});
        }
        event.preventDefault();
      }
      if (event.key === "Escape" && state.notificationMenuOpen) {
        setNotificationMenuOpen(false);
        return;
      }
      if (event.key === "Escape" && state.call.fullscreenTrackId) {
        closeCallFullscreen();
        return;
      }
      if (event.key === "Escape" && state.roomDrawerOpen) {
        setRoomDrawerOpen(false);
        return;
      }
      if (event.key === "Escape" && state.ascordServerMenuOpen) {
        setAscordServerMenuOpen(false);
        return;
      }
      if (event.key === "Escape" && state.ascordProfileMenuOpen) {
        setAscordProfileMenuOpen(false);
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

    document.addEventListener("keyup", function (event) {
      const target = event.target;
      const editingTarget = target instanceof Element && !!target.closest("input, textarea, select, [contenteditable='true']");
      if (state.viewMode === "ascord" && state.call.pushToTalk && state.call.joinedRoomId && event.code === "Space" && !editingTarget) {
        if (state.call.pushToTalkPressed) {
          state.call.pushToTalkPressed = false;
          syncCallTransmitState().catch(function () {});
        }
        event.preventDefault();
      }
    });

    window.addEventListener("mousemove", movePopupDrag);
    window.addEventListener("mouseup", endPopupDrag);
    window.addEventListener("resize", function () {
      restorePopupOffset();
    });
    if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === "function") {
      navigator.mediaDevices.addEventListener("devicechange", function () {
        refreshCallDevices().catch(function () {});
      });
    }

    window.addEventListener("pagehide", function () {
      endPopupDrag();
      stopHeartbeat();
      if (state.call.joinedRoomId) {
        disconnectLiveKitRoom(true, { playSound: false }).catch(function () {});
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
    dom.windowTitle = $("messengerWindowTitle");
    dom.talkModeBtn = $("messengerTalkModeBtn");
    dom.ascordModeBtn = $("messengerAscordModeBtn");
    dom.modePrimaryChip = $("messengerModePrimaryChip");
    dom.modeSecondaryChip = $("messengerModeSecondaryChip");
    dom.callInviteStack = $("messengerCallInviteStack");
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
    dom.ascordWorkspaceBtn = $("messengerAscordWorkspaceBtn");
    dom.ascordServerMenu = $("messengerAscordServerMenu");
    dom.ascordInviteBtn = $("messengerAscordInviteBtn");
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
    dom.chatHeaderAnchor = $("messengerChatHeaderAnchor");
    dom.callStrip = $("messengerCallStrip");
    dom.callStatusBadge = $("messengerCallStatusBadge");
    dom.callStatusTitle = $("messengerCallStatusTitle");
    dom.callStatusMeta = $("messengerCallStatusMeta");
    dom.audioCallBtn = $("messengerAudioCallBtn");
    dom.videoCallBtn = $("messengerVideoCallBtn");
    dom.stageSelfBtn = $("messengerStageSelfBtn");
    dom.stageQueueBtn = $("messengerStageQueueBtn");
    dom.toggleMicBtn = $("messengerToggleMicBtn");
    dom.toggleCameraBtn = $("messengerToggleCameraBtn");
    dom.screenShareBtn = $("messengerScreenShareBtn");
    dom.deafenBtn = $("messengerDeafenBtn");
    dom.pushToTalkBtn = $("messengerPushToTalkBtn");
    dom.callLayoutBtn = $("messengerCallLayoutBtn");
    dom.leaveCallBtn = $("messengerLeaveCallBtn");
    dom.callStage = $("messengerCallStage");
    dom.callStageHeaderSlot = $("messengerCallStageHeaderSlot");
    dom.callGrid = $("messengerCallGrid");
    dom.callAudioSink = $("messengerCallAudioSink");
    dom.ascordVoiceDock = $("messengerAscordVoiceDock");
    dom.ascordCallDock = $("messengerAscordCallDock");
    dom.callFullscreen = $("messengerCallFullscreen");
    dom.callFullscreenTitle = $("messengerCallFullscreenTitle");
    dom.callFullscreenMeta = $("messengerCallFullscreenMeta");
    dom.callFullscreenMedia = $("messengerCallFullscreenMedia");
    dom.callFullscreenCloseBtn = $("messengerCallFullscreenCloseBtn");
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
    dom.roomDrawer = $("messengerRoomDrawer");
    dom.roomDrawerIcon = $("messengerRoomDrawerIcon");
    dom.roomDrawerTitle = $("messengerRoomDrawerTitle");
    dom.roomDrawerCloseBtn = $("messengerRoomDrawerCloseBtn");
    dom.roomDrawerBody = $("messengerRoomDrawerBody");
    dom.meetingNotesModal = $("messengerMeetingNotesModal");
    dom.meetingNotesBrowser = $("messengerMeetingNotesBrowser");
    dom.meetingNotesChannels = $("messengerMeetingNotesChannels");
    dom.meetingNotesNotes = $("messengerMeetingNotesNotes");
    dom.meetingNoteViewerModal = $("messengerMeetingNoteViewerModal");
    dom.meetingNoteViewerTitle = $("messengerMeetingNoteViewerTitle");
    dom.meetingNoteViewerMeta = $("messengerMeetingNoteViewerMeta");
    dom.meetingNoteViewerContent = $("messengerMeetingNoteViewerContent");
    dom.roomInfo = $("messengerRoomInfo");
    dom.participantPanelLabel = $("messengerParticipantPanelLabel");
    dom.participantList = $("messengerParticipantList");
    dom.participantCount = $("messengerParticipantCount");
    dom.inviteMemberBtn = $("messengerInviteMemberBtn");
    dom.inspectorBadge = $("messengerInspectorBadge");
    dom.infoPanelLabel = $("messengerInfoPanelLabel");
    dom.infoPanelCode = $("messengerInfoPanelCode");
    dom.resourcePanelLabel = $("messengerResourcePanelLabel");
    dom.resourcePanelCode = $("messengerResourcePanelCode");
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
    dom.talkCreateLayout = $("messengerTalkCreateLayout");
    dom.ascordCreateLayout = $("messengerAscordCreateLayout");
    dom.ascordCreateSubtitle = $("messengerAscordCreateSubtitle");
    dom.ascordChannelTypeList = $("messengerAscordChannelTypeList");
    dom.ascordCreateNamePrefix = $("messengerAscordCreateNamePrefix");
    dom.ascordCreateEmojiBtn = $("messengerAscordCreateEmojiBtn");
    dom.ascordPrivateWrap = $("messengerAscordPrivateWrap");
    dom.ascordPrivateToggle = $("messengerAscordPrivateToggle");
    dom.groupNameWrap = $("messengerGroupNameWrap");
    dom.groupTopicWrap = $("messengerGroupTopicWrap");
    dom.groupCategoryWrap = $("messengerGroupCategoryWrap");
    dom.groupChannelModeWrap = $("messengerGroupChannelModeWrap");
    dom.groupNameInput = $("messengerGroupNameInput");
    dom.groupTopicInput = $("messengerGroupTopicInput");
    dom.groupCategoryInput = $("messengerGroupCategoryInput");
    dom.groupChannelModeInput = $("messengerGroupChannelModeInput");
    dom.contactSearchWrap = $("messengerContactSearchWrap");
    dom.contactPickerWrap = $("messengerContactPickerWrap");
    dom.contactSearch = $("messengerContactSearch");
    dom.contactPicker = $("messengerContactPicker");
    dom.createRoomSubmitBtn = $("messengerCreateRoomSubmitBtn");
    const modalElement = $("messengerNewRoomModal");
    dom.newRoomModalInstance = modalElement && window.bootstrap ? new bootstrap.Modal(modalElement) : null;
    dom.meetingNotesModalInstance = dom.meetingNotesModal && window.bootstrap ? new bootstrap.Modal(dom.meetingNotesModal) : null;
    dom.meetingNoteViewerModalInstance = dom.meetingNoteViewerModal && window.bootstrap ? new bootstrap.Modal(dom.meetingNoteViewerModal) : null;
  }

  async function init() {
    if (state.initialized) return true;
    if (state.initPromise) return state.initPromise;
    state.initPromise = (async function () {
      cacheDom();
      if (!dom.root) return false;
      loadPreferences();
      loadViewModePreference();
      loadCallPreferences();
      loadRecentRooms();
      applyPreferences();
      applyViewModeChrome();
      restorePopupOffset();
      bindEvents();
      renderIncomingCallInvites();
      syncFilterTabs(state.filter);
      setSidebarMode("rooms");
      setModalMode(defaultModalModeForCurrentView());
      resizeComposer();
      renderEmojiPicker();
      renderMentionPicker();
      refreshCallDevices().catch(function () {});
      ensureUiTicker();
      try {
        await loadBootstrap(Number(dom.root.getAttribute("data-requested-room-id") || 0));
        state.authLost = false;
        connectSocket();
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
      state.initialized = true;
      return true;
    })().catch(function (error) {
      state.initialized = false;
      try {
        console.error("[ABBASMessenger:init]", error);
      } catch (_) {}
      throw error;
    }).finally(function () {
      state.initPromise = null;
    });
    return state.initPromise;
  }

  window.ABBASMessenger = {
    isReady: function () {
      return !!state.initialized;
    },
    ensureInit: function () {
      return init();
    },
    open: async function () {
      if (!state.initialized) {
        try {
          await init();
        } catch (_) {}
      }
      setPopupOpen(true);
    },
    close: function () {
      setPopupOpen(false);
    },
    toggle: async function () {
      if (!state.initialized) {
        try {
          await init();
        } catch (_) {}
      }
      togglePopup();
    },
    openNotifications: async function () {
      if (!state.initialized) {
        try {
          await init();
        } catch (_) {}
      }
      setNotificationMenuOpen(true);
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
