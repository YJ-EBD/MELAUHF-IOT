/*
 * iot_ota.c
 *
 * Included by IOT_mode.c to keep OTA handling grouped separately while
 * preserving the original single-translation-unit behavior.
 */

static uint32_t ota_now_sec(void)
{
	uint32_t sec;
	cli();
	sec = ckTime;
	sei();
	return sec;
}

static U16 ota_now_tick(void)
{
	U16 tick;
	cli();
	tick = page67_tick;
	sei();
	return tick;
}

static void ota_progress_write_text(const char *text)
{
	char line[OTA_PROGRESS_TEXT_LEN + 1];
	wifi_copy_field(line, sizeof(line), text);
	dwin_write_text(OTA_TEXT_VP_PROGRESS, line, OTA_PROGRESS_TEXT_LEN);
}

static void page71_cache_esp_version(const char *version)
{
	wifi_copy_field(page71_esp_version_text, sizeof(page71_esp_version_text), version);
}

static void ota_progress_reset(void)
{
	ota_progress_phase = OTA_PROGRESS_PHASE_NONE;
	ota_progress_index = 0;
	ota_progress_last_sec = ota_now_sec();
	SetVarIcon(OTA_PROGRESS_VARICON_VP, OTA_PROGRESS_ICON_HIDE_VAL);
}

static void ota_progress_start_download(void)
{
	ota_progress_phase = OTA_PROGRESS_PHASE_DOWNLOAD;
	ota_progress_index = 0;
	ota_progress_last_sec = ota_now_sec();
	ota_progress_write_text("Downloading. . .");
	SetVarIcon(OTA_PROGRESS_VARICON_VP, 0);
}

static void ota_progress_start_update(void)
{
	ota_progress_phase = OTA_PROGRESS_PHASE_UPDATE;
	ota_progress_index = 0;
	ota_progress_last_sec = ota_now_sec();
	ota_progress_write_text("Firmware Update. . .");
	SetVarIcon(OTA_PROGRESS_VARICON_VP, 0);
}

static void ota_progress_enter_reboot(void)
{
	ota_progress_phase = OTA_PROGRESS_PHASE_REBOOT;
	ota_progress_index = OTA_REBOOT_ICON_FIRST;
	ota_progress_last_sec = (uint32_t)ota_now_tick();
	SetVarIcon(OTA_PROGRESS_VARICON_VP, OTA_REBOOT_ICON_FIRST);
	ota_progress_write_text("Rebooting. . .");
}

static void ota_progress_tick(void)
{
	uint32_t nowSec;
	U16 nowTick;

	if ((ota_progress_phase != OTA_PROGRESS_PHASE_DOWNLOAD) &&
	    (ota_progress_phase != OTA_PROGRESS_PHASE_UPDATE) &&
	    (ota_progress_phase != OTA_PROGRESS_PHASE_REBOOT))
	{
		return;
	}

	if (dwin_page_now != OTA_PAGE_FIRMWARE_UPDATE)
	{
		return;
	}

	if (ota_progress_phase == OTA_PROGRESS_PHASE_REBOOT)
	{
		nowTick = ota_now_tick();
		if ((U16)(nowTick - (U16)ota_progress_last_sec) < OTA_REBOOT_ANIM_PERIOD_TICKS)
		{
			return;
		}
		ota_progress_last_sec = (uint32_t)nowTick;

		if ((ota_progress_index < OTA_REBOOT_ICON_FIRST) ||
		    (ota_progress_index >= OTA_REBOOT_ICON_LAST))
		{
			ota_progress_index = OTA_REBOOT_ICON_FIRST;
		}
		else
		{
			ota_progress_index++;
		}
		SetVarIcon(OTA_PROGRESS_VARICON_VP, ota_progress_index);
		return;
	}

	nowSec = ota_now_sec();
	if (nowSec == ota_progress_last_sec)
	{
		return;
	}
	ota_progress_last_sec = nowSec;

	if (ota_progress_index < OTA_PROGRESS_ICON_MAX)
	{
		ota_progress_index++;
		SetVarIcon(OTA_PROGRESS_VARICON_VP, ota_progress_index);
		if ((ota_progress_phase == OTA_PROGRESS_PHASE_UPDATE) && (ota_progress_index >= OTA_PROGRESS_ICON_MAX))
		{
			ota_progress_enter_reboot();
		}
		return;
	}

	if (ota_progress_phase == OTA_PROGRESS_PHASE_DOWNLOAD)
	{
		ota_progress_start_update();
		return;
	}

	if (ota_progress_phase == OTA_PROGRESS_PHASE_UPDATE)
	{
		ota_progress_enter_reboot();
		return;
	}
}

static void ota_uart_publish_decision(U08 accept)
{
	char line[20];
	snprintf(line, sizeof(line), "@OTA|DEC|%u\n", (unsigned int)(accept ? 1U : 0U));
	UART1_TX_STR(line);
	if (esp_bridge_uart0_seen)
	{
		UART0_TX_STR(line);
	}
}

static void ota_boot_prompt_clear_pending(void)
{
	ota_boot_prompt_pending = 0U;
	ota_boot_current_version[0] = 0;
	ota_boot_target_version[0] = 0;
}

static void ota_boot_prompt_queue(const char *currentVersion, const char *targetVersion)
{
	wifi_copy_field(ota_boot_current_version, sizeof(ota_boot_current_version), currentVersion);
	wifi_copy_field(ota_boot_target_version, sizeof(ota_boot_target_version), targetVersion);
	ota_boot_prompt_pending = 1U;
}

