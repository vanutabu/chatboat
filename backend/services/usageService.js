"use strict";

/*
Free-use metering for the chat assistant.

Each browser gets an httpOnly cookie (ah_vid). Every accepted question adds 1
to that visitor's counter, stored in Postgres so it survives restarts and
deploys. A second, looser counter per IP address stops people from getting
unlimited free questions by clearing cookies. If the database is unavailable
the counters fall back to memory, so chat keeps working.

Paid access is a signed cookie (ah_pro) issued after Stripe Checkout is
confirmed - see billingService.js.
*/

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { query } = require("../config/database");

const FREE_LIMIT = Math.max(1, Number(process.env.FREE_CHAT_LIMIT || 5));
const IP_LIMIT = FREE_LIMIT * 3; // shared networks (schools, offices) get more headroom
const VID_COOKIE = "ah_vid";
const PRO_COOKIE = "ah_pro";
const ONE_YEAR = 365 * 24 * 60 * 60;
const PRO_TOKEN_DAYS = 35;

const SECRET =
  String(process.env.JWT_SECRET || "").trim() ||
  crypto.randomBytes(32).toString("hex"); // paid sessions won't survive restarts without JWT_SECRET

const memory = new Map();
let tableReady = null;

function ensureTable() {
  if (!tableReady) {
    tableReady = query(`
      CREATE TABLE IF NOT EXISTS chat_usage (
        visitor_id VARCHAR(80) PRIMARY KEY,
        uses INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `).catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "")
    .split(";")
    .forEach((part) => {
      const i = part.indexOf("=");
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
  return out;
}

function setCookie(res, req, name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (req.secure) parts.push("Secure");
  const existing = res.getHeader("Set-Cookie");
  const list = existing ? [].concat(existing) : [];
  list.push(parts.join("; "));
  res.setHeader("Set-Cookie", list);
}

function getVisitorId(req, res) {
  const cookies = parseCookies(req);
  let id = cookies[VID_COOKIE];
  if (!/^[a-f0-9]{32}$/.test(id || "")) {
    id = crypto.randomBytes(16).toString("hex");
    setCookie(res, req, VID_COOKIE, id, ONE_YEAR);
  }
  return id;
}

function ipKey(req) {
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
  return "ip:" + crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 40);
}

/* Atomically add 1 to a counter unless it has reached its limit. */
async function bump(key, limit) {
  try {
    await ensureTable();
    const r = await query(
      `INSERT INTO chat_usage (visitor_id, uses) VALUES ($1, 1)
       ON CONFLICT (visitor_id) DO UPDATE
         SET uses = chat_usage.uses + 1, updated_at = NOW()
         WHERE chat_usage.uses < $2
       RETURNING uses`,
      [key, limit]
    );
    if (r.rows.length) return { ok: true, uses: r.rows[0].uses };
    const cur = await query("SELECT uses FROM chat_usage WHERE visitor_id = $1", [key]);
    return { ok: false, uses: cur.rows[0] ? cur.rows[0].uses : limit };
  } catch (error) {
    console.error("[CHAT USAGE] database unavailable, using memory:", error.message);
    const used = memory.get(key) || 0;
    if (used >= limit) return { ok: false, uses: used };
    memory.set(key, used + 1);
    return { ok: true, uses: used + 1 };
  }
}

async function drop(key) {
  try {
    await ensureTable();
    await query("UPDATE chat_usage SET uses = GREATEST(uses - 1, 0) WHERE visitor_id = $1", [key]);
  } catch (error) {
    memory.set(key, Math.max(0, (memory.get(key) || 0) - 1));
  }
}

async function read(key) {
  try {
    await ensureTable();
    const r = await query("SELECT uses FROM chat_usage WHERE visitor_id = $1", [key]);
    return r.rows[0] ? r.rows[0].uses : 0;
  } catch (error) {
    return memory.get(key) || 0;
  }
}

function usageInfo(used, pro) {
  return { limit: FREE_LIMIT, used: Math.min(used, FREE_LIMIT), pro: !!pro };
}

/* Reserve one free question. Call release() if answering fails. */
async function reserve(req, visitorId) {
  const v = await bump(visitorId, FREE_LIMIT);
  if (!v.ok) return { allowed: false, usage: usageInfo(v.uses, false) };
  const ip = ipKey(req);
  const i = await bump(ip, IP_LIMIT);
  if (!i.ok) {
    await drop(visitorId);
    return { allowed: false, usage: usageInfo(FREE_LIMIT, false) };
  }
  return { allowed: true, usage: usageInfo(v.uses, false), ipKey: ip };
}

async function release(visitorId, ip) {
  await drop(visitorId);
  if (ip) await drop(ip);
}

async function peek(visitorId) {
  return usageInfo(await read(visitorId), false);
}

/* ---- paid sessions ---- */
function issueProCookie(req, res, claims) {
  const token = jwt.sign(
    { pro: true, customer: claims.customer || null, subscription: claims.subscription || null, email: claims.email || null },
    SECRET,
    { expiresIn: PRO_TOKEN_DAYS + "d" }
  );
  setCookie(res, req, PRO_COOKIE, token, PRO_TOKEN_DAYS * 24 * 60 * 60);
}

function readProClaims(req) {
  const token = parseCookies(req)[PRO_COOKIE];
  if (!token) return null;
  try {
    const claims = jwt.verify(token, SECRET);
    return claims && claims.pro ? claims : null;
  } catch (error) {
    return null;
  }
}

module.exports = {
  FREE_LIMIT,
  getVisitorId,
  reserve,
  release,
  peek,
  usageInfo,
  issueProCookie,
  readProClaims
};
