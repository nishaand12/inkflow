import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatTime12h } from "../_shared/timeDisplay.ts";

const MAILJET_API_KEY = Deno.env.get("MAILJET_API_KEY");
const MAILJET_SECRET_KEY = Deno.env.get("MAILJET_SECRET_KEY");
const MAILJET_SENDER_EMAIL = Deno.env.get("MAILJET_SENDER_EMAIL");
const MAILJET_SENDER_NAME = Deno.env.get("MAILJET_SENDER_NAME");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const MAILJET_API_URL = "https://api.mailjet.com/v3.1/send";
const DEFAULT_PRIMARY_REMINDER_SUBJECT_TEMPLATE = "Appointment Reminder - {{studio_name}}";
const DEFAULT_PRIMARY_REMINDER_BODY_TEMPLATE = `Hi {{customer_name}},

This is a reminder for your appointment on {{appointment_date_time}} at {{location_name}} with {{artist_name}}.

If you have questions, contact {{studio_email}}.

See you soon!`;
const DEFAULT_SECONDARY_REMINDER_SUBJECT_TEMPLATE = "Heads up: your appointment is coming up - {{studio_name}}";
const DEFAULT_SECONDARY_REMINDER_BODY_TEMPLATE = `Hi {{customer_name}},

Your appointment is coming up on {{appointment_date_time}} at {{location_name}} with {{artist_name}}.

If you need to reschedule, please contact {{studio_email}} as soon as possible.

See you soon!`;
const DEFAULT_FOLLOWUP_QUICK_SUBJECT_TEMPLATE = "Aftercare instructions - {{studio_name}}";
const DEFAULT_FOLLOWUP_QUICK_BODY_TEMPLATE = `Hi {{customer_name}},

Thanks for visiting {{studio_name}} today.

Here are your aftercare instructions:
{{aftercare_instructions}}

If anything feels off, contact {{studio_email}}.
`;
const DEFAULT_FOLLOWUP_LONGTERM_SUBJECT_TEMPLATE = "Long-term aftercare check-in - {{studio_name}}";
const DEFAULT_FOLLOWUP_LONGTERM_BODY_TEMPLATE = `Hi {{customer_name}},

This is your long-term aftercare check-in from {{studio_name}}.

Please continue following your aftercare plan:
{{aftercare_instructions}}

Questions? Reach us at {{studio_email}}.
`;

type NotificationKind =
  | "reminder_primary"
  | "reminder_secondary"
  | "followup_quick"
  | "followup_longterm";

