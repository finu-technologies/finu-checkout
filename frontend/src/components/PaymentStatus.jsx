// components/PaymentStatus.jsx

import React from 'react';

const STEPS = [
  { id: 'session',  label: 'Session Created' },
  { id: 'card',     label: 'Card Payment'    },
  { id: 'upi',      label: 'UPI Payment'     },
  { id: 'confirm',  label: 'Order Confirmed' },
];

const STATE_MAP = {
  CREATED:        { active: 'session', done: [] },
  CARD_PENDING:   { active: 'card',    done: ['session'] },
  CARD_SUCCESS:   { active: 'upi',     done: ['session', 'card'] },
  UPI_PENDING:    { active: 'upi',     done: ['session', 'card'] },
  COMPLETED:      { active: null,      done: ['session', 'card', 'upi', 'confirm'] },
  CARD_FAILED:    { active: 'card',    done: ['session'],         failed: 'card' },
  UPI_FAILED:     { active: 'upi',     done: ['session', 'card'], failed: 'upi' },
  REFUND_FLAGGED: { active: null,      done: ['session', 'card'], failed: 'upi' },
  CANCELLED:      { active: null,      done: ['session'],         failed: 'session' },
};

const UPI_STATES = new Set(['CARD_SUCCESS', 'UPI_PENDING']);

function StepIcon({ status }) {
  if (status === 'done') return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
  if (status === 'failed') return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
  if (status === 'active') return <div className="pulse-dot" />;
  return null;
}

