# FinU — Split Payment Orchestration PoC

A sandbox demo of split-tender payment orchestration: pay part by card, part by UPI — sequentially, with full rollback/refund logic.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React Frontend (Vite, port 5173)                           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ OrderSummary│  │  SplitSlider │  │  PaymentStatus   │   │
│  └─────────────┘  └──────────────┘  └──────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ REST /api/*
┌───────────────────────────▼─────────────────────────────────┐
│  Node.js / Express Backend (port 4000)                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  POST /api/session/create                              │  │
│  │  POST /api/payment/card/verify  → triggers UPI order   │  │
│  │  POST /api/payment/upi/verify   → confirms order       │  │
│  │  POST /api/session/:id/cancel   → flags refund if card  │  │
│  │  GET  /api/session/:id          → status polling       │  │
│  └────────────────────────────────────────────────────────┘  │
│  SessionStore (JSON file) — sessions.json                    │
└───────────────────────────┬─────────────────────────────────┘
                            │ SDK
                    Razorpay Test Mode
```

## Session State Machine

```
CREATED
  └→ CARD_PENDING
       ├→ CARD_FAILED ─────────────────────────── CANCELLED
       └→ CARD_SUCCESS
            └→ UPI_PENDING
                 ├→ UPI_FAILED → REFUND_FLAGGED  (card must be refunded)
                 └→ COMPLETED  ✓
```

---

## Setup

### 1. Get Razorpay Test Keys
Go to [dashboard.razorpay.com](https://dashboard.razorpay.com) → Settings → API Keys → Generate Test Mode Keys.

### 2. Backend
```bash
cd backend
cp .env.example .env
# Edit .env and paste your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET
npm install
npm run dev
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Test Flow

1. Order total is fixed at **₹1,50,000**
2. Default split: **₹1,00,000 card + ₹50,000 UPI**
3. Use the slider or type in the card amount field to adjust
4. Click **Proceed to Pay**
5. Razorpay test checkout opens for **Card** — use test card:
   - Number: `4111 1111 1111 1111`
   - Expiry: any future date, CVV: any 3 digits
6. On card success, Razorpay opens again for **UPI**
   - Use any UPI ID like `success@razorpay` (test)
7. On UPI success → **ORDER CONFIRMED**

### Failure scenarios
- Close/cancel card modal → session cancelled, no refund needed
- Close/cancel UPI modal (after card success) → card flagged for refund

---

## File Structure

```
finu-poc/
├── backend/
│   ├── server.js              # Express entry point
│   ├── routes/
│   │   └── payments.js        # All orchestration endpoints
│   ├── utils/
│   │   └── sessionStore.js    # JSON-based session persistence
│   ├── data/
│   │   └── sessions.json      # Auto-created at runtime
│   └── .env.example
└── frontend/
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── App.jsx            # Main checkout + orchestration logic
        ├── styles.css         # Global design system
        ├── components/
        │   ├── OrderSummary.jsx   # Right panel — order items
        │   ├── SplitSlider.jsx    # Core split input UI
        │   └── PaymentStatus.jsx  # Live status / step tracker
        ├── hooks/
        │   └── useRazorpay.js    # Razorpay SDK loader + checkout opener
        └── utils/
            └── api.js            # Backend API calls
```

---

## Next Steps (for production)
- Replace JSON session store with PostgreSQL
- Add webhook endpoint for async payment confirmation
- Implement actual Razorpay refund API calls
- Add auth middleware
- Timeout handling for pending sessions
