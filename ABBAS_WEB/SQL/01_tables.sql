-- 01_tables.sql
-- Core tables for for_rnd_web (MySQL/MariaDB)
--
-- 실행 전:
--   USE `for_rnd`;  -- (또는 settings.env의 MYSQL_DATABASE)

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(32) NOT NULL,
  pw_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(32) NOT NULL DEFAULT '',
  department VARCHAR(64) NOT NULL DEFAULT '',
  location VARCHAR(64) NOT NULL DEFAULT '',
  bio VARCHAR(500) NOT NULL DEFAULT '',
  profile_image_path VARCHAR(255) NOT NULL DEFAULT '',
  birth DATE NULL,
  name VARCHAR(64) NULL,
  nickname VARCHAR(64) NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  join_date DATETIME NULL,
  email_verified TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_user_id (user_id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id VARCHAR(64) NULL,
  lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'active',
  ip VARCHAR(45) NOT NULL,
  name VARCHAR(128) NOT NULL,
  customer VARCHAR(128) NOT NULL DEFAULT '-',
  token VARCHAR(128) NULL,
  sub_status VARCHAR(16) NOT NULL DEFAULT '만료',
  sub_plan VARCHAR(32) NULL,
  sub_start_at DATETIME NULL,
  sub_expiry_at DATETIME NULL,
  sub_custom_minutes INT NULL,
  -- [NEW FEATURE] Assigned subscription energy (J)
  sub_energy_j BIGINT NULL,
  first_seen_at DATETIME NULL,
  last_seen_at DATETIME NULL,
  last_heartbeat_at DATETIME NULL,
  last_register_at DATETIME NULL,
  last_subscription_sync_at DATETIME NULL,
  last_contact_kind VARCHAR(24) NULL,
  last_public_ip VARCHAR(45) NULL,
  last_fw VARCHAR(64) NULL,
  last_parse_ok TINYINT(1) NOT NULL DEFAULT 1,
  last_power VARCHAR(32) NULL,
  last_time_sec VARCHAR(32) NULL,
  last_line TEXT NULL,
  sd_inserted TINYINT(1) NOT NULL DEFAULT 0,
  sd_total_mb DOUBLE NOT NULL DEFAULT 0,
  sd_used_mb DOUBLE NOT NULL DEFAULT 0,
  sd_free_mb DOUBLE NOT NULL DEFAULT 0,
  used_energy_j BIGINT NOT NULL DEFAULT 0,
  telemetry_count BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devices_device_id (device_id),
  KEY idx_devices_customer_ip (customer, ip),
  KEY idx_devices_sub_status (sub_status),
  KEY idx_devices_last_seen_at (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS server_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  time DATETIME NOT NULL,
  device VARCHAR(128) NOT NULL,
  type VARCHAR(16) NOT NULL,
  message TEXT NOT NULL,
  row_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_server_logs_row_hash (row_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS device_commands (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id VARCHAR(64) NOT NULL,
  customer VARCHAR(128) NOT NULL DEFAULT '-',
  command VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  queued_by VARCHAR(64) NULL,
  queued_via VARCHAR(16) NOT NULL DEFAULT 'web',
  queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at DATETIME NULL,
  acked_at DATETIME NULL,
  result_ok TINYINT(1) NULL,
  result_message TEXT NULL,
  payload_json LONGTEXT NULL,
  PRIMARY KEY (id),
  KEY idx_device_commands_pending (device_id, status, id),
  KEY idx_device_commands_recent (device_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS device_runtime_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id VARCHAR(64) NOT NULL,
  customer VARCHAR(128) NOT NULL DEFAULT '-',
  ip VARCHAR(45) NOT NULL DEFAULT '',
  level VARCHAR(16) NOT NULL DEFAULT 'info',
  source VARCHAR(24) NOT NULL DEFAULT 'device',
  line TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_device_runtime_logs_recent (device_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS procedure_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_pk BIGINT UNSIGNED NOT NULL,
  saved_at_kst DATETIME NULL,
  saved_at_raw VARCHAR(64) NULL,
  customer_name VARCHAR(64) NULL,
  gender VARCHAR(16) NULL,
  phone VARCHAR(32) NULL,
  complaint_face TEXT NULL,
  complaint_body TEXT NULL,
  treatment_area VARCHAR(128) NULL,
  treatment_time_min VARCHAR(32) NULL,
  treatment_power_w VARCHAR(32) NULL,
  source_filename VARCHAR(255) NULL,
  row_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_procedure_device FOREIGN KEY (device_pk) REFERENCES devices(id) ON DELETE CASCADE,
  UNIQUE KEY uq_procedure_device_rowhash (device_pk, row_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS survey_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_pk BIGINT UNSIGNED NOT NULL,
  saved_at_kst DATETIME NULL,
  saved_at_raw VARCHAR(64) NULL,
  customer_name VARCHAR(64) NULL,
  post_effect TEXT NULL,
  satisfaction VARCHAR(16) NULL,
  source_filename VARCHAR(255) NULL,
  row_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_survey_device FOREIGN KEY (device_pk) REFERENCES devices(id) ON DELETE CASCADE,
  UNIQUE KEY uq_survey_device_rowhash (device_pk, row_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
