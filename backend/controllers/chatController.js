"use strict";

const { askSiteAssistant } = require("../services/chatService");
const usage = require("../services/usageService");
const billing = require("../services/billingService");

async function isPro(req) {
  const claims = usage.readProClaims(req);
  if (!claims) return false;
  return billing.subscriptionActive(claims.subscription);
}

function parseHistory(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

async function status(req, res) {
  const visitorId = usage.getVisitorId(req, res);
  const pro = await isPro(req);
  const info = pro ? usage.usageInfo(0, true) : await usage.peek(visitorId);
  res.set("Cache-Control", "no-store");
  res.json({ success: true, usage: info });
}

async function ask(req, res) {
  const visitorId = usage.getVisitorId(req, res);
  const pro = await isPro(req);
  let reservation = null;

  try {
    const body = req.body || {};
    const files = req.files || [];

    if (!pro) {
      reservation = await usage.reserve(req, visitorId);
      if (!reservation.allowed) {
        return res.status(402).json({
          success: false,
          code: "LIMIT_REACHED",
          message: "You've used your free questions. Sign up for unlimited use.",
          usage: reservation.usage
        });
      }
    }

    const result = await askSiteAssistant({
      message: body.message,
      history: parseHistory(body.history),
      files,
      fileContext: body.fileContext
    });

    res.json({
      success: true,
      reply: result.reply,
      fileContext: result.fileContext,
      notice: result.notice || undefined,
      usage: pro ? usage.usageInfo(0, true) : reservation.usage
    });
  } catch (error) {
    if (reservation && reservation.allowed) {
      await usage.release(visitorId, reservation.ipKey).catch(() => {});
    }
    const status = error.status || 500;
    if (status >= 500) console.error("[CHAT ERROR]", error);
    res.status(status).json({
      success: false,
      message: error.message || "Unable to answer right now."
    });
  }
}

module.exports = { ask, status };
