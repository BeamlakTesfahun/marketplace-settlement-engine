import express from 'express';
import cors from 'cors';

import routes from './routes/index.js';
import webhookRoutes from './modules/webhook/webhook.routes.js';

import { notFound } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { globalRateLimiter } from './middlewares/rateLimiter.js';
import { basicAuth } from './middlewares/basicAuth.js';

import { serverAdapter } from './config/bullBoard.js';
i;

const app = express();

app.use(cors());

app.use('/api/v1/webhooks', webhookRoutes);

app.use(express.json());
app.use(globalRateLimiter);

app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Marketplace API is running.',
    });
});

app.use('/api/v1', routes);

app.use('/admin/queues', basicAuth, serverAdapter.getRouter());

app.use(notFound);

app.use(errorHandler);

export default app;
