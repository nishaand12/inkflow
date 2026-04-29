import React, { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Plus, SlidersHorizontal, ChevronDown, ChevronUp, Search } from "lucide-react";
import {
  format,
  startOfMonth, endOfMonth, eachDayOfInterval,
  isSameMonth, isSameDay,
  addMonths, subMonths, startOfWeek, endOfWeek, addDays, parseISO
} from "date-fns";
import AppointmentDialog from "../components/calendar/AppointmentDialog";
import AppointmentCard from "../components/calendar/AppointmentCard";
import { normalizeUserRole } from "@/utils/roles";
import { useIsMobile } from "@/hooks/use-mobile";
import { ARTIST_PALETTE, hexToRgba } from "@/utils/artistColors";
import { PIERCING_CATEGORIES } from "@/utils/index";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// ─── Time grid constants ───────────────────────────────────────────────────
const HOUR_HEIGHT = 64;   // px per hour
const START_HOUR  = 9;    // 9 AM
const END_HOUR    = 21;   // 9 PM (last block is 8–9 PM)
const GRID_HOURS  = END_HOUR - START_HOUR;
const TOTAL_HEIGHT = GRID_HOURS * HOUR_HEIGHT;

const HOURS_LIST = Array.from({ length: GRID_HOURS }, (_, i) => START_HOUR + i);

function formatHourLabel(h) {
  if (h === 0 || h === 24) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

// ─── Time helpers ──────────────────────────────────────────────────────────
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3]?.toUpperCase();
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function topFromTime(timeStr) {
  const mins = parseTimeToMinutes(timeStr);
  return Math.max(0, (mins - START_HOUR * 60) / 60 * HOUR_HEIGHT);
}

// ─── Overlap layout ────────────────────────────────────────────────────────
function layoutDayAppointments(apts) {
  const sorted = [...apts].sort(
    (a, b) => parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time)
  );

  const colEnds = [];   // end-time (minutes) of last apt in each column
  const layout  = [];   // { apt, col }

  for (const apt of sorted) {
    const start = parseTimeToMinutes(apt.start_time);
    const end   = apt.end_time ? parseTimeToMinutes(apt.end_time) : start + 60;
    let col = 0;
    while (col < colEnds.length && colEnds[col] > start) col++;
    if (col >= colEnds.length) colEnds.push(end); else colEnds[col] = end;
    layout.push({ apt, col });
  }

  return layout.map(({ apt, col }) => {
    const start = parseTimeToMinutes(apt.start_time);
    const end   = apt.end_time ? parseTimeToMinutes(apt.end_time) : start + 60;
    let maxCol  = col;
    for (const { apt: other, col: oc } of layout) {
      const os = parseTimeToMinutes(other.start_time);
      const oe = other.end_time ? parseTimeToMinutes(other.end_time) : os + 60;
      if (start < oe && end > os) maxCol = Math.max(maxCol, oc);
    }
    return { apt, col, totalCols: maxCol + 1 };
  });
}

