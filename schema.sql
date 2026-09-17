CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  report TEXT NOT NULL,
  summary TEXT,
  hypotheses TEXT,
  checklist TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
