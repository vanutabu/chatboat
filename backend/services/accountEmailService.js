"use strict";

/*
 * Sign-in details email. Uses the same SMTP account as the order emails
 * (SMTP_USER / SMTP_PASS / SMTP_FROM).
 *
 * The plain password only ever exists in memory long enough to be emailed;
 * the database stores a bcrypt hash.
 */

const mail = require("./emailService");

const SITE_NAME = String(process.env.SITE_NAME || "Assignment Help").trim();

function siteUrl() {
  return String(process.env.WEBSITE_URL || "").trim().replace(/\/+$/, "");
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function isConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS && mail.SMTP_FROM);
}

function credentialsHtml({ name, userCode, email, password, reason }) {
  const login = siteUrl() ? `${siteUrl()}/login` : "";
  const intro = {
    signup: "Your account has been created. Here are your sign-in details:",
    google: "Your account was created with Google sign-in. You can also sign in with these details:",
    reset: "As requested, we have issued a new password. Your previous password no longer works:"
  }[reason] || "Here are your sign-in details:";

  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1e1b4b">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:14px;padding:28px;border:1px solid #e5e7f5">
      <h2 style="margin:0 0 6px;color:#5b21b6">${esc(SITE_NAME)}</h2>
      <p style="margin:0 0 18px">Hi ${esc(name)},</p>
      <p style="margin:0 0 16px">${intro}</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;background:#f5f3ff;border-radius:10px">
        <tr><td style="padding:12px 16px;color:#6b7280;font-size:13px">User ID</td>
            <td style="padding:12px 16px;font-family:Consolas,monospace;font-size:16px;font-weight:bold">${esc(userCode)}</td></tr>
        <tr><td style="padding:12px 16px;color:#6b7280;font-size:13px">Email</td>
            <td style="padding:12px 16px">${esc(email)}</td></tr>
        <tr><td style="padding:12px 16px;color:#6b7280;font-size:13px">Password</td>
            <td style="padding:12px 16px;font-family:Consolas,monospace;font-size:16px;font-weight:bold">${esc(password)}</td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:14px">Sign in with your <b>User ID or email</b> plus the password above, then change the password from your account page.</p>
      ${login ? `<p style="margin:20px 0"><a href="${esc(login)}" style="background:#6d28d9;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:bold">Sign in</a></p>` : ""}
      <p style="margin:18px 0 0;font-size:12px;color:#6b7280">Keep this email private and delete it once you have changed your password. If you did not request this, you can ignore it.</p>
    </div>
  </div></body></html>`;
}

function credentialsText({ name, userCode, email, password }) {
  return `Hi ${name},\n\nUser ID: ${userCode}\nEmail: ${email}\nPassword: ${password}\n\nSign in with your User ID or email plus this password, then change the password from your account page.\n`;
}

/** reason: "signup" | "google" | "reset" */
async function sendCredentials({ name, email, userCode, password, reason }) {
  if (!isConfigured()) {
    if (String(process.env.AUTH_DEV_LOG_CREDENTIALS || "").toLowerCase() === "true" && process.env.NODE_ENV !== "production") {
      console.log(`[AUTH DEV] SMTP not configured. Credentials for ${email}: ${userCode} / ${password}`);
      return { sent: false, devLogged: true };
    }
    const err = new Error("Email is not configured on the server.");
    err.status = 503;
    throw err;
  }
  const subjects = {
    signup: `Your ${SITE_NAME} account details`,
    google: `Your ${SITE_NAME} account details`,
    reset: `Your new ${SITE_NAME} password`
  };
  await mail.transporter.sendMail({
    from: mail.SMTP_FROM,
    to: email,
    subject: subjects[reason] || subjects.signup,
    html: credentialsHtml({ name, userCode, email, password, reason }),
    text: credentialsText({ name, userCode, email, password })
  });
  return { sent: true };
}

module.exports = { sendCredentials, isConfigured };
