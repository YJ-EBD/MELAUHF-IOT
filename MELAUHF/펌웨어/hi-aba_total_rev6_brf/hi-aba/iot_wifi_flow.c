/*
 * iot_wifi_flow.c
 *
 * Included by IOT_mode.c to keep Wi-Fi, page63, and keyboard flow logic
 * grouped separately while preserving the original translation-unit behavior.
 */

static U08 wifi_is_keyboard_page(U08 page)
{
	return (page == WIFI_PAGE_UPPER) || (page == WIFI_PAGE_LOWER) || (page == WIFI_PAGE_SYMBOL);
}

static int8_t wifi_key_decimal_index(U16 key, U08 highByte, U08 maxOrdinal)
{
	U08 low;
	U08 tens;
	U08 ones;
	U08 ord;

	if (((U08)(key >> 8)) != highByte)
	{
		return -1;
	}

	low = (U08)key;
	tens = (U08)(low >> 4);
	ones = (U08)(low & 0x0F);
	if (ones > 9)
	{
		return -1;
	}

	ord = (U08)(tens * 10U + ones);
	if ((ord < 1U) || (ord > maxOrdinal))
	{
		return -1;
	}

	return (int8_t)(ord - 1U);
}

static U08 wifi_is_local_input_key(U08 page, U16 key)
{
	if ((key == 0x0000) || (key == 0x4444) || (key == 0x4101) || (key == 0x4102))
	{
		return 0;
	}

	if ((page == WIFI_PAGE_LIST) && (key >= WIFI_KEY_P63_SLOT1) && (key <= WIFI_KEY_P63_SLOT5))
	{
		return 1;
	}

	if ((page == OTA_PAGE_FIRMWARE_UPDATE) && (ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE) &&
	    ((key == OTA_KEY_UPDATE_ACCEPT) || (key == OTA_KEY_UPDATE_SKIP)))
	{
		return 1;
	}

	if (!wifi_is_keyboard_page(page))
	{
		return 0;
	}

	if ((key == WIFI_KEY_FOCUS_SSID) || (key == WIFI_KEY_FOCUS_PW))
	{
		return 1;
	}
	if (((key >= WIFI_KEY_NUM_1) && (key <= WIFI_KEY_NUM_9)) ||
	    (key == WIFI_KEY_NUM_0) ||
	    (key == WIFI_KEY_NUM_MINUS) ||
	    (key == WIFI_KEY_NUM_EQUAL))
	{
		return 1;
	}
	if (wifi_key_decimal_index(key, 0xAA, 26) >= 0)
	{
		return 1;
	}
	if (wifi_key_decimal_index(key, 0xBB, 26) >= 0)
	{
		return 1;
	}
	if (wifi_key_decimal_index(key, 0xCC, 28) >= 0)
	{
		return 1;
	}
	if (key == WIFI_KEY_PW_ICON_TOGGLE)
	{
		return 1;
	}
	if ((key >= WIFI_KEY_BACKSPACE) && (key <= WIFI_KEY_SYMBOL))
	{
		return 1;
	}

	return 0;
}

static void wifi_key_queue_push(U16 key)
{
	U08 nextHead;

	if (key == 0x0000)
	{
		return;
	}

	nextHead = (U08)((wifi_key_q_head + 1) % WIFI_KEY_Q_DEPTH);
	if (nextHead == wifi_key_q_tail)
	{
		wifi_key_q_tail = (U08)((wifi_key_q_tail + 1) % WIFI_KEY_Q_DEPTH);
		if (wifi_key_q_count > 0)
		{
			wifi_key_q_count--;
		}
	}

	wifi_key_q[wifi_key_q_head] = key;
	wifi_key_q_head = nextHead;
	if (wifi_key_q_count < WIFI_KEY_Q_DEPTH)
	{
		wifi_key_q_count++;
	}
}

static U08 wifi_key_queue_pop(U16 *key)
{
	U08 hasItem = 0;

	if (key == 0)
	{
		return 0;
	}

	cli();
	if (wifi_key_q_count > 0)
	{
		*key = wifi_key_q[wifi_key_q_tail];
		wifi_key_q_tail = (U08)((wifi_key_q_tail + 1) % WIFI_KEY_Q_DEPTH);
		wifi_key_q_count--;
		hasItem = 1;
	}
	sei();

	return hasItem;
}

static void wifi_copy_field(char *dst, uint8_t dstSz, const char *src)
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

static char wifi_map_char_P(const char *map, uint8_t idx)
{
	return (char)pgm_read_byte(map + idx);
}

static void p63_slot_clear_all(void)
{
	memset(p63_slot_ssid, 0, sizeof(p63_slot_ssid));
	p63_slot_lock_mask = 0;
}

static void p63_slot_set(U08 slot, const char *ssid, U08 locked)
{
	uint8_t bit;

	if (slot >= 5)
	{
		return;
	}
	wifi_copy_field(p63_slot_ssid[slot], sizeof(p63_slot_ssid[slot]), ssid);
	bit = (uint8_t)(1U << slot);
	if (locked)
	{
		p63_slot_lock_mask |= bit;
	}
	else
	{
		p63_slot_lock_mask &= (uint8_t)~bit;
	}
}

static U08 p63_slot_locked(U08 slot)
{
	if (slot >= 5)
	{
		return 0;
	}
	return (p63_slot_lock_mask & (uint8_t)(1U << slot)) ? 1U : 0U;
}

