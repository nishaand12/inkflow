import React, { useMemo } from "react";
import { format, isSameDay, isSameMonth, parseISO, isWithinInterval } from "date-fns";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDaysToShow } from "@/utils/calendarViews";
import { formatTimeRange12h } from "@/utils/index";
import { hexToRgba } from "@/utils/artistColors";

// ── Helpers ────────────────────────────────────────────────

function getAvailForDay(day, availabilities, artistFilter) {
  return availabilities.filter((avail) => {
    if (artistFilter && artistFilter !== "all" && avail.artist_id !== artistFilter) return false;
    const startDate = parseISO(avail.start_date + "T00:00:00");
    const endDate = parseISO(avail.end_date + "T00:00:00");
    return isWithinInterval(day, { start: startDate, end: endDate });
  });
}

function getWeeklyForDay(day, weeklySchedules, artistFilter) {
  const dow = day.getDay();
  return weeklySchedules.filter((ws) => {
    if (!ws.is_active) return false;
    if (artistFilter && artistFilter !== "all" && ws.artist_id !== artistFilter) return false;
    return ws.day_of_week === dow;
  });
}

/**
 * Build a unified list of card entries for a given day, sorted by artist name.
 * Each entry has: { id, type, artistId, artistName, color, label, sublabel, isBlocked, editable, raw }
 */
function buildDayCards(day, availabilities, weeklySchedules, artists, artistColorMap, artistFilter, canEditArtist, locations) {
  const dayAvails = getAvailForDay(day, availabilities, artistFilter);
  const dayWeekly = getWeeklyForDay(day, weeklySchedules, artistFilter);
  const cards = [];

  // All-day availability / blocked
  for (const avail of dayAvails) {
    if (!avail.is_all_day) continue;
    const artist = artists.find((a) => a.id === avail.artist_id);
    cards.push({
      id: avail.id,
      type: "allday",
      artistId: avail.artist_id,
      artistName: artist?.full_name || "Unknown",
      color: artistColorMap[avail.artist_id] || "#6366f1",
      label: avail.is_blocked ? "Day Off" : "Available All Day",
      sublabel: avail.notes || null,
      isBlocked: avail.is_blocked,
      editable: canEditArtist(avail.artist_id),
      raw: avail,
    });
  }

  // Weekly schedule
  for (const ws of dayWeekly) {
    const artist = artists.find((a) => a.id === ws.artist_id);
    const loc = locations.find((l) => l.id === ws.location_id);
    cards.push({
      id: "ws-" + ws.id,
      type: "weekly",
      artistId: ws.artist_id,
      artistName: artist?.full_name || "Unknown",
      color: artistColorMap[ws.artist_id] || "#6366f1",
      label: formatTimeRange12h(ws.start_time, ws.end_time),
      sublabel: loc ? loc.name : null,
      isBlocked: false,
      editable: false,
      raw: ws,
    });
  }

  // Timed availability / blocked (non-all-day)
  for (const avail of dayAvails) {
    if (avail.is_all_day) continue;
    const artist = artists.find((a) => a.id === avail.artist_id);
    const loc = locations.find((l) => l.id === avail.location_id);
    cards.push({
      id: avail.id,
      type: "timed",
      artistId: avail.artist_id,
      artistName: artist?.full_name || "Unknown",
      color: artistColorMap[avail.artist_id] || "#6366f1",
      label: formatTimeRange12h(avail.start_time, avail.end_time),
      sublabel: loc ? loc.name : null,
      isBlocked: avail.is_blocked,
      editable: canEditArtist(avail.artist_id),
      raw: avail,
    });
  }

  // Sort: all-day first, then by artist name, then by type
  cards.sort((a, b) => {
    if (a.type === "allday" && b.type !== "allday") return -1;
    if (a.type !== "allday" && b.type === "allday") return 1;
    const nameCompare = a.artistName.localeCompare(b.artistName);
    if (nameCompare !== 0) return nameCompare;
    return 0;
  });

  return cards;
}

// ── Card Component ─────────────────────────────────────────

