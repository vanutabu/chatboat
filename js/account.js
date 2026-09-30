/* Login, signup and account dashboard (vanilla JS, no dependencies). */
(function () {
"use strict";

var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

/* ---------- icons (inline SVG, stroke = currentColor) ---------- */
var P = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.5 7.6A16 16 0 0 0 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'
};
function svg(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || "") + "</svg>";
}
function paintIcons(root) {
  $$("[data-i]", root).forEach(function (el) {
    if (el.tagName === "SPAN" && el.className.indexOf("ic") === -1 && !el.classList.contains("tick")) { el.style.display = "inline-flex"; el.style.width = "18px"; }
    el.innerHTML = svg(el.getAttribute("data-i"));
  });
  $$("[data-eye]", root).forEach(function (b) { b.innerHTML = svg("eye"); });
}

/* ---------- helpers ---------- */
function toast(msg, kind) {
  var t = document.createElement("div");
  t.className = "toast " + (kind || "info");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(function () { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(function () { t.remove(); }, 320); }, 4200);
}

function api(path, opts) {
  opts = opts || {};
  var init = { method: opts.method || "GET", credentials: "same-origin", headers: { Accept: "application/json" } };
  if (opts.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  return fetch(path, init).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) { d.__status = r.status; d.__ok = r.ok; return d; });
  }).catch(function () { return { success: false, message: "Network problem. Please check your connection.", __status: 0 }; });
}

function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>' + (label ? "<span>" + esc(label) + "</span>" : ""); }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

function fieldError(id, msg) {
  var input = $("#" + id), box = input && input.closest(".field"), m = $("#" + id + "Msg");
  if (box) box.classList.toggle("bad", !!msg);
  if (m) m.textContent = msg || "";
}
function clearErrors(form) { $$(".field.bad", form).forEach(function (f) { f.classList.remove("bad"); }); $$(".msg", form).forEach(function (m) { m.textContent = ""; }); }

