const PAGE_PATHS = {
  Dashboard: "/dashboard",
  Calendar: "/calendar",
  Appointments: "/appointments",
  Artists: "/artists",
  Locations: "/locations",
  Customers: "/customers",
  AppointmentTypes: "/appointment-types",
  Reports: "/reports",
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
