const express = require('express');
const Endpoints = require('./endpoints');
const WebhookService = require('./webhookService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 端点管理路由
app.post('/endpoints', (req, res) => {
  try {
    const { url, secret } = req.body;
    
    if (!url || !secret) {
      return res.status(400).json({ error: 'URL and secret are required' });
    }
    
    const endpoint = Endpoints.create(url, secret);
    res.status(201).json(endpoint);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/endpoints', (req, res) => {
  try {
    const endpoints = Endpoints.getAll();
    res.json(endpoints);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/endpoints/:id', (req, res) => {
  try {
    const endpoint = Endpoints.getById(req.params.id);
    
    if (!endpoint) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    
    res.json(endpoint);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/endpoints/:id', (req, res) => {
  try {
    const endpoint = Endpoints.getById(req.params.id);
    
    if (!endpoint) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    
    const updatedEndpoint = Endpoints.update(req.params.id, req.body);
    res.json(updatedEndpoint);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/endpoints/:id', (req, res) => {
  try {
    const success = Endpoints.delete(req.params.id);
    
    if (!success) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 事件入队路由
app.post('/webhooks/:endpointId', async (req, res) => {
  try {
    const endpoint = Endpoints.getById(req.params.endpointId);
    
    if (!endpoint) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    
    const event = WebhookService.enqueueEvent(req.params.endpointId, req.body);
    
    // 立即尝试投递
    WebhookService.deliverEvent(event);
    
    res.status(202).json({ message: 'Event queued for delivery', event });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 投递历史查询路由
app.get('/delivery-history', (req, res) => {
  try {
    const filters = {};
    
    if (req.query.endpointId) {
      filters.endpointId = req.query.endpointId;
    }
    
    if (req.query.status) {
      filters.status = req.query.status;
    }
    
    const history = WebhookService.getDeliveryHistory(filters);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 手动触发队列处理
app.post('/process-queue', (req, res) => {
  try {
    const count = WebhookService.processQueue();
    res.json({ message: `Processing ${count} events from queue` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动服务
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Webhook Delivery Sandbox running on port ${PORT}`);
    
    // 定期处理队列（每分钟）
    setInterval(() => {
      const count = WebhookService.processQueue();
      if (count > 0) {
        console.log(`Processed ${count} events from queue`);
      }
    }, 60000);
  });
}

module.exports = app;
