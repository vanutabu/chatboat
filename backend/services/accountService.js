"use strict";

/*
 * Account rules: ID/password generation, hashing, creating accounts and
 * issuing credentials by email.
 */

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const store = require("./userStore");
const emailer = require("./accountEmailService");

const BCRYPT_ROUNDS = 12;
// No 0/O, 1/I/l - IDs and passwords are read from an email and typed by hand.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function pick(chars) {
  return chars[crypto.randomInt(chars.length)];
}

function generateUserCode() {
  let s = "";
  for (let i = 0; i < 8; i++) s += pick(CODE_CHARS);
  return "AH-" + s;
}

/** 12 characters, always containing an upper-case letter, a lower-case letter and a digit. */
function generatePassword(length = 12) {
  const all = UPPER + LOWER + DIGITS;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase().slice(0, 254);
}

function isValidEmail(v) {
  return EMAIL_RE.test(v);
}

/** "ah-abcd2345", "AHABCD2345" or an email -> lookup key. */
function parseIdentifier(raw) {
  const v = String(raw || "").trim();
  if (v.includes("@")) return { type: "email", value: normalizeEmail(v) };
  const m = v.toUpperCase().replace(/\s+/g, "").match(/^AH-?([A-Z0-9]{8})$/);
  return m ? { type: "code", value: "AH-" + m[1] } : null;
}

function validatePasswordStrength(pw) {
  const p = String(pw || "");
  if (p.length < 8) return "Password must be at least 8 characters.";
  if (p.length > 72) return "Password must be 72 characters or fewer.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Password must contain letters and numbers.";
  return null;
}

async function hashPassword(pw) {
  return bcrypt.hash(pw, BCRYPT_ROUNDS);
}

let dummyHash = null;
/** Constant-ish work when the account does not exist, so timing doesn't reveal which IDs are registered. */
async function verifyPassword(user, pw) {
  if (!user) {
    if (!dummyHash) dummyHash = await bcrypt.hash("not-a-real-password", BCRYPT_ROUNDS);
    await bcrypt.compare(String(pw || ""), dummyHash);
    return false;
  }
  return bcrypt.compare(String(pw || ""), user.password_hash);
}

async function findByIdentifier(raw) {
  const id = parseIdentifier(raw);
  if (!id) return null;
  return id.type === "email" ? store.findByEmail(id.value) : store.findByCode(id.value);
}

function publicUser(u) {
  return {
    userId: u.user_code,
    name: u.name,
    email: u.email,
    phone: u.phone || "",
    provider: u.auth_provider,
    avatarUrl: u.avatar_url || null,
    mustChangePassword: !!u.must_change_password,
    memberSince: u.created_at,
    lastLogin: u.last_login_at || null
  };
}

/*
 * Create an account with a generated User ID + password and email them.
 * If the email cannot be sent the account is removed again - the password
 * exists nowhere else, so an account nobody can open must not be left behind.
 */
async function createAccount({ name, email, phone, provider, googleSub, avatarUrl }) {
  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  let user = null;
  for (let attempt = 0; attempt < 6 && !user; attempt++) {
    try {
      user = await store.insertUser({
        userCode: generateUserCode(),
        name, email, phone, provider, googleSub, avatarUrl,
        passwordHash,
        mustChangePassword: true
      });
    } catch (error) {
      if (error && error.code === "23505") {
        if (String(error.constraint || "").includes("user_code")) continue; // ID collision: try another
        const dup = new Error("An account with this email already exists.");
        dup.status = 409;
        throw dup;
      }
      throw error;
    }
  }
  if (!user) throw new Error("Could not allocate a user ID.");

  try {
    await emailer.sendCredentials({
      name: user.name, email: user.email, userCode: user.user_code, password,
      reason: provider === "google" ? "google" : "signup"
    });
  } catch (error) {
    await store.deleteUser(user.id).catch(() => {});
    console.error("[AUTH] Credentials email failed, account rolled back:", error.message);
    const err = new Error("We couldn't send your sign-in email. Please check the address and try again.");
    err.status = error.status && error.status < 500 ? error.status : 502;
    throw err;
  }
  return user;
}

/* Issue a fresh password (forgot-password). Returns false if nothing was sent. */
async function resetPassword(user) {
  const password = generatePassword();
  await emailer.sendCredentials({
    name: user.name, email: user.email, userCode: user.user_code, password, reason: "reset"
  });
  // Only replace the stored password once the email has actually gone out.
  await store.setPassword(user.id, await hashPassword(password), true);
  return true;
}

module.exports = {
  generateUserCode, generatePassword, normalizeEmail, isValidEmail, parseIdentifier,
  validatePasswordStrength, hashPassword, verifyPassword, findByIdentifier,
  publicUser, createAccount, resetPassword
};
