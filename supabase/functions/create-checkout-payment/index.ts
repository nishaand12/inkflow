import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") || "https://inkflow.app";

const MAILJET_API_KEY = Deno.env.get("MAILJET_API_KEY");
const MAILJET_SECRET_KEY = Deno.env.get("MAILJET_SECRET_KEY");
const MAILJET_SENDER_EMAIL = Deno.env.get("MAILJET_SENDER_EMAIL");
const MAILJET_SENDER_NAME = Deno.env.get("MAILJET_SENDER_NAME");
const MAILJET_API_URL = "https://api.mailjet.com/v3.1/send";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { appointmentId, chargeAmount, taxAmount, sendEmail = false } = await req.json();
    if (!appointmentId) {
      return json({ error: "Missing appointmentId" }, 400);
    }
    if (!chargeAmount || chargeAmount <= 0) {
      return json({ error: "Charge amount must be greater than 0" }, 400);
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
      return json(
        { error: "Studio Stripe account not connected or charges not enabled" },
        400
      );
    }

    // Expire any existing pending checkout payments for this appointment
    const { data: existingPayments } = await supabase
      .from("payments")
      .select("*")
      .eq("appointment_id", appointmentId)
      .eq("status", "pending")
      .eq("payment_type", "checkout");

    if (existingPayments?.length) {
      await supabase
        .from("payments")
        .update({ status: "expired" })
        .in(
          "id",
          existingPayments.map((p: any) => p.id)
        );
    }

    const customerEmail =
      appointment.client_email?.trim() ||
      appointment.customer?.email?.trim() ||
      undefined;

    const currency = (studio.currency || "USD").toLowerCase();
    const tax = taxAmount ? parseFloat(taxAmount) : 0;
    const charge = parseFloat(chargeAmount);
    const totalAmount = charge + tax;
    const unitAmount = Math.round(totalAmount * 100);

    const expiresAt = Math.floor(Date.now() / 1000) + 86400; // 24 hours

    const lineItems: any[] = [
      {
        price_data: {
          currency,
          product_data: {
            name: `Service – ${studio.name}`,
            description: `Appointment on ${appointment.appointment_date} at ${appointment.start_time}`,
          },
          unit_amount: Math.round(charge * 100),
        },
        quantity: 1,
      },
    ];

    if (tax > 0) {
      lineItems.push({
        price_data: {
          currency,
          product_data: { name: "Tax" },
          unit_amount: Math.round(tax * 100),
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: lineItems,
        customer_email: customerEmail,
        expires_at: expiresAt,
        success_url: `${APP_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&studio=${encodeURIComponent(studio.name)}&type=checkout`,
        cancel_url: `${APP_URL}/payment-cancelled?appointment_id=${appointmentId}&studio=${encodeURIComponent(studio.name)}`,
        metadata: {
          appointment_id: appointmentId,
          studio_id: studio.id,
          customer_id: appointment.customer_id || "",
          payment_type: "checkout",
          charge_amount: charge.toString(),
          tax_amount: tax.toString(),
        },
      },
      { stripeAccount: studio.stripe_account_id }
    );

    await supabase.from("payments").insert({
      studio_id: studio.id,
      appointment_id: appointmentId,
      customer_id: appointment.customer_id || null,
      stripe_checkout_session_id: session.id,
      amount: totalAmount,
      currency: studio.currency || "USD",
      status: "pending",
      payment_type: "checkout",
      checkout_url: session.url,
      expires_at: new Date(expiresAt * 1000).toISOString(),
      metadata: { charge_amount: charge, tax_amount: tax },
    });

    // Update appointment with the amounts immediately (status stays as-is until paid)
    await supabase
      .from("appointments")
      .update({
        charge_amount: charge,
        tax_amount: tax,
        payment_method: "Card",
      })
      .eq("id", appointmentId);

    let emailSent = false;
    if (sendEmail && customerEmail && MAILJET_API_KEY && MAILJET_SECRET_KEY) {
      const clientName =
        appointment.client_name ||
        appointment.customer?.name ||
        "Customer";
      try {
        await sendPaymentEmail({
          to: customerEmail,
          clientName,
          studioName: studio.name,
          studioEmail: studio.studio_email || MAILJET_SENDER_EMAIL || "",
          checkoutUrl: session.url!,
          totalAmount,
          currency: studio.currency || "USD",
        });
        emailSent = true;
      } catch (emailErr) {
        console.error("Failed to send checkout payment email:", emailErr);
      }
    }

    return json({ checkout_url: session.url, session_id: session.id, email_sent: emailSent });
  } catch (err) {
    console.error("create-checkout-payment error:", err);
    return json({ error: err.message || "Unknown error" }, 500);
  }
});

async function sendPaymentEmail({
  to,
  clientName,
  studioName,
  studioEmail,
  checkoutUrl,
  totalAmount,
  currency,
}: {
  to: string;
  clientName: string;
  studioName: string;
  studioEmail: string;
  checkoutUrl: string;
  totalAmount: number;
  currency: string;
}) {
  const currencySymbol = currency.toUpperCase() === "CAD" ? "CA$" : "$";
  const body = `Hi ${clientName},\n\n${studioName} has sent you a payment link for your appointment.\n\nTotal: ${currencySymbol}${totalAmount.toFixed(2)} ${currency.toUpperCase()}\n\nPlease complete your payment using the link below:\n\n${checkoutUrl}\n\nThis payment link expires in 24 hours. If it has expired, please contact ${studioEmail} for a new link.\n\nThank you!`;

  const auth = btoa(`${MAILJET_API_KEY}:${MAILJET_SECRET_KEY}`);
  const payload = {
    Messages: [
      {
        From: {
          Email: MAILJET_SENDER_EMAIL,
          Name: MAILJET_SENDER_NAME,
        },
        To: [{ Email: to, Name: clientName }],
        Subject: `Payment Request – ${studioName}`,
        TextPart: body,
      },
    ],
  };

  const res = await fetch(MAILJET_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Mailjet error: ${errText}`);
  }
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