void page67_anim_init(void)
{
	U08 slot;
	U08 s = 0U;

	page67_anim_shift = 0;

	for (slot = 0; slot < PAGE67_ICON_SLOT_COUNT; slot++)
	{
		uint16_t vp = (uint16_t)pgm_read_word(&page67_varicon_slots[slot]);
		U08 iconOffset = (U08)((slot + s) % PAGE67_ICON_SLOT_COUNT);
		SetVarIcon(vp, (uint16_t)iconOffset);
	}
}

static void page67_anim_apply(U08 shift)
{
	U08 slot;
	U08 s = (U08)(shift % PAGE67_ICON_SLOT_COUNT);

	for (slot = 0; slot < PAGE67_ICON_SLOT_COUNT; slot++)
	{
		uint16_t vp = (uint16_t)pgm_read_word(&page67_varicon_slots[slot]);
		// Requested order:
		// shift=0: 471..481
		// shift=1: 472..481,471
		// shift=2: 473..481,471,472
		U08 iconOffset = (U08)((slot + s) % PAGE67_ICON_SLOT_COUNT);
		/*
		 * Page67 VAR ICON objects are configured in DWIN as:
		 * value range 0..10 -> icon ID range 471..481.
		 * So ATmega must write index value (0..10), not absolute 471..481.
		 */
		SetVarIcon(vp, (uint16_t)iconOffset);
	}
}

static void page67_anim_start(void)
{
	cli();
	page67_tick = 0;
	sei();
	page67_anim_last_tick = 0;
	page67_anim_shift = 0;
	page67_anim_running = 1;
	page67_anim_init();
}

void page67_anim_stop(void)
{
	page67_anim_running = 0;
}

static void page67_anim_update(void)
{
	U16 nowTick;

	if (!page67_anim_running)
	{
		return;
	}

	cli();
	nowTick = page67_tick;
	sei();

	if ((U16)(nowTick - page67_anim_last_tick) < PAGE67_ANIM_PERIOD_TICKS)
	{
		return;
	}

	page67_anim_last_tick = nowTick;
	page67_anim_shift = (U08)((page67_anim_shift + 1U) % PAGE67_ICON_SLOT_COUNT);
	page67_anim_apply(page67_anim_shift);
}

static U08 wifi_is_guard_page(U08 page)
{
	if ((page >= WIFI_PAGE_LIST) && (page <= WIFI_PAGE_CONNECTING))
	{
		return 1;
	}
	return (page == WIFI_PAGE_REGISTER_WAIT) ? 1U : 0U;
}

static uint32_t p63_now_sec(void)
{
	uint32_t sec;
	cli();
	sec = ckTime;
	sei();
	return sec;
}

static inline void rkc_queue_push(U08 page, U16 key)
{
	U08 nextHead;

	if (key == 0x0000)
	{
		return;
	}

	nextHead = (U08)((rkc_uart_q_head + 1) % RKC_UART_Q_DEPTH);
	if (nextHead == rkc_uart_q_tail)
	{
		rkc_uart_q_tail = (U08)((rkc_uart_q_tail + 1) % RKC_UART_Q_DEPTH);
		if (rkc_uart_q_count > 0)
		{
			rkc_uart_q_count--;
		}
	}

	rkc_uart_q_page[rkc_uart_q_head] = page;
	rkc_uart_q_key[rkc_uart_q_head] = key;
	rkc_uart_q_head = nextHead;
	if (rkc_uart_q_count < RKC_UART_Q_DEPTH)
	{
		rkc_uart_q_count++;
	}
}

static void rkc_flush_to_esp(void)
{
	U08 hasItem;
	U08 page;
	U16 key;
	char line[28];

	for (;;)
	{
		hasItem = 0;
		page = 0;
		key = 0;

		cli();
		if (rkc_uart_q_count > 0)
		{
			page = rkc_uart_q_page[rkc_uart_q_tail];
			key = rkc_uart_q_key[rkc_uart_q_tail];
			rkc_uart_q_tail = (U08)((rkc_uart_q_tail + 1) % RKC_UART_Q_DEPTH);
			rkc_uart_q_count--;
			hasItem = 1;
		}
		sei();

		if (!hasItem)
		{
			break;
		}

		snprintf(line, sizeof(line), "@RKC|%u|%04X\n", (unsigned int)page, (unsigned int)key);
		UART1_TX_STR(line);
	}
}

static void wifi_apply_pw_icon_state(void)
{
	SetVarIcon(WIFI_PW_ICON_VP, wifi_pw_masked ? WIFI_PW_ICON_VAL_MASKED : WIFI_PW_ICON_VAL_VISIBLE);
}

static void wifi_apply_pw_mask_slots(uint8_t visibleCount)
{
	uint8_t i;
	uint16_t vp;

	if (visibleCount > WIFI_PW_MASK_SLOT_COUNT)
	{
		visibleCount = WIFI_PW_MASK_SLOT_COUNT;
	}

	for (i = 0; i < WIFI_PW_MASK_SLOT_COUNT; i++)
	{
		vp = (uint16_t)pgm_read_word(&wifi_pw_mask_slots[i]);
		SetVarIcon(vp, (i < visibleCount) ? WIFI_PW_MASK_SLOT_SHOW_VAL : WIFI_PW_MASK_SLOT_HIDE_VAL);
	}
}

static void wifi_refresh_field_display(U08 field)
{
	if (field == WIFI_FIELD_SSID)
	{
		dwin_write_text(WIFI_TEXT_VP_SSID, ssid_buf, WIFI_TEXT_DISPLAY_LEN);
	}
	else
	{
		if (wifi_pw_masked)
		{
			wifi_apply_pw_mask_slots(pw_len);
			dwin_write_text(WIFI_TEXT_VP_PW, "", WIFI_TEXT_DISPLAY_LEN);
		}
		else
		{
			wifi_apply_pw_mask_slots(0);
			dwin_write_text(WIFI_TEXT_VP_PW, pw_buf, WIFI_TEXT_DISPLAY_LEN);
		}
	}
}

