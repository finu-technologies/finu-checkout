// server.js — FinU Split Payment Orchestration Backend

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhook');
const adminRoutes   = require('./routes/admin');
const { startTimeoutWorker } = require('./utils/sessionTimeout');

const app = express();
const PORT = process.env.PORT || 4000;

// ─── CORS — must be first so every response (including errors) has CORS headers ─
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

// ─── Raw body capture for webhook signature verification ──────────────────────
// Path-scoped: only runs for /webhook/* routes, does NOT affect /api routes.
app.use('/webhook', (req, res, next) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    req.rawBody = raw;
    try { req.body = JSON.parse(raw); } catch { req.body = {}; }
    next();
  });
});

// ─── JSON body parser for /api and /admin routes ──────────────────────────────
app.use(express.json());

// ─── JSON body-parse error handler ───────────────────────────────────────────
// express.json() calls next(err) on malformed JSON; Express's default handler
// sends an HTML 400 which the frontend cannot parse. Return JSON instead.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  next(err);
});

// ─── Request logger ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api', paymentRoutes);
app.use('/webhook', webhookRoutes);
app.use('/admin', adminRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'FinU Split Payment Orchestrator',
    timestamp: new Date().toISOString(),
    razorpayConfigured: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    webhookSecretSet: !!process.env.RAZORPAY_WEBHOOK_SECRET,
  });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Serve frontend static files
const path = require('path');
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 FinU Backend running on http://localhost:${PORT}`);
  console.log(`   Razorpay Key:    ${process.env.RAZORPAY_KEY_ID || '⚠  NOT SET'}`);
  console.log(`   Webhook Secret:  ${process.env.RAZORPAY_WEBHOOK_SECRET ? '✓ set' : '⚠  not set (sig check disabled)'}`);
  console.log(`   Frontend:        ${process.env.FRONTEND_URL || 'http://localhost:5173'}\n`);
  startTimeoutWorker(60 * 1000);
});
