import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/utils/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Calendar, Clock, CreditCard, CheckCircle, Loader2, AlertCircle, Tag } from "lucide-react";
import { addMinutesToTime, formatDuration } from "@/utils/index";
import { getAppointmentTypeDisplaySections } from "@/utils/reportingCategories";
import { format, addDays } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function PublicBooking() {
  const [searchParams] = useSearchParams();
  const studioParam = searchParams.get("studio");

  const [loading, setLoading] = useState(true);
  const [studioId, setStudioId] = useState(null);
  const [studio, setStudio] = useState(null);
  const [appointmentTypes, setAppointmentTypes] = useState([]);
  const [artists, setArtists] = useState([]);
  const [locations, setLocations] = useState([]);
  const [availabilities, setAvailabilities] = useState([]);
  const [weeklySchedules, setWeeklySchedules] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [workStations, setWorkStations] = useState([]);
  const [kindCategories, setKindCategories] = useState([]);

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
    if (studioParam) {
      loadStudioData();
    } else {
      // No studio param provided — stop the loader so the error state renders
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioParam]);

  const loadStudioData = async () => {
    try {
      const { data, error: rpcErr } = await supabase.rpc("get_public_booking_data", { p_studio_id: studioParam });
      if (rpcErr) throw rpcErr;
      if (!data) throw new Error("Studio not found or unavailable");

      setStudioId(studioParam);
      setStudio(data.studio);
      setAppointmentTypes(data.appointment_types || []);
      setArtists(data.artists || []);
      setLocations((data.locations || []).filter(location => location.is_active));
      setAvailabilities(data.availabilities || []);
      setWeeklySchedules(data.weekly_schedules || []);
      setAppointments(data.appointments || []);
      setWorkStations(data.workstations || []);

      const { data: catRows, error: catErr } = await supabase
        .from("reporting_categories")
        .select("id,parent_id,name,display_order,category_role,is_active")
        .eq("studio_id", studioParam)
        .eq("category_role", "appointment_kind")
        .eq("is_active", true);
      if (!catErr && catRows) setKindCategories(catRows);
      else setKindCategories([]);
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

  const piercers = useMemo(() =>
    artists.filter(a => a.artist_type === 'piercer' || a.artist_type === 'both'),
    [artists]
  );

  const getSlotsForArtist = (artistId, date) => {
    if (!selectedType || !selectedLocation || !date) return [];
    const durationMinutes = selectedType.default_duration_minutes || 60;

    const dateObj = new Date(date + 'T00:00:00');
    const dayOfWeek = dateObj.getDay();

    const artistAvail = availabilities.filter(a => {
      if (a.artist_id !== artistId) return false;
      if (a.is_blocked) return false;
      return date >= a.start_date && date <= a.end_date;
    });

    const weeklyAvail = weeklySchedules
      .filter(ws => ws.artist_id === artistId && ws.day_of_week === dayOfWeek)
      .map(ws => ({
        start_time: ws.start_time,
        end_time: ws.end_time,
        location_id: ws.location_id,
        _isWeekly: true
      }));

    const combinedAvail = [...artistAvail, ...weeklyAvail];
    if (combinedAvail.length === 0) return [];

    const blockedSlots = availabilities.filter(a => {
      if (a.artist_id !== artistId) return false;
      if (!a.is_blocked) return false;
      return date >= a.start_date && date <= a.end_date;
    });

    const dayAppointments = appointments.filter(
      a => a.artist_id === artistId && a.appointment_date === date
    );

    const locationStations = workStations.filter(ws => ws.location_id === selectedLocation);
    const slots = [];

    for (const avail of combinedAvail) {
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
          const ae = apt.end_time ? timeToMinutes(apt.end_time) : as + 60;
          return slotStart < ae && slotEnd > as;
        });
        if (hasConflict) continue;

        const occupiedStations = dayAppointments
          .filter(apt => {
            if (apt.location_id !== selectedLocation) return false;
            const as = timeToMinutes(apt.start_time);
            const ae = apt.end_time ? timeToMinutes(apt.end_time) : as + 60;
            return slotStart < ae && slotEnd > as;
          })
          .map(apt => apt.work_station_id)
          .filter(Boolean);

        const freeStation = locationStations.find(ws => !occupiedStations.includes(ws.id));
        if (!freeStation && locationStations.length > 0) continue;

        slots.push({
          time: minutesToTime(slotStart),
          stationId: freeStation?.id || null,
          artistId
        });
      }
    }
    return slots;
  };

  const groupedTypes = useMemo(() => {
    const sections = getAppointmentTypeDisplaySections(appointmentTypes, kindCategories);
    return sections.map((s) => ({ category: s.label, accordionValue: s.key, types: s.types }));
  }, [appointmentTypes, kindCategories]);

  const availableSlots = useMemo(() => {
    if (!selectedType || !selectedLocation || !selectedDate) return [];

    if (selectedArtist === '__any__') {
      const allSlots = new Map();
      for (const piercer of piercers) {
        for (const slot of getSlotsForArtist(piercer.id, selectedDate)) {
          if (!allSlots.has(slot.time)) {
            allSlots.set(slot.time, slot);
          }
        }
      }
      return Array.from(allSlots.values()).sort((a, b) => a.time.localeCompare(b.time));
    }

    if (!selectedArtist) return [];
    return getSlotsForArtist(selectedArtist, selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, selectedArtist, selectedLocation, selectedDate, availabilities, weeklySchedules, appointments, workStations, piercers]);

  const handleSubmitBooking = async () => {
    if (!customerInfo.name || !customerInfo.email || !customerInfo.phone) {
      setError("Please fill in all contact fields.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const slot = availableSlots.find(s => s.time === selectedTime);
      const resolvedArtistId = selectedArtist === '__any__' ? slot?.artistId : selectedArtist;

      const { data, error: fnError } = await supabase.functions.invoke("create-public-booking", {
        body: {
          studioId,
          appointmentTypeId: selectedType.id,
          artistId: resolvedArtistId,
          locationId: selectedLocation,
          workStationId: slot?.stationId || null,
          date: selectedDate,
          startTime: selectedTime,
          endTime: addMinutesToTime(selectedTime, selectedType.default_duration_minutes || 60),
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

  if (!studio || !studioParam) {
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
            <CardContent>
              {groupedTypes.length === 0 ? (
                <p className="text-gray-500 text-center py-6">No services available for online booking at this time.</p>
              ) : (
                <Accordion type="single" collapsible className="w-full">
                  {groupedTypes.map(({ category, accordionValue, types }) => (
                    <AccordionItem key={accordionValue} value={accordionValue}>
                      <AccordionTrigger className="text-base font-semibold text-gray-800 hover:no-underline px-1">
                        <span className="flex items-center gap-2">
                          <Tag className="w-4 h-4 text-indigo-500 shrink-0" />
                          {category}
                          <span className="text-xs font-normal text-gray-400 ml-1">({types.length})</span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="px-1">
                        <div className="space-y-2 pt-1">
                          {types.map(type => (
                            <button
                              key={type.id}
                              onClick={() => { setSelectedType(type); setStep(2); setError(null); }}
                              className={`w-full p-4 rounded-xl border-2 text-left transition-all hover:border-indigo-300 hover:bg-indigo-50 ${
                                selectedType?.id === type.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-gray-900">{type.name}</p>
                                  {type.description && (
                                    <p className="text-sm text-gray-500 mt-0.5">{type.description}</p>
                                  )}
                                </div>
                                <div className="text-right shrink-0 space-y-1">
                                  <div className="flex items-center gap-1 text-sm text-gray-500 justify-end">
                                    <Clock className="w-3.5 h-3.5" />
                                    {formatDuration(type.default_duration_minutes)}
                                  </div>
                                  {type.service_cost > 0 && (
                                    <p className="text-sm font-semibold text-gray-900">${type.service_cost}</p>
                                  )}
                                  {type.default_deposit > 0 && (
                                    <Badge className="bg-indigo-100 text-indigo-700 text-xs">
                                      ${type.default_deposit} deposit
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
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
                <Label>Piercer</Label>
                <Select value={selectedArtist} onValueChange={(v) => { setSelectedArtist(v); setSelectedDate(''); setSelectedTime(''); }}>
                  <SelectTrigger><SelectValue placeholder="Select piercer" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any Available Piercer</SelectItem>
                    {piercers.map(a => (
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
                <p><span className="font-medium">Piercer:</span> {selectedArtist === '__any__' ? 'Any Available Piercer' : piercers.find(a => a.id === selectedArtist)?.full_name}</p>
                <p><span className="font-medium">Location:</span> {locations.find(l => l.id === selectedLocation)?.name}</p>
                <p><span className="font-medium">Date:</span> {selectedDate} at {selectedTime}</p>
                <p><span className="font-medium">Duration:</span> {formatDuration(selectedType?.default_duration_minutes)}</p>
                {selectedType?.service_cost > 0 && (
                  <p><span className="font-medium">Service Cost:</span> ${selectedType.service_cost}</p>
                )}
                {selectedType?.default_deposit > 0 && (
                  <p><span className="font-medium">Deposit Due Now:</span> ${selectedType.default_deposit}</p>
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
