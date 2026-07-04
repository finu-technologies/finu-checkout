// components/SplitSlider.jsx

import React from 'react';

function fmt(n) {
  return '₹' + Number(n).toLocaleString('en-IN');
}

export default function SplitSlider({ total, cardAmount, onChange }) {
  const upiAmount = total - cardAmount;
  const cardPct = Math.round((cardAmount / total) * 100);
  const upiPct = 100 - cardPct;

  function handleCardInput(e) {
    let val = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0;
    val = Math.min(Math.max(val, 0), total);
    onChange(Math.round(val));
  }

  function handleSlider(e) {
    const pct = parseInt(e.target.value, 10);
    onChange(Math.round((pct / 100) * total));
  }

  return (
    <div className="split-slider">
      {/* Visual bar */}
      <div className="split-bar-wrap">
        <div className="split-bar">
          <div className="bar-card" style={{ width: `${cardPct}%` }}>
            <span className="bar-label">Card {cardPct}%</span>
          </div>
          <div className="bar-upi" style={{ width: `${upiPct}%` }}>
            <span className="bar-label right">UPI {upiPct}%</span>
          </div>
        </div>
        <input
          type="range"
          className="split-range"
          min="0"
          max="100"
          step="1"
          value={cardPct}
          onChange={handleSlider}
        />
      </div>

      {/* Inputs */}
      <div className="split-inputs">
        <div className="split-field card-field">
          <div className="field-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
          </div>
          <div className="field-body">
            <label className="field-label">Card Payment</label>
            <div className="field-input-wrap">
              <span className="currency-symbol">₹</span>
              <input
                type="text"
                className="field-input"
                value={cardAmount.toLocaleString('en-IN')}
                onChange={handleCardInput}
              />
            </div>
          </div>
          <div className="field-pct card-pct">{cardPct}%</div>
        </div>

        <div className="split-arrow">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 0-2 2h-3"/>
          </svg>
        </div>

        <div className="split-field upi-field">
          <div className="field-icon upi-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div className="field-body">
            <label className="field-label">UPI Payment</label>
            <div className="field-input-wrap">
              <span className="currency-symbol">₹</span>
              <input
                type="text"
                className="field-input auto-populated"
                value={upiAmount.toLocaleString('en-IN')}
                readOnly
              />
              <span className="auto-badge">auto</span>
            </div>
          </div>
          <div className="field-pct upi-pct">{upiPct}%</div>
        </div>
      </div>

      <style>{`
        .split-slider { display: flex; flex-direction: column; gap: 20px; }

        /* Bar */
        .split-bar-wrap { position: relative; }
        .split-bar {
          display: flex;
          height: 40px;
          border-radius: var(--radius-sm);
          overflow: hidden;
          border: 1px solid var(--ink-60);
        }
        .bar-card {
          background: linear-gradient(135deg, var(--gold-dk), var(--gold));
          display: flex; align-items: center; padding: 0 10px;
          transition: width var(--transition);
          min-width: 40px;
          position: relative;
        }
        .bar-upi {
          background: linear-gradient(135deg, #2A6FBF, var(--sapphire));
          display: flex; align-items: center; justify-content: flex-end; padding: 0 10px;
          transition: width var(--transition);
          flex: 1;
        }
        .bar-label {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 500;
          color: rgba(255,255,255,0.9);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: clip;
        }
        .bar-label.right { text-align: right; }

        /* Range slider */
        .split-range {
          position: absolute;
          bottom: -16px;
          left: 0; right: 0; width: 100%;
          height: 4px;
          -webkit-appearance: none;
          background: transparent;
          cursor: pointer;
          z-index: 2;
        }
        .split-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 20px; height: 20px;
          border-radius: 50%;
          background: var(--gold);
          border: 2px solid var(--ink);
          box-shadow: 0 0 8px rgba(201,168,76,0.5);
          cursor: grab;
        }
        .split-range::-webkit-slider-runnable-track {
          height: 4px;
          background: transparent;
        }

        /* Inputs */
        .split-inputs {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-top: 8px;
        }
        .split-field {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 12px;
          background: var(--ink-80);
          border: 1px solid var(--ink-60);
          border-radius: var(--radius-md);
          padding: 14px 16px;
          transition: border-color var(--transition);
        }
        .split-field:hover { border-color: var(--ink-60); }
        .card-field { border-color: rgba(201,168,76,0.25); }
        .card-field:hover { border-color: rgba(201,168,76,0.45); }
        .upi-field { border-color: rgba(74,144,217,0.2); }

        .field-icon {
          color: var(--gold);
          flex-shrink: 0;
          width: 32px; height: 32px;
          background: rgba(201,168,76,0.08);
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
        }
        .upi-icon { color: var(--sapphire); background: rgba(74,144,217,0.08); }

        .field-body { flex: 1; min-width: 0; }
        .field-label {
          display: block;
          font-size: 10px;
          font-family: var(--font-mono);
          color: var(--muted);
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .field-input-wrap {
          display: flex;
          align-items: baseline;
          gap: 2px;
        }
        .currency-symbol {
          font-size: 13px;
          color: var(--muted);
          font-family: var(--font-mono);
        }
        .field-input {
          background: transparent;
          border: none;
          outline: none;
          font-family: var(--font-mono);
          font-size: 17px;
          font-weight: 500;
          color: var(--paper);
          width: 100%;
          min-width: 0;
        }
        .field-input.auto-populated { color: var(--sapphire); cursor: default; }
        .auto-badge {
          font-family: var(--font-mono);
          font-size: 9px;
          background: rgba(74,144,217,0.15);
          color: var(--sapphire);
          padding: 1px 5px;
          border-radius: 4px;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }

        .field-pct {
          font-family: var(--font-mono);
          font-size: 11px;
          padding: 3px 7px;
          border-radius: 4px;
          font-weight: 500;
          flex-shrink: 0;
        }
        .card-pct { background: rgba(201,168,76,0.1); color: var(--gold); }
        .upi-pct { background: rgba(74,144,217,0.1); color: var(--sapphire); }

        .split-arrow {
          flex-shrink: 0;
          width: 32px; height: 32px;
          display: flex; align-items: center; justify-content: center;
          background: rgba(201,168,76,0.05);
          border: 1px solid rgba(201,168,76,0.1);
          border-radius: 50%;
        }
      `}</style>
    </div>
  );
}