static U08 ota_boot_prompt_pending_active(void)
{
	return ota_boot_prompt_pending ? 1U : 0U;
}

static void ota_show_prompt_internal(const char *currentVersion, const char *targetVersion, U08 prevPage)
{
	char currentText[OTA_VERSION_TEXT_LEN + 1];
	char targetText[OTA_VERSION_TEXT_LEN + 1];

	if (ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE)
	{
		return;
	}

	if (ota_prompt_flags & (OTA_PROMPT_FLAG_SHOWN | OTA_PROMPT_FLAG_DECIDED))
	{
		ota_uart_publish_decision(0U);
		return;
	}

	ota_progress_reset();

	if ((prevPage != 0) && (prevPage != 0xFF) && (prevPage != OTA_PAGE_FIRMWARE_UPDATE))
	{
		ota_prev_page = prevPage;
	}
	else if ((dwin_page_now != 0) && (dwin_page_now != 0xFF) && (dwin_page_now != OTA_PAGE_FIRMWARE_UPDATE))
	{
		ota_prev_page = dwin_page_now;
	}
	else if (startPage != 0)
	{
		ota_prev_page = startPage;
	}
	else
	{
		ota_prev_page = WIFI_PAGE_CONNECTED;
	}

	wifi_copy_field(currentText, sizeof(currentText), currentVersion);
	wifi_copy_field(targetText, sizeof(targetText), targetVersion);
	if (currentText[0] == 0)
	{
		strcpy(currentText, "-");
	}
	if (targetText[0] == 0)
	{
		strcpy(targetText, "-");
	}

	if (opPage & 0x02)
	{
		setStandby();
		opPage = 1;
	}

	pageChange(OTA_PAGE_FIRMWARE_UPDATE);
	dwin_write_text(OTA_TEXT_VP_CURRENT_VERSION, currentText, OTA_VERSION_TEXT_LEN);
	dwin_write_text(OTA_TEXT_VP_TARGET_VERSION, targetText, OTA_VERSION_TEXT_LEN);
	ota_progress_write_text("");
	SetVarIcon(OTA_PROGRESS_VARICON_VP, OTA_PROGRESS_ICON_HIDE_VAL);

	ota_prompt_flags |= (OTA_PROMPT_FLAG_ACTIVE | OTA_PROMPT_FLAG_SHOWN);
}

static void ota_enter_prompt(const char *currentVersion, const char *targetVersion)
{
	ota_show_prompt_internal(currentVersion, targetVersion, dwin_page_now);
}

static U08 ota_show_boot_prompt_if_pending(U08 fallbackPage)
{
	U08 shown = 0U;

	if (!ota_boot_prompt_pending_active())
	{
		return 0U;
	}

	ota_boot_prompt_pending = 0U;
	ota_show_prompt_internal(ota_boot_current_version, ota_boot_target_version, fallbackPage);
	shown = (ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE) ? 1U : 0U;
	ota_boot_current_version[0] = 0;
	ota_boot_target_version[0] = 0;
	return shown;
}

static void ota_finish_prompt(U08 accept)
{
	if ((ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE) == 0)
	{
		return;
	}

	ota_prompt_flags &= (U08)~OTA_PROMPT_FLAG_ACTIVE;
	ota_prompt_flags |= OTA_PROMPT_FLAG_DECIDED;
	ota_uart_publish_decision(accept ? 1U : 0U);
	if (accept)
	{
		ota_progress_start_download();
	}
	else
	{
		ota_progress_reset();
	}

	if (!accept)
	{
		if ((ota_prev_page != 0) && (ota_prev_page != OTA_PAGE_FIRMWARE_UPDATE))
		{
			pageChange(ota_prev_page);
		}
	}
}

static void ota_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *cmdTok;
	char *currentTok;
	char *targetTok;
	U08 restorePage;

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "OTA") != 0))
	{
		return;
	}

	cmdTok = strtok_r(0, "|", &savep);
	if (cmdTok == 0)
	{
		return;
	}

	if ((strcmp(cmdTok, "RST") == 0) || (strcmp(cmdTok, "RESET") == 0))
	{
		ota_boot_prompt_clear_pending();
		restorePage = ota_prev_page;
		if ((restorePage == 0) || (restorePage == OTA_PAGE_FIRMWARE_UPDATE))
		{
			restorePage = WIFI_PAGE_CONNECTED;
		}
		if (dwin_page_now == OTA_PAGE_FIRMWARE_UPDATE)
		{
			if ((restorePage != 0) && (restorePage != OTA_PAGE_FIRMWARE_UPDATE))
			{
				pageChange(restorePage);
			}
		}
		ota_prompt_flags = 0;
		ota_prev_page = 0;
		ota_progress_reset();
		return;
	}

	if ((strcmp(cmdTok, "Q") == 0) || (strcmp(cmdTok, "PROMPT") == 0))
	{
		currentTok = strtok_r(0, "|", &savep);
		targetTok = strtok_r(0, "|", &savep);
		if (currentTok == 0)
		{
			currentTok = "";
		}
		if (targetTok == 0)
		{
			targetTok = "";
		}
		page71_cache_esp_version(currentTok);
		if (page68_boot_active || (dwin_page_now == WIFI_PAGE_BOOT_CHECK))
		{
			ota_boot_prompt_queue(currentTok, targetTok);
			return;
		}
		ota_enter_prompt(currentTok, targetTok);
	}
}