static void wifi_set_focus(U08 field)
{
	// DWIN returns 0x0B00/0x0B01 on field touch. ATmega keeps authoritative focus state.
	active_field = (field == WIFI_FIELD_SSID) ? WIFI_FIELD_SSID : WIFI_FIELD_PW;
}

static void wifi_append_char(char c)
{
	if (active_field == WIFI_FIELD_SSID)
	{
		if (ssid_len < (uint8_t)(sizeof(ssid_buf) - 1))
		{
			ssid_buf[ssid_len++] = c;
			ssid_buf[ssid_len] = 0;
			wifi_refresh_field_display(WIFI_FIELD_SSID);
		}
	}
	else
	{
		if (pw_len < (uint8_t)(sizeof(pw_buf) - 1))
		{
			pw_buf[pw_len++] = c;
			pw_buf[pw_len] = 0;
			wifi_refresh_field_display(WIFI_FIELD_PW);
		}
	}
}

static void wifi_backspace_active(void)
{
	if (active_field == WIFI_FIELD_SSID)
	{
		if (ssid_len > 0)
		{
			ssid_len--;
			ssid_buf[ssid_len] = 0;
			wifi_refresh_field_display(WIFI_FIELD_SSID);
		}
	}
	else
	{
		if (pw_len > 0)
		{
			pw_len--;
			pw_buf[pw_len] = 0;
			wifi_refresh_field_display(WIFI_FIELD_PW);
		}
	}
}

static void wifi_load_selected_ssid(U08 slot)
{
	if ((slot >= 5) || (p63_slot_ssid[slot][0] == 0))
	{
		return;
	}

	// Page63 button-to-SSID VP mapping is fixed:
	// 0x4111->0x4410, 0x4112->0x4530, 0x4113->0x4650, 0x4114->0x4770, 0x4115->0x4890
	wifi_copy_field(ssid_buf, sizeof(ssid_buf), p63_slot_ssid[slot]);
	ssid_len = (uint8_t)strlen(ssid_buf);

	// New SSID selection starts with an empty PW field.
	pw_buf[0] = 0;
	pw_len = 0;
	wifi_pw_masked = 1;
	wifi_apply_pw_icon_state();

	wifi_refresh_field_display(WIFI_FIELD_SSID);
	wifi_refresh_field_display(WIFI_FIELD_PW);

	active_field = WIFI_FIELD_PW;
	current_page = WIFI_PAGE_LOWER;
	dwin_switch_page(WIFI_PAGE_LOWER);
}

void send_wifi_credentials(void)
{
	uint8_t i = 0;
	char line[160];
	uint32_t nowSec = p63_now_sec();

	// Reuse p63_scan_busy flag value 2 as "Wi-Fi connect attempt active" state.
	// 0: idle, 1: page63 scan busy, 2: wifi connect attempt hold.
	p63_scan_busy = 2U;
	p63_scan_busy_until_sec = nowSec + WIFI_CONNECT_ATTEMPT_HOLD_SEC;

	// 1) Reliable framed commands for ESP parser.
	snprintf(line, sizeof(line), "@WIFI|S|%s\n", ssid_buf);
	UART1_TX_STR(line);
	while (line[i] != 0)
	{
		TX0_char((unsigned char)line[i++]);
	}

	i = 0;
	snprintf(line, sizeof(line), "@WIFI|P|%s\n", pw_buf);
	UART1_TX_STR(line);
	while (line[i] != 0)
	{
		TX0_char((unsigned char)line[i++]);
	}

	UART1_TX_STR("@WIFI|G\n");
	TX0_char('@'); TX0_char('W'); TX0_char('I'); TX0_char('F'); TX0_char('I');
	TX0_char('|'); TX0_char('G'); TX0_char('\n');

	// 2) Legacy credential lines kept for backward compatibility / debug.
	i = 0;
	snprintf(line, sizeof(line), "SSID:%s\r\nPW:%s\r\n", ssid_buf, pw_buf);
	UART1_TX_STR(line);
	while (line[i] != 0)
	{
		TX0_char((unsigned char)line[i++]);
	}
}

static void wifi_mark_page61_boot_once(void)
{
	eeprom_update_byte(&WIFI_BOOT_PAGE61_ONCE, 1);
	eeprom_busy_wait();
}

static void wifi_reboot_for_connected_state(void)
{
	wifi_mark_page61_boot_once();
	asm("jmp 0");
}

static void wifi_apply_connect_fail_ui(void)
{
	page67_anim_stop();
	dwin_switch_page(WIFI_PAGE_LOWER);
	dwin_write_text(WIFI_FAIL_TEXT_VP, "Device connection failed!", WIFI_FAIL_TEXT_LEN);
}

static void wifi_apply_connect_result(U08 ok)
{
	if (p63_scan_busy == 2U)
	{
		p63_scan_busy = 0U;
		p63_scan_busy_until_sec = 0U;
	}
	if ((dwin_page_now == WIFI_PAGE_BOOT_CHECK) || page68_boot_active)
	{
		// During page68 boot gating, WIFI|R is boot state input, not a request to
		// reboot into the connected runtime flow.
		p63_wifi_status_set(ok ? 1U : 0U);
		return;
	}
	if (ok)
	{
		wifi_reboot_for_connected_state();
		return;
	}

	wifi_apply_connect_fail_ui();
}

