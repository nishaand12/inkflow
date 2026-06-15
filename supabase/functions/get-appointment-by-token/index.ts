import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatTime12h } from "../_shared/timeDisplay.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    if (!token) {
      return json({ error: "Missing token" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: tokenRow, error: tokenErr } = await supabase
      .from("appointment_manage_tokens")
      .select("*, appointment:appointments(*, studio:studios(*), location:locations(*), artist:artists(*), appointment_type:appointment_types(*))")
      .eq("token", token)
      .is("revoked_at", null)
      .maybeSingle();

    if (tokenErr || !tokenRow) {
      return json({ error: "Invalid or expired link" }, 404);
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      return json({ error: "This link has expired" }, 410);
    }

    const appointment = tokenRow.appointment;
    if (!appointment) {
      return json({ error: "Appointment not found" }, 404);
    }

    const studio = appointment.studio;
    const timezone = studio?.timezone || "UTC";

    // Check 24-hour cutoff
    const appointmentLocalDate = appointment.appointment_date;
    const appointmentStartTime = appointment.start_time;
    const appointmentUTC = getAppointmentTimeInUTC(appointmentLocalDate, appointmentStartTime, timezone);
    const hoursUntil = (appointmentUTC.getTime() - Date.now()) / (1000 * 60 * 60);
    const canModify = hoursUntil > 24 && ["scheduled", "confirmed", "deposit_paid"].includes(appointment.status);

    return json({
      appointment: {
        id: appointment.id,
        date: appointment.appointment_date,
        start_time: appointment.start_time,
        end_time: appointment.end_time,
        status: appointment.status,
        client_name: appointment.client_name,
        deposit_amount: appointment.deposit_amount,
        deposit_status: appointment.deposit_status,
      },
      studio: studio ? {
        id: studio.id,
        name: studio.name,
        timezone: studio.timezone,
      } : null,
      location: appointment.location ? {
        id: appointment.location.id,
        name: appointment.location.name,
        address: appointment.location.address,
      } : null,
      artist: appointment.artist ? {
        id: appointment.artist.id,
        full_name: appointment.artist.full_name,
      } : null,
      appointment_type: appointment.appointment_type ? {
        id: appointment.appointment_type.id,
        name: appointment.appointment_type.name,
        duration_minutes: appointment.appointment_type.duration_minutes,
      } : null,
      can_modify: canModify,
      hours_until: Math.max(0, Math.round(hoursUntil * 10) / 10),
      modify_reason: !canModify
        ? appointment.status === "cancelled" ? "Appointment is already cancelled"
          : appointment.status === "completed" ? "Appointment is already completed"
          : hoursUntil <= 24 ? "Cannot modify within 24 hours of the appointment"
          : "Appointment cannot be modified"
        : null,
    });
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
