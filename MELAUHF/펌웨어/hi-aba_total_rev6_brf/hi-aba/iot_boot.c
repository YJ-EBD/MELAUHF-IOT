/*
 * iot_boot.c
 *
 * Included by IOT_mode.c to keep boot checks and hardware isolation flow
 * grouped separately while preserving the original translation-unit behavior.
 */

static void page68_render_cached_step(void)
{
	if (page68_current_step >= PAGE68_CHECK_COUNT)
	{
		return;
	}

	SetVarIcon(PAGE68_ICON_VP, (uint16_t)(PAGE68_ICON_INDEX_BASE + page68_current_step));
	dwin_write_text(PAGE68_TEXT_VP, page68_text_cache, PAGE68_TEXT_LEN);
}

static void page68_refresh_view_tick(uint16_t elapsedMs)
{
	if ((!page68_boot_active) || (page68_current_step >= PAGE68_CHECK_COUNT))
	{
		return;
	}

	page68_refresh_elapsed_ms = (uint16_t)(page68_refresh_elapsed_ms + elapsedMs);
	if (page68_refresh_elapsed_ms < PAGE68_REFRESH_PERIOD_MS)
	{
		return;
	}

	page68_refresh_elapsed_ms = 0U;
	page68_render_cached_step();
}

static void page68_boot_step_wait_ms(uint16_t holdMs)
{
	uint16_t remain = holdMs;

	while (remain >= 10)
	{
		asm("wdr");
		subscription_uart_pump_lines();
		page68_refresh_view_tick(10U);
		_delay_ms(10);
		remain = (uint16_t)(remain - 10);
	}

	while (remain > 0)
	{
		asm("wdr");
		subscription_uart_pump_lines();
		page68_refresh_view_tick(1U);
		_delay_ms(1);
		remain--;
	}
}

static void page68_fill_step_text(U08 step, char *textBuf)
{
	if (textBuf == 0)
	{
		return;
	}

	textBuf[0] = 0;
	switch (step)
	{
		case 0: strcpy_P(textBuf, PSTR("Entering Safe Boot...")); break;
		case 1: strcpy_P(textBuf, PSTR("Checking Local State...")); break;
		case 2: strcpy_P(textBuf, PSTR("Waiting for ESP Link...")); break;
		case 3: strcpy_P(textBuf, PSTR("Connecting Wi-Fi...")); break;
		case 4: strcpy_P(textBuf, PSTR("Checking Registration...")); break;
		case 5: strcpy_P(textBuf, PSTR("Checking Subscription...")); break;
		case 6: strcpy_P(textBuf, PSTR("Checking Energy Sync...")); break;
		case 7: strcpy_P(textBuf, PSTR("Deciding Boot Target...")); break;
		case 8: strcpy_P(textBuf, PSTR("Checking Firmware Update...")); break;
		case 9: strcpy_P(textBuf, PSTR("Applying Target Page...")); break;
		default: strcpy_P(textBuf, PSTR("Checking System...")); break;
	}
}

static void page68_begin_session(void)
{
	page68_boot_active = 1U;
	page68_current_step = 0xFF;
	page68_text_cache[0] = 0;
	page68_refresh_elapsed_ms = 0U;
}

static void page68_end_session(void)
{
	page68_boot_active = 0U;
	page68_refresh_elapsed_ms = 0U;
}

static void page68_set_step(U08 step)
{
	char textBuf[PAGE68_TEXT_LEN + 1];

	if (step >= PAGE68_CHECK_COUNT)
	{
		return;
	}
	if ((page68_current_step != 0xFF) && (step < page68_current_step))
	{
		return;
	}

	page68_fill_step_text(step, textBuf);
	strncpy(page68_text_cache, textBuf, PAGE68_TEXT_LEN);
	page68_text_cache[PAGE68_TEXT_LEN] = 0;
	page68_current_step = step;
	page68_refresh_elapsed_ms = 0U;
	page68_render_cached_step();
}

static U08 page68_status_activity_seen(void)
{
	if (p63_wifi_status_seen || reg_gate_status_seen || sub_state_seen)
	{
		return 1U;
	}
	if (p63_boot_wifi_phase != P63_BOOT_WIFI_PHASE_NONE)
	{
		return 1U;
	}
	if (g_energy_sync_seen_mask != 0U)
	{
		return 1U;
	}
	if (ota_boot_prompt_pending_active())
	{
		return 1U;
	}
	if (sub_uart_active || sub_uart_ready || (sub_uart_q_count > 0U))
	{
		return 1U;
	}
	return 0U;
}

