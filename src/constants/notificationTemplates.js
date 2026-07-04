export const DEFAULT_CONFIRMATION_SUBJECT_TEMPLATE = "Appointment Confirmation - {{studio_name}}";
export const DEFAULT_CONFIRMATION_BODY_TEMPLATE = `Hi {{customer_name}},

Your appointment is confirmed for {{appointment_date_time}} at {{location_name}} with {{artist_name}}.

If a deposit is required, pay your deposit here: {{deposit_link}}

If you need to change your appointment: {{manage_appointment_link}}
Changes are only allowed up to 24 hours before your appointment.

If you have questions, contact {{studio_email}}.

Looking forward to seeing you!`;

export const DEFAULT_REMINDER_SUBJECT_TEMPLATE = "Appointment Reminder - {{studio_name}}";
export const DEFAULT_REMINDER_BODY_TEMPLATE = `Hi {{customer_name}},

This is a reminder for your appointment on {{appointment_date_time}} at {{location_name}} with {{artist_name}}.

If you have questions, contact {{studio_email}}.

See you soon!`;

export const DEFAULT_SECONDARY_REMINDER_SUBJECT_TEMPLATE = "Heads up: your appointment is coming up - {{studio_name}}";
export const DEFAULT_SECONDARY_REMINDER_BODY_TEMPLATE = `Hi {{customer_name}},

Your appointment is coming up on {{appointment_date_time}} at {{location_name}} with {{artist_name}}.

If you need to reschedule, contact {{studio_email}} as soon as possible.
`;

export const DEFAULT_QUICK_FOLLOWUP_SUBJECT_TEMPLATE = "Aftercare instructions - {{studio_name}}";
export const DEFAULT_QUICK_FOLLOWUP_BODY_TEMPLATE = `Hi {{customer_name}},

Thanks for visiting {{studio_name}} today.

If you need aftercare guidance, contact {{studio_email}}.

Questions? Contact {{studio_email}}.
`;

export const DEFAULT_TERTIARY_REMINDER_SUBJECT_TEMPLATE = "Your appointment is today - {{studio_name}}";
export const DEFAULT_TERTIARY_REMINDER_BODY_TEMPLATE = `Hi {{customer_name}},

Just a reminder that your appointment is today at {{appointment_date_time}} at {{location_name}} with {{artist_name}}.

See you soon!`;

export const DEFAULT_LONGTERM_FOLLOWUP_SUBJECT_TEMPLATE = "Long-term aftercare check-in - {{studio_name}}";
export const DEFAULT_LONGTERM_FOLLOWUP_BODY_TEMPLATE = `Hi {{customer_name}},

This is your long-term aftercare check-in from {{studio_name}}.

If you need aftercare guidance, contact {{studio_email}}.

Questions? Contact {{studio_email}}.
`;

export const DEFAULT_MIDTERM_FOLLOWUP_SUBJECT_TEMPLATE = "Check-in from {{studio_name}}";
export const DEFAULT_MIDTERM_FOLLOWUP_BODY_TEMPLATE = `Hi {{customer_name}},

It's been a while since your visit to {{studio_name}}.

If you need any follow-up care or want to book your next appointment, contact {{studio_email}}.

We'd love to see you again!`;

export const NOTIFICATION_ITEMS = [
  {
    key: "confirmation",
    title: "Email confirmation",
    enabledField: "email_confirmations_enabled",
    timingField: null,
    timingLabel: "Sent immediately after booking/update",
    subjectField: "booking_confirmation_subject_template",
    bodyField: "booking_confirmation_body_template",
  },
  {
    key: "primary_reminder",
    title: "Single reminder",
    enabledField: "email_reminders_enabled",
    timingField: "reminder_minutes_before",
    timingDirection: "before",
    subjectField: "booking_reminder_subject_template",
    bodyField: "booking_reminder_body_template",
  },
  {
    key: "secondary_reminder",
    title: "Additional reminder",
    enabledField: "reminder_secondary_enabled",
    timingField: "reminder_secondary_minutes_before",
    timingDirection: "before",
    subjectField: "booking_reminder_secondary_subject_template",
    bodyField: "booking_reminder_secondary_body_template",
  },
  {
    key: "quick_followup",
    title: "Quick follow-up",
    enabledField: "followup_quick_enabled",
    timingField: "followup_quick_minutes_after",
    timingDirection: "after",
    subjectField: "booking_followup_quick_subject_template",
    bodyField: "booking_followup_quick_body_template",
  },
  {
    key: "longterm_followup",
    title: "Long-term follow-up",
    enabledField: "followup_longterm_enabled",
    timingField: "followup_longterm_minutes_after",
    timingDirection: "after",
    subjectField: "booking_followup_longterm_subject_template",
    bodyField: "booking_followup_longterm_body_template",
  },
];

