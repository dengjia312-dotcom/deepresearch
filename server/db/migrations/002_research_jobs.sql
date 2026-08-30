CREATE TABLE IF NOT EXISTS research_jobs (
  id uuid PRIMARY KEY,
  task_id text NOT NULL,
  owner_session_id uuid NOT NULL,
  request_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  phase text NOT NULL CHECK (phase IN ('queued', 'searching', 'reading', 'synthesizing', 'completed', 'failed')),
  progress jsonb NOT NULL DEFAULT '{"validSourceCount":0,"readerTargetCount":0,"readerCompletedCount":0,"fullTextCount":0,"partialCount":0,"insufficientCount":0,"readerFailedCount":0}'::jsonb,
  result jsonb,
  error_code text,
  error_message text,
  error_status integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (owner_session_id, task_id)
    REFERENCES research_tasks(owner_session_id, task_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS research_jobs_active_request_idx
  ON research_jobs(owner_session_id, task_id, request_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS research_jobs_owner_created_idx
  ON research_jobs(owner_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS research_jobs_interrupted_idx
  ON research_jobs(status)
  WHERE status IN ('queued', 'running');
