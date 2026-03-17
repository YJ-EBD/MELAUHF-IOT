/*
 * iot_subscription.c
 *
 * Included by IOT_mode.c to keep subscription and energy logic grouped
 * without changing the original translation-unit behavior.
 */

static void sub_copy_field(char *dst, uint8_t dstSz, const char *src)
{
	uint8_t i = 0;
	if ((dst == 0) || (dstSz == 0))
	{
		return;
	}
	dst[0] = 0;
	if (src == 0)
	{
		return;
	}
	while ((src[i] != 0) && (i + 1 < dstSz))
	{
		char c = src[i];
		if ((c == '|') || (c == '\r') || (c == '\n'))
		{
			break;
		}
		if ((c >= 0x20) && (c <= 0x7E))
		{
			dst[i] = c;
		}
		else
		{
			dst[i] = ' ';
		}
		i++;
	}
	dst[i] = 0;
}

static void sub_build_dday(int16_t remain, char *out, uint8_t outSz)
{
	if ((out == 0) || (outSz == 0))
	{
		return;
	}
	if (remain < 0)
	{
		remain = 0;
	}
	snprintf(out, outSz, "D-%d", (int)remain);
}

static void sub_apply_active(const char *planTok, const char *rangeTok, int remain)
{
	if ((planTok == 0) || (rangeTok == 0))
	{
		return;
	}
	if (remain < 0)
	{
		remain = 0;
	}

	sub_copy_field(sub_plan_text, sizeof(sub_plan_text), planTok);
	sub_copy_field(sub_range_text, sizeof(sub_range_text), rangeTok);
	sub_remain_days = (int16_t)remain;
	sub_build_dday(sub_remain_days, sub_dday_text, sizeof(sub_dday_text));
	sub_active = 1;
	sub_dirty = 1;
	sub_state_seen = 1U;
	sub_state_code = SUB_STATE_ACTIVE;
	subscription_ready_pending_cancel();
	// Always push text VPs (0x3100/0x3300) as soon as SUB line is parsed.
	// Icon VPs are still page-scoped inside SUBSCRIPTION_Render57().
	SUBSCRIPTION_Render57(sub_plan_text, sub_range_text, sub_dday_text, sub_remain_days);
	if (dwin_page_now == 57)
	{
		sub_dirty = 0;
	}
}

static void sub_clear_state(void)
{
	sub_active = 0;
	sub_dirty = 0;
}

static U08 g_energy_live_session_active = 0U;
static uint32_t g_energy_live_session_start_total = 0U;

static void energy_reset_sync_state(void)
{
	g_energy_sync_seen_mask = 0U;
	g_energy_live_session_active = 0U;
	g_energy_live_session_start_total = 0U;
}

static U08 energy_sync_ready(void)
{
	return ((g_energy_sync_seen_mask & (ENERGY_SYNC_SEEN_ASSIGNED | ENERGY_SYNC_SEEN_USED)) ==
	        (ENERGY_SYNC_SEEN_ASSIGNED | ENERGY_SYNC_SEEN_USED)) ? 1U : 0U;
}

static void energy_clear_subscription_snapshot(void)
{
	g_energy_assigned_j = 0U;
	g_energy_used_j = 0U;
	g_energy_daily_avg_j = 0U;
	g_energy_monthly_avg_j = 0U;
	g_energy_projected_j = 0U;
	g_energy_elapsed_days = 1U;
	g_energy_remaining_days = 0U;
	g_energy_local_expired_lock = 0U;
	g_energy_dirty = 1U;
	energy_reset_sync_state();
}

static void subscription_ready_pending_cancel(void)
{
	sub_ready_pending = 0U;
	sub_ready_pending_sec = 0U;
}

static void subscription_ready_pending_arm(void)
{
	sub_ready_pending = 1U;
	sub_ready_pending_sec = p63_now_sec();
}

static void subscription_ready_pending_tick(void)
{
	uint32_t nowSec;
	U08 page = dwin_page_now;

	if (!sub_ready_pending)
	{
		return;
	}
	if (sub_state_code != SUB_STATE_READY)
	{
		subscription_ready_pending_cancel();
		return;
	}
	if ((page == WIFI_PAGE_BOOT_CHECK) || (page == WIFI_PAGE_CONNECTING))
	{
		return;
	}

	nowSec = p63_now_sec();
	if ((uint32_t)(nowSec - sub_ready_pending_sec) < SUB_READY_GRACE_SEC)
	{
		return;
	}

	subscription_ready_pending_cancel();
	sub_state_seen = 1U;
	sub_state_code = SUB_STATE_EXPIRED;
	subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
}