static U08 subscription_isolation_page_active(void)
{
	U08 page = dwin_page_now;
	if ((page == WIFI_PAGE_SUB_EXPIRED) || (page == WIFI_PAGE_SUB_OFFLINE))
	{
		return 1U;
	}
	return wifi_is_guard_page(page);
}

static U08 subscription_hw_safe_page_active(void)
{
	U08 page = dwin_page_now;
	// BUGFIX: keep runtime outputs OFF on 7/61/63~68/73 safety pages.
	// Treat unknown page state as safety state during boot/noise windows.
	if ((page == 0) || (page == 0xFF))
	{
		return 1;
	}
	if ((page == WIFI_PAGE_SUB_EXPIRED) || (page == WIFI_PAGE_SUB_OFFLINE))
	{
		return 1;
	}
	if ((page == 7) || (page == WIFI_PAGE_CONNECTED) || (page == WIFI_PAGE_BOOT_CHECK))
	{
		return 1;
	}
	return wifi_is_guard_page(page);
}

static U08 subscription_hw_block_page_active(void)
{
	U08 page = dwin_page_now;
	// BUGFIX: block mode-loop runtime logic on pages that do not need mode touch parsing.
	// Keep runtime blocked while page state is unknown at boot.
	if ((page == 0) || (page == 0xFF))
	{
		return 1;
	}
	if ((page == WIFI_PAGE_SUB_EXPIRED) || (page == WIFI_PAGE_SUB_OFFLINE))
	{
		return 1;
	}
	if ((page == 7) || (page == WIFI_PAGE_BOOT_CHECK))
	{
		return 1;
	}
	return wifi_is_guard_page(page);
}

static void subscription_force_hw_isolation(void)
{
	// Keep runtime hardware outputs inactive while isolation pages are visible.
	// BUGFIX: keep AC(power-hold) ON in safety pages, but force all runtime outputs OFF.
	// Re-assert critical pin directions to survive noisy simultaneous-boot windows.
	DDRA |= (_BV(6) | _BV(7));
	DDRB |= _BV(4);
	DDRD |= (_BV(6) | _BV(7));
	g_hw_output_lock = 1;
	TIME_STOP;
	AC_ON;
	FAN_OFF;
	TEC_OFF;
	COOL_FAN_OFF;
	W_PUMP_OFF;
	H_LED_OFF;
	BRF_DISABLE;
	OUT_OFF;
	TC1_PWM_OFF;
}

static void page68_enter_hw_isolation(void)
{
	subscription_force_hw_isolation();
}

static void page68_leave_hw_isolation(void)
{
	// Keep power-hold stable across page68 -> target page transition.
	AC_ON;
}

U08 subscription_hw_isolation_tick(void)
{
	static U08 wasIsolated = 0;
	U08 safePage = subscription_hw_safe_page_active();

	if (safePage)
	{
		subscription_force_hw_isolation();
		wasIsolated = 1;
		// 61 page must keep touch handling alive; other safety pages are loop-blocked.
		return subscription_hw_block_page_active();
	}

	if (wasIsolated)
	{
		// Leaving isolation pages restores runtime timer gate.
		g_hw_output_lock = 0;
		TIME_START;
		AC_ON;
		wasIsolated = 0;
	}

	return 0;
}

static U08 page68_check_boot_page_active(char *errCode, U08 errSz)
{
	if ((errCode != 0) && (errSz > 0))
	{
		errCode[0] = 0;
	}

	if (dwin_page_now != WIFI_PAGE_BOOT_CHECK)
	{
		if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-01");
		return 0U;
	}
	return 1U;
}

