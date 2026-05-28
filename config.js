'use strict';

// ══════════════════════════════════════════════════════
//  config.js
//  All configuration is read from environment variables.
//  In local dev: values come from .env (loaded by dotenv).
//  On Render: set these in the Environment tab — no .env needed.
// ══════════════════════════════════════════════════════

// Load .env file only in development (Render sets vars directly)
if (process.env.NODE_ENV !== 'production') {
  try {
    const dotenv = await import('dotenv');
    dotenv.config();
  } catch {
    // dotenv not needed in production
  }
}

// ── Read & validate required variables ──
const required = ['BOT_TOKEN', 'ADMIN_CHAT_ID', 'SERVER_URL', 'SECRET_KEY'];
const missing  = required.filter(k => !process.env[k]);

if (missing.length > 0) {
  console.error(`\n❌ Missing required environment variables:\n   ${missing.join(', ')}\n`);
  console.error('   Copy .env.example to .env and fill in your values.\n');
  process.exit(1);
}

const config = {
  // Telegram
  botToken:    process.env.BOT_TOKEN,
  adminChatId: process.env.ADMIN_CHAT_ID,
  tgApi:       `https://api.telegram.org/bot${process.env.BOT_TOKEN}`,

  // Server
  serverUrl:   process.env.SERVER_URL.replace(/\/$/, ''), // strip trailing slash
  appUrl:      process.env.APP_URL || '*',
  port:        parseInt(process.env.PORT || '3000', 10),

  // Security
  secretKey:   process.env.SECRET_KEY,

  // Token TTL — how long admin has to click a button (ms)
  tokenTtl:    10 * 60 * 1000, // 10 minutes
};

export default config;
