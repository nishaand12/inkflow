import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calendar, Clock, MapPin, User, AlertCircle, AlertTriangle, Loader2, Check, X, ArrowLeft, RefreshCw } from "lucide-react";
import { supabase } from "@/utils/supabase";
import { formatTimeRange12h, formatTime12h, formatDuration, addMinutesToTime } from "@/utils";
import { isPublicPiercingBookableArtistType } from "@/utils/artistTypes";
import {
  buildExclusionKeySet,
  filterArtistsForAppointmentType,
} from "@/utils/artistServiceEligibility";
import { computeArtistSlots, computeAnyArtistSlots } from "@/utils/bookingSlots";
import ServiceBrowser from "@/components/public-booking/ServiceBrowser";
import { format, addDays } from "date-fns";

const ANY_ARTIST = "__any__";

export default function ManageAppointment() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Reschedule wizard state
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleStep, setRescheduleStep] = useState("details"); // "service" | "details"
  const [bookingData, setBookingData] = useState(null);
  const [bookingDataLoading, setBookingDataLoading] = useState(false);
  const [selectedType, setSelectedType] = useState(null);
  const [categoryPath, setCategoryPath] = useState([]);
  const [selectedArtist, setSelectedArtist] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");

  useEffect(() => {
    if (token) loadAppointment();
    else {
      setError("No appointment token provided.");
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadAppointment = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: result, error: fnErr } = await supabase.functions.invoke(
        "get-appointment-by-token",
        { body: { token } }
      );
      if (fnErr || result?.error) {
        setError(result?.error || fnErr?.message || "Failed to load appointment");
      } else {
        setData(result);
      }
    } catch (err) {
      setError(err.message || "Failed to load appointment");
    } finally {
      setLoading(false);
    }
  };

  const loadBookingData = async (studioId) => {
    if (!studioId || bookingData) return;
    setBookingDataLoading(true);
    try {
      const { data: result, error: rpcErr } = await supabase.rpc("get_public_booking_data", {
        p_studio_id: studioId,
      });
      if (rpcErr || !result) throw rpcErr || new Error("Unable to load availability");
      setBookingData({
        appointmentTypes: result.appointment_types || [],
        artists: result.artists || [],
        locations: (result.locations || []).filter((l) => l.is_active),
        availabilities: result.availabilities || [],
        weeklySchedules: result.weekly_schedules || [],
        appointments: result.appointments || [],
        workStations: result.workstations || [],
        kindCategories: result.appointment_kind_categories || [],
        serviceExclusions: result.artist_appointment_type_exclusions || [],
      });
    } catch (err) {
      setActionResult({
        type: "error",
        message: "Unable to load availability for rescheduling. Please try again later.",
      });
    } finally {
      setBookingDataLoading(false);
    }
  };

  const apt = data?.appointment;
  const studio = data?.studio;
  const location = data?.location;
  const artist = data?.artist;
  const aptType = data?.appointment_type;

  const exclusionKeys = useMemo(
    () => buildExclusionKeySet(bookingData?.serviceExclusions || []),
    [bookingData]
  );

  const piercers = useMemo(
    () => (bookingData?.artists || []).filter((a) => isPublicPiercingBookableArtistType(a.artist_type)),
    [bookingData]
  );

  const eligiblePiercers = useMemo(() => {
    if (!selectedType?.id) return piercers;
    return filterArtistsForAppointmentType(piercers, selectedType.id, exclusionKeys, {
      alwaysIncludeArtistId: apt?.artist_id || null,
    });
  }, [piercers, selectedType, exclusionKeys, apt]);

  const durationMinutes = selectedType?.default_duration_minutes || 60;

  const availableSlots = useMemo(() => {
    if (!bookingData || !selectedType || !selectedLocation || !selectedDate) return [];
    const common = {
      date: selectedDate,
      durationMinutes,
      locationId: selectedLocation,
      availabilities: bookingData.availabilities,
      weeklySchedules: bookingData.weeklySchedules,
      appointments: bookingData.appointments,
      workStations: bookingData.workStations,
      excludeAppointmentId: apt?.id || null,
    };
    if (selectedArtist === ANY_ARTIST) {
      return computeAnyArtistSlots({ artistIds: eligiblePiercers.map((p) => p.id), ...common });
    }
    if (!selectedArtist) return [];
    return computeArtistSlots({ artistId: selectedArtist, ...common });
  }, [bookingData, selectedType, selectedArtist, selectedLocation, selectedDate, durationMinutes, eligiblePiercers, apt]);

  const startReschedule = async () => {
    setActionResult(null);
    setShowReschedule(true);
    setRescheduleStep("details");
    setConfirmCancel(false);
    if (studio?.id) {
      await loadBookingData(studio.id);
    }
  };

  // Once availability data is loaded, preselect the appointment's current
  // service, artist, and location.
  useEffect(() => {
    if (!showReschedule || !bookingData || !apt) return;
    if (!selectedType) {
      const currentType =
        bookingData.appointmentTypes.find((t) => t.id === apt.appointment_type_id) || aptType || null;
      setSelectedType(currentType);
    }
    if (!selectedArtist && apt.artist_id) setSelectedArtist(apt.artist_id);
    if (!selectedLocation && apt.location_id) setSelectedLocation(apt.location_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReschedule, bookingData, apt]);

  const resetRescheduleSelections = () => {
    setSelectedDate("");
    setSelectedTime("");
  };

  const closeReschedule = () => {
    setShowReschedule(false);
    setRescheduleStep("details");
    setSelectedDate("");
    setSelectedTime("");
    setCategoryPath([]);
  };

  const handleSelectNewType = (type) => {
    setSelectedType(type);
    setRescheduleStep("details");
    resetRescheduleSelections();
    setActionResult(null);
  };

  const handleCancel = async () => {
    setActionLoading(true);
    setActionResult(null);
    try {
      const { data: result, error: fnErr } = await supabase.functions.invoke(
        "cancel-public-appointment",
        { body: { token } }
      );
      if (fnErr || result?.error) {
        setActionResult({ type: "error", message: result?.error || fnErr?.message || "Failed to cancel" });
      } else {
        setActionResult({ type: "success", message: "Your appointment has been cancelled. You will receive a confirmation email." });
        loadAppointment();
      }
    } catch (err) {
      setActionResult({ type: "error", message: err.message || "Failed to cancel" });
    } finally {
      setActionLoading(false);
      setConfirmCancel(false);
    }
  };

  const handleReschedule = async () => {
    if (!selectedType || !selectedLocation || !selectedDate || !selectedTime) {
      setActionResult({ type: "error", message: "Please choose an artist, date, and available time." });
      return;
    }

    const slot = availableSlots.find((s) => s.time === selectedTime);
    const resolvedArtistId = selectedArtist === ANY_ARTIST ? slot?.artistId : selectedArtist;
    if (!resolvedArtistId) {
      setActionResult({ type: "error", message: "Please select an available time." });
      return;
    }

    setActionLoading(true);
    setActionResult(null);
    try {
      const { data: result, error: fnErr } = await supabase.functions.invoke(
        "reschedule-public-appointment",
        {
          body: {
            token,
            newDate: selectedDate,
            newStartTime: selectedTime,
            newEndTime: addMinutesToTime(selectedTime, durationMinutes),
            newArtistId: resolvedArtistId,
            newAppointmentTypeId: selectedType.id,
            newLocationId: selectedLocation,
            newWorkStationId: slot?.stationId || null,
          },
        }
      );
      if (fnErr || result?.error) {
        setActionResult({ type: "error", message: result?.error || fnErr?.message || "Failed to reschedule" });
      } else {
        setActionResult({ type: "success", message: "Your appointment has been rescheduled. You will receive an updated confirmation email." });
        closeReschedule();
        // Reset cached availability so a subsequent reschedule reflects the change.
        setBookingData(null);
        setSelectedType(null);
        setSelectedArtist("");
        setSelectedLocation("");
        loadAppointment();
      }
    } catch (err) {
      setActionResult({ type: "error", message: err.message || "Failed to reschedule" });
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      scheduled: "bg-blue-100 text-blue-800",
      confirmed: "bg-green-100 text-green-800",
      deposit_paid: "bg-emerald-100 text-emerald-800",
      completed: "bg-gray-100 text-gray-800",
      cancelled: "bg-red-100 text-red-800",
    };
    const labels = {
      scheduled: "Scheduled",
      confirmed: "Confirmed",
      deposit_paid: "Deposit Paid",
      completed: "Completed",
      cancelled: "Cancelled",
    };
    return <Badge className={styles[status] || "bg-gray-100 text-gray-800"}>{labels[status] || status}</Badge>;
  };

  const minDate = format(addDays(new Date(), 1), "yyyy-MM-dd");

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-gray-600">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Loading your appointment...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-white shadow-lg border-none">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Unable to Load Appointment</h2>
            <p className="text-gray-500">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canReschedule = data?.can_reschedule;
  const canCancel = data?.can_modify;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 p-4 sm:p-6">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">{studio?.name || "Studio"}</h1>
          <p className="text-gray-600 mt-1">Manage your appointment</p>
        </div>

        <Card className="bg-white shadow-lg border-none">
          <CardHeader className="border-b border-gray-100">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg text-gray-900">Appointment Details</CardTitle>
              {getStatusBadge(apt?.status)}
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-indigo-600 flex-shrink-0" />
              <div>
                <p className="text-sm text-gray-500">Date & Time</p>
                <p className="font-medium text-gray-900">
                  {apt?.date} at {formatTimeRange12h(apt?.start_time, apt?.end_time)}
                </p>
              </div>
            </div>

            {location && (
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                <div>
                  <p className="text-sm text-gray-500">Location</p>
                  <p className="font-medium text-gray-900">{location.name}</p>
                  {location.address && <p className="text-xs text-gray-500">{location.address}</p>}
                </div>
              </div>
            )}

            {artist && (
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                <div>
                  <p className="text-sm text-gray-500">Artist</p>
                  <p className="font-medium text-gray-900">{artist.full_name}</p>
                </div>
              </div>
            )}

            {aptType && (
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                <div>
                  <p className="text-sm text-gray-500">Service</p>
                  <p className="font-medium text-gray-900">{aptType.name}</p>
                  {aptType.default_duration_minutes && (
                    <p className="text-xs text-gray-500">{formatDuration(aptType.default_duration_minutes)}</p>
                  )}
                </div>
              </div>
            )}

            {apt?.deposit_amount > 0 && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <span className="text-gray-500">Deposit: </span>
                <span className="font-medium text-gray-900">
                  ${Number(apt.deposit_amount).toFixed(2)}
                </span>
                {apt.deposit_status && (
                  <Badge className="ml-2 bg-emerald-100 text-emerald-700 text-xs">{apt.deposit_status}</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {actionResult && (
          <Alert className={actionResult.type === "success" ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
            {actionResult.type === "success" ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-600" />
            )}
            <AlertDescription className={actionResult.type === "success" ? "text-green-800" : "text-red-800"}>
              {actionResult.message}
            </AlertDescription>
          </Alert>
        )}

        {(canReschedule || canCancel) && (
          <Card className="bg-white shadow-lg border-none">
            <CardContent className="p-6 space-y-4">
              {!showReschedule && !confirmCancel && (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    {canReschedule && (
                      <Button
                        className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                        onClick={startReschedule}
                        disabled={actionLoading}
                      >
                        Reschedule
                      </Button>
                    )}
                    {canCancel && (
                      <Button
                        variant="outline"
                        className="flex-1 border-red-200 text-red-700 hover:bg-red-50"
                        onClick={() => setConfirmCancel(true)}
                        disabled={actionLoading}
                      >
                        Cancel Appointment
                      </Button>
                    )}
                  </div>
                  {canCancel && (
                    <p className="text-xs text-amber-700 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      Cancelling your appointment will forfeit your ${apt?.deposit_amount > 0 ? Number(apt.deposit_amount).toFixed(2) : "deposit"} deposit. Rescheduling keeps your deposit.
                    </p>
                  )}
                </div>
              )}

              {confirmCancel && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" /> Your deposit will be forfeited
                    </p>
                    <p className="text-sm text-amber-800 mt-1">
                      Cancelling this appointment is permanent and your
                      {apt?.deposit_amount > 0 ? ` $${Number(apt.deposit_amount).toFixed(2)}` : ""} deposit will not be
                      refunded. If you just need a different time, reschedule instead to keep your deposit.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      className="flex-1 bg-red-600 hover:bg-red-700"
                      onClick={handleCancel}
                      disabled={actionLoading}
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <X className="w-4 h-4 mr-2" />}
                      Yes, Cancel & Forfeit Deposit
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setConfirmCancel(false)}
                      disabled={actionLoading}
                    >
                      Go Back
                    </Button>
                  </div>
                </div>
              )}

              {showReschedule && (
                <div className="space-y-4">
                  {bookingDataLoading && !bookingData ? (
                    <div className="flex items-center justify-center gap-2 text-gray-500 py-8">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Loading availability...
                    </div>
                  ) : rescheduleStep === "service" ? (
                    <div className="space-y-3">
                      <Button variant="outline" size="sm" onClick={() => setRescheduleStep("details")}>
                        <ArrowLeft className="w-4 h-4 mr-2" /> Back
                      </Button>
                      <p className="text-sm text-gray-600">
                        Choose a new service. Your ${apt?.deposit_amount > 0 ? Number(apt.deposit_amount).toFixed(2) : ""} deposit
                        already paid will carry over.
                      </p>
                      <ServiceBrowser
                        appointmentTypes={bookingData?.appointmentTypes || []}
                        kindCategories={bookingData?.kindCategories || []}
                        selectedType={selectedType}
                        categoryPath={categoryPath}
                        onCategoryPathChange={setCategoryPath}
                        onSelectType={handleSelectNewType}
                      />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3 rounded-lg bg-indigo-50 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-xs uppercase tracking-wide text-indigo-500">Service</p>
                          <p className="font-medium text-gray-900 truncate">
                            {selectedType?.name || "—"}
                            {selectedType?.default_duration_minutes
                              ? ` · ${formatDuration(selectedType.default_duration_minutes)}`
                              : ""}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-shrink-0"
                          onClick={() => { setRescheduleStep("service"); setCategoryPath([]); }}
                        >
                          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Change
                        </Button>
                      </div>

                      {(bookingData?.locations || []).length > 1 && (
                        <div className="space-y-2">
                          <Label>Location</Label>
                          <Select
                            value={selectedLocation}
                            onValueChange={(v) => { setSelectedLocation(v); resetRescheduleSelections(); }}
                          >
                            <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                            <SelectContent>
                              {bookingData.locations.map((l) => (
                                <SelectItem key={l.id} value={l.id}>{l.name}{l.address ? ` - ${l.address}` : ""}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label>Artist</Label>
                        <Select
                          value={selectedArtist}
                          onValueChange={(v) => { setSelectedArtist(v); resetRescheduleSelections(); }}
                        >
                          <SelectTrigger><SelectValue placeholder="Select artist" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ANY_ARTIST}>Any Available Artist</SelectItem>
                            {eligiblePiercers.map((a) => (
                              <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>New Date</Label>
                        <Input
                          type="date"
                          value={selectedDate}
                          min={minDate}
                          onChange={(e) => { setSelectedDate(e.target.value); setSelectedTime(""); }}
                        />
                      </div>

                      {selectedDate && (
                        <div className="space-y-2">
                          <Label>Available Times</Label>
                          {availableSlots.length === 0 ? (
                            <p className="text-sm text-gray-500 py-3 text-center">
                              No available times on this date. Please try another date or artist.
                            </p>
                          ) : (
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                              {availableSlots.map((slot) => (
                                <button
                                  key={slot.time}
                                  onClick={() => setSelectedTime(slot.time)}
                                  className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                                    selectedTime === slot.time
                                      ? "bg-indigo-600 text-white"
                                      : "bg-gray-100 text-gray-700 hover:bg-indigo-100"
                                  }`}
                                >
                                  {formatTime12h(slot.time)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex gap-3 pt-2">
                        <Button
                          className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                          onClick={handleReschedule}
                          disabled={actionLoading || !selectedTime}
                        >
                          {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                          Confirm Reschedule
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={closeReschedule}
                          disabled={actionLoading}
                        >
                          Cancel
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500">
                        Times shown reflect your artist's real availability. Rescheduling must be at least 24 hours
                        before your current appointment.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!canReschedule && data?.reschedule_reason && canCancel && (
          <div className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
            {data.reschedule_reason}
          </div>
        )}

        {!canCancel && data?.modify_reason && (
          <div className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
            {data.modify_reason}
          </div>
        )}
      </div>
    </div>
  );
}