void handle_key(uint16_t key_code)
{
	U08 pageNow = dwin_page_now;
	int8_t key_idx;
	char append_ch = 0;

	if ((pageNow == OTA_PAGE_FIRMWARE_UPDATE) && (ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE))
	{
		if (key_code == OTA_KEY_UPDATE_ACCEPT)
		{
			ota_finish_prompt(1U);
			return;
		}
		if (key_code == OTA_KEY_UPDATE_SKIP)
		{
			ota_finish_prompt(0U);
			return;
		}
		return;
	}

	if (wifi_is_keyboard_page(pageNow))
	{
		current_page = pageNow;
	}

	// Page 63 SSID select keys: load full SSID, default focus to PW, then move to page 65.
	if ((pageNow == WIFI_PAGE_LIST) && (key_code >= WIFI_KEY_P63_SLOT1) && (key_code <= WIFI_KEY_P63_SLOT5))
	{
		wifi_load_selected_ssid((U08)(key_code - WIFI_KEY_P63_SLOT1));
		return;
	}

	if (!wifi_is_keyboard_page(pageNow))
	{
		return;
	}

	// Focus keys: 0x0B00 selects SSID field, 0x0B01 selects PW field.
	if (key_code == WIFI_KEY_FOCUS_SSID)
	{
		wifi_set_focus(WIFI_FIELD_SSID);
		return;
	}
	if (key_code == WIFI_KEY_FOCUS_PW)
	{
		wifi_set_focus(WIFI_FIELD_PW);
		return;
	}
	if (key_code == WIFI_KEY_PW_ICON_TOGGLE)
	{
		wifi_pw_masked = (wifi_pw_masked == 0U) ? 1U : 0U;
		wifi_apply_pw_icon_state();
		wifi_refresh_field_display(WIFI_FIELD_PW);
		return;
	}

	// Page 65 lowercase key block: 0xBB01~0xBB26 map to qwerty...m.
	key_idx = wifi_key_decimal_index(key_code, 0xBB, 26);
	if ((current_page == WIFI_PAGE_LOWER) && (key_idx >= 0))
	{
		append_ch = wifi_map_char_P(wifi_lower_map, (uint8_t)key_idx);
		wifi_append_char(append_ch);
		return;
	}

	// Page 64 uppercase key block: 0xAA01~0xAA26 map to QWERTY...M.
	key_idx = wifi_key_decimal_index(key_code, 0xAA, 26);
	if ((current_page == WIFI_PAGE_UPPER) && (key_idx >= 0))
	{
		append_ch = wifi_map_char_P(wifi_upper_map, (uint8_t)key_idx);
		wifi_append_char(append_ch);
		return;
	}

	// Page 66 symbol key block: 0xCC01~0xCC28 map to symbol list order.
	key_idx = wifi_key_decimal_index(key_code, 0xCC, 28);
	if ((current_page == WIFI_PAGE_SYMBOL) && (key_idx >= 0))
	{
		append_ch = wifi_map_char_P(wifi_symbol_map, (uint8_t)key_idx);
		wifi_append_char(append_ch);
		return;
	}

	// Number/symbol row block (common on pages 64/65/66): 0x0A01~0x0A12.
	if ((key_code >= WIFI_KEY_NUM_1) && (key_code <= WIFI_KEY_NUM_9))
	{
		append_ch = (char)('1' + (key_code - WIFI_KEY_NUM_1));
		wifi_append_char(append_ch);
		return;
	}
	if (key_code == WIFI_KEY_NUM_0)
	{
		wifi_append_char('0');
		return;
	}
	if (key_code == WIFI_KEY_NUM_MINUS)
	{
		wifi_append_char('-');
		return;
	}
	if (key_code == WIFI_KEY_NUM_EQUAL)
	{
		wifi_append_char('=');
		return;
	}

	// Backspace block: remove one character from active field.
	if (key_code == WIFI_KEY_BACKSPACE)
	{
		wifi_backspace_active();
		return;
	}

	// Return block: keyboard pages return to WiFi list page 63.
	if (key_code == WIFI_KEY_RETURN)
	{
		dwin_switch_page(WIFI_PAGE_LIST);
		return;
	}

	// Shift block: 65->64, 64->65, 66->65 while keeping buffers/focus.
	if (key_code == WIFI_KEY_SHIFT)
	{
		if (current_page == WIFI_PAGE_LOWER)
		{
			current_page = WIFI_PAGE_UPPER;
		}
		else
		{
			current_page = WIFI_PAGE_LOWER;
		}
		dwin_switch_page(current_page);
		return;
	}

	// Go block: send Wi-Fi credentials to ESP32 and move to page 67.
	if (key_code == WIFI_KEY_GO)
	{
		send_wifi_credentials();
		// Start animation immediately from key path as an extra safety path.
		page67_anim_start();
		dwin_switch_page(WIFI_PAGE_CONNECTING);
		return;
	}

	// Space block: append space to the active field.
	if (key_code == WIFI_KEY_SPACE)
	{
		wifi_append_char(' ');
		return;
	}

	// Symbol block: move to page 66 while preserving active field and buffers.
	if (key_code == WIFI_KEY_SYMBOL)
	{
		current_page = WIFI_PAGE_SYMBOL;
		dwin_switch_page(WIFI_PAGE_SYMBOL);
		return;
	}
}

