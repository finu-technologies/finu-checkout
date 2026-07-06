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

function formatMerchantName(name) {
  return (name || '').replace(/\b\w/g, char => char.toUpperCase());
}

function formatProductName(name) {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

function formatDemoAmount(value) {
  return value ? Number(value).toLocaleString('en-IN') : '';
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
  const displayMerchantName = formatMerchantName(merchantName);
  const displayProductName = formatProductName(productName);

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

  const handleBackToDemo = () => {
    if (!HAS_PARAMS) {
      setPhase(PHASE.DEMO);
      setDemoError('');
      setError('');
      setLoading(false);
    }
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
      </header>

      <div className="hero">
        <div className="hero-label">Split Tender Payment</div>
        <h1 className="hero-title">The Missing Layer<br /><em>in Online Checkout</em></h1>
      </div>

      <main className="main-grid">
        <aside className="col-summary">
          {phase === PHASE.DEMO ? (
            <div className="order-summary demo-config-card">
              <div className="summary-header">
                <h2 className="summary-title">Configure Order</h2>
              </div>
              <div className="demo-form">
                <div className="demo-field">
                  <label className="demo-label">Merchant Name</label>
                  <div className="demo-input-shell">
                    <span className="demo-input-icon">▦</span>
                    <input className="demo-input with-icon" type="text" placeholder="e.g. Croma, Reliance Digital"
                      value={demoMerchant} onChange={e => setDemoMerchant(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleDemoLaunch()} />
                    {demoMerchant.trim() && <span className="demo-input-check">✓</span>}
                  </div>
                </div>
                <div className="demo-field">
                  <label className="demo-label">Product / Service</label>
                  <div className="demo-input-shell">
                    <span className="demo-input-icon">⬡</span>
                    <input className="demo-input with-icon" type="text" placeholder="e.g. Apple iPhone 17 Pro (128 GB)"
                      value={demoProduct} onChange={e => setDemoProduct(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleDemoLaunch()} />
                    {demoProduct.trim() && <span className="demo-input-check">✓</span>}
                  </div>
                </div>
                <div className="demo-field">
                  <label className="demo-label">Order Amount (₹)</label>
                  <div className="demo-input-shell">
                    <span className="demo-input-icon rupee">₹</span>
                    <input className="demo-input with-icon" type="text" inputMode="numeric" placeholder="e.g. ₹1,20,000"
                      value={formatDemoAmount(demoAmount)} onChange={e => setDemoAmount(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={e => e.key === 'Enter' && handleDemoLaunch()} />
                  </div>
                </div>
                {demoError && <div className="demo-error">{demoError}</div>}
                <button className="demo-launch-btn" onClick={handleDemoLaunch}>Launch Checkout →</button>
              </div>
              <div className="summary-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>Secured by FinU Technologies</span>
              </div>
              <div className="integration-disclosure">
                <input className="integration-toggle" type="checkbox" id="integration-flow-toggle" />
                <label className="integration-trigger" htmlFor="integration-flow-toggle">
                  <span className="integration-caret">▾</span>
                  <span>See Integration Flow</span>
                </label>
                <div className="integration-panel">
                  <div className="integration-panel-inner">
                    <div className="flow-diagram">
                      <div className="diagram-node">Merchant Website</div>
                      <div className="diagram-line" />
                      <div className="diagram-node">Existing Checkout</div>
                      <div className="diagram-line" />
                      <div className="diagram-node diagram-finu">
                        <strong>FinU</strong>
                        <span>The Missing Layer</span>
                        <span>Payment Orchestration</span>
                      </div>
                      <div className="diagram-line" />
                      <div className="diagram-node">
                        Existing Payment Gateway
                        <small>(Razorpay, PayU, Cashfree & others)</small>
                      </div>
                      <div className="diagram-line" />
                      <div className="diagram-node diagram-final">Cards • UPI • Net Banking</div>
                    </div>
                    <div className="integration-points">
                      <div>Integrates into your existing payment stack</div>
                      <div>No checkout replacement required</div>
                      <div>Sequential split payments & intelligent transaction orchestration</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <OrderSummary total={orderTotal} merchantName={displayMerchantName} productName={displayProductName} orderId={orderId} />
          )}
        </aside>

        <div className="col-checkout">
          {phase === PHASE.DEMO && (
            <div className="checkout-card demo-showcase">
              <div className="demo-showcase-bg" aria-hidden="true">
                <div className="bg-order">
                  <div className="bg-line short" />
                  <div className="bg-line medium" />
                  <div className="bg-line" />
                  <div className="bg-price" />
                  <div className="bg-badge" />
                </div>
                <div className="bg-checkout">
                  <div className="bg-line medium" />
                  <div className="bg-bar"><span /><i /></div>
                  <div className="bg-methods"><span /><span /></div>
                  <div className="bg-total" />
                  <div className="bg-button" />
                </div>
              </div>
              <div className="demo-showcase-overlay" />
              <div className="demo-showcase-content">
                <h2 className="showcase-title">One Purchase.<br /><em>Multiple Payment Methods.</em></h2>
                <div className="journey-row">
                  <div className="journey-step">
                    <div className="journey-icon">💳</div>
                    <h3>Pay by Card</h3>
                    <p>Choose amount to pay via Card.</p>
                  </div>
                  <div className="journey-line" />
                  <div className="journey-step">
                    <div className="journey-icon">📱</div>
                    <h3>Pay by UPI</h3>
                    <p>Pay the remaining amount via UPI.</p>
                  </div>
                  <div className="journey-line" />
                  <div className="journey-step">
                    <div className="journey-icon confirmed">✓</div>
                    <h3>Order Confirmed</h3>
                    <p>Payments sequentially processed and order confirmed.</p>
                  </div>
                </div>
                <div className="secure-note">🛡 Secure, sequential and linked to a single order.</div>
                <div className="live-example">See the live example in the next step</div>
              </div>
            </div>
          )}

          {phase === PHASE.CONFIGURE && (
            <div className="checkout-card">
              <div className="checkout-header">
                <h2 className="checkout-title">Configure Split</h2>
                <p className="checkout-sub">Choose Card amount. The remaining will be paid via UPI.</p>
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
                  <div className="flow-step"><div className="flow-num">1</div><span>Card payment authorized</span></div>
                  <div className="flow-step"><div className="flow-num">2</div><span>Remaining amount paid via UPI</span></div>
                  <div className="flow-step"><div className="flow-num">3</div><span>Order confirmed</span></div>
                </div>
                <button className="proceed-btn" onClick={handleProceed} disabled={loading || cardAmount <= 0 || upiAmount <= 0}>
                  {loading ? (<><div className="btn-spinner" />Processing…</>) : (<>Proceed to Pay — ₹{orderTotal?.toLocaleString('en-IN')}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></>)}
                </button>
                {!HAS_PARAMS && (
                  <button className="back-btn" onClick={handleBackToDemo} type="button">← Back</button>
                )}
              </div>
            </div>
          )}

          {(phase === PHASE.PROCESSING || phase === PHASE.DONE) && (
            <PaymentStatus state={payState} sessionId={sessionId} error={error} onReset={handleReset} />
          )}
        </div>
      </main>

      {phase === PHASE.DEMO && (
        <section className="trust-badges" aria-label="FinU platform highlights">
          <div className="trust-badge">
            <div className="trust-icon">🔒</div>
            <div><h3>Safe Transactions</h3><p>Payments via RBI-regulated infrastructure</p></div>
          </div>
          <div className="trust-badge">
            <div className="trust-icon">⚡</div>
            <div><h3>Sequential Processing</h3><p>Card first, UPI second, one confirmation</p></div>
          </div>
          <div className="trust-badge">
            <div className="trust-icon">🇮🇳</div>
            <div><h3>Built for India</h3><p>Indian payment ecosystem</p></div>
          </div>
          <div className="trust-badge">
            <div className="trust-icon">⬡</div>
            <div><h3>Orchestration Layer</h3><p>Works with your existing payment gateway.</p></div>
          </div>
        </section>
      )}

      <style>{`
        .app { min-height: 100vh; max-width: 1100px; margin: 0 auto; padding: 0 24px 60px; }
        .header { display: flex; align-items: center; justify-content: space-between; padding: 24px 0; border-bottom: 1px solid var(--ink-80); margin-bottom: 40px; }
        .logo { display: flex; align-items: baseline; gap: 6px; }
        .logo-mark { font-family: var(--font-display); font-size: 28px; color: var(--gold); line-height: 1; }
        .logo-text { font-family: var(--font-display); font-size: 20px; color: var(--paper); letter-spacing: -0.02em; }
        .hero { margin-bottom: 20px; }
        .hero-label { font-family: var(--font-mono); font-size: 11px; color: var(--gold); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 10px; }
        .hero-title { font-family: var(--font-display); font-size: clamp(28px, 4vw, 40px); color: var(--paper); font-weight: 400; line-height: 1.2; }
        .hero-title em { color: var(--gold); font-style: italic; }
        .main-grid { display: grid; grid-template-columns: 380px 1fr; gap: 28px; align-items: stretch; }
        @media (max-width: 820px) { .main-grid { grid-template-columns: 1fr; } .col-summary { order: 2; } .col-checkout { order: 1; } }
        .order-summary { background: var(--ink-90); border: 1px solid var(--ink-60); border-radius: var(--radius-lg); padding: 28px; position: sticky; top: 24px; box-shadow: 0 18px 55px rgba(0,0,0,0.18); }
        .demo-config-card { transform: translateY(-18px); }
        .col-summary, .col-checkout { display: flex; align-items: stretch; }
        .col-summary .order-summary, .col-checkout .demo-showcase { width: 100%; min-height: 436px; }
        .summary-header { margin-bottom: 20px; }
        .summary-tag { font-family: var(--font-mono); font-size: 11px; color: var(--gold); letter-spacing: 0.08em; text-transform: uppercase; }
        .summary-title { font-family: var(--font-display); font-size: 22px; color: var(--paper); margin-top: 4px; font-weight: 400; }
        .summary-sub { margin: 10px 0 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
        .summary-badge { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 18px; padding: 0; background: transparent; border: none; border-radius: 0; font-size: 13px; color: var(--gold); }
        .integration-disclosure { margin-top: 14px; border-top: 1px solid var(--ink-80); padding-top: 12px; }
        .integration-toggle { display: none; }
        .integration-trigger { display: flex; align-items: center; justify-content: center; gap: 7px; color: var(--muted); font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.04em; cursor: pointer; transition: color 0.2s ease; user-select: none; }
        .integration-trigger:hover { color: var(--gold); }
        .integration-caret { color: var(--gold); transition: transform 0.25s ease; }
        .integration-panel { max-height: 0; opacity: 0; overflow: hidden; transform: translateY(-6px); transition: max-height 0.25s ease, opacity 0.25s ease, transform 0.25s ease; }
        .integration-toggle:checked ~ .integration-trigger .integration-caret { transform: rotate(180deg); }
        .integration-toggle:checked ~ .integration-panel { max-height: 560px; opacity: 1; transform: translateY(0); }
        .integration-panel-inner { padding-top: 16px; }
        .flow-diagram { display: flex; flex-direction: column; align-items: center; color: var(--smoke); font-size: 12px; line-height: 1.35; text-align: center; }
        .diagram-node { width: 100%; max-width: 260px; }
        .diagram-line { width: 1px; height: 18px; background: var(--ink-60); margin: 6px 0; }
        .diagram-finu { border: 1px solid var(--ink-60); border-radius: var(--radius-sm); padding: 12px 14px; background: rgba(255,255,255,0.02); color: var(--paper); display: flex; flex-direction: column; gap: 2px; }
        .diagram-finu strong { color: var(--gold); font-family: var(--font-display); font-size: 18px; font-weight: 400; }
        .diagram-node small { display: block; color: var(--muted); margin-top: 3px; }
        .diagram-final { color: var(--gold); font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.02em; }
        .integration-points { margin-top: 16px; display: flex; flex-direction: column; gap: 8px; color: var(--muted); font-size: 12px; line-height: 1.45; }
        .integration-points div::before { content: '•'; color: var(--gold); margin-right: 8px; }
        .demo-form { display: flex; flex-direction: column; gap: 18px; margin-bottom: 20px; }
        .demo-field { display: flex; flex-direction: column; gap: 6px; }
        .demo-label { font-family: var(--font-mono); font-size: 10px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }
        .demo-input-shell { position: relative; display: flex; align-items: center; }
        .demo-input-icon { position: absolute; left: 16px; z-index: 1; color: var(--smoke); font-size: 20px; line-height: 1; opacity: 0.9; }
        .demo-input-icon.rupee { font-family: var(--font-body); font-size: 20px; font-weight: 600; }
        .demo-input-check { position: absolute; right: 16px; color: var(--emerald); font-size: 17px; font-weight: 700; }
        .demo-input { background: var(--ink-80); border: 1px solid var(--ink-60); border-radius: var(--radius-sm); padding: 10px 14px; color: var(--paper); font-family: var(--font-body); font-size: 14px; outline: none; transition: border-color 0.2s; width: 100%; box-sizing: border-box; }
        .demo-input.with-icon { padding-left: 52px; padding-right: 44px; }
        .demo-input::placeholder { color: var(--muted); }
        .demo-input:focus { border-color: var(--gold); }
        .demo-input[type="number"]::-webkit-inner-spin-button { opacity: 0.3; }
        .demo-error { font-size: 12px; color: #ff6b6b; padding: 8px 12px; background: rgba(255,107,107,0.08); border: 1px solid rgba(255,107,107,0.2); border-radius: var(--radius-sm); }
        .demo-launch-btn { width: 100%; padding: 14px 20px; background: linear-gradient(135deg, var(--gold-dk), var(--gold)); border: none; border-radius: var(--radius-md); color: var(--ink); font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; margin-top: 4px; }
        .demo-launch-btn:hover { opacity: 0.9; }
        .demo-showcase { position: relative; overflow: hidden; background: var(--ink-90); box-shadow: 0 18px 55px rgba(0,0,0,0.18); }
        .demo-showcase-bg { display: none; }
        .demo-showcase-overlay { display: none; }
        .bg-order, .bg-checkout { border: 1px solid var(--ink-60); border-radius: var(--radius-lg); background: rgba(24,24,30,0.95); padding: 26px; }
        .bg-line { height: 16px; width: 100%; margin-bottom: 20px; border-radius: 8px; background: var(--ink-60); }
        .bg-line.short { width: 36%; background: var(--gold); }
        .bg-line.medium { width: 58%; }
        .bg-price { height: 42px; margin: 38px 0 22px; border-top: 1px solid var(--ink-60); border-bottom: 1px solid var(--ink-60); background: linear-gradient(90deg, transparent 58%, var(--gold) 58%); }
        .bg-badge { height: 38px; border: 1px solid rgba(201,168,76,0.28); border-radius: var(--radius-sm); background: rgba(201,168,76,0.08); }
        .bg-bar { display: flex; height: 38px; margin: 32px 0; overflow: hidden; border-radius: var(--radius-sm); }
        .bg-bar span { flex: 0 0 67%; background: var(--gold-dk); }
        .bg-bar i { flex: 1; background: var(--sapphire); }
        .bg-methods { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-bottom: 24px; }
        .bg-methods span { height: 72px; border: 1px solid var(--ink-60); border-radius: var(--radius-md); background: var(--ink-80); }
        .bg-total { height: 142px; border: 1px solid var(--ink-60); border-radius: var(--radius-md); background: var(--ink-80); margin-bottom: 28px; }
        .bg-button { height: 50px; border-radius: var(--radius-md); background: var(--gold); }
        .demo-showcase-content { position: relative; z-index: 1; min-height: 436px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 34px 36px 28px; text-align: center; }
        .demo-pill { display: inline-flex; align-items: center; justify-content: center; gap: 9px; margin-bottom: 22px; padding: 8px 18px; border: 1px solid rgba(201,168,76,0.26); border-radius: 999px; background: rgba(201,168,76,0.07); color: var(--gold); font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
        .demo-pill-icon { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--gold); border-radius: 50%; font-size: 12px; line-height: 1; letter-spacing: 0; }
        .showcase-title { font-family: var(--font-display); color: var(--paper); font-size: clamp(25px, 3vw, 34px); font-weight: 400; line-height: 1.16; margin-bottom: 24px; }
        .showcase-title em { color: var(--gold); font-style: italic; }
        .journey-row { width: 100%; display: grid; grid-template-columns: 1fr 46px 1fr 46px 1fr; align-items: start; gap: 0; margin-bottom: 24px; }
        .journey-step { display: flex; flex-direction: column; align-items: center; gap: 10px; min-width: 0; }
        .journey-icon { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--gold); background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.18); font-size: 28px; box-shadow: 0 0 30px rgba(201,168,76,0.08); }
        .journey-icon.confirmed { color: var(--emerald); border-color: rgba(46,204,143,0.24); background: rgba(46,204,143,0.08); font-family: var(--font-body); font-size: 30px; font-weight: 700; }
        .journey-step h3 { color: var(--paper); font-size: 18px; font-weight: 650; margin: 0; }
        .journey-step p { color: var(--muted); font-size: 13px; line-height: 1.55; margin: 0; max-width: 170px; }
        .journey-line { height: 1px; width: 100%; margin-top: 32px; background: linear-gradient(90deg, rgba(201,168,76,0.15), var(--gold), rgba(201,168,76,0.15)); }
        .secure-note { margin: 0 auto 18px; color: var(--smoke); font-size: 13px; line-height: 1.5; text-align: center; }
        .live-example { color: var(--gold); font-size: 14px; font-weight: 600; position: relative; display: inline-block; }
        .live-example::before { content: '↪'; position: absolute; left: -34px; top: -18px; color: var(--gold); font-size: 24px; transform: rotate(14deg); animation: guideFloat 2.6s ease-in-out infinite; opacity: 0.82; }
        @keyframes guideFloat { 0%, 100% { transform: translateY(0) rotate(14deg); } 50% { transform: translateY(3px) rotate(14deg); } }
        .trust-badges { margin-top: 24px; display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--ink-80); border-radius: var(--radius-lg); background: rgba(24,24,30,0.64); overflow: hidden; }
        .trust-badge { display: flex; align-items: center; gap: 12px; padding: 15px 18px; border-right: 1px solid var(--ink-80); }
        .trust-badge:last-child { border-right: none; }
        .trust-icon { width: 30px; min-width: 30px; color: var(--gold); font-size: 22px; text-align: center; }
        .trust-badge h3 { margin: 0 0 5px; color: var(--paper); font-size: 13px; font-weight: 650; }
        .trust-badge p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.45; }
        .checkout-card { background: var(--ink-90); border: 1px solid var(--ink-60); border-radius: var(--radius-lg); overflow: hidden; box-shadow: 0 18px 55px rgba(0,0,0,0.18); }
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
        .flow-info { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .flow-step { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
        .flow-num { width: 20px; height: 20px; border-radius: 50%; background: var(--ink-80); border: 1px solid var(--ink-60); display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 10px; color: var(--gold); flex-shrink: 0; }
        .flow-arrow { color: var(--ink-60); font-size: 12px; }
        .proceed-btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 16px 24px; background: linear-gradient(135deg, var(--gold-dk), var(--gold)); border: none; border-radius: var(--radius-md); color: var(--ink); font-family: var(--font-body); font-size: 15px; font-weight: 600; cursor: pointer; transition: all var(--transition); position: relative; overflow: hidden; }
        .proceed-btn::before { content: ''; position: absolute; inset: 0; background: rgba(255,255,255,0.1); opacity: 0; transition: opacity var(--transition); }
        .proceed-btn:hover::before { opacity: 1; }
        .proceed-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .back-btn { align-self: flex-start; margin-top: -8px; padding: 6px 0; background: transparent; border: none; color: var(--muted); font-family: var(--font-body); font-size: 13px; cursor: pointer; transition: color 0.2s ease; }
        .back-btn:hover { color: var(--gold); }
        .order-summary .total-amount { font-size: 30px !important; color: var(--gold) !important; text-shadow: 0 0 18px rgba(201,168,76,0.12); }
        .split-slider .bar-card, .split-slider .bar-upi { transition: width 200ms ease, background 200ms ease !important; }
        .split-slider .field-input, .split-slider .field-pct, .split-slider .bar-label { transition: color 200ms ease, opacity 200ms ease, transform 200ms ease; }
        .btn-spinner { width: 16px; height: 16px; border: 2px solid rgba(0,0,0,0.2); border-top-color: var(--ink); border-radius: 50%; animation: spin 0.7s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .admin-nav-btn { padding: 7px 14px; background: transparent; border: 1px solid var(--ink-60); border-radius: var(--radius-sm); color: var(--muted); font-family: var(--font-mono); font-size: 11px; cursor: pointer; transition: all var(--transition); }
        .admin-nav-btn:hover { border-color: var(--gold); color: var(--gold); }
        @media (max-width: 980px) { .trust-badges { grid-template-columns: repeat(2, 1fr); } .trust-badge:nth-child(2) { border-right: none; } .trust-badge:nth-child(-n+2) { border-bottom: 1px solid var(--ink-80); } }
        @media (max-width: 820px) { .demo-config-card { transform: none; } .col-summary, .col-checkout { display: block; } .col-summary .order-summary, .col-checkout .demo-showcase { min-height: 0; } .demo-showcase-content { min-height: auto; } .journey-row { grid-template-columns: 1fr; gap: 18px; } .journey-line { width: 1px; height: 28px; margin: 0 auto; } .header { gap: 12px; flex-wrap: wrap; } }
        @media (max-width: 560px) { .trust-badges { grid-template-columns: 1fr; } .trust-badge, .trust-badge:nth-child(2) { border-right: none; border-bottom: 1px solid var(--ink-80); } .trust-badge:last-child { border-bottom: none; } }
      `}</style>
    </>)}
  </div>
  );
}
