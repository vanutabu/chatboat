"use strict";

const accounts = require("../services/accountService");
const store = require("../services/userStore");
const google = require("../services/googleAuthService");
const { issueSession, clearSession } = require("../middleware/userAuth");
const limits = require("../middleware/authRateLimit");

const PHONE_RE = /^[0-9+()\-\s.]{5,25}$/;

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function maskEmail(email) {
  const [u, d] = String(email).split("@");
  return `${u.slice(0, 2)}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
}

/* POST /api/auth/signup  { name, email, phone? }
   Creates the account and EMAILS the generated User ID + password.
   Nothing secret is returned, and no session is started: the customer proves they own
   the address by using the details that were sent to it. */
async function signup(req, res) {
  try {
    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ");
    const email = accounts.normalizeEmail(req.body?.email);
    const phone = String(req.body?.phone || "").trim();

    if (name.length < 2 || name.length > 150) return fail(res, 400, "Please enter your full name.");
    if (!accounts.isValidEmail(email)) return fail(res, 400, "Please enter a valid email address.");
    if (phone && !PHONE_RE.test(phone)) return fail(res, 400, "Please enter a valid phone number.");

    if (await store.findByEmail(email)) {
      return fail(res, 409, "An account with this email already exists. Sign in, or use \"Forgot password\" to get new details by email.");
    }

    await accounts.createAccount({ name, email, phone: phone || null, provider: "manual" });
    return res.status(201).json({
      success: true,
      message: `Account created. Your User ID and password have been sent to ${maskEmail(email)}.`
    });
  } catch (error) {
    if (error.status) return fail(res, error.status, error.message);
    console.error("SIGNUP ERROR:", error);
    return fail(res, 500, "Unable to create your account right now.");
  }
}

/* POST /api/auth/google  { credential }   (ID token from Google Sign-In) */
async function googleLogin(req, res) {
  try {
    const g = await google.verifyIdToken(req.body?.credential);

    let user = await store.findByGoogleSub(g.sub);
    let isNew = false;

    if (!user) {
      user = await store.findByEmail(g.email);
      if (user) {
        // Same verified email as an existing manual account: link Google to it.
        user = await store.linkGoogle(user.id, g.sub, g.picture);
      } else {
        user = await accounts.createAccount({
          name: g.name, email: g.email, phone: null,
          provider: "google", googleSub: g.sub, avatarUrl: g.picture
        });
        isNew = true;
      }
    }
    if (!user.is_active) return fail(res, 403, "This account has been disabled.");

    await store.touchLogin(user.id);
    issueSession(req, res, user);
    return res.status(isNew ? 201 : 200).json({
      success: true,
      isNewUser: isNew,
      message: isNew
        ? `Welcome! Your User ID and password have also been emailed to ${maskEmail(user.email)}.`
        : "Signed in with Google.",
      user: accounts.publicUser(user)
    });
  } catch (error) {
    if (error.status) return fail(res, error.status, error.message);
    console.error("GOOGLE LOGIN ERROR:", error);
    return fail(res, 500, "Unable to sign in with Google right now.");
  }
}

/* POST /api/auth/login  { identifier: User ID or email, password } */
async function login(req, res) {
  try {
    const identifier = String(req.body?.identifier ?? req.body?.email ?? req.body?.userId ?? "").trim();
    const password = String(req.body?.password || "");
    if (!identifier || !password) return fail(res, 400, "Enter your User ID or email, and your password.");

    const parsed = accounts.parseIdentifier(identifier);
    const key = parsed ? parsed.value : identifier.toLowerCase().slice(0, 100);
    if (limits.failedLoginLimiter.count(key) >= limits.failedLoginLimiter.max) {
      return fail(res, 429, "Too many failed attempts for this account. Please wait 15 minutes or use \"Forgot password\".");
    }

    const user = parsed ? await accounts.findByIdentifier(identifier) : null;
    const ok = await accounts.verifyPassword(user, password);
    if (!user || !ok || !user.is_active) {
      limits.failedLoginLimiter.hit(key);
      return fail(res, 401, "Incorrect User ID/email or password.");
    }

    await store.touchLogin(user.id);
    issueSession(req, res, user);
    return res.json({ success: true, user: accounts.publicUser(user) });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    return fail(res, 500, "Unable to sign in right now.");
  }
}

function logout(req, res) {
  clearSession(req, res);
  res.json({ success: true });
}

/* POST /api/auth/forgot  { identifier }
   Always answers the same way so it can't be used to discover who has an account. */
async function forgot(req, res) {
  const generic = {
    success: true,
    message: "If an account exists, a new password has been emailed to it."
  };
  try {
    const user = await accounts.findByIdentifier(req.body?.identifier);
    if (user && user.is_active && limits.perEmailLimiter.take(user.email.toLowerCase())) {
      try { await accounts.resetPassword(user); }
      catch (error) { console.error("[AUTH] Password email failed:", error.message); }
    }
    return res.json(generic);
  } catch (error) {
    console.error("FORGOT ERROR:", error);
    return res.json(generic);
  }
}

/* POST /api/auth/change-password  { currentPassword, newPassword }   (logged in) */
async function changePassword(req, res) {
  try {
    const current = String(req.body?.currentPassword || "");
    const next = String(req.body?.newPassword || "");
    if (!(await accounts.verifyPassword(req.user, current))) {
      return fail(res, 401, "Your current password is incorrect.");
    }
    const problem = accounts.validatePasswordStrength(next);
    if (problem) return fail(res, 400, problem);
    if (next === current) return fail(res, 400, "Choose a password different from the current one.");

    await store.setPassword(req.user.id, await accounts.hashPassword(next), false);
    const fresh = await store.findById(req.user.id);
    issueSession(req, res, fresh); // older sessions stop working; this one continues
    return res.json({ success: true, message: "Password updated." });
  } catch (error) {
    console.error("CHANGE PASSWORD ERROR:", error);
    return fail(res, 500, "Unable to change your password right now.");
  }
}

/* GET /api/auth/config  - lets the frontend know which sign-in buttons to show. */
function config(req, res) {
  res.json({
    success: true,
    google: google.isConfigured() ? { clientId: google.clientId() } : null
  });
}

module.exports = { signup, googleLogin, login, logout, forgot, changePassword, config };
