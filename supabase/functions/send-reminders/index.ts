import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatTime12h } from "../_shared/timeDisplay.ts";
import { appUrl } from "../_shared/appUrl.ts";

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

If you need to change your appointment: {{manage_appointment_link}}

If you have questions, contact {{studio_email}}.

See you soon!`;
const DEFAULT_SECONDARY_REMINDER_SUBJECT_TEMPLATE = "Heads up: your appointment is coming up - {{studio_name}}";
const DEFAULT_SECONDARY_REMINDER_BODY_TEMPLATE = `Hi {{customer_name}},

Your appointment is coming up on {{appointment_date_time}} at {{location_name}} with {{artist_name}}.

If you need to reschedule: {{manage_appointment_link}}

If you need to reschedule, please contact {{studio_email}} as soon as possible.

See you soon!`;
const DEFAULT_TERTIARY_REMINDER_SUBJECT_TEMPLATE = "Your appointment is today - {{studio_name}}";
const DEFAULT_TERTIARY_REMINDER_BODY_TEMPLATE = `Hi {{customer_name}},

Just a reminder that your appointment is today at {{appointment_date_time}} at {{location_name}} with {{artist_name}}.

See you soon!`;
const DEFAULT_FOLLOWUP_QUICK_SUBJECT_TEMPLATE = "Aftercare instructions - {{studio_name}}";
const DEFAULT_FOLLOWUP_QUICK_BODY_TEMPLATE = `Hi {{customer_name}},

Thanks for visiting {{studio_name}} today.

If you need aftercare guidance, contact {{studio_email}}.

If anything feels off, contact {{studio_email}}.
`;
const DEFAULT_FOLLOWUP_LONGTERM_SUBJECT_TEMPLATE = "Long-term aftercare check-in - {{studio_name}}";
const DEFAULT_FOLLOWUP_LONGTERM_BODY_TEMPLATE = `Hi {{customer_name}},

This is your long-term aftercare check-in from {{studio_name}}.

If you need aftercare guidance, contact {{studio_email}}.

Questions? Reach us at {{studio_email}}.
`;
const DEFAULT_FOLLOWUP_MIDTERM_SUBJECT_TEMPLATE = "Check-in from {{studio_name}}";
const DEFAULT_FOLLOWUP_MIDTERM_BODY_TEMPLATE = `Hi {{customer_name}},

It's been a while since your visit to {{studio_name}}.

If you need any follow-up care or want to book your next appointment, contact {{studio_email}}.

We'd love to see you again!`;

type NotificationKind =
  | "reminder_primary"
  | "reminder_secondary"
  | "reminder_tertiary"
  | "followup_quick"
  | "followup_longterm"
  | "followup_midterm";

type NotificationSpec = {
  kind: NotificationKind;
  direction: "before" | "after";
  anchorField: "start" | "end";
  minutes: number;
  enabled: boolean;
  sentAtField: string;
  subjectTemplate: string;
  bodyTemplate: string;
  includeManageLink: boolean;
};

