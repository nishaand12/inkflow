import React, { useState, useEffect, useMemo, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Calendar, Clock, MapPin, User, SlidersHorizontal, ChevronDown, ChevronUp, History } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import AppointmentDialog from "../components/calendar/AppointmentDialog";
import { normalizeUserRole } from "@/utils/roles";
import {
  CATEGORY_ROLE_APPOINTMENT_KIND,
  filterCategoriesByRole,
  appointmentTypeMatchesFilter,
} from "@/utils/reportingCategories";

const statusColors = {
  scheduled:     "bg-blue-100 text-blue-800 border-blue-200",
  confirmed:     "bg-green-100 text-green-800 border-green-200",
  deposit_paid:  "bg-purple-100 text-purple-800 border-purple-200",
  completed:     "bg-gray-100 text-gray-800 border-gray-200",
  cancelled:     "bg-red-100 text-red-800 border-red-200",
  no_show:       "bg-orange-100 text-orange-800 border-orange-200",
};

export default function Appointments() {
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [artistFilter, setArtistFilter] = useState('all');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [locationFilter, setLocationFilter] = useState('all');
  const [workStationFilter, setWorkStationFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [specificTypeFilter, setSpecificTypeFilter] = useState('all');
  const [showDialog, setShowDialog] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [user, setUser] = useState(null);
  const [userArtist, setUserArtist] = useState(null);

  const advancedActiveCount = [locationFilter, workStationFilter, searchTerm, specificTypeFilter]
    .filter(v => v && v !== 'all' && v !== '').length;

  useEffect(() => {
    loadUser();
  }, []);

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
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Appointment.filter({ studio_id: user.studio_id }, '-appointment_date');
    },
    enabled: !!user?.studio_id
  });

  const { data: artists = [] } = useQuery({
    queryKey: ['artists', user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Artist.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Location.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Customer.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  const { data: appointmentTypes = [] } = useQuery({
    queryKey: ['appointmentTypes', user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.AppointmentType.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  const { data: reportingCategories = [] } = useQuery({
    queryKey: ['reportingCategories', user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.ReportingCategory.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  const typeCategoryFilterOptions = useMemo(() => {
    const opts = [{ value: "all", label: "All Types" }];
    const roots = filterCategoriesByRole(reportingCategories, CATEGORY_ROLE_APPOINTMENT_KIND)
      .filter((c) => !c.parent_id)
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || (a.name || '').localeCompare(b.name || ''));
    for (const r of roots) {
      opts.push({ value: `kind:${r.id}`, label: r.name || 'Kind' });
    }
    return opts;
  }, [reportingCategories]);

  const { data: workStations = [] } = useQuery({
    queryKey: ['workStations', user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.WorkStation.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  useEffect(() => {
    if (user && artists.length > 0) {
      const artist = artists.find(a => a.user_id === user.id);
      setUserArtist(artist);
    }
  }, [user, artists]);

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === 'admin' ? 'Admin' : 'Front_Desk'));
  };

  const userRole = getUserRole();
  const isArtist = userRole === 'Artist';
  const isAdmin = userRole === 'Admin' || userRole === 'Owner';

  const getCustomerName = useCallback((appointment) => {
    if (appointment.customer_id) {
      const customer = customers.find(c => c.id === appointment.customer_id);
      return customer?.name || appointment.client_name || 'Unknown';
    }
    return appointment.client_name || 'Unknown';
  }, [customers]);

  const getCustomerEmail = useCallback((appointment) => {
    if (appointment.customer_id) {
      const customer = customers.find(c => c.id === appointment.customer_id);
      return customer?.email || appointment.client_email || '';
    }
    return appointment.client_email || appointment.client_phone || '';
  }, [customers]);

  const filteredAppointments = useMemo(() => appointments.filter(apt => {
    if (isArtist && !isAdmin) {
      if (!userArtist) return false;
      if (apt.artist_id !== userArtist.id) return false;
    }

    const aptType = appointmentTypes.find(t => t.id === apt.appointment_type_id);

    if (typeFilter !== 'all') {
      if (!appointmentTypeMatchesFilter(reportingCategories, aptType, typeFilter)) return false;
    }
    if (statusFilter !== 'all' && apt.status !== statusFilter) return false;
    if (artistFilter !== 'all' && apt.artist_id !== artistFilter) return false;

    // Advanced filters
    if (locationFilter !== 'all' && apt.location_id !== locationFilter) return false;
    if (workStationFilter !== 'all' && apt.work_station_id !== workStationFilter) return false;
    if (specificTypeFilter !== 'all' && apt.appointment_type_id !== specificTypeFilter) return false;
    if (searchTerm) {
      const name = getCustomerName(apt).toLowerCase();
      const email = getCustomerEmail(apt).toLowerCase();
      const q = searchTerm.toLowerCase();
      if (!name.includes(q) && !email.includes(q)) return false;
    }

    return true;
  }), [
    appointments,
    isArtist,
    isAdmin,
    userArtist,
    appointmentTypes,
    typeFilter,
    reportingCategories,
    statusFilter,
    artistFilter,
    locationFilter,
    workStationFilter,
    specificTypeFilter,
    searchTerm,
    getCustomerName,
    getCustomerEmail,
  ]);

  const handleEdit = (appointment) => {
    setSelectedAppointment(appointment);
    setShowDialog(true);
  };

  const handleNew = () => {
    setSelectedAppointment(null);
    setShowDialog(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {(isArtist && !isAdmin) ? 'My Appointments' : 'Appointments'}
            </h1>
            <p className="text-gray-500 mt-1">
              {(isArtist && !isAdmin) ? 'View and manage your bookings' : 'Manage all your bookings'}
            </p>
          </div>
          <Button 
            onClick={handleNew}
            className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Appointment
          </Button>
        </div>

        <Card className="bg-white border-none shadow-md">
          <CardContent className="p-4 sm:p-6">
            <div className="rounded-xl bg-gray-50/80 p-3 sm:p-4 space-y-3">
              {/* Standard filters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="All Types" /></SelectTrigger>
                  <SelectContent>
                    {typeCategoryFilterOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
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

                {!isArtist && (
                  <Select value={artistFilter} onValueChange={setArtistFilter}>
                    <SelectTrigger className="text-sm"><SelectValue placeholder="All Artists" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Artists</SelectItem>
                      {artists.filter(a => a.is_active).map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>
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

              {/* Advanced filters */}
              {showAdvanced && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 pt-2 border-t border-gray-200">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      placeholder="Search by client..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 text-sm"
                    />
                  </div>

                  <Select value={locationFilter} onValueChange={setLocationFilter}>
                    <SelectTrigger className="text-sm"><SelectValue placeholder="All Locations" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Locations</SelectItem>
                      {locations.map(l => (
                        <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
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

        {(() => {
          const today = format(new Date(), 'yyyy-MM-dd');
          const upcoming = filteredAppointments
            .filter(apt => apt.appointment_date >= today)
            .sort((a, b) => a.appointment_date !== b.appointment_date
              ? a.appointment_date.localeCompare(b.appointment_date)
              : (a.start_time || '').localeCompare(b.start_time || ''));
          const past = filteredAppointments
            .filter(apt => apt.appointment_date < today)
            .sort((a, b) => b.appointment_date.localeCompare(a.appointment_date));

          const renderRow = (appointment) => {
            const artist = artists.find(a => a.id === appointment.artist_id);
            const location = locations.find(l => l.id === appointment.location_id);
            const customerName = getCustomerName(appointment);
            const customerEmail = getCustomerEmail(appointment);
            return (
              <div
                key={appointment.id}
                onClick={() => handleEdit(appointment)}
                className="p-4 rounded-xl border-2 border-gray-100 hover:border-indigo-200 hover:shadow-md transition-all duration-200 cursor-pointer"
              >
                <div className="flex flex-col lg:flex-row justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">
                        {customerName?.charAt(0) || 'C'}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{customerName}</h3>
                        <p className="text-sm text-gray-500">{customerEmail}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                      <div className="flex items-center gap-2 text-gray-600">
                        <Calendar className="w-4 h-4" />
                        {format(parseISO(appointment.appointment_date + 'T00:00:00'), 'MMM d, yyyy')}
                      </div>
                      <div className="flex items-center gap-2 text-gray-600">
                        <Clock className="w-4 h-4" />
                        {appointment.start_time}{appointment.end_time ? `–${appointment.end_time}` : ''}
                      </div>
                      <div className="flex items-center gap-2 text-gray-600">
                        <User className="w-4 h-4" />
                        {artist?.full_name}
                      </div>
                      <div className="flex items-center gap-2 text-gray-600">
                        <MapPin className="w-4 h-4" />
                        {location?.name}
                      </div>
                    </div>
                    {appointment.design_description && (
                      <p className="text-sm text-gray-500 line-clamp-2">{appointment.design_description}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end justify-between">
                    <Badge className={`${statusColors[appointment.status] || 'bg-gray-100 text-gray-800 border-gray-200'} border`}>
                      {appointment.status?.replace('_', ' ')}
                    </Badge>
                    {appointment.total_estimate > 0 && (
                      <div className="text-right mt-2">
                        <div className="text-lg font-bold text-gray-900">${appointment.total_estimate}</div>
                        {appointment.deposit_amount > 0 && (
                          <div className="text-xs text-gray-500">Deposit: ${appointment.deposit_amount}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          };

          return (
            <>
              <Card className="bg-white border-none shadow-lg">
                <CardHeader>
                  <CardTitle>
                    {(isArtist && !isAdmin) ? 'My Upcoming Appointments' : 'Upcoming Appointments'} ({upcoming.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {upcoming.length === 0 ? (
                    <div className="text-center py-12">
                      <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500">No upcoming appointments found</p>
                    </div>
                  ) : (
                    <div className="space-y-3">{upcoming.map(renderRow)}</div>
                  )}
                </CardContent>
              </Card>

              {past.length > 0 && (
                <Card className="bg-white border-none shadow-lg">
                  <CardContent className="pt-4">
                    <Accordion type="single" collapsible>
                      <AccordionItem value="past" className="border-none">
                        <AccordionTrigger className="hover:no-underline px-2 py-2 text-gray-600">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            <History className="w-4 h-4" />
                            Past Appointments ({past.length})
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pt-2">{past.map(renderRow)}</div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </CardContent>
                </Card>
              )}
            </>
          );
        })()}
      </div>

      <AppointmentDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        appointment={selectedAppointment}
        artists={artists}
        locations={locations}
        currentUser={user}
        userArtist={userArtist}
      />
    </div>
  );
}