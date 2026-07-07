import React from "react";
import { hexToRgba } from "@/utils/artistColors";
import { formatAppointmentCardTitle } from "@/utils/index";
import {
  getAppointmentDurationMins,
  getAppointmentBlockTypography,
  getAppointmentHeight,
  topFromTime,
} from "@/utils/calendarGrid";
import CalendarStatusIcon from "./CalendarStatusIcon";
import { getAppointmentStatusLabel } from "@/utils/appointmentStatus";

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
  const statusLabel = getAppointmentStatusLabel(apt.status);

  // Let the title flow vertically over as many lines as the block height allows,
  // clamping (with ellipsis) only when the text still exceeds the available space.
  const lineHeightRatio = 1.2;
  const availableTextHeight = height - typography.paddingTop - 2;
  const maxLines = Math.max(1, Math.floor(availableTextHeight / (typography.fontSize * lineHeightRatio)));

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
      title={`${title} (${statusLabel})`}
    >
      <div
        className="flex items-start gap-0.5 min-w-0"
        style={{
          paddingTop: typography.paddingTop,
          paddingLeft: typography.paddingX,
          paddingRight: typography.paddingX,
        }}
      >
        <div
          className="flex-1 min-w-0 font-semibold text-gray-900"
          style={{
            fontSize: typography.fontSize,
            lineHeight: lineHeightRatio,
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: maxLines,
            overflow: "hidden",
            wordBreak: "break-word",
          }}
        >
          {title}
        </div>
        <CalendarStatusIcon
          status={apt.status}
          style={{ width: typography.iconSize, height: typography.iconSize }}
        />
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