export default function PaymentStatus({ state, sessionId, error, onReset }) {
  const map        = STATE_MAP[state] || STATE_MAP.CREATED;
  const isComplete = state === 'COMPLETED';
  const isFailed   = state === 'CARD_FAILED' || state === 'UPI_FAILED' || state === 'CANCELLED';
  const isRefund   = state === 'REFUND_FLAGGED';
  const isUpiStep  = UPI_STATES.has(state);

  return (
    <div className="payment-status">

      {/* ── Status header ─────────────────────────────────────── */}
      <div className={`status-header ${isComplete ? 'success' : isFailed || isRefund ? 'failed' : 'processing'}`}>
        {isComplete && (
          <>
            <div className="status-icon success-icon">✓</div>
            <h3>Payment Successful</h3>
            <p>Both legs confirmed. Order is live.</p>
          </>
        )}
        {(isFailed || isRefund) && (
          <>
            <div className="status-icon failed-icon">✕</div>
            <h3>{isRefund ? 'Refund Initiated' : 'Payment Failed'}</h3>
            <p>{error || (isRefund ? 'Card amount will be refunded.' : 'Transaction could not be completed.')}</p>
          </>
        )}
        {!isComplete && !isFailed && !isRefund && (
          <>
            <div className="status-icon processing-icon">
              <div className="spinner" />
            </div>
            <h3>Processing Payment</h3>
            <p>Do not close or refresh this page.</p>
          </>
        )}
      </div>

      {/* ── UPI instruction banner (shown when UPI modal is open) ── */}
      {isUpiStep && (
        <div className="upi-banner">
          <div className="upi-banner-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div className="upi-banner-body">
            <div className="upi-banner-title">UPI Payment popup is open</div>
            <div className="upi-banner-sub">
              Select <strong>Netbanking</strong> in the Razorpay popup, then enter{' '}
              <code className="vpa-code">success@razorpay</code> as the Netbanking ID to simulate a successful payment.
            </div>
          </div>
        </div>
      )}

      {/* ── Progress steps ─────────────────────────────────────── */}
      <div className="steps">
        {STEPS.map((step, i) => {
          const isDone    = map.done.includes(step.id);
          const isActive  = map.active === step.id;
          const isFailed_ = map.failed === step.id;
          const status    = isFailed_ ? 'failed' : isDone ? 'done' : isActive ? 'active' : 'idle';

          return (
            <React.Fragment key={step.id}>
              <div className={`step step-${status}`}>
                <div className="step-circle">
                  <StepIcon status={status} />
                  {status === 'idle' && <span className="step-num">{i + 1}</span>}
                </div>
                <span className="step-label">{step.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`step-connector ${isDone ? 'done' : ''}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Session ID ─────────────────────────────────────────── */}
      {sessionId && (
        <div className="session-id">
          <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Session</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{sessionId}</span>
        </div>
      )}

      {/* ── Reset ──────────────────────────────────────────────── */}
      {(isComplete || isFailed || isRefund) && (
        <button className="reset-btn" onClick={onReset}>Start New Order</button>
      )}

      <style>{`
        .payment-status {
          background: var(--ink-90);
          border: 1px solid var(--ink-60);
          border-radius: var(--radius-lg);
          overflow: hidden;
        }

        /* Header */
        .status-header {
          padding: 28px;
          text-align: center;
          border-bottom: 1px solid var(--ink-60);
        }
        .status-header.success    { background: rgba(46,204,143,0.06); }
        .status-header.failed     { background: rgba(224,80,80,0.06); }
        .status-header.processing { background: rgba(201,168,76,0.04); }
        .status-icon {
          width: 52px; height: 52px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 14px;
          font-size: 22px;
        }
        .success-icon    { background: rgba(46,204,143,0.12); color: var(--emerald); border: 1px solid rgba(46,204,143,0.25); }
        .failed-icon     { background: rgba(224,80,80,0.12);  color: var(--crimson); border: 1px solid rgba(224,80,80,0.25); }
        .processing-icon { background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.2); }
        .spinner {
          width: 22px; height: 22px;
          border: 2px solid rgba(201,168,76,0.2);
          border-top-color: var(--gold);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .status-header h3 { font-size: 17px; color: var(--paper); margin-bottom: 4px; font-weight: 600; }
        .status-header p  { font-size: 13px; color: var(--muted); }

        /* UPI instruction banner */
        .upi-banner {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          margin: 0;
          padding: 16px 20px;
          background: rgba(74,144,217,0.07);
          border-bottom: 1px solid rgba(74,144,217,0.18);
        }
        .upi-banner-icon {
          color: #4A90D9;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .upi-banner-body { flex: 1; }
        .upi-banner-title {
          font-size: 12px;
          font-weight: 600;
          color: #4A90D9;
          margin-bottom: 4px;
        }
        .upi-banner-sub {
          font-size: 12px;
          color: var(--smoke);
          line-height: 1.5;
        }
        .upi-banner-sub strong { color: var(--paper); }
        .vpa-code {
          font-family: var(--font-mono);
          font-size: 11px;
          background: rgba(74,144,217,0.15);
          color: #7ab8f5;
          padding: 1px 6px;
          border-radius: 4px;
          border: 1px solid rgba(74,144,217,0.25);
          white-space: nowrap;
        }

        /* Steps */
        .steps {
          padding: 20px 28px;
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .step {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 0;
        }
        .step-circle {
          width: 28px; height: 28px;
          border-radius: 50%;
          border: 1.5px solid var(--ink-60);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          transition: all var(--transition);
        }
        .step-done .step-circle   { background: rgba(46,204,143,0.12); border-color: rgba(46,204,143,0.4); color: var(--emerald); }
        .step-active .step-circle { border-color: var(--gold); background: rgba(201,168,76,0.08); }
        .step-failed .step-circle { background: rgba(224,80,80,0.12); border-color: rgba(224,80,80,0.4); color: var(--crimson); }
        .step-num { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
        .step-label { font-size: 13px; color: var(--muted); transition: color var(--transition); }
        .step-done .step-label   { color: var(--smoke); }
        .step-active .step-label { color: var(--paper); font-weight: 500; }
        .step-failed .step-label { color: var(--crimson); }

        .step-connector {
          width: 1.5px; height: 20px;
          background: var(--ink-60);
          margin-left: 13px;
          transition: background var(--transition);
        }
        .step-connector.done { background: rgba(46,204,143,0.25); }

        .pulse-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: var(--gold);
          animation: pulse 1.2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(0.75); }
        }

        /* Session ID */
        .session-id {
          padding: 12px 28px;
          border-top: 1px solid var(--ink-80);
          display: flex;
          flex-direction: column;
          gap: 3px;
          background: var(--ink);
        }

        /* Reset */
        .reset-btn {
          display: block;
          width: calc(100% - 56px);
          margin: 20px 28px;
          padding: 12px;
          border-radius: var(--radius-sm);
          background: var(--ink-80);
          border: 1px solid var(--ink-60);
          color: var(--smoke);
          font-family: var(--font-body);
          font-size: 13px;
          cursor: pointer;
          transition: all var(--transition);
        }
        .reset-btn:hover { background: var(--ink-60); color: var(--paper); }
      `}</style>
    </div>
  );
}
