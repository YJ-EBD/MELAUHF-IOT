/*
 * iot_uart_bridge.c
 *
 * Included by IOT_mode.c to keep ESP bridge, UART helpers, and related ISRs
 * grouped separately while preserving the original translation-unit behavior.
 */

static void subscription_uart_pump_lines(void)
{
	U08 hasLine = 0;
	char line[SUB_UART_LINE_MAX];

	for (;;)
	{
		hasLine = 0;
		line[0] = 0;

		cli();
		if (sub_uart_q_count > 0)
		{
			strncpy(line, sub_uart_queue[sub_uart_q_tail], sizeof(line) - 1);
			line[sizeof(line) - 1] = 0;
			sub_uart_q_tail = (U08)((sub_uart_q_tail + 1) % SUB_UART_Q_DEPTH);
			sub_uart_q_count--;
			sub_uart_ready = (sub_uart_q_count > 0) ? 1U : 0U;
			hasLine = 1;
		}
		sei();

		if (!hasLine)
		{
			break;
		}

		if (strncmp(line, "SUB|", 4) == 0)
		{
			sub_parse_line(line);
		}
		else if (strncmp(line, "[SUB]", 5) == 0)
		{
			sub_parse_log_line(line);
		}
		else if (strncmp(line, "P63|", 4) == 0)
		{
			p63_parse_line(line);
		}
		else if (strncmp(line, "ENG|", 4) == 0)
		{
			// [NEW FEATURE] Energy metrics stream from ESP for page57/page71.
			energy_parse_line(line);
		}
		else if (strncmp(line, "REG|", 4) == 0)
		{
			registration_parse_line(line);
		}
		else if (strncmp(line, "PAGE|", 5) == 0)
		{
			page_parse_line(line);
		}
		else if (strncmp(line, "OTA|", 4) == 0)
		{
			ota_parse_line(line);
		}
		else if (strncmp(line, "WIFI|", 5) == 0)
		{
			wifi_parse_line(line);
		}
	}
}

// --- ESP32 PING/PONG (UART1) minimal debug hook ---
// UART1 is used for DWIN (dwin.c uses UDR1). When DWIN is disconnected and UART1
// is wired to ESP32, receiving ASCII "ping" will reply with "pong\r\n".
// This is kept extremely small to avoid impacting normal operation.
static volatile uint8_t pp_state = 0;
static inline void UART1_TX(uint8_t b){ while(!(UCSR1A & (1<<UDRE1))); UDR1 = b; }
static inline void UART1_TX_STR(const char* s){ while(*s) UART1_TX((uint8_t)*s++); }
// [NEW FEATURE] UART0 mirror helper for UART0-routed ESP bridge variants.
static inline void UART0_TX(uint8_t b){ while(!(UCSR0A & (1<<UDRE0))); UDR0 = b; }
// [NEW FEATURE] UART0 mirror helper for UART0-routed ESP bridge variants.
static inline void UART0_TX_STR(const char* s){ while(*s) UART0_TX((uint8_t)*s++); }

// [NEW FEATURE] Emit run-key energy update to ESP logger channel.
void energy_uart_publish_run_event(U08 runActive, uint32_t totalEnergyNow)
{
	char line[40];
	snprintf(line, sizeof(line), "@ENG|R|%u|%lu\n",
	         (unsigned int)(runActive ? 1U : 0U),
	         (unsigned long)totalEnergyNow);
	UART1_TX_STR(line);
	// [NEW FEATURE] Only mirror on UART0 when ESP headers were actually seen there.
	if (esp_bridge_uart0_seen)
	{
		UART0_TX_STR(line);
	}
}

static inline void subscription_uart_reset_line(void)
{
	sub_uart_active = 0;
	sub_uart_len = 0;
	sub_uart_drop = 0;
	sub_uart_bracket_mode = 0;
}

static inline U08 subscription_uart_is_text_char(uint8_t c)
{
	return ((c >= 0x20) && (c <= 0x7E)) ? 1U : 0U;
}

