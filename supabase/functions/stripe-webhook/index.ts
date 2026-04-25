import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, stripe-signature",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return new Response("Missing stripe-signature header", { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        const appointmentId = session.metadata?.appointment_id;
        const paymentType = session.metadata?.payment_type || "deposit";

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
          .eq("stripe_checkout_session_id", session.id);

        if (appointmentId) {
          if (paymentType === "checkout") {
            const chargeAmount = session.metadata?.charge_amount
              ? parseFloat(session.metadata.charge_amount)
              : null;
            const taxAmount = session.metadata?.tax_amount
              ? parseFloat(session.metadata.tax_amount)
              : null;

            await supabase
              .from("appointments")
              .update({
                status: "completed",
                charge_amount: chargeAmount,
                tax_amount: taxAmount,
                payment_method: "Card",
              })
              .eq("id", appointmentId);
          } else {
            await supabase
              .from("appointments")
              .update({ status: "deposit_paid", deposit_status: "paid" })
              .eq("id", appointmentId);
          }
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const appointmentId = session.metadata?.appointment_id;

        await supabase
          .from("payments")
          .update({ status: "expired" })
          .eq("stripe_checkout_session_id", session.id);

        if (appointmentId) {
          // Only reset to 'none' if there are no other paid payments for this appointment
          const { data: paidPayments } = await supabase
            .from("payments")
            .select("id")
            .eq("appointment_id", appointmentId)
            .eq("status", "paid")
            .limit(1);

          if (!paidPayments?.length) {
            await supabase
              .from("appointments")
              .update({ deposit_status: "none" })
              .eq("id", appointmentId);
          }
        }
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const appointmentId = session.metadata?.appointment_id;

        await supabase
          .from("payments")
          .update({ status: "failed" })
          .eq("stripe_checkout_session_id", session.id);

        if (appointmentId) {
          await supabase
            .from("appointments")
            .update({ deposit_status: "failed" })
            .eq("id", appointmentId);
        }
        break;
      }

      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        await supabase
          .from("studios")
          .update({
            stripe_onboarding_complete: account.details_submitted,
            stripe_charges_enabled: account.charges_enabled,
            stripe_payouts_enabled: account.payouts_enabled,
          })
          .eq("stripe_account_id", account.id);
        break;
      }

      case "account.application.deauthorized": {
        const connectedAccountId = event.account;
        if (connectedAccountId) {
          await supabase
            .from("studios")
            .update({
              stripe_account_id: null,
              stripe_onboarding_complete: false,
              stripe_charges_enabled: false,
              stripe_payouts_enabled: false,
            })
            .eq("stripe_account_id", connectedAccountId);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("stripe-webhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
