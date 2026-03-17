/*
 * iot_boot.c
 *
 * Included by IOT_mode.c to keep boot checks and hardware isolation flow
 * grouped separately while preserving the original translation-unit behavior.
 */

static void page68_boot_step_wait_ms(uint16_t holdMs)
{
	uint16_t remain = holdMs;

	while (remain >= 10)
	{
		asm("wdr");
		subscription_uart_pump_lines();
		_delay_ms(10);
		remain = (uint16_t)(remain - 10);
	}

	while (remain > 0)
	{
		asm("wdr");
		subscription_uart_pump_lines();
		_delay_ms(1);
		remain--;
	}
}

static void page68_set_step(U08 step)
{
	char textBuf[PAGE68_TEXT_LEN + 1];

	if (step >= PAGE68_CHECK_COUNT)
	{
		return;
	}

	textBuf[0] = 0;
	switch (step)
	{
		case 0: strcpy_P(textBuf, PSTR("Checking Power Enable...")); break;
		case 1: strcpy_P(textBuf, PSTR("Checking ATmega UART2...")); break;
		case 2: strcpy_P(textBuf, PSTR("Checking DWIN UART1...")); break;
		case 3: strcpy_P(textBuf, PSTR("Checking Bridge Task...")); break;
		case 4: strcpy_P(textBuf, PSTR("Checking DWIN Link...")); break;
		case 5: strcpy_P(textBuf, PSTR("Checking SD Card...")); break;
		case 6: strcpy_P(textBuf, PSTR("Checking NVS Credentials...")); break;
		case 7: strcpy_P(textBuf, PSTR("Trying WiFi Connection...")); break;
		case 8: strcpy_P(textBuf, PSTR("Checking Subscription State...")); break;
		case 9: strcpy_P(textBuf, PSTR("Checking Firmware Version...")); break;
		default: strcpy_P(textBuf, PSTR("Checking System...")); break;
	}

	SetVarIcon(PAGE68_ICON_VP, (uint16_t)(PAGE68_ICON_INDEX_BASE + step));
	dwin_write_text(PAGE68_TEXT_VP, textBuf, PAGE68_TEXT_LEN);
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

static U08 page68_check_step_pass(U08 step, char *errCode, U08 errSz)
{
	if ((errCode != 0) && (errSz > 0))
	{
		errCode[0] = 0;
	}

	switch (step)
	{
		case 0:
			// Must stay on page68 after transition.
			if (dwin_page_now != WIFI_PAGE_BOOT_CHECK)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-01");
				return 0;
			}
			break;
		case 1:
			// Registration gate should already be completed.
			if (init_boot == 0)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-02");
				return 0;
			}
			break;
		case 2:
			// UART frame parser state must remain valid.
			if (p63_rx_state > 3)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-03");
				return 0;
			}
			break;
		case 3:
			// Bridge queue overflow on boot path indicates communication issue.
			if (sub_uart_drop)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-04");
				return 0;
			}
			break;
		case 4:
			// DWIN page tracker must stay valid.
			if ((dwin_page_now == 0) || (dwin_page_now == 0xFF))
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-05");
				return 0;
			}
			break;
		case 5:
			// Internal Wi-Fi parser state sanity.
			if ((p63_wifi_connected_state != 0xFF) &&
			    (p63_wifi_connected_state != 0U) &&
			    (p63_wifi_connected_state != 1U))
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-06");
				return 0;
			}
			break;
		case 6:
			// Runtime start page must be resolvable.
			if (startPage == 0)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-07");
				return 0;
			}
			break;
		case 7:
			// Queue integrity sanity check.
			if (sub_uart_q_count > SUB_UART_Q_DEPTH)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-08");
				return 0;
			}
			break;
		case 8:
			// No explicit fail condition; Wi-Fi disconnected is handled by page63 branch.
			break;
		case 9:
			// Final sanity: parser still valid.
			if (p63_rx_state > 3)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-10");
				return 0;
			}
			break;
		default:
			if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-XX");
			return 0;
	}

	return 1;
}

static void page68_fail_to_page10(const char *errCode)
{
	const char *code = (errCode != 0 && errCode[0] != 0) ? errCode : "ERR68-00";
	subscription_force_hw_isolation();
	pageChange(PAGE68_FAIL_PAGE);
	dwin_write_text(PAGE68_ERROR_VP, code, PAGE68_ERROR_TEXT_LEN);
}

