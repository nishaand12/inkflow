import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/utils/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, CreditCard, CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { addMinutesToTime, formatDuration, formatTime12h } from "@/utils/index";
import { format, addDays } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { isPublicPiercingBookableArtistType } from "@/utils/artistTypes";
import {
  buildExclusionKeySet,
  filterArtistsForAppointmentType,
} from "@/utils/artistServiceEligibility";
import AppointmentTypeImage from "@/components/appointment-types/AppointmentTypeImage";
import { useEmbedResize } from "@/hooks/useEmbedResize";
import { computeArtistSlots, computeAnyArtistSlots } from "@/utils/bookingSlots";
import ServiceBrowser from "@/components/public-booking/ServiceBrowser";

export default function PublicBooking() {
  const [searchParams] = useSearchParams();
  const studioParam = searchParams.get("studio");
  const isEmbed = searchParams.get("embed") === "1";
  const isInIframe = typeof window !== "undefined" && window.self !== window.top;

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
  const [serviceExclusions, setServiceExclusions] = useState([]);

  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState(null);
  const [selectedCategoryPath, setSelectedCategoryPath] = useState([]);
  const [selectedArtist, setSelectedArtist] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [customerInfo, setCustomerInfo] = useState({ name: '', email: '', phone: '' });
  const [submitting, setSubmitting] = useState(false);
  const [bookingResult, setBookingResult] = useState(null);
  const [error, setError] = useState(null);

  useEmbedResize(isEmbed, [loading, step, bookingResult, error, studio, selectedCategoryPath.length]);

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
      setKindCategories(data.appointment_kind_categories || []);
      setServiceExclusions(data.artist_appointment_type_exclusions || []);
    } catch (err) {
      setError("Unable to load booking information. Please check the link and try again.");
    } finally {
      setLoading(false);
    }
  };

  const exclusionKeys = useMemo(
    () => buildExclusionKeySet(serviceExclusions),
    [serviceExclusions]
  );

  const piercers = useMemo(
    () => artists.filter((a) => isPublicPiercingBookableArtistType(a.artist_type)),
    [artists]
  );

  const eligiblePiercers = useMemo(() => {
    if (!selectedType?.id) return piercers;
    return filterArtistsForAppointmentType(piercers, selectedType.id, exclusionKeys);
  }, [piercers, selectedType, exclusionKeys]);

  const getSlotsForArtist = (artistId, date) => {
    if (!selectedType || !selectedLocation || !date) return [];
    return computeArtistSlots({
      artistId,
      date,
      durationMinutes: selectedType.default_duration_minutes || 60,
      locationId: selectedLocation,
      availabilities,
      weeklySchedules,
      appointments,
      workStations,
      preferredWorkStationId:
        artists.find((a) => a.id === artistId)?.preferred_work_station_id || null,
    });
  };

  const handleTypeSelect = (type) => {
    setSelectedType(type);
    setSelectedArtist('');
    setSelectedLocation('');
    setSelectedDate('');
    setSelectedTime('');
    setStep(2);
    setError(null);
  };

  const availableSlots = useMemo(() => {
    if (!selectedType || !selectedLocation || !selectedDate) return [];

    if (selectedArtist === '__any__') {
      return computeAnyArtistSlots({
        artistIds: eligiblePiercers.map((p) => p.id),
        artists,
        date: selectedDate,
        durationMinutes: selectedType.default_duration_minutes || 60,
        locationId: selectedLocation,
        availabilities,
        weeklySchedules,
        appointments,
        workStations,
      });
    }

    if (!selectedArtist) return [];
    return getSlotsForArtist(selectedArtist, selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, selectedArtist, selectedLocation, selectedDate, availabilities, weeklySchedules, appointments, workStations, eligiblePiercers]);

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

  const shellMinHeight = isEmbed ? "min-h-0" : "min-h-screen";
  const shellPadding = isEmbed ? "p-4 sm:p-6" : "p-6";

  if (loading) {
    return (
      <div
        data-embed={isEmbed ? "true" : undefined}
        className={`${shellMinHeight} flex items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50 py-12`}
      >
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!studio || !studioParam) {
    return (
      <div
        data-embed={isEmbed ? "true" : undefined}
        className={`${shellMinHeight} flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 ${shellPadding}`}
      >
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
    const hasDeposit = Boolean(bookingResult.checkout_url);
    return (
      <div
        data-embed={isEmbed ? "true" : undefined}
        className={`${shellMinHeight} flex items-center justify-center ${shellPadding} ${
        hasDeposit
          ? "bg-gradient-to-br from-indigo-50 to-purple-50"
          : "bg-gradient-to-br from-green-50 to-emerald-50"
      }`}>
        <Card className="max-w-md w-full bg-white shadow-xl">
          <CardContent className="p-8 text-center">
            {hasDeposit ? (
              <>
                <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CreditCard className="w-8 h-8 text-indigo-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Pay deposit to reserve</h2>
                <p className="text-gray-600 mb-6">
                  Paying the deposit is required to reserve your booking at {studio.name} for{" "}
                  {selectedDate} at {formatTime12h(selectedTime)}. Your appointment is not confirmed until payment
                  completes. You must pay your deposit within 1 hour, or your requested time will be
                  released.
                </p>
                <a
                  href={bookingResult.checkout_url}
                  target={isInIframe ? "_top" : undefined}
                  rel={isInIframe ? "noopener noreferrer" : undefined}
                  className="inline-flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
                >
                  <CreditCard className="w-5 h-5" />
                  Pay Deposit (${selectedType?.default_deposit || 0})
                </a>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Booking Confirmed!</h2>
                <p className="text-gray-600 mb-6">
                  Your appointment at {studio.name} has been booked for {selectedDate} at{" "}
                  {formatTime12h(selectedTime)}.
                </p>
                <p className="text-sm text-gray-500">No deposit required. See you at your appointment!</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const minDate = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  return (
    <div
      data-embed={isEmbed ? "true" : undefined}
      className={`${shellMinHeight} bg-gradient-to-br from-indigo-50 to-purple-50 ${isEmbed ? "p-2 sm:p-4" : "p-4 sm:p-6"}`}
    >
      <div className={`max-w-2xl mx-auto ${isEmbed ? "space-y-4" : "space-y-6"}`}>
        {!isEmbed && (
          <>
            <div className="text-center">
              <h1 className="text-3xl font-bold text-gray-900">{studio.name}</h1>
              <p className="text-gray-600 mt-1">Book your appointment online</p>
            </div>

            {(() => {
              const disclaimerSource = studio.booking_page_disclaimer_template
                || "Earlobes age 5+ with a custodial parent present / Most common piercings age 13\u201315 with a custodial parent present or 16+ with picture ID / Extreme and genital piercings 18+ with picture ID\n\nONLINE $10 DEPOSITS ARE NON-REFUNDABLE\n\nCustodial parent must present valid government photo ID. Minor with parent must also present ID to get pierced; a non-photo health card is fine.";
              return (
                <div className="rounded-xl border border-indigo-200 bg-white/90 shadow-sm px-4 py-4 space-y-3 text-left text-sm text-gray-700">
                  {disclaimerSource.split("\n\n").map((paragraph, i) => (
                    <p key={i} className={paragraph === paragraph.toUpperCase() && paragraph.length > 5 ? "font-semibold tracking-wide text-center text-gray-900" : ""}>
                      {paragraph}
                    </p>
                  ))}
                </div>
              );
            })()}
          </>
        )}

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
              <ServiceBrowser
                appointmentTypes={appointmentTypes}
                kindCategories={kindCategories}
                selectedType={selectedType}
                categoryPath={selectedCategoryPath}
                onCategoryPathChange={setSelectedCategoryPath}
                onSelectType={handleTypeSelect}
              />
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
                    {eligiblePiercers.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedType && eligiblePiercers.length === 0 && (
                  <p className="text-sm text-amber-700">
                    No piercers are available for this service. Go back and choose a different service.
                  </p>
                )}
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
                          {formatTime12h(slot.time)}
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
              <div className="bg-indigo-50 rounded-lg p-4 space-y-3 text-sm">
                {selectedType?.image_url && (
                  <AppointmentTypeImage
                    imageUrl={selectedType.image_url}
                    alt={selectedType.name}
                    className="h-20 w-20 rounded-lg object-cover"
                  />
                )}
                <div className="space-y-1">
                  <p><span className="font-medium">Service:</span> {selectedType?.name}</p>
                  <p><span className="font-medium">Piercer:</span> {selectedArtist === '__any__' ? 'Any Available Piercer' : eligiblePiercers.find(a => a.id === selectedArtist)?.full_name || piercers.find(a => a.id === selectedArtist)?.full_name}</p>
                  <p><span className="font-medium">Location:</span> {locations.find(l => l.id === selectedLocation)?.name}</p>
                  <p><span className="font-medium">Date:</span> {selectedDate} at {formatTime12h(selectedTime)}</p>
                  <p><span className="font-medium">Duration:</span> {formatDuration(selectedType?.default_duration_minutes)}</p>
                  {selectedType?.service_cost > 0 && (
                    <p><span className="font-medium">Service Cost:</span> ${selectedType.service_cost}
                      {selectedType.price_includes_tax ? <span className="text-gray-600"> (includes tax)</span> : null}
                    </p>
                  )}
                  {selectedType?.default_deposit > 0 && (
                    <p><span className="font-medium">Deposit Due Now:</span> ${selectedType.default_deposit}</p>
                  )}
                </div>
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
