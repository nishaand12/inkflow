import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAILJET_API_KEY = Deno.env.get("MAILJET_API_KEY");
const MAILJET_SECRET_KEY = Deno.env.get("MAILJET_SECRET_KEY");
const MAILJET_SENDER_EMAIL = Deno.env.get("MAILJET_SENDER_EMAIL");
const MAILJET_SENDER_NAME = Deno.env.get("MAILJET_SENDER_NAME");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const MAILJET_API_URL = "https://api.mailjet.com/v3.1/send";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const { appointmentId, eventType } = await req.json();

    if (!appointmentId || !eventType) {
      return jsonResponse({ error: "Missing appointmentId or eventType" }, 400);
    }

    // Basic authorization: verify the request includes the anon key
    const apiKey = req.headers.get("apikey");
    const expectedAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!apiKey || apiKey !== expectedAnonKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: "Supabase env vars are missing" }, 500);
    }

    if (!MAILJET_API_KEY || !MAILJET_SECRET_KEY || !MAILJET_SENDER_EMAIL || !MAILJET_SENDER_NAME) {
      return jsonResponse({ error: "Mailjet env vars are missing" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: appointment, error } = await supabase
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
      .eq("id", appointmentId)
      .single();

    if (error || !appointment) {
      return jsonResponse({ error: "Appointment not found" }, 404);
    }

    // Prevent duplicate creation emails (main abuse vector), but allow update emails
    if (eventType === "created" && appointment.email_send_status === "sent") {
      return jsonResponse({ skipped: true, reason: "email_already_sent", message: "Confirmation email already sent for this appointment." }, 200);
    }

    const studio = appointment.studio;
    const customer = appointment.customer;

    if (!studio || studio.subscription_tier !== "plus" || !studio.email_reminders_enabled) {
      return jsonResponse({ skipped: true, reason: "tier_or_disabled" }, 200);
    }

    const email = resolveEmailAddress(appointment, customer);
    if (!email) {
      await updateEmailStatus(supabase, appointmentId, "skipped", "no_email_address");
      return jsonResponse({ skipped: true, reason: "no_email_address", message: "No email address available." }, 200);
    }

    if (customer?.email_bounced) {
      await updateEmailStatus(supabase, appointmentId, "skipped", "email_bounced");
      return jsonResponse({ skipped: true, reason: "email_bounced", message: "Email address bounced." }, 200);
    }

    if (customer?.email_unsubscribed) {
      await updateEmailStatus(supabase, appointmentId, "skipped", "email_unsubscribed");
      return jsonResponse({ skipped: true, reason: "email_unsubscribed", message: "Customer unsubscribed." }, 200);
    }

    const reminderMinutes = studio.reminder_minutes_before || 1440;
    const formattedDateTime = formatAppointmentTime(
      appointment.appointment_date,
      appointment.start_time,
      studio.timezone || "UTC"
    );

    const locationText = appointment.location?.name || "Location";
    const studioEmail = studio.studio_email || MAILJET_SENDER_EMAIL;

    const subject = getSubject(eventType, studio.name);
    const body = getEmailBody({
      eventType,
      customerName: appointment.client_name || customer?.name || "Customer",
      dateTime: formattedDateTime,
      location: locationText,
      studioEmail
    });

    const attachments = [];
    if ((eventType === "created" || eventType === "updated") && customer?.send_calendar_invites) {
      const calendarInvite = generateCalendarInvite({
        appointment,
        studio,
        location: appointment.location,
        artist: appointment.artist
      });
      attachments.push({
        ContentType: "text/calendar; charset=utf-8",
        Filename: "appointment.ics",
        Base64Content: btoa(calendarInvite)
      });
    }

    const payload = {
      Messages: [
        {
          From: { Email: MAILJET_SENDER_EMAIL, Name: MAILJET_SENDER_NAME },
          To: [{ Email: email, Name: appointment.client_name || customer?.name || "Customer" }],
          Subject: subject,
          TextPart: body,
          Attachments: attachments.length > 0 ? attachments : undefined
        }
      ]
    };

    const sendResult = await sendWithRetry(payload);
    if (!sendResult.ok) {
      await updateEmailStatus(supabase, appointmentId, "failed", sendResult.error || "mailjet_error");
      return jsonResponse({ error: "Mailjet send failed", message: sendResult.error }, 502);
    }

    await updateEmailStatus(supabase, appointmentId, "sent", null, reminderMinutes);
    return jsonResponse({ success: true });
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

function getSubject(eventType: string, studioName: string) {
  if (eventType === "reminder") {
    return `Appointment Reminder - ${studioName}`;
  }
  if (eventType === "updated") {
    return `Appointment Update - ${studioName}`;
  }
  return `Appointment Confirmation - ${studioName}`;
}

function getEmailBody({
  eventType,
  customerName,
  dateTime,
  location,
  studioEmail
}: {
  eventType: string;
  customerName: string;
  dateTime: string;
  location: string;
  studioEmail: string;
}) {
  if (eventType === "reminder") {
    return `Hi There,\n\nThis is an appointment reminder for ${customerName}.\n\n${dateTime}\n${location}\n\nLooking forward to seeing you there!\n\nIf you received this email in error, please contact ${studioEmail}.`;
  }

  if (eventType === "updated") {
    return `Hi There,\n\nYour appointment details have been updated for ${customerName}.\n\n${dateTime}\n${location}\n\nIf you received this email in error, please contact ${studioEmail}.`;
  }

  return `Hi There,\n\nThis is a confirmation for ${customerName}.\n\n${dateTime}\n${location}\n\nLooking forward to seeing you there!\n\nIf you received this email in error, please contact ${studioEmail}.`;
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

async function updateEmailStatus(
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
      reminder_minutes_before: reminderMinutes ?? null
    })
    .eq("id", appointmentId);
}

function generateCalendarInvite({
  appointment,
  studio,
  location,
  artist
}: {
  appointment: any;
  studio: any;
  location: any;
  artist: any;
}) {
  const timezone = studio.timezone || "UTC";
  
  // Parse the date and time components
  const [year, month, day] = appointment.appointment_date.split('-').map(Number);
  const [hour, minute] = appointment.start_time.split(':').map(Number);
  
  // Calculate end time
  const durationMs = (appointment.duration_hours || 1) * 60 * 60 * 1000;
  
  // Format date/time for iCal with timezone (TZID format)
  const formatLocalTime = (y: number, m: number, d: number, h: number, min: number) => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
  };
  
  // Calculate end hour/minute
  const startMinutes = hour * 60 + minute;
  const endMinutes = startMinutes + (appointment.duration_hours || 1) * 60;
  const endHour = Math.floor(endMinutes / 60) % 24;
  const endMinute = endMinutes % 60;
  const endDay = day + Math.floor(endMinutes / (24 * 60));
  
  const startStr = formatLocalTime(year, month, day, hour, minute);
  const endStr = formatLocalTime(year, month, endDay, endHour, endMinute);
  
  const formatUtc = (date: Date) =>
    date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const uid = `${appointment.id}@inkflow`;
  const organizer = studio.studio_email || MAILJET_SENDER_EMAIL;
  const title = `Appointment with ${artist?.full_name || "Artist"}`;
  const locationText = location?.address
    ? `${location.address}, ${location.city || ""}`.trim()
    : location?.name || "Location";

  // Use TZID format to specify the timezone for the appointment
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//InkFlow//Appointments//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatUtc(new Date())}`,
    `DTSTART;TZID=${timezone}:${startStr}`,
    `DTEND;TZID=${timezone}:${endStr}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:Appointment at ${studio.name}`,
    `LOCATION:${locationText}`,
    `ORGANIZER;CN=${studio.name}:mailto:${organizer}`,
    `ATTENDEE;CN=${appointment.client_name || "Customer"};RSVP=TRUE:mailto:${appointment.client_email || ""}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}