static void p63_isr_note_key(U16 key)
{
	U08 pageNow = dwin_page_now;
	U08 localWifiKey = 0;

	if (key == 0x0000)
	{
		if (pageNow == 63)
		{
			p63_last_key = 0;
		}
		return;
	}

	if (wifi_is_local_input_key(pageNow, key))
	{
		wifi_key_queue_push(key);
		localWifiKey = 1;
	}

	if (!localWifiKey)
	{
		rkc_queue_push(pageNow, key);
	}

	if (pageNow != 63)
	{
		return;
	}

	// Some DWIN projects do not emit a key-release frame (0x0000).
	// Keep repeated key presses accepted even when key code is identical.
	(void)(key == p63_last_key);
	p63_last_key = key;

	if (key == 0x4444)
	{
		p63_scan_req = 1;
	}
	else if (key == 0x4101)
	{
		p63_prev_req = 1;
	}
	else if (key == 0x4102)
	{
		p63_next_req = 1;
	}
}

static void p63_isr_handle_frame(volatile U08 *buf, U08 need)
{
	U08 plen;
	U16 crc_calc;
	U16 crc_rx;
	U16 addr;
	U16 key;

	if (need < 4)
	{
		return;
	}

	plen = need - 2;
	crc_calc = update_crc((unsigned char *)buf, plen);
	crc_rx = ((U16)buf[plen] << 8) | (U16)buf[plen + 1];
	if (crc_calc != crc_rx)
	{
		return;
	}

	if ((plen < 6) || (buf[0] != 0x83))
	{
		return;
	}

	addr = ((U16)buf[1] << 8) | (U16)buf[2];
	if (addr != 0x0000)
	{
		return;
	}

	if (buf[3] >= 1)
	{
		key = ((U16)buf[plen - 2] << 8) | (U16)buf[plen - 1];
	}
	else
	{
		key = ((U16)buf[4] << 8) | (U16)buf[5];
	}
	p63_isr_note_key(key);
}

static void p63_isr_feed(U08 b)
{
	switch (p63_rx_state)
	{
		case 0:
		if (b == 0x5A)
		{
			p63_rx_state = 1;
		}
		break;

		case 1:
		if (b == 0xA5)
		{
			p63_rx_state = 2;
		}
		else if (b != 0x5A)
		{
			p63_rx_state = 0;
		}
		break;

		case 2:
		p63_rx_need = b;
		p63_rx_idx = 0;
		if ((p63_rx_need < 2) || (p63_rx_need > sizeof(p63_rx_buf)))
		{
			p63_rx_state = 0;
		}
		else
		{
			p63_rx_state = 3;
		}
		break;

		case 3:
		p63_rx_buf[p63_rx_idx++] = b;
		if (p63_rx_idx >= p63_rx_need)
		{
			p63_isr_handle_frame(p63_rx_buf, p63_rx_need);
			p63_rx_state = 0;
			p63_rx_idx = 0;
			p63_rx_need = 0;
		}
		break;

		default:
		p63_rx_state = 0;
		p63_rx_idx = 0;
		p63_rx_need = 0;
		break;
	}
}

static void p63_send_key_to_esp(U16 key)
{
	char line[20];
	snprintf(line, sizeof(line), "@P63|K|%04X\n", (unsigned int)key);
	UART1_TX_STR(line);
}

static void p63_scan_icons_hide(void)
{
	varIconInt(0x3000, P63_SCAN_ICON_HIDE_ID);
	varIconInt(0x3001, P63_SCAN_DOT_HIDE_ID);
	varIconInt(0x3002, P63_SCAN_DOT_HIDE_ID);
	varIconInt(0x3003, P63_SCAN_DOT_HIDE_ID);
	p63_anim_visible = 0;
	p63_anim_frame = 0;
	p63_anim_ms = 0;
	p63_anim_last_ms = 0;
}

static void p63_scan_icons_frame(U08 frame)
{
	U16 d1 = 0;
	U16 d2 = 0;
	U16 d3 = 0;
	U08 f = frame % 3;

	if (!p63_anim_visible)
	{
		varIconInt(0x3000, P63_SCAN_ICON_SHOW_ID);
		p63_anim_visible = 1;
	}

	if (f == 0)
	{
		d1 = P63_SCAN_DOT_ON_ID; d2 = P63_SCAN_DOT_OFF_ID; d3 = P63_SCAN_DOT_OFF_ID;
	}
	else if (f == 1)
	{
		d1 = P63_SCAN_DOT_OFF_ID; d2 = P63_SCAN_DOT_ON_ID; d3 = P63_SCAN_DOT_OFF_ID;
	}
	else
	{
		d1 = P63_SCAN_DOT_OFF_ID; d2 = P63_SCAN_DOT_OFF_ID; d3 = P63_SCAN_DOT_ON_ID;
	}

	varIconInt(0x3001, d1);
	varIconInt(0x3002, d2);
	varIconInt(0x3003, d3);
}

static void p63_set_anim(U08 on)
{
	if (on)
	{
		p63_anim_on = 1;
		cli();
		p63_anim_ms = 0;
		p63_anim_frame = 0;
		sei();
		p63_anim_last_ms = 0;
		p63_scan_icons_frame(0);
	}
	else
	{
		p63_anim_on = 0;
		p63_scan_icons_hide();
	}
}

static void p63_enter_fail_safe(void)
{
	if ((dwin_page_now != 0) && (dwin_page_now != 0xFF))
	{
		p63_page_before_fail = dwin_page_now;
	}

	p63_fail_safe_stop = 1;
	p63_scan_req = 0;
	p63_prev_req = 0;
	p63_next_req = 0;
	p63_last_key = 0;
	cli();
	wifi_key_q_head = 0;
	wifi_key_q_tail = 0;
	wifi_key_q_count = 0;
	sei();
	page67_anim_stop();
	p63_set_anim(0);
	p63_slot_clear_all();
	PAGE63_ClearAll();
	// Recovery behavior: keep current UI page visible.
	// Do not force page 0 (black screen) on transient UART/status issues.
	p63_wifi_page_last_sent = dwin_page_now;
}

