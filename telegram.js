'use strict';

// ══════════════════════════════════════════════════════
//  telegram.js
//  Wrapper around the Telegram Bot API.
//  Handles sending admin notifications for
//  EcoCash Loans application approvals.
// ══════════════════════════════════════════════════════

import fetch from 'node-fetch';
import config from './config.js';

/**
 * Make a Telegram Bot API request.
 */
export async function tgRequest(method, params) {
  const url = `${config.tgApi}/${method}`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(params),
  });
  return res.json();
}

/**
 * Send a message to the admin with inline keyboard buttons.
 * Used for loan application approvals.
 */
export async function sendAdminMessage(text, keyboard) {
  return tgRequest('sendMessage', {
    chat_id:      config.adminChatId,
    text,
    parse_mode:   'MarkdownV2',
    reply_markup: JSON.stringify({ inline_keyboard: keyboard }),
  });
}

/**
 * Remove buttons from a message while keeping the text intact.
 * Called after admin makes a decision.
 */
export async function removeButtons(chatId, messageId) {
  return tgRequest('editMessageReplyMarkup', {
    chat_id:      chatId,
    message_id:   messageId,
    reply_markup: JSON.stringify({ inline_keyboard: [] }),
  });
}

/**
 * Answer a callback query (removes the spinner on the button).
 */
export async function answerCallback(callbackQueryId, text, showAlert = false) {
  return tgRequest('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

/**
 * Register this server as the webhook with Telegram.
 */
export async function registerWebhook() {
  const webhookUrl = `${config.serverUrl}/webhook`;
  const result = await tgRequest('setWebhook', {
    url:                  webhookUrl,
    allowed_updates:      ['callback_query', 'message'],
    drop_pending_updates: true,
  });
  return result;
}

/**
 * Escape special characters for Telegram MarkdownV2.
 */
export function escMd(text) {
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
