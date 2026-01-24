import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Calendar, Clock, MapPin, User } from "lucide-react";
import { format, parseISO } from "date-fns";
import AppointmentDialog from "../components/calendar/AppointmentDialog";
import { normalizeUserRole } from "@/utils/roles";

const statusColors = {
  scheduled: "bg-blue-100 text-blue-800 border-blue-200",
  confirmed: "bg-green-100 text-green-800 border-green-200",
  completed: "bg-gray-100 text-gray-800 border-gray-200",
  cancelled: "bg-red-100 text-red-800 border-red-200",
  no_show: "bg-orange-100 text-orange-800 border-orange-200"
};

export default function Appointments() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [showDialog, setShowDialog] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [user, setUser] = useState(null);
  const [userArtist, setUserArtist] = useState(null);

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

  const getCustomerName = (appointment) => {
    if (appointment.customer_id) {
      const customer = customers.find(c => c.id === appointment.customer_id);
      return customer?.name || appointment.client_name || 'Unknown';
    }
    return appointment.client_name || 'Unknown';
  };

  const getCustomerEmail = (appointment) => {
    if (appointment.customer_id) {
      const customer = customers.find(c => c.id === appointment.customer_id);
      return customer?.email || appointment.client_email || '';
    }
    return appointment.client_email || appointment.client_phone || '';
  };

  const filteredAppointments = appointments.filter(apt => {
    if (isArtist && !isAdmin) {
      if (!userArtist) return false;
      if (apt.artist_id !== userArtist.id) return false;
    }
    
    const customerName = getCustomerName(apt);
    const customerEmail = getCustomerEmail(apt);
    
    const matchesSearch = customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         customerEmail?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || apt.status === statusFilter;
    const matchesLocation = locationFilter === 'all' || apt.location_id === locationFilter;
    return matchesSearch && matchesStatus && matchesLocation;
  });

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
          <CardContent className="p-6">
            <div className="rounded-xl bg-gray-50/80 p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search by client name or email..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="no_show">No Show</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger>
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
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-none shadow-lg">
          <CardHeader>
            <CardTitle>
              {(isArtist && !isAdmin) ? 'My Appointments' : 'All Appointments'} ({filteredAppointments.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredAppointments.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No appointments found</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredAppointments.map(appointment => {
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
                              {appointment.start_time} ({appointment.duration_hours}h)
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
                            <p className="text-sm text-gray-500 line-clamp-2">
                              {appointment.design_description}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-col items-end justify-between">
                          <Badge className={`${statusColors[appointment.status]} border`}>
                            {appointment.status}
                          </Badge>
                          {appointment.total_estimate > 0 && (
                            <div className="text-right mt-2">
                              <div className="text-lg font-bold text-gray-900">
                                ${appointment.total_estimate}
                              </div>
                              {appointment.deposit_amount > 0 && (
                                <div className="text-xs text-gray-500">
                                  Deposit: ${appointment.deposit_amount}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
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