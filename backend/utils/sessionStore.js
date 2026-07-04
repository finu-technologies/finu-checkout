// utils/sessionStore.js — In-memory store with async disk flush
//
// DESIGN:
//   All reads and writes operate on an in-memory object (_store).
//   The disk write is deferred via setImmediate so it always happens
//   AFTER the current call stack (and therefore after any HTTP response
//   that triggered the write) has completed.
//
//   This prevents nodemon from restarting mid-request because the file
//   change only lands on disk after the response has been sent.
//
//   On startup the store is loaded from disk once. If the file is
//   absent or corrupt, we start with an empty store.

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(__dirname, '../data');
const STORE_PATH = path.join(DATA_DIR, 'sessions.json');

// ─── Bootstrap ────────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load once into memory at startup
let _store = {};
try {
  if (fs.existsSync(STORE_PATH)) {
    _store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    console.log(`[sessionStore] Loaded ${Object.keys(_store).length} session(s) from disk`);
  } else {
    fs.writeFileSync(STORE_PATH, JSON.stringify({}));
    console.log('[sessionStore] Created fresh sessions.json');
  }
} catch (err) {
  console.error('[sessionStore] Failed to load sessions.json — starting empty:', err.message);
  _store = {};
}

// ─── Async disk flush ─────────────────────────────────────────────────────────
// Runs on setImmediate so it executes AFTER the current call stack
// (i.e., after the HTTP response has been sent to the client).
// Uses the async fs.writeFile to avoid blocking the event loop at all.

let _flushPending = false;

function scheduleDiskFlush() {
  if (_flushPending) return; // already queued — one flush covers multiple writes
  _flushPending = true;

  setImmediate(() => {
    _flushPending = false;
    const snapshot = JSON.stringify(_store, null, 2);
    fs.writeFile(STORE_PATH, snapshot, 'utf8', (err) => {
      if (err) console.error('[sessionStore] Disk flush failed:', err.message);
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

const SessionStore = {
  create(sessionId, data) {
    _store[sessionId] = {
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    scheduleDiskFlush();
    return _store[sessionId];
  },

  get(sessionId) {
    return _store[sessionId] || null;
  },

  update(sessionId, updates) {
    if (!_store[sessionId]) return null;
    _store[sessionId] = {
      ..._store[sessionId],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    scheduleDiskFlush();
    return _store[sessionId];
  },

  delete(sessionId) {
    delete _store[sessionId];
    scheduleDiskFlush();
  },

  getAll() {
    return _store;
  },
};

module.exports = SessionStore;