static inline void subscription_uart_isr_feed(uint8_t c)
{
	// Command lines from ESP32:
	//   @SUB|A|<PLAN>|<YYYY.MM.DD~YYYY.MM.DD>|<remain>\n
	//   [SUB] ACTIVE plan='<PLAN>' remain=<N> period='<YYYY.MM.DD~YYYY.MM.DD>'\n
	//   @P63|S|<slot:1-5>|<sec_or_lock>|<ascii_ssid>\n
	//   @P63|A|<0|1>\n
	//   @P63|B|<0|1>\n
	//   @P63|C\n
	//   @WIFI|S|<ssid>\n
	//   @WIFI|P|<password>\n
	//   @WIFI|G\n
	//   @WIFI|R|<0|1>\n
	//   @REG|<0|1>\n
	//   @ENG|A|<assigned_j>, @ENG|U|<used_j>, ... @ENG|R|<remaining_days>\n
	//   @OTA|Q|<current_version>|<target_version>\n
	//   @OTA|RST\n
	if (!sub_uart_active)
	{
		if (c == '@')
		{
			sub_uart_active = 1;
			sub_uart_len = 0;
			sub_uart_drop = 0;
			sub_uart_bracket_mode = 0;
		}
		else if (c == '[')
		{
			sub_uart_active = 1;
			sub_uart_len = 1;
			sub_uart_drop = 0;
			sub_uart_bracket_mode = 1;
			sub_uart_line[0] = '[';
		}
		return;
	}

	if ((c == '\r') || (c == '\n'))
	{
		if ((!sub_uart_drop) && (sub_uart_len > 0))
		{
			U08 copyLen;
			U08 isPriority;
			sub_uart_line[sub_uart_len] = 0;
			if (energy_parse_line_fast_isr((const char *)sub_uart_line))
			{
				subscription_uart_reset_line();
				return;
			}
			isPriority = subscription_uart_line_is_priority(sub_uart_line);
			copyLen = sub_uart_len;
			if (copyLen >= sizeof(sub_uart_queue[0]))
			{
				copyLen = sizeof(sub_uart_queue[0]) - 1;
			}
			if (sub_uart_q_count >= SUB_UART_Q_DEPTH)
			{
				// Preserve queue room for REG/SUB/WIFI status lines that decide
				// whether page63 can leave its waiting state.
				if (!isPriority)
				{
					subscription_uart_reset_line();
					return;
				}
				sub_uart_q_tail = (U08)((sub_uart_q_tail + 1) % SUB_UART_Q_DEPTH);
				sub_uart_q_count = (U08)(SUB_UART_Q_DEPTH - 1);
			}
			memcpy(sub_uart_queue[sub_uart_q_head], sub_uart_line, copyLen);
			sub_uart_queue[sub_uart_q_head][copyLen] = 0;
			sub_uart_q_head = (U08)((sub_uart_q_head + 1) % SUB_UART_Q_DEPTH);
			sub_uart_q_count++;
			sub_uart_ready = 1;
		}
		subscription_uart_reset_line();
		return;
	}

	// UART1 can carry DWIN binary frames. Reject non-ASCII bytes immediately.
	if (!subscription_uart_is_text_char(c))
	{
		subscription_uart_reset_line();
		return;
	}

	if (!sub_uart_drop)
	{
		U08 idx = 0;
		if (sub_uart_len + 1 < sizeof(sub_uart_line))
		{
			sub_uart_line[sub_uart_len++] = (char)c;
			idx = (U08)(sub_uart_len - 1);

			if (sub_uart_bracket_mode == 1)
			{
				if ((idx == 1) && (sub_uart_line[idx] != 'S'))
				{
					subscription_uart_reset_line();
				}
				else if ((idx == 2) && (sub_uart_line[idx] != 'U'))
				{
					subscription_uart_reset_line();
				}
				else if ((idx == 3) && (sub_uart_line[idx] != 'B'))
				{
					subscription_uart_reset_line();
				}
				else if ((idx == 4) && (sub_uart_line[idx] != ']'))
				{
					subscription_uart_reset_line();
				}
				else if (idx >= 4)
				{
					sub_uart_bracket_mode = 0;
				}
			}
			else
			{
				// Prefix gate for '@' commands:
				//   SUB|..., P63|..., WIFI|..., REG|..., ENG|..., OTA|...
				if (idx == 0)
				{
					if ((sub_uart_line[0] != 'S') &&
					    (sub_uart_line[0] != 'P') &&
					    (sub_uart_line[0] != 'W') &&
					    (sub_uart_line[0] != 'R') &&
					    (sub_uart_line[0] != 'E') &&
					    (sub_uart_line[0] != 'O'))
					{
						subscription_uart_reset_line();
					}
				}
				else if (sub_uart_line[0] == 'S')
				{
					if ((idx == 1) && (sub_uart_line[idx] != 'U'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 2) && (sub_uart_line[idx] != 'B'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 3) && (sub_uart_line[idx] != '|'))
					{
						subscription_uart_reset_line();
					}
				}
				else if (sub_uart_line[0] == 'P')
				{
					if ((idx == 1) && (sub_uart_line[idx] != '6'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 2) && (sub_uart_line[idx] != '3'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 3) && (sub_uart_line[idx] != '|'))
					{
						subscription_uart_reset_line();
					}
				}
				else if (sub_uart_line[0] == 'W')
				{
					if ((idx == 1) && (sub_uart_line[idx] != 'I'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 2) && (sub_uart_line[idx] != 'F'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 3) && (sub_uart_line[idx] != 'I'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 4) && (sub_uart_line[idx] != '|'))
					{
						subscription_uart_reset_line();
					}
				}
				else if (sub_uart_line[0] == 'E')
				{
					if ((idx == 1) && (sub_uart_line[idx] != 'N'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 2) && (sub_uart_line[idx] != 'G'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 3) && (sub_uart_line[idx] != '|'))
					{
						subscription_uart_reset_line();
					}
				}
				else if (sub_uart_line[0] == 'R')
				{
					if ((idx == 1) && (sub_uart_line[idx] != 'E'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 2) && (sub_uart_line[idx] != 'G'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 3) && (sub_uart_line[idx] != '|'))
					{
						subscription_uart_reset_line();
					}
				}
				else if (sub_uart_line[0] == 'O')
				{
					if ((idx == 1) && (sub_uart_line[idx] != 'T'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 2) && (sub_uart_line[idx] != 'A'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 3) && (sub_uart_line[idx] != '|'))
					{
						subscription_uart_reset_line();
					}
				}
			}
		}
		else
		{
			// Oversized or malformed line: reset and wait for next header.
			subscription_uart_reset_line();
		}
	}
}