serve(async (req) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: "Supabase env vars are missing" }, 500);
    }

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
        customer:customers(*),
        appointment_type:appointment_types(*)
      `
      )
      .in("status", ["scheduled", "confirmed", "deposit_paid", "completed"]);

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    // Batch-load profiles, assignments, and booking hierarchy per studio
    const studioIds = [...new Set((appointments || []).map((a: any) => a.studio?.id).filter(Boolean))];
    const profilesMap: Record<string, any[]> = {};
    const assignmentsMap: Record<string, any[]> = {};
    const kindCategoriesMap: Record<string, any[]> = {};

    for (const sid of studioIds) {
      const [{ data: profiles }, { data: assignments }, { data: cats }] = await Promise.all([
        supabase.from("studio_notification_profiles").select("*").eq("studio_id", sid),
        supabase.from("appointment_kind_notification_assignments").select("*").eq("studio_id", sid),
        supabase.from("reporting_categories").select("*").eq("studio_id", sid).eq("category_role", "appointment_kind"),
      ]);
      profilesMap[sid] = profiles || [];
      assignmentsMap[sid] = assignments || [];
      kindCategoriesMap[sid] = cats || [];
    }

    let sentCount = 0;
    for (const appointment of appointments || []) {
      const studio = appointment.studio;
      if (!studio || studio.subscription_tier !== "plus") {
        continue;
      }

      const timezone = studio.timezone || "UTC";
      const startTimeUTC = getAppointmentTimeInUTC(
        appointment.appointment_date,
        appointment.start_time,
        timezone
      );
      const endTimeUTC = getAppointmentEndTimeInUTC(appointment, timezone);

      // Resolve the profile for this appointment
      const kindCategoryId = appointment.appointment_type?.appointment_kind_category_id || null;
      const kindCats = kindCategoriesMap[studio.id] || [];
      const studioProfiles = profilesMap[studio.id] || [];
      const studioAssignments = assignmentsMap[studio.id] || [];

      const profile = resolveProfileForAppointment(
        kindCats, studioProfiles, studioAssignments, kindCategoryId
      );

      // No profile assigned/default → fall back to studio default templates.
      const specs = profile
        ? resolveSpecsFromProfile(profile)
        : resolveStudioDefaultSpecs(studio);

      // Resolve manage link once per appointment
      const manageLink = await resolveManageLink(supabase, appointment);

      const anchorAt = appointment.notification_anchor_at
        ? new Date(appointment.notification_anchor_at)
        : (appointment.created_at ? new Date(appointment.created_at) : new Date(0));

      for (const spec of specs) {
        if (!spec.enabled) continue;
        if (appointment[spec.sentAtField]) continue;

        const anchorTime = spec.anchorField === "end" ? endTimeUTC : startTimeUTC;
        const sendAt =
          spec.direction === "before"
            ? new Date(anchorTime.getTime() - spec.minutes * 60 * 1000)
            : new Date(anchorTime.getTime() + spec.minutes * 60 * 1000);
        if (now < sendAt) continue;

        const isFollowup = spec.direction === "after";
        if (isFollowup && appointment.status !== "completed") continue;

        // Late-booking skip: if before-start reminder and appointment was booked
        // after this slot's send time, skip it (would be redundant with confirmation)
        if (!isFollowup && anchorAt > sendAt) {
          await markNotificationProcessed(supabase, appointment.id, spec.kind, spec.sentAtField);
          continue;
        }

        if (!isFollowup && now > startTimeUTC) {
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

        const templateVars: Record<string, string> = {
          customer_name: customerName,
          studio_name: studio.name || "Studio",
          appointment_date_time: formattedDateTime,
          location_name: locationText,
          artist_name: artistName,
          deposit_amount: depositAmount > 0 ? depositAmount.toFixed(2) : "",
          deposit_link: "",
          manage_appointment_link: spec.includeManageLink ? manageLink : "",
          studio_email: studioEmail,
        };

        let bodyTemplate = spec.bodyTemplate;
        // Append manage link if template lacks the placeholder but link is available
        if (spec.includeManageLink && manageLink) {
          const hasPlaceholder = /\{\{\s*manage_appointment_link\s*\}\}/i.test(bodyTemplate);
          if (!hasPlaceholder) {
            bodyTemplate = `${bodyTemplate.trim()}\n\nIf you need to change your appointment: ${manageLink}`;
          }
        }

        const subject = renderTemplate(spec.subjectTemplate, templateVars);
        const body = renderTemplate(bodyTemplate, templateVars);
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

// --- Profile resolution ---

function resolveProfileForAppointment(
  kindCategories: any[],
  profiles: any[],
  assignments: any[],
  kindCategoryId: string | null
): any | null {
  if (profiles.length === 0) return null;

  // Walk from leaf to root, finding the first assignment
  if (kindCategoryId && assignments.length > 0) {
    const byId: Record<string, any> = {};
    for (const c of kindCategories) byId[c.id] = c;
    const seen = new Set<string>();
    let curId: string | null = kindCategoryId;
    while (curId && !seen.has(curId)) {
      seen.add(curId);
      const assignment = assignments.find((a: any) => a.kind_category_id === curId);
      if (assignment) {
        const profile = profiles.find((p: any) => p.id === assignment.profile_id);
        if (profile) return profile;
      }
      const parent = byId[curId]?.parent_id;
      curId = parent || null;
    }
  }

  // Fallback to default profile
  return profiles.find((p: any) => p.is_default) || null;
}

function resolveSpecsFromProfile(profile: any): NotificationSpec[] {
  return [
    {
      kind: "reminder_secondary",
      direction: "before",
      anchorField: "start",
      minutes: profile.reminder_secondary_minutes || 4320,
      enabled: Boolean(profile.reminder_secondary_enabled),
      sentAtField: "reminder_secondary_sent_at",
      subjectTemplate: profile.reminder_secondary_subject || DEFAULT_SECONDARY_REMINDER_SUBJECT_TEMPLATE,
      bodyTemplate: profile.reminder_secondary_body || DEFAULT_SECONDARY_REMINDER_BODY_TEMPLATE,
      includeManageLink: true,
    },
    {
      kind: "reminder_primary",
      direction: "before",
      anchorField: "start",
      minutes: profile.reminder_primary_minutes || 1440,
      enabled: Boolean(profile.reminder_primary_enabled),
      sentAtField: "reminder_primary_sent_at",
      subjectTemplate: profile.reminder_primary_subject || DEFAULT_PRIMARY_REMINDER_SUBJECT_TEMPLATE,
      bodyTemplate: profile.reminder_primary_body || DEFAULT_PRIMARY_REMINDER_BODY_TEMPLATE,
      includeManageLink: true,
    },
    {
      kind: "reminder_tertiary",
      direction: "before",
      anchorField: "start",
      minutes: profile.reminder_tertiary_minutes || 120,
      enabled: Boolean(profile.reminder_tertiary_enabled),
      sentAtField: "reminder_tertiary_sent_at",
      subjectTemplate: profile.reminder_tertiary_subject || DEFAULT_TERTIARY_REMINDER_SUBJECT_TEMPLATE,
      bodyTemplate: profile.reminder_tertiary_body || DEFAULT_TERTIARY_REMINDER_BODY_TEMPLATE,
      includeManageLink: false,
    },
    {
      kind: "followup_quick",
      direction: "after",
      anchorField: "end",
      minutes: profile.followup_quick_minutes || 120,
      enabled: Boolean(profile.followup_quick_enabled),
      sentAtField: "followup_quick_sent_at",
      subjectTemplate: profile.followup_quick_subject || DEFAULT_FOLLOWUP_QUICK_SUBJECT_TEMPLATE,
      bodyTemplate: profile.followup_quick_body || DEFAULT_FOLLOWUP_QUICK_BODY_TEMPLATE,
      includeManageLink: true,
    },
    {
      kind: "followup_longterm",
      direction: "after",
      anchorField: "end",
      minutes: profile.followup_longterm_minutes || 30240,
      enabled: Boolean(profile.followup_longterm_enabled),
      sentAtField: "followup_longterm_sent_at",
      subjectTemplate: profile.followup_longterm_subject || DEFAULT_FOLLOWUP_LONGTERM_SUBJECT_TEMPLATE,
      bodyTemplate: profile.followup_longterm_body || DEFAULT_FOLLOWUP_LONGTERM_BODY_TEMPLATE,
      includeManageLink: true,
    },
    {
      kind: "followup_midterm",
      direction: "after",
      anchorField: "end",
      minutes: profile.followup_midterm_minutes || 108000,
      enabled: Boolean(profile.followup_midterm_enabled),
      sentAtField: "followup_midterm_sent_at",
      subjectTemplate: profile.followup_midterm_subject || DEFAULT_FOLLOWUP_MIDTERM_SUBJECT_TEMPLATE,
      bodyTemplate: profile.followup_midterm_body || DEFAULT_FOLLOWUP_MIDTERM_BODY_TEMPLATE,
      includeManageLink: true,
    },
  ];
}

// --- Studio default resolution (when no profile is assigned) ---

function resolveStudioDefaultSpecs(studio: any): NotificationSpec[] {
  const specs: { kind: NotificationKind; direction: "before" | "after"; anchorField: "start" | "end"; studioMinutes: number; studioEnabled: boolean; sentAtField: string; studioSubject: string; studioBody: string; defaultSubject: string; defaultBody: string; includeManageLink: boolean }[] = [
    {
      kind: "reminder_primary",
      direction: "before",
      anchorField: "start",
      studioMinutes: Number(studio.reminder_minutes_before) || 1440,
      studioEnabled: Boolean(studio.email_reminders_enabled),
      sentAtField: "reminder_primary_sent_at",
      studioSubject: studio.booking_reminder_subject_template || "",
      studioBody: studio.booking_reminder_body_template || "",
      defaultSubject: DEFAULT_PRIMARY_REMINDER_SUBJECT_TEMPLATE,
      defaultBody: DEFAULT_PRIMARY_REMINDER_BODY_TEMPLATE,
      includeManageLink: true,
    },
    {
      kind: "reminder_secondary",
      direction: "before",
      anchorField: "start",
      studioMinutes: Number(studio.reminder_secondary_minutes_before) || 4320,
      studioEnabled: Boolean(studio.reminder_secondary_enabled),
      sentAtField: "reminder_secondary_sent_at",
      studioSubject: studio.booking_reminder_secondary_subject_template || "",
      studioBody: studio.booking_reminder_secondary_body_template || "",
      defaultSubject: DEFAULT_SECONDARY_REMINDER_SUBJECT_TEMPLATE,
      defaultBody: DEFAULT_SECONDARY_REMINDER_BODY_TEMPLATE,
      includeManageLink: true,
    },
    {
      kind: "reminder_tertiary",
      direction: "before",
      anchorField: "start",
      studioMinutes: Number(studio.reminder_tertiary_minutes_before) || 120,
      studioEnabled: Boolean(studio.reminder_tertiary_enabled),
      sentAtField: "reminder_tertiary_sent_at",
      studioSubject: "",
      studioBody: "",
      defaultSubject: DEFAULT_TERTIARY_REMINDER_SUBJECT_TEMPLATE,
      defaultBody: DEFAULT_TERTIARY_REMINDER_BODY_TEMPLATE,
      includeManageLink: false,
    },
    {
      kind: "followup_quick",
      direction: "after",
      anchorField: "end",
      studioMinutes: Number(studio.followup_quick_minutes_after) || 120,
      studioEnabled: Boolean(studio.followup_quick_enabled),
      sentAtField: "followup_quick_sent_at",
      studioSubject: studio.booking_followup_quick_subject_template || "",
      studioBody: studio.booking_followup_quick_body_template || "",
      defaultSubject: DEFAULT_FOLLOWUP_QUICK_SUBJECT_TEMPLATE,
      defaultBody: DEFAULT_FOLLOWUP_QUICK_BODY_TEMPLATE,
      includeManageLink: true,
    },
    {
      kind: "followup_longterm",
      direction: "after",
      anchorField: "end",
      studioMinutes: Number(studio.followup_longterm_minutes_after) || 30240,
      studioEnabled: Boolean(studio.followup_longterm_enabled),
      sentAtField: "followup_longterm_sent_at",
      studioSubject: studio.booking_followup_longterm_subject_template || "",
      studioBody: studio.booking_followup_longterm_body_template || "",
      defaultSubject: DEFAULT_FOLLOWUP_LONGTERM_SUBJECT_TEMPLATE,
      defaultBody: DEFAULT_FOLLOWUP_LONGTERM_BODY_TEMPLATE,
      includeManageLink: true,
    },
    {
      kind: "followup_midterm",
      direction: "after",
      anchorField: "end",
      studioMinutes: Number(studio.followup_midterm_minutes_after) || 108000,
      studioEnabled: Boolean(studio.followup_midterm_enabled),
      sentAtField: "followup_midterm_sent_at",
      studioSubject: "",
      studioBody: "",
      defaultSubject: DEFAULT_FOLLOWUP_MIDTERM_SUBJECT_TEMPLATE,
      defaultBody: DEFAULT_FOLLOWUP_MIDTERM_BODY_TEMPLATE,
      includeManageLink: true,
    },
  ];

  return specs.map((s) => ({
    kind: s.kind,
    direction: s.direction,
    anchorField: s.anchorField,
    minutes: Math.max(1, s.studioMinutes),
    enabled: s.studioEnabled,
    sentAtField: s.sentAtField,
    subjectTemplate: s.studioSubject || s.defaultSubject,
    bodyTemplate: s.studioBody || s.defaultBody,
    includeManageLink: s.includeManageLink,
  }));
}

// --- Manage link resolution ---

async function resolveManageLink(supabase: any, appointment: any): Promise<string> {
  try {
    const { data: tokenRow } = await supabase
      .from("appointment_manage_tokens")
      .select("token, expires_at, revoked_at")
      .eq("appointment_id", appointment.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenRow && new Date(tokenRow.expires_at) > new Date()) {
      return appUrl(`/manage-appointment?token=${tokenRow.token}`);
    }
  } catch {
    // silently ignore
  }
  return "";
}

// --- Helpers ---

function resolveEmailAddress(appointment: any, customer: any) {
  if (appointment.client_email && appointment.client_email.trim()) {
    return appointment.client_email.trim();
  }
  if (customer?.email && customer.email.trim()) {
    return customer.email.trim();
  }
  return null;
}

function getAppointmentEndTimeInUTC(appointment: any, timezone: string): Date {
  if (appointment.end_time) {
    return getAppointmentTimeInUTC(appointment.appointment_date, appointment.end_time, timezone);
  }
  const durationMinutes = appointment.appointment_type?.duration_minutes || 60;
  const startUTC = getAppointmentTimeInUTC(appointment.appointment_date, appointment.start_time, timezone);
  return new Date(startUTC.getTime() + durationMinutes * 60 * 1000);
}

function formatAppointmentTime(date: string, time: string, timezone: string) {
  try {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);

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

    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

    const targetFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    });
    const parts = targetFormatter.formatToParts(utcDate);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');

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

    const adjustedDate = new Date(utcDate.getTime() - offsetMinutes * 60 * 1000);
    return formatter.format(adjustedDate);
  } catch (e) {
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

function getAppointmentTimeInUTC(date: string, time: string, timezone: string): Date {
  try {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);

    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

    const targetFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    });
    const parts = targetFormatter.formatToParts(utcDate);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');

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

    return new Date(utcDate.getTime() - offsetMinutes * 60 * 1000);
  } catch {
    return new Date(`${date}T${time}:00Z`);
  }
}

async function markNotificationProcessed(
  supabase: ReturnType<typeof createClient>,
  appointmentId: string,
  kind: NotificationKind,
  sentField: string,
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