type NotificationSpec = {
  kind: NotificationKind;
  direction: "before" | "after";
  minutes: number;
  enabled: boolean;
  sentAtField:
    | "reminder_primary_sent_at"
    | "reminder_secondary_sent_at"
    | "followup_quick_sent_at"
    | "followup_longterm_sent_at";
  subjectTemplate: string;
  bodyTemplate: string;
};

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
      .in("status", ["scheduled", "confirmed", "deposit_paid", "completed"]);

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    let sentCount = 0;
    for (const appointment of appointments || []) {
      const studio = appointment.studio;
      if (!studio || studio.subscription_tier !== "plus") {
        continue;
      }

      const timezone = studio.timezone || "UTC";
      const appointmentTime = getAppointmentTimeInUTC(
        appointment.appointment_date,
        appointment.start_time,
        timezone
      );
      const specs = getNotificationSpecs(studio);
      for (const spec of specs) {
        if (!spec.enabled) continue;
        if (appointment[spec.sentAtField]) continue;

        const sendAt =
          spec.direction === "before"
            ? new Date(appointmentTime.getTime() - spec.minutes * 60 * 1000)
            : new Date(appointmentTime.getTime() + spec.minutes * 60 * 1000);
        if (now < sendAt) continue;

        const isFollowup = spec.direction === "after";
        if (isFollowup && appointment.status !== "completed") continue;

        if (!isFollowup && now > appointmentTime) {
          await markNotificationProcessed(supabase, appointment.id, spec.kind, spec.sentAtField);
          continue;
        }

        const email = resolveEmailAddress(appointment, appointment.customer);
        if (!email) {
          await markNotificationProcessed(supabase, appointment.id, spec.kind, spec.sentAtField);
          continue;
        }

        if (appointment.customer?.email_bounced || appointment.customer?.email_unsubscribed) {
          await markNotificationProcessed(supabase, appointment.id, spec.kind, spec.sentAtField);
          continue;
        }

        const formattedDateTime = formatAppointmentTime(
          appointment.appointment_date,
          appointment.start_time,
          studio.timezone || "UTC"
        );

        const locationText = appointment.location?.name || "Location";
        const studioEmail = studio.studio_email || MAILJET_SENDER_EMAIL;
        const customerName = appointment.client_name || appointment.customer?.name || "Customer";
        const artistName = appointment.artist?.full_name || "Artist";
        const depositAmount = Number(appointment.deposit_amount) || 0;
        const templateVars = {
          customer_name: customerName,
          studio_name: studio.name || "Studio",
          appointment_date_time: formattedDateTime,
          location_name: locationText,
          artist_name: artistName,
          deposit_amount: depositAmount > 0 ? depositAmount.toFixed(2) : "",
          deposit_link: "",
          studio_email: studioEmail,
          aftercare_instructions:
            appointment.notes?.trim() ||
            "Keep the area clean and dry, avoid irritation, and follow your artist's guidance.",
        };

        const subject = renderTemplate(spec.subjectTemplate, templateVars);
        const body = renderTemplate(spec.bodyTemplate, templateVars);
        const payload = {
          Messages: [
            {
              From: { Email: MAILJET_SENDER_EMAIL, Name: MAILJET_SENDER_NAME },
              To: [{ Email: email, Name: customerName }],
              Subject: subject,
              TextPart: body,
              HTMLPart: textToHtml(body),
            },
          ],
        };

        const sendResult = await sendWithRetry(payload);
        if (!sendResult.ok) {
          await markNotificationProcessed(supabase, appointment.id, spec.kind, spec.sentAtField);
          continue;
        }

        await recordEmailEvent(supabase, {
          studioId: studio.id,
          customerId: appointment.customer_id || null,
          appointmentId: appointment.id,
          email,
          eventType: "automatic_email_sent",
          metadata: {
            source: "send-reminders",
            email_kind: spec.kind,
            subject,
            notification_direction: spec.direction,
            notification_minutes: spec.minutes,
          },
        });

        await markNotificationProcessed(
          supabase,
          appointment.id,
          spec.kind,
          spec.sentAtField,
          spec.kind === "reminder_primary" ? spec.minutes : undefined
        );
        sentCount += 1;
      }
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
    return `${date} at ${formatTime12h(time)} (${tzAbbrev})`;
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

function getNotificationSpecs(studio: any): NotificationSpec[] {
  const primaryMinutes = Math.max(1, Number(studio.reminder_minutes_before) || 1440);
  const secondaryMinutes = Math.max(1, Number(studio.reminder_secondary_minutes_before) || 4320);
  const quickMinutes = Math.max(1, Number(studio.followup_quick_minutes_after) || 180);
  const longtermMinutes = Math.max(1, Number(studio.followup_longterm_minutes_after) || 30240);

  return [
    {
      kind: "reminder_primary",
      direction: "before",
      minutes: primaryMinutes,
      enabled: Boolean(studio.email_reminders_enabled),
      sentAtField: "reminder_primary_sent_at",
      subjectTemplate:
        studio.booking_reminder_subject_template || DEFAULT_PRIMARY_REMINDER_SUBJECT_TEMPLATE,
      bodyTemplate: studio.booking_reminder_body_template || DEFAULT_PRIMARY_REMINDER_BODY_TEMPLATE,
    },
    {
      kind: "reminder_secondary",
      direction: "before",
      minutes: secondaryMinutes,
      enabled: Boolean(studio.reminder_secondary_enabled),
      sentAtField: "reminder_secondary_sent_at",
      subjectTemplate:
        studio.booking_reminder_secondary_subject_template ||
        DEFAULT_SECONDARY_REMINDER_SUBJECT_TEMPLATE,
      bodyTemplate:
        studio.booking_reminder_secondary_body_template || DEFAULT_SECONDARY_REMINDER_BODY_TEMPLATE,
    },
    {
      kind: "followup_quick",
      direction: "after",
      minutes: quickMinutes,
      enabled: Boolean(studio.followup_quick_enabled),
      sentAtField: "followup_quick_sent_at",
      subjectTemplate:
        studio.booking_followup_quick_subject_template || DEFAULT_FOLLOWUP_QUICK_SUBJECT_TEMPLATE,
      bodyTemplate:
        studio.booking_followup_quick_body_template || DEFAULT_FOLLOWUP_QUICK_BODY_TEMPLATE,
    },
    {
      kind: "followup_longterm",
      direction: "after",
      minutes: longtermMinutes,
      enabled: Boolean(studio.followup_longterm_enabled),
      sentAtField: "followup_longterm_sent_at",
      subjectTemplate:
        studio.booking_followup_longterm_subject_template ||
        DEFAULT_FOLLOWUP_LONGTERM_SUBJECT_TEMPLATE,
      bodyTemplate:
        studio.booking_followup_longterm_body_template || DEFAULT_FOLLOWUP_LONGTERM_BODY_TEMPLATE,
    },
  ];
}

async function markNotificationProcessed(
  supabase: ReturnType<typeof createClient>,
  appointmentId: string,
  kind: NotificationKind,
  sentField: NotificationSpec["sentAtField"],
  reminderMinutes?: number
) {
  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    [sentField]: nowIso,
  };

  if (kind === "reminder_primary") {
    updatePayload.reminder_sent_at = nowIso;
    updatePayload.reminder_minutes_before = reminderMinutes ?? null;
  }

  await supabase
    .from("appointments")
    .update(updatePayload)
    .eq("id", appointmentId);
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

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key) => vars[key] || "");
}

function textToHtml(body: string) {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;white-space:pre-wrap;">${escaped}</body></html>`;
}
