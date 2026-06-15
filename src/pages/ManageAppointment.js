import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calendar, Clock, MapPin, User, AlertCircle, Loader2, Check, X } from "lucide-react";
import { supabase } from "@/utils/supabase";
import { formatTimeRange12h } from "@/utils";

export default function ManageAppointment() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

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
    if (!newDate || !newTime) {
      setActionResult({ type: "error", message: "Please select a new date and time." });
      return;
    }

    setActionLoading(true);
    setActionResult(null);
    try {
      const { data: result, error: fnErr } = await supabase.functions.invoke(
        "reschedule-public-appointment",
        { body: { token, newDate, newStartTime: newTime } }
      );
      if (fnErr || result?.error) {
        setActionResult({ type: "error", message: result?.error || fnErr?.message || "Failed to reschedule" });
      } else {
        setActionResult({ type: "success", message: "Your appointment has been rescheduled. You will receive an updated confirmation email." });
        setShowReschedule(false);
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

  const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

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

  const apt = data?.appointment;
  const studio = data?.studio;
  const location = data?.location;
  const artist = data?.artist;
  const aptType = data?.appointment_type;

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
                  {aptType.duration_minutes && (
                    <p className="text-xs text-gray-500">{aptType.duration_minutes} minutes</p>
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

        {data?.can_modify && (
          <Card className="bg-white shadow-lg border-none">
            <CardContent className="p-6 space-y-4">
              {!showReschedule && !confirmCancel && (
                <div className="flex gap-3">
                  <Button
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                    onClick={() => setShowReschedule(true)}
                    disabled={actionLoading}
                  >
                    Reschedule
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 border-red-200 text-red-700 hover:bg-red-50"
                    onClick={() => setConfirmCancel(true)}
                    disabled={actionLoading}
                  >
                    Cancel Appointment
                  </Button>
                </div>
              )}

              {confirmCancel && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-700">Are you sure you want to cancel this appointment?</p>
                  <div className="flex gap-3">
                    <Button
                      className="flex-1 bg-red-600 hover:bg-red-700"
                      onClick={handleCancel}
                      disabled={actionLoading}
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <X className="w-4 h-4 mr-2" />}
                      Yes, Cancel
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
                  <div>
                    <Label className="text-sm font-semibold text-gray-700">New Date</Label>
                    <Input
                      type="date"
                      value={newDate}
                      min={tomorrow}
                      onChange={(e) => setNewDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-semibold text-gray-700">New Start Time</Label>
                    <Input
                      type="time"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-3">
                    <Button
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                      onClick={handleReschedule}
                      disabled={actionLoading || !newDate || !newTime}
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                      Confirm Reschedule
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setShowReschedule(false)}
                      disabled={actionLoading}
                    >
                      Cancel
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Note: Rescheduling is subject to artist availability. If the selected time conflicts with
                    an existing booking, you will need to choose a different time.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!data?.can_modify && data?.modify_reason && (
          <div className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
            {data.modify_reason}
          </div>
        )}
      </div>
    </div>
  );
}
