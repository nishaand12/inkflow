import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAILJET_API_KEY = Deno.env.get("MAILJET_API_KEY");
const MAILJET_SECRET_KEY = Deno.env.get("MAILJET_SECRET_KEY");
const MAILJET_SENDER_EMAIL = Deno.env.get("MAILJET_SENDER_EMAIL");
const MAILJET_SENDER_NAME = Deno.env.get("MAILJET_SENDER_NAME");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const MAILJET_API_URL = "https://api.mailjet.com/v3.1/send";

serve(async (req) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: "Supabase env vars are missing" }, 500);
    }

    // Verify the request is authorized using the dedicated cron secret
    const authHeader = req.headers.get("authorization");
    if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (!MAILJET_API_KEY || !MAILJET_SECRET_KEY || !MAILJET_SENDER_EMAIL || !MAILJET_SENDER_NAME) {
      return jsonResponse({ error: "Mailjet env vars are missing" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date();

    const { data: appointments, error } = await supabase
      .from("appointments")
      .select(
        `
        *,
        studio:studios(*),
        location:locations(*),
        artist:artists(*),
        customer:customers(*)
      `
      )
      .eq("status", "scheduled")
      .is("reminder_sent_at", null);

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    let sentCount = 0;
    for (const appointment of appointments || []) {
      const studio = appointment.studio;
      if (!studio || studio.subscription_tier !== "plus" || !studio.email_reminders_enabled) {
        continue;
      }

      const reminderMinutes = studio.reminder_minutes_before || 1440;
      const timezone = studio.timezone || "UTC";
      const appointmentTime = getAppointmentTimeInUTC(
        appointment.appointment_date,
        appointment.start_time,
        timezone
      );
      const reminderTime = new Date(appointmentTime.getTime() - reminderMinutes * 60 * 1000);

      if (now < reminderTime) {
        continue;
      }

      if (now > appointmentTime) {
        await updateReminderStatus(supabase, appointment.id, "skipped", "appointment_passed", reminderMinutes);
        continue;
      }

      const email = resolveEmailAddress(appointment, appointment.customer);
      if (!email) {
        await updateReminderStatus(supabase, appointment.id, "skipped", "no_email_address");
        continue;
      }

      if (appointment.customer?.email_bounced) {
        await updateReminderStatus(supabase, appointment.id, "skipped", "email_bounced");
        continue;
      }

      if (appointment.customer?.email_unsubscribed) {
        await updateReminderStatus(supabase, appointment.id, "skipped", "email_unsubscribed");
        continue;
      }

      const formattedDateTime = formatAppointmentTime(
        appointment.appointment_date,
        appointment.start_time,
        studio.timezone || "UTC"
      );

      const locationText = appointment.location?.name || "Location";
      const studioEmail = studio.studio_email || MAILJET_SENDER_EMAIL;

      const subject = `Appointment Reminder - ${studio.name}`;
      const body = `Hi There,\n\nThis is an appointment reminder for ${
        appointment.client_name || appointment.customer?.name || "Customer"
      }.\n\n${formattedDateTime}\n${locationText}\n\nLooking forward to seeing you there!\n\nIf you received this email in error, please contact ${studioEmail}.`;

      const payload = {
        Messages: [
          {
            From: { Email: MAILJET_SENDER_EMAIL, Name: MAILJET_SENDER_NAME },
            To: [{ Email: email, Name: appointment.client_name || appointment.customer?.name || "Customer" }],
            Subject: subject,
            TextPart: body
          }
        ]
      };

      const sendResult = await sendWithRetry(payload);
      if (!sendResult.ok) {
        await updateReminderStatus(supabase, appointment.id, "failed", sendResult.error || "mailjet_error");
        continue;
      }

      await updateReminderStatus(supabase, appointment.id, "sent", null, reminderMinutes);
      sentCount += 1;
    }

    return jsonResponse({ success: true, sent: sentCount });
  } catch (err) {
    return jsonResponse({ error: err.message || "Unknown error" }, 500);
  }
});

function resolveEmailAddress(appointment: any, customer: any) {
  if (appointment.client_email && appointment.client_email.trim()) {
    return appointment.client_email.trim();
  }
  if (customer?.email && customer.email.trim()) {
    return customer.email.trim();
  }
  return null;
}

