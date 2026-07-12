// utils/sessionTimeout.js — Background timeout worker
// Runs on a timer, checks for sessions stuck in pending states,
// marks them expired, and triggers refunds if card already succeeded.

const SessionStore = require('./sessionStore');
const { triggerRefund } = require('./refund');

// How long a session can stay in a PENDING state before we expire it (ms)
const TIMEOUTS = {
  CARD_PENDING: 15 * 60 * 1000,  // 15 min — Razorpay checkout window
  CARD_AUTHORIZED: 10 * 60 * 1000, // 10 min — card authorized but UPI not started/completed
  UPI_PENDING:  10 * 60 * 1000,  // 10 min — UPI has shorter timeout
  CREATED:       5 * 60 * 1000,  //  5 min — should move to CARD_PENDING fast
};

// States that are already terminal — skip them
const TERMINAL_STATES = new Set([
  'COMPLETED', 'CARD_FAILED', 'UPI_FAILED', 'CANCELLED', 'REFUND_FLAGGED',
  'AUTH_RELEASE_PENDING', 'CARD_CAPTURE_FAILED',
]);

async function runTimeoutSweep() {
  const all = SessionStore.getAll();
  const now = Date.now();

  for (const [sessionId, session] of Object.entries(all)) {
    if (TERMINAL_STATES.has(session.state)) continue;

    const timeout = TIMEOUTS[session.state];
    if (!timeout) continue;

    const updatedAt = new Date(session.updatedAt).getTime();
    const age = now - updatedAt;

    if (age < timeout) continue;

    const ageMin = Math.round(age / 60000);
    console.log(`[timeout] Session ${sessionId} — state: ${session.state} — age: ${ageMin}m — EXPIRING`);

    if ((session.state === 'UPI_PENDING' || session.state === 'CARD_AUTHORIZED') && session.cardPaymentId && !session.cardCapturedAt) {
      // Card is only authorized. Do not capture and do not refund; Razorpay releases
      // uncaptured authorizations after the configured/manual capture expiry window.
      console.log(`[timeout] ${session.state} timeout with uncaptured authorization — leaving authorization uncaptured`);
      SessionStore.update(sessionId, {
        state: 'AUTH_RELEASE_PENDING',
        cardCaptureStatus: 'left_uncaptured',
        logs: [
          ...session.logs,
          `AUTHORIZATION_LEFT_UNCAPTURED payment ${session.cardPaymentId}: ${session.state} timed out after ${ageMin} minutes`,
        ],
      });
    } else if (session.state === 'UPI_PENDING' && session.cardPaymentId && session.cardCapturedAt) {
      // Legacy safety path for sessions created before manual capture rollout.
      console.log(`[timeout] UPI timeout with captured card — triggering refund`);
      try {
        await triggerRefund(sessionId, session.cardPaymentId, session.cardAmount, `UPI timed out after ${ageMin} minutes`);
      } catch (err) {
        console.error(`[timeout] Refund failed for ${sessionId}:`, err.message);
        SessionStore.update(sessionId, {
          state: 'REFUND_FLAGGED',
          logs: [...session.logs, `[timeout] UPI expired after ${ageMin}m — refund initiation FAILED — manual review needed`],
        });
      }
    } else {
      // No money moved yet — just cancel cleanly
      SessionStore.update(sessionId, {
        state: 'CANCELLED',
        logs: [...session.logs, `[timeout] Session expired in state ${session.state} after ${ageMin} minutes`],
      });
    }
  }
}

/**
 * Start the background timeout sweeper.
 * @param {number} intervalMs - How often to sweep (default: 60s)
 */
function startTimeoutWorker(intervalMs = 60 * 1000) {
  console.log(`[timeout] Worker started — sweeping every ${intervalMs / 1000}s`);
  setInterval(async () => {
    try {
      await runTimeoutSweep();
    } catch (err) {
      console.error('[timeout] Sweep error:', err.message);
    }
  }, intervalMs);

  // Also run once immediately on startup
  runTimeoutSweep().catch(console.error);
}

module.exports = { startTimeoutWorker, runTimeoutSweep };
