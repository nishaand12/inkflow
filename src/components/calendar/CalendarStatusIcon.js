import React from "react";
import { Circle, UserCheck, CheckCircle2, XCircle, Clock, Wallet } from "lucide-react";
import { getAppointmentStatusLabel } from "@/utils/appointmentStatus";

const STATUS_CONFIG = {
  scheduled: { Icon: Circle, colorClass: "text-gray-500" },
  confirmed: { Icon: UserCheck, colorClass: "text-blue-600" },
  pending_deposit: { Icon: Clock, colorClass: "text-yellow-600" },
  deposit_paid: { Icon: Wallet, colorClass: "text-purple-600" },
  completed: { Icon: CheckCircle2, colorClass: "text-green-600" },
  cancelled: { Icon: XCircle, colorClass: "text-red-500" },
  no_show: { Icon: XCircle, colorClass: "text-red-500" },
};

export const CALENDAR_STATUS_LEGEND = ["scheduled", "deposit_paid", "confirmed", "completed"];

export default function CalendarStatusIcon({ status, className = "w-3 h-3", ...props }) {
  const { Icon, colorClass } = STATUS_CONFIG[status] ?? STATUS_CONFIG.scheduled;
  return <Icon className={`shrink-0 ${colorClass} ${className}`} aria-hidden {...props} />;
}

export function CalendarStatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
      <span className="font-semibold text-gray-700">Status:</span>
      {CALENDAR_STATUS_LEGEND.map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <CalendarStatusIcon status={status} />
          <span>{getAppointmentStatusLabel(status)}</span>
        </span>
      ))}
    </div>
  );
}
