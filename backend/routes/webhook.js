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

function appendLog(session, message) {
  return [...(session.logs || []), message];
}

function receiptFor(orderRef, leg) {
  const suffix = `_${leg}`;
  const rawRef = String(orderRef || '').trim() || `ORD${Date.now().toString().slice(-6)}`;
  const safeRef = rawRef.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40 - suffix.length);
  return `${safeRef || 'ORDER'}${suffix}`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForStoredUpiOrder(sessionId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await delay(500);
    const session = SessionStore.get(sessionId);
    if (session?.upiOrderId) return session;
    if (!session?.upiOrderCreatingAt) return null;
  }
  return SessionStore.get(sessionId);
}

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

async function captureAuthorizedCardPayment(sessionId, reason = 'webhook') {
  const session = SessionStore.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  if (session.state === 'COMPLETED' || session.cardCapturedAt || session.cardCaptureStatus === 'captured') {
    console.log(`[webhook] Capture skipped; card already captured/completed for ${sessionId}`);
    return SessionStore.get(sessionId);
  }

  if (!session.cardPaymentId) throw new Error('No card payment ID available for capture');

  console.log(`[webhook] CARD_CAPTURE_STARTED session=${sessionId} payment=${session.cardPaymentId} reason=${reason}`);
  const payment = await razorpay.payments.fetch(session.cardPaymentId);
  console.log('[webhook] Payment status before capture:', {
    sessionId,
    paymentId: session.cardPaymentId,
    status: payment.status,
    captured: payment.captured,
  });

  if (payment.captured || payment.status === 'captured') {
    return SessionStore.update(sessionId, {
      state: 'COMPLETED',
      cardCaptureStatus: 'captured',
      cardCapturedAt: new Date().toISOString(),
      logs: appendLog(session, `CARD_CAPTURE_SUCCESS payment ${session.cardPaymentId} was already captured. ORDER_COMPLETED.`),
    });
  }

  if (payment.status !== 'authorized') {
    const updated = SessionStore.update(sessionId, {
      state: 'CARD_CAPTURE_FAILED',
      cardCaptureStatus: 'failed',
      cardCaptureError: `Cannot capture payment in status: ${payment.status}`,
      logs: appendLog(session, `CARD_CAPTURE_FAILED payment ${session.cardPaymentId} status was ${payment.status}; expected authorized.`),
    });
    throw new Error(updated.cardCaptureError);
  }

  SessionStore.update(sessionId, {
    state: 'CARD_CAPTURE_PENDING',
    cardCaptureStatus: 'pending',
    logs: appendLog(session, `CARD_CAPTURE_STARTED payment ${session.cardPaymentId}.`),
  });

  try {
    const capture = await razorpay.payments.capture(
      session.cardPaymentId,
      Math.round(session.cardAmount * 100),
      'INR'
    );
    const fresh = SessionStore.get(sessionId) || session;
    const updated = SessionStore.update(sessionId, {
      state: 'COMPLETED',
      cardCaptureStatus: 'captured',
      cardCapturedAt: new Date().toISOString(),
      cardCaptureResponse: {
        id: capture.id,
        status: capture.status,
        captured: capture.captured,
      },
      logs: appendLog(fresh, `CARD_CAPTURE_SUCCESS payment ${session.cardPaymentId}. ORDER_COMPLETED.`),
    });
    console.log(`[webhook] CARD_CAPTURE_SUCCESS session=${sessionId} payment=${session.cardPaymentId}`);
    console.log(`[webhook] ORDER_COMPLETED session=${sessionId}`);
    return updated;
  } catch (err) {
    const msg = err.error?.description || err.message || 'Unknown capture error';
    const fresh = SessionStore.get(sessionId) || session;
    SessionStore.update(sessionId, {
      state: 'CARD_CAPTURE_FAILED',
      cardCaptureStatus: 'failed',
      cardCaptureError: msg,
      logs: appendLog(fresh, `CARD_CAPTURE_FAILED payment ${session.cardPaymentId}: ${msg}`),
    });
    console.error(`[webhook] CARD_CAPTURE_FAILED session=${sessionId}:`, msg);
    throw err;
  }
}