function wireEyes() {
  $$("[data-eye]").forEach(function (b) {
    b.addEventListener("click", function () {
      var input = $("#" + b.getAttribute("data-eye"));
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      b.innerHTML = svg(show ? "eyeoff" : "eye");
      b.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });
}

function safeNext() {
  var n = new URLSearchParams(location.search).get("next") || "";
  return /^\/[A-Za-z0-9\-_/]*$/.test(n) && n.indexOf("//") !== 0 ? n : "/account";
}

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ---------- Google sign-in ---------- */
function initGoogle() {
  var wrap = $("#gWrap"), holder = $("#gbtn");
  if (!wrap || !holder) return;
  wrap.hidden = true;
  api("/api/auth/config").then(function (cfg) {
    if (!cfg.google || !cfg.google.clientId) return;
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = function () {
      if (!window.google || !google.accounts) return;
      google.accounts.id.initialize({
        client_id: cfg.google.clientId,
        ux_mode: "popup",
        callback: function (resp) {
          api("/api/auth/google", { method: "POST", body: { credential: resp.credential } }).then(function (d) {
            if (d.success) {
              toast(d.message || "Signed in.", "ok");
              setTimeout(function () { location.href = safeNext(); }, d.isNewUser ? 1600 : 500);
            } else toast(d.message || "Google sign-in failed.", "err");
          });
        }
      });
      google.accounts.id.renderButton(holder, { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: Math.min(360, holder.parentNode.clientWidth || 360) });
      wrap.hidden = false;
    };
    document.head.appendChild(s);
  });
}

/* ---------- pages ---------- */
function loginPage() {
  api("/api/account/me").then(function (d) { if (d.success) location.replace(safeNext()); });
  var form = $("#loginForm");
  form.addEventListener("submit", function (e) {
    e.preventDefault(); clearErrors(form);
    var ident = $("#identifier").value.trim(), pw = $("#password").value;
    var bad = false;
    if (!ident) { fieldError("identifier", "Enter your User ID or email."); bad = true; }
    if (!pw) { fieldError("password", "Enter your password."); bad = true; }
    if (bad) return;
    var btn = $("#loginBtn"); busy(btn, true, "Logging in…");
    api("/api/auth/login", { method: "POST", body: { identifier: ident, password: pw } }).then(function (d) {
      if (d.success) { toast("Welcome back, " + d.user.name.split(" ")[0] + "!", "ok"); setTimeout(function () { location.href = safeNext(); }, 450); }
      else { busy(btn, false); fieldError("password", d.message || "Could not log in."); $("#password").focus(); $("#password").select(); }
    });
  });
  $("#showForgot").addEventListener("click", function (e) { e.preventDefault(); $("#loginCard").hidden = true; $("#forgotCard").hidden = false; $("#fIdent").value = $("#identifier").value; $("#fIdent").focus(); });
  $("#backLogin").addEventListener("click", function (e) { e.preventDefault(); $("#forgotCard").hidden = true; $("#loginCard").hidden = false; });
  $("#forgotForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var v = $("#fIdent").value.trim(); if (!v) return toast("Enter your User ID or email.", "err");
    var btn = $("#forgotBtn"); busy(btn, true, "Sending…");
    api("/api/auth/forgot", { method: "POST", body: { identifier: v } }).then(function (d) {
      busy(btn, false);
      toast(d.message || "If an account exists, a new password has been emailed.", d.__ok ? "ok" : "err");
      if (d.__ok) { $("#forgotCard").hidden = true; $("#loginCard").hidden = false; $("#identifier").value = v; $("#password").focus(); }
    });
  });
  initGoogle();
}

function signupPage() {
  var form = $("#signupForm");
  form.addEventListener("submit", function (e) {
    e.preventDefault(); clearErrors(form);
    var name = $("#name").value.trim(), email = $("#email").value.trim(), phone = $("#phone").value.trim(), bad = false;
    if (name.length < 2) { fieldError("name", "Please enter your full name."); bad = true; }
    if (!EMAIL_RE.test(email)) { fieldError("email", "Please enter a valid email address."); bad = true; }
    if (phone && !/^[0-9+()\-\s.]{5,25}$/.test(phone)) { fieldError("phone", "Please enter a valid phone number."); bad = true; }
    if (bad) return;
    var btn = $("#signupBtn"); busy(btn, true, "Creating account…");
    api("/api/auth/signup", { method: "POST", body: { name: name, email: email, phone: phone } }).then(function (d) {
      busy(btn, false);
      if (d.success) { $("#doneMsg").textContent = d.message; $("#signupCard").hidden = true; $("#doneCard").hidden = false; }
      else if (d.__status === 409) fieldError("email", d.message);
      else toast(d.message || "Could not create your account.", "err");
    });
  });
  initGoogle();
}

function accountPage() {
  var state = { user: null, sub: null, orders: [], page: 1, totalPages: 1, total: 0, timer: null };

  function fmtDate(v, withTime) {
    if (!v) return "—";
    var d = new Date(v); if (isNaN(d)) return String(v);
    return d.toLocaleString(undefined, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
  }
  function pillClass(s) {
    s = String(s || "").toLowerCase();
    if (/complete|deliver|done|closed/.test(s)) return "done";
    if (/progress|review|working|assign|process/.test(s)) return "prog";
    if (/cancel|reject|refund/.test(s)) return "bad";
    return "new";
  }
  function orderRow(o) {
    return '<button class="order" type="button" data-order="' + esc(o.orderId) + '">' +
      '<span class="t">' + esc(o.subject || "Assignment") + "</span>" +
      '<span class="pill ' + pillClass(o.status) + '">' + esc(o.status) + "</span>" +
      '<span class="m"><span>Order #' + esc(o.orderId) + "</span><span>Deadline: " + esc(o.deadlineDate || "—") + (o.deadlineTime ? " " + esc(o.deadlineTime) : "") + "</span><span>Submitted " + esc(fmtDate(o.submittedAt)) + "</span>" + (o.attachmentCount ? "<span>" + o.attachmentCount + " file" + (o.attachmentCount > 1 ? "s" : "") + "</span>" : "") + "</span></button>";
  }
  var emptyOrders = '<div class="empty">' + svg("box") + "<div><b>No orders yet</b></div><div>Orders you submit with your email will appear here.</div><p><a class=\"btn sm\" style=\"text-decoration:none\" href=\"/#hero\">Place an order</a></p></div>";

  function renderProfile() {
    var u = state.user, initials = u.name.split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase();
    $("#profile").innerHTML =
      '<div class="avatar">' + (u.avatarUrl ? '<img src="' + esc(u.avatarUrl) + '" alt="" referrerpolicy="no-referrer">' : esc(initials)) + "</div>" +
      "<div><h1>" + esc(u.name) + '</h1><div class="em">' + esc(u.email) + "</div>" +
      '<div class="chips"><button class="chip" type="button" id="copyId" title="Copy User ID">User ID <code>' + esc(u.userId) + "</code> " + svg("copy").replace("<svg", '<svg width="14" height="14"') + "</button>" +
      '<span class="chip">' + (u.provider === "google" ? "Google account" : "Email account") + "</span>" +
      '<span class="chip">Member since ' + esc(fmtDate(u.memberSince)) + "</span></div></div>";
    $("#copyId").addEventListener("click", function () {
      (navigator.clipboard ? navigator.clipboard.writeText(u.userId) : Promise.reject()).then(function () { toast("User ID copied.", "ok"); }, function () { toast("Copy failed. Your User ID is " + u.userId, "info"); });
    });
    $("#banner").hidden = !u.mustChangePassword;
    $("#pName").value = u.name; $("#pEmail").value = u.email; $("#pPhone").value = u.phone || "";
  }

  function renderSub() {
    var s = state.sub, el = $("#sub");
    if (!s.active && s.status === "none") {
      el.innerHTML = '<div class="plan"><h3>Free plan <span class="pill">No subscription</span></h3><p style="color:var(--muted)">' + esc(s.message) + '</p><a class="btn sm" style="text-decoration:none;width:auto;display:inline-flex" href="/">Get unlimited AI assistant</a></div>';
      return;
    }
    el.innerHTML = '<div class="plan ' + (s.active ? "on" : "") + '"><h3>' + esc(s.plan) + ' <span class="pill ' + (s.active ? "done" : "bad") + '">' + esc(s.status) + '</span></h3><p style="color:var(--muted);margin:6px 0 0">' + esc(s.message) + "</p>" +
      '<div class="kv"><div><small>Price</small><b>' + esc(s.price || "—") + (s.interval ? " / " + esc(s.interval) : "") + "</b></div>" +
      "<div><small>" + (s.cancelAtPeriodEnd ? "Ends on" : "Renews on") + "</small><b>" + esc(fmtDate(s.currentPeriodEnd)) + "</b></div>" +
      "<div><small>Started</small><b>" + esc(fmtDate(s.startedAt)) + "</b></div></div></div>";
  }

  function renderTiles() {
    var s = state.sub;
    $("#tiles").innerHTML =
      '<div class="tile"><div class="k">Current plan</div><div class="v">' + esc(s.active ? s.plan : "Free") + '</div><div class="s">' + (s.active ? (s.cancelAtPeriodEnd ? "Ends " : "Renews ") + esc(fmtDate(s.currentPeriodEnd)) : "No active subscription") + "</div></div>" +
      '<div class="tile"><div class="k">Orders submitted</div><div class="v">' + state.total + '</div><div class="s">All time</div></div>' +
      '<div class="tile"><div class="k">Last login</div><div class="v" style="font-size:1.05rem">' + esc(fmtDate(state.user.lastLogin, true)) + '</div><div class="s">Secure session</div></div>';
  }

  function renderOrders(reset) {
    $("#recent").innerHTML = state.orders.length ? state.orders.slice(0, 5).map(orderRow).join("") : emptyOrders;
    $("#orders").innerHTML = state.orders.length ? state.orders.map(orderRow).join("") : emptyOrders;
    $("#more").hidden = state.page >= state.totalPages;
  }

  function loadOverview(quiet) {
    return api("/api/account/overview").then(function (d) {
      if (d.__status === 401) { location.replace("/login?next=/account"); return; }
      if (!d.success) { if (!quiet) toast(d.message || "Could not load your account.", "err"); return; }
      state.user = d.user; state.sub = d.subscription;
      state.orders = d.orders.orders; state.page = 1; state.totalPages = d.orders.totalPages; state.total = d.orders.total;
      renderProfile(); renderTiles(); renderSub(); renderOrders();
      $("#liveTxt").textContent = "Live · updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    });
  }

  function openModal(html) { $("#mBody").innerHTML = html; $("#modal").classList.add("open"); $("#mClose").focus(); }
  function closeModal() { $("#modal").classList.remove("open"); }
  function showOrder(id) {
    openModal('<div class="sk"></div>');
    api("/api/account/orders/" + encodeURIComponent(id)).then(function (d) {
      if (!d.success) { closeModal(); return toast(d.message || "Could not load this order.", "err"); }
      var o = d.order;
      openModal('<h3 id="mTitle">' + esc(o.subject || "Assignment") + '</h3><p style="margin:0 0 10px"><span class="pill ' + pillClass(o.status) + '">' + esc(o.status) + '</span> &nbsp;<span style="color:var(--muted);font-size:.85rem">Order #' + esc(o.orderId) + "</span></p>" +
        '<div class="kv"><div><small>Submitted</small><b>' + esc(fmtDate(o.submittedAt, true)) + "</b></div><div><small>Deadline</small><b>" + esc(o.deadlineDate || "—") + " " + esc(o.deadlineTime || "") + "</b></div><div><small>Contact</small><b style=\"font-size:.85rem;word-break:break-all\">" + esc(o.email) + "</b></div></div>" +
        "<b>Your requirements</b><div class=\"desc\">" + esc(o.details || "—") + "</div>" +
        (o.files.length ? '<b>Attachments</b><div class="files">' + o.files.map(function (f) { return '<a href="' + esc(f.downloadUrl) + '" download><span>' + svg("file").replace("<svg", '<svg width="16" height="16" style="vertical-align:-3px"') + " " + esc(f.name) + "</span><span style=\"color:var(--muted)\">" + Math.max(1, Math.round(f.size / 1024)) + " KB</span></a>"; }).join("") + "</div>" : ""));
    });
  }

  function go(tab) {
    $$(".tab").forEach(function (t) { t.setAttribute("aria-selected", String(t.dataset.tab === tab)); });
    $$(".panel").forEach(function (p) { p.hidden = p.id !== "p-" + tab; });
    if (history.replaceState) history.replaceState(null, "", "#" + tab);
  }

  /* events */
  $$(".tab").forEach(function (t) { t.addEventListener("click", function () { go(t.dataset.tab); }); });
  $$("[data-go]").forEach(function (b) { b.addEventListener("click", function () { go(b.dataset.go); $("#curPw").focus(); }); });
  document.addEventListener("click", function (e) { var b = e.target.closest("[data-order]"); if (b) showOrder(b.getAttribute("data-order")); });
  $("#mClose").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  $("#more").addEventListener("click", function () {
    var btn = $("#more"); busy(btn, true);
    api("/api/account/orders?page=" + (state.page + 1)).then(function (d) {
      busy(btn, false);
      if (d.success) { state.page = d.page; state.totalPages = d.totalPages; state.orders = state.orders.concat(d.orders); renderOrders(); }
    });
  });
  $("#logoutBtn").addEventListener("click", function () { api("/api/auth/logout", { method: "POST" }).then(function () { location.href = "/login"; }); });

  $("#profileForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("#profileBtn"); busy(btn, true, "Saving…");
    api("/api/account/me", { method: "PATCH", body: { name: $("#pName").value, phone: $("#pPhone").value } }).then(function (d) {
      busy(btn, false);
      if (d.success) { state.user = d.user; renderProfile(); toast("Profile updated.", "ok"); } else toast(d.message || "Could not save.", "err");
    });
  });

  $("#newPw").addEventListener("input", function () {
    var v = this.value, score = 0;
    if (v.length >= 8) score++; if (v.length >= 12) score++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++; if (/\d/.test(v)) score++; if (/[^A-Za-z0-9]/.test(v)) score++;
    var m = $("#meter"); m.style.width = (score * 20) + "%"; m.style.background = score < 3 ? "#ef4444" : score < 4 ? "#f59e0b" : "#10b981";
  });
  $("#pwForm").addEventListener("submit", function (e) {
    e.preventDefault(); $("#pwMsg").textContent = "";
    var cur = $("#curPw").value, next = $("#newPw").value;
    if (!cur || !next) { $("#pwMsg").textContent = "Fill in both fields."; return; }
    var btn = $("#pwBtn"); busy(btn, true, "Updating…");
    api("/api/auth/change-password", { method: "POST", body: { currentPassword: cur, newPassword: next } }).then(function (d) {
      busy(btn, false);
      if (d.success) { $("#pwForm").reset(); $("#meter").style.width = "0"; toast("Password updated.", "ok"); $("#banner").hidden = true; }
      else $("#pwMsg").textContent = d.message || "Could not update password.";
    });
  });

  /* live refresh while the tab is visible */
  function tick() { if (!document.hidden) loadOverview(true); }
  state.timer = setInterval(tick, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) loadOverview(true); });

  var start = (location.hash || "").replace("#", "");
  loadOverview().then(function () { if (["overview", "orders", "subscription", "settings"].indexOf(start) > -1) go(start); });
}

/* ---------- boot ---------- */
document.addEventListener("DOMContentLoaded", function () {
  paintIcons(document); wireEyes();
  var page = document.body.getAttribute("data-page");
  if (page === "login") loginPage();
  else if (page === "signup") signupPage();
  else if (page === "account") accountPage();
});
})();
