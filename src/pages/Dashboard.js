import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Users, MapPin, Clock, TrendingUp, Plus } from "lucide-react";
import { format, startOfWeek, endOfWeek, isWithinInterval } from "date-fns";
import AppointmentDialog from "../components/calendar/AppointmentDialog";
import { normalizeUserRole } from "@/utils/roles";

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [userArtist, setUserArtist] = useState(null);
  const [showAppointmentDialog, setShowAppointmentDialog] = useState(false);

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

  const filteredAppointments = (isArtist && !isAdmin)
    ? (userArtist ? appointments.filter(apt => apt.artist_id === userArtist.id) : [])
    : appointments;

  const thisWeekAppointments = filteredAppointments.filter(apt => {
    const aptDate = new Date(apt.appointment_date);
    return isWithinInterval(aptDate, {
      start: startOfWeek(new Date()),
      end: endOfWeek(new Date())
    });
  });

  const upcomingAppointments = filteredAppointments
    .filter(apt => new Date(apt.appointment_date) >= new Date() && apt.status !== 'cancelled')
    .slice(0, 5);

  const totalRevenue = filteredAppointments
    .filter(apt => apt.status === 'completed')
    .reduce((sum, apt) => sum + (apt.total_estimate || 0), 0);

  const getCustomerName = (appointment) => {
    if (appointment.customer_id) {
      const customer = customers.find(c => c.id === appointment.customer_id);
      return customer?.name || appointment.client_name || 'Unknown';
    }
    return appointment.client_name || 'Unknown';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-2">
              Welcome back{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}
            </h1>
            <p className="text-gray-500">
              {isArtist ? "Here's your schedule today" : "Here's what's happening with your studio today"}
            </p>
          </div>
          <Button
            onClick={() => setShowAppointmentDialog(true)}
            className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Appointment
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="bg-white border-none shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                {isArtist ? 'My Appointments This Week' : 'This Week'}
              </CardTitle>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-indigo-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">{thisWeekAppointments.length}</div>
              <p className="text-xs text-gray-500 mt-1">Appointments scheduled</p>
            </CardContent>
          </Card>

          {!isArtist && (
            <>
              <Card className="bg-white border-none shadow-lg hover:shadow-xl transition-all duration-300">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">Active Artists</CardTitle>
                  <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                    <Users className="w-5 h-5 text-amber-600" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-gray-900">
                    {artists.filter(a => a.is_active).length}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Total artists</p>
                </CardContent>
              </Card>

              <Card className="bg-white border-none shadow-lg hover:shadow-xl transition-all duration-300">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">Locations</CardTitle>
                  <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-green-600" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-gray-900">
                    {locations.filter(l => l.is_active).length}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Studio locations</p>
                </CardContent>
              </Card>
            </>
          )}

          <Card className="bg-white border-none shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                {isArtist ? 'My Revenue' : 'Revenue'}
              </CardTitle>
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-purple-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">
                ${totalRevenue.toLocaleString()}
              </div>
              <p className="text-xs text-gray-500 mt-1">Completed bookings</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-white border-none shadow-lg">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-xl font-bold">
                {isArtist ? 'My Upcoming Appointments' : 'Upcoming Appointments'}
              </CardTitle>
              <Link to={createPageUrl("Appointments")}>
                <Button variant="ghost" className="text-indigo-600 hover:text-indigo-700">
                  View All
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {upcomingAppointments.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No upcoming appointments</p>
              </div>
            ) : (
              <div className="space-y-4">
                {upcomingAppointments.map((appointment) => {
                  const artist = artists.find(a => a.id === appointment.artist_id);
                  const location = locations.find(l => l.id === appointment.location_id);
                  const customerName = getCustomerName(appointment);
                  
                  return (
                    <div
                      key={appointment.id}
                      className="flex items-center justify-between p-4 rounded-xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-all duration-200"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-bold">
                          {customerName?.charAt(0) || 'C'}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{customerName}</p>
                          <p className="text-sm text-gray-500">
                            {format(new Date(appointment.appointment_date), 'MMM d, yyyy')} at {appointment.start_time}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        {!isArtist && <p className="text-sm font-medium text-gray-900">{artist?.full_name}</p>}
                        <p className="text-xs text-gray-500">{location?.name}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AppointmentDialog
        open={showAppointmentDialog}
        onOpenChange={setShowAppointmentDialog}
        appointment={null}
        artists={artists}
        locations={locations}
        currentUser={user}
        userArtist={userArtist}
      />
    </div>
  );
}