static void subscription_show_connected_page(void)
{
	if (dwin_page_now == WIFI_PAGE_BOOT_CHECK)
	{
		return;
	}
	if (dwin_page_now != WIFI_PAGE_CONNECTED)
	{
		pageChange(WIFI_PAGE_CONNECTED);
	}
	p63_wifi_page_last_sent = WIFI_PAGE_CONNECTED;
	p63_boot_resume_page = WIFI_PAGE_CONNECTED;
	p63_boot_waiting_status = 0;
}

static void registration_restore_registered_page(void)
{
	U08 targetPage = p63_boot_resume_page;

	if (dwin_page_now == WIFI_PAGE_REGISTER_WAIT)
	{
		wifi_reboot_for_connected_state();
		return;
	}

	if ((targetPage == 0) || (targetPage == 0xFF))
	{
		targetPage = WIFI_PAGE_CONNECTED;
	}

	if ((dwin_page_now == WIFI_PAGE_LIST) || (dwin_page_now == 0) || (dwin_page_now == 0xFF))
	{
		if (targetPage == WIFI_PAGE_CONNECTED)
		{
			subscription_show_connected_page();
		}
		else if (dwin_page_now != targetPage)
		{
			pageChange(targetPage);
			p63_wifi_page_last_sent = targetPage;
			p63_boot_resume_page = targetPage;
			p63_boot_waiting_status = 0;
		}
	}
}

static void subscription_restore_ready_page(void)
{
	U08 targetPage = WIFI_PAGE_CONNECTED;
	U08 wifiConnected = (p63_wifi_status_seen && (p63_wifi_connected_state == 1U)) ? 1U : 0U;

	if ((dwin_page_now == WIFI_PAGE_LIST) && p63_boot_waiting_status && wifiConnected)
	{
		if (subscription_resolve_connected_target_page(p63_boot_resume_page, &targetPage))
		{
			if (targetPage == WIFI_PAGE_CONNECTED)
			{
				subscription_show_connected_page();
			}
			else
			{
				subscription_enter_lock_page(targetPage);
			}
			return;
		}
	}

	if ((dwin_page_now == WIFI_PAGE_SUB_EXPIRED) || (dwin_page_now == WIFI_PAGE_SUB_OFFLINE))
	{
		if (!wifiConnected)
		{
			return;
		}
		if (subscription_resolve_connected_target_page(p63_boot_resume_page, &targetPage))
		{
			if (targetPage == WIFI_PAGE_CONNECTED)
			{
				subscription_show_connected_page();
			}
			else
			{
				subscription_enter_lock_page(targetPage);
			}
		}
		return;
	}
	registration_restore_registered_page();
}

static void subscription_enter_lock_page(U08 page)
{
	// OTA confirmation page(74) must remain stable until user presses accept/skip.
	// Without this guard, SUB state updates can force page59/20/73 and create
	// a 74 <-> lock-page bounce loop.
	if ((ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE) && (page != OTA_PAGE_FIRMWARE_UPDATE))
	{
		return;
	}

	if (dwin_page_now == WIFI_PAGE_BOOT_CHECK)
	{
		return;
	}
	if (dwin_page_now != page)
	{
		pageChange(page);
	}
	p63_wifi_page_last_sent = page;
	p63_boot_waiting_status = 0;
}

void energy_local_expired_page_tick(void)
{
	if (!g_energy_local_expired_lock)
	{
		return;
	}
	if ((sub_state_code != SUB_STATE_ACTIVE) &&
	    (sub_state_code != SUB_STATE_READY) &&
	    (sub_active == 0U))
	{
		return;
	}
	if (dwin_page_now == WIFI_PAGE_CONNECTING)
	{
		return;
	}
	sub_clear_state();
	sub_state_seen = 1U;
	sub_state_code = SUB_STATE_EXPIRED;
	subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
}