static void p63_exit_fail_safe(void)
{
	p63_fail_safe_stop = 0;
}

static void p63_wifi_page_apply(U08 connected)
{
	if (dwin_page_now == WIFI_PAGE_BOOT_CHECK)
	{
		// Keep page68 visible until boot checks are explicitly finished.
		p63_wifi_page_last_sent = dwin_page_now;
		return;
	}
	if (dwin_page_now == PAGE68_FAIL_PAGE)
	{
		// Once boot was classified as an error, later Wi-Fi heartbeats must not
		// pull the UI out of page10 behind the user's back.
		p63_wifi_page_last_sent = dwin_page_now;
		return;
	}

	if (connected)
	{
		U08 restore = p63_boot_resume_page;
		U08 targetPage = restore;
		uint32_t nowSec = p63_now_sec();
		p63_exit_fail_safe();
		// Boot race fix: if page68 had to fall back to page63 before first status frame,
		// restore the intended runtime page only after registration/subscription gates resolve.
		if (p63_boot_waiting_status && (dwin_page_now == WIFI_PAGE_LIST))
		{
			if ((restore == 0) || (restore == 0xFF))
			{
				restore = (startPage != 0) ? startPage : WIFI_PAGE_CONNECTED;
			}
			if (subscription_resolve_connected_target_page(restore, &targetPage))
			{
				if ((targetPage != WIFI_PAGE_LIST) && (dwin_page_now != targetPage))
				{
					pageChange(targetPage);
				}
				p63_wifi_page_last_sent = targetPage;
				p63_boot_waiting_status = 0;
				p63_connected_wait_start_sec = 0;
			}
			else
			{
				if (p63_connected_wait_start_sec == 0)
				{
					p63_connected_wait_start_sec = nowSec;
				}
				if ((uint32_t)(nowSec - p63_connected_wait_start_sec) >= P63_CONNECTED_RESTORE_GRACE_SEC)
				{
					if ((targetPage == 0) || (targetPage == 0xFF))
					{
						targetPage = WIFI_PAGE_CONNECTED;
					}
					if ((targetPage != WIFI_PAGE_LIST) && (dwin_page_now != targetPage))
					{
						pageChange(targetPage);
					}
					p63_wifi_page_last_sent = targetPage;
					p63_boot_resume_page = targetPage;
					p63_boot_waiting_status = 0;
					p63_connected_wait_start_sec = 0;
				}
				else
				{
					p63_wifi_page_last_sent = dwin_page_now;
				}
			}
			return;
		}
		p63_connected_wait_start_sec = 0;
		if (dwin_page_now == WIFI_PAGE_LIST)
		{
			if ((restore == 0) || (restore == 0xFF))
			{
				restore = WIFI_PAGE_CONNECTED;
			}
			targetPage = restore;
			if (!subscription_resolve_connected_target_page(restore, &targetPage))
			{
				targetPage = WIFI_PAGE_CONNECTED;
			}
			if ((targetPage != WIFI_PAGE_LIST) && (dwin_page_now != targetPage))
			{
				pageChange(targetPage);
			}
			p63_wifi_page_last_sent = targetPage;
			p63_boot_resume_page = targetPage;
			p63_boot_waiting_status = 0;
			return;
		}
		if (dwin_page_now == 0)
		{
			restore = p63_page_before_fail;
			if ((restore == 0) || (restore == 0xFF))
			{
				restore = (startPage != 0) ? startPage : 63;
			}
			if (restore != 0)
			{
				pageChange(restore);
			}
		}
		p63_wifi_page_last_sent = dwin_page_now;
	}
	else
	{
		p63_connected_wait_start_sec = 0;
		if ((dwin_page_now == WIFI_PAGE_SUB_EXPIRED) || (dwin_page_now == WIFI_PAGE_SUB_OFFLINE))
		{
			p63_wifi_page_last_sent = dwin_page_now;
			return;
		}
		// Never force-jump to page63 while user is on Wi-Fi setup/connecting pages.
		if (wifi_is_keyboard_page(dwin_page_now) || (dwin_page_now == WIFI_PAGE_CONNECTING))
		{
			p63_wifi_page_last_sent = dwin_page_now;
			return;
		}
		// During explicit connect-attempt flow, keep current page until ESP returns WIFI|R.
		if (p63_scan_busy == 2U)
		{
			uint32_t nowSec = p63_now_sec();
			if ((p63_scan_busy_until_sec != 0) &&
			    ((int32_t)(nowSec - p63_scan_busy_until_sec) <= 0))
			{
				p63_wifi_page_last_sent = dwin_page_now;
				return;
			}
			p63_scan_busy = 0U;
			p63_scan_busy_until_sec = 0U;
		}
		// ESP is alive but Wi-Fi is not connected: show page63 and allow scan flow.
		p63_exit_fail_safe();
		if (p63_wifi_page_last_sent != 63)
		{
			pageChange(63);
			p63_wifi_page_last_sent = 63;
		}
	}
}

