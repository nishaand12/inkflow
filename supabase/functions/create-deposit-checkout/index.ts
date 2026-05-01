import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") || "https://inkflow.app";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401);
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const userClient = createClient(SUPABASE_URL, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { appointmentId } = await req.json();
    if (!appointmentId) {
      return json({ error: "Missing appointmentId" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: appointment, error: aptErr } = await supabase
      .from("appointments")
      .select("*, studio:studios(*), customer:customers(*)")
      .eq("id", appointmentId)
      .single();

    if (aptErr || !appointment) {
      return json({ error: "Appointment not found" }, 404);
    }

    const studio = appointment.studio;
    if (!studio?.stripe_account_id || !studio.stripe_charges_enabled) {
      return json({ error: "Studio Stripe account not connected or charges not enabled" }, 400);
    }

    const depositAmount = appointment.deposit_amount;
    if (!depositAmount || depositAmount <= 0) {
      return json({ error: "No deposit amount set on this appointment" }, 400);
    }

    // The appointment row can be stale after webhook/update races. Use payment rows
    // and Stripe session state as the source of truth before creating a new link.
    const { data: existingPayments } = await supabase
      .from("payments")
      .select("*")
      .eq("appointment_id", appointmentId)
      .eq("payment_type", "deposit")
      .in("status", ["pending", "paid"])
      .order("created_at", { ascending: false });

    const paidPayment = existingPayments?.find((p: any) => p.status === "paid");
    if (appointment.deposit_status === "paid" || paidPayment) {
      const pendingIdsToExpire = (existingPayments || [])
        .filter((p: any) => p.status === "pending")
        .map((p: any) => p.id);
      for (const pendingPayment of (existingPayments || []).filter((p: any) => p.status === "pending")) {
        if (!pendingPayment.stripe_checkout_session_id) continue;
        try {
          await stripe.checkout.sessions.expire(pendingPayment.stripe_checkout_session_id, {
            stripeAccount: studio.stripe_account_id,
          });
        } catch (_) {
          // Already-paid or already-expired sessions cannot be expired; local state is cleaned below.
        }
      }
      if (pendingIdsToExpire.length) {
        await supabase
          .from("payments")
          .update({ status: "expired" })
          .in("id", pendingIdsToExpire);
      }
      await supabase
        .from("appointments")
        .update({ status: "deposit_paid", deposit_status: "paid" })
        .eq("id", appointmentId);
      return json({ paid: true, session_id: paidPayment?.stripe_checkout_session_id || null });
    }

    const now = new Date();
    const pendingPayments = existingPayments?.filter((p: any) => p.status === "pending") || [];
    const staleIds: string[] = [];
    let reusablePayment: any = null;

    for (const activePayment of pendingPayments) {
      if (!activePayment?.stripe_checkout_session_id || !activePayment?.checkout_url) {
        staleIds.push(activePayment.id);
        continue;
      }

      const session = await stripe.checkout.sessions.retrieve(
        activePayment.stripe_checkout_session_id,
        { stripeAccount: studio.stripe_account_id }
      );

      if (session.payment_status === "paid") {
        await supabase
          .from("payments")
          .update({
            status: "paid",
            stripe_payment_intent_id:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : null,
            paid_at: new Date().toISOString(),
          })
          .eq("id", activePayment.id);

        await supabase
          .from("appointments")
          .update({ status: "deposit_paid", deposit_status: "paid" })
          .eq("id", appointmentId);

        return json({ paid: true, session_id: activePayment.stripe_checkout_session_id });
      }

      const sessionExpiresAt = session.expires_at ? new Date(session.expires_at * 1000) : null;
      if (session.status === "open" && (!sessionExpiresAt || sessionExpiresAt > now)) {
        if (!reusablePayment) {
          reusablePayment = activePayment;
          continue;
        }

        try {
          await stripe.checkout.sessions.expire(activePayment.stripe_checkout_session_id, {
            stripeAccount: studio.stripe_account_id,
          });
        } catch (expireErr) {
          console.error("Failed to expire duplicate deposit session:", expireErr);
        }
        staleIds.push(activePayment.id);
        continue;
      }

      staleIds.push(activePayment.id);
    }

    if (staleIds.length) {
      await supabase
        .from("payments")
        .update({ status: "expired" })
        .in("id", staleIds);
    }

    if (reusablePayment) {
      return json({
        checkout_url: reusablePayment.checkout_url,
        session_id: reusablePayment.stripe_checkout_session_id,
        reused: true,
      });
    }

    const { data: currentPaidPayment } = await supabase
      .from("payments")
      .select("id,stripe_checkout_session_id")
      .eq("appointment_id", appointmentId)
      .eq("payment_type", "deposit")
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (currentPaidPayment) {
      await supabase
        .from("appointments")
        .update({ status: "deposit_paid", deposit_status: "paid" })
        .eq("id", appointmentId);
      return json({ paid: true, session_id: currentPaidPayment.stripe_checkout_session_id });
    }

    const customerEmail =
      appointment.client_email?.trim() ||
      appointment.customer?.email?.trim() ||
      undefined;

    const currency = (studio.currency || "USD").toLowerCase();
    const unitAmount = Math.round(depositAmount * 100);

    const expiresAt = Math.floor(Date.now() / 1000) + 86400; // 24 hours from now
    const idempotencyKey = `deposit-${appointmentId}-${new Date().toISOString().slice(0, 10)}`;

    // Direct charge: create session on the connected account
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency,
              product_data: {
                name: `Deposit – ${studio.name}`,
                description: `Appointment on ${appointment.appointment_date} at ${appointment.start_time}`,
              },
              unit_amount: unitAmount,
            },
            quantity: 1,
          },
        ],
        customer_email: customerEmail,
        expires_at: expiresAt,
        success_url: `${APP_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&studio=${encodeURIComponent(studio.name)}&type=deposit`,
        cancel_url: `${APP_URL}/payment-cancelled?appointment_id=${appointmentId}&studio=${encodeURIComponent(studio.name)}`,
        metadata: {
          appointment_id: appointmentId,
          studio_id: studio.id,
          customer_id: appointment.customer_id || "",
          payment_type: "deposit",
        },
      },
      { stripeAccount: studio.stripe_account_id, idempotencyKey }
    );

    await supabase.from("payments").insert({
      studio_id: studio.id,
      appointment_id: appointmentId,
      customer_id: appointment.customer_id || null,
      stripe_checkout_session_id: session.id,
      amount: depositAmount,
      currency: studio.currency || "USD",
      status: "pending",
      payment_type: "deposit",
      checkout_url: session.url,
      expires_at: new Date(expiresAt * 1000).toISOString(),
      metadata: { appointment_id: appointmentId },
    });

    await supabase
      .from("appointments")
      .update({ deposit_status: "pending" })
      .eq("id", appointmentId);

    return json({ checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error("create-deposit-checkout error:", err);
    return json({ error: err.message || "Unknown error" }, 500);
  }
});

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
