import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

import { buildPaymentLedgerFields } from "../_shared/paymentLedger.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" })
  : null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Same labels as manual checkout (`CheckoutDialog`) for reporting. */
const CHECKOUT_PAYMENT_METHODS = new Set([
  "Cash",
  "E-Transfer",
  "Amex",
  "Mastercard",
  "Visa",
  "Debit",
  "Other",
]);

/** Collapsed lowercase key (no spaces/hyphens) -> checkout label */
const CHECKOUT_BY_COLLAPSED = (() => {
  const m = new Map<string, string>();
  for (const label of CHECKOUT_PAYMENT_METHODS) {
    const key = label.toLowerCase().replace(/[\s-]+/g, "");
    m.set(key, label);
  }
  return m;
})();

/** Legacy deposit API / aliases not matching checkout spelling (collapsed key) */
const LEGACY_DEPOSIT_ALIASES: Record<string, string> = {
  cardterminal: "Debit",
  pos: "Debit",
  terminal: "Debit",
  interac: "Debit",
};

function collapseMethodKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function normalizeCheckoutPaymentMethod(raw: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (CHECKOUT_PAYMENT_METHODS.has(trimmed)) return trimmed;

  const collapsed = collapseMethodKey(trimmed);
  if (!collapsed) return null;

  const checkout = CHECKOUT_BY_COLLAPSED.get(collapsed);
  if (checkout) return checkout;

  const legacy = LEGACY_DEPOSIT_ALIASES[collapsed];
  if (legacy && CHECKOUT_PAYMENT_METHODS.has(legacy)) return legacy;

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const appointmentId = body.appointmentId as string | undefined;
    const rawMethod = (body.method as string) || "Cash";
    const method = normalizeCheckoutPaymentMethod(rawMethod);
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
    const rawAmount = body.amount;

    if (!appointmentId) {
      return json({ error: "Missing appointmentId" }, 400);
    }
    if (!method) {
      return json({
        error: `Invalid payment method. Use checkout options: ${[...CHECKOUT_PAYMENT_METHODS].join(", ")}`,
      }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: staffUser, error: staffErr } = await supabase
      .from("users")
      .select("studio_id")
      .eq("id", user.id)
      .maybeSingle();

    if (staffErr || !staffUser?.studio_id) {
      return json({ error: "Staff profile not found" }, 403);
    }

    const { data: appointment, error: aptErr } = await supabase
      .from("appointments")
      .select("*, studio:studios(*)")
      .eq("id", appointmentId)
      .single();

    if (aptErr || !appointment) {
      return json({ error: "Appointment not found" }, 404);
    }

    if (appointment.studio_id !== staffUser.studio_id) {
      return json({ error: "Forbidden" }, 403);
    }

    const studio = appointment.studio as Record<string, unknown> | null;
    const depositDue = Number(appointment.deposit_amount) || 0;
    if (depositDue <= 0) {
      return json({ error: "This appointment has no deposit amount set" }, 400);
    }

    let amount = depositDue;
    if (rawAmount != null && rawAmount !== "") {
      const parsed = Number(rawAmount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return json({ error: "Invalid amount" }, 400);
      }
      amount = Math.round(parsed * 100) / 100;
      if (amount > depositDue + 0.009) {
        return json(
          {
            error: `Amount cannot exceed deposit due (${depositDue.toFixed(2)})`,
          },
          400,
        );
      }
    }

    const { data: existingPayments } = await supabase
      .from("payments")
      .select("*")
      .eq("appointment_id", appointmentId)
      .eq("payment_type", "deposit")
      .in("status", ["pending", "paid"])
      .order("created_at", { ascending: false });

    const paidPayment = existingPayments?.find((p: { status: string }) => p.status === "paid");
    if (appointment.deposit_status === "paid" || paidPayment) {
      await expirePendingDepositSessions(
        supabase,
        studio as { stripe_account_id?: string } | null,
        existingPayments?.filter((p: { status: string }) => p.status === "pending") || [],
      );
      await supabase
        .from("appointments")
        .update({ status: "deposit_paid", deposit_status: "paid" })
        .eq("id", appointmentId);

      return json({
        ok: true,
        already_paid: true,
        message:
          "Deposit was already paid. Any open online payment link has been invalidated.",
      });
    }

    await expirePendingDepositSessions(
      supabase,
      studio as { stripe_account_id?: string } | null,
      existingPayments?.filter((p: { status: string }) => p.status === "pending") || [],
    );

    const currency = String(studio?.currency || "USD");
    const paidAt = new Date().toISOString();
    const ledger = buildPaymentLedgerFields({
      locationId: appointment.location_id,
      timezone: studio?.timezone as string | undefined,
      paidAt,
      tenderType: method,
      channel: "in_person",
      purpose: "deposit",
    });

    await supabase.from("payments").insert({
      studio_id: appointment.studio_id,
      appointment_id: appointmentId,
      customer_id: appointment.customer_id || null,
      location_id: ledger.location_id,
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null,
      amount,
      currency,
      status: "paid",
      payment_type: "deposit",
      checkout_url: null,
      paid_at: paidAt,
      expires_at: null,
      business_date: ledger.business_date,
      tender_type: ledger.tender_type,
      channel: ledger.channel,
      purpose: ledger.purpose,
      occurred_at: ledger.occurred_at,
      metadata: {
        appointment_id: appointmentId,
        collection_channel: "in_person",
        method,
        note: note || undefined,
        recorded_by_user_id: user.id,
      },
    });

    await supabase
      .from("appointments")
      .update({ status: "deposit_paid", deposit_status: "paid" })
      .eq("id", appointmentId);

    return json({
      ok: true,
      already_paid: false,
      message: "Deposit recorded. Any open online payment link has been invalidated.",
    });
  } catch (err) {
    console.error("record-in-person-deposit error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: message }, 500);
  }
});

async function expirePendingDepositSessions(
  supabase: ReturnType<typeof createClient>,
  studio: { stripe_account_id?: string } | null | undefined,
  pendingPayments: Array<{ id: string; stripe_checkout_session_id?: string | null }>,
) {
  const accountId = studio?.stripe_account_id;
  const pendingIds: string[] = [];

  for (const p of pendingPayments) {
    if (!p.stripe_checkout_session_id || !accountId || !stripe) {
      if (p.id) pendingIds.push(p.id);
      continue;
    }
    try {
      await stripe.checkout.sessions.expire(p.stripe_checkout_session_id, {
        stripeAccount: accountId,
      });
    } catch {
      // Session may already be expired or completed
    }
    pendingIds.push(p.id);
  }

  if (pendingIds.length) {
    await supabase
      .from("payments")
      .update({ status: "expired" })
      .in("id", pendingIds);
  }
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