static void p63_boot_waiting_connected_tick(uint32_t nowSec)
{
	U08 restore;
	U08 targetPage;

	if ((dwin_page_now != WIFI_PAGE_LIST) || (!p63_boot_waiting_status))
	{
		p63_connected_wait_start_sec = 0;
		return;
	}
	if ((!p63_wifi_status_seen) || (p63_wifi_connected_state != 1U))
	{
		p63_connected_wait_start_sec = 0;
		return;
	}

	restore = p63_boot_resume_page;
	if ((restore == 0) || (restore == 0xFF))
	{
		restore = (startPage != 0) ? startPage : WIFI_PAGE_CONNECTED;
	}

	targetPage = restore;
	if (subscription_resolve_connected_target_page(restore, &targetPage))
	{
		if (targetPage == WIFI_PAGE_CONNECTED)
		{
			subscription_show_connected_page();
		}
		else if ((targetPage != WIFI_PAGE_LIST) && (dwin_page_now != targetPage))
		{
			pageChange(targetPage);
			p63_wifi_page_last_sent = targetPage;
			p63_boot_resume_page = targetPage;
			p63_boot_waiting_status = 0;
		}
		p63_connected_wait_start_sec = 0;
		return;
	}

	if (p63_connected_wait_start_sec == 0)
	{
		p63_connected_wait_start_sec = nowSec;
		return;
	}
	if ((uint32_t)(nowSec - p63_connected_wait_start_sec) < P63_CONNECTED_RESTORE_GRACE_SEC)
	{
		return;
	}

	if ((targetPage != WIFI_PAGE_LIST) && (dwin_page_now != targetPage))
	{
		pageChange(targetPage);
	}
	p63_wifi_page_last_sent = targetPage;
	p63_boot_resume_page = targetPage;
	p63_boot_waiting_status = 0;
	p63_connected_wait_start_sec = 0;
}

static void p63_wifi_status_set(U08 connected)
{
	if (connected)
	{
		if (p63_scan_busy == 2U)
		{
			p63_scan_busy = 0U;
			p63_scan_busy_until_sec = 0U;
		}
	}
	p63_wifi_connected_state = connected ? 1U : 0U;
	p63_wifi_status_seen = 1;
	p63_wifi_last_seen_sec = p63_now_sec();
	p63_wifi_boot_sec = p63_now_sec();
	// Any heartbeat/status frame means ESP link is alive; clear scan-busy hold.
	p63_scan_busy = 0;
	p63_scan_busy_until_sec = 0;
	p63_wifi_page_apply(connected);
}

static void p63_wifi_boot_tick(void)
{
	uint32_t nowSec = p63_now_sec();

	// Recovery guard: some boot sequences can briefly report page 0.
	// After first-boot flow is finished, immediately restore to startPage.
	if ((dwin_page_now == 0) && (init_boot != 0))
	{
		if (startPage == 0)
		{
			startPage = 1;
		}
		pageChange(startPage);
		p63_wifi_page_last_sent = startPage;
		p63_wifi_last_no_signal_sec = nowSec;
		if (p63_wifi_status_seen)
		{
			p63_wifi_last_seen_sec = nowSec;
		}
		return;
	}

	if (p63_scan_busy)
	{
		if ((p63_scan_busy_until_sec != 0) && (nowSec >= p63_scan_busy_until_sec))
		{
			p63_scan_busy = 0;
			p63_scan_busy_until_sec = 0;
		}
		else
		{
			p63_wifi_last_no_signal_sec = nowSec;
			if (p63_wifi_status_seen)
			{
				p63_wifi_last_seen_sec = nowSec;
			}
			return;
		}
	}

	// While scan animation is active on page63, ESP32 may be busy in blocking scan.
	// Do not treat missing heartbeat in this window as ESP power-off.
	if (p63_anim_on)
	{
		p63_wifi_last_no_signal_sec = nowSec;
		if (p63_wifi_status_seen)
		{
			p63_wifi_last_seen_sec = nowSec;
		}
		return;
	}

	if (!p63_wifi_status_seen)
	{
		if (p63_wifi_boot_sec == 0)
		{
			p63_wifi_boot_sec = nowSec;
			p63_wifi_last_no_signal_sec = nowSec;
			p63_wifi_page_last_sent = dwin_page_now;
			return;
		}

		if ((nowSec - p63_wifi_last_no_signal_sec) >= P63_WIFI_STATUS_NO_SIGNAL_SEC)
		{
			p63_enter_fail_safe();
		}
		return;
	}

	if ((nowSec - p63_wifi_last_seen_sec) >= P63_WIFI_STATUS_NO_SIGNAL_SEC)
	{
		p63_wifi_status_seen = 0;
		p63_wifi_boot_sec = nowSec;
		p63_wifi_last_no_signal_sec = nowSec;
		p63_wifi_connected_state = 0xFF;
		p63_wifi_last_seen_sec = 0;
		p63_enter_fail_safe();
		return;
	}

	p63_boot_waiting_connected_tick(nowSec);
}

static void p63_ui_tick(void)
{
	U08 do_scan = 0;
	U08 do_prev = 0;
	U08 do_next = 0;

	if (p63_fail_safe_stop)
	{
		cli();
		p63_scan_req = 0;
		p63_prev_req = 0;
		p63_next_req = 0;
		sei();
		p63_set_anim(0);
		return;
	}

	cli();
	if (p63_scan_req)
	{
		do_scan = 1;
		p63_scan_req = 0;
	}
	if (p63_prev_req)
	{
		do_prev = 1;
		p63_prev_req = 0;
	}
	if (p63_next_req)
	{
		do_next = 1;
		p63_next_req = 0;
	}
	sei();

	if (do_scan)
	{
		p63_send_key_to_esp(0x4444);
		p63_set_anim(1);
	}
	if (do_prev)
	{
		p63_send_key_to_esp(0x4101);
	}
	if (do_next)
	{
		p63_send_key_to_esp(0x4102);
	}

	if (p63_anim_on)
	{
		uint16_t nowMs;

		cli();
		nowMs = p63_anim_ms;
		sei();
		if ((uint16_t)(nowMs - p63_anim_last_ms) >= P63_SCAN_ANIM_PERIOD_TICKS)
		{
			p63_anim_last_ms = nowMs;
			p63_scan_icons_frame(p63_anim_frame);
			p63_anim_frame = (p63_anim_frame + 1) % 3;
		}
	}
}

