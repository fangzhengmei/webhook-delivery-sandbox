const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.NODE_ENV === 'test' 
  ? ':memory:' 
  : path.join(__dirname, '..', 'webhook.db');

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS endpoints (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS event_queue (
    id TEXT PRIMARY KEY,
    endpoint_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 5,
    next_retry_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(id)
  );

  CREATE TABLE IF NOT EXISTS delivery_history (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    status TEXT NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    error_message TEXT,
    attempt INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES event_queue(id),
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(id)
  );
`);

module.exports = db;
