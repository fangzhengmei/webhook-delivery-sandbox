const db = require('./database');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const url = require('url');

class WebhookService {
  static enqueueEvent(endpointId, payload) {
    const id = uuidv4();
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    
    const stmt = db.prepare(`
      INSERT INTO event_queue (id, endpoint_id, payload, status) 
      VALUES (?, ?, ?, 'pending')
    `);
    stmt.run(id, endpointId, payloadStr);
    
    return this.getEventById(id);
  }

  static getEventById(id) {
    const stmt = db.prepare('SELECT * FROM event_queue WHERE id = ?');
    return stmt.get(id);
  }

  static getPendingEvents() {
    const stmt = db.prepare(`
      SELECT * FROM event_queue 
      WHERE status = 'pending' 
        OR (status = 'failed' AND next_retry_at <= datetime('now'))
      ORDER BY created_at ASC
    `);
    return stmt.all();
  }

  static generateSignature(secret, payload) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    return 'sha256=' + hmac.digest('hex');
  }

  static async deliverEvent(event) {
    const endpointStmt = db.prepare('SELECT * FROM endpoints WHERE id = ?');
    const endpoint = endpointStmt.get(event.endpoint_id);
    
    if (!endpoint) {
      this.updateEventStatus(event.id, 'failed', 'Endpoint not found');
      return { success: false, error: 'Endpoint not found' };
    }

    if (!endpoint.is_active) {
      this.updateEventStatus(event.id, 'failed', 'Endpoint is inactive');
      return { success: false, error: 'Endpoint is inactive' };
    }

    const payload = event.payload;
    const signature = this.generateSignature(endpoint.secret, payload);
    
    const parsedUrl = url.parse(endpoint.url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Webhook-Signature': signature
      }
    };

    return new Promise((resolve) => {
      const req = protocol.request(options, (res) => {
        let responseBody = '';
        
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        
        res.on('end', () => {
          const success = res.statusCode >= 200 && res.statusCode < 300;
          
          if (success) {
            this.updateEventStatus(event.id, 'delivered');
            this.recordDeliveryHistory(event.id, event.endpoint_id, 'delivered', res.statusCode, responseBody, null, event.retry_count + 1);
            resolve({ success: true, statusCode: res.statusCode, body: responseBody });
          } else {
            this.handleFailedDelivery(event, res.statusCode, responseBody);
            resolve({ success: false, statusCode: res.statusCode, body: responseBody });
          }
        });
      });
      
      req.on('error', (error) => {
        this.handleFailedDelivery(event, null, null, error.message);
        resolve({ success: false, error: error.message });
      });
      
      req.setTimeout(30000, () => {
        req.destroy();
        this.handleFailedDelivery(event, null, null, 'Request timeout');
        resolve({ success: false, error: 'Request timeout' });
      });
      
      req.write(payload);
      req.end();
    });
  }

  static handleFailedDelivery(event, responseStatus, responseBody, errorMessage) {
    const newRetryCount = event.retry_count + 1;
    
    if (newRetryCount >= event.max_retries) {
      this.updateEventStatus(event.id, 'failed', 'Max retries reached');
      this.recordDeliveryHistory(
        event.id, 
        event.endpoint_id, 
        'failed', 
        responseStatus, 
        responseBody, 
        errorMessage || 'Max retries reached', 
        newRetryCount
      );
    } else {
      const nextRetryAt = this.calculateNextRetryTime(newRetryCount);
      
      const updateStmt = db.prepare(`
        UPDATE event_queue 
        SET status = 'failed', retry_count = ?, next_retry_at = ?
        WHERE id = ?
      `);
      updateStmt.run(newRetryCount, nextRetryAt, event.id);
      
      this.recordDeliveryHistory(
        event.id, 
        event.endpoint_id, 
        'failed', 
        responseStatus, 
        responseBody, 
        errorMessage, 
        newRetryCount
      );
    }
  }

  static calculateNextRetryTime(retryCount) {
    const delaySeconds = Math.min(Math.pow(2, retryCount) * 60, 24 * 60 * 60);
    const now = new Date();
    now.setSeconds(now.getSeconds() + delaySeconds);
    return now.toISOString().replace('T', ' ').substring(0, 19);
  }

  static updateEventStatus(eventId, status, errorMessage = null) {
    const updateStmt = db.prepare(`
      UPDATE event_queue 
      SET status = ? 
      WHERE id = ?
    `);
    updateStmt.run(status, eventId);
  }

  static recordDeliveryHistory(eventId, endpointId, status, responseStatus, responseBody, errorMessage, attempt) {
    const id = uuidv4();
    const insertStmt = db.prepare(`
      INSERT INTO delivery_history 
      (id, event_id, endpoint_id, status, response_status, response_body, error_message, attempt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(
      id, 
      eventId, 
      endpointId, 
      status, 
      responseStatus, 
      responseBody, 
      errorMessage, 
      attempt
    );
  }

  static getDeliveryHistory(filters = {}) {
    let query = 'SELECT * FROM delivery_history WHERE 1=1';
    const params = [];

    if (filters.endpointId) {
      query += ' AND endpoint_id = ?';
      params.push(filters.endpointId);
    }

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = db.prepare(query);
    return stmt.all(...params);
  }

  static processQueue() {
    const events = this.getPendingEvents();
    
    for (const event of events) {
      this.deliverEvent(event);
    }
    
    return events.length;
  }
}

module.exports = WebhookService;
