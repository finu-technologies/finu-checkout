// routes/admin.js — Session Admin & Operations API

const express = require('express');
const router = express.Router();
const SessionStore = require('../utils/sessionStore');
const { triggerRefund, getRefundStatus } = require('../utils/refund');
const { runTimeoutSweep } = require('../utils/sessionTimeout');

// ─── GET /admin/sessions — paginated session list with stats ─────────────────
router.get('/sessions', (req, res) => {
  const all = SessionStore.getAll();
  const sessions = Object.values(all).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const stats = {
    total:         sessions.length,
    completed:     sessions.filter(s => s.state === 'COMPLETED').length,
    pending:       sessions.filter(s => s.state.includes('PENDING')).length,
    failed:        sessions.filter(s => s.state === 'CARD_FAILED' || s.state === 'UPI_FAILED').length,
    refundFlagged: sessions.filter(s => s.state === 'REFUND_FLAGGED').length,
    cancelled:     sessions.filter(s => s.state === 'CANCELLED').length,
    totalRevenue:  sessions
      .filter(s => s.state === 'COMPLETED')
      .reduce((sum, s) => sum + (s.orderTotal || 0), 0),
  };

  res.json({ sessions, stats });
});

// ─── GET /admin/sessions/:id — single session detail ─────────────────────────
router.get('/sessions/:id', (req, res) => {
  const session = SessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// ─── POST /admin/sessions/:id/refund — manually trigger refund ───────────────
router.post('/sessions/:id/refund', async (req, res) => {
  const session = SessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (!session.cardPaymentId) {
    return res.status(400).json({ error: 'No card payment to refund' });
  }
  if (session.state === 'CANCELLED' && session.refundId) {
    return res.status(400).json({ error: 'Refund already processed', refundId: session.refundId });
  }

  try {
    const result = await triggerRefund(
      session.sessionId,
      session.cardPaymentId,
      session.cardAmount,
      req.body.reason || 'Manual refund from admin dashboard'
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/sessions/:id/refund-status — sync refund from Razorpay ───────
router.get('/sessions/:id/refund-status', async (req, res) => {
  const session = SessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.refundId) return res.status(400).json({ error: 'No refund initiated yet' });

  const refund = await getRefundStatus(session.refundId);
  if (refund) {
    SessionStore.update(session.sessionId, { refundStatus: refund.status });
  }
  res.json({ refund, sessionRefundStatus: refund?.status || session.refundStatus });
});

// ─── POST /admin/sweep — manually trigger timeout sweep ──────────────────────
router.post('/sweep', async (req, res) => {
  try {
    await runTimeoutSweep();
    res.json({ success: true, message: 'Timeout sweep completed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /admin/sessions/:id — remove a session (dev only) ────────────────
router.delete('/sessions/:id', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not allowed in production' });
  }
  const session = SessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  SessionStore.delete(req.params.id);
  res.json({ success: true });
});

module.exports = router;