static U08 subscription_resolve_connected_target_page(U08 resumePage, U08 *targetPage)
{
	U08 target = resumePage;

	if (targetPage == 0)
	{
		return 0U;
	}

	if ((target == 0) || (target == 0xFF))
	{
		target = WIFI_PAGE_CONNECTED;
	}

	if (!reg_gate_status_seen)
	{
		return 0U;
	}

	if (!reg_gate_registered)
	{
		*targetPage = WIFI_PAGE_REGISTER_WAIT;
		return 1U;
	}

	if (!sub_state_seen)
	{
		return 0U;
	}

	switch (sub_state_code)
	{
		case SUB_STATE_ACTIVE:
			if (!energy_sync_ready())
			{
				return 0U;
			}
			if ((g_energy_assigned_j == 0U) || g_energy_local_expired_lock || energy_subscription_exhausted())
			{
				*targetPage = WIFI_PAGE_SUB_EXPIRED;
				return 1U;
			}
			*targetPage = target;
			return 1U;

		case SUB_STATE_READY:
			*targetPage = WIFI_PAGE_SUB_EXPIRED;
			return 1U;

		case SUB_STATE_EXPIRED:
			*targetPage = WIFI_PAGE_SUB_EXPIRED;
			return 1U;

		case SUB_STATE_UNREGISTERED:
			*targetPage = WIFI_PAGE_REGISTER_WAIT;
			return 1U;

		case SUB_STATE_OFFLINE:
			*targetPage = WIFI_PAGE_SUB_OFFLINE;
			return 1U;

		default:
			break;
	}

	return 0U;
}

static uint8_t sub_token_equals_ci(const char *tok, uint8_t tokLen, const char *ref)
{
	uint8_t i = 0;
	if ((tok == 0) || (ref == 0))
	{
		return 0;
	}

	while (i < tokLen)
	{
		char c = tok[i];
		char r = ref[i];
		if (r == 0)
		{
			return 0;
		}
		if ((c >= 'a') && (c <= 'z'))
		{
			c = (char)(c - 'a' + 'A');
		}
		if ((r >= 'a') && (r <= 'z'))
		{
			r = (char)(r - 'a' + 'A');
		}
		if (c != r)
		{
			return 0;
		}
		i++;
	}
	return (ref[i] == 0) ? 1U : 0U;
}

static uint8_t sub_extract_kv_field(const char *line, const char *key, char *out, uint8_t outSz)
{
	const char *p;
	uint8_t keyLen;
	char quote = 0;
	uint8_t i = 0;

	if ((line == 0) || (key == 0) || (out == 0) || (outSz == 0))
	{
		return 0;
	}
	out[0] = 0;

	keyLen = (uint8_t)strlen(key);
	p = strstr(line, key);
	if (p == 0)
	{
		return 0;
	}
	p += keyLen;

	while ((*p == ' ') || (*p == '\t'))
	{
		p++;
	}
	if ((*p == '\'') || (*p == '"'))
	{
		quote = *p;
		p++;
	}

	while ((*p != 0) && (i + 1 < outSz))
	{
		if (quote != 0)
		{
			if (*p == quote)
			{
				break;
			}
		}
		else if ((*p == ' ') || (*p == '\t'))
		{
			break;
		}
		out[i++] = *p;
		p++;
	}
	out[i] = 0;
	return (i > 0) ? 1U : 0U;
}

static uint8_t sub_extract_kv_int(const char *line, const char *key, int *outVal)
{
	const char *p;
	uint8_t keyLen;
	int sign = 1;
	int value = 0;
	uint8_t hasDigit = 0;

	if ((line == 0) || (key == 0) || (outVal == 0))
	{
		return 0;
	}

	keyLen = (uint8_t)strlen(key);
	p = strstr(line, key);
	if (p == 0)
	{
		return 0;
	}
	p += keyLen;

	while ((*p == ' ') || (*p == '\t'))
	{
		p++;
	}
	if ((*p == '\'') || (*p == '"'))
	{
		p++;
	}
	if (*p == '-')
	{
		sign = -1;
		p++;
	}
	while ((*p >= '0') && (*p <= '9'))
	{
		value = (value * 10) + (int)(*p - '0');
		hasDigit = 1;
		p++;
	}
	if (!hasDigit)
	{
		return 0;
	}

	*outVal = value * sign;
	return 1U;
}

