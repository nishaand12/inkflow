import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";

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
    const {
      studioId, appointmentTypeId, artistId, locationId, workStationId,
      date, startTime, durationHours, depositAmount,
      customerName, customerEmail, customerPhone
    } = await req.json();

    if (!studioId || !appointmentTypeId || !artistId || !locationId || !date || !startTime) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (!customerName || !customerEmail || !customerPhone) {
      return json({ error: "Customer name, email, and phone are required" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: studio, error: studioErr } = await supabase
      .from("studios")
      .select("*")
      .eq("id", studioId)
      .single();

    if (studioErr || !studio || !studio.is_active) {
      return json({ error: "Studio not found or inactive" }, 404);
    }

    const { data: aptType, error: typeErr } = await supabase
      .from("appointment_types")
      .select("*")
      .eq("id", appointmentTypeId)
      .eq("studio_id", studioId)
      .eq("is_public_bookable", true)
      .eq("is_active", true)
      .single();

    if (typeErr || !aptType) {
      return json({ error: "Service not available for online booking" }, 400);
    }

    // Find or create customer
    const { data: existingCustomers } = await supabase
      .from("customers")
      .select("*")
      .eq("studio_id", studioId)
      .eq("email", customerEmail)
      .limit(1);

    let customerId: string;

    if (existingCustomers && existingCustomers.length > 0) {
      customerId = existingCustomers[0].id;
    } else {
      const { data: newCustomer, error: custErr } = await supabase
        .from("customers")
        .insert({
          studio_id: studioId,
          name: customerName,
          phone_number: customerPhone,
          email: customerEmail,
        })
        .select("id")
        .single();

      if (custErr) {
        return json({ error: "Failed to create customer record" }, 500);
      }
      customerId = newCustomer.id;
    }

    const { data: appointment, error: aptErr } = await supabase
      .from("appointments")
      .insert({
        studio_id: studioId,
        artist_id: artistId,
        location_id: locationId,
        work_station_id: workStationId || null,
        customer_id: customerId,
        appointment_type_id: appointmentTypeId,
        client_name: customerName,
        client_email: customerEmail,
        client_phone: customerPhone,
        appointment_date: date,
        start_time: startTime,
        duration_hours: durationHours || aptType.default_duration,
        deposit_amount: depositAmount ?? aptType.default_deposit,
        status: "scheduled",
      })
      .select("*")
      .single();

    if (aptErr) {
      return json({ error: "Failed to create appointment" }, 500);
    }

    let checkoutUrl: string | null = null;

    const actualDeposit = depositAmount ?? aptType.default_deposit;
    if (actualDeposit > 0 && studio.stripe_account_id && studio.stripe_charges_enabled) {
      try {
        const currency = (studio.currency || "USD").toLowerCase();
        const unitAmount = Math.round(actualDeposit * 100);
        const expiresAt = Math.floor(Date.now() / 1000) + 86400;

        const session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            line_items: [
              {
                price_data: {
                  currency,
                  product_data: {
                    name: `Deposit – ${studio.name}`,
                    description: `${aptType.name} on ${date} at ${startTime}`,
                  },
                  unit_amount: unitAmount,
                },
                quantity: 1,
              },
            ],
            customer_email: customerEmail,
            expires_at: expiresAt,
            success_url: `${APP_URL}/deposit-success?studio=${encodeURIComponent(studio.name)}`,
            cancel_url: `${APP_URL}/deposit-cancelled?studio=${encodeURIComponent(studio.name)}`,
            metadata: {
              appointment_id: appointment.id,
              studio_id: studioId,
              customer_id: customerId,
              payment_type: "deposit",
            },
          },
          { stripeAccount: studio.stripe_account_id }
        );

        checkoutUrl = session.url;

        await supabase.from("payments").insert({
          studio_id: studioId,
          appointment_id: appointment.id,
          customer_id: customerId,
          stripe_checkout_session_id: session.id,
          amount: actualDeposit,
          currency: studio.currency || "USD",
          status: "pending",
          payment_type: "deposit",
          checkout_url: session.url,
          expires_at: new Date(expiresAt * 1000).toISOString(),
        });

        await supabase
          .from("appointments")
          .update({ deposit_status: "pending" })
          .eq("id", appointment.id);
      } catch (stripeErr) {
        console.error("Stripe deposit creation failed:", stripeErr);
      }
    }

    return json({
      appointment_id: appointment.id,
      checkout_url: checkoutUrl,
    });
  } catch (err) {
    console.error("create-public-booking error:", err);
    return json({ error: err.message || "Unknown error" }, 500);
  }
});

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
