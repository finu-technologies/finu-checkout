// utils/refund.js — Razorpay Refund Orchestration

const Razorpay = require('razorpay');
const SessionStore = require('./sessionStore');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Trigger a full refund of the card leg for a given session.
 * Called when: UPI fails after card succeeds, or operator manually cancels.
 *
 * @param {string} sessionId
 * @param {string} paymentId   - Razorpay payment ID of the card leg
 * @param {number} amount      - Original amount in ₹ (will convert to paise)
 * @param {string} reason      - Internal reason string for logs
 */
async function triggerRefund(sessionId, paymentId, amount, reason = 'UPI leg failed') {
  const session = SessionStore.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  // Prevent duplicate refund attempts
  if (session.refundId) {
    console.log(`[refund] Already refunded: ${session.refundId}`);
    return { alreadyRefunded: true, refundId: session.refundId };
  }

  const amountPaise = Math.round(amount * 100);

  console.log(`[refund] Initiating refund of ₹${amount} for payment ${paymentId} | reason: ${reason}`);

  try {
    const refund = await razorpay.payments.refund(paymentId, {
      amount: amountPaise,
      speed: 'normal',   // 'normal' (5-7 days) or 'optimum' (instant if eligible)
      notes: {
        sessionId,
        reason,
      },
      receipt: `refund_${sessionId.slice(0, 8)}`,
    });

    SessionStore.update(sessionId, {
      state: 'REFUND_FLAGGED',  // Will flip to CANCELLED on webhook confirmation
      refundId: refund.id,
      refundStatus: refund.status,
      refundFlagged: true,
      logs: [
        ...SessionStore.get(sessionId).logs,
        `[refund] Refund ${refund.id} initiated — status: ${refund.status} — amount: ₹${amount}`,
      ],
    });

    console.log(`[refund] Refund ${refund.id} created — status: ${refund.status}`);
    return refund;
  } catch (err) {
    // Refund API failed — keep it flagged for manual ops review
    const errMsg = err.error?.description || err.message || 'Unknown refund error';
    SessionStore.update(sessionId, {
      refundError: errMsg,
      logs: [
        ...SessionStore.get(sessionId).logs,
        `[refund] FAILED to create refund: ${errMsg} — manual intervention required`,
      ],
    });
    console.error(`[refund] Razorpay refund API error:`, errMsg);
    throw err;
  }
}

/**
 * Fetch current refund status from Razorpay (for polling / admin dashboard).
 */
async function getRefundStatus(refundId) {
  try {
    return await razorpay.refunds.fetch(refundId);
  } catch (err) {
    console.error(`[refund] Could not fetch refund ${refundId}:`, err.message);
    return null;
  }
}

module.exports = { triggerRefund, getRefundStatus };