static void sub_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *planTok;
	char *rangeTok;
	char *remainTok;
	int remain;

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "SUB") != 0))
	{
		return;
	}

	tok = strtok_r(0, "|", &savep);
	if (tok == 0)
	{
		return;
	}

	if ((strcmp(tok, "A") == 0) || (strcmp(tok, "ACTIVE") == 0))
	{
		if (g_energy_local_expired_lock)
		{
			sub_clear_state();
			sub_state_seen = 1U;
			sub_state_code = SUB_STATE_EXPIRED;
			subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
			return;
		}
		planTok = strtok_r(0, "|", &savep);
		rangeTok = strtok_r(0, "|", &savep);
		remainTok = strtok_r(0, "|", &savep);

		if ((planTok == 0) || (rangeTok == 0) || (remainTok == 0))
		{
			return;
		}

		remain = atoi(remainTok);
		sub_apply_active(planTok, rangeTok, remain);
		if (dwin_page_now == WIFI_PAGE_CONNECTING)
		{
			return;
		}
		subscription_restore_ready_page();
		return;
	}

	sub_clear_state();
	if (dwin_page_now == WIFI_PAGE_CONNECTING)
	{
		return;
	}

	if ((strcmp(tok, "R") == 0) || (strcmp(tok, "READY") == 0) || (strcmp(tok, "REGISTERED") == 0))
	{
		if (g_energy_local_expired_lock)
		{
			sub_state_seen = 1U;
			sub_state_code = SUB_STATE_EXPIRED;
			subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
			return;
		}
		// READY is only a provisional boot state. Clear local mirrors so revoked/no-plan
		// boots do not reuse stale usage/plan figures from a previous session.
		energy_clear_subscription_snapshot();
		sub_state_seen = 1U;
		sub_state_code = SUB_STATE_READY;
		subscription_ready_pending_arm();
		subscription_restore_ready_page();
		return;
	}

	if ((strcmp(tok, "U") == 0) || (strcmp(tok, "UNREGISTERED") == 0))
	{
		subscription_ready_pending_cancel();
		sub_state_seen = 1U;
		sub_state_code = SUB_STATE_UNREGISTERED;
		if (reg_gate_status_seen && reg_gate_registered)
		{
			subscription_restore_ready_page();
			return;
		}
		subscription_enter_lock_page(WIFI_PAGE_REGISTER_WAIT);
		return;
	}

	if ((strcmp(tok, "E") == 0) || (strcmp(tok, "EXPIRED") == 0) || (strcmp(tok, "RESTRICTED") == 0))
	{
		subscription_ready_pending_cancel();
		sub_state_seen = 1U;
		sub_state_code = SUB_STATE_EXPIRED;
		subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
		return;
	}

	if ((strcmp(tok, "O") == 0) || (strcmp(tok, "OFFLINE") == 0))
	{
		subscription_ready_pending_cancel();
		sub_state_seen = 1U;
		sub_state_code = SUB_STATE_OFFLINE;
		subscription_enter_lock_page(WIFI_PAGE_SUB_OFFLINE);
	}
}

static void sub_parse_log_line(const char *line)
{
	const char *p;
	const char *statusTok;
	uint8_t statusLen = 0;
	char planTok[sizeof(sub_plan_text)];
	char rangeTok[sizeof(sub_range_text)];
	int remain = 0;
	uint8_t hasPlan;
	uint8_t hasRange;
	uint8_t hasRemain;

	if (line == 0)
	{
		return;
	}
	if (strncmp(line, "[SUB]", 5) != 0)
	{
		return;
	}

	p = line + 5;
	while ((*p == ' ') || (*p == '\t'))
	{
		p++;
	}
	statusTok = p;
	while ((*p != 0) && (*p != ' ') && (*p != '\t'))
	{
		if (statusLen < 0xFF)
		{
			statusLen++;
		}
		p++;
	}

	if ((!sub_token_equals_ci(statusTok, statusLen, "A")) &&
	    (!sub_token_equals_ci(statusTok, statusLen, "ACTIVE")))
	{
		// Keep behavior aligned with SUB|... parser.
		sub_active = 0;
		sub_dirty = 0;
		return;
	}

	if (g_energy_local_expired_lock)
	{
		sub_clear_state();
		sub_state_seen = 1U;
		sub_state_code = SUB_STATE_EXPIRED;
		subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
		return;
	}

	hasPlan = sub_extract_kv_field(line, "plan=", planTok, sizeof(planTok));
	hasRange = sub_extract_kv_field(line, "period=", rangeTok, sizeof(rangeTok));
	if (!hasRange)
	{
		hasRange = sub_extract_kv_field(line, "range=", rangeTok, sizeof(rangeTok));
	}
	hasRemain = sub_extract_kv_int(line, "remain=", &remain);

	if ((!hasPlan) || (!hasRange) || (!hasRemain))
	{
		return;
	}

	sub_apply_active(planTok, rangeTok, remain);
}

// [NEW FEATURE] Parse integer metric token from ESP line payload.
static uint32_t energy_parse_u32_token(const char *tok, uint32_t fallback)
{
	char *endp = 0;
	unsigned long v;
	if (tok == 0)
	{
		return fallback;
	}
	v = strtoul(tok, &endp, 10);
	if ((endp == 0) || (endp == tok))
	{
		return fallback;
	}
	return (uint32_t)v;
}

