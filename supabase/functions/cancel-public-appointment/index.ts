import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

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
    const { token } = await req.json();
    if (!token) return json({ error: "Missing token" }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: tokenRow, error: tokenErr } = await supabase
      .from("appointment_manage_tokens")
      .select("*, appointment:appointments(*, studio:studios(*))")
      .eq("token", token)
      .is("revoked_at", null)
      .maybeSingle();

    if (tokenErr || !tokenRow) return json({ error: "Invalid or expired link" }, 404);
    if (new Date(tokenRow.expires_at) < new Date()) return json({ error: "This link has expired" }, 410);

    const appointment = tokenRow.appointment;
    if (!appointment) return json({ error: "Appointment not found" }, 404);

    if (!["scheduled", "confirmed", "deposit_paid"].includes(appointment.status)) {
      return json({ error: "Appointment cannot be cancelled in its current state" }, 400);
    }

    const studio = appointment.studio;
    const timezone = studio?.timezone || "UTC";
    const appointmentUTC = getAppointmentTimeInUTC(appointment.appointment_date, appointment.start_time, timezone);
    const hoursUntil = (appointmentUTC.getTime() - Date.now()) / (1000 * 60 * 60);

    if (hoursUntil <= 24) {
      return json({ error: "Cannot cancel within 24 hours of the appointment" }, 400);
    }

    const { error: updateErr } = await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", appointment.id);

    if (updateErr) return json({ error: "Failed to cancel appointment" }, 500);

    // Trigger cancellation email
    try {
      const endpoint = `${SUPABASE_URL}/functions/v1/send-appointment-email`;
      const key = SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY;
      await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ appointmentId: appointment.id, eventType: "cancelled" }),
      });
    } catch (emailErr) {
      console.error("Failed to send cancellation email:", emailErr);
    }

    return json({ success: true });
  } catch (err) {
    return json({ error: err.message || "Unknown error" }, 500);
  }
});

function getAppointmentTimeInUTC(date: string, time: string, timezone: string): Date {
  try {
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

    const targetFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    });
    const parts = targetFormatter.formatToParts(utcDate);
    const offsetPart = parts.find((p) => p.type === "timeZoneName");

    let offsetMinutes = 0;
    if (offsetPart?.value) {
      const match = offsetPart.value.match(/GMT([+-])(\d+)(?::(\d+))?/);
      if (match) {
        const sign = match[1] === "+" ? 1 : -1;
        const hours = parseInt(match[2], 10);
        const mins = parseInt(match[3] || "0", 10);
        offsetMinutes = sign * (hours * 60 + mins);
      }
    }
    return new Date(utcDate.getTime() - offsetMinutes * 60 * 1000);
  } catch {
    return new Date(`${date}T${time}:00Z`);
  }
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
