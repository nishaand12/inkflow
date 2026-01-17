import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Calendar as CalendarIcon, TrendingUp } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { normalizeUserRole } from "@/utils/roles";

export default function Reports() {
  const [user, setUser] = useState(null);
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [filterLocation, setFilterLocation] = useState('all');
  const [filterArtist, setFilterArtist] = useState('all');

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
      return base44.entities.Appointment.filter({ studio_id: user.studio_id });
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

  const { data: appointmentTypes = [] } = useQuery({
    queryKey: ['appointmentTypes', user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.AppointmentType.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === 'admin' ? 'Admin' : 'Front_Desk'));
  };

  const userRole = getUserRole();
  const isAdmin = userRole === 'Admin' || userRole === 'Owner';

  const filteredAppointments = appointments.filter(apt => {
    const aptDate = new Date(apt.appointment_date);
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (aptDate < start || aptDate > end) return false;
    if (filterLocation !== 'all' && apt.location_id !== filterLocation) return false;
    if (filterArtist !== 'all' && apt.artist_id !== filterArtist) return false;
    
    return true;
  });

  // Appointments by Type Report
  const appointmentsByType = filteredAppointments.reduce((acc, apt) => {
    const type = appointmentTypes.find(t => t.id === apt.appointment_type_id);
    const typeName = type?.name || 'No Type';
    const artist = artists.find(a => a.id === apt.artist_id);
    const location = locations.find(l => l.id === apt.location_id);
    
    const key = `${typeName}|${artist?.full_name || 'Unknown'}|${location?.name || 'Unknown'}`;
    
    if (!acc[key]) {
      acc[key] = {
        type: typeName,
        artist: artist?.full_name || 'Unknown',
        location: location?.name || 'Unknown',
        count: 0
      };
    }
    
    acc[key].count++;
    return acc;
  }, {});

  // Revenue Report - only completed appointments
  const completedAppointments = filteredAppointments.filter(apt => apt.status === 'completed');

  const revenueByArtist = completedAppointments.reduce((acc, apt) => {
    const artist = artists.find(a => a.id === apt.artist_id);
    const artistName = artist?.full_name || 'Unknown';
    
    if (!acc[artistName]) {
      acc[artistName] = {
        artist: artistName,
        deposits: 0,
        charges: 0,
        tax: 0,
        revenue: 0,
        count: 0
      };
    }
    
    acc[artistName].deposits += apt.deposit_amount || 0;
    acc[artistName].charges += apt.charge_amount || 0;
    acc[artistName].tax += apt.tax_amount || 0;
    acc[artistName].revenue += (apt.deposit_amount || 0) + (apt.charge_amount || 0);
    acc[artistName].count++;
    
    return acc;
  }, {});

  const revenueByLocation = completedAppointments.reduce((acc, apt) => {
    const location = locations.find(l => l.id === apt.location_id);
    const locationName = location?.name || 'Unknown';
    
    if (!acc[locationName]) {
      acc[locationName] = {
        location: locationName,
        deposits: 0,
        charges: 0,
        tax: 0,
        revenue: 0,
        count: 0
      };
    }
    
    acc[locationName].deposits += apt.deposit_amount || 0;
    acc[locationName].charges += apt.charge_amount || 0;
    acc[locationName].tax += apt.tax_amount || 0;
    acc[locationName].revenue += (apt.deposit_amount || 0) + (apt.charge_amount || 0);
    acc[locationName].count++;
    
    return acc;
  }, {});

  // Revenue by Payment Method
  const revenueByPaymentMethod = completedAppointments.reduce((acc, apt) => {
    const method = apt.payment_method || 'Not Specified';
    
    if (!acc[method]) {
      acc[method] = {
        method: method,
        deposits: 0,
        charges: 0,
        tax: 0,
        revenue: 0,
        count: 0
      };
    }
    
    acc[method].deposits += apt.deposit_amount || 0;
    acc[method].charges += apt.charge_amount || 0;
    acc[method].tax += apt.tax_amount || 0;
    acc[method].revenue += (apt.deposit_amount || 0) + (apt.charge_amount || 0);
    acc[method].count++;
    
    return acc;
  }, {});

  const exportToCSV = (data, filename) => {
    if (data.length === 0) return;
    
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(header => row[header]).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">
                Only Admins can access reports.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 mt-1">Analytics and insights for your business</p>
        </div>

        <Card className="bg-white border-none shadow-md">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={filterLocation} onValueChange={setFilterLocation}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Locations" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Locations</SelectItem>
                    {locations.map(loc => (
                      <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Artist</Label>
                <Select value={filterArtist} onValueChange={setFilterArtist}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Artists" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Artists</SelectItem>
                    {artists.map(artist => (
                      <SelectItem key={artist.id} value={artist.id}>{artist.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="appointments" className="space-y-6">
          <TabsList className="bg-white border border-gray-200">
            <TabsTrigger value="appointments">Appointments by Type</TabsTrigger>
            <TabsTrigger value="revenue">Revenue & Deposits</TabsTrigger>
          </TabsList>

          <TabsContent value="appointments">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Appointments by Type, Artist & Location</CardTitle>
                <Button
                  variant="outline"
                  onClick={() => exportToCSV(Object.values(appointmentsByType), 'appointments_by_type')}
                  disabled={Object.keys(appointmentsByType).length === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {Object.keys(appointmentsByType).length === 0 ? (
                  <div className="text-center py-12">
                    <CalendarIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No appointments in selected date range</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Appointment Type</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Artist</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Location</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Count</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {Object.values(appointmentsByType).map((row, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900">{row.type}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{row.artist}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{row.location}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">{row.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="revenue" className="space-y-6">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Revenue by Artist</CardTitle>
                <Button
                  variant="outline"
                  onClick={() => exportToCSV(Object.values(revenueByArtist), 'revenue_by_artist')}
                  disabled={Object.keys(revenueByArtist).length === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {Object.keys(revenueByArtist).length === 0 ? (
                  <div className="text-center py-12">
                    <TrendingUp className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No completed appointments in selected date range</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Artist</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Appointments</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Deposits</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Charges</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Tax</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Total Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {Object.values(revenueByArtist).map((row, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 font-medium">{row.artist}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-right">{row.count}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${row.deposits.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${row.charges.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${row.tax.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right font-bold">${row.revenue.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Revenue by Location</CardTitle>
                <Button
                  variant="outline"
                  onClick={() => exportToCSV(Object.values(revenueByLocation), 'revenue_by_location')}
                  disabled={Object.keys(revenueByLocation).length === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {Object.keys(revenueByLocation).length === 0 ? (
                  <div className="text-center py-12">
                    <TrendingUp className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No completed appointments in selected date range</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Location</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Appointments</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Deposits</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Charges</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Tax</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Total Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {Object.values(revenueByLocation).map((row, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 font-medium">{row.location}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-right">{row.count}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${row.deposits.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${row.charges.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${row.tax.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right font-bold">${row.revenue.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Revenue by Payment Method</CardTitle>
                <Button
                  variant="outline"
                  onClick={() => exportToCSV(Object.values(revenueByPaymentMethod), 'revenue_by_payment_method')}
                  disabled={Object.keys(revenueByPaymentMethod).length === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {Object.keys(revenueByPaymentMethod).length === 0 ? (
                  <div className="text-center py-12">
                    <TrendingUp className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No completed appointments in selected date range</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Payment Method</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Appointments</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Deposits</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Charges</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Tax</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Total Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {Object.values(revenueByPaymentMethod).map((row, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 font-medium">{row.method}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-right">{row.count}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${row.deposits.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${row.charges.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${row.tax.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right font-bold">${row.revenue.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}