static U08 energy_subscription_exhausted(void)
{
	if (g_energy_assigned_j == 0U)
	{
		return 0U;
	}
	return (g_energy_used_j >= g_energy_assigned_j) ? 1U : 0U;
}

static uint64_t energy_effective_used_with_live_session(uint32_t totalEnergyNow)
{
	uint64_t used = (uint64_t)g_energy_used_j;

	if (g_energy_live_session_active &&
	    (totalEnergyNow >= g_energy_live_session_start_total))
	{
		used += (uint64_t)(totalEnergyNow - g_energy_live_session_start_total);
	}

	return used;
}

void energy_subscription_note_run_state(U08 runActive, uint32_t totalEnergyNow)
{
	g_energy_live_session_active = runActive ? 1U : 0U;
	g_energy_live_session_start_total = totalEnergyNow;
}

static void energy_apply_local_expired_lock(void)
{
	if (!energy_subscription_exhausted())
	{
		g_energy_local_expired_lock = 0U;
		return;
	}

	g_energy_local_expired_lock = 1U;
	sub_clear_state();
	sub_state_seen = 1U;
	sub_state_code = SUB_STATE_EXPIRED;
	subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
}

U08 energy_subscription_runtime_guard(uint32_t totalEnergyNow)
{
	uint64_t effectiveUsed;
	uint32_t localUsed;

	if (g_energy_assigned_j == 0U)
	{
		return 0U;
	}

	if (!g_energy_live_session_active)
	{
		g_energy_live_session_active = 1U;
		g_energy_live_session_start_total = totalEnergyNow;
		return 0U;
	}

	effectiveUsed = energy_effective_used_with_live_session(totalEnergyNow);
	if (effectiveUsed < (uint64_t)g_energy_assigned_j)
	{
		return 0U;
	}

	localUsed = (effectiveUsed > 0xFFFFFFFFULL) ? 0xFFFFFFFFUL : (uint32_t)effectiveUsed;
	if (localUsed < g_energy_assigned_j)
	{
		localUsed = g_energy_assigned_j;
	}
	if (localUsed > g_energy_used_j)
	{
		g_energy_used_j = localUsed;
	}
	g_energy_sync_seen_mask |= ENERGY_SYNC_SEEN_USED;
	g_energy_dirty = 1U;
	g_energy_local_expired_lock = 1U;

	if (opPage & 0x02)
	{
		setStandby();
		opPage = 1;
		old_totalEnergy = totalEnergy;
		TE_Display(old_totalEnergy);
		energy_uart_publish_run_event(0U, totalEnergy);
	}

	energy_subscription_note_run_state(0U, totalEnergyNow);
	sub_clear_state();
	sub_state_seen = 1U;
	sub_state_code = SUB_STATE_EXPIRED;
	subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
	return 1U;
}

// [NEW FEATURE] Page57 status icon formula (expected/included ratio).
static U08 energy_calc_status_icon(void)
{
	uint32_t used = g_energy_used_j;
	uint32_t elapsed = (g_energy_elapsed_days == 0U) ? 1U : (uint32_t)g_energy_elapsed_days;
	uint32_t remain = (uint32_t)g_energy_remaining_days;
	uint32_t included = g_energy_assigned_j;
	uint64_t expectedScaled;
	uint64_t includedScaled;

	if (included == 0U)
	{
		return 2U;
	}

	// [NEW FEATURE] Compare ratio without truncating avg_day early.
	expectedScaled = (uint64_t)used * (uint64_t)(elapsed + remain);
	includedScaled = (uint64_t)included * (uint64_t)elapsed;

	if (expectedScaled <= includedScaled)
	{
		return 0U;
	}
	if (expectedScaled * 100ULL <= (includedScaled * 110ULL))
	{
		return 1U;
	}
	return 2U;
}

// [NEW FEATURE] Remaining included energy percentage for page57 (clamped 0..100).
static uint32_t energy_calc_remaining_percent(void)
{
	uint32_t included = g_energy_assigned_j;
	uint32_t used = g_energy_used_j;
	uint32_t remain;

	if (included == 0U)
	{
		return 0U;
	}

	if (used >= included)
	{
		return 0U;
	}

	remain = included - used;
	return (uint32_t)(((uint64_t)remain * 100ULL) / (uint64_t)included);
}

