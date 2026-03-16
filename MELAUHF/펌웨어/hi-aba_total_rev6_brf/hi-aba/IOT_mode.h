#ifndef IOT_MODE_H_
#define IOT_MODE_H_

#include "common.h"

#define IOT_MODE_PAGE_CONNECTED 61U
#define IOT_MODE_PAGE_RUNTIME   62U

void IOT_mode_force_hw_isolation(void);
U08 IOT_mode_isolation_page_active(void);
U08 IOT_mode_hw_safe_page_active(void);
U08 IOT_mode_run_boot_checks(U08 resumePage);
void IOT_mode_reset_boot_state(U08 bootResumePage);
U08 IOT_mode_prepare_boot_resume_page(U08 fallbackPage);
void IOT_mode_wait_for_runtime_ready(void);
void IOT_mode_apply_runtime_hw_gate(void);
U08 IOT_mode_runtime_outputs_enabled(void);
U08 IOT_mode_runtime_page(U08 startPage);

#endif /* IOT_MODE_H_ */