export const DEFAULT_TEMPLATES = {
  booking_confirmation_subject_template: DEFAULT_CONFIRMATION_SUBJECT_TEMPLATE,
  booking_confirmation_body_template: DEFAULT_CONFIRMATION_BODY_TEMPLATE,
  booking_reminder_subject_template: DEFAULT_REMINDER_SUBJECT_TEMPLATE,
  booking_reminder_body_template: DEFAULT_REMINDER_BODY_TEMPLATE,
  booking_reminder_secondary_subject_template: DEFAULT_SECONDARY_REMINDER_SUBJECT_TEMPLATE,
  booking_reminder_secondary_body_template: DEFAULT_SECONDARY_REMINDER_BODY_TEMPLATE,
  booking_followup_quick_subject_template: DEFAULT_QUICK_FOLLOWUP_SUBJECT_TEMPLATE,
  booking_followup_quick_body_template: DEFAULT_QUICK_FOLLOWUP_BODY_TEMPLATE,
  booking_followup_longterm_subject_template: DEFAULT_LONGTERM_FOLLOWUP_SUBJECT_TEMPLATE,
  booking_followup_longterm_body_template: DEFAULT_LONGTERM_FOLLOWUP_BODY_TEMPLATE,
};

export const TEMPLATE_PLACEHOLDERS = [
  "{{customer_name}}",
  "{{studio_name}}",
  "{{appointment_date_time}}",
  "{{location_name}}",
  "{{artist_name}}",
  "{{deposit_amount}}",
  "{{deposit_link}}",
  "{{manage_appointment_link}}",
  "{{studio_email}}",
];

export function formatMinutes(minutes, relation = "before") {
  const val = Math.max(1, Number(minutes) || 0);
  if (val % 10080 === 0) {
    const weeks = val / 10080;
    return `${weeks} week${weeks === 1 ? "" : "s"} ${relation}`;
  }
  if (val % 1440 === 0) {
    const days = val / 1440;
    return `${days} day${days === 1 ? "" : "s"} ${relation}`;
  }
  if (val % 60 === 0) {
    const hours = val / 60;
    return `${hours} hour${hours === 1 ? "" : "s"} ${relation}`;
  }
  return `${val} minute${val === 1 ? "" : "s"} ${relation}`;
}

