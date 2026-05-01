import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const WEBHOOK_SECRET = Deno.env.get("MAILJET_WEBHOOK_SECRET");

serve(async (req) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response("Supabase env vars missing", { status: 500 });
    }

    // Verify the webhook secret token from URL query parameter
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!WEBHOOK_SECRET || token !== WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return new Response("OK", { status: 200 });
    }

    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const payload = await req.json();

    const event = payload.event;
    const email = payload.email;
    const reason = payload.reason || payload.error_related_to || payload.error || null;
    const timestamp = payload.time ? new Date(payload.time * 1000).toISOString() : new Date().toISOString();

    if (!email || !event) {
      return new Response("Missing event or email", { status: 400 });
    }

    if (["bounce", "blocked", "spam"].includes(event)) {
      await supabase
        .from("customers")
        .update({
          email_bounced: true,
          email_bounce_reason: reason,
          email_bounced_at: timestamp
        })
        .eq("email", email);
    }

    if (event === "unsub") {
      await supabase
        .from("customers")
        .update({
          email_unsubscribed: true,
          email_unsubscribed_at: timestamp
        })
        .eq("email", email);
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("id, studio_id")
      .eq("email", email)
      .maybeSingle();

    await updateLatestEmailEvent(supabase, {
      email,
      studioId: customer?.studio_id || null,
      customerId: customer?.id || null,
      event,
      reason,
      timestamp,
      payload,
    });

    return new Response("OK", { status: 200 });
  } catch (err) {
    return new Response(err.message || "Webhook error", { status: 500 });
  }
});

async function updateLatestEmailEvent(
  supabase: ReturnType<typeof createClient>,
  {
    email,
    studioId,
    customerId,
    event,
    reason,
    timestamp,
    payload,
  }: {
    email: string;
    studioId: string | null;
    customerId: string | null;
    event: string;
    reason: string | null;
    timestamp: string;
    payload: Record<string, unknown>;
  }
) {
  const deliveryStatus = event === "bounce" ? "bounced" : event;

  let query = supabase
    .from("email_events")
    .select("id, metadata")
    .eq("email", email)
    .eq("event_type", "automatic_email_sent")
    .order("occurred_at", { ascending: false })
    .limit(1);

  if (studioId) {
    query = query.eq("studio_id", studioId);
  }

  const { data: existingEvent } = await query.maybeSingle();

  if (existingEvent?.id) {
    await supabase
      .from("email_events")
      .update({
        delivery_status: deliveryStatus,
        provider_event_type: event,
        provider_event_at: timestamp,
        reason,
        metadata: {
          ...(existingEvent.metadata || {}),
          mailjet_webhook: payload,
        },
      })
      .eq("id", existingEvent.id);
    return;
  }

  await supabase.from("email_events").insert({
    studio_id: studioId,
    customer_id: customerId,
    appointment_id: null,
    email,
    event_type: "mailjet_delivery_event",
    delivery_status: deliveryStatus,
    provider_event_type: event,
    provider_event_at: timestamp,
    reason,
    occurred_at: timestamp,
    metadata: payload,
  });
}
