/** Format stored "HH:mm" (24h) as "h:mm AM/PM" for user-visible strings. */
export function formatTime12h(timeStr: string | null | undefined): string {
  if (timeStr == null || timeStr === "") return "—";
  const parts = String(timeStr).trim().split(":");
  let h = parseInt(parts[0], 10);
  const min = parseInt(parts[1] || "0", 10);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return String(timeStr);
  const period = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(min).padStart(2, "0")} ${period}`;
}