static U08 page68_check_local_state(char *errCode, U08 errSz)
{
	if ((errCode != 0) && (errSz > 0))
	{
		errCode[0] = 0;
	}

	if (init_boot == 0)
	{
		if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-02");
		return 0U;
	}
	if (startPage == 0)
	{
		if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-03");
		return 0U;
	}
	if ((dwin_page_now == 0) || (dwin_page_now == 0xFF))
	{
		if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-04");
		return 0U;
	}
	if (p63_rx_state > 3)
	{
		if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-05");
		return 0U;
	}
	if (sub_uart_drop)
	{
		if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-06");
		return 0U;
	}
	if (sub_uart_q_count > SUB_UART_Q_DEPTH)
	{
		if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-07");
		return 0U;
	}
	if ((p63_wifi_connected_state != 0xFF) &&
	    (p63_wifi_connected_state != 0U) &&
	    (p63_wifi_connected_state != 1U))
	{
		if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-08");
		return 0U;
	}
	if (p63_boot_wifi_phase > P63_BOOT_WIFI_PHASE_ERROR)
	{
		if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-13");
		return 0U;
	}
	return 1U;
}

static U08 page68_check_transport_state(char *errCode, U08 errSz)
{
	if ((errCode != 0) && (errSz > 0))
	{
		errCode[0] = 0;
	}

	if (dwin_page_now != WIFI_PAGE_BOOT_CHECK)
	{
		if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-09");
		return 0U;
	}
	if (p63_rx_state > 3)
	{
		if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-10");
		return 0U;
	}
	if (sub_uart_drop)
	{
		if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-11");
		return 0U;
	}
	if (sub_uart_q_count > SUB_UART_Q_DEPTH)
	{
		if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-12");
		return 0U;
	}
	return 1U;
}

static void page68_wait_step_10ms(uint16_t *remainMs)
{
	if ((remainMs == 0) || (*remainMs == 0))
	{
		return;
	}

	asm("wdr");
	subscription_uart_pump_lines();
	page68_refresh_view_tick(10U);
	_delay_ms(10);

	if (*remainMs >= 10U)
	{
		*remainMs = (uint16_t)(*remainMs - 10U);
	}
	else
	{
		*remainMs = 0U;
	}
}

static void page68_reset_fresh_status_window(void)
{
	subscription_uart_pump_lines();
	// Boot state was already reset in IOT_mode_prepare_boot_resume_page().
	// Keep any ESP frames that arrived during simultaneous power-on so page68
	// does not discard an early CONNECTING/AP_READY signal and fall through.
}

static void page68_fail_to_page10(const char *errCode)
{
	const char *code = (errCode != 0 && errCode[0] != 0) ? errCode : "ERR68-00";
	page68_end_session();
	subscription_force_hw_isolation();
	p63_boot_waiting_status = 0U;
	p63_wifi_page_last_sent = PAGE68_FAIL_PAGE;
	pageChange(PAGE68_FAIL_PAGE);
	dwin_write_text(PAGE68_ERROR_VP, code, PAGE68_ERROR_TEXT_LEN);
}

static void page68_apply_target_page(U08 targetPage, U08 waitingStatus)
{
	if ((targetPage == 0) || (targetPage == 0xFF))
	{
		targetPage = WIFI_PAGE_LIST;
	}

	if (targetPage == WIFI_PAGE_LIST)
	{
		pageChange(WIFI_PAGE_LIST);
		// Retry page63 transition once to survive simultaneous power-on races.
		page68_boot_step_wait_ms(120);
		pageChange(WIFI_PAGE_LIST);
		p63_wifi_page_last_sent = WIFI_PAGE_LIST;
		p63_boot_waiting_status = waitingStatus ? 1U : 0U;
		return;
	}

	pageChange(targetPage);
	p63_wifi_page_last_sent = targetPage;
	p63_boot_waiting_status = 0U;
}

static void page68_store_target_state(U08 targetPage, U08 waitingStatus)
{
	if ((targetPage == 0) || (targetPage == 0xFF))
	{
		targetPage = WIFI_PAGE_LIST;
	}

	p63_wifi_page_last_sent = targetPage;
	p63_boot_waiting_status = ((targetPage == WIFI_PAGE_LIST) && waitingStatus) ? 1U : 0U;
}

