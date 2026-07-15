const PAGE_PATHS = {
  Dashboard: "/dashboard",
  Calendar: "/calendar",
  Appointments: "/appointments",
  Artists: "/artists",
  Locations: "/locations",
  Customers: "/customers",
  AppointmentTypes: "/appointment-types",
  Products: "/products",
  ReportingCategories: "/reporting-categories",
  Reports: "/reports",
  Sales: "/sales",
  Settlements: "/settlements",
  ArtistPayouts: "/artist-payouts",
  WorkStations: "/workstations",
  MyAvailability: "/my-availability",
  OnboardingChoice: "/onboarding-choice",
  PendingValidation: "/pending-validation",
  StudioSettings: "/studio-settings",
  PublicTemplates: "/public-templates",
  UserManagement: "/user-management",
  Supplies: "/supplies"
};

export const createPageUrl = (pageName) => {
  if (!pageName) return "/";
  return PAGE_PATHS[pageName] || `/${pageName.toLowerCase()}`;
};

export const APPOINTMENT_CATEGORIES = [
  'Tattoo',
  'Ear Lobe Piercings',
  'Ear Cartilage Piercings',
  'Facial Piercings',
  'Oral Piercings',
  'Body Piercings',
  'Genital Piercings',
  'Other Piercings',
  'Piercing Services',
];

export const PIERCING_CATEGORIES = new Set([
  'Ear Lobe Piercings',
  'Ear Cartilage Piercings',
  'Facial Piercings',
  'Oral Piercings',
  'Body Piercings',
  'Genital Piercings',
  'Other Piercings',
  'Piercing Services',
]);

/** Default start time for new appointment and availability booking forms (12:00 PM). */
export const DEFAULT_BOOKING_START_TIME = '12:00';

/** Default end time for new appointments (2 hours after default start). */
export const DEFAULT_APPOINTMENT_END_TIME = '14:00';

/** Default end time for new availability blocks (7:00 PM). */
export const DEFAULT_AVAILABILITY_END_TIME = '19:00';

/** Format an integer number of minutes into a human-readable string. */
export const formatDuration = (minutes) => {
  if (!minutes && minutes !== 0) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`;
  return `${h}h ${m}m`;
};

/** Add `minutes` to a "HH:MM" string and return a new "HH:MM" string. */
export const addMinutesToTime = (time, minutes) => {
  if (!time) return '00:00';
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + (minutes || 0);
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
};

/** Format stored "HH:mm" or "HH:mm:ss" (24h) as "h:mm AM/PM" for display. */
export function formatTime12h(timeStr) {
  if (timeStr == null || timeStr === '') return '—';
  const parts = String(timeStr).trim().split(':');
  let h = parseInt(parts[0], 10);
  const min = parseInt(parts[1] || '0', 10);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return String(timeStr);
  const period = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(min).padStart(2, '0')} ${period}`;
}

/** Display a start/end range in 12h, e.g. "9:00 AM – 10:30 AM". */
export function formatTimeRange12h(startStr, endStr) {
  if (!startStr) return '—';
  if (!endStr) return formatTime12h(startStr);
  return `${formatTime12h(startStr)} – ${formatTime12h(endStr)}`;
}

/** Resolve calendar card descriptor: custom name if set, otherwise appointment type. */
export function resolveAppointmentCardLabel(appointmentName, appointmentTypeName) {
  const name = (appointmentName || '').trim();
  if (name) return name;
  return (appointmentTypeName || '').trim();
}

/** Calendar card title: "Customer Name" or "Customer Name - [name or type]". */
export function formatAppointmentCardTitle(customerName, appointmentName, appointmentTypeName) {
  const customer = (customerName || 'Client').trim();
  const label = resolveAppointmentCardLabel(appointmentName, appointmentTypeName);
  return label ? `${customer} - ${label}` : customer;
}

/** Round minutes to the nearest 5-minute step (0–55). */
export function roundMinutesToStep(minute, step = 5) {
  const rounded = Math.round(minute / step) * step;
  return rounded >= 60 ? 55 : rounded;
}

/** Parse stored "HH:MM" (24h) into 12h picker components. */
export function parseTime24To12Components(time24, minuteStep = 5) {
  if (!time24) return { hour12: 12, minute: 0, period: 'PM' };
  const parts = String(time24).trim().split(':');
  let h24 = parseInt(parts[0], 10);
  let minute = parseInt(parts[1] || '0', 10);
  if (!Number.isFinite(h24)) h24 = 12;
  if (!Number.isFinite(minute)) minute = 0;
  minute = roundMinutesToStep(minute, minuteStep);
  const period = h24 >= 12 ? 'PM' : 'AM';
  let hour12 = h24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute, period };
}

/** Convert 12h picker components to stored "HH:MM" (24h). */
export function format12ComponentsToTime24(hour12, minute, period) {
  let h = parseInt(hour12, 10);
  const m = parseInt(minute, 10);
  if (!Number.isFinite(h) || h < 1 || h > 12) h = 12;
  const p = period === 'AM' ? 'AM' : 'PM';
  let h24 = h % 12;
  if (p === 'PM') h24 += 12;
  return `${String(h24).padStart(2, '0')}:${String(Number.isFinite(m) ? m : 0).padStart(2, '0')}`;
}

/** Generate minute options at a fixed step (default 5). */
export function timeMinuteOptions(step = 5) {
  const options = [];
  for (let m = 0; m < 60; m += step) options.push(m);
  return options;
}
