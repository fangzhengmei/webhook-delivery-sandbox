const request = require('supertest');
const app = require('../src/app');
const db = require('../src/database');
const WebhookService = require('../src/webhookService');

beforeEach(() => {
  db.exec(`
    DELETE FROM delivery_history;
    DELETE FROM event_queue;
    DELETE FROM endpoints;
  `);
});

afterAll(() => {
  db.close();
});

describe('Endpoints API', () => {
  describe('POST /endpoints', () => {
    it('should create a new endpoint', async () => {
      const response = await request(app)
        .post('/endpoints')
        .send({
          url: 'https://example.com/webhook',
          secret: 'test-secret-123'
        })
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.url).toBe('https://example.com/webhook');
      expect(response.body.secret).toBe('test-secret-123');
      expect(response.body.is_active).toBe(1);
    });

    it('should return 400 if url or secret is missing', async () => {
      const response = await request(app)
        .post('/endpoints')
        .send({
          url: 'https://example.com/webhook'
        })
        .expect(400);

      expect(response.body.error).toBe('URL and secret are required');
    });
  });

  describe('GET /endpoints', () => {
    it('should return all endpoints', async () => {
      await request(app)
        .post('/endpoints')
        .send({
          url: 'https://example.com/webhook1',
          secret: 'secret1'
        });

      await request(app)
        .post('/endpoints')
        .send({
          url: 'https://example.com/webhook2',
          secret: 'secret2'
        });

      const response = await request(app)
        .get('/endpoints')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.length).toBe(2);
    });

    it('should return empty array when no endpoints exist', async () => {
      const response = await request(app)
        .get('/endpoints')
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('GET /endpoints/:id', () => {
    it('should return a specific endpoint', async () => {
      const createResponse = await request(app)
        .post('/endpoints')
        .send({
          url: 'https://example.com/webhook',
          secret: 'test-secret'
        });

      const endpointId = createResponse.body.id;

      const response = await request(app)
        .get(`/endpoints/${endpointId}`)
        .expect(200);

      expect(response.body.id).toBe(endpointId);
      expect(response.body.url).toBe('https://example.com/webhook');
    });

    it('should return 404 for non-existent endpoint', async () => {
      const response = await request(app)
        .get('/endpoints/non-existent-id')
        .expect(404);

      expect(response.body.error).toBe('Endpoint not found');
    });
  });

  describe('PUT /endpoints/:id', () => {
    it('should update an existing endpoint', async () => {
      const createResponse = await request(app)
        .post('/endpoints')
        .send({
          url: 'https://example.com/webhook',
          secret: 'test-secret'
        });

      const endpointId = createResponse.body.id;

      const response = await request(app)
        .put(`/endpoints/${endpointId}`)
        .send({
          url: 'https://example.com/updated-webhook',
          is_active: false
        })
        .expect(200);

      expect(response.body.url).toBe('https://example.com/updated-webhook');
      expect(response.body.is_active).toBe(0);
    });

    it('should return 404 for non-existent endpoint', async () => {
      const response = await request(app)
        .put('/endpoints/non-existent-id')
        .send({
          url: 'https://example.com/webhook'
        })
        .expect(404);

      expect(response.body.error).toBe('Endpoint not found');
    });
  });

  describe('DELETE /endpoints/:id', () => {
    it('should delete an existing endpoint', async () => {
      const createResponse = await request(app)
        .post('/endpoints')
        .send({
          url: 'https://example.com/webhook',
          secret: 'test-secret'
        });

      const endpointId = createResponse.body.id;

      await request(app)
        .delete(`/endpoints/${endpointId}`)
        .expect(204);

      const getResponse = await request(app)
        .get(`/endpoints/${endpointId}`)
        .expect(404);

      expect(getResponse.body.error).toBe('Endpoint not found');
    });

    it('should return 404 for non-existent endpoint', async () => {
      const response = await request(app)
        .delete('/endpoints/non-existent-id')
        .expect(404);

      expect(response.body.error).toBe('Endpoint not found');
    });
  });
});

describe('Webhook Service', () => {
  describe('HMAC Signature Generation', () => {
    it('should generate correct HMAC signature', () => {
      const secret = 'test-secret';
      const payload = JSON.stringify({ event: 'test', data: 'value' });
      
      const signature = WebhookService.generateSignature(secret, payload);
      
      expect(signature).toMatch(/^sha256=[a-f0-9]+$/);
    });

    it('should generate different signatures for different secrets', () => {
      const payload = JSON.stringify({ event: 'test' });
      
      const signature1 = WebhookService.generateSignature('secret1', payload);
      const signature2 = WebhookService.generateSignature('secret2', payload);
      
      expect(signature1).not.toBe(signature2);
    });
  });

  describe('Exponential Backoff Calculation', () => {
    it('should calculate correct next retry time', () => {
      const now = new Date();
      
      for (let retryCount = 1; retryCount <= 5; retryCount++) {
        const nextRetryTime = WebhookService.calculateNextRetryTime(retryCount);
        const nextRetryDate = new Date(nextRetryTime);
        
        const expectedDelay = Math.min(Math.pow(2, retryCount) * 60 * 1000, 24 * 60 * 60 * 1000);
        const timeDiff = nextRetryDate - now;
        
        expect(timeDiff).toBeGreaterThanOrEqual(expectedDelay - 1000);
        expect(timeDiff).toBeLessThanOrEqual(expectedDelay + 1000);
      }
    });

    it('should cap delay at 24 hours', () => {
      const nextRetryTime = WebhookService.calculateNextRetryTime(10);
      const nextRetryDate = new Date(nextRetryTime);
      const now = new Date();
      
      const maxDelay = 24 * 60 * 60 * 1000;
      const timeDiff = nextRetryDate - now;
      
      expect(timeDiff).toBeLessThanOrEqual(maxDelay + 1000);
    });
  });
});

describe('Delivery History API', () => {
  it('should return delivery history with filters', async () => {
    const createResponse = await request(app)
      .post('/endpoints')
      .send({
        url: 'https://example.com/webhook',
        secret: 'test-secret'
      });

    const endpointId = createResponse.body.id;
    
    db.prepare(`
      INSERT INTO delivery_history (id, event_id, endpoint_id, status, attempt)
      VALUES (?, ?, ?, ?, ?)
    `).run('history1', 'event1', endpointId, 'delivered', 1);
    
    db.prepare(`
      INSERT INTO delivery_history (id, event_id, endpoint_id, status, attempt)
      VALUES (?, ?, ?, ?, ?)
    `).run('history2', 'event2', endpointId, 'failed', 2);

    const allResponse = await request(app)
      .get('/delivery-history')
      .expect(200);
    
    expect(allResponse.body.length).toBe(2);

    const filteredByEndpoint = await request(app)
      .get(`/delivery-history?endpointId=${endpointId}`)
      .expect(200);
    
    expect(filteredByEndpoint.body.length).toBe(2);

    const filteredByStatus = await request(app)
      .get('/delivery-history?status=delivered')
      .expect(200);
    
    expect(filteredByStatus.body.length).toBe(1);
    expect(filteredByStatus.body[0].status).toBe('delivered');

    const combinedFilter = await request(app)
      .get(`/delivery-history?endpointId=${endpointId}&status=failed`)
      .expect(200);
    
    expect(combinedFilter.body.length).toBe(1);
    expect(combinedFilter.body[0].status).toBe('failed');
  });
});

describe('Health Check', () => {
  it('should return ok status', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);
    
    expect(response.body.status).toBe('ok');
  });
});