function AvailabilityCard({ card, compact, onClick }) {
  const { artistName, color, label, sublabel, isBlocked, editable, type } = card;

  const isWeekly = type === "weekly";
  const isAllDay = type === "allday";

  // Card background and border use the artist's color
  const bgColor = isBlocked
    ? "rgba(239, 68, 68, 0.08)"
    : hexToRgba(color, 0.1);
  const borderColor = isBlocked
    ? "rgba(239, 68, 68, 0.25)"
    : hexToRgba(color, 0.35);
  const leftAccent = isBlocked ? "#ef4444" : color;

  if (compact) {
    return (
      <div
        onClick={editable && !isWeekly ? onClick : undefined}
        className={`flex items-center gap-1 rounded text-[11px] leading-tight px-1.5 py-[3px] border-l-[3px] border overflow-hidden ${
          editable && !isWeekly ? "cursor-pointer hover:shadow-sm" : ""
        }`}
        style={{
          backgroundColor: bgColor,
          borderColor,
          borderLeftColor: leftAccent,
        }}
      >
        <span className="font-semibold truncate" style={{ color: isBlocked ? "#dc2626" : color }}>
          {artistName}
        </span>
        <span className="text-gray-500 truncate">
          {isAllDay
            ? isBlocked ? "Off" : "All Day"
            : label}
        </span>
        {isWeekly && <span className="text-gray-400 text-[10px]">(w)</span>}
      </div>
    );
  }

  // Full-size card (week / day views)
  return (
    <div
      onClick={editable && !isWeekly ? onClick : undefined}
      className={`flex items-start gap-2.5 rounded-lg border-l-[4px] border px-3 py-2 ${
        editable && !isWeekly ? "cursor-pointer hover:shadow-md transition-shadow" : ""
      }`}
      style={{
        backgroundColor: bgColor,
        borderColor,
        borderLeftColor: leftAccent,
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm truncate" style={{ color: isBlocked ? "#b91c1c" : color }}>
            {artistName}
          </span>
          {isWeekly && (
            <span className="text-[10px] text-gray-400 bg-gray-100 rounded px-1 py-px shrink-0">weekly</span>
          )}
          {isBlocked && (
            <span className="text-[10px] text-red-600 bg-red-50 rounded px-1 py-px shrink-0">off</span>
          )}
        </div>
        <div className="text-xs text-gray-600 mt-0.5">
          {isAllDay ? (isBlocked ? "Day Off" : "Available All Day") : label}
          {sublabel && <span className="text-gray-400"> · {sublabel}</span>}
        </div>
        {card.sublabel && type === "allday" && card.raw?.notes && (
          <div className="text-[11px] text-gray-400 mt-0.5 truncate">{card.raw.notes}</div>
        )}
      </div>
    </div>
  );
}

// ── Month View ─────────────────────────────────────────────

function MonthView({
  days, currentDate, artists, artistColorMap, availabilities, weeklySchedules,
  locations, artistFilter, canEditArtist, onAddAvailability, onEditAvailability,
}) {
  return (
    <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
        <div key={d} className="text-center font-semibold text-gray-500 text-xs py-2 bg-gray-50">
          {d}
        </div>
      ))}
      {days.map((day, idx) => {
        const cards = buildDayCards(
          day, availabilities, weeklySchedules, artists, artistColorMap, artistFilter, canEditArtist, locations
        );
        const isToday = isSameDay(day, new Date());
        const isCurMonth = isSameMonth(day, currentDate);
        const canAddForAny = artists.some((a) => canEditArtist(a.id));

        return (
          <div
            key={idx}
            className={`group flex flex-col h-[130px] p-1.5 ${
              isToday ? "bg-indigo-50/60" : isCurMonth ? "bg-white" : "bg-gray-50/80"
            }`}
          >
            <div className="flex justify-between items-center mb-1 shrink-0">
              <div
                className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                  isToday
                    ? "bg-indigo-600 text-white"
                    : isCurMonth
                      ? "text-gray-900"
                      : "text-gray-400"
                }`}
              >
                {format(day, "d")}
              </div>
              {isCurMonth && canAddForAny && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 w-5 p-0 shrink-0 text-gray-500 hover:text-indigo-600 hover:bg-indigo-100"
                  onClick={(e) => { e.stopPropagation(); onAddAvailability(day); }}
                  aria-label={`Add availability for ${format(day, "MMMM d")}`}
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto space-y-px scrollbar-thin">
              {cards.map((card) => (
                <AvailabilityCard
                  key={card.id}
                  card={card}
                  compact
                  onClick={() => onEditAvailability(card.raw)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Week View (stacked cards, no time grid) ────────────────

function WeekView({
  days, artists, artistColorMap, availabilities, weeklySchedules,
  locations, artistFilter, canEditArtist, onAddAvailability, onEditAvailability,
}) {
  return (
    <div className="flex flex-col">
      {/* Day headers */}
      <div className="grid grid-cols-7 gap-px bg-gray-200 border-b border-gray-200">
        {days.map((day, i) => {
          const isToday = isSameDay(day, new Date());
          return (
            <div
              key={i}
              className={`text-center py-2 text-xs font-semibold ${
                isToday ? "bg-indigo-50 text-indigo-600" : "bg-gray-50 text-gray-600"
              }`}
            >
              <div>{format(day, "EEE")}</div>
              <div className={`text-lg font-bold mt-0.5 ${
                isToday ? "text-indigo-600" : "text-gray-900"
              }`}>
                {format(day, "d")}
              </div>
            </div>
          );
        })}
      </div>
      {/* Day columns with cards */}
      <div className="grid grid-cols-7 gap-px bg-gray-200 min-h-[400px]">
        {days.map((day, i) => {
          const cards = buildDayCards(
            day, availabilities, weeklySchedules, artists, artistColorMap, artistFilter, canEditArtist, locations
          );
          const isToday = isSameDay(day, new Date());
          const canAddForAny = artists.some((a) => canEditArtist(a.id));

          return (
            <div
              key={i}
              className={`flex flex-col p-1.5 ${isToday ? "bg-indigo-50/40" : "bg-white"}`}
              style={{ maxHeight: "calc(100vh - 320px)", overflowY: "auto" }}
            >
              {canAddForAny && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-full mb-1 text-[11px] text-gray-400 hover:text-indigo-600 hover:bg-indigo-50"
                  onClick={() => onAddAvailability(day)}
                >
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              )}
              <div className="space-y-1">
                {cards.map((card) => (
                  <AvailabilityCard
                    key={card.id}
                    card={card}
                    compact={false}
                    onClick={() => onEditAvailability(card.raw)}
                  />
                ))}
                {cards.length === 0 && (
                  <div className="text-[11px] text-gray-300 text-center py-4">—</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Day View (desktop & mobile) ────────────────────────────

function DayView({
  day, isMobile, artists, artistColorMap, availabilities, weeklySchedules,
  locations, artistFilter, canEditArtist, onAddAvailability, onEditAvailability,
}) {
  const cards = buildDayCards(
    day, availabilities, weeklySchedules, artists, artistColorMap, artistFilter, canEditArtist, locations
  );
  const canAddForAny = artists.some((a) => canEditArtist(a.id));

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className={`font-bold text-gray-900 ${isMobile ? "text-lg" : "text-xl"}`}>
          {format(day, "EEEE, MMMM d, yyyy")}
        </h3>
        {canAddForAny && (
          <Button
            size="sm"
            className="bg-indigo-600 hover:bg-indigo-700"
            onClick={() => onAddAvailability(day)}
          >
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        )}
      </div>

      {cards.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">No availability entries for this day</div>
      )}

      <div className="space-y-2">
        {cards.map((card) => (
          <AvailabilityCard
            key={card.id}
            card={card}
            compact={false}
            onClick={() => onEditAvailability(card.raw)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main Export ─────────────────────────────────────────────

export default function AvailabilityCalendar({
  view,
  currentDate,
  isMobile,
  artists,
  availabilities,
  weeklySchedules,
  locations,
  artistFilter,
  artistColorMap,
  canEditArtist,
  onAddAvailability,
  onEditAvailability,
}) {
  const days = useMemo(() => getDaysToShow(currentDate, view), [currentDate, view]);

  if (view === "month") {
    return (
      <MonthView
        days={days}
        currentDate={currentDate}
        artists={artists}
        artistColorMap={artistColorMap}
        availabilities={availabilities}
        weeklySchedules={weeklySchedules}
        locations={locations}
        artistFilter={artistFilter}
        canEditArtist={canEditArtist}
        onAddAvailability={onAddAvailability}
        onEditAvailability={onEditAvailability}
      />
    );
  }

  if (view === "week") {
    return (
      <WeekView
        days={days}
        artists={artists}
        artistColorMap={artistColorMap}
        availabilities={availabilities}
        weeklySchedules={weeklySchedules}
        locations={locations}
        artistFilter={artistFilter}
        canEditArtist={canEditArtist}
        onAddAvailability={onAddAvailability}
        onEditAvailability={onEditAvailability}
      />
    );
  }

  // day (desktop or mobile)
  return (
    <DayView
      day={days[0]}
      isMobile={isMobile}
      artists={artists}
      artistColorMap={artistColorMap}
      availabilities={availabilities}
      weeklySchedules={weeklySchedules}
      locations={locations}
      artistFilter={artistFilter}
      canEditArtist={canEditArtist}
      onAddAvailability={onAddAvailability}
      onEditAvailability={onEditAvailability}
    />
  );
}
