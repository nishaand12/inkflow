import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { formatTime12h } from "../_shared/timeDisplay.ts";
import { appUrl } from "../_shared/appUrl.ts";
import { STAFF_DEPOSIT_CHECKOUT_EXPIRY_SECONDS } from "../_shared/depositCheckoutExpiry.ts";
import { mergeStripeDepositPaidMetadata } from "../_shared/stripeDepositPaymentMetadata.ts";

const MAILJET_API_KEY = Deno.env.get("MAILJET_API_KEY");
const MAILJET_SECRET_KEY = Deno.env.get("MAILJET_SECRET_KEY");
const MAILJET_SENDER_EMAIL = Deno.env.get("MAILJET_SENDER_EMAIL");
const MAILJET_SENDER_NAME = Deno.env.get("MAILJET_SENDER_NAME");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

const MAILJET_API_URL = "https://api.mailjet.com/v3.1/send";
const DEFAULT_CONFIRMATION_SUBJECT_TEMPLATE = "Appointment Confirmation - {{studio_name}}";
const DEFAULT_CONFIRMATION_BODY_TEMPLATE = `Hi {{customer_name}},

Your appointment is confirmed for {{appointment_date_time}} at {{location_name}} with {{artist_name}}.

If a deposit is required, pay your deposit here: {{deposit_link}}

If you need to change your appointment: {{manage_appointment_link}}
Changes are only allowed up to 24 hours before your appointment.

If you have questions, contact {{studio_email}}.

Looking forward to seeing you!`;
const DEFAULT_CANCELLATION_SUBJECT_TEMPLATE = "Appointment Cancelled - {{studio_name}}";
const DEFAULT_CANCELLATION_BODY_TEMPLATE = `Hi {{customer_name}},

Your appointment scheduled for {{appointment_date_time}} at {{location_name}} with {{artist_name}} has been cancelled.

If this was unexpected or you want to rebook, please contact {{studio_email}}.

Thank you.`;

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

    const requestBody = await req.json().catch(() => ({}));
    const appointmentId = requestBody?.appointmentId || requestBody?.appointment_id;
    const eventTypeRaw = requestBody?.eventType || requestBody?.event_type || "created";
    const eventType = String(eventTypeRaw).toLowerCase();
    const source = String(requestBody?.source || "").toLowerCase();

    if (!appointmentId) {
      return jsonResponse({ error: "Missing appointmentId" }, 400);
    }

    if (!["created", "updated", "cancelled"].includes(eventType)) {
      return jsonResponse({ skipped: true, reason: "unsupported_event_type" }, 200);
    }

    // Basic authorization: allow anon key (frontend calls) or service-role key (server-to-server calls)
    const apiKey = req.headers.get("apikey");
    const authHeader = req.headers.get("authorization");
    const expectedAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = SUPABASE_SERVICE_ROLE_KEY;
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;
    const keyMatches =
      Boolean(apiKey) &&
      ((Boolean(expectedAnonKey) && apiKey === expectedAnonKey) ||
        (Boolean(serviceKey) && apiKey === serviceKey));
    const bearerMatches = Boolean(serviceKey && bearerToken && bearerToken === serviceKey);
    if (!keyMatches && !bearerMatches) {
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
        customer:customers(*),
        appointment_type:appointment_types(*)
      `
      )
      .eq("id", appointmentId)
      .single();

    if (error || !appointment) {
      return jsonResponse({ error: "Appointment not found" }, 404);
    }

    // Prevent duplicate confirmation emails for the same appointment.
    if (eventType === "created" && appointment.email_send_status === "sent") {
      return jsonResponse({ skipped: true, reason: "email_already_sent", message: "Confirmation email already sent for this appointment." }, 200);
    }

    const studio = appointment.studio;
    const customer = appointment.customer;

    if (!studio || studio.subscription_tier !== "plus") {
      return jsonResponse({ skipped: true, reason: "plus_tier_required" }, 200);
    }

    if (studio.email_confirmations_enabled === false) {
      return jsonResponse({ skipped: true, reason: "confirmations_disabled" }, 200);
    }

    // Resolve the notification profile (if any) for confirmation template + gating.
    // Cancellation emails always send regardless of profile confirmation settings.
    let confirmationProfile: any = null;
    if (eventType !== "cancelled") {
      try {
        const kindCategoryId = appointment.appointment_type?.appointment_kind_category_id || null;
        const [{ data: profiles }, { data: assignments }, { data: kindCats }] = await Promise.all([
          supabase.from("studio_notification_profiles").select("*").eq("studio_id", studio.id),
          supabase.from("appointment_kind_notification_assignments").select("*").eq("studio_id", studio.id),
          supabase
            .from("reporting_categories")
            .select("*")
            .eq("studio_id", studio.id)
            .eq("category_role", "appointment_kind"),
        ]);
        confirmationProfile = resolveProfileForAppointment(
          kindCats || [],
          profiles || [],
          assignments || [],
          kindCategoryId
        );
      } catch (profErr) {
        console.error("Failed to resolve notification profile:", profErr);
      }

      if (confirmationProfile && confirmationProfile.confirmation_enabled === false) {
        return jsonResponse({ skipped: true, reason: "confirmation_disabled_by_profile" }, 200);
      }
    }

    if (eventType === "updated") {
      await resetAppointmentNotificationSchedule(supabase, appointmentId);
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

    const formattedDateTime = formatAppointmentTime(
      appointment.appointment_date,
      appointment.start_time,
      studio.timezone || "UTC"
    );

    const locationText = appointment.location?.name || "Location";
    const studioEmail = studio.studio_email || MAILJET_SENDER_EMAIL;

    // Generate deposit link for newly-created appointments if studio has Stripe connected.
    let depositUrl: string | null = null;
    if (
      eventType === "created" &&
      STRIPE_SECRET_KEY &&
      studio.stripe_account_id &&
      studio.stripe_charges_enabled &&
      appointment.deposit_amount &&
      appointment.deposit_amount > 0 &&
      appointment.deposit_status !== "paid"
    ) {
      try {
        depositUrl = await createDepositCheckout(supabase, appointment, studio, email);
      } catch (depErr) {
        console.error("Failed to create deposit checkout:", depErr);
      }
    }

    const customerName = appointment.client_name || customer?.name || "Customer";
    const artistName = appointment.artist?.full_name || "Artist";
    const depositAmount = Number(appointment.deposit_amount) || 0;

    // Manage link is public-booking only: reuse an existing token, or create one
    // when this send is from the public booking flow. Staff confirmations never
    // create tokens and only include a link if the appointment already has one.
    let manageLink = "";
    try {
      const { data: tokenRow } = await supabase
        .from("appointment_manage_tokens")
        .select("token, expires_at, revoked_at")
        .eq("appointment_id", appointmentId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (tokenRow && new Date(tokenRow.expires_at) > new Date()) {
        manageLink = appUrl(`/manage-appointment?token=${tokenRow.token}`);
      } else if (source === "public_booking") {
        const newToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
        const { data: created } = await supabase
          .from("appointment_manage_tokens")
          .insert({ appointment_id: appointmentId, token: newToken, expires_at: expiresAt })
          .select("token")
          .single();
        if (created) {
          manageLink = appUrl(`/manage-appointment?token=${created.token}`);
        }
      }
    } catch (tokenErr) {
      console.error("Failed to resolve manage token:", tokenErr);
    }

    const templateVars = {
      customer_name: customerName,
      studio_name: studio.name || "Studio",
      appointment_date_time: formattedDateTime,
      location_name: locationText,
      artist_name: artistName,
      deposit_amount: depositAmount > 0 ? depositAmount.toFixed(2) : "",
      deposit_link: depositUrl || "",
      manage_appointment_link: manageLink,
      studio_email: studioEmail,
    };
    let subjectTemplate =
      confirmationProfile?.confirmation_subject?.trim() ||
      studio.booking_confirmation_subject_template ||
      DEFAULT_CONFIRMATION_SUBJECT_TEMPLATE;
    let bodyTemplate =
      confirmationProfile?.confirmation_body?.trim() ||
      studio.booking_confirmation_body_template ||
      DEFAULT_CONFIRMATION_BODY_TEMPLATE;
    if (eventType === "cancelled") {
      subjectTemplate = DEFAULT_CANCELLATION_SUBJECT_TEMPLATE;
      bodyTemplate = DEFAULT_CANCELLATION_BODY_TEMPLATE;
    }

    // Guarantee manage-link + 24-hour policy copy for public-booking confirmation emails,
    // even if the studio uses an older custom template without the new placeholder.
    if (eventType === "created" && source === "public_booking" && manageLink) {
      const hasManagePlaceholder = /\{\{\s*manage_appointment_link\s*\}\}/i.test(bodyTemplate);
      const has24hPolicy = /24\s*hours?/i.test(bodyTemplate);
      if (!hasManagePlaceholder || !has24hPolicy) {
        const fallbackManageBlock = [
          "",
          `If you need to change your appointment: ${manageLink}`,
          "Changes are only allowed up to 24 hours before your appointment.",
        ].join("\n");
        bodyTemplate = `${bodyTemplate.trim()}\n${fallbackManageBlock}`;
      }
    }

    const subject = renderTemplate(subjectTemplate, templateVars);
    const textBody = renderTemplate(bodyTemplate, templateVars);
    const htmlBody = textToHtml(textBody);

    const attachments = [];
    if (eventType !== "cancelled" && customer?.send_calendar_invites) {
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
          To: [{ Email: email, Name: customerName }],
          Subject: subject,
          TextPart: textBody,
          HTMLPart: htmlBody,
          Attachments: attachments.length > 0 ? attachments : undefined
        }
      ]
    };

    const sendResult = await sendWithRetry(payload);
    if (!sendResult.ok) {
      await updateEmailStatus(supabase, appointmentId, "failed", sendResult.error || "mailjet_error");
      return jsonResponse({ error: "Mailjet send failed", message: sendResult.error }, 502);
    }

    await recordEmailEvent(supabase, {
      studioId: studio.id,
      customerId: appointment.customer_id || null,
      appointmentId: appointment.id,
      email,
      eventType: "automatic_email_sent",
      metadata: {
        source: "send-appointment-email",
        email_kind: eventType,
        subject,
        has_deposit_link: Boolean(depositUrl),
        deposit_amount: appointment.deposit_amount || null,
      },
    });

    await updateEmailStatus(supabase, appointmentId, "sent", null);
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

/** Walk from the appointment's leaf kind category up the parent chain to find an
 *  assigned notification profile; fall back to the studio default profile. */
function resolveProfileForAppointment(
  kindCategories: any[],
  profiles: any[],
  assignments: any[],
  kindCategoryId: string | null
): any | null {
  if (!profiles || profiles.length === 0) return null;

  if (kindCategoryId && assignments && assignments.length > 0) {
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

  return profiles.find((p: any) => p.is_default) || null;
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
  reason: string | null
) {
  await supabase
    .from("appointments")
    .update({
      email_send_status: status,
      email_send_failed_reason: reason,
      email_sent_at: status === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", appointmentId);
}

async function resetAppointmentNotificationSchedule(
  supabase: ReturnType<typeof createClient>,
  appointmentId: string
) {
  const { error } = await supabase
    .from("appointments")
    .update({
      reminder_primary_sent_at: null,
      reminder_secondary_sent_at: null,
      reminder_tertiary_sent_at: null,
      followup_quick_sent_at: null,
      followup_longterm_sent_at: null,
      followup_midterm_sent_at: null,
      notification_anchor_at: new Date().toISOString(),
    })
    .eq("id", appointmentId);

  if (error) {
    console.error("Failed to reset notification schedule after update:", error);
  }
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
  let endHour: number;
  let endMinute: number;
  let endDay = day;
  if (appointment.end_time) {
    const [eh, em] = appointment.end_time.split(':').map(Number);
    endHour = eh;
    endMinute = em;
    if (endHour < hour || (endHour === hour && endMinute < minute)) endDay = day + 1;
  } else {
    const fallbackEnd = hour * 60 + minute + 60;
    endHour = Math.floor(fallbackEnd / 60) % 24;
    endMinute = fallbackEnd % 60;
  }

  // Format date/time for iCal with timezone (TZID format)
  const formatLocalTime = (y: number, m: number, d: number, h: number, min: number) => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
  };
  
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

async function createDepositCheckout(
  supabase: ReturnType<typeof createClient>,
  appointment: any,
  studio: any,
  customerEmail: string | null
): Promise<string | null> {
  if (!STRIPE_SECRET_KEY) return null;

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

  const { data: existingPayments } = await supabase
    .from("payments")
    .select("*")
    .eq("appointment_id", appointment.id)
    .eq("payment_type", "deposit")
    .in("status", ["pending", "paid"])
    .order("created_at", { ascending: false });

  const paidPayment = existingPayments?.find((p: any) => p.status === "paid");
  if (paidPayment || appointment.deposit_status === "paid") {
    const pendingIdsToExpire = (existingPayments || [])
      .filter((p: any) => p.status === "pending")
      .map((p: any) => p.id);
    for (const pendingPayment of (existingPayments || []).filter((p: any) => p.status === "pending")) {
      if (!pendingPayment.stripe_checkout_session_id) continue;
      try {
        await stripe.checkout.sessions.expire(pendingPayment.stripe_checkout_session_id, {
          stripeAccount: studio.stripe_account_id,
        });
      } catch (_) {
        // Already-paid or already-expired sessions cannot be expired; local state is cleaned below.
      }
    }
    if (pendingIdsToExpire.length) {
      await supabase
        .from("payments")
        .update({ status: "expired" })
        .in("id", pendingIdsToExpire);
    }
    await supabase
      .from("appointments")
      .update({ status: "deposit_paid", deposit_status: "paid" })
      .eq("id", appointment.id);
    return null;
  }

  const now = new Date();
  const staleIds: string[] = [];
  let reusableUrl: string | null = null;
  const pendingPayments = existingPayments?.filter((p: any) => p.status === "pending") || [];
  for (const pendingPayment of pendingPayments) {
    if (!pendingPayment?.stripe_checkout_session_id || !pendingPayment?.checkout_url) {
      staleIds.push(pendingPayment.id);
      continue;
    }

    const existingSession = await stripe.checkout.sessions.retrieve(
      pendingPayment.stripe_checkout_session_id,
      { stripeAccount: studio.stripe_account_id }
    );

    if (existingSession.payment_status === "paid") {
      await supabase
        .from("payments")
        .update({
          status: "paid",
          stripe_payment_intent_id:
            typeof existingSession.payment_intent === "string"
              ? existingSession.payment_intent
              : null,
          paid_at: new Date().toISOString(),
          metadata: mergeStripeDepositPaidMetadata(pendingPayment.metadata),
        })
        .eq("id", pendingPayment.id);

      await supabase
        .from("appointments")
        .update({ status: "deposit_paid", deposit_status: "paid" })
        .eq("id", appointment.id);
      return null;
    }

    const sessionExpiresAt = existingSession.expires_at
      ? new Date(existingSession.expires_at * 1000)
      : null;
    if (existingSession.status === "open" && (!sessionExpiresAt || sessionExpiresAt > now)) {
      if (!reusableUrl) {
        reusableUrl = pendingPayment.checkout_url;
        continue;
      }

      try {
        await stripe.checkout.sessions.expire(pendingPayment.stripe_checkout_session_id, {
          stripeAccount: studio.stripe_account_id,
        });
      } catch (expireErr) {
        console.error("Failed to expire duplicate deposit session:", expireErr);
      }
      staleIds.push(pendingPayment.id);
      continue;
    }

    staleIds.push(pendingPayment.id);
  }

  if (staleIds.length) {
    await supabase
      .from("payments")
      .update({ status: "expired" })
      .in("id", staleIds);
  }

  if (reusableUrl) return reusableUrl;

  const currency = (studio.currency || "USD").toLowerCase();
  const unitAmount = Math.round(appointment.deposit_amount * 100);
  const expiresAt = Math.floor(Date.now() / 1000) + STAFF_DEPOSIT_CHECKOUT_EXPIRY_SECONDS;
  const idempotencyKey = `deposit-${appointment.id}-${new Date().toISOString().slice(0, 10)}`;

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Deposit – ${studio.name}`,
              description: `Appointment on ${appointment.appointment_date} at ${formatTime12h(appointment.start_time)}`,
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      customer_email: customerEmail || undefined,
      expires_at: expiresAt,
      success_url: appUrl(`/payment-success?session_id={CHECKOUT_SESSION_ID}&studio=${encodeURIComponent(studio.name)}&type=deposit`),
      cancel_url: appUrl(`/payment-cancelled?appointment_id=${appointment.id}&studio=${encodeURIComponent(studio.name)}`),
      metadata: {
        appointment_id: appointment.id,
        studio_id: studio.id,
        customer_id: appointment.customer_id || "",
        payment_type: "deposit",
      },
    },
    { stripeAccount: studio.stripe_account_id, idempotencyKey }
  );

  await supabase.from("payments").insert({
    studio_id: studio.id,
    appointment_id: appointment.id,
    customer_id: appointment.customer_id || null,
    stripe_checkout_session_id: session.id,
    amount: appointment.deposit_amount,
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

  return session.url;
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders }
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
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) =>
      `<a href="${url}">${
        url.includes("checkout.stripe.com") ? "Stripe Deposit Link" : url
      }</a>`
  );
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;white-space:pre-wrap;">${withLinks}</body></html>`;
}