// [NEW FEATURE] Page57 remaining-energy icon selector for VAR ICON 0xDB01.
static uint16_t energy_calc_remaining_icon(uint32_t remainPercent)
{
	if (remainPercent >= 100U) return 23U;
	if (remainPercent >= 95U) return 22U;
	if (remainPercent >= 90U) return 21U;
	if (remainPercent >= 85U) return 20U;
	if (remainPercent >= 80U) return 19U;
	if (remainPercent >= 75U) return 18U;
	if (remainPercent >= 70U) return 17U;
	if (remainPercent >= 65U) return 16U;
	if (remainPercent >= 60U) return 15U;
	if (remainPercent >= 55U) return 14U;
	if (remainPercent >= 50U) return 13U;
	if (remainPercent >= 45U) return 12U;
	if (remainPercent >= 40U) return 11U;
	if (remainPercent >= 35U) return 10U;
	if (remainPercent >= 30U) return 9U;
	if (remainPercent >= 25U) return 8U;
	if (remainPercent >= 20U) return 7U;
	if (remainPercent >= 15U) return 6U;
	if (remainPercent >= 10U) return 5U;
	if (remainPercent >= 7U) return 4U;
	if (remainPercent >= 5U) return 3U;
	if (remainPercent >= 3U) return 2U;
	if (remainPercent >= 1U) return 1U;
	return 0U;
}

// [NEW FEATURE] Render page57 energy texts + status icon using existing DWIN writers.
static void energy_render_page57(void)
{
	char buf[24];
	uint32_t remainPercent = energy_calc_remaining_percent();

	snprintf(buf, sizeof(buf), "%lu", (unsigned long)g_energy_assigned_j);
	dwin_write_text(0xA100, buf, 20);
	snprintf(buf, sizeof(buf), "%lu", (unsigned long)g_energy_used_j);
	dwin_write_text(0xA200, buf, 20);
	snprintf(buf, sizeof(buf), "%lu", (unsigned long)g_energy_daily_avg_j);
	dwin_write_text(0xA300, buf, 20);
	snprintf(buf, sizeof(buf), "%lu", (unsigned long)g_energy_monthly_avg_j);
	dwin_write_text(0xA400, buf, 20);
	snprintf(buf, sizeof(buf), "%lu", (unsigned long)g_energy_projected_j);
	dwin_write_text(0xA500, buf, 20);
	snprintf(buf, sizeof(buf), "%lu%%", (unsigned long)remainPercent);
	dwin_write_text(0xDA10, buf, 4);
	varIconInt(0xDB01, energy_calc_remaining_icon(remainPercent));
	varIconInt(0xBB22, (uint16_t)energy_calc_status_icon());
}

// [NEW FEATURE] Render page71 energy texts using existing DWIN writers.
static void energy_render_page71(void)
{
	char buf[24];
	char versionLine[PAGE71_TEXT_LEN + 1];
	uint8_t vi = 0;
	uint8_t oi = 0;

	versionLine[oi++] = 'E';
	versionLine[oi++] = 'S';
	versionLine[oi++] = 'P';
	versionLine[oi++] = ' ';
	versionLine[oi++] = 'V';
	versionLine[oi++] = 'e';
	versionLine[oi++] = 'r';
	versionLine[oi++] = ' ';
	if (page71_esp_version_text[0] != 0)
	{
		while ((page71_esp_version_text[vi] != 0) && (oi < PAGE71_TEXT_LEN))
		{
			versionLine[oi++] = page71_esp_version_text[vi++];
		}
	}
	else
	{
		versionLine[oi++] = '-';
	}
	versionLine[oi] = 0;
	dwin_write_text(PAGE71_TEXT_VP_ESP_VERSION, versionLine, PAGE71_TEXT_LEN);
	versionLine[0] = 'A';
	versionLine[1] = 'T';
	versionLine[2] = 'm';
	versionLine[3] = 'e';
	versionLine[4] = 'g';
	versionLine[5] = 'a';
	versionLine[6] = ' ';
	versionLine[7] = 'V';
	versionLine[8] = 'e';
	versionLine[9] = 'r';
	versionLine[10] = ' ';
	versionLine[11] = 0;
	dwin_write_text(PAGE71_TEXT_VP_ATMEGA_VERSION, versionLine, PAGE71_TEXT_LEN);

	snprintf(buf, sizeof(buf), "%lu", (unsigned long)g_energy_used_j);
	dwin_write_text(0xB100, buf, 20);
	dwin_write_text(0xB200, "10", 2);
	dwin_write_text(0xB300, "20", 2);
}