// ─── Component ────────────────────────────────────────────────────────────
export default function Calendar() {
  const isMobile = useIsMobile();
  const scrollRef = useRef(null);
  const [currentDate, setCurrentDate]             = useState(new Date());
  const [view, setView]                           = useState('day');
  // Standard filters
  const [selectedTypeCategory, setSelectedTypeCategory] = useState('all');
  const [statusFilter, setStatusFilter]           = useState('all');
  const [selectedArtist, setSelectedArtist]       = useState('all');
  // Advanced filters
  const [showAdvanced, setShowAdvanced]           = useState(false);
  const [customerSearch, setCustomerSearch]       = useState('');
  const [selectedLocation, setSelectedLocation]   = useState('all');
  const [workStationFilter, setWorkStationFilter] = useState('all');
  const [specificTypeFilter, setSpecificTypeFilter] = useState('all');

  const [showAppointmentDialog, setShowAppointmentDialog] = useState(false);
  const [selectedAppointment, setSelectedAppointment]     = useState(null);
  const [selectedDate, setSelectedDate]           = useState(null);
  const [user, setUser]                           = useState(null);
  const [userArtist, setUserArtist]               = useState(null);

  const advancedActiveCount = [selectedLocation, workStationFilter, specificTypeFilter]
    .filter(v => v && v !== 'all').length + (customerSearch ? 1 : 0);

  // On mobile, force off month view
  useEffect(() => {
    if (isMobile && view === 'month') setView('day');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // Scroll time grid to 9 AM (start of grid) on mount / view change
  useEffect(() => {
    if (scrollRef.current && !isMobile && view !== 'month') {
      scrollRef.current.scrollTop = 0;
    }
  }, [view, isMobile]);

  useEffect(() => { loadUser(); }, []);

  const loadUser = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
    } catch (error) {
      console.error("Error loading user:", error);
    }
  };

  const { data: appointments = [] } = useQuery({
    queryKey: ['appointments', user?.studio_id],
    queryFn: () => base44.entities.Appointment.filter({ studio_id: user.studio_id }, '-created_date'),
    enabled: !!user?.studio_id
  });

  const { data: artists = [] } = useQuery({
    queryKey: ['artists', user?.studio_id],
    queryFn: () => base44.entities.Artist.filter({ studio_id: user.studio_id }),
    enabled: !!user?.studio_id
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', user?.studio_id],
    queryFn: () => base44.entities.Location.filter({ studio_id: user.studio_id }),
    enabled: !!user?.studio_id
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', user?.studio_id],
    queryFn: () => base44.entities.Customer.filter({ studio_id: user.studio_id }),
    enabled: !!user?.studio_id
  });

  const { data: appointmentTypes = [] } = useQuery({
    queryKey: ['appointmentTypes', user?.studio_id],
    queryFn: () => base44.entities.AppointmentType.filter({ studio_id: user.studio_id }),
    enabled: !!user?.studio_id
  });

  const { data: workStations = [] } = useQuery({
    queryKey: ['workStations', user?.studio_id],
    queryFn: () => base44.entities.WorkStation.filter({ studio_id: user.studio_id }),
    enabled: !!user?.studio_id
  });

  useEffect(() => {
    if (user && artists.length > 0) {
      setUserArtist(artists.find(a => a.user_id === user.id));
    }
  }, [user, artists]);

  // ── Artist color map (id → hex, with palette fallback) ─────────────────
  const artistColorMap = useMemo(() => {
    const map = {};
    artists.forEach((a, idx) => {
      map[a.id] = a.calendar_color || ARTIST_PALETTE[idx % ARTIST_PALETTE.length];
    });
    return map;
  }, [artists]);

  const getAptColor  = (apt) => artistColorMap[apt.artist_id] || '#4f46e5';
  const getAptTypeName = (apt) => appointmentTypes.find(t => t.id === apt.appointment_type_id)?.name || '';

  // ── Role helpers ────────────────────────────────────────────────────────
  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === 'admin' ? 'Admin' : 'Front_Desk'));
  };
  const userRole = getUserRole();
  const isArtist = userRole === 'Artist';
  const isAdmin  = userRole === 'Admin' || userRole === 'Owner';

  // ── Filtering ───────────────────────────────────────────────────────────
  const filteredAppointments = appointments.filter(apt => {
    if (isArtist && !isAdmin) {
      if (!userArtist || apt.artist_id !== userArtist.id) return false;
    }

    const aptType = appointmentTypes.find(t => t.id === apt.appointment_type_id);

    if (selectedTypeCategory !== 'all') {
      if (selectedTypeCategory === 'Tattoo' && aptType?.category !== 'Tattoo') return false;
      if (selectedTypeCategory === 'Piercing' && !PIERCING_CATEGORIES.has(aptType?.category)) return false;
      if (selectedTypeCategory === 'Other' && (aptType?.category === 'Tattoo' || PIERCING_CATEGORIES.has(aptType?.category))) return false;
    }
    if (statusFilter !== 'all' && apt.status !== statusFilter) return false;
    if ((isAdmin || userRole === 'Front_Desk') && selectedArtist !== 'all' && apt.artist_id !== selectedArtist) return false;

    // Advanced filters
    if (selectedLocation !== 'all' && apt.location_id !== selectedLocation) return false;
    if (workStationFilter !== 'all' && apt.work_station_id !== workStationFilter) return false;
    if (specificTypeFilter !== 'all' && apt.appointment_type_id !== specificTypeFilter) return false;
    if (customerSearch) {
      const name = getCustomerName(apt).toLowerCase();
      if (!name.includes(customerSearch.toLowerCase())) return false;
    }

    return true;
  });

  // ── Day ranges ──────────────────────────────────────────────────────────
  const getDaysToShow = () => {
    if (view === 'month') {
      return eachDayOfInterval({ start: startOfWeek(startOfMonth(currentDate)), end: endOfWeek(endOfMonth(currentDate)) });
    } else if (view === 'week') {
      return eachDayOfInterval({ start: startOfWeek(currentDate), end: endOfWeek(currentDate) });
    } else if (view === '3day') {
      return eachDayOfInterval({ start: currentDate, end: addDays(currentDate, 2) });
    } else if (view === '4day') {
      return eachDayOfInterval({ start: currentDate, end: addDays(currentDate, 3) });
    } else {
      return [currentDate];
    }
  };

  const getAppointmentsForDay = (day) =>
    filteredAppointments.filter(apt => isSameDay(parseISO(apt.appointment_date + 'T00:00:00'), day))
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const getCustomerName = (apt) => {
    if (apt.customer_id) {
      const c = customers.find(c => c.id === apt.customer_id);
      return c?.name || apt.client_name || 'Unknown';
    }
    return apt.client_name || 'Unknown';
  };

  const isOwnAppointment = (apt) => !userArtist || apt.artist_id === userArtist.id;

  // ── Navigation ──────────────────────────────────────────────────────────
  const handlePrevious = () => {
    const delta = view === 'month' ? null : view === 'week' ? -7 : view === '3day' ? -3 : view === '4day' ? -4 : -1;
    if (delta === null) setCurrentDate(subMonths(currentDate, 1));
    else setCurrentDate(addDays(currentDate, delta));
  };
  const handleNext = () => {
    const delta = view === 'month' ? null : view === 'week' ? 7 : view === '3day' ? 3 : view === '4day' ? 4 : 1;
    if (delta === null) setCurrentDate(addMonths(currentDate, 1));
    else setCurrentDate(addDays(currentDate, delta));
  };
  const handleToday = () => setCurrentDate(new Date());

  const handleNewAppointment = (date = null) => {
    setSelectedAppointment(null);
    setSelectedDate(date);
    setShowAppointmentDialog(true);
  };
  const handleEditAppointment = (apt) => {
    setSelectedAppointment(apt);
    setSelectedDate(null);
    setShowAppointmentDialog(true);
  };

  const days = getDaysToShow();

  // ── Current time offset ─────────────────────────────────────────────────
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = ((nowMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
  const showNowLine = nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60;

  // ── Date header label ───────────────────────────────────────────────────
  const headerLabel =
    view === '3day' ? `${format(currentDate, 'MMM d')} – ${format(addDays(currentDate, 2), 'MMM d, yyyy')}` :
    view === '4day' ? `${format(currentDate, 'MMM d')} – ${format(addDays(currentDate, 3), 'MMM d, yyyy')}` :
    format(currentDate, 'MMMM yyyy');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">

        {/* ── Page header ── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              {(isArtist && !isAdmin) ? 'My Schedule' : 'Calendar'}
            </h1>
            <p className="text-sm sm:text-base text-gray-500 mt-1">
              {(isArtist && !isAdmin) ? 'View your appointments' : 'Manage your studio appointments'}
            </p>
          </div>
          <Button
            onClick={() => handleNewAppointment()}
            className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 w-full sm:w-auto"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Appointment
          </Button>
        </div>

        {/* ── Filter bar ── */}
        <Card className="bg-white border-none shadow-md">
          <CardContent className="p-3 sm:p-4">
            <div className="rounded-xl bg-gray-50/80 p-3 sm:p-4 space-y-3">
              {/* Calendar controls row */}
              <div className="flex gap-2 items-center">
                <Select value={view} onValueChange={setView}>
                  <SelectTrigger className="text-sm w-36 shrink-0">
                    <SelectValue placeholder="View" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Day View</SelectItem>
                    <SelectItem value="3day">3-Day View</SelectItem>
                    <SelectItem value="4day">4-Day View</SelectItem>
                    <SelectItem value="week">Week View</SelectItem>
                    {!isMobile && <SelectItem value="month">Month View</SelectItem>}
                  </SelectContent>
                </Select>
                <div className="flex gap-1 flex-1 sm:flex-none">
                  <Button variant="outline" onClick={handlePrevious} className="flex-1 sm:flex-none px-3">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" onClick={handleToday} className="flex-1 sm:flex-none px-3 text-sm">
                    Today
                  </Button>
                  <Button variant="outline" onClick={handleNext} className="flex-1 sm:flex-none px-3">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Standard filters row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Select value={selectedTypeCategory} onValueChange={setSelectedTypeCategory}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="All Types" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="Tattoo">Tattoo</SelectItem>
                    <SelectItem value="Piercing">Piercing</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="deposit_paid">Deposit Paid</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="no_show">No Show</SelectItem>
                  </SelectContent>
                </Select>

                {(isAdmin || userRole === 'Front_Desk') && (
                  <Select value={selectedArtist} onValueChange={setSelectedArtist}>
                    <SelectTrigger className="text-sm"><SelectValue placeholder="All Artists" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Artists</SelectItem>
                      {artists.filter(a => a.is_active).map(a => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: artistColorMap[a.id] }}
                            />
                            {a.full_name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <Button
                  variant="outline"
                  onClick={() => setShowAdvanced(v => !v)}
                  className={`text-sm flex items-center gap-2 ${advancedActiveCount > 0 ? 'border-indigo-400 text-indigo-700 bg-indigo-50' : ''}`}
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  Advanced
                  {advancedActiveCount > 0 && (
                    <Badge className="bg-indigo-600 text-white text-xs px-1.5 py-0 h-4 min-w-4">{advancedActiveCount}</Badge>
                  )}
                  {showAdvanced ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
                </Button>
              </div>

              {/* Advanced filters row */}
              {showAdvanced && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-2 border-t border-gray-200">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      placeholder="Search by client..."
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      className="pl-9 text-sm"
                    />
                  </div>

                  <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                    <SelectTrigger className="text-sm"><SelectValue placeholder="All Locations" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Locations</SelectItem>
                      {locations.map(loc => (
                        <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={workStationFilter} onValueChange={setWorkStationFilter}>
                    <SelectTrigger className="text-sm"><SelectValue placeholder="All Workstations" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Workstations</SelectItem>
                      {workStations.map(ws => (
                        <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={specificTypeFilter} onValueChange={setSpecificTypeFilter}>
                    <SelectTrigger className="text-sm"><SelectValue placeholder="All Appointment Types" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Appointment Types</SelectItem>
                      {[...appointmentTypes].sort((a, b) => a.name.localeCompare(b.name)).map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Calendar card ── */}
        <Card className="bg-white border-none shadow-lg overflow-hidden">
          <CardContent className="p-3 sm:p-6">

            {/* Date header + legend */}
            <div className="mb-4 sm:mb-6 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{headerLabel}</h2>
              </div>

              {/* Artist color legend (desktop, non-month) */}
              {!isMobile && view !== 'month' && artists.filter(a => a.is_active).length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                  <span className="font-semibold text-gray-700">Artists:</span>
                  {artists.filter(a => a.is_active).map(a => (
                    <span key={a.id} className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: artistColorMap[a.id] }} />
                      {a.full_name}
                    </span>
                  ))}
                </div>
              )}

              {/* Status legend (mobile, or month view) */}
              {(isMobile || view === 'month') && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                  <span className="font-semibold text-gray-700">Legend:</span>
                  {[
                    ['bg-gray-400', 'Scheduled'],
                    ['bg-blue-500', 'Confirmed'],
                    ['bg-green-500', 'Checked Out'],
                    ['bg-red-500', 'Cancelled/No-Show'],
                  ].map(([cls, label]) => (
                    <span key={label} className="flex items-center gap-1">
                      <span className={`h-2 w-2 rounded-full ${cls}`} />
                      <span className="hidden sm:inline">{label}</span>
                      <span className="sm:hidden">{label.split('/')[0]}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ═══════════════════════════════════════════════════════════
                MONTH VIEW (desktop only)
            ═══════════════════════════════════════════════════════════ */}
            {view === 'month' && !isMobile && (
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} className="text-center font-semibold text-gray-600 text-xs sm:text-sm p-1 sm:p-2">{d}</div>
                ))}
                {days.map((day, idx) => {
                  const dayApts  = getAppointmentsForDay(day);
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  const isToday  = isSameDay(day, new Date());
                  return (
                    <div
                      key={idx}
                      className={`min-h-[80px] sm:min-h-[120px] p-1 sm:p-2 rounded-lg border-2 transition-all duration-200 cursor-pointer ${
                        isToday ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100'
                      } ${!isCurrentMonth ? 'bg-gray-50' : 'bg-white hover:bg-gray-50'}`}
                      onClick={() => handleNewAppointment(day)}
                    >
                      <div className={`text-xs sm:text-sm font-medium mb-1 sm:mb-2 ${
                        isToday ? 'text-indigo-600' : isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
                      }`}>
                        {format(day, 'd')}
                      </div>
                      <div className="space-y-0.5">
                        {dayApts.slice(0, 3).map(apt => (
                          <AppointmentCard
                            key={apt.id}
                            appointment={{ ...apt, client_name: getCustomerName(apt) }}
                            artists={artists}
                            locations={locations}
                            onClick={e => { e.stopPropagation(); handleEditAppointment(apt); }}
                            compact
                            isOwnAppointment={isOwnAppointment(apt)}
                            artistColor={getAptColor(apt)}
                            appointmentTypeName={getAptTypeName(apt)}
                          />
                        ))}
                        {dayApts.length > 3 && (
                          <div className="text-xs text-gray-500 text-center">+{dayApts.length - 3} more</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════
                DESKTOP TIME GRID (all non-month views)
            ═══════════════════════════════════════════════════════════ */}
            {!isMobile && view !== 'month' && (
              <div
                ref={scrollRef}
                className="overflow-y-auto rounded-lg border border-gray-100"
                style={{ maxHeight: 'calc(100vh - 340px)', minHeight: 400 }}
              >
                {/* Sticky day headers */}
                <div className="sticky top-0 z-20 flex bg-white border-b border-gray-200 shadow-sm">
                  {/* Gutter spacer */}
                  <div className="w-14 sm:w-16 shrink-0 border-r border-gray-100" />
                  {days.map((day, idx) => {
                    const isToday = isSameDay(day, new Date());
                    return (
                      <div
                        key={idx}
                        className={`flex-1 min-w-0 text-center py-2 px-1 border-l border-gray-100 first:border-l-0 ${
                          isToday ? 'bg-indigo-50' : ''
                        }`}
                      >
                        <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                          {format(day, 'EEE')}
                        </div>
                        <div className={`text-lg font-bold leading-none mt-0.5 ${
                          isToday ? 'text-indigo-600' : 'text-gray-900'
                        }`}>
                          {format(day, 'd')}
                        </div>
                        {isToday && (
                          <div className="text-[10px] text-indigo-500 font-medium mt-0.5">Today</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Grid body */}
                <div className="flex">
                  {/* Time gutter */}
                  <div
                    className="w-14 sm:w-16 shrink-0 relative select-none border-r border-gray-100"
                    style={{ height: TOTAL_HEIGHT }}
                  >
                    {HOURS_LIST.map((hour, i) => (
                      <div
                        key={hour}
                        className="absolute right-2 text-[11px] text-gray-400 font-medium leading-none"
                        style={{ top: i * HOUR_HEIGHT - 7 }}
                      >
                        {formatHourLabel(hour)}
                      </div>
                    ))}
                  </div>

                  {/* Day columns */}
                  {days.map((day, dayIdx) => {
                    const dayApts  = getAppointmentsForDay(day);
                    const laid     = layoutDayAppointments(dayApts);
                    const isToday  = isSameDay(day, new Date());

                    return (
                      <div
                        key={dayIdx}
                        className="flex-1 min-w-0 relative border-l border-gray-100 first:border-l-0"
                        style={{ height: TOTAL_HEIGHT }}
                        onClick={(e) => {
                          // Click on empty area → new appointment on that day
                          if (e.target === e.currentTarget) handleNewAppointment(day);
                        }}
                      >
                        {/* Hour grid lines */}
                        {HOURS_LIST.map((_, i) => (
                          <React.Fragment key={i}>
                            <div
                              className="absolute w-full border-t border-gray-100 pointer-events-none"
                              style={{ top: i * HOUR_HEIGHT }}
                            />
                            <div
                              className="absolute w-full border-t border-gray-50 pointer-events-none"
                              style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                            />
                          </React.Fragment>
                        ))}

                        {/* Current-time indicator */}
                        {isToday && showNowLine && (
                          <div
                            className="absolute w-full z-20 pointer-events-none"
                            style={{ top: nowTop }}
                          >
                            <div className="flex items-center">
                              <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 shrink-0" />
                              <div className="flex-1 border-t-2 border-red-500" />
                            </div>
                          </div>
                        )}

                        {/* Appointment blocks */}
                        {laid.map(({ apt, col, totalCols }) => {
                          const top    = topFromTime(apt.start_time);
                          const durationMins = apt.end_time
                            ? parseTimeToMinutes(apt.end_time) - parseTimeToMinutes(apt.start_time)
                            : 60;
                          const height = Math.max(HOUR_HEIGHT * 0.45, (durationMins / 60) * HOUR_HEIGHT - 2);
                          const widthPct = 100 / totalCols;
                          const leftPct  = (col / totalCols) * 100;
                          const color    = getAptColor(apt);
                          const name     = getCustomerName(apt);
                          const typeName = getAptTypeName(apt);

                          return (
                            <div
                              key={apt.id}
                              onClick={e => { e.stopPropagation(); handleEditAppointment(apt); }}
                              className="absolute rounded-r-md overflow-hidden cursor-pointer transition-opacity hover:opacity-80 group"
                              style={{
                                top: top + 1,
                                height,
                                left:  `calc(${leftPct}% + 1px)`,
                                width: `calc(${widthPct}% - 2px)`,
                                backgroundColor: hexToRgba(color, 0.15),
                                borderLeft: `3px solid ${color}`,
                                zIndex: 10,
                              }}
                            >
                              <div className="p-1 h-full overflow-hidden">
                                <div className="text-[10px] font-bold leading-none" style={{ color }}>
                                  {apt.start_time}
                                </div>
                                {height >= 28 && (
                                  <div className="text-xs font-semibold text-gray-900 truncate mt-0.5 leading-tight">
                                    {name}
                                  </div>
                                )}
                                {height >= 44 && typeName && (
                                  <div className="text-[10px] text-gray-500 truncate leading-tight">
                                    {typeName}
                                  </div>
                                )}
                                {height >= 58 && apt.end_time && (
                                  <div className="text-[10px] text-gray-400 leading-tight">
                                    {apt.start_time}–{apt.end_time}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════
                MOBILE: multi-day compact chip view
            ═══════════════════════════════════════════════════════════ */}
            {isMobile && (view === 'week' || view === '3day' || view === '4day') && (
              <div className={view === 'week' ? 'overflow-x-auto -mx-3 px-3 pb-2' : ''}>
                <div className={`grid gap-2 ${
                  view === '3day' ? 'grid-cols-3' :
                  view === '4day' ? 'grid-cols-4' :
                  'grid-cols-7 min-w-[600px]'
                }`}>
                  {days.map((day, idx) => {
                    const dayApts = getAppointmentsForDay(day);
                    const isToday = isSameDay(day, new Date());
                    return (
                      <div key={idx} className="space-y-1 min-w-0">
                        <div
                          className={`text-center p-1.5 rounded-lg cursor-pointer ${
                            isToday ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                          }`}
                          onClick={() => { setCurrentDate(day); setView('day'); }}
                        >
                          <div className="text-[10px] font-medium truncate">{format(day, 'EEE')}</div>
                          <div className="text-sm font-bold">{format(day, 'd')}</div>
                        </div>
                        <div className="space-y-0.5">
                          {dayApts.map(apt => (
                            <AppointmentCard
                              key={apt.id}
                              appointment={{ ...apt, client_name: getCustomerName(apt) }}
                              artists={artists}
                              locations={locations}
                              onClick={() => handleEditAppointment(apt)}
                              compact
                              isOwnAppointment={isOwnAppointment(apt)}
                              artistColor={getAptColor(apt)}
                              appointmentTypeName={getAptTypeName(apt)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {view === 'week' && (
                  <p className="text-xs text-gray-500 text-center mt-2">Swipe to see more • Tap a day for details</p>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════
                MOBILE: single day detailed list
            ═══════════════════════════════════════════════════════════ */}
            {isMobile && view === 'day' && (
              <div className="space-y-3">
                <div className="text-center p-3 bg-indigo-50 rounded-lg mb-4">
                  <div className="text-xs text-indigo-600 font-medium">{format(currentDate, 'EEEE')}</div>
                  <div className="text-xl font-bold text-gray-900">{format(currentDate, 'MMMM d, yyyy')}</div>
                </div>
                {getAppointmentsForDay(currentDate).length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-500 text-sm">No appointments scheduled</p>
                    <Button onClick={() => handleNewAppointment(currentDate)} variant="outline" className="mt-4">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Appointment
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {getAppointmentsForDay(currentDate).map(apt => (
                      <AppointmentCard
                        key={apt.id}
                        appointment={{ ...apt, client_name: getCustomerName(apt) }}
                        artists={artists}
                        locations={locations}
                        onClick={() => handleEditAppointment(apt)}
                        detailed
                        isMobile
                        artistColor={getAptColor(apt)}
                        appointmentTypeName={getAptTypeName(apt)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

          </CardContent>
        </Card>
      </div>

      <AppointmentDialog
        open={showAppointmentDialog}
        onOpenChange={setShowAppointmentDialog}
        appointment={selectedAppointment}
        defaultDate={selectedDate}
        artists={artists}
        locations={locations}
        currentUser={user}
        userArtist={userArtist}
      />
    </div>
  );
}
