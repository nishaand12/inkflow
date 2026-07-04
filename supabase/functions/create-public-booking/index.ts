import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { formatTime12h } from "../_shared/timeDisplay.ts";
import { resolvePublicBookingDeposit } from "../_shared/publicBookingDeposit.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
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
      date, startTime, endTime,
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

    const { data: location, error: locationErr } = await supabase
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .eq("studio_id", studioId)
      .eq("is_active", true)
      .single();

    if (locationErr || !location) {
      return json({ error: "Location is not available for online booking" }, 400);
    }

    const { data: bookArtist, error: artistErr } = await supabase
      .from("artists")
      .select("id, studio_id, is_active, artist_type")
      .eq("id", artistId)
      .maybeSingle();

    if (artistErr || !bookArtist || bookArtist.studio_id !== studioId) {
      return json({ error: "Artist not found" }, 400);
    }
    if (!bookArtist.is_active) {
      return json({ error: "This artist is not accepting new bookings" }, 400);
    }
    const at = bookArtist.artist_type || "tattoo";
    const pierceOk = at === "piercer" || at === "both";
    if (!pierceOk) {
      return json({ error: "Artist is not available for online booking" }, 400);
    }

    const { data: exclusionRow, error: exclusionErr } = await supabase
      .from("artist_appointment_type_exclusions")
      .select("id")
      .eq("studio_id", studioId)
      .eq("artist_id", artistId)
      .eq("appointment_type_id", appointmentTypeId)
      .maybeSingle();

    if (exclusionErr) {
      return json({ error: "Unable to validate booking eligibility" }, 500);
    }
    if (exclusionRow) {
      return json({ error: "This artist is not available for the selected service" }, 400);
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
          send_calendar_invites: true,
        })
        .select("id")
        .single();

      if (custErr) {
        return json({ error: "Failed to create customer record" }, 500);
      }
      customerId = newCustomer.id;
    }

    const svcCost =
      aptType.service_cost != null && Number(aptType.service_cost) > 0
        ? Number(aptType.service_cost)
        : null;

    const actualDeposit = resolvePublicBookingDeposit(aptType);

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
        end_time: endTime,
        deposit_amount: actualDeposit,
        total_estimate: svcCost,
        status: "scheduled",
        booking_source: "public",
        notification_anchor_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (aptErr) {
      return json({ error: "Failed to create appointment" }, 500);
    }

    let checkoutUrl: string | null = null;

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
                    description: `${aptType.name} on ${date} at ${formatTime12h(startTime)}`,
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
          metadata: { appointment_id: appointment.id },
        });

        await supabase
          .from("appointments")
          .update({ deposit_status: "pending" })
          .eq("id", appointment.id);
      } catch (stripeErr) {
        console.error("Stripe deposit creation failed:", stripeErr);
      }
    }

    // Generate a manage token for customer self-service reschedule/cancel
    const manageToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const tokenExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days
    await supabase.from("appointment_manage_tokens").insert({
      appointment_id: appointment.id,
      token: manageToken,
      expires_at: tokenExpiresAt.toISOString(),
    });

    await triggerConfirmationEmail(appointment.id);

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

async function triggerConfirmationEmail(appointmentId: string) {
  try {
    if (!appointmentId) return;
    const endpoint = `${SUPABASE_URL}/functions/v1/send-appointment-email`;
    const key = SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY;
    if (!key) return;

    const response = await fetch(endpoint, {
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
      console.error("Confirmation trigger failed:", response.status, details);
    }
  } catch (emailErr) {
    console.error("Failed to trigger booking confirmation email:", emailErr);
  }
}
