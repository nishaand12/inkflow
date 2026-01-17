export const normalizeUserRole = (role) => {
  if (!role) return null;
  const normalized = role.replace(/\s+/g, "_").toLowerCase();
  if (normalized === "owner") return "Owner";
  if (normalized === "admin") return "Admin";
  if (normalized === "artist") return "Artist";
  if (normalized === "front_desk" || normalized === "frontdesk") return "Front_Desk";
  return role;
};
