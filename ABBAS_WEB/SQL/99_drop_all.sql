-- 99_drop_all.sql (optional)
-- DANGEROUS: 모든 테이블을 삭제합니다.
--
-- 실행 전:
--   USE `for_rnd`;  -- (또는 settings.env의 MYSQL_DATABASE)

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS survey_records;
DROP TABLE IF EXISTS procedure_records;
DROP TABLE IF EXISTS server_logs;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;
