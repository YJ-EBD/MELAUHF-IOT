#ifndef IOT_MODE_H_
#define IOT_MODE_H_

#include "common.h"

#define IOT_MODE_PAGE_CONNECTED 61U

void IOT_mode_force_hw_isolation(void);
U08 IOT_mode_isolation_page_active(void);
U08 IOT_mode_hw_safe_page_active(void);
U08 IOT_mode_run_boot_checks(U08 resumePage);
void IOT_mode_reset_boot_state(U08 bootResumePage);

#endif /* IOT_MODE_H_ */
