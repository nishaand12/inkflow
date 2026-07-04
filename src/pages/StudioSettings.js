import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Key, Copy, Check, BookOpen, MapPin, Wrench, ClipboardList, Palette, UserPlus, BarChart3, Bell, ChevronDown, ChevronUp, CreditCard, ExternalLink, AlertCircle, Loader2, Layers, CalendarDays, CalendarClock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/utils/supabase";
import { normalizeUserRole } from "@/utils/roles";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CALENDAR_HOUR_OPTIONS, formatHourLabel } from "@/utils/calendarGrid";

export default function StudioSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [user, setUser] = useState(null);
  const [studio, setStudio] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copiedBookingLink, setCopiedBookingLink] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const [stripeStatus, setStripeStatus] = useState({
    connected: false,
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    loading: true
  });
  const [stripeConnecting, setStripeConnecting] = useState(false);
  const [stripeMessage, setStripeMessage] = useState(null);

  const [calendarStartHour, setCalendarStartHour] = useState(0);
  const [calendarEndHour, setCalendarEndHour] = useState(24);
  const [calendarHoursSaving, setCalendarHoursSaving] = useState(false);
  const [calendarHoursSaved, setCalendarHoursSaved] = useState(false);
  const [calendarHoursError, setCalendarHoursError] = useState(null);

  useEffect(() => {
    loadUserAndStudio();
    if (searchParams.get('showGuide') === 'true') {
      setShowGuide(true);
      setSearchParams({});
    }
    const stripeParam = searchParams.get('stripe');
    if (stripeParam === 'complete') {
      setStripeMessage({ type: 'success', text: 'Stripe account connected! Checking status...' });
      setSearchParams({});
    } else if (stripeParam === 'refresh') {
      setStripeMessage({ type: 'warning', text: 'Stripe onboarding was not completed. Please try again.' });
      setSearchParams({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUserAndStudio = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      if (currentUser.studio_id) {
        const studios = await base44.entities.Studio.filter({ id: currentUser.studio_id });
        if (studios.length > 0) {
          const loadedStudio = studios[0];
          setStudio(loadedStudio);
          setCalendarStartHour(loadedStudio.calendar_view_start_hour ?? 0);
          setCalendarEndHour(loadedStudio.calendar_view_end_hour ?? 24);
          loadStripeStatus(loadedStudio.id);
        }
      }
    } catch (error) {
      console.error("Error loading studio:", error);
    }
  };

  const loadStripeStatus = async (studioId) => {
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect-status", {
        body: { studioId }
      });
      if (!error && data) {
        setStripeStatus({ ...data, loading: false });
      } else {
        setStripeStatus(prev => ({ ...prev, loading: false }));
      }
    } catch (err) {
      console.error("Error loading Stripe status:", err);
      setStripeStatus(prev => ({ ...prev, loading: false }));
    }
  };

  const handleConnectStripe = async () => {
    if (!studio) return;
    setStripeConnecting(true);
    setStripeMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect-onboard", {
        body: { studioId: studio.id }
      });
      if (error || data?.error) {
        setStripeMessage({ type: 'error', text: data?.error || 'Failed to start Stripe onboarding.' });
        setStripeConnecting(false);
        return;
      }
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setStripeMessage({ type: 'error', text: 'Failed to connect to Stripe. Please try again.' });
      setStripeConnecting(false);
    }
  };

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === 'admin' ? 'Admin' : 'Front_Desk'));
  };

  const userRole = getUserRole();
  const isOwnerOrAdmin = userRole === 'Owner' || userRole === 'Admin';

  const handleCopyInviteCode = () => {
    if (studio?.invite_code) {
      navigator.clipboard.writeText(studio.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getBookingUrl = () =>
    studio?.id ? `${window.location.origin}/book?studio=${studio.id}` : '';

  const handleCopyBookingLink = () => {
    const url = getBookingUrl();
    if (url) {
      navigator.clipboard.writeText(url);
      setCopiedBookingLink(true);
      setTimeout(() => setCopiedBookingLink(false), 2000);
    }
  };

  const calendarHourOptions = CALENDAR_HOUR_OPTIONS.filter((o) => o.value <= 23);
  const calendarEndHourOptions = CALENDAR_HOUR_OPTIONS.filter((o) => o.value >= 1);

  const handleSaveCalendarHours = async () => {
    if (!studio) return;
    if (calendarEndHour <= calendarStartHour) {
      setCalendarHoursError("End hour must be after start hour.");
      return;
    }
    setCalendarHoursSaving(true);
    setCalendarHoursError(null);
    try {
      const updated = await base44.entities.Studio.update(studio.id, {
        calendar_view_start_hour: calendarStartHour,
        calendar_view_end_hour: calendarEndHour,
      });
      setStudio(updated);
      setCalendarHoursSaved(true);
      setTimeout(() => setCalendarHoursSaved(false), 2000);
    } catch (error) {
      console.error("Error saving calendar hours:", error);
      setCalendarHoursError("Could not save calendar hours. Please try again.");
    } finally {
      setCalendarHoursSaving(false);
    }
  };

  if (!isOwnerOrAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">
                Only Owners and Admins can access studio settings.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Studio Settings</h1>
          <p className="text-gray-500 mt-1">Manage your studio configuration</p>
        </div>

        {studio && (
          <>
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                    <Building2 className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl">{studio.name}</CardTitle>
                    <p className="text-sm text-gray-500">{studio.hq_location}</p>
                  </div>
                  <Badge className={studio.is_active ? 'bg-green-100 text-green-800 ml-auto' : 'bg-amber-100 text-amber-800 ml-auto'}>
                    {studio.is_active ? 'Active' : 'Pending Validation'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Phone</label>
                    <p className="text-gray-900 mt-1">{studio.phone || 'Not set'}</p>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Currency</label>
                    <p className="text-gray-900 mt-1">{studio.currency}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-indigo-50 to-purple-50 border-none shadow-lg">
              <CardHeader className="border-b border-indigo-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center">
                    <Key className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl text-gray-900">Studio Invite Code</CardTitle>
                    <p className="text-sm text-gray-600">Share this code to invite team members</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="bg-white border-2 border-indigo-200 rounded-xl p-4 text-center">
                      <div className="text-3xl font-bold text-indigo-600 tracking-wider font-mono">
                        {studio.invite_code}
                      </div>
                    </div>
                  </div>
                  <Button
                    onClick={handleCopyInviteCode}
                    className="bg-indigo-600 hover:bg-indigo-700"
                    size="lg"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy Code
                      </>
                    )}
                  </Button>
                </div>

                <div className="mt-6 bg-white/70 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-2">How to invite team members:</h4>
                  <ol className="text-sm text-gray-600 space-y-1 ml-4 list-decimal">
                    <li>Share this invite code with your team member</li>
                    <li>They sign up for InkFlow using their email</li>
                    <li>During onboarding, they select "Join Existing Studio"</li>
                    <li>They enter this invite code to join your studio</li>
                    <li>Set their role by contacting ceteasystems@gmail.com</li>
                  </ol>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                    <ExternalLink className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <CardTitle className="text-xl text-gray-900">Online Booking Link</CardTitle>
                    <p className="text-sm text-gray-600">Share this link so clients can book appointments online</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-white border-2 border-green-200 rounded-xl px-4 py-3 font-mono text-sm text-gray-700 truncate">
                    {getBookingUrl()}
                  </div>
                  <Button
                    onClick={handleCopyBookingLink}
                    className="bg-green-600 hover:bg-green-700 shrink-0"
                    size="lg"
                  >
                    {copiedBookingLink ? (
                      <><Check className="w-4 h-4 mr-2" />Copied!</>
                    ) : (
                      <><Copy className="w-4 h-4 mr-2" />Copy Link</>
                    )}
                  </Button>
                </div>
                <div className="mt-4 bg-white/70 rounded-lg p-4 text-sm text-gray-600">
                  Share this link on your website or social media. Clients can browse your services and book directly without creating an account.
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-sky-100 rounded-xl flex items-center justify-center">
                    <CalendarClock className="w-6 h-6 text-sky-600" />
                  </div>
                  <div>
                    <CardTitle className="text-xl text-gray-900">Calendar View Hours</CardTitle>
                    <p className="text-sm text-gray-600">
                      Set the time range shown on the internal calendar for your studio
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700">Start hour</label>
                    <Select
                      value={String(calendarStartHour)}
                      onValueChange={(v) => setCalendarStartHour(parseInt(v, 10))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {calendarHourOptions.map((o) => (
                          <SelectItem key={o.value} value={String(o.value)}>
                            {formatHourLabel(o.value)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700">End hour</label>
                    <Select
                      value={String(calendarEndHour)}
                      onValueChange={(v) => setCalendarEndHour(parseInt(v, 10))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {calendarEndHourOptions.map((o) => (
                          <SelectItem key={o.value} value={String(o.value)}>
                            {o.value === 24 ? "12 AM (midnight)" : formatHourLabel(o.value)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <p className="text-sm text-gray-600">
                  Preview: {formatHourLabel(calendarStartHour)} –{" "}
                  {calendarEndHour === 24 ? "12 AM (midnight)" : formatHourLabel(calendarEndHour)}
                </p>

                {calendarHoursError && (
                  <Alert className="border-red-200 bg-red-50">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <AlertDescription className="text-red-800">{calendarHoursError}</AlertDescription>
                  </Alert>
                )}

                <Button
                  onClick={handleSaveCalendarHours}
                  disabled={calendarHoursSaving}
                  className="bg-sky-600 hover:bg-sky-700"
                >
                  {calendarHoursSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : calendarHoursSaved ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Saved!
                    </>
                  ) : (
                    "Save Calendar Hours"
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Stripe Connect */}
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                    <CreditCard className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <CardTitle className="text-xl text-gray-900">Online Payments</CardTitle>
                    <p className="text-sm text-gray-600">Connect Stripe to collect deposits online</p>
                  </div>
                  {stripeStatus.connected && stripeStatus.charges_enabled && (
                    <Badge className="ml-auto bg-green-100 text-green-800">Connected</Badge>
                  )}
                  {stripeStatus.connected && !stripeStatus.charges_enabled && (
                    <Badge className="ml-auto bg-amber-100 text-amber-800">Setup Incomplete</Badge>
                  )}
                  {!stripeStatus.connected && !stripeStatus.loading && (
                    <Badge className="ml-auto bg-gray-100 text-gray-600">Not Connected</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {stripeMessage && (
                  <Alert className={
                    stripeMessage.type === 'success' ? 'border-green-200 bg-green-50' :
                    stripeMessage.type === 'warning' ? 'border-amber-200 bg-amber-50' :
                    'border-red-200 bg-red-50'
                  }>
                    <AlertCircle className={`h-4 w-4 ${
                      stripeMessage.type === 'success' ? 'text-green-600' :
                      stripeMessage.type === 'warning' ? 'text-amber-600' :
                      'text-red-600'
                    }`} />
                    <AlertDescription className={
                      stripeMessage.type === 'success' ? 'text-green-800' :
                      stripeMessage.type === 'warning' ? 'text-amber-800' :
                      'text-red-800'
                    }>
                      {stripeMessage.text}
                    </AlertDescription>
                  </Alert>
                )}

                {stripeStatus.loading ? (
                  <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Checking Stripe connection...</span>
                  </div>
                ) : stripeStatus.connected && stripeStatus.charges_enabled ? (
                  <div className="space-y-4">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Check className="w-5 h-5 text-green-600" />
                        <span className="font-semibold text-green-800">Stripe is connected and ready</span>
                      </div>
                      <p className="text-sm text-green-700">
                        Your studio can now collect deposits online. When you create an appointment with a deposit amount,
                        a payment link will be included in the confirmation email sent to the customer.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <span className="text-gray-500">Charges</span>
                        <p className="font-medium text-green-700">Enabled</p>
                      </div>
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <span className="text-gray-500">Payouts</span>
                        <p className={`font-medium ${stripeStatus.payouts_enabled ? 'text-green-700' : 'text-amber-700'}`}>
                          {stripeStatus.payouts_enabled ? 'Enabled' : 'Pending'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <a
                        href="https://dashboard.stripe.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-purple-600 hover:text-purple-800 font-medium"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Open Stripe Dashboard
                      </a>
                    </div>
                  </div>
                ) : stripeStatus.connected && !stripeStatus.charges_enabled ? (
                  <div className="space-y-4">
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <p className="text-sm text-amber-800">
                        Your Stripe account is connected but onboarding is not complete.
                        Please finish setting up your Stripe account to start accepting payments.
                      </p>
                    </div>
                    <Button
                      onClick={handleConnectStripe}
                      disabled={stripeConnecting}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      {stripeConnecting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Redirecting...
                        </>
                      ) : (
                        <>
                          <CreditCard className="w-4 h-4 mr-2" />
                          Continue Stripe Setup
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                      Connect your Stripe account to collect deposits from customers online before their appointment.
                      Customers will receive a secure payment link in their confirmation email.
                    </p>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="font-semibold text-gray-900 mb-2">How it works:</h4>
                      <ol className="text-sm text-gray-600 space-y-1 ml-4 list-decimal">
                        <li>Connect your Stripe account (or create one for free)</li>
                        <li>Set deposit amounts on your appointment types</li>
                        <li>When appointments are created, customers receive a payment link via email</li>
                        <li>Deposits go directly to your Stripe account</li>
                        <li>You manage refunds and transactions in your own Stripe Dashboard</li>
                      </ol>
                    </div>
                    <Button
                      onClick={handleConnectStripe}
                      disabled={stripeConnecting}
                      className="bg-purple-600 hover:bg-purple-700"
                      size="lg"
                    >
                      {stripeConnecting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Redirecting to Stripe...
                        </>
                      ) : (
                        <>
                          <CreditCard className="w-4 h-4 mr-2" />
                          Connect with Stripe
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {!studio.is_active && (
              <Card className="bg-amber-50 border-2 border-amber-200 shadow-lg">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-amber-900 mb-2">Studio Activation Pending</h3>
                      <p className="text-sm text-amber-800 mb-3">
                        Your studio is awaiting validation. Once approved, you'll have full access to all features.
                      </p>
                      <p className="text-sm text-amber-700">
                        Contact{' '}
                        <a href="mailto:ceteasystems@gmail.com" className="font-semibold underline">
                          ceteasystems@gmail.com
                        </a>
                        {' '}for assistance.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Getting Started Guide */}
            <Card className="bg-white border-none shadow-lg">
              <CardHeader 
                className="border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setShowGuide(!showGuide)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                    <BookOpen className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-xl text-gray-900">Getting Started Guide</CardTitle>
                    <p className="text-sm text-gray-600">From first login to live bookings—the order that keeps scheduling and deposits reliable</p>
                  </div>
                  <Button variant="ghost" size="icon" className="ml-auto">
                    {showGuide ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </Button>
                </div>
              </CardHeader>
              
              {showGuide && (
                <CardContent className="p-6 space-y-6">
                  <p className="text-sm text-gray-600">
                    Follow this order on day one so internal scheduling and the public booking page both work smoothly. Estimated time is realistic if Stripe and reminders are tackled after your first successful test booking.
                  </p>

                  <div>
                    <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <span className="w-6 h-6 bg-indigo-600 text-white rounded-full text-xs flex items-center justify-center">1</span>
                      Account and studio readiness
                    </h3>
                    <ul className="text-sm text-gray-600 ml-8 list-disc space-y-2">
                      <li>Finish sign-up, confirm your email, and complete onboarding (create or join a studio).</li>
                      <li>Public booking loads only when the studio is{' '}
                        <strong className="font-medium text-gray-800">approved and active</strong>. If your banner shows Pending Validation, reach out via the contact shown on this page before sharing your booking link.</li>
                      <li>Share your <strong className="font-medium text-gray-800">invite code</strong> (above) so artists and front desk can join; then add their roles as needed with support.</li>
                    </ul>
                  </div>

                  <div className="border-t border-gray-200 pt-6">
                    <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <span className="w-6 h-6 bg-indigo-600 text-white rounded-full text-xs flex items-center justify-center">2</span>
                      Foundations: locations through services
                    </h3>
                    <p className="text-sm text-gray-600 mb-4 ml-8">
                      Build records in roughly this sequence so dropdowns stay consistent everywhere (calendar, internal booking, and public portal).
                    </p>
                    <div className="space-y-3 ml-8">
                      <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <MapPin className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">Locations</p>
                          <p className="text-sm text-gray-600">Add each site with address, contact details, and timezone. These power location pickers for staff and clients.</p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Wrench className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">Work stations</p>
                          <p className="text-sm text-gray-600">Create active stations per location. The system uses them to avoid double-booking the same chair or room when slots overlap.</p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Layers className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">Categories</p>
                          <p className="text-sm text-gray-600">
                            Set reporting categories to ensure reports and settlements are structured the
                            way you want, and create a booking hierarchy so that your appointment types are
                            clearly organized. Public booking and the appointment-type editor only use
                            services placed on leaf nodes you create.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <ClipboardList className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">Appointment types</p>
                          <p className="text-sm text-gray-600">
                            Each type needs a <strong className="font-medium text-gray-800">name</strong>,{" "}
                            <strong className="font-medium text-gray-800">booking hierarchy classification</strong>
                            (a leaf under your hierarchy), <strong className="font-medium text-gray-800">duration</strong>,{" "}
                            optional price and deposit, and a customer-facing{" "}
                            <strong className="font-medium text-gray-800">description</strong>. Toggle{" "}
                            <strong className="font-medium text-gray-800">Allow online booking</strong> only for
                            offerings that should appear on your public link. Optionally link a reporting
                            category for revenue rollups.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-gray-200 pt-6">
                    <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <span className="w-6 h-6 bg-indigo-600 text-white rounded-full text-xs flex items-center justify-center">3</span>
                      People, availability, and customers
                    </h3>
                    <div className="space-y-3 ml-8">
                      <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Palette className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">Artists</p>
                          <p className="text-sm text-gray-600">
                            Once users exist in your studio, add artist profiles linked to those users: set{' '}
                            <strong className="font-medium text-gray-800">artist type</strong> (tattoo, piercer, counter, scrub), primary location, and keep them active. Public online booking lists active piercers for artist selection; counter and scrub are for internal staffing and calendars only.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <CalendarDays className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">Availability</p>
                          <p className="text-sm text-gray-600">
                            Each bookable artist needs a recurring weekly schedule (and optional one-off gaps or blocked time under <strong className="font-medium text-gray-800">Availability</strong> / <strong className="font-medium text-gray-800">My Availability</strong>). Slots on the public page are computed from availability, existing bookings, blocked time, and free work stations at the chosen location.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <UserPlus className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">Customers</p>
                          <p className="text-sm text-gray-600">
                            Seed key clients if you import from another system; otherwise create them during internal booking—public bookings create or match customers automatically from the contact info clients enter.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-gray-200 pt-6">
                    <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <span className="w-6 h-6 bg-indigo-600 text-white rounded-full text-xs flex items-center justify-center">4</span>
                      Payments, reminders, and go-live
                    </h3>
                    <div className="grid md:grid-cols-2 gap-4 ml-8">
                      <div className="p-4 border border-gray-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <ExternalLink className="w-5 h-5 text-green-600" />
                          <p className="font-medium text-gray-900">Online booking link</p>
                        </div>
                        <p className="text-sm text-gray-600 mb-3">
                          Copy your public URL from Studio Settings once types under your booking hierarchy are
                          ready. Clients drill through the hierarchy you configured, choose location and artist,
                          pick a slot, and enter contact details; optional Stripe deposit checkout appears after
                          confirmation when enabled.
                        </p>
                      </div>
                      <div className="p-4 border border-gray-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <CreditCard className="w-5 h-5 text-purple-600" />
                          <p className="font-medium text-gray-900">Stripe</p>
                        </div>
                        <p className="text-sm text-gray-600 mb-3">
                          Connect Stripe on this page for online deposits—confirmation emails include payment links when your account can accept charges. Staff can still create manual deposit checkout links inside appointment details for guests who booked by phone.
                        </p>
                      </div>
                      <div className="p-4 border border-gray-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <Bell className="w-5 h-5 text-indigo-600" />
                          <p className="font-medium text-gray-900">Automated reminders (Plus)</p>
                        </div>
                        <p className="text-sm text-gray-600 mb-3">
                          On Plus, configure Default Emails under Public Templates — set reply-to studio email, timezone, enable reminders, and pick timing.
                        </p>
                      </div>
                      <div className="p-4 border border-gray-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <BarChart3 className="w-5 h-5 text-indigo-600" />
                          <p className="font-medium text-gray-900">After day one</p>
                        </div>
                        <p className="text-sm text-gray-600">
                          Use <strong className="font-medium text-gray-800">Reports</strong> for rollups, <strong className="font-medium text-gray-800">Products</strong> and appointment checkout for retail add-ons, and settlement views when you reconcile Stripe payouts and artist splits.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-indigo-50 rounded-lg p-4 text-sm text-indigo-800">
                    <strong>One-day smoke test:</strong> After one location with at least one station, book one internal appointment end-to-end, then paste your public link in a private window and confirm a booking with a realistic artist schedule. Only then turn on deposits and reminders for clients.
                  </div>
                </CardContent>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
