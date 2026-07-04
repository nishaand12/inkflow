import React from "react";
import { hexToRgba } from "@/utils/artistColors";
import { formatAppointmentCardTitle } from "@/utils/index";
import {
  getAppointmentDurationMins,
  getAppointmentHeight,
  topFromTime,
} from "@/utils/calendarGrid";

export default function CalendarTimedBlock({
  apt,
  grid,
  color,
  title,
  onEdit,
  left,
  width,
}) {
  const top = topFromTime(apt.start_time, grid);
  const durationMins = getAppointmentDurationMins(apt);
  const height = getAppointmentHeight(durationMins, grid);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onEdit(apt);
      }}
      className="absolute rounded-r-md overflow-hidden cursor-pointer transition-opacity hover:opacity-80"
      style={{
        top: top + 1,
        height,
        left,
        width,
        backgroundColor: hexToRgba(color, 0.15),
        borderLeft: `3px solid ${color}`,
        zIndex: 10,
      }}
      title={title}
    >
      <div className="px-1 pt-0.5 h-full overflow-hidden">
        <div className="text-[9px] sm:text-[10px] font-semibold text-gray-900 truncate leading-none w-full">
          {title}
        </div>
      </div>
    </div>
  );
}

export function buildCalendarBlockTitle(getCustomerName, getAptTypeName, apt) {
  return formatAppointmentCardTitle(
    getCustomerName(apt),
    apt.appointment_name,
    getAptTypeName(apt)
  );
}
