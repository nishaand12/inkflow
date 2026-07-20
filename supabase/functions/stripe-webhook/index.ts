import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { mergeStripeDepositPaidMetadata } from "../_shared/stripeDepositPaymentMetadata.ts";
import { buildPaymentLedgerFields } from "../_shared/paymentLedger.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

/**
 * Fire the appointment confirmation email. send-appointment-email skips
 * duplicates via email_send_status, so this is safe to call on every deposit
 * payment. Failures are logged but never fail the webhook: returning non-2xx
 * would make Stripe retry the whole event just to resend an email.
 */
async function triggerConfirmationEmail(appointmentId: string) {
  try {
    const key = SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY;
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-appointment-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        appointmentId,
        eventType: "created",
        source: "public_booking",
      }),
    });
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.error("Confirmation email trigger failed:", response.status, details);
    }
  } catch (emailErr) {
    console.error("Failed to trigger confirmation email:", emailErr);
  }
}

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

        const { data: paymentRow } = await supabase
          .from("payments")
          .select("metadata")
          .eq("stripe_checkout_session_id", session.id)
          .maybeSingle();

        const { data: aptRow } = appointmentId
          ? await supabase
            .from("appointments")
            .select("id, location_id, studio:studios(timezone)")
            .eq("id", appointmentId)
            .maybeSingle()
          : { data: null };

        const paidAt = new Date().toISOString();
        const studioTz = (aptRow?.studio as { timezone?: string } | null)?.timezone;
        const ledger = buildPaymentLedgerFields({
          locationId: aptRow?.location_id,
          timezone: studioTz,
          paidAt,
          tenderType: "Stripe",
          channel: "online",
          purpose: paymentType === "deposit" ? "deposit" : "balance",
        });

        const payUpdate: Record<string, unknown> = {
          status: "paid",
          stripe_payment_intent_id:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : null,
          paid_at: paidAt,
          location_id: ledger.location_id,
          business_date: ledger.business_date,
          tender_type: ledger.tender_type,
          channel: ledger.channel,
          purpose: ledger.purpose,
          occurred_at: ledger.occurred_at,
        };
        if (paymentType === "deposit") {
          payUpdate.metadata = mergeStripeDepositPaidMetadata(
            paymentRow?.metadata as Record<string, unknown> | null | undefined,
          );
        }

        const { error: payUpdateErr } = await supabase
          .from("payments")
          .update(payUpdate)
          .eq("stripe_checkout_session_id", session.id);

        // Surface DB failures as 500 so Stripe retries the event instead of
        // silently dropping the payment.
        if (payUpdateErr) {
          console.error("payments paid update failed:", payUpdateErr);
          throw new Error(`payments update failed: ${payUpdateErr.message}`);
        }

        if (appointmentId) {
          // Online payments are deposits only; service checkout happens
          // in-person via finalize_sale. A non-deposit session here means a
          // stale/unknown creator — record the payment but leave the
          // appointment untouched.
          if (paymentType !== "deposit") {
            console.error(
              `Unexpected non-deposit checkout session ${session.id} (payment_type=${paymentType}); appointment not updated.`,
            );
            break;
          }

          const { error: aptUpdateErr } = await supabase
            .from("appointments")
            .update({ status: "deposit_paid", deposit_status: "paid" })
            .eq("id", appointmentId);

          if (aptUpdateErr) {
            console.error("appointment deposit_paid update failed:", aptUpdateErr);
            throw new Error(
              `appointment update failed: ${aptUpdateErr.message}`,
            );
          }

          // Public bookings are held unconfirmed (pending_deposit) and only
          // emailed once the deposit is paid. Staff-created appointments were
          // already emailed at creation; the email function dedupes those.
          await triggerConfirmationEmail(appointmentId);
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;

        const { data: payRow } = await supabase
          .from("payments")
          .select("appointment_id, payment_type")
          .eq("stripe_checkout_session_id", session.id)
          .maybeSingle();

        await supabase
          .from("payments")
          .update({ status: "expired" })
          .eq("stripe_checkout_session_id", session.id);

        const appointmentId =
          payRow?.appointment_id || session.metadata?.appointment_id;
        const effectiveType = payRow?.payment_type ||
          session.metadata?.payment_type;

        // Service checkout expiry must not clear a pending or paid deposit.
        if (!appointmentId || effectiveType !== "deposit") {
          break;
        }

        const { data: paidDepositRows } = await supabase
          .from("payments")
          .select("id")
          .eq("appointment_id", appointmentId)
          .eq("payment_type", "deposit")
          .eq("status", "paid")
          .limit(1);

        if (!paidDepositRows?.length) {
          // Duplicate-session cleanup expires sessions for appointments that
          // still have another live checkout; those must not be touched.
          const { data: otherPendingRows } = await supabase
            .from("payments")
            .select("id")
            .eq("appointment_id", appointmentId)
            .eq("payment_type", "deposit")
            .eq("status", "pending")
            .neq("stripe_checkout_session_id", session.id)
            .gt("expires_at", new Date().toISOString())
            .limit(1);

          if (!otherPendingRows?.length) {
            const { data: apt } = await supabase
              .from("appointments")
              .select("status")
              .eq("id", appointmentId)
              .maybeSingle();

            // Public bookings awaiting their deposit are discarded when the
            // checkout expires unpaid; confirmed bookings just lose the
            // pending deposit flag.
            const patch =
              apt?.status === "pending_deposit"
                ? { status: "cancelled", deposit_status: "none" }
                : { deposit_status: "none" };

            const { error: expireAptErr } = await supabase
              .from("appointments")
              .update(patch)
              .eq("id", appointmentId);

            if (expireAptErr) {
              console.error("appointment expiry update failed:", expireAptErr);
              throw new Error(
                `appointment expiry update failed: ${expireAptErr.message}`,
              );
            }
          }
        }
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const { data: payRow } = await supabase
          .from("payments")
          .select("appointment_id, payment_type")
          .eq("stripe_checkout_session_id", session.id)
          .maybeSingle();

        await supabase
          .from("payments")
          .update({ status: "failed" })
          .eq("stripe_checkout_session_id", session.id);

        const appointmentId =
          payRow?.appointment_id || session.metadata?.appointment_id;
        const effectiveType = payRow?.payment_type ||
          session.metadata?.payment_type;

        // Only deposit failures may change deposit_status. Service checkout
        // failures must not clobber a paid deposit or pending deposit UI.
        if (!appointmentId || effectiveType !== "deposit") {
          break;
        }

        const { data: paidDepositRows } = await supabase
          .from("payments")
          .select("id")
          .eq("appointment_id", appointmentId)
          .eq("payment_type", "deposit")
          .eq("status", "paid")
          .limit(1);

        if (!paidDepositRows?.length) {
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
