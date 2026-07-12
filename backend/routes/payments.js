// routes/payments.js — Split Payment Orchestration Routes

const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const SessionStore = require('../utils/sessionStore');
const { triggerRefund, getRefundStatus } = require('../utils/refund');

// ─── Lazy Razorpay factory ────────────────────────────────────────────────────
// Instantiated per-call so it always picks up the live env vars,
// avoiding a stale credential if dotenv loaded after module require.
function getRazorpay() {
  const key_id     = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    throw new Error('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is not set in .env');
  }
  return new Razorpay({ key_id, key_secret });
}

// ─── Safe error message extractor ────────────────────────────────────────────
// Razorpay SDK throws non-standard objects { statusCode, error: { description } }.
// JSON.stringify on those objects can throw (circular refs in some SDK versions).
// Always extract a plain string before putting in a response body.
function razorpayErrMsg(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  // Razorpay SDK error format
  if (err.error && err.error.description) return err.error.description;
  if (err.error && typeof err.error === 'string') return err.error;
  if (err.message) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

// ─── Safe JSON responder ──────────────────────────────────────────────────────
// Wraps res.json() so a serialization failure never leaves the socket open
// with an empty body — falls back to res.end() with a plain-text payload.
function safeJson(res, status, body) {
  try {
    res.status(status).json(body);
  } catch (jsonErr) {
    console.error('[safeJson] JSON serialization failed:', jsonErr.message);
    if (!res.headersSent) {
      res.status(status).set('Content-Type', 'application/json')
         .end(JSON.stringify({ error: 'Internal serialization error' }));
    }
  }
}

// ─── SESSION STATES ───────────────────────────────────────────────────────────
const STATE = {
  CREATED:        'CREATED',
  CARD_PENDING:   'CARD_PENDING',
  CARD_AUTHORIZED: 'CARD_AUTHORIZED',
  CARD_CAPTURE_PENDING: 'CARD_CAPTURE_PENDING',
  CARD_CAPTURED:  'CARD_CAPTURED',
  CARD_SUCCESS:   'CARD_SUCCESS',
  CARD_FAILED:    'CARD_FAILED',
  UPI_PENDING:    'UPI_PENDING',
  UPI_SUCCESS:    'UPI_SUCCESS',
  CARD_CAPTURE_FAILED: 'CARD_CAPTURE_FAILED',
  AUTH_RELEASE_PENDING: 'AUTH_RELEASE_PENDING',
  UPI_FAILED:     'UPI_FAILED',
  COMPLETED:      'COMPLETED',
  CANCELLED:      'CANCELLED',
  REFUND_FLAGGED: 'REFUND_FLAGGED',
};

function appendLog(session, message) {
  return [...(session.logs || []), message];
}

async function fetchPayment(paymentId) {
  const rzp = getRazorpay();
  return rzp.payments.fetch(paymentId);
}

async function captureAuthorizedCardPayment(sessionId, reason = 'UPI verified') {
  const session = SessionStore.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  if (session.state === STATE.COMPLETED || session.cardCapturedAt || session.cardCaptureStatus === 'captured') {
    console.log(`[capture] ${sessionId} already completed/captured. Skipping duplicate capture.`);
    return { alreadyCaptured: true, session };
  }

  if (!session.cardPaymentId) throw new Error('No card payment ID available for capture');

  console.log(`[capture] CARD_CAPTURE_STARTED session=${sessionId} payment=${session.cardPaymentId} reason=${reason}`);

  const payment = await fetchPayment(session.cardPaymentId);
  console.log('[capture] Payment status before capture:', {
    sessionId,
    paymentId: session.cardPaymentId,
    status: payment.status,
    captured: payment.captured,
  });

  if (payment.captured || payment.status === 'captured') {
    const updated = SessionStore.update(sessionId, {
      state: STATE.COMPLETED,
      cardCaptureStatus: 'captured',
      cardCapturedAt: new Date().toISOString(),
      logs: appendLog(session, `CARD_CAPTURE_SUCCESS payment ${session.cardPaymentId} was already captured. ORDER_COMPLETED.`),
    });
    return { alreadyCaptured: true, session: updated };
  }

  if (payment.status !== 'authorized') {
    const updated = SessionStore.update(sessionId, {
      state: STATE.CARD_CAPTURE_FAILED,
      cardCaptureStatus: 'failed',
      cardCaptureError: `Cannot capture payment in status: ${payment.status}`,
      logs: appendLog(session, `CARD_CAPTURE_FAILED payment ${session.cardPaymentId} status was ${payment.status}; expected authorized.`),
    });
    const err = new Error(`Cannot capture payment in status: ${payment.status}`);
    err.session = updated;
    throw err;
  }

  SessionStore.update(sessionId, {
    state: STATE.CARD_CAPTURE_PENDING,
    cardCaptureStatus: 'pending',
    logs: appendLog(session, `CARD_CAPTURE_STARTED payment ${session.cardPaymentId}.`),
  });

  try {
    const rzp = getRazorpay();
    const capture = await rzp.payments.capture(
      session.cardPaymentId,
      Math.round(session.cardAmount * 100),
      'INR'
    );

    const fresh = SessionStore.get(sessionId) || session;
    const updated = SessionStore.update(sessionId, {
      state: STATE.COMPLETED,
      cardCaptureStatus: 'captured',
      cardCapturedAt: new Date().toISOString(),
      cardCaptureResponse: {
        id: capture.id,
        status: capture.status,
        captured: capture.captured,
      },
      logs: appendLog(fresh, `CARD_CAPTURE_SUCCESS payment ${session.cardPaymentId}. ORDER_COMPLETED.`),
    });

    console.log(`[capture] CARD_CAPTURE_SUCCESS session=${sessionId} payment=${session.cardPaymentId}`);
    console.log(`[capture] ORDER_COMPLETED session=${sessionId}`);
    return { capture, session: updated };
  } catch (err) {
    const msg = razorpayErrMsg(err);
    const fresh = SessionStore.get(sessionId) || session;
    const updated = SessionStore.update(sessionId, {
      state: STATE.CARD_CAPTURE_FAILED,
      cardCaptureStatus: 'failed',
      cardCaptureError: msg,
      logs: appendLog(fresh, `CARD_CAPTURE_FAILED payment ${session.cardPaymentId}: ${msg}`),
    });
    console.error(`[capture] CARD_CAPTURE_FAILED session=${sessionId}:`, msg);
    err.session = updated;
    throw err;
  }
}

function leaveAuthorizationUncaptured(sessionId, reason) {
  const session = SessionStore.get(sessionId);
  if (!session) return null;
  if (session.cardCaptureStatus === 'captured' || session.state === STATE.COMPLETED) return session;

  const updated = SessionStore.update(sessionId, {
    state: STATE.AUTH_RELEASE_PENDING,
    cardCaptureStatus: 'left_uncaptured',
    authorizationReleaseExpectedAt: null,
    logs: appendLog(session, `AUTHORIZATION_LEFT_UNCAPTURED payment ${session.cardPaymentId || 'unknown'}: ${reason}`),
  });
  console.log(`[auth] AUTHORIZATION_LEFT_UNCAPTURED session=${sessionId} reason=${reason}`);
  return updated;
}

// ─── 1. CREATE PAYMENT SESSION ────────────────────────────────────────────────
router.post('/session/create', async (req, res) => {
  try {
    const { orderTotal, cardAmount, upiAmount, customerEmail, customerPhone } = req.body;

    if (!orderTotal || !cardAmount || !upiAmount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (Math.round((cardAmount + upiAmount) * 100) !== Math.round(orderTotal * 100)) {
      return res.status(400).json({ error: 'Card + UPI amounts must equal order total' });
    }

    const sessionId = uuidv4();
    const rzp = getRazorpay();

    const cardOrder = await rzp.orders.create({
      amount: Math.round(cardAmount * 100),
      currency: 'INR',
      receipt: `card_${sessionId.slice(0, 8)}`,
      notes: { sessionId, leg: 'CARD' },
      payment: {
        capture: 'manual',
        capture_options: {
          manual_expiry_period: 7200,
          refund_speed: 'normal',
        },
      },
    });

    SessionStore.create(sessionId, {
      sessionId,
      orderTotal,
      cardAmount,
      upiAmount,
      customerEmail: customerEmail || '',
      customerPhone: customerPhone || '',
      state: STATE.CARD_PENDING,
      cardOrderId: cardOrder.id,
      cardPaymentId: null,
      cardAuthorizedAt: null,
      cardCapturedAt: null,
      cardCaptureStatus: 'not_started',
      cardCaptureError: null,
      authorizationReleaseExpectedAt: null,
      upiOrderId: null,
      upiPaymentId: null,
      refundFlagged: false,
      logs: [`Session created. Manual-capture card order ${cardOrder.id} initiated.`],
    });

    return res.json({
      sessionId,
      cardOrderId: cardOrder.id,
      cardAmount,
      upiAmount,
      orderTotal,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('[session/create] Error:', err);
    return safeJson(res, 500, { error: razorpayErrMsg(err) });
  }
});

// ─── 2. VERIFY CARD PAYMENT & TRIGGER UPI ─────────────────────────────────────
router.post('/payment/card/verify', async (req, res) => {
  // Trace every step so silent crashes surface in the server log
  console.log('[card/verify] ▶ received request');

  try {
    const {
      sessionId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body || {};

    // ── Step 1: field validation ──
    console.log('[card/verify] step 1 — validating fields', {
      sessionId,
      razorpay_order_id,
      razorpay_payment_id,
      has_signature: !!razorpay_signature,
    });

    if (!sessionId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        error: 'Missing required fields: sessionId, razorpay_order_id, razorpay_payment_id, razorpay_signature',
      });
    }

    // ── Step 2: load session ──
    console.log('[card/verify] step 2 — loading session', sessionId);
    const session = SessionStore.get(sessionId);
    if (!session) {
      console.error('[card/verify] session not found:', sessionId);
      return res.status(404).json({ error: 'Session not found' });
    }
    console.log('[card/verify] session state:', session.state);

    if (session.state === STATE.UPI_PENDING && session.cardPaymentId === razorpay_payment_id && session.upiOrderId) {
      console.log('[card/verify] duplicate verify received; returning existing UPI order');
      return res.json({
        success: true,
        message: 'Card payment already authorized. Proceed with UPI.',
        upiOrderId: session.upiOrderId,
        upiAmount: session.upiAmount,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      });
    }

    if (session.state !== STATE.CARD_PENDING) {
      console.error('[card/verify] wrong state:', session.state);
      return res.status(400).json({
        error: `Cannot verify card in state: ${session.state}`,
        state: session.state,
      });
    }

    // ── Step 3: HMAC signature check ──
    console.log('[card/verify] step 3 — verifying HMAC signature');
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      console.error('[card/verify] RAZORPAY_KEY_SECRET is not set');
      return res.status(500).json({ error: 'Payment gateway not configured — RAZORPAY_KEY_SECRET missing' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.error('[card/verify] signature mismatch');
      SessionStore.update(sessionId, {
        state: STATE.CARD_FAILED,
        logs: [...session.logs, 'Card payment signature mismatch. Cancelling session.'],
      });
      return res.status(400).json({ error: 'Invalid payment signature', state: STATE.CARD_FAILED });
    }
    console.log('[card/verify] step 3 — signature OK');

    // ── Step 4: mark card authorization ──
    console.log('[card/verify] step 4 — updating session to CARD_AUTHORIZED');
    const afterCard = SessionStore.update(sessionId, {
      state: STATE.CARD_AUTHORIZED,
      cardPaymentId: razorpay_payment_id,
      cardAuthorizedAt: new Date().toISOString(),
      cardCaptureStatus: 'authorized',
      logs: [...session.logs, `CARD_AUTHORIZED payment ${razorpay_payment_id} verified successfully.`],
    });
    console.log('[card/verify] step 4 — session updated', afterCard?.state);

    // ── Step 5: create UPI order ──
    console.log('[card/verify] step 5 — creating UPI order for amount:', session.upiAmount);
    const rzp = getRazorpay();

    let upiOrder;
    try {
      upiOrder = await rzp.orders.create({
        amount: Math.round(session.upiAmount * 100),
        currency: 'INR',
        receipt: `upi_${sessionId.slice(0, 8)}`,
        notes: { sessionId, leg: 'UPI' },
      });
    } catch (orderErr) {
      // UPI order creation failed — card was already charged.
      // Session stays CARD_SUCCESS so ops team / timeout worker can refund.
      const msg = razorpayErrMsg(orderErr);
      console.error('[card/verify] step 5 — Razorpay UPI order creation FAILED:', msg);
      try {
        console.error('[card/verify] raw error object:', JSON.stringify(orderErr, null, 2));
      } catch {
        console.error('[card/verify] raw error object could not be stringified');
      }
      leaveAuthorizationUncaptured(sessionId, `Failed to create UPI order: ${msg}`);
      return safeJson(res, 500, {
        error: `Failed to create UPI order: ${msg}`,
        hint: 'Card was authorized but not captured. Authorization has been left uncaptured.',
        sessionId,
      });
    }

    console.log('[card/verify] step 5 — UPI order created:', upiOrder.id);

    // ── Step 6: update session to UPI_PENDING ──
    console.log('[card/verify] step 6 — updating session to UPI_PENDING');
    SessionStore.update(sessionId, {
      state: STATE.UPI_PENDING,
      upiOrderId: upiOrder.id,
      logs: [
        ...(afterCard ? afterCard.logs : session.logs),
        `UPI_STARTED order ${upiOrder.id} created. Awaiting UPI payment.`,
      ],
    });
    console.log('[card/verify] step 6 — session updated to UPI_PENDING');

    // ── Step 7: respond ──
    console.log('[card/verify] step 7 — sending success response');
    return res.json({
      success: true,
      message: 'Card payment authorized. Proceed with UPI.',
      upiOrderId: upiOrder.id,
      upiAmount: session.upiAmount,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    });

  } catch (err) {
    const msg = razorpayErrMsg(err);
    console.error('[card/verify] ✗ UNHANDLED ERROR:', msg);
    console.error('[card/verify] stack:', err?.stack || String(err));
    return safeJson(res, 500, { error: msg });
  }
});

// ─── 3. VERIFY UPI PAYMENT & CONFIRM ORDER ────────────────────────────────────
router.post('/payment/upi/verify', async (req, res) => {
  console.log('[upi/verify] ▶ received request');
  try {
    const { sessionId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

    if (!sessionId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const session = SessionStore.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    console.log('[upi/verify] session state:', session.state);

    if (session.state !== STATE.UPI_PENDING) {
      return res.status(400).json({ error: `Invalid state for UPI verify: ${session.state}` });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) return res.status(500).json({ error: 'RAZORPAY_KEY_SECRET not set' });

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      const updated = leaveAuthorizationUncaptured(sessionId, `UPI signature mismatch for payment ${razorpay_payment_id}`);
      return res.status(400).json({
        error: 'UPI payment verification failed. Card authorization left uncaptured.',
        state: STATE.AUTH_RELEASE_PENDING,
        cardPaymentId: session.cardPaymentId,
        session: updated,
      });
    }

    const updatedSession = SessionStore.update(sessionId, {
      state: STATE.UPI_SUCCESS,
      upiPaymentId: razorpay_payment_id,
      logs: [...session.logs, `UPI_VERIFIED payment ${razorpay_payment_id}. Capturing authorized card payment.`],
    });

    let captureResult;
    try {
      captureResult = await captureAuthorizedCardPayment(sessionId, 'UPI_VERIFIED');
    } catch (captureErr) {
      const msg = razorpayErrMsg(captureErr);
      console.error('[upi/verify] CARD_CAPTURE_FAILED after UPI success:', msg);
      return safeJson(res, 500, {
        error: `UPI verified but card capture failed: ${msg}`,
        state: STATE.CARD_CAPTURE_FAILED,
        session: captureErr.session || SessionStore.get(sessionId),
      });
    }

    console.log('[upi/verify] ✓ ORDER COMPLETED', sessionId);
    return res.json({
      success: true,
      message: 'UPI verified and card captured. Order confirmed!',
      session: captureResult.session || updatedSession,
      state: STATE.COMPLETED,
    });
  } catch (err) {
    const msg = razorpayErrMsg(err);
    console.error('[upi/verify] ✗ UNHANDLED ERROR:', msg);
    return safeJson(res, 500, { error: msg });
  }
});

// ─── 4. CANCEL SESSION ────────────────────────────────────────────────────────
router.post('/session/:sessionId/cancel', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = SessionStore.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const hasCapturedCard = session.cardCaptureStatus === 'captured' || session.cardCapturedAt;
    const hasUncapturedAuthorization = session.cardPaymentId && !hasCapturedCard;

    if (hasUncapturedAuthorization) {
      const updated = leaveAuthorizationUncaptured(sessionId, 'Session cancelled before card capture');
      return res.json({ success: true, session: updated });
    }

    const needsRefund = session.state === STATE.CARD_SUCCESS || session.state === STATE.UPI_PENDING || hasCapturedCard;

    const updated = SessionStore.update(sessionId, {
      state: needsRefund ? STATE.REFUND_FLAGGED : STATE.CANCELLED,
      refundFlagged: needsRefund,
      logs: [
        ...session.logs,
        needsRefund
          ? `Session cancelled post card-success. Card payment ${session.cardPaymentId} flagged for refund.`
          : 'Session cancelled. No payments to refund.',
      ],
    });

    return res.json({ success: true, session: updated });
  } catch (err) {
    console.error('[cancel] Error:', err);
    return safeJson(res, 500, { error: razorpayErrMsg(err) });
  }
});

// ─── 5. GET SESSION STATUS ────────────────────────────────────────────────────
router.get('/session/:sessionId', (req, res) => {
  const session = SessionStore.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  return res.json(session);
});

// ─── 6. LIST ALL SESSIONS ────────────────────────────────────────────────────
router.get('/sessions', (req, res) => {
  const all = SessionStore.getAll();
  const sorted = Object.values(all).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  return res.json(sorted);
});

// ─── 7. TRIGGER MANUAL REFUND ─────────────────────────────────────────────────
router.post('/session/:sessionId/refund', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = SessionStore.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.cardPaymentId) return res.status(400).json({ error: 'No card payment to refund' });
    if (session.refundId) return res.status(400).json({ error: `Refund already initiated: ${session.refundId}` });

    const refund = await triggerRefund(
      sessionId,
      session.cardPaymentId,
      session.cardAmount,
      req.body?.reason || 'Manual refund via admin'
    );
    return res.json({ success: true, refund });
  } catch (err) {
    console.error('[refund] Error:', err);
    return safeJson(res, 500, { error: razorpayErrMsg(err) });
  }
});

// ─── 8. CHECK REFUND STATUS ───────────────────────────────────────────────────
router.get('/session/:sessionId/refund', async (req, res) => {
  try {
    const session = SessionStore.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.refundId) return res.status(404).json({ error: 'No refund on this session' });

    const refundStatus = await getRefundStatus(session.refundId);
    return res.json({ refundId: session.refundId, status: refundStatus });
  } catch (err) {
    return safeJson(res, 500, { error: razorpayErrMsg(err) });
  }
});

// ─── 9. STATS ────────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const all = Object.values(SessionStore.getAll());
  const stats = { total: all.length, byState: {}, totalRevenue: 0, totalCompleted: 0, totalRefundFlagged: 0 };
  for (const s of all) {
    stats.byState[s.state] = (stats.byState[s.state] || 0) + 1;
    if (s.state === 'COMPLETED') { stats.totalRevenue += s.orderTotal || 0; stats.totalCompleted++; }
    if (s.state === 'REFUND_FLAGGED') stats.totalRefundFlagged++;
  }
  return res.json(stats);
});

module.exports = router;