// [NEW FEATURE] Parse ESP metrics line: ENG|<A/U/D/M/P/E/R>|<value>.
static void energy_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *cmdTok;
	char *valTok;
	uint32_t val;

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "ENG") != 0))
	{
		return;
	}

	cmdTok = strtok_r(0, "|", &savep);
	valTok = strtok_r(0, "|", &savep);
	if ((cmdTok == 0) || (valTok == 0))
	{
		return;
	}

	val = energy_parse_u32_token(valTok, 0U);
	if ((cmdTok[0] == 'A') && (cmdTok[1] == 0))
	{
		g_energy_assigned_j = val;
		g_energy_sync_seen_mask |= ENERGY_SYNC_SEEN_ASSIGNED;
	}
	else if ((cmdTok[0] == 'U') && (cmdTok[1] == 0))
	{
		if (g_energy_local_expired_lock && (val < g_energy_used_j))
		{
			val = g_energy_used_j;
		}
		g_energy_used_j = val;
		g_energy_sync_seen_mask |= ENERGY_SYNC_SEEN_USED;
	}
	else if ((cmdTok[0] == 'D') && (cmdTok[1] == 0))
	{
		g_energy_daily_avg_j = val;
	}
	else if ((cmdTok[0] == 'M') && (cmdTok[1] == 0))
	{
		g_energy_monthly_avg_j = val;
	}
	else if ((cmdTok[0] == 'P') && (cmdTok[1] == 0))
	{
		g_energy_projected_j = val;
	}
	else if ((cmdTok[0] == 'E') && (cmdTok[1] == 0))
	{
		g_energy_elapsed_days = (uint16_t)val;
	}
	else if ((cmdTok[0] == 'R') && (cmdTok[1] == 0))
	{
		g_energy_remaining_days = (uint16_t)val;
	}
	else
	{
		return;
	}

	g_energy_dirty = 1;
	energy_apply_local_expired_lock();
	if ((dwin_page_now != WIFI_PAGE_CONNECTING) &&
	    sub_state_seen &&
	    ((sub_state_code == SUB_STATE_ACTIVE) || (sub_state_code == SUB_STATE_READY)))
	{
		subscription_restore_ready_page();
	}
}

// [NEW FEATURE] Local ATmega fail-safe: exhausted plan energy forces expired page on run key.
U08 energy_subscription_run_key_guard(void)
{
	U08 wasRunning;

	if (!energy_subscription_exhausted())
	{
		return 0U;
	}

	g_energy_local_expired_lock = 1U;
	wasRunning = (opPage & 0x02) ? 1U : 0U;
	if (wasRunning)
	{
		setStandby();
		opPage = 1;
		old_totalEnergy = totalEnergy;
		energy_uart_publish_run_event(0U, totalEnergy);
	}
	energy_subscription_note_run_state(0U, totalEnergy);

	sub_clear_state();
	sub_state_seen = 1U;
	sub_state_code = SUB_STATE_EXPIRED;
	subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
	return 1U;
}

// [NEW FEATURE] Refresh page57/page71 energy widgets on page enter and periodic refresh.
static void energy_ui_tick(void)
{
	static U08 prev_page = 0xFF;
	static uint32_t last_refresh_sec = 0;
	uint32_t nowSec;
	U08 page = dwin_page_now;
	U08 doRender = 0;

	if (prev_page != page)
	{
		prev_page = page;
		if ((page == 57) || (page == 71))
		{
			g_energy_dirty = 1;
		}
	}

	if (!((page == 57) || (page == 71)))
	{
		return;
	}

	cli();
	nowSec = ckTime;
	sei();
	if (g_energy_dirty || (nowSec != last_refresh_sec))
	{
		doRender = 1;
		last_refresh_sec = nowSec;
	}
	if (!doRender)
	{
		return;
	}

	if (page == 57)
	{
		energy_render_page57();
	}
	else if (page == 71)
	{
		energy_render_page71();
	}
	g_energy_dirty = 0;
}

static void registration_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *stateTok;
	U08 wifiConnected;

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "REG") != 0))
	{
		return;
	}

	stateTok = strtok_r(0, "|", &savep);
	if (stateTok == 0)
	{
		return;
	}

	reg_gate_status_seen = 1U;
	reg_gate_registered = (atoi(stateTok) != 0) ? 1U : 0U;

	if (reg_gate_registered && (dwin_page_now == WIFI_PAGE_REGISTER_WAIT))
	{
		registration_restore_registered_page();
		return;
	}

	wifiConnected = (p63_wifi_status_seen && (p63_wifi_connected_state == 1U)) ? 1U : 0U;
	if (!wifiConnected)
	{
		return;
	}

	if (dwin_page_now == WIFI_PAGE_CONNECTING)
	{
		return;
	}

	if (reg_gate_registered)
	{
		registration_restore_registered_page();
	}
	else
	{
		subscription_enter_lock_page(WIFI_PAGE_REGISTER_WAIT);
	}
}