export function buildEmailSettingsFromStudio(studio) {
  return {
    studio_email: studio.studio_email || "",
    timezone: studio.timezone || "UTC",
    email_confirmations_enabled: studio.email_confirmations_enabled !== false,
    email_reminders_enabled: !!studio.email_reminders_enabled,
    reminder_minutes_before: studio.reminder_minutes_before || 1440,
    reminder_secondary_enabled: studio.reminder_secondary_enabled !== false,
    reminder_secondary_minutes_before: studio.reminder_secondary_minutes_before || 4320,
    followup_quick_enabled: studio.followup_quick_enabled !== false,
    followup_quick_minutes_after: studio.followup_quick_minutes_after || 120,
    followup_longterm_enabled: studio.followup_longterm_enabled !== false,
    followup_longterm_minutes_after: studio.followup_longterm_minutes_after || 30240,
    booking_confirmation_subject_template:
      studio.booking_confirmation_subject_template || DEFAULT_CONFIRMATION_SUBJECT_TEMPLATE,
    booking_confirmation_body_template:
      studio.booking_confirmation_body_template || DEFAULT_CONFIRMATION_BODY_TEMPLATE,
    booking_reminder_subject_template:
      studio.booking_reminder_subject_template || DEFAULT_REMINDER_SUBJECT_TEMPLATE,
    booking_reminder_body_template:
      studio.booking_reminder_body_template || DEFAULT_REMINDER_BODY_TEMPLATE,
    booking_reminder_secondary_subject_template:
      studio.booking_reminder_secondary_subject_template || DEFAULT_SECONDARY_REMINDER_SUBJECT_TEMPLATE,
    booking_reminder_secondary_body_template:
      studio.booking_reminder_secondary_body_template || DEFAULT_SECONDARY_REMINDER_BODY_TEMPLATE,
    booking_followup_quick_subject_template:
      studio.booking_followup_quick_subject_template || DEFAULT_QUICK_FOLLOWUP_SUBJECT_TEMPLATE,
    booking_followup_quick_body_template:
      studio.booking_followup_quick_body_template || DEFAULT_QUICK_FOLLOWUP_BODY_TEMPLATE,
    booking_followup_longterm_subject_template:
      studio.booking_followup_longterm_subject_template || DEFAULT_LONGTERM_FOLLOWUP_SUBJECT_TEMPLATE,
    booking_followup_longterm_body_template:
      studio.booking_followup_longterm_body_template || DEFAULT_LONGTERM_FOLLOWUP_BODY_TEMPLATE,
  };
}

export function buildEmailSavePayload(emailSettings) {
  return {
    studio_email: emailSettings.studio_email || null,
    timezone: emailSettings.timezone || "UTC",
    email_confirmations_enabled: emailSettings.email_confirmations_enabled,
    email_reminders_enabled: emailSettings.email_reminders_enabled,
    reminder_minutes_before: emailSettings.reminder_minutes_before,
    reminder_secondary_enabled: emailSettings.reminder_secondary_enabled,
    reminder_secondary_minutes_before: emailSettings.reminder_secondary_minutes_before,
    followup_quick_enabled: emailSettings.followup_quick_enabled,
    followup_quick_minutes_after: emailSettings.followup_quick_minutes_after,
    followup_longterm_enabled: emailSettings.followup_longterm_enabled,
    followup_longterm_minutes_after: emailSettings.followup_longterm_minutes_after,
    booking_confirmation_subject_template:
      emailSettings.booking_confirmation_subject_template?.trim() || DEFAULT_CONFIRMATION_SUBJECT_TEMPLATE,
    booking_confirmation_body_template:
      emailSettings.booking_confirmation_body_template?.trim() || DEFAULT_CONFIRMATION_BODY_TEMPLATE,
    booking_reminder_subject_template:
      emailSettings.booking_reminder_subject_template?.trim() || DEFAULT_REMINDER_SUBJECT_TEMPLATE,
    booking_reminder_body_template:
      emailSettings.booking_reminder_body_template?.trim() || DEFAULT_REMINDER_BODY_TEMPLATE,
    booking_reminder_secondary_subject_template:
      emailSettings.booking_reminder_secondary_subject_template?.trim() || DEFAULT_SECONDARY_REMINDER_SUBJECT_TEMPLATE,
    booking_reminder_secondary_body_template:
      emailSettings.booking_reminder_secondary_body_template?.trim() || DEFAULT_SECONDARY_REMINDER_BODY_TEMPLATE,
    booking_followup_quick_subject_template:
      emailSettings.booking_followup_quick_subject_template?.trim() || DEFAULT_QUICK_FOLLOWUP_SUBJECT_TEMPLATE,
    booking_followup_quick_body_template:
      emailSettings.booking_followup_quick_body_template?.trim() || DEFAULT_QUICK_FOLLOWUP_BODY_TEMPLATE,
    booking_followup_longterm_subject_template:
      emailSettings.booking_followup_longterm_subject_template?.trim() || DEFAULT_LONGTERM_FOLLOWUP_SUBJECT_TEMPLATE,
    booking_followup_longterm_body_template:
      emailSettings.booking_followup_longterm_body_template?.trim() || DEFAULT_LONGTERM_FOLLOWUP_BODY_TEMPLATE,
  };
}
