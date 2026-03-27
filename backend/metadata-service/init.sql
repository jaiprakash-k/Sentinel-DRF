-- Sentinel DRF - PostgreSQL Init Script
CREATE TABLE IF NOT EXISTS metadata (
    id          SERIAL PRIMARY KEY,
    flow_id     VARCHAR(64) NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    file_path   TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metadata_flow_id ON metadata(flow_id);