function formatAppointmentTime(date: string, time: string, timezone: string) {
  try {
    // Parse the date and time as a local time in the studio's timezone
    // The appointment_date is stored as YYYY-MM-DD and start_time as HH:MM
    // These represent the local time at the studio
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    
    // Create a formatter for the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    });
    
    // Create a date object - we need to handle timezone conversion carefully
    // Since the stored date/time represents local time at the studio,
    // we create a UTC date that when formatted in the target timezone shows the correct time
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    
    // Get the timezone offset for the target timezone at this date
    const targetFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    });
    const parts = targetFormatter.formatToParts(utcDate);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');
    
    // Parse offset like "GMT-5" or "GMT+5:30"
    let offsetMinutes = 0;
    if (offsetPart?.value) {
      const match = offsetPart.value.match(/GMT([+-])(\d+)(?::(\d+))?/);
      if (match) {
        const sign = match[1] === '+' ? 1 : -1;
        const hours = parseInt(match[2], 10);
        const mins = parseInt(match[3] || '0', 10);
        offsetMinutes = sign * (hours * 60 + mins);
      }
    }
    
    // Adjust the UTC date by the offset so it displays correctly
    const adjustedDate = new Date(utcDate.getTime() - offsetMinutes * 60 * 1000);
    
    return formatter.format(adjustedDate);
  } catch (e) {
    // Fallback if timezone formatting fails
    const tzAbbrev = getTimezoneAbbreviation(timezone);
    return `${date} at ${time} (${tzAbbrev})`;
  }
}

function getTimezoneAbbreviation(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short'
    });
    const parts = formatter.formatToParts(new Date());
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart?.value || timezone;
  } catch {
    return timezone;
  }
}

/**
 * Convert a local appointment time (in studio's timezone) to a UTC Date object
 * for proper comparison with the current time
 */
function getAppointmentTimeInUTC(date: string, time: string, timezone: string): Date {
  try {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    
    // Create a UTC date first
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    
    // Get the timezone offset for the target timezone at this date
    const targetFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    });
    const parts = targetFormatter.formatToParts(utcDate);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');
    
    // Parse offset like "GMT-5" or "GMT+5:30"
    let offsetMinutes = 0;
    if (offsetPart?.value) {
      const match = offsetPart.value.match(/GMT([+-])(\d+)(?::(\d+))?/);
      if (match) {
        const sign = match[1] === '+' ? 1 : -1;
        const hours = parseInt(match[2], 10);
        const mins = parseInt(match[3] || '0', 10);
        offsetMinutes = sign * (hours * 60 + mins);
      }
    }
    
    // The appointment time is local to the studio's timezone
    // To get the UTC equivalent, we subtract the offset
    // (if timezone is GMT-5, we add 5 hours to get UTC)
    return new Date(utcDate.getTime() - offsetMinutes * 60 * 1000);
  } catch {
    // Fallback: treat as UTC
    return new Date(`${date}T${time}:00Z`);
  }
}

async function sendWithRetry(payload: any) {
  const auth = btoa(`${MAILJET_API_KEY}:${MAILJET_SECRET_KEY}`);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Basic ${auth}`
  };

  const attempt = async () => {
    const response = await fetch(MAILJET_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    if (response.ok) return { ok: true };
    const errorText = await response.text();
    return { ok: false, error: errorText || response.statusText };
  };

  const first = await attempt();
  if (first.ok) return first;

  const second = await attempt();
  if (second.ok) return second;

  return second;
}

async function updateReminderStatus(
  supabase: ReturnType<typeof createClient>,
  appointmentId: string,
  status: "sent" | "failed" | "skipped",
  reason: string | null,
  reminderMinutes?: number
) {
  await supabase
    .from("appointments")
    .update({
      email_send_status: status,
      email_send_failed_reason: reason,
      email_sent_at: status === "sent" ? new Date().toISOString() : null,
      reminder_sent_at: new Date().toISOString(),
      reminder_minutes_before: reminderMinutes ?? null
    })
    .eq("id", appointmentId);
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
