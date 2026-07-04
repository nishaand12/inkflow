import React from "react";
import { hexToRgba } from "@/utils/artistColors";
import { formatAppointmentCardTitle } from "@/utils/index";
import {
  getAppointmentDurationMins,
  getAppointmentBlockTypography,
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
  const typography = getAppointmentBlockTypography(height);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onEdit(apt);
      }}
      className="absolute rounded-r-md overflow-hidden cursor-pointer transition-opacity hover:opacity-80 z-[1]"
      style={{
        top: top + 1,
        height,
        left,
        width,
        backgroundColor: hexToRgba(color, 0.15),
        borderLeft: `3px solid ${color}`,
      }}
      title={title}
    >
      <div
        className="h-full overflow-hidden"
        style={{
          paddingTop: typography.paddingTop,
          paddingLeft: typography.paddingX,
          paddingRight: typography.paddingX,
        }}
      >
        <div
          className="font-semibold text-gray-900 truncate w-full"
          style={{
            fontSize: typography.fontSize,
            lineHeight: typography.lineHeight,
          }}
        >
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
