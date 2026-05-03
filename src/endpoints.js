const db = require('./database');
const { v4: uuidv4 } = require('uuid');

class Endpoints {
  static create(url, secret) {
    const id = uuidv4();
    const stmt = db.prepare('INSERT INTO endpoints (id, url, secret) VALUES (?, ?, ?)');
    stmt.run(id, url, secret);
    return this.getById(id);
  }

  static getById(id) {
    const stmt = db.prepare('SELECT * FROM endpoints WHERE id = ?');
    return stmt.get(id);
  }

  static getAll() {
    const stmt = db.prepare('SELECT * FROM endpoints ORDER BY created_at DESC');
    return stmt.all();
  }

  static delete(id) {
    const stmt = db.prepare('DELETE FROM endpoints WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  static update(id, data) {
    const fields = [];
    const values = [];

    if (data.url !== undefined) {
      fields.push('url = ?');
      values.push(data.url);
    }
    if (data.secret !== undefined) {
      fields.push('secret = ?');
      values.push(data.secret);
    }
    if (data.is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(data.is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      return this.getById(id);
    }

    values.push(id);
    const stmt = db.prepare(`UPDATE endpoints SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
    return this.getById(id);
  }
}

module.exports = Endpoints;