SIGNAL(USART0_RX_vect)
{
	uint8_t c = UDR0;
	rx0buf[write0Cnt++] = c;
	// [NEW FEATURE] Detect UART0-routed ESP bridge by command header bytes.
	if ((c == '@') || (c == '['))
	{
		esp_bridge_uart0_seen = 1;
	}
	// Some hardware revisions route ESP bridge text on UART0.
	subscription_uart_isr_feed(c);
}

SIGNAL(USART1_RX_vect)
{
	uint8_t c = UDR1;
	rxbuf[writeCnt++] = c;
	p63_isr_feed(c);
	// Some boards route ESP text bridge on UART1. Parser is prefix-gated and ASCII-filtered.
	if ((c == '@') || (c == '[') || (c == '\r') || (c == '\n') || ((c >= 0x20) && (c <= 0x7E)))
	{
		subscription_uart_isr_feed(c);
	}

	// PING/PONG detector: match p i n g (case-insensitive) on UART1
	switch(pp_state){
		case 0: pp_state = (c=='p' || c=='P') ? 1 : 0; break;
		case 1: pp_state = (c=='i' || c=='I') ? 2 : ((c=='p' || c=='P') ? 1 : 0); break;
		case 2: pp_state = (c=='n' || c=='N') ? 3 : 0; break;
		case 3:
		if(c=='g' || c=='G'){
			// Reply immediately; keeps working even inside mode loops.
			UART1_TX_STR("pong\r\n");
		}
		pp_state = 0;
		break;
	default: pp_state = 0; break;
	}
	// UART1 carries DWIN binary traffic in normal runtime.
}

SIGNAL(TIMER0_COMP_vect)
{
	wf_state = WATER_FLOW;
	wf_cnt++;
	if (p63_anim_on)
	{
		p63_anim_ms++;
	}
	page67_tick++;

	if (wf_state != prv_wf_state)
	{
		prv_wf_state = wf_state;
		if (wf_state)
		{
			wf_frq = WATER_M_FRQ / wf_cnt;
			wf_cnt = 0;
		}
	}
	else
	{
		if (wf_cnt > 10000)
		{
			wf_frq = 0;
		}
	}
	TCNT0 = 0;
}
