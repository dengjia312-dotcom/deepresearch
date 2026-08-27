CREATE TABLE IF NOT EXISTS anonymous_sessions (
  id uuid PRIMARY KEY,
  session_key_hash text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_tasks (
  task_id text PRIMARY KEY,
  owner_session_id uuid NOT NULL REFERENCES anonymous_sessions(id) ON DELETE CASCADE,
  topic text NOT NULL,
  original_query text NOT NULL DEFAULT '',
  topic_id text NOT NULL DEFAULT 'generic',
  uses_prototype_data boolean NOT NULL DEFAULT false,
  data_source text NOT NULL DEFAULT 'real' CHECK (data_source IN ('real', 'mock')),
  research_depth text NOT NULL CHECK (research_depth IN ('quick', 'deep', 'professional')),
  search_depth text NOT NULL DEFAULT 'standard' CHECK (search_depth IN ('concise', 'standard', 'deep', 'custom')),
  source_count integer NOT NULL CHECK (source_count BETWEEN 8 AND 30),
  report_depth text NOT NULL CHECK (report_depth IN ('brief', 'standard', 'deep')),
  report_target_min_words integer NOT NULL CHECK (report_target_min_words > 0),
  report_target_max_words integer NOT NULL CHECK (report_target_max_words >= report_target_min_words),
  task_status text NOT NULL CHECK (task_status IN ('draft', 'searching', 'collecting', 'outlined', 'reported')),
  pool_version integer NOT NULL DEFAULT 0 CHECK (pool_version >= 0),
  outline_version integer NOT NULL DEFAULT 0 CHECK (outline_version >= 0),
  report_config_version integer NOT NULL DEFAULT 0 CHECK (report_config_version >= 0),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_session_id, task_id)
);

CREATE INDEX IF NOT EXISTS research_tasks_owner_created_idx
  ON research_tasks(owner_session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_task_stages (
  task_id text NOT NULL REFERENCES research_tasks(task_id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('plan', 'research', 'outline', 'report')),
  mode text NOT NULL DEFAULT 'idle' CHECK (mode IN ('idle', 'real', 'mock')),
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'loading', 'success', 'error')),
  request_id text,
  last_error_message text,
  last_error_code text,
  last_error_status integer,
  pool_version integer,
  outline_version integer,
  report_config_version integer,
  failed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, stage)
);

CREATE TABLE IF NOT EXISTS research_plans (
  task_id text PRIMARY KEY REFERENCES research_tasks(task_id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  data_source text NOT NULL CHECK (data_source IN ('real', 'mock')),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_results (
  task_id text PRIMARY KEY REFERENCES research_tasks(task_id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  searched_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_pool_items (
  task_id text NOT NULL REFERENCES research_tasks(task_id) ON DELETE CASCADE,
  source_id text NOT NULL,
  source_snapshot jsonb NOT NULL,
  credibility text NOT NULL,
  review_status text NOT NULL CHECK (review_status IN ('unreviewed', 'trusted', 'questionable', 'irrelevant')),
  note text NOT NULL DEFAULT '',
  data_source text NOT NULL CHECK (data_source IN ('real', 'mock')),
  added_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, source_id)
);

CREATE TABLE IF NOT EXISTS research_outlines (
  task_id text PRIMARY KEY REFERENCES research_tasks(task_id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  data_source text NOT NULL CHECK (data_source IN ('real', 'mock')),
  pool_version integer NOT NULL,
  outline_version integer NOT NULL,
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_reports (
  task_id text PRIMARY KEY REFERENCES research_tasks(task_id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  data_source text NOT NULL CHECK (data_source IN ('real', 'mock')),
  pool_version integer NOT NULL,
  outline_version integer NOT NULL,
  report_config_version integer NOT NULL,
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_citations (
  task_id text NOT NULL REFERENCES research_reports(task_id) ON DELETE CASCADE,
  section_id text NOT NULL,
  paragraph_id text NOT NULL,
  source_id text NOT NULL,
  citation_order integer NOT NULL CHECK (citation_order >= 0),
  PRIMARY KEY (task_id, section_id, paragraph_id, source_id),
  FOREIGN KEY (task_id, source_id)
    REFERENCES research_pool_items(task_id, source_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS report_citations_task_order_idx
  ON report_citations(task_id, citation_order);
