const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

class Database {
  constructor() {
    this.db = null;
    this.dbPath = process.env.NODE_ENV === 'test' 
      ? ':memory:' 
      : path.join(__dirname, '..', 'webhook.db');
  }

  async init() {
    if (this.db) {
      return;
    }

    const SQL = await initSqlJs();
    
    if (this.dbPath === ':memory:') {
      this.db = new SQL.Database();
    } else {
      try {
        if (fs.existsSync(this.dbPath)) {
          const fileBuffer = fs.readFileSync(this.dbPath);
          this.db = new SQL.Database(fileBuffer);
        } else {
          this.db = new SQL.Database();
        }
      } catch (error) {
        console.warn('Failed to open existing database, creating new one:', error.message);
        this.db = new SQL.Database();
      }
    }

    this._createTables();
    this._setupSaveInterval();
  }

  _createTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS endpoints (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS event_queue (
        id TEXT PRIMARY KEY,
        endpoint_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 5,
        next_retry_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (endpoint_id) REFERENCES endpoints(id)
      )`,
      `CREATE TABLE IF NOT EXISTS delivery_history (
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
      )`
    ];

    for (const tableSql of tables) {
      this.db.run(tableSql);
    }
  }

  _setupSaveInterval() {
    if (this.dbPath !== ':memory:') {
      setInterval(() => {
        this._saveToDisk();
      }, 5000);
    }
  }

  _saveToDisk() {
    if (this.dbPath === ':memory:' || !this.db) {
      return;
    }

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (error) {
      console.error('Failed to save database to disk:', error.message);
    }
  }

  prepare(sql) {
    const self = this;
    return {
      run: function(...params) {
        self.db.run(sql, params);
        return {
          changes: self.db.getRowsModified(),
          lastInsertRowid: self.db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0]
        };
      },
      get: function(...params) {
        const stmt = self.db.prepare(sql);
        stmt.bind(params);
        
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        
        stmt.free();
        return undefined;
      },
      all: function(...params) {
        const results = [];
        const stmt = self.db.prepare(sql);
        stmt.bind(params);
        
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        
        stmt.free();
        return results;
      }
    };
  }

  exec(sql) {
    this.db.run(sql);
  }

  close() {
    if (this.db) {
      this._saveToDisk();
      this.db.close();
      this.db = null;
    }
  }
}

const dbInstance = new Database();

let initPromise = null;

function getDb() {
  if (!initPromise) {
    initPromise = dbInstance.init().then(() => dbInstance);
  }
  return initPromise;
}

module.exports = getDb;
