import React, { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  format12ComponentsToTime24,
  parseTime24To12Components,
  timeMinuteOptions,
} from "@/utils/index";

const HOUR_OPTIONS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTE_STEP = 5;

export default function TimePicker12h({
  value,
  onChange,
  disabled = false,
  id,
  required = false,
  className,
  compact = false,
}) {
  const { hour12, minute, period } = useMemo(
    () => parseTime24To12Components(value, MINUTE_STEP),
    [value]
  );

  const minuteOptions = useMemo(() => timeMinuteOptions(MINUTE_STEP), []);

  const emitChange = (nextHour12, nextMinute, nextPeriod) => {
    onChange(format12ComponentsToTime24(nextHour12, nextMinute, nextPeriod));
  };

  const triggerClass = compact ? "text-sm h-9" : "text-sm";

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Select
        value={String(hour12)}
        onValueChange={(v) => emitChange(parseInt(v, 10), minute, period)}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger id={id} className={cn(triggerClass, "w-[4.5rem]")} aria-label="Hour">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HOUR_OPTIONS.map((h) => (
            <SelectItem key={h} value={String(h)}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-gray-500 text-sm">:</span>

      <Select
        value={String(minute).padStart(2, "0")}
        onValueChange={(v) => emitChange(hour12, parseInt(v, 10), period)}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger className={cn(triggerClass, "w-[4.5rem]")} aria-label="Minute">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {minuteOptions.map((m) => (
            <SelectItem key={m} value={String(m).padStart(2, "0")}>
              {String(m).padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={period}
        onValueChange={(v) => emitChange(hour12, minute, v)}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger className={cn(triggerClass, "w-[4.5rem]")} aria-label="AM or PM">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
