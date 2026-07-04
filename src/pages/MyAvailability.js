import React, { useState, useEffect, useMemo, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Calendar, Clock, ChevronLeft, ChevronRight, Save, Trash2 } from "lucide-react";
import AvailabilityDialog from "../components/availability/AvailabilityDialog";
import AvailabilityCalendar from "../components/availability/AvailabilityCalendar";
import TimePicker12h from "../components/calendar/TimePicker12h";
import { normalizeUserRole } from "@/utils/roles";
import { formatTimeRange12h } from "@/utils/index";
import { sortByFullNameThenId, sortByNameThenId } from "@/utils/listSort";
import { getArtistColor } from "@/utils/artistColors";
import { navigateNext, navigatePrev, getViewTitle } from "@/utils/calendarViews";
import { useIsMobile } from "@/hooks/use-mobile";

const ROLES_WITH_MY_AVAILABILITY = ["Artist", "Owner", "Admin", "Front_Desk"];

export default function MyAvailability() {
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState(() => (isMobile ? "day" : "month"));
  const [showDialog, setShowDialog] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedAvailability, setSelectedAvailability] = useState(null);
  const [artistFilter, setArtistFilter] = useState("all");
  const queryClient = useQueryClient();

  // Force off month view on mobile
  useEffect(() => {
    if (isMobile && view === "month") setView("day");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const normalizedRole = user
    ? normalizeUserRole(user.user_role || (user.role === "admin" ? "Admin" : "Front_Desk"))
    : null;
  const isAdmin = normalizedRole === "Admin" || normalizedRole === "Owner";

  const { data: artists = [] } = useQuery({
    queryKey: ["artists", user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Artist.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Location.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id,
  });

  const sortedArtists = useMemo(() => sortByFullNameThenId(artists), [artists]);
  const sortedLocations = useMemo(() => sortByNameThenId(locations), [locations]);
  const activeArtists = useMemo(() => sortedArtists.filter((a) => a.is_active), [sortedArtists]);

  const currentArtist = useMemo(
    () => (user ? sortedArtists.find((a) => a.user_id === user.id) : null),
    [user, sortedArtists]
  );

  // Load all studio availabilities (no per-artist filter)
  const { data: availabilities = [] } = useQuery({
    queryKey: ["availabilities", user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Availability.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id,
  });

  // Load all studio weekly schedules (no per-artist filter)
  const { data: weeklySchedules = [] } = useQuery({
    queryKey: ["weeklySchedules", user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.ArtistWeeklySchedule.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id,
  });

  // ── Weekly schedule CRUD (single-artist mode) ──
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({ day_of_week: 1, start_time: "10:00", end_time: "18:00", location_id: "" });
  const [showScheduleForm, setShowScheduleForm] = useState(false);

  const selectedSingleArtistId = artistFilter !== "all" ? artistFilter : null;

  const createScheduleMutation = useMutation({
    mutationFn: (data) => base44.entities.ArtistWeeklySchedule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weeklySchedules"] });
      setShowScheduleForm(false);
      setEditingSchedule(null);
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ArtistWeeklySchedule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weeklySchedules"] });
      setShowScheduleForm(false);
      setEditingSchedule(null);
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id) => base44.entities.ArtistWeeklySchedule.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["weeklySchedules"] }),
  });

  const handleSaveSchedule = () => {
    const payload = {
      studio_id: user.studio_id,
      artist_id: selectedSingleArtistId,
      day_of_week: scheduleForm.day_of_week,
      start_time: scheduleForm.start_time,
      end_time: scheduleForm.end_time,
      location_id: scheduleForm.location_id || null,
      is_active: true,
    };
    if (editingSchedule) {
      updateScheduleMutation.mutate({ id: editingSchedule.id, data: payload });
    } else {
      createScheduleMutation.mutate(payload);
    }
  };

  const handleEditSchedule = (sched) => {
    setEditingSchedule(sched);
    setScheduleForm({
      day_of_week: sched.day_of_week,
      start_time: sched.start_time,
      end_time: sched.end_time,
      location_id: sched.location_id || "",
    });
    setShowScheduleForm(true);
  };

  const handleNewSchedule = () => {
    setEditingSchedule(null);
    setScheduleForm({ day_of_week: 1, start_time: "10:00", end_time: "18:00", location_id: "" });
    setShowScheduleForm(true);
  };

  // ── Permissions ──
  const canEditArtist = useCallback(
    (artistId) => {
      if (!user) return false;
      if (isAdmin) return true;
      const artist = sortedArtists.find((a) => a.id === artistId);
      return artist && artist.user_id === user.id;
    },
    [user, isAdmin, sortedArtists]
  );

  // ── Artist color map ──
  const artistColorMap = useMemo(() => {
    const map = {};
    activeArtists.forEach((a, i) => {
      map[a.id] = getArtistColor(a, i);
    });
    return map;
  }, [activeArtists]);

  // ── Calendar callbacks ──
  const handleAddAvailability = (date) => {
    setSelectedDate(date);
    setSelectedAvailability(null);
    setShowDialog(true);
  };

  const handleEditAvailability = (availability) => {
    setSelectedAvailability(availability);
    setSelectedDate(null);
    setShowDialog(true);
  };

  const handlePrev = () => setCurrentDate(navigatePrev(currentDate, view));
  const handleNext = () => setCurrentDate(navigateNext(currentDate, view));
  const handleToday = () => setCurrentDate(new Date());

  // ── Filtered weekly schedules for the weekly-schedule card ──
  const activeSchedules = useMemo(() => {
    if (!selectedSingleArtistId) return [];
    return weeklySchedules
      .filter((s) => s.is_active && s.artist_id === selectedSingleArtistId)
      .sort((a, b) => a.day_of_week - b.day_of_week);
  }, [weeklySchedules, selectedSingleArtistId]);

  const canEditSelectedArtist = selectedSingleArtistId && canEditArtist(selectedSingleArtistId);

  // ── Dialog artist context: when "All Artists", admin picks from dialog; else preset ──
  const dialogArtistId = selectedAvailability
    ? selectedAvailability.artist_id
    : selectedSingleArtistId || (currentArtist?.id || null);

  // ── Loading / access gates ──
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-gray-900 mb-2">Loading...</h2>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!ROLES_WITH_MY_AVAILABILITY.includes(normalizedRole)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">
                Your role cannot open this page. Current role: {user.user_role || "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // No artist profile gate removed — users can still see the team calendar
  const hasProfile = !!currentArtist;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
        {/* ── Header ── */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Availability</h1>
            <p className="text-gray-500 mt-1 text-sm">
              {hasProfile
                ? "View team availability and manage your schedule"
                : "View team availability"}
            </p>
          </div>
        </div>

        {/* ── Toolbar ── */}
        <Card className="bg-white border-none shadow-md">
          <CardContent className="p-3 sm:p-4">
            <div className="rounded-xl bg-gray-50/80 p-3 sm:p-4 space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <Select value={view} onValueChange={setView}>
                  <SelectTrigger className="text-sm w-32 shrink-0">
                    <SelectValue placeholder="View" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Day View</SelectItem>
                    <SelectItem value="week">Week View</SelectItem>
                    {!isMobile && <SelectItem value="month">Month View</SelectItem>}
                  </SelectContent>
                </Select>

                <div className="flex gap-1 flex-1 sm:flex-none">
                  <Button variant="outline" onClick={handlePrev} className="px-3">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" onClick={handleToday} className="px-3 text-sm">
                    Today
                  </Button>
                  <Button variant="outline" onClick={handleNext} className="px-3">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>

                <div className="text-sm font-semibold text-gray-700 hidden sm:block">
                  {getViewTitle(currentDate, view)}
                </div>

                <div className="ml-auto">
                  <Select
                    value={artistFilter}
                    onValueChange={(v) => {
                      setArtistFilter(v);
                      setShowScheduleForm(false);
                      setEditingSchedule(null);
                    }}
                  >
                    <SelectTrigger className="text-sm w-44">
                      <SelectValue placeholder="All Artists" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Artists</SelectItem>
                      {activeArtists.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: artistColorMap[a.id] }}
                            />
                            {a.full_name}
                            {a.user_id === user.id ? " (You)" : ""}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Mobile view title */}
              <div className="text-sm font-semibold text-gray-700 sm:hidden text-center">
                {getViewTitle(currentDate, view)}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Weekly Schedule (single artist + editable) ── */}
        {selectedSingleArtistId && canEditSelectedArtist && (
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-4 sm:p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-gray-900">Weekly Schedule</h2>
                <Button size="sm" onClick={handleNewSchedule} className="bg-indigo-600 hover:bg-indigo-700">
                  <Plus className="w-4 h-4 mr-1" /> Add Day
                </Button>
              </div>

              {activeSchedules.length === 0 && !showScheduleForm && (
                <p className="text-sm text-gray-500 text-center py-4">
                  No recurring weekly schedule set. Add regular working days.
                </p>
              )}

              {activeSchedules.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
                  {activeSchedules.map((sched) => {
                    const loc = sortedLocations.find((l) => l.id === sched.location_id);
                    return (
                      <div
                        key={sched.id}
                        className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm group"
                      >
                        <div>
                          <span className="font-semibold text-green-900">{DAY_NAMES[sched.day_of_week]}</span>
                          <span className="text-green-700 ml-2">{formatTimeRange12h(sched.start_time, sched.end_time)}</span>
                          {loc && <span className="text-green-600 ml-1 text-xs">({loc.name})</span>}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => handleEditSchedule(sched)} className="text-gray-500 hover:text-indigo-600">
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deleteScheduleMutation.mutate(sched.id)} className="text-gray-500 hover:text-red-600">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {showScheduleForm && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Day</Label>
                      <Select
                        value={String(scheduleForm.day_of_week)}
                        onValueChange={(v) => setScheduleForm({ ...scheduleForm, day_of_week: parseInt(v) })}
                      >
                        <SelectTrigger className="text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DAY_NAMES.map((name, idx) => (
                            <SelectItem key={idx} value={String(idx)}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Start</Label>
                      <TimePicker12h
                        value={scheduleForm.start_time}
                        onChange={(newStart) => setScheduleForm({ ...scheduleForm, start_time: newStart })}
                        compact
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">End</Label>
                      <TimePicker12h
                        value={scheduleForm.end_time}
                        onChange={(newEnd) => setScheduleForm({ ...scheduleForm, end_time: newEnd })}
                        compact
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Location</Label>
                      <Select
                        value={scheduleForm.location_id || "__all__"}
                        onValueChange={(v) =>
                          setScheduleForm({ ...scheduleForm, location_id: v === "__all__" ? "" : v })
                        }
                      >
                        <SelectTrigger className="text-sm">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All Locations</SelectItem>
                          {sortedLocations.map((loc) => (
                            <SelectItem key={loc.id} value={loc.id}>
                              {loc.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowScheduleForm(false);
                        setEditingSchedule(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="bg-indigo-600 hover:bg-indigo-700"
                      onClick={handleSaveSchedule}
                      disabled={createScheduleMutation.isPending || updateScheduleMutation.isPending}
                    >
                      {editingSchedule ? "Update" : "Save"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Calendar ── */}
        <Card className="bg-white border-none shadow-lg">
          <CardContent className="p-3 sm:p-6">
            <AvailabilityCalendar
              view={view}
              currentDate={currentDate}
              isMobile={isMobile}
              artists={activeArtists}
              availabilities={availabilities}
              weeklySchedules={weeklySchedules}
              locations={sortedLocations}
              artistFilter={artistFilter}
              artistColorMap={artistColorMap}
              canEditArtist={canEditArtist}
              onAddAvailability={handleAddAvailability}
              onEditAvailability={handleEditAvailability}
            />
          </CardContent>
        </Card>

        {/* ── Help Card ── */}
        <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-none shadow-md">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Clock className="w-6 h-6 text-indigo-600 mt-1" />
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">How Availability Works</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  <li>• Use the <strong>artist filter</strong> to view a specific person or the whole team</li>
                  <li>• Select an artist to manage their <strong>Weekly Schedule</strong> (recurring working days)</li>
                  <li>• Use the calendar to add one-off availability or block time off</li>
                  <li>• Toggle <strong>All Day</strong> to book entire days off without choosing times</li>
                  <li>• Set date ranges for multi-day periods (like vacations)</li>
                  <li>• Switch between <strong>Day</strong>, <strong>Week</strong>, and <strong>Month</strong> views</li>
                  <li>• Appointments can only be booked during scheduled or available times</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Availability Dialog ── */}
      {user && (
        <AvailabilityDialog
          open={showDialog}
          onOpenChange={setShowDialog}
          date={selectedDate}
          availability={selectedAvailability}
          artistId={dialogArtistId}
          artists={activeArtists}
          locations={sortedLocations}
          currentUser={user}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}