function leaveAuthorizationUncaptured(sessionId, reason) {
  const session = SessionStore.get(sessionId);
  if (!session || session.state === 'COMPLETED' || session.cardCapturedAt) return session;
  const updated = SessionStore.update(sessionId, {
    state: 'AUTH_RELEASE_PENDING',
    cardCaptureStatus: 'left_uncaptured',
    logs: appendLog(session, `AUTHORIZATION_LEFT_UNCAPTURED payment ${session.cardPaymentId || 'unknown'}: ${reason}`),
  });
  console.log(`[webhook] AUTHORIZATION_LEFT_UNCAPTURED session=${sessionId} reason=${reason}`);
  return updated;
}

async function ensureUpiOrderForAuthorizedCard(sessionId, reason = 'webhook card authorization') {
  const session = SessionStore.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  if (session.upiOrderId) {
    console.log(`[webhook] Existing UPI order reused for ${sessionId}: ${session.upiOrderId}`);
    return SessionStore.get(sessionId);
  }

  if (!session.cardPaymentId || !['CARD_AUTHORIZED', 'UPI_PENDING'].includes(session.state)) {
    throw new Error(`Cannot create UPI order in state: ${session.state}`);
  }

  if (session.upiOrderCreatingAt) {
    const pending = await waitForStoredUpiOrder(sessionId);
    if (pending?.upiOrderId) {
      console.log(`[webhook] UPI order created by concurrent flow for ${sessionId}: ${pending.upiOrderId}`);
      return pending;
    }
  }

  const locked = SessionStore.update(sessionId, {
    upiOrderCreatingAt: new Date().toISOString(),
    logs: appendLog(session, `UPI_ORDER_CREATING via ${reason}.`),
  });

  console.log(`[webhook] Creating UPI order for ${sessionId}; reason=${reason}`);
  let upiOrder;
  try {
    upiOrder = await razorpay.orders.create({
      amount: Math.round(session.upiAmount * 100),
      currency: 'INR',
      receipt: receiptFor(session.merchantOrderRef || session.sessionId, 'UPI'),
      notes: { sessionId, leg: 'UPI' },
    });
  } catch (err) {
    const fresh = SessionStore.get(sessionId) || locked || session;
    SessionStore.update(sessionId, {
      upiOrderCreatingAt: null,
      upiOrderCreationError: err.error?.description || err.message || 'Unknown UPI order creation error',
      logs: appendLog(fresh, `UPI_ORDER_CREATE_FAILED via ${reason}: ${err.error?.description || err.message || 'Unknown error'}`),
    });
    throw err;
  }

  const fresh = SessionStore.get(sessionId) || session;
  if (fresh.upiOrderId) {
    console.log(`[webhook] Concurrent UPI order already stored for ${sessionId}: ${fresh.upiOrderId}`);
    return fresh;
  }

  return SessionStore.update(sessionId, {
    state: 'UPI_PENDING',
    upiOrderId: upiOrder.id,
    upiOrderCreatingAt: null,
    upiOrderCreationError: null,
    logs: appendLog(fresh, `UPI_STARTED order ${upiOrder.id} created via ${reason}. Awaiting UPI payment.`),
  });
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
    case 'payment.authorized': {
      const payment = payload.payment.entity;
      const orderId = payment.order_id;
      const session = findSessionByOrderId(orderId);
      if (!session) { console.warn(`[webhook] No session found for authorized order ${orderId}`); return; }

      const isCardLeg = session.cardOrderId === orderId;
      if (isCardLeg && ['CARD_PENDING', 'CARD_AUTHORIZED', 'UPI_PENDING'].includes(session.state)) {
        const latest = SessionStore.get(session.sessionId) || session;
        if (!latest.cardPaymentId) {
          SessionStore.update(session.sessionId, {
            state: 'CARD_AUTHORIZED',
            cardPaymentId: payment.id,
            cardAuthorizedAt: new Date().toISOString(),
            cardCaptureStatus: 'authorized',
            logs: appendLog(latest, `CARD_AUTHORIZED via webhook: ${payment.id}`),
          });
        } else if (latest.cardPaymentId !== payment.id) {
          console.warn(`[webhook] Card authorized payment mismatch for session ${session.sessionId}: existing=${latest.cardPaymentId} incoming=${payment.id}`);
          return;
        } else if (latest.state === 'CARD_PENDING') {
          SessionStore.update(session.sessionId, {
            state: 'CARD_AUTHORIZED',
            cardAuthorizedAt: latest.cardAuthorizedAt || new Date().toISOString(),
            cardCaptureStatus: latest.cardCaptureStatus || 'authorized',
            logs: appendLog(latest, `CARD_AUTHORIZED duplicate webhook confirmed: ${payment.id}`),
          });
        }

        await ensureUpiOrderForAuthorizedCard(session.sessionId, 'payment.authorized webhook');
        console.log(`[webhook] CARD_AUTHORIZED and UPI order ensured for session ${session.sessionId}`);
      }
      break;
    }

    case 'payment.captured': {
      const payment = payload.payment.entity;
      const orderId = payment.order_id;
      const session = findSessionByOrderId(orderId);
      if (!session) { console.warn(`[webhook] No session found for order ${orderId}`); return; }

      const isCardLeg = session.cardOrderId === orderId;
      const isUpiLeg  = session.upiOrderId  === orderId;

      if (isCardLeg && session.state !== 'COMPLETED') {
        SessionStore.update(session.sessionId, {
          state: session.upiPaymentId ? 'COMPLETED' : 'CARD_CAPTURED',
          cardPaymentId: payment.id,
          cardCaptureStatus: 'captured',
          cardCapturedAt: new Date().toISOString(),
          logs: appendLog(session, `[webhook] CARD_CAPTURE_SUCCESS Card captured: ${payment.id}`),
        });
        console.log(`[webhook] Card captured for session ${session.sessionId}`);
      }

      if (isUpiLeg && session.state === 'UPI_PENDING') {
        SessionStore.update(session.sessionId, {
          state: 'UPI_SUCCESS',
          upiPaymentId: payment.id,
          logs: appendLog(session, `[webhook] UPI_VERIFIED captured: ${payment.id}. Capturing card.`),
        });
        console.log(`[webhook] UPI captured — capturing card for session ${session.sessionId}`);
        await captureAuthorizedCardPayment(session.sessionId, 'UPI payment.captured webhook');
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
          logs: appendLog(session, `[webhook] Card payment failed: ${payment.error_description}`),
        });
        console.log(`[webhook] Card failed for session ${session.sessionId}`);
      } else {
        // UPI failed after card authorization. With manual capture, leave the
        // authorization uncaptured so Razorpay releases it on expiry.
        const fresh = SessionStore.get(session.sessionId);
        if (fresh && fresh.cardPaymentId && !fresh.cardCapturedAt) {
          leaveAuthorizationUncaptured(session.sessionId, 'UPI payment.failed webhook');
        } else if (fresh && fresh.cardPaymentId) {
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
        logs: appendLog(session, `[webhook] Refund ${refund.id} processed for ₹${refund.amount / 100}`),
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
          state: 'UPI_SUCCESS',
          logs: appendLog(session, `[webhook] order.paid received — attempting card capture`),
        });
        await captureAuthorizedCardPayment(session.sessionId, 'order.paid webhook');
      }
      break;
    }

    default:
      console.log(`[webhook] Unhandled event: ${eventName}`);
  }
}

module.exports = router;
