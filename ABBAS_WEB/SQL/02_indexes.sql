-- 02_indexes.sql
-- Additional indexes for query performance
--
-- 실행 전:
--   USE `for_rnd`;  -- (또는 settings.env의 MYSQL_DATABASE)

-- devices
CREATE INDEX idx_devices_ip ON devices (ip);
CREATE INDEX idx_devices_token ON devices (token);
CREATE INDEX idx_devices_sub_status ON devices (sub_status);

-- server_logs
CREATE INDEX idx_server_logs_time ON server_logs (time);
CREATE INDEX idx_server_logs_device_type_time ON server_logs (device, type, time);

-- procedure_records (데이터 페이지/대시보드에서 최신순 조회)
CREATE INDEX idx_proc_device_pk_id ON procedure_records (device_pk, id);
CREATE INDEX idx_proc_device_pk_saved_at ON procedure_records (device_pk, saved_at_kst);
CREATE INDEX idx_proc_created_at ON procedure_records (created_at);

-- survey_records
CREATE INDEX idx_survey_device_pk_id ON survey_records (device_pk, id);
CREATE INDEX idx_survey_device_pk_saved_at ON survey_records (device_pk, saved_at_kst);
CREATE INDEX idx_survey_created_at ON survey_records (created_at);
