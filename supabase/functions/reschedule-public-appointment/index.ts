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
    const { token, newDate, newStartTime, newEndTime } = await req.json();
    if (!token || !newDate || !newStartTime) {
      return json({ error: "Missing required fields (token, newDate, newStartTime)" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: tokenRow, error: tokenErr } = await supabase
      .from("appointment_manage_tokens")
      .select("*, appointment:appointments(*, studio:studios(*), appointment_type:appointment_types(*))")
      .eq("token", token)
      .is("revoked_at", null)
      .maybeSingle();

    if (tokenErr || !tokenRow) return json({ error: "Invalid or expired link" }, 404);
    if (new Date(tokenRow.expires_at) < new Date()) return json({ error: "This link has expired" }, 410);

    const appointment = tokenRow.appointment;
    if (!appointment) return json({ error: "Appointment not found" }, 404);

    if (!["scheduled", "confirmed", "deposit_paid"].includes(appointment.status)) {
      return json({ error: "Appointment cannot be rescheduled in its current state" }, 400);
    }

    const studio = appointment.studio;
    const timezone = studio?.timezone || "UTC";

    // 24-hour cutoff on the original appointment
    const originalUTC = getAppointmentTimeInUTC(appointment.appointment_date, appointment.start_time, timezone);
    const hoursUntilOriginal = (originalUTC.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilOriginal <= 24) {
      return json({ error: "Cannot reschedule within 24 hours of the appointment" }, 400);
    }

    // Also ensure the new time is at least 24 hours away
    const newUTC = getAppointmentTimeInUTC(newDate, newStartTime, timezone);
    const hoursUntilNew = (newUTC.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilNew <= 24) {
      return json({ error: "New appointment time must be at least 24 hours from now" }, 400);
    }

    // Check for conflicts with existing appointments for the same artist
    const { data: conflicts } = await supabase
      .from("appointments")
      .select("id, start_time, end_time")
      .eq("artist_id", appointment.artist_id)
      .eq("appointment_date", newDate)
      .neq("id", appointment.id)
      .in("status", ["scheduled", "confirmed", "deposit_paid", "completed"])
      .neq("status", "cancelled");

    const aptType = appointment.appointment_type;
    const durationMinutes = aptType?.duration_minutes || 30;
    const computedEndTime = newEndTime || addMinutes(newStartTime, durationMinutes);

    if (conflicts && conflicts.length > 0) {
      for (const existing of conflicts) {
        if (timesOverlap(newStartTime, computedEndTime, existing.start_time, existing.end_time)) {
          return json({ error: "The selected time conflicts with an existing appointment" }, 409);
        }
      }
    }

    const { error: updateErr } = await supabase
      .from("appointments")
      .update({
        appointment_date: newDate,
        start_time: newStartTime,
        end_time: computedEndTime,
        reminder_primary_sent_at: null,
        reminder_secondary_sent_at: null,
        reminder_tertiary_sent_at: null,
        followup_quick_sent_at: null,
        followup_longterm_sent_at: null,
        followup_midterm_sent_at: null,
        reminder_sent_at: null,
        notification_anchor_at: new Date().toISOString(),
      })
      .eq("id", appointment.id);

    if (updateErr) return json({ error: "Failed to reschedule appointment" }, 500);

    // Trigger updated confirmation email
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
        body: JSON.stringify({ appointmentId: appointment.id, eventType: "updated" }),
      });
    } catch (emailErr) {
      console.error("Failed to send reschedule confirmation email:", emailErr);
    }

    return json({ success: true, new_date: newDate, new_start_time: newStartTime, new_end_time: computedEndTime });
  } catch (err) {
    return json({ error: err.message || "Unknown error" }, 500);
  }
});

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

function timesOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const s1 = toMin(start1), e1 = toMin(end1);
  const s2 = toMin(start2), e2 = toMin(end2 || "23:59");
  return s1 < e2 && s2 < e1;
}

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