static void page_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *pageTok;
	int pageNum;

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "PAGE") != 0))
	{
		return;
	}

	pageTok = strtok_r(0, "|", &savep);
	if (pageTok == 0)
	{
		return;
	}

	pageNum = atoi(pageTok);
	if (pageNum < 0)
	{
		pageNum = 0;
	}
	if (pageNum > 255)
	{
		pageNum = 255;
	}

	pageChange((U08)pageNum);
	p63_wifi_page_last_sent = (U08)pageNum;
	p63_boot_waiting_status = 0;
}

static U08 subscription_uart_line_is_priority(const char *line)
{
	if (line == 0)
	{
		return 0U;
	}

	if ((strncmp(line, "REG|", 4) == 0) ||
	    (strncmp(line, "SUB|", 4) == 0) ||
	    (strncmp(line, "ENG|", 4) == 0) ||
	    (strncmp(line, "P63|W|", 6) == 0) ||
	    (strncmp(line, "WIFI|R|", 7) == 0))
	{
		return 1U;
	}

	return 0U;
}

static U08 energy_parse_line_fast_isr(const char *line)
{
	uint32_t value = 0U;
	uint8_t i = 6U;
	char key;

	if (line == 0)
	{
		return 0U;
	}
	if ((line[0] != 'E') || (line[1] != 'N') || (line[2] != 'G') ||
	    (line[3] != '|') || (line[5] != '|'))
	{
		return 0U;
	}

	key = line[4];
	if ((line[i] < '0') || (line[i] > '9'))
	{
		return 0U;
	}

	while ((line[i] >= '0') && (line[i] <= '9'))
	{
		value = (uint32_t)(value * 10U) + (uint32_t)(line[i] - '0');
		i++;
	}
	if (line[i] != 0)
	{
		return 0U;
	}

	if (key == 'A')
	{
		g_energy_assigned_j = value;
		g_energy_sync_seen_mask |= ENERGY_SYNC_SEEN_ASSIGNED;
	}
	else if (key == 'U')
	{
		if (g_energy_local_expired_lock && (value < g_energy_used_j))
		{
			value = g_energy_used_j;
		}
		g_energy_used_j = value;
		g_energy_sync_seen_mask |= ENERGY_SYNC_SEEN_USED;
	}
	else if (key == 'D')
	{
		g_energy_daily_avg_j = value;
	}
	else if (key == 'M')
	{
		g_energy_monthly_avg_j = value;
	}
	else if (key == 'P')
	{
		g_energy_projected_j = value;
	}
	else if (key == 'E')
	{
		g_energy_elapsed_days = (uint16_t)value;
	}
	else if (key == 'R')
	{
		g_energy_remaining_days = (uint16_t)value;
	}
	else
	{
		return 0U;
	}

	g_energy_dirty = 1U;
	if ((key == 'A') || (key == 'U'))
	{
		if (energy_subscription_exhausted())
		{
			g_energy_local_expired_lock = 1U;
		}
		else
		{
			g_energy_local_expired_lock = 0U;
		}
	}
	return 1U;
}

static void registration_gate_tick(void)
{
	U08 wifiConnected;

	if (!reg_gate_status_seen)
	{
		return;
	}

	if (dwin_page_now == WIFI_PAGE_CONNECTING)
	{
		return;
	}

	if (reg_gate_registered)
	{
		if (dwin_page_now == WIFI_PAGE_REGISTER_WAIT)
		{
			registration_restore_registered_page();
			return;
		}

		wifiConnected = (p63_wifi_status_seen && (p63_wifi_connected_state == 1U)) ? 1U : 0U;
		if (!wifiConnected)
		{
			return;
		}
		registration_restore_registered_page();
		return;
	}

	wifiConnected = (p63_wifi_status_seen && (p63_wifi_connected_state == 1U)) ? 1U : 0U;
	if (!wifiConnected)
	{
		return;
	}

	if (!reg_gate_registered && (dwin_page_now != WIFI_PAGE_BOOT_CHECK) &&
	    (dwin_page_now != WIFI_PAGE_REGISTER_WAIT))
	{
		subscription_enter_lock_page(WIFI_PAGE_REGISTER_WAIT);
	}
}