static U08 page68_run_boot_checks(U08 resumePage)
{
	U08 step;
	U08 wifiConnected;
	uint16_t regWaitMs;
	uint16_t subWaitMs;
	uint16_t energyWaitMs;
	uint32_t nowSec;
	char errCode[PAGE68_ERROR_TEXT_LEN + 1];

	if (resumePage == 0)
	{
		resumePage = (startPage != 0) ? startPage : 1;
	}
	p63_boot_resume_page = resumePage;

	page68_enter_hw_isolation();
	pageChange(WIFI_PAGE_BOOT_CHECK);
	// Give DGUS a brief settle time after page switch before first VP update.
	page68_boot_step_wait_ms(120);

	for (step = 0; step < 7; step++)
	{
		page68_set_step(step);
		page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
		subscription_uart_pump_lines();
		if (!page68_check_step_pass(step, errCode, sizeof(errCode)))
		{
			page68_fail_to_page10(errCode);
			return 0;
		}
	}

	subscription_uart_pump_lines();
	// Require a fresh status frame after boot checks to avoid stale early state.
	p63_wifi_status_seen = 0;
	p63_wifi_connected_state = 0xFF;
	p63_wifi_last_seen_sec = 0;
	sub_state_seen = 0;
	sub_state_code = SUB_STATE_UNKNOWN;
	subscription_ready_pending_cancel();
	energy_reset_sync_state();
	g_energy_local_expired_lock = 0U;
	page68_set_step(7);
	page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
	subscription_uart_pump_lines();
	// Short grace window for first Wi-Fi heartbeat frame.
	// No long forced hold: status branch is decided immediately after this window.
	{
		uint16_t waitMs = PAGE68_WIFI_STATUS_FRAME_WAIT_MS;
		while ((waitMs > 0) && (!p63_wifi_status_seen))
		{
			asm("wdr");
			subscription_uart_pump_lines();
			_delay_ms(10);
			if (waitMs >= 10)
			{
				waitMs = (uint16_t)(waitMs - 10);
			}
			else
			{
				waitMs = 0;
			}
		}
	}
	if (!page68_check_step_pass(7, errCode, sizeof(errCode)))
	{
		page68_fail_to_page10(errCode);
		return 0;
	}
	wifiConnected = (p63_wifi_status_seen && (p63_wifi_connected_state == 1U)) ? 1U : 0U;
	if (!wifiConnected)
	{
		// Disconnected/portal path: represent "Wi-Fi searching (AP ON)" as stage 8.
		page68_set_step(8);
		dwin_write_text(PAGE68_TEXT_VP, "Searching WiFi (AP ON)...", PAGE68_TEXT_LEN);
		page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
		subscription_uart_pump_lines();
		if (!page68_check_step_pass(8, errCode, sizeof(errCode)))
		{
			page68_fail_to_page10(errCode);
			return 0;
		}
	}
	if (wifiConnected)
	{
		page68_set_step(8);
		page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
		subscription_uart_pump_lines();
		if (!page68_check_step_pass(8, errCode, sizeof(errCode)))
		{
			page68_fail_to_page10(errCode);
			return 0;
		}

		if (!reg_gate_status_seen)
		{
			regWaitMs = PAGE68_REG_STATUS_WAIT_MS;
			while ((regWaitMs > 0) && (!reg_gate_status_seen))
			{
				asm("wdr");
				subscription_uart_pump_lines();
				_delay_ms(10);
				if (regWaitMs >= 10)
				{
					regWaitMs = (uint16_t)(regWaitMs - 10);
				}
				else
				{
					regWaitMs = 0;
				}
			}
		}

		if (reg_gate_status_seen && reg_gate_registered &&
		    ((!sub_state_seen) || (sub_state_code == SUB_STATE_READY)))
		{
			subWaitMs = PAGE68_SUB_STATUS_WAIT_MS;
			while ((subWaitMs > 0) && ((!sub_state_seen) || (sub_state_code == SUB_STATE_READY)))
			{
				asm("wdr");
				subscription_uart_pump_lines();
				_delay_ms(10);
				if (subWaitMs >= 10)
				{
					subWaitMs = (uint16_t)(subWaitMs - 10);
				}
				else
				{
					subWaitMs = 0;
				}
			}
		}

		page68_set_step(9);
		page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
		subscription_uart_pump_lines();

		if (reg_gate_status_seen && reg_gate_registered &&
		    (sub_state_seen && (sub_state_code == SUB_STATE_ACTIVE)) && !energy_sync_ready())
		{
			energyWaitMs = PAGE68_ENERGY_STATUS_WAIT_MS;
			while ((energyWaitMs > 0) && (!energy_sync_ready()))
			{
				asm("wdr");
				subscription_uart_pump_lines();
				_delay_ms(10);
				if (energyWaitMs >= 10)
				{
					energyWaitMs = (uint16_t)(energyWaitMs - 10);
				}
				else
				{
					energyWaitMs = 0;
				}
			}
		}
		// Keep short parser window at final stage for version/OTA metadata arrival.
		page68_boot_step_wait_ms(160);
		subscription_uart_pump_lines();
		if (!page68_check_step_pass(9, errCode, sizeof(errCode)))
		{
			page68_fail_to_page10(errCode);
			return 0;
		}
	}

	// BUGFIX: give DWIN a short settle window before final page transition.
	page68_boot_step_wait_ms(120);
	page68_leave_hw_isolation();

	if (wifiConnected)
	{
		U08 targetPage = resumePage;
		if (subscription_resolve_connected_target_page(resumePage, &targetPage))
		{
			pageChange(targetPage);
			p63_wifi_page_last_sent = targetPage;
			p63_boot_waiting_status = 0;
		}
		else
		{
			pageChange(WIFI_PAGE_LIST);
			// Keep waiting on page63 until REG/SUB state is explicitly delivered from ESP32.
			page68_boot_step_wait_ms(120);
			pageChange(WIFI_PAGE_LIST);
			p63_wifi_page_last_sent = WIFI_PAGE_LIST;
			p63_boot_waiting_status = 1;
		}
	}
	else
	{
		pageChange(WIFI_PAGE_LIST);
		// BUGFIX: retry page63 transition once more for simultaneous power-on races.
		page68_boot_step_wait_ms(120);
		pageChange(WIFI_PAGE_LIST);
		p63_wifi_page_last_sent = WIFI_PAGE_LIST;
		p63_boot_waiting_status = 1;
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

	return 1;
}
