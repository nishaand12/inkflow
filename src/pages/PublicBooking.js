import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/utils/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, CreditCard, CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { format, addDays } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function PublicBooking() {
  const [searchParams] = useSearchParams();
  const studioId = searchParams.get("studio");

  const [loading, setLoading] = useState(true);
  const [studio, setStudio] = useState(null);
  const [appointmentTypes, setAppointmentTypes] = useState([]);
  const [artists, setArtists] = useState([]);
  const [locations, setLocations] = useState([]);
  const [availabilities, setAvailabilities] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [workStations, setWorkStations] = useState([]);

  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState(null);
  const [selectedArtist, setSelectedArtist] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [customerInfo, setCustomerInfo] = useState({ name: '', email: '', phone: '' });
  const [submitting, setSubmitting] = useState(false);
  const [bookingResult, setBookingResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (studioId) loadStudioData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId]);

  const loadStudioData = async () => {
    try {
      const [studioRes, typesRes, artistsRes, locationsRes, availRes, aptsRes, wsRes] = await Promise.all([
        supabase.from("studios").select("*").eq("id", studioId).single(),
        supabase.from("appointment_types").select("*").eq("studio_id", studioId).eq("is_active", true).eq("is_public_bookable", true),
        supabase.from("artists").select("*").eq("studio_id", studioId).eq("is_active", true),
        supabase.from("locations").select("*").eq("studio_id", studioId).eq("is_active", true),
        supabase.from("availabilities").select("*").eq("studio_id", studioId),
        supabase.from("appointments").select("id, artist_id, location_id, appointment_date, start_time, duration_hours, work_station_id, status").eq("studio_id", studioId),
        supabase.from("workstations").select("*").eq("studio_id", studioId).eq("status", "active")
      ]);

      if (studioRes.error) throw studioRes.error;
      setStudio(studioRes.data);
      setAppointmentTypes(typesRes.data || []);
      setArtists(artistsRes.data || []);
      setLocations(locationsRes.data || []);
      setAvailabilities(availRes.data || []);
      setAppointments((aptsRes.data || []).filter(a => a.status !== 'cancelled' && a.status !== 'no_show'));
      setWorkStations(wsRes.data || []);
    } catch (err) {
      setError("Unable to load booking information. Please check the link and try again.");
    } finally {
      setLoading(false);
    }
  };

  const timeToMinutes = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const minutesToTime = (m) => {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };

  const availableSlots = useMemo(() => {
    if (!selectedType || !selectedArtist || !selectedLocation || !selectedDate) return [];

    const duration = selectedType.default_duration;
    const durationMinutes = duration * 60;
    const date = selectedDate;
    const artistAvail = availabilities.filter(a => {
      if (a.artist_id !== selectedArtist) return false;
      if (a.is_blocked) return false;
      const start = a.start_date;
      const end = a.end_date;
      return date >= start && date <= end;
    });

    if (artistAvail.length === 0) return [];

    const blockedSlots = availabilities.filter(a => {
      if (a.artist_id !== selectedArtist) return false;
      if (!a.is_blocked) return false;
      return date >= a.start_date && date <= a.end_date;
    });

    const dayAppointments = appointments.filter(
      a => a.artist_id === selectedArtist && a.appointment_date === date
    );

    const locationStations = workStations.filter(ws => ws.location_id === selectedLocation);

    const slots = [];

    for (const avail of artistAvail) {
      if (avail.location_id && avail.location_id !== selectedLocation) continue;

      const availStart = timeToMinutes(avail.start_time);
      const availEnd = timeToMinutes(avail.end_time);

      for (let slotStart = availStart; slotStart + durationMinutes <= availEnd; slotStart += 30) {
        const slotEnd = slotStart + durationMinutes;

        const isBlocked = blockedSlots.some(b => {
          const bs = timeToMinutes(b.start_time);
          const be = timeToMinutes(b.end_time);
          return slotStart < be && slotEnd > bs;
        });
        if (isBlocked) continue;

        const hasConflict = dayAppointments.some(apt => {
          const as = timeToMinutes(apt.start_time);
          const ae = as + (apt.duration_hours * 60);
          return slotStart < ae && slotEnd > as;
        });
        if (hasConflict) continue;

        const occupiedStations = dayAppointments
          .filter(apt => {
            if (apt.location_id !== selectedLocation) return false;
            const as = timeToMinutes(apt.start_time);
            const ae = as + (apt.duration_hours * 60);
            return slotStart < ae && slotEnd > as;
          })
          .map(apt => apt.work_station_id)
          .filter(Boolean);

        const freeStation = locationStations.find(ws => !occupiedStations.includes(ws.id));
        if (!freeStation && locationStations.length > 0) continue;

        slots.push({
          time: minutesToTime(slotStart),
          stationId: freeStation?.id || null
        });
      }
    }

    return slots;
  }, [selectedType, selectedArtist, selectedLocation, selectedDate, availabilities, appointments, workStations]);

  const handleSubmitBooking = async () => {
    if (!customerInfo.name || !customerInfo.email || !customerInfo.phone) {
      setError("Please fill in all contact fields.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const slot = availableSlots.find(s => s.time === selectedTime);

      const { data, error: fnError } = await supabase.functions.invoke("create-public-booking", {
        body: {
          studioId,
          appointmentTypeId: selectedType.id,
          artistId: selectedArtist,
          locationId: selectedLocation,
          workStationId: slot?.stationId || null,
          date: selectedDate,
          startTime: selectedTime,
          durationHours: selectedType.default_duration,
          depositAmount: selectedType.default_deposit,
          customerName: customerInfo.name,
          customerEmail: customerInfo.email,
          customerPhone: customerInfo.phone
        }
      });

      if (fnError || data?.error) {
        throw new Error(data?.error || fnError?.message || "Booking failed");
      }

      setBookingResult(data);
      setStep(5);
    } catch (err) {
      setError(err.message || "Failed to create booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!studio || !studioId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <Card className="max-w-md w-full bg-white shadow-xl">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Booking Unavailable</h2>
            <p className="text-gray-500">This booking link is invalid or the studio is not available.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (bookingResult) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-50 p-6">
        <Card className="max-w-md w-full bg-white shadow-xl">
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Booking Confirmed!</h2>
            <p className="text-gray-600 mb-6">
              Your appointment at {studio.name} has been booked for {selectedDate} at {selectedTime}.
            </p>
            {bookingResult.checkout_url && (
              <a
                href={bookingResult.checkout_url}
                className="inline-flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
              >
                <CreditCard className="w-5 h-5" />
                Pay Deposit (${selectedType?.default_deposit || 0})
              </a>
            )}
            {!bookingResult.checkout_url && (
              <p className="text-sm text-gray-500">No deposit required. See you at your appointment!</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const publicTypes = appointmentTypes;
  const minDate = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">{studio.name}</h1>
          <p className="text-gray-600 mt-1">Book your appointment online</p>
        </div>

        <div className="flex items-center justify-center gap-2 text-sm">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step >= s ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
              }`}>{s}</div>
              {s < 4 && <div className={`w-8 h-0.5 ${step > s ? 'bg-indigo-600' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        {error && (
          <Alert className="border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {step === 1 && (
          <Card className="bg-white shadow-lg border-none">
            <CardHeader>
              <CardTitle className="text-xl">Select Service</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {publicTypes.length === 0 ? (
                <p className="text-gray-500 text-center py-6">No services available for online booking at this time.</p>
              ) : (
                publicTypes.map(type => (
                  <button
                    key={type.id}
                    onClick={() => { setSelectedType(type); setStep(2); setError(null); }}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all hover:border-indigo-300 hover:bg-indigo-50 ${
                      selectedType?.id === type.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{type.name}</p>
                        {type.description && <p className="text-sm text-gray-500 mt-1">{type.description}</p>}
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-sm text-gray-500">
                          <Clock className="w-4 h-4" />
                          {type.default_duration}h
                        </div>
                        {type.default_deposit > 0 && (
                          <Badge className="bg-indigo-100 text-indigo-700 mt-1">
                            ${type.default_deposit} deposit
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card className="bg-white shadow-lg border-none">
            <CardHeader>
              <CardTitle className="text-xl">Choose Artist & Location</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={selectedLocation} onValueChange={(v) => { setSelectedLocation(v); setSelectedDate(''); setSelectedTime(''); }}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    {locations.map(l => (
                      <SelectItem key={l.id} value={l.id}>{l.name} - {l.address}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Artist</Label>
                <Select value={selectedArtist} onValueChange={(v) => { setSelectedArtist(v); setSelectedDate(''); setSelectedTime(''); }}>
                  <SelectTrigger><SelectValue placeholder="Select artist" /></SelectTrigger>
                  <SelectContent>
                    {artists.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 pt-4">
                <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                <Button
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                  disabled={!selectedArtist || !selectedLocation}
                  onClick={() => { setStep(3); setError(null); }}
                >
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card className="bg-white shadow-lg border-none">
            <CardHeader>
              <CardTitle className="text-xl">Pick Date & Time</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  min={minDate}
                  value={selectedDate}
                  onChange={(e) => { setSelectedDate(e.target.value); setSelectedTime(''); }}
                />
              </div>
              {selectedDate && (
                <div className="space-y-2">
                  <Label>Available Times</Label>
                  {availableSlots.length === 0 ? (
                    <p className="text-sm text-gray-500 py-4 text-center">No available times on this date. Please try another date.</p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {availableSlots.map(slot => (
                        <button
                          key={slot.time}
                          onClick={() => setSelectedTime(slot.time)}
                          className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                            selectedTime === slot.time
                              ? 'bg-indigo-600 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-indigo-100'
                          }`}
                        >
                          {slot.time}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2 pt-4">
                <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                <Button
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                  disabled={!selectedTime}
                  onClick={() => { setStep(4); setError(null); }}
                >
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 4 && (
          <Card className="bg-white shadow-lg border-none">
            <CardHeader>
              <CardTitle className="text-xl">Your Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-indigo-50 rounded-lg p-4 space-y-1 text-sm">
                <p><span className="font-medium">Service:</span> {selectedType?.name}</p>
                <p><span className="font-medium">Artist:</span> {artists.find(a => a.id === selectedArtist)?.full_name}</p>
                <p><span className="font-medium">Location:</span> {locations.find(l => l.id === selectedLocation)?.name}</p>
                <p><span className="font-medium">Date:</span> {selectedDate} at {selectedTime}</p>
                <p><span className="font-medium">Duration:</span> {selectedType?.default_duration}h</p>
                {selectedType?.default_deposit > 0 && (
                  <p><span className="font-medium">Deposit:</span> ${selectedType.default_deposit}</p>
                )}
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Full Name *</Label>
                  <Input
                    value={customerInfo.name}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, name: e.target.value })}
                    placeholder="Your full name"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    value={customerInfo.email}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })}
                    placeholder="your@email.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone *</Label>
                  <Input
                    type="tel"
                    value={customerInfo.phone}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                    placeholder="(555) 123-4567"
                    required
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
                <Button
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                  disabled={submitting || !customerInfo.name || !customerInfo.email || !customerInfo.phone}
                  onClick={handleSubmitBooking}
                >
                  {submitting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Booking...</>
                  ) : (
                    <><Calendar className="w-4 h-4 mr-2" /> Confirm Booking</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
