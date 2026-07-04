// routes/webhook.js — Razorpay Async Webhook Handler
// Razorpay sends signed POST events for payment.captured, payment.failed, refund.processed, etc.
// This is the production-safe path — the frontend verify endpoints are a fallback for PoC.

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');
const SessionStore = require('../utils/sessionStore');
const { triggerRefund } = require('../utils/refund');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── Webhook signature verification middleware ────────────────────────────────
function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    // In PoC mode without a webhook secret, log and pass through
    console.warn('[webhook] RAZORPAY_WEBHOOK_SECRET not set — skipping signature check');
    return next();
  }

  if (!signature) {
    return res.status(400).json({ error: 'Missing webhook signature' });
  }

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody) // raw body needed — see server.js
    .digest('hex');

  if (expectedSig !== signature) {
    console.error('[webhook] Signature mismatch — possible spoofed request');
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  next();
}

// ─── Find session by Razorpay order ID ───────────────────────────────────────
function findSessionByOrderId(orderId) {
  const all = SessionStore.getAll();
  return Object.values(all).find(
    (s) => s.cardOrderId === orderId || s.upiOrderId === orderId
  ) || null;
}

// ─── POST /webhook/razorpay ───────────────────────────────────────────────────
router.post('/razorpay', verifyWebhookSignature, async (req, res) => {
  const event = req.body;
  const { event: eventName, payload } = event;

  console.log(`[webhook] Event received: ${eventName}`);

  // Always respond 200 immediately — process async
  res.json({ status: 'received' });

  try {
    await handleEvent(eventName, payload);
  } catch (err) {
    console.error(`[webhook] Handler error for ${eventName}:`, err.message);
  }
});

// ─── Event dispatcher ─────────────────────────────────────────────────────────
async function handleEvent(eventName, payload) {
  switch (eventName) {

    case 'payment.captured': {
      const payment = payload.payment.entity;
      const orderId = payment.order_id;
      const session = findSessionByOrderId(orderId);
      if (!session) { console.warn(`[webhook] No session found for order ${orderId}`); return; }

      const isCardLeg = session.cardOrderId === orderId;
      const isUpiLeg  = session.upiOrderId  === orderId;

      if (isCardLeg && session.state === 'CARD_PENDING') {
        SessionStore.update(session.sessionId, {
          state: 'CARD_SUCCESS',
          cardPaymentId: payment.id,
          logs: [...session.logs, `[webhook] Card captured: ${payment.id}`],
        });
        console.log(`[webhook] Card captured for session ${session.sessionId}`);
      }

      if (isUpiLeg && session.state === 'UPI_PENDING') {
        SessionStore.update(session.sessionId, {
          state: 'COMPLETED',
          upiPaymentId: payment.id,
          logs: [...session.logs, `[webhook] UPI captured: ${payment.id}. ORDER CONFIRMED.`],
        });
        console.log(`[webhook] UPI captured — session ${session.sessionId} COMPLETED`);
      }
      break;
    }

    case 'payment.failed': {
      const payment = payload.payment.entity;
      const orderId = payment.order_id;
      const session = findSessionByOrderId(orderId);
      if (!session) return;

      const isCardLeg = session.cardOrderId === orderId;

      if (isCardLeg) {
        SessionStore.update(session.sessionId, {
          state: 'CARD_FAILED',
          logs: [...session.logs, `[webhook] Card payment failed: ${payment.error_description}`],
        });
        console.log(`[webhook] Card failed for session ${session.sessionId}`);
      } else {
        // UPI failed after card succeeded — auto-trigger refund
        const fresh = SessionStore.get(session.sessionId);
        if (fresh && fresh.cardPaymentId) {
          await triggerRefund(session.sessionId, fresh.cardPaymentId, fresh.cardAmount, 'UPI leg failed via webhook');
        }
      }
      break;
    }

    case 'refund.processed': {
      const refund = payload.refund.entity;
      const paymentId = refund.payment_id;
      const all = SessionStore.getAll();
      const session = Object.values(all).find(s => s.cardPaymentId === paymentId);
      if (!session) return;

      SessionStore.update(session.sessionId, {
        state: 'CANCELLED',
        refundId: refund.id,
        logs: [...session.logs, `[webhook] Refund ${refund.id} processed for ₹${refund.amount / 100}`],
      });
      console.log(`[webhook] Refund confirmed for session ${session.sessionId}`);
      break;
    }

    case 'order.paid': {
      // Belt-and-suspenders: mark complete if both legs are done
      const order = payload.order.entity;
      const session = findSessionByOrderId(order.id);
      if (session && session.state === 'UPI_PENDING') {
        SessionStore.update(session.sessionId, {
          state: 'COMPLETED',
          logs: [...session.logs, `[webhook] order.paid received — marking COMPLETED`],
        });
      }
      break;
    }

    default:
      console.log(`[webhook] Unhandled event: ${eventName}`);
  }
}

module.exports = router;