static void p63_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *cmdTok;
	char *slotTok;
	char *lockTok;
	char *ssidTok;
	int slot;
	int lock;
	char ssid[64];

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "P63") != 0))
	{
		return;
	}

	cmdTok = strtok_r(0, "|", &savep);
	if (cmdTok == 0)
	{
		return;
	}

	if (strcmp(cmdTok, "C") == 0)
	{
		p63_slot_clear_all();
		PAGE63_ClearAll();
		p63_set_anim(0);
		return;
	}

	if (strcmp(cmdTok, "A") == 0)
	{
		char *onTok = strtok_r(0, "|", &savep);
		if ((onTok != 0) && (atoi(onTok) != 0))
		{
			p63_set_anim(1);
		}
		else
		{
			// Page62 shares 0x3001~0x3003; avoid off-page animation writes.
			if (dwin_page_now == WIFI_PAGE_LIST)
			{
				p63_set_anim(0);
			}
			else
			{
				p63_anim_on = 0;
				p63_anim_visible = 0;
				p63_anim_frame = 0;
				p63_anim_ms = 0;
				p63_anim_last_ms = 0;
			}
		}
		return;
	}

	if (strcmp(cmdTok, "W") == 0)
	{
		char *connTok = strtok_r(0, "|", &savep);
		if (connTok != 0)
		{
			p63_wifi_status_set((atoi(connTok) != 0) ? 1U : 0U);
		}
		return;
	}

	if (strcmp(cmdTok, "M") == 0)
	{
		char *modeTok = strtok_r(0, "|", &savep);
		if (modeTok == 0)
		{
			return;
		}
		switch (modeTok[0])
		{
			case 'C':
				p63_boot_wifi_phase = P63_BOOT_WIFI_PHASE_CONNECTING;
				break;
			case 'A':
				p63_boot_wifi_phase = P63_BOOT_WIFI_PHASE_AP_READY;
				break;
			case 'E':
				p63_boot_wifi_phase = P63_BOOT_WIFI_PHASE_ERROR;
				break;
			default:
				p63_boot_wifi_phase = P63_BOOT_WIFI_PHASE_NONE;
				break;
		}
		return;
	}

	if (strcmp(cmdTok, "B") == 0)
	{
		char *busyTok = strtok_r(0, "|", &savep);
		uint32_t nowSec = p63_now_sec();
		if ((busyTok != 0) && (atoi(busyTok) != 0))
		{
			p63_scan_busy = 1;
			p63_scan_busy_until_sec = nowSec + P63_SCAN_BUSY_HOLD_SEC;
		}
		else
		{
			// Do not clear immediately at scan end; give heartbeat recovery window.
			p63_scan_busy = 1;
			p63_scan_busy_until_sec = nowSec + P63_WIFI_STATUS_NO_SIGNAL_SEC + 1;
		}
		p63_wifi_last_no_signal_sec = nowSec;
		if (p63_wifi_status_seen)
		{
			p63_wifi_last_seen_sec = nowSec;
		}
		return;
	}

	if (strcmp(cmdTok, "S") != 0)
	{
		return;
	}

	slotTok = strtok_r(0, "|", &savep);
	lockTok = strtok_r(0, "|", &savep);
	ssidTok = strtok_r(0, "|", &savep);

	if ((slotTok == 0) || (lockTok == 0))
	{
		return;
	}

	slot = atoi(slotTok);
	if ((slot < 1) || (slot > 5))
	{
		return;
	}

	if ((lockTok[0] == '0') && (lockTok[1] == 0))
	{
		lock = 0;
	}
	else if ((lockTok[0] == '1') && (lockTok[1] == 0))
	{
		lock = 1;
	}
	else if ((((lockTok[0] == 'O') || (lockTok[0] == 'o')) &&
	          ((lockTok[1] == 'P') || (lockTok[1] == 'p')) &&
	          ((lockTok[2] == 'E') || (lockTok[2] == 'e')) &&
	          ((lockTok[3] == 'N') || (lockTok[3] == 'n')) &&
	          (lockTok[4] == 0)))
	{
		lock = 0;
	}
	else
	{
		// Security label mode (WPA/WPA2/WPA3/SEC...) => lock icon ON
		lock = 1;
	}
	if (ssidTok == 0)
	{
		ssidTok = "";
	}

	// Safety net: if list slot frames are arriving, scan animation must be off.
	// This also recovers when '@P63|A|0' is dropped or delayed on UART.
	if (p63_anim_on || p63_anim_visible)
	{
		p63_set_anim(0);
	}

	wifi_copy_field(ssid, sizeof(ssid), ssidTok);
	p63_slot_set((U08)(slot - 1), ssid, (lock != 0) ? 1U : 0U);
	PAGE63_RenderSlot((U08)(slot - 1), ssid, (lock != 0) ? 1 : 0);
}

static void wifi_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *cmdTok;
	char *resultTok;

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "WIFI") != 0))
	{
		return;
	}

	cmdTok = strtok_r(0, "|", &savep);
	if (cmdTok == 0)
	{
		return;
	}

	if (strcmp(cmdTok, "R") != 0)
	{
		return;
	}

	resultTok = strtok_r(0, "|", &savep);
	if (resultTok == 0)
	{
		return;
	}

	wifi_apply_connect_result((atoi(resultTok) != 0) ? 1U : 0U);
}
