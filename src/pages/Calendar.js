import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, addDays, parseISO } from "date-fns";
import AppointmentDialog from "../components/calendar/AppointmentDialog";
import AppointmentCard from "../components/calendar/AppointmentCard";
import { normalizeUserRole } from "@/utils/roles";
import { useIsMobile } from "@/hooks/use-mobile";

export default function Calendar() {
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState('day');
  const [selectedLocation, setSelectedLocation] = useState('all');
  const [selectedArtist, setSelectedArtist] = useState('all');
  const [showAppointmentDialog, setShowAppointmentDialog] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [user, setUser] = useState(null);
  const [userArtist, setUserArtist] = useState(null);

  // On mobile, default to day view and switch if user selects week/month on desktop then goes mobile
  useEffect(() => {
    if (isMobile && view === 'month') {
      setView('day');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

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
      return base44.entities.Appointment.filter({ studio_id: user.studio_id }, '-created_date');
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

  const filteredAppointments = appointments.filter(apt => {
    if (isArtist && !isAdmin) {
      if (!userArtist) return false;
      if (apt.artist_id !== userArtist.id) return false;
    }
    
    if (selectedLocation !== 'all' && apt.location_id !== selectedLocation) {
      return false;
    }
    
    if ((isAdmin || userRole === 'Front_Desk') && selectedArtist !== 'all' && apt.artist_id !== selectedArtist) {
      return false;
    }
    
    return true;
  });

  const getDaysToShow = () => {
    if (view === 'month') {
      const start = startOfWeek(startOfMonth(currentDate));
      const end = endOfWeek(endOfMonth(currentDate));
      return eachDayOfInterval({ start, end });
    } else if (view === 'week') {
      const start = startOfWeek(currentDate);
      const end = endOfWeek(currentDate);
      return eachDayOfInterval({ start, end });
    } else {
      return [currentDate];
    }
  };

  const getAppointmentsForDay = (day) => {
    return filteredAppointments.filter(apt => {
      const aptDate = parseISO(apt.appointment_date + 'T00:00:00');
      return isSameDay(aptDate, day);
    }).sort((a, b) => a.start_time.localeCompare(b.start_time));
  };

  const getCustomerName = (appointment) => {
    if (appointment.customer_id) {
      const customer = customers.find(c => c.id === appointment.customer_id);
      return customer?.name || appointment.client_name || 'Unknown';
    }
    return appointment.client_name || 'Unknown';
  };

  const isOwnAppointment = (appointment) => {
    if (!userArtist) return true;
    return appointment.artist_id === userArtist.id;
  };

  const handlePrevious = () => {
    if (view === 'month') {
      setCurrentDate(subMonths(currentDate, 1));
    } else if (view === 'week') {
      setCurrentDate(addDays(currentDate, -7));
    } else {
      setCurrentDate(addDays(currentDate, -1));
    }
  };

  const handleNext = () => {
    if (view === 'month') {
      setCurrentDate(addMonths(currentDate, 1));
    } else if (view === 'week') {
      setCurrentDate(addDays(currentDate, 7));
    } else {
      setCurrentDate(addDays(currentDate, 1));
    }
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleNewAppointment = (date = null) => {
    setSelectedAppointment(null);
    setSelectedDate(date);
    setShowAppointmentDialog(true);
  };

  const handleEditAppointment = (appointment) => {
    setSelectedAppointment(appointment);
    setSelectedDate(null);
    setShowAppointmentDialog(true);
  };

  const days = getDaysToShow();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
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

        <Card className="bg-white border-none shadow-md">
          <CardContent className="p-3 sm:p-6">
            <div className="rounded-xl bg-gray-50/80 p-3 sm:p-4">
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
              <Select value={view} onValueChange={setView}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="View" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day View</SelectItem>
                  <SelectItem value="week">Week View</SelectItem>
                  {!isMobile && <SelectItem value="month">Month View</SelectItem>}
                </SelectContent>
              </Select>

              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map(location => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(isAdmin || userRole === 'Front_Desk') && (
                <Select value={selectedArtist} onValueChange={setSelectedArtist}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="All Artists" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Artists</SelectItem>
                    {artists.filter(a => a.is_active).map(artist => (
                      <SelectItem key={artist.id} value={artist.id}>
                        {artist.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <div className="flex gap-1 sm:gap-2 col-span-2 sm:col-span-1 lg:col-span-1">
                <Button variant="outline" onClick={handlePrevious} className="flex-1 px-2 sm:px-4">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" onClick={handleToday} className="flex-1 px-2 sm:px-4 text-sm">
                  Today
                </Button>
                <Button variant="outline" onClick={handleNext} className="flex-1 px-2 sm:px-4">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-none shadow-lg">
          <CardContent className="p-3 sm:p-6">
            <div className="mb-4 sm:mb-6 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {format(currentDate, 'MMMM yyyy')}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                <span className="font-semibold text-gray-700">Legend:</span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full bg-gray-400"></span>
                  <span className="hidden sm:inline">Scheduled</span>
                  <span className="sm:hidden">Sched</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full bg-blue-500"></span>
                  <span className="hidden sm:inline">Confirmed</span>
                  <span className="sm:hidden">Conf</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full bg-green-500"></span>
                  <span className="hidden sm:inline">Checked Out</span>
                  <span className="sm:hidden">Done</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full bg-red-500"></span>
                  <span className="hidden sm:inline">Cancelled/No-Show</span>
                  <span className="sm:hidden">Cancel</span>
                </span>
              </div>
            </div>

            {view === 'month' && !isMobile && (
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="text-center font-semibold text-gray-600 text-xs sm:text-sm p-1 sm:p-2">
                    {day}
                  </div>
                ))}
                {days.map((day, idx) => {
                  const dayAppointments = getAppointmentsForDay(day);
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  const isToday = isSameDay(day, new Date());

                  return (
                    <div
                      key={idx}
                      className={`min-h-[80px] sm:min-h-[120px] p-1 sm:p-2 rounded-lg border-2 transition-all duration-200 ${
                        isToday ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100'
                      } ${
                        !isCurrentMonth ? 'bg-gray-50' : 'bg-white hover:bg-gray-50'
                      } cursor-pointer`}
                      onClick={() => handleNewAppointment(day)}
                    >
                      <div className={`text-xs sm:text-sm font-medium mb-1 sm:mb-2 ${
                        isToday ? 'text-indigo-600' : isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
                      }`}>
                        {format(day, 'd')}
                      </div>
                      <div className="space-y-1">
                        {dayAppointments.slice(0, 3).map(apt => (
                          <AppointmentCard
                            key={apt.id}
                            appointment={apt}
                            artists={artists}
                            locations={locations}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditAppointment(apt);
                            }}
                            compact
                            isOwnAppointment={isOwnAppointment(apt)}
                          />
                        ))}
                        {dayAppointments.length > 3 && (
                          <div className="text-xs text-gray-500 text-center">
                            +{dayAppointments.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {view === 'week' && (
              <div className={`${isMobile ? 'overflow-x-auto -mx-3 px-3 pb-2' : ''}`}>
                <div className={`grid gap-2 md:gap-4 ${isMobile ? 'grid-cols-7 min-w-[600px]' : 'grid-cols-7'}`}>
                  {days.map((day, idx) => {
                    const dayAppointments = getAppointmentsForDay(day);
                    const isToday = isSameDay(day, new Date());

                    return (
                      <div key={idx} className="space-y-2 min-w-0">
                        <div 
                          className={`text-center p-1.5 md:p-2 rounded-lg cursor-pointer ${
                            isToday ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                          }`}
                          onClick={() => {
                            if (isMobile) {
                              setCurrentDate(day);
                              setView('day');
                            }
                          }}
                        >
                          <div className="text-[10px] md:text-xs font-medium truncate">{format(day, 'EEE')}</div>
                          <div className="text-sm md:text-lg font-bold">{format(day, 'd')}</div>
                        </div>
                        <div className="space-y-1">
                          {dayAppointments.map(apt => (
                            <AppointmentCard
                              key={apt.id}
                              appointment={apt}
                              artists={artists}
                              locations={locations}
                              onClick={() => handleEditAppointment(apt)}
                              compact
                              isOwnAppointment={isOwnAppointment(apt)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {isMobile && (
                  <p className="text-xs text-gray-500 text-center mt-2">Swipe to see more days • Tap a day to view details</p>
                )}
              </div>
            )}

            {view === 'day' && (
              <div className="space-y-3">
                <div className="text-center p-3 sm:p-4 bg-indigo-50 rounded-lg mb-4 sm:mb-6">
                  <div className="text-xs sm:text-sm text-indigo-600 font-medium">
                    {format(currentDate, 'EEEE')}
                  </div>
                  <div className="text-xl sm:text-2xl font-bold text-gray-900">
                    {format(currentDate, 'MMMM d, yyyy')}
                  </div>
                </div>
                {getAppointmentsForDay(currentDate).length === 0 ? (
                  <div className="text-center py-8 sm:py-12">
                    <p className="text-gray-500 text-sm sm:text-base">No appointments scheduled</p>
                    <Button 
                      onClick={() => handleNewAppointment(currentDate)}
                      variant="outline"
                      className="mt-4"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Appointment
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2 sm:space-y-3">
                    {getAppointmentsForDay(currentDate).map(apt => {
                      const modifiedApt = {
                        ...apt,
                        client_name: getCustomerName(apt)
                      };
                      return (
                        <AppointmentCard
                          key={apt.id}
                          appointment={modifiedApt}
                          artists={artists}
                          locations={locations}
                          onClick={() => handleEditAppointment(apt)}
                          detailed
                          isMobile={isMobile}
                        />
                      );
                    })}
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