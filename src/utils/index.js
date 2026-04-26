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
  Settlements: "/settlements",
  WorkStations: "/workstations",
  MyAvailability: "/my-availability",
  OnboardingChoice: "/onboarding-choice",
  PendingValidation: "/pending-validation",
  StudioSettings: "/studio-settings",
  UserManagement: "/user-management"
};

export const createPageUrl = (pageName) => {
  if (!pageName) return "/";
  return PAGE_PATHS[pageName] || `/${pageName.toLowerCase()}`;
};

export const APPOINTMENT_CATEGORIES = [
  'Tattoo',
  'Ear Lobe Piercing',
  'Ear Cartilage Piercing',
  'Facial Piercing',
  'Oral Piercing',
  'Body Piercing',
  'Genital Piercing',
  'Other Piercings',
  'Other Piercing Services',
];

export const PIERCING_CATEGORIES = new Set([
  'Ear Lobe Piercing',
  'Ear Cartilage Piercing',
  'Facial Piercing',
  'Oral Piercing',
  'Body Piercing',
  'Genital Piercing',
  'Other Piercings',
  'Other Piercing Services',
]);

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
