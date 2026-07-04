// App.jsx — FinU Split Payment Checkout

import React, { useState, useCallback } from 'react';
import OrderSummary from './components/OrderSummary.jsx';
import SplitSlider from './components/SplitSlider.jsx';
import PaymentStatus from './components/PaymentStatus.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';
import { api } from './utils/api.js';
import { useRazorpay } from './hooks/useRazorpay.js';

// ─── Read URL params ──────────────────────────────────────────────────────────
const urlParams       = new URLSearchParams(window.location.search);
const URL_AMOUNT      = urlParams.get('amount')        ? Number(urlParams.get('amount'))                        : null;
const URL_MERCHANT    = urlParams.get('merchant_name') ? decodeURIComponent(urlParams.get('merchant_name'))     : null;
const URL_PRODUCT     = urlParams.get('product')       ? decodeURIComponent(urlParams.get('product'))           : null;
const URL_ORDER_ID    = urlParams.get('order_id')      || null;
const URL_MERCHANT_ID = urlParams.get('merchant_id')   || 'demo';
const URL_RETURN      = urlParams.get('return_url')    || null;

// If all key params present — skip demo form, go straight to checkout
const HAS_PARAMS = URL_AMOUNT && URL_MERCHANT && URL_PRODUCT;
// ─────────────────────────────────────────────────────────────────────────────

const PHASE = {
  DEMO:       'DEMO',
  CONFIGURE:  'CONFIGURE',
  PROCESSING: 'PROCESSING',
  DONE:       'DONE',
};

function generateOrderId() {
  return 'ORD' + Date.now().toString().slice(-6);
}