static U08 page68_run_boot_checks(U08 resumePage)
{
	U08 otaPromptShown = 0U;
	U08 targetPage = 0U;
	U08 waitingStatus = 0U;
	uint16_t waitMs;
	uint32_t nowSec;
	char errCode[PAGE68_ERROR_TEXT_LEN + 1];

	if (resumePage == 0)
	{
		resumePage = (startPage != 0) ? startPage : 1;
	}
	targetPage = resumePage;
	p63_boot_resume_page = resumePage;

	page68_begin_session();
	page68_enter_hw_isolation();
	pageChange(WIFI_PAGE_BOOT_CHECK);
	// Give DGUS a brief settle time after page switch before first VP update.
	page68_boot_step_wait_ms(120);

	page68_set_step(0);
	page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
	if (!page68_check_boot_page_active(errCode, sizeof(errCode)))
	{
		page68_fail_to_page10(errCode);
		return 0U;
	}

	page68_set_step(1);
	page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
	if (!page68_check_local_state(errCode, sizeof(errCode)))
	{
		page68_fail_to_page10(errCode);
		return 0U;
	}
	page68_reset_fresh_status_window();

	page68_set_step(2);
	page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
	waitMs = PAGE68_STATUS_ACTIVITY_WAIT_MS;
	while ((waitMs > 0U) && (!page68_status_activity_seen()))
	{
		page68_wait_step_10ms(&waitMs);
	}
	if (!page68_check_transport_state(errCode, sizeof(errCode)))
	{
		page68_fail_to_page10(errCode);
		return 0U;
	}
	if (!page68_status_activity_seen())
	{
		snprintf(errCode, sizeof(errCode), "ERR68-24");
		page68_fail_to_page10(errCode);
		return 0U;
	}

	page68_set_step(3);
	page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
	waitMs = PAGE68_WIFI_PHASE_WAIT_MS;
	while ((waitMs > 0U) && (p63_boot_wifi_phase == P63_BOOT_WIFI_PHASE_NONE))
	{
		page68_wait_step_10ms(&waitMs);
	}
	if (!page68_check_transport_state(errCode, sizeof(errCode)))
	{
		page68_fail_to_page10(errCode);
		return 0U;
	}
	if (p63_boot_wifi_phase == P63_BOOT_WIFI_PHASE_ERROR)
	{
		snprintf(errCode, sizeof(errCode), "ERR68-14");
		page68_fail_to_page10(errCode);
		return 0U;
	}
	if (p63_boot_wifi_phase == P63_BOOT_WIFI_PHASE_NONE)
	{
		snprintf(errCode, sizeof(errCode), "ERR68-15");
		page68_fail_to_page10(errCode);
		return 0U;
	}
	if (p63_boot_wifi_phase == P63_BOOT_WIFI_PHASE_AP_READY)
	{
		targetPage = WIFI_PAGE_LIST;
		waitingStatus = 0U;
		goto page68_finalize;
	}
	if (p63_boot_wifi_phase != P63_BOOT_WIFI_PHASE_CONNECTING)
	{
		snprintf(errCode, sizeof(errCode), "ERR68-16");
		page68_fail_to_page10(errCode);
		return 0U;
	}

	waitMs = PAGE68_WIFI_STATUS_FRAME_WAIT_MS;
	while ((waitMs > 0U) &&
	       !(p63_wifi_status_seen && (p63_wifi_connected_state == 1U)) &&
	       (p63_boot_wifi_phase == P63_BOOT_WIFI_PHASE_CONNECTING))
	{
		page68_wait_step_10ms(&waitMs);
	}
	if (!page68_check_transport_state(errCode, sizeof(errCode)))
	{
		page68_fail_to_page10(errCode);
		return 0U;
	}
	if (p63_boot_wifi_phase == P63_BOOT_WIFI_PHASE_AP_READY)
	{
		targetPage = WIFI_PAGE_LIST;
		waitingStatus = 0U;
		goto page68_finalize;
	}
	if (p63_boot_wifi_phase == P63_BOOT_WIFI_PHASE_ERROR)
	{
		snprintf(errCode, sizeof(errCode), "ERR68-17");
		page68_fail_to_page10(errCode);
		return 0U;
	}
	if ((!p63_wifi_status_seen) || (p63_wifi_connected_state != 1U))
	{
		snprintf(errCode, sizeof(errCode), "ERR68-18");
		page68_fail_to_page10(errCode);
		return 0U;
	}

	page68_set_step(4);
	page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
	waitMs = PAGE68_REG_STATUS_WAIT_MS;
	while ((waitMs > 0U) && (!reg_gate_status_seen))
	{
		page68_wait_step_10ms(&waitMs);
	}
	if (!page68_check_transport_state(errCode, sizeof(errCode)))
	{
		page68_fail_to_page10(errCode);
		return 0U;
	}
	if (!reg_gate_status_seen)
	{
		snprintf(errCode, sizeof(errCode), "ERR68-19");
		page68_fail_to_page10(errCode);
		return 0U;
	}
	if (!reg_gate_registered)
	{
		targetPage = WIFI_PAGE_REGISTER_WAIT;
		waitingStatus = 0U;
		goto page68_finalize;
	}

	page68_set_step(5);
	page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
	waitMs = PAGE68_SUB_STATUS_WAIT_MS;
	while ((waitMs > 0U) && ((!sub_state_seen) || (sub_state_code == SUB_STATE_READY)))
	{
		page68_wait_step_10ms(&waitMs);
	}
	if (!page68_check_transport_state(errCode, sizeof(errCode)))
	{
		page68_fail_to_page10(errCode);
		return 0U;
	}
	if (!sub_state_seen)
	{
		snprintf(errCode, sizeof(errCode), "ERR68-20");
		page68_fail_to_page10(errCode);
		return 0U;
	}
	switch (sub_state_code)
	{
		case SUB_STATE_ACTIVE:
			break;
		case SUB_STATE_READY:
		case SUB_STATE_EXPIRED:
			targetPage = WIFI_PAGE_SUB_EXPIRED;
			waitingStatus = 0U;
			goto page68_finalize;
		case SUB_STATE_UNREGISTERED:
			targetPage = WIFI_PAGE_REGISTER_WAIT;
			waitingStatus = 0U;
			goto page68_finalize;
		case SUB_STATE_OFFLINE:
			targetPage = WIFI_PAGE_SUB_OFFLINE;
			waitingStatus = 0U;
			goto page68_finalize;
		default:
			snprintf(errCode, sizeof(errCode), "ERR68-21");
			page68_fail_to_page10(errCode);
			return 0U;
	}

	page68_set_step(6);
	page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
	waitMs = PAGE68_ENERGY_STATUS_WAIT_MS;
	while ((waitMs > 0U) && (!energy_sync_ready()))
	{
		page68_wait_step_10ms(&waitMs);
	}
	if (!page68_check_transport_state(errCode, sizeof(errCode)))
	{
		page68_fail_to_page10(errCode);
		return 0U;
	}
	if (!energy_sync_ready())
	{
		snprintf(errCode, sizeof(errCode), "ERR68-22");
		page68_fail_to_page10(errCode);
		return 0U;
	}
	if ((g_energy_assigned_j == 0U) || g_energy_local_expired_lock || energy_subscription_exhausted())
	{
		targetPage = WIFI_PAGE_SUB_EXPIRED;
		waitingStatus = 0U;
		goto page68_finalize;
	}

	page68_set_step(7);
	page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
	targetPage = resumePage;
	if (!subscription_resolve_connected_target_page(resumePage, &targetPage))
	{
		snprintf(errCode, sizeof(errCode), "ERR68-23");
		page68_fail_to_page10(errCode);
		return 0U;
	}
	else
	{
		waitingStatus = 0U;
	}
	if (!page68_check_transport_state(errCode, sizeof(errCode)))
	{
		page68_fail_to_page10(errCode);
		return 0U;
	}

page68_finalize:
	page68_set_step(8);
	page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
	if ((targetPage != WIFI_PAGE_LIST) &&
	    (page68_status_activity_seen() || (p63_wifi_status_seen && (p63_wifi_connected_state == 1U))))
	{
		waitMs = PAGE68_OTA_PROMPT_WAIT_MS;
		while ((waitMs > 0U) && (!ota_boot_prompt_pending_active()))
		{
			page68_wait_step_10ms(&waitMs);
		}
	}
	if (!page68_check_transport_state(errCode, sizeof(errCode)))
	{
		page68_fail_to_page10(errCode);
		return 0U;
	}
	page68_set_step(9);
	page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
	page68_end_session();
	page68_leave_hw_isolation();
	page68_store_target_state(targetPage, waitingStatus);
	otaPromptShown = ota_show_boot_prompt_if_pending(targetPage);
	if (!otaPromptShown)
	{
		page68_apply_target_page(targetPage, waitingStatus);
	}

	nowSec = p63_now_sec();
	p63_wifi_last_no_signal_sec = nowSec;
	if (p63_wifi_status_seen)
	{
		p63_wifi_last_seen_sec = nowSec;
		p63_wifi_boot_sec = nowSec;
	}
	else
	{
		p63_wifi_boot_sec = nowSec;
	}

	return 1U;
}
