-- 微醺印记 · ESP 遥测库（D1）
-- 应用：npx wrangler d1 execute tipsy-telemetry --local --file=schema.sql
--       npx wrangler d1 execute tipsy-telemetry --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  user_id TEXT,
  drink TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER,
  stop_requested_at_ms INTEGER,
  completed_at_ms INTEGER,
  last_seq INTEGER NOT NULL DEFAULT 0,
  last_packet_at_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id, status);

-- (session_id, seq) 联合主键 = 规格要求的按 seq 幂等去重
CREATE TABLE IF NOT EXISTS packets (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  batch_start_ms INTEGER NOT NULL,
  sample_rate_hz INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  samples TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
);
