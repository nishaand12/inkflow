import React, { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { resolveCalendarJumpDate } from "@/utils/calendarViews";
import { cn } from "@/lib/utils";

export default function CalendarDatePicker({
  date,
  onDateChange,
  view,
  className,
  buttonClassName,
}) {
  const [open, setOpen] = useState(false);

  const handleSelect = (selected) => {
    if (!selected) return;
    onDateChange(resolveCalendarJumpDate(selected, view));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("px-3", buttonClassName, className)}
          aria-label="Jump to date"
        >
          <CalendarIcon className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 bg-white shadow-md" align="start">
        {open && (
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date}
            onSelect={handleSelect}
            initialFocus
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
