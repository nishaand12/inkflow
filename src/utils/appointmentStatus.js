export const APPOINTMENT_STATUS_LABELS = {
  scheduled: "Scheduled",
  confirmed: "Checked-In/In-Progress",
  pending_deposit: "Pending Deposit",
  deposit_paid: "Deposit Paid",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

export function getAppointmentStatusLabel(status) {
  return APPOINTMENT_STATUS_LABELS[status] ?? status?.replace(/_/g, " ") ?? "";
}
