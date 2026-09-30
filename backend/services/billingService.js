"use strict";

/*
Stripe Checkout for the $20/month unlimited plan, using Stripe's REST API
directly (no extra npm package).

Env vars:
  STRIPE_SECRET_KEY   sk_live_... or sk_test_...   (required to take payments)
  STRIPE_PRICE_ID     optional - an existing recurring Price. If empty, a
                      $20/month price is created inline at checkout.
  PRO_PRICE_CENTS     optional, default 2000
*/

const STRIPE_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim();
const PRICE_ID = String(process.env.STRIPE_PRICE_ID || "").trim();
const PRICE_CENTS = Number(process.env.PRO_PRICE_CENTS || 2000);

const activeCache = new Map(); // subscriptionId -> { ok, at }
const CACHE_MS = 10 * 60 * 1000;

function configured() {
  return !!STRIPE_KEY;
}

async function stripe(method, path, form) {
  const res = await fetch("https://api.stripe.com" + path, {
    method,
    headers: {
      Authorization: "Bearer " + STRIPE_KEY,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form ? new URLSearchParams(form).toString() : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("[BILLING] Stripe error:", res.status, data && data.error && data.error.message);
    const err = new Error("Payments are temporarily unavailable.");
    err.status = 502;
    throw err;
  }
  return data;
}

async function createCheckout(email, baseUrl) {
  if (!configured()) {
    const err = new Error("Payments aren't switched on for this site yet. Please email support@assignmenthelp.com to upgrade.");
    err.status = 503;
    throw err;
  }
  const form = {
    mode: "subscription",
    "line_items[0][quantity]": "1",
    success_url: `${baseUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/?checkout=cancel`,
    allow_promotion_codes: "true",
    customer_email: email
  };
  if (PRICE_ID) {
    form["line_items[0][price]"] = PRICE_ID;
  } else {
    form["line_items[0][price_data][currency]"] = "usd";
    form["line_items[0][price_data][unit_amount]"] = String(PRICE_CENTS);
    form["line_items[0][price_data][recurring][interval]"] = "month";
    form["line_items[0][price_data][product_data][name]"] = "Assignment Help AI assistant - unlimited";
  }
  const session = await stripe("POST", "/v1/checkout/sessions", form);
  return session.url;
}

/* Confirm a finished Checkout Session and return who paid. */
async function confirmSession(sessionId) {
  if (!configured() || !/^cs_[A-Za-z0-9_]+$/.test(sessionId || "")) {
    const err = new Error("Invalid checkout session.");
    err.status = 400;
    throw err;
  }
  const s = await stripe("GET", `/v1/checkout/sessions/${sessionId}?expand[]=subscription`);
  const sub = s.subscription && typeof s.subscription === "object" ? s.subscription : null;
  const paid = s.status === "complete" && (s.payment_status === "paid" || s.payment_status === "no_payment_required");
  const live = sub && (sub.status === "active" || sub.status === "trialing");
  if (!paid || !live) {
    const err = new Error("We couldn't confirm that payment yet.");
    err.status = 402;
    throw err;
  }
  activeCache.set(sub.id, { ok: true, at: Date.now() });
  return {
    customer: typeof s.customer === "string" ? s.customer : s.customer && s.customer.id,
    subscription: sub.id,
    email: (s.customer_details && s.customer_details.email) || s.customer_email || null,
    details: describeSubscription(sub)
  };
}

const PLAN_NAME = String(process.env.PLAN_NAME || "Unlimited AI assistant").trim();

/* Stripe subscription object -> the fields we store and show to the customer. */
function describeSubscription(sub) {
  const item = sub.items && sub.items.data && sub.items.data[0];
  const price = item && item.price;
  const periodEnd = sub.current_period_end || (item && item.current_period_end) || null;
  return {
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer && sub.customer.id,
    subscriptionId: sub.id,
    plan: PLAN_NAME,
    status: sub.status,
    amountCents: price && price.unit_amount != null ? price.unit_amount : null,
    currency: price && price.currency ? String(price.currency).toUpperCase() : null,
    interval: price && price.recurring ? price.recurring.interval : null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end
  };
}

/* Latest state of one subscription straight from Stripe (null if unavailable). */
async function fetchSubscription(subscriptionId) {
  if (!configured() || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId || "")) return null;
  try {
    return describeSubscription(await stripe("GET", `/v1/subscriptions/${subscriptionId}`));
  } catch (error) {
    return null;
  }
}

/* Is this subscription still active? (cached, so cancellations take effect within ~10 minutes) */
async function subscriptionActive(subscriptionId) {
  if (!configured() || !subscriptionId) return true; // nothing to check against
  const hit = activeCache.get(subscriptionId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok;
  try {
    const sub = await stripe("GET", `/v1/subscriptions/${subscriptionId}`);
    const ok = sub.status === "active" || sub.status === "trialing";
    activeCache.set(subscriptionId, { ok, at: Date.now() });
    return ok;
  } catch (error) {
    return hit ? hit.ok : true; // don't lock out paying users if Stripe is briefly unreachable
  }
}

module.exports = { configured, createCheckout, confirmSession, subscriptionActive, describeSubscription, fetchSubscription };
