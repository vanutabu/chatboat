"use strict";

/* Ties Stripe subscriptions to customer accounts and shapes them for the API. */

const store = require("./userStore");
const billing = require("./billingService");

const STALE_MS = 10 * 60 * 1000;

/* After a confirmed Checkout: save the subscription on the logged-in account,
   or on the account that owns the paying email. */
async function linkFromCheckout(user, claims) {
  const details = claims && claims.details;
  if (!details || !details.subscriptionId) return null;
  let owner = user || null;
  if (!owner && claims.email) owner = await store.findByEmail(String(claims.email).toLowerCase());
  if (!owner) return null;
  return store.upsertSubscription(owner.id, details);
}

function money(cents, currency) {
  if (cents == null) return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || ""}`.trim();
  }
}

function shape(row) {
  if (!row) {
    return {
      active: false, plan: "Free", status: "none",
      message: "You don't have an active subscription."
    };
  }
  const active = row.status === "active" || row.status === "trialing";
  return {
    active,
    plan: row.plan,
    status: row.status,
    price: money(row.amount_cents, row.currency),
    interval: row.billing_interval || null,
    startedAt: row.created_at,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: !!row.cancel_at_period_end,
    message: !active
      ? "Your subscription is not active."
      : row.cancel_at_period_end
        ? "Your plan is active and will end at the close of the current billing period."
        : "Your plan is active and renews automatically."
  };
}

/* The account's current subscription, re-checked with Stripe when the saved copy is stale. */
async function currentFor(user) {
  let row = await store.getSubscription(user.id);
  if (row && row.stripe_subscription_id && Date.now() - new Date(row.updated_at).getTime() > STALE_MS) {
    const fresh = await billing.fetchSubscription(row.stripe_subscription_id);
    if (fresh) row = await store.upsertSubscription(user.id, fresh);
  }
  return shape(row);
}

module.exports = { linkFromCheckout, currentFor, shape };
