'use strict';

// ══════════════════════════════════════════════════════
//  store.js
//  In-memory key-value store for session tokens.
//  Used by the EcoCash Loans backend to manage
//  admin approval sessions and polling results.
// ══════════════════════════════════════════════════════

const store    = new Map(); // token → { result, phone, sig, expiresAt }
const sessions = new Map(); // token → { phone, sig, expiresAt }

/**
 * Save a session (phone + sig) for a token so webhook can verify it
 * without needing to embed sensitive data in callback_data.
 */
export function setSession(token, phone, sig, ttlMs) {
  sessions.set(token, {
    phone,
    sig,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Retrieve a session by token (without deleting it).
 * Returns null if not found or expired.
 */
export function getSession(token) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return s;
}

/**
 * Save a result for a token.
 * Used after admin clicks a Telegram button.
 */
export function setResult(token, result, ttlMs) {
  store.set(token, {
    result,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Get and immediately delete a result for a token.
 * Called by the frontend during polling.
 * Returns null if not found or expired.
 */
export function popResult(token) {
  const entry = store.get(token);
  if (!entry) return null;

  store.delete(token);

  if (Date.now() > entry.expiresAt) return null;

  return entry.result;
}

/**
 * Check if a token exists (without consuming it).
 */
export function hasToken(token) {
  return store.has(token);
}

// ── Cleanup expired entries every 5 minutes ──
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(token);
  }
  for (const [token, entry] of sessions.entries()) {
    if (now > entry.expiresAt) sessions.delete(token);
  }
}, 5 * 60 * 1000);
