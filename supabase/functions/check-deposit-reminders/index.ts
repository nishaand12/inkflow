import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAILJET_API_KEY = Deno.env.get("MAILJET_API_KEY");
const MAILJET_SECRET_KEY = Deno.env.get("MAILJET_SECRET_KEY");
const MAILJET_SENDER_EMAIL = Deno.env.get("MAILJET_SENDER_EMAIL");
const MAILJET_SENDER_NAME = Deno.env.get("MAILJET_SENDER_NAME");

const MAILJET_API_URL = "https://api.mailjet.com/v3.1/send";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    if (
      !MAILJET_API_KEY ||
      !MAILJET_SECRET_KEY ||
      !MAILJET_SENDER_EMAIL ||
      !MAILJET_SENDER_NAME
    ) {
      return json({ skipped: true, reason: "mailjet_not_configured" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find appointments created ~48h ago that have deposit_amount > 0,
    // deposit_status is still 'none' or 'pending', and haven't been cancelled
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const cutoffUpper = new Date(
      Date.now() - 47 * 60 * 60 * 1000
    ).toISOString();

    const { data: appointments, error } = await supabase
      .from("appointments")
      .select("*, studio:studios(*), customer:customers(*)")
      .gt("deposit_amount", 0)
      .in("deposit_status", ["none", "pending"])
      .not("status", "in", '("cancelled","no_show","completed")')
      .gte("created_at", cutoff)
      .lt("created_at", cutoffUpper);

    if (error) {
      console.error("Query error:", error);
      return json({ error: error.message }, 500);
    }

    let sentCount = 0;

    for (const apt of appointments || []) {
      const studio = apt.studio;
      if (!studio?.email_reminders_enabled) continue;
      if (studio.subscription_tier !== "plus") continue;

      const email =
        apt.client_email?.trim() || apt.customer?.email?.trim();
      if (!email) continue;
      if (apt.customer?.email_bounced || apt.customer?.email_unsubscribed)
        continue;

      const studioEmail = studio.studio_email || MAILJET_SENDER_EMAIL;
      const customerName =
        apt.client_name || apt.customer?.name || "Customer";

      const body = `Hi There,\n\nThis is a friendly reminder that your deposit of $${(apt.deposit_amount || 0).toFixed(2)} for your upcoming appointment on ${apt.appointment_date} at ${apt.start_time} has not yet been received.\n\nPlease contact ${studioEmail} to arrange your deposit payment.\n\nThank you!`;

      const payload = {
        Messages: [
          {
            From: {
              Email: MAILJET_SENDER_EMAIL,
              Name: MAILJET_SENDER_NAME,
            },
            To: [{ Email: email, Name: customerName }],
            Subject: `Deposit Reminder - ${studio.name}`,
            TextPart: body,
          },
        ],
      };

      const auth = btoa(`${MAILJET_API_KEY}:${MAILJET_SECRET_KEY}`);
      const sendRes = await fetch(MAILJET_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(payload),
      });

      if (sendRes.ok) {
        await recordEmailEvent(supabase, {
          studioId: studio.id,
          customerId: apt.customer_id || null,
          appointmentId: apt.id,
          email,
          eventType: "automatic_email_sent",
          metadata: {
            source: "check-deposit-reminders",
            email_kind: "deposit_reminder",
            subject: `Deposit Reminder - ${studio.name}`,
            deposit_amount: apt.deposit_amount || null,
          },
        });
        sentCount++;
      }
    }

    return json({ success: true, sent: sentCount });
  } catch (err) {
    console.error("check-deposit-reminders error:", err);
    return json({ error: err.message || "Unknown error" }, 500);
  }
});

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function recordEmailEvent(
  supabase: ReturnType<typeof createClient>,
  {
    studioId,
    customerId,
    appointmentId,
    email,
    eventType,
    metadata,
  }: {
    studioId: string | null;
    customerId: string | null;
    appointmentId: string | null;
    email: string;
    eventType: string;
    metadata: Record<string, unknown>;
  }
) {
  const { error } = await supabase.from("email_events").insert({
    studio_id: studioId,
    customer_id: customerId,
    appointment_id: appointmentId,
    email,
    event_type: eventType,
    delivery_status: "sent",
    metadata,
  });

  if (error) {
    console.error("Failed to record email event:", error);
  }
}