export default function App() {
  const [demoMerchant, setDemoMerchant] = useState('');
  const [demoProduct,  setDemoProduct]  = useState('');
  const [demoAmount,   setDemoAmount]   = useState('');
  const [demoError,    setDemoError]    = useState('');

  const [orderTotal,   setOrderTotal]   = useState(HAS_PARAMS ? URL_AMOUNT   : null);
  const [merchantName, setMerchantName] = useState(HAS_PARAMS ? URL_MERCHANT : null);
  const [productName,  setProductName]  = useState(HAS_PARAMS ? URL_PRODUCT  : null);
  const [orderId,      setOrderId]      = useState(HAS_PARAMS ? (URL_ORDER_ID || generateOrderId()) : null);
  const [merchantId]                    = useState(URL_MERCHANT_ID);
  const [returnUrl]                     = useState(URL_RETURN);

  const [phase,      setPhase]      = useState(HAS_PARAMS ? PHASE.CONFIGURE : PHASE.DEMO);
  const [cardAmount, setCardAmount] = useState(HAS_PARAMS ? Math.round(URL_AMOUNT * 0.67) : 0);
  const [sessionId,  setSessionId]  = useState(null);
  const [payState,   setPayState]   = useState('CREATED');
  const [error,      setError]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [showAdmin,  setShowAdmin]  = useState(false);

  const { openCheckout } = useRazorpay();
  const upiAmount = orderTotal ? orderTotal - cardAmount : 0;

  // ─── DEMO LAUNCH ─────────────────────────────────────────────────────────
  const handleDemoLaunch = useCallback(() => {
    setDemoError('');
    if (!demoMerchant.trim()) { setDemoError('Please enter a merchant name.'); return; }
    if (!demoProduct.trim())  { setDemoError('Please enter a product name.');  return; }
    const amt = Number(demoAmount);
    if (!demoAmount || isNaN(amt) || amt < 100) { setDemoError('Please enter a valid amount (minimum ₹100).'); return; }
    const newOrderId = generateOrderId();
    setOrderTotal(amt);
    setMerchantName(demoMerchant.trim());
    setProductName(demoProduct.trim());
    setOrderId(newOrderId);
    setCardAmount(Math.round(amt * 0.67));
    setPhase(PHASE.CONFIGURE);
  }, [demoMerchant, demoProduct, demoAmount]);

  // ─── PAYMENT FLOW ────────────────────────────────────────────────────────
  const handleProceed = useCallback(async () => {
    if (cardAmount <= 0 || upiAmount <= 0) { alert('Both card and UPI amounts must be greater than ₹0.'); return; }
    setLoading(true);
    setError('');
    try {
      const session = await api.createSession({ orderTotal, cardAmount, upiAmount, customerEmail: 'demo@finu.in', customerPhone: '9000000000' });
      setSessionId(session.sessionId);
      setPhase(PHASE.PROCESSING);
      setPayState('CARD_PENDING');

      let cardResponse;
      try {
        cardResponse = await openCheckout({
          key: session.razorpayKeyId, order_id: session.cardOrderId, amount: Math.round(cardAmount * 100),
          currency: 'INR', name: merchantName || 'FinU Technologies',
          description: `Step 1 of 2 — Card payment ₹${cardAmount.toLocaleString('en-IN')}`,
          image: '', prefill: { email: 'demo@finu.in', contact: '9000000000' },
          theme: { color: '#C9A84C' },
          notes: { leg: 'CARD', sessionId: session.sessionId, merchant_id: merchantId, order_ref: orderId },
        });
      } catch (cardErr) {
        await api.cancelSession(session.sessionId);
        setPayState('CARD_FAILED'); setError(cardErr.message || 'Card payment was not completed.');
        setPhase(PHASE.DONE); setLoading(false); return;
      }

      let upiSession;
      try {
        upiSession = await api.verifyCard({
          sessionId: session.sessionId, razorpay_order_id: cardResponse.razorpay_order_id,
          razorpay_payment_id: cardResponse.razorpay_payment_id, razorpay_signature: cardResponse.razorpay_signature,
        });
        setPayState('UPI_PENDING');
      } catch (verifyErr) {
        setPayState('CARD_FAILED'); setError(verifyErr.message || 'Card verification failed.');
        setPhase(PHASE.DONE); setLoading(false); return;
      }

      let upiResponse;
      try {
        upiResponse = await openCheckout({
          key: upiSession.razorpayKeyId, order_id: upiSession.upiOrderId, amount: Math.round(upiAmount * 100),
          currency: 'INR', name: 'FinU Technologies — Step 2 of 2',
          description: `UPI payment ₹${upiAmount.toLocaleString('en-IN')} — almost done!`,
          prefill: { email: 'demo@finu.in', contact: '9000000000' },
          theme: { color: '#4A90D9' },
          notes: { leg: 'UPI', sessionId: session.sessionId, merchant_id: merchantId, order_ref: orderId },
          method: { upi: true, card: false, netbanking: false, wallet: false, emi: false },
        }, true);
      } catch (upiErr) {
        await api.cancelSession(session.sessionId);
        setPayState('REFUND_FLAGGED');
        setError(`UPI payment was not completed. Your card payment of ₹${cardAmount.toLocaleString('en-IN')} has been flagged for refund. We will process it within 24 hours.`);
        setPhase(PHASE.DONE); setLoading(false); return;
      }

      try {
        await api.verifyUpi({
          sessionId: session.sessionId, razorpay_order_id: upiResponse.razorpay_order_id,
          razorpay_payment_id: upiResponse.razorpay_payment_id, razorpay_signature: upiResponse.razorpay_signature,
        });
        setPayState('COMPLETED'); setPhase(PHASE.DONE);
        if (returnUrl) { setTimeout(() => { window.location.href = `${returnUrl}?status=success&order_id=${orderId}&merchant_id=${merchantId}`; }, 2000); }
      } catch (upiVerifyErr) {
        setPayState('REFUND_FLAGGED');
        setError('UPI verification failed. Your card payment has been flagged for refund within 24 hours.');
        setPhase(PHASE.DONE);
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
      setPayState('CANCELLED'); setPhase(PHASE.DONE);
    }
    setLoading(false);
  }, [cardAmount, upiAmount, orderTotal, merchantName, merchantId, orderId, returnUrl, openCheckout]);

  const handleReset = () => {
    if (HAS_PARAMS) { setPhase(PHASE.CONFIGURE); setCardAmount(Math.round(URL_AMOUNT * 0.67)); }
    else { setPhase(PHASE.DEMO); setDemoMerchant(''); setDemoProduct(''); setDemoAmount(''); setDemoError(''); setOrderTotal(null); }
    setSessionId(null); setPayState('CREATED'); setError(''); setLoading(false);
  };

  return (
    <div className="app">
      {showAdmin && <AdminDashboard onBack={() => setShowAdmin(false)} />}
      {!showAdmin && (<>
      <header className="header">
        <div className="logo">
          <span className="logo-mark">ƒ</span>
          <span className="logo-text">FinU</span>
        </div>
        <div className="header-badge"><span className="badge-dot" />Live Mode</div>
        <button className="admin-nav-btn" onClick={() => setShowAdmin(true)}>Sessions ↗</button>
      </header>

      <div className="hero">
        <div className="hero-label">Split Tender Payment</div>
        <h1 className="hero-title">Pay your way,<br /><em>split across instruments</em></h1>
      </div>

      <main className="main-grid">
        <aside className="col-summary">
          {phase === PHASE.DEMO ? (
            <div className="order-summary">
              <div className="summary-header">
                <span className="summary-tag">Demo Configuration</span>
                <h2 className="summary-title">Configure Order</h2>
              </div>
              <div className="demo-form">
                <div className="demo-field">
                  <label className="demo-label">Merchant Name</label>
                  <input className="demo-input" type="text" placeholder="e.g. Hotspot India"
                    value={demoMerchant} onChange={e => setDemoMerchant(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleDemoLaunch()} />
                </div>
                <div className="demo-field">
                  <label className="demo-label">Product / Service</label>
                  <input className="demo-input" type="text" placeholder="e.g. Industrial Equipment"
                    value={demoProduct} onChange={e => setDemoProduct(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleDemoLaunch()} />
                </div>
                <div className="demo-field">
                  <label className="demo-label">Order Amount (₹)</label>
                  <input className="demo-input" type="number" placeholder="e.g. 25000" min="100"
                    value={demoAmount} onChange={e => setDemoAmount(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleDemoLaunch()} />
                </div>
                {demoError && <div className="demo-error">{demoError}</div>}
                <button className="demo-launch-btn" onClick={handleDemoLaunch}>Launch Checkout →</button>
              </div>
              <div className="summary-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>Secured by FinU Technologies</span>
              </div>
            </div>
          ) : (
            <OrderSummary total={orderTotal} merchantName={merchantName} productName={productName} orderId={orderId} />
          )}
        </aside>

        <div className="col-checkout">
          {phase === PHASE.DEMO && (
            <div className="checkout-card demo-placeholder">
              <div className="placeholder-content">
                <div className="placeholder-icon">⬡</div>
                <p className="placeholder-text">Fill in the order details on the left and click <strong>Launch Checkout</strong> to begin.</p>
              </div>
            </div>
          )}

          {phase === PHASE.CONFIGURE && (
            <div className="checkout-card">
              <div className="checkout-header">
                <h2 className="checkout-title">Configure Split</h2>
                <p className="checkout-sub">Total <strong>₹{orderTotal?.toLocaleString('en-IN')}</strong> — drag the slider or type your card amount.</p>
              </div>
              <div className="checkout-body">
                <SplitSlider total={orderTotal} cardAmount={cardAmount} onChange={setCardAmount} />
                <div className="split-summary">
                  <div className="summary-row"><span className="row-label">Card</span><span className="row-amount card-amount">₹{cardAmount.toLocaleString('en-IN')}</span></div>
                  <div className="summary-row"><span className="row-label">UPI</span><span className="row-amount upi-amount">₹{upiAmount.toLocaleString('en-IN')}</span></div>
                  <div className="summary-divider" />
                  <div className="summary-row total-row"><span className="row-label">Total</span><span className="row-amount total-amount-row">₹{orderTotal?.toLocaleString('en-IN')}</span></div>
                </div>
                <div className="flow-info">
                  <div className="flow-step"><div className="flow-num">1</div><span>Card charges first (₹{cardAmount.toLocaleString('en-IN')})</span></div>
                  <div className="flow-arrow">→</div>
                  <div className="flow-step"><div className="flow-num">2</div><span>UPI only on card success (₹{upiAmount.toLocaleString('en-IN')})</span></div>
                  <div className="flow-arrow">→</div>
                  <div className="flow-step"><div className="flow-num">3</div><span>Order confirmed on both</span></div>
                </div>
                <button className="proceed-btn" onClick={handleProceed} disabled={loading || cardAmount <= 0 || upiAmount <= 0}>
                  {loading ? (<><div className="btn-spinner" />Processing…</>) : (<>Proceed to Pay — ₹{orderTotal?.toLocaleString('en-IN')}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></>)}
                </button>
              </div>
            </div>
          )}

          {(phase === PHASE.PROCESSING || phase === PHASE.DONE) && (
            <PaymentStatus state={payState} sessionId={sessionId} error={error} onReset={handleReset} />
          )}
        </div>
      </main>

      <style>{`
        .app { min-height: 100vh; max-width: 1100px; margin: 0 auto; padding: 0 24px 60px; }
        .header { display: flex; align-items: center; justify-content: space-between; padding: 24px 0; border-bottom: 1px solid var(--ink-80); margin-bottom: 40px; }
        .logo { display: flex; align-items: baseline; gap: 6px; }
        .logo-mark { font-family: var(--font-display); font-size: 28px; color: var(--gold); line-height: 1; }
        .logo-text { font-family: var(--font-display); font-size: 20px; color: var(--paper); letter-spacing: -0.02em; }
        .header-badge { display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; color: var(--emerald); background: rgba(46,204,143,0.08); border: 1px solid rgba(46,204,143,0.2); padding: 5px 10px; border-radius: 20px; letter-spacing: 0.04em; }
        .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--emerald); animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .hero { margin-bottom: 40px; }
        .hero-label { font-family: var(--font-mono); font-size: 11px; color: var(--gold); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 10px; }
        .hero-title { font-family: var(--font-display); font-size: clamp(28px, 4vw, 40px); color: var(--paper); font-weight: 400; line-height: 1.2; }
        .hero-title em { color: var(--gold); font-style: italic; }
        .main-grid { display: grid; grid-template-columns: 380px 1fr; gap: 28px; align-items: start; }
        @media (max-width: 820px) { .main-grid { grid-template-columns: 1fr; } .col-summary { order: 2; } .col-checkout { order: 1; } }
        .order-summary { background: var(--ink-90); border: 1px solid var(--ink-60); border-radius: var(--radius-lg); padding: 28px; position: sticky; top: 24px; }
        .summary-header { margin-bottom: 20px; }
        .summary-tag { font-family: var(--font-mono); font-size: 11px; color: var(--gold); letter-spacing: 0.08em; text-transform: uppercase; }
        .summary-title { font-family: var(--font-display); font-size: 22px; color: var(--paper); margin-top: 4px; font-weight: 400; }
        .summary-badge { display: flex; align-items: center; gap: 6px; margin-top: 20px; padding: 10px 14px; background: rgba(201,168,76,0.06); border: 1px solid rgba(201,168,76,0.15); border-radius: var(--radius-sm); font-size: 11px; color: var(--gold-dk); }
        .demo-form { display: flex; flex-direction: column; gap: 18px; margin-bottom: 20px; }
        .demo-field { display: flex; flex-direction: column; gap: 6px; }
        .demo-label { font-family: var(--font-mono); font-size: 10px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }
        .demo-input { background: var(--ink-80); border: 1px solid var(--ink-60); border-radius: var(--radius-sm); padding: 10px 14px; color: var(--paper); font-family: var(--font-body); font-size: 14px; outline: none; transition: border-color 0.2s; width: 100%; box-sizing: border-box; }
        .demo-input::placeholder { color: var(--muted); }
        .demo-input:focus { border-color: var(--gold); }
        .demo-input[type="number"]::-webkit-inner-spin-button { opacity: 0.3; }
        .demo-error { font-size: 12px; color: #ff6b6b; padding: 8px 12px; background: rgba(255,107,107,0.08); border: 1px solid rgba(255,107,107,0.2); border-radius: var(--radius-sm); }
        .demo-launch-btn { width: 100%; padding: 14px 20px; background: linear-gradient(135deg, var(--gold-dk), var(--gold)); border: none; border-radius: var(--radius-md); color: var(--ink); font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; margin-top: 4px; }
        .demo-launch-btn:hover { opacity: 0.9; }
        .demo-placeholder { display: flex !important; align-items: center; justify-content: center; min-height: 300px; border: 1px dashed var(--ink-60) !important; background: transparent !important; }
        .placeholder-content { text-align: center; padding: 40px; }
        .placeholder-icon { font-size: 32px; color: var(--muted); margin-bottom: 16px; opacity: 0.4; }
        .placeholder-text { font-size: 13px; color: var(--muted); line-height: 1.6; max-width: 220px; margin: 0 auto; }
        .placeholder-text strong { color: var(--smoke); }
        .checkout-card { background: var(--ink-90); border: 1px solid var(--ink-60); border-radius: var(--radius-lg); overflow: hidden; }
        .checkout-header { padding: 28px 28px 20px; border-bottom: 1px solid var(--ink-80); }
        .checkout-title { font-family: var(--font-display); font-size: 22px; color: var(--paper); font-weight: 400; margin-bottom: 6px; }
        .checkout-sub { font-size: 13px; color: var(--muted); }
        .checkout-sub strong { color: var(--smoke); }
        .checkout-body { padding: 24px 28px 28px; display: flex; flex-direction: column; gap: 24px; }
        .split-summary { background: var(--ink-80); border: 1px solid var(--ink-60); border-radius: var(--radius-md); padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; }
        .summary-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
        .row-label { color: var(--muted); }
        .row-amount { font-family: var(--font-mono); font-size: 14px; font-weight: 500; }
        .card-amount { color: var(--gold-lt); }
        .upi-amount { color: var(--sapphire); }
        .summary-divider { height: 1px; background: var(--ink-60); }
        .total-row .row-label { color: var(--smoke); font-weight: 500; }
        .total-amount-row { color: var(--paper); font-size: 16px; }
        .flow-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .flow-step { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
        .flow-num { width: 20px; height: 20px; border-radius: 50%; background: var(--ink-80); border: 1px solid var(--ink-60); display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 10px; color: var(--gold); flex-shrink: 0; }
        .flow-arrow { color: var(--ink-60); font-size: 12px; }
        .proceed-btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 16px 24px; background: linear-gradient(135deg, var(--gold-dk), var(--gold)); border: none; border-radius: var(--radius-md); color: var(--ink); font-family: var(--font-body); font-size: 15px; font-weight: 600; cursor: pointer; transition: all var(--transition); position: relative; overflow: hidden; }
        .proceed-btn::before { content: ''; position: absolute; inset: 0; background: rgba(255,255,255,0.1); opacity: 0; transition: opacity var(--transition); }
        .proceed-btn:hover::before { opacity: 1; }
        .proceed-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-spinner { width: 16px; height: 16px; border: 2px solid rgba(0,0,0,0.2); border-top-color: var(--ink); border-radius: 50%; animation: spin 0.7s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .admin-nav-btn { padding: 7px 14px; background: transparent; border: 1px solid var(--ink-60); border-radius: var(--radius-sm); color: var(--muted); font-family: var(--font-mono); font-size: 11px; cursor: pointer; transition: all var(--transition); }
        .admin-nav-btn:hover { border-color: var(--gold); color: var(--gold); }
      `}</style>
    </>)}
  </div>
  );
}
