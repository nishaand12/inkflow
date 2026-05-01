import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Building2, Key, Copy, Check, Mail, Clock, BookOpen, MapPin, Wrench, ClipboardList, Palette, UserPlus, BarChart3, Bell, ChevronDown, ChevronUp, CreditCard, ExternalLink, AlertCircle, Loader2, Layers, CalendarDays } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/utils/supabase";
import { normalizeUserRole } from "@/utils/roles";
import { NORTH_AMERICAN_TIMEZONES } from "@/utils/timezones";

export default function StudioSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [user, setUser] = useState(null);
  const [studio, setStudio] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copiedBookingLink, setCopiedBookingLink] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [emailSettings, setEmailSettings] = useState({
    studio_email: "",
    timezone: "UTC",
    email_reminders_enabled: false,
    reminder_minutes_before: 1440
  });
  const [emailUsage, setEmailUsage] = useState({
    thisMonth: 0,
    loading: false
  });

  const [stripeStatus, setStripeStatus] = useState({
    connected: false,
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    loading: true
  });
  const [stripeConnecting, setStripeConnecting] = useState(false);
  const [stripeMessage, setStripeMessage] = useState(null);

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
          setEmailSettings({
            studio_email: loadedStudio.studio_email || "",
            timezone: loadedStudio.timezone || "UTC",
            email_reminders_enabled: !!loadedStudio.email_reminders_enabled,
            reminder_minutes_before: loadedStudio.reminder_minutes_before || 1440
          });
          loadStripeStatus(loadedStudio.id);
          loadEmailUsage(loadedStudio.id);
        }
      }
    } catch (error) {
      console.error("Error loading studio:", error);
    }
  };

  const loadEmailUsage = async (studioId) => {
    setEmailUsage(prev => ({ ...prev, loading: true }));
    try {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const { count, error } = await supabase
        .from("email_events")
        .select("id", { count: "exact", head: true })
        .eq("studio_id", studioId)
        .eq("event_type", "automatic_email_sent")
        .gte("occurred_at", monthStart.toISOString());

      if (error) throw error;
      setEmailUsage({ thisMonth: count || 0, loading: false });
    } catch (err) {
      console.error("Error loading email usage:", err);
      setEmailUsage(prev => ({ ...prev, loading: false }));
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

  const reminderOptions = [
    { label: "1 week before", value: 10080 },
    { label: "2 days before", value: 2880 },
    { label: "1 day before", value: 1440 },
    { label: "2 hours before", value: 120 },
    { label: "1 hour before", value: 60 }
  ];

  const handleSaveEmailSettings = async () => {
    if (!studio) return;
    try {
      const updated = await base44.entities.Studio.update(studio.id, {
        studio_email: emailSettings.studio_email || null,
        timezone: emailSettings.timezone || "UTC",
        email_reminders_enabled: emailSettings.email_reminders_enabled,
        reminder_minutes_before: emailSettings.reminder_minutes_before
      });
      setStudio(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error("Error updating email settings:", error);
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
                  <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                    <Mail className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <CardTitle className="text-xl text-gray-900">Email Reminders</CardTitle>
                    <p className="text-sm text-gray-600">Configure appointment reminder emails</p>
                  </div>
                  <Badge className="ml-auto bg-indigo-100 text-indigo-700">
                    {studio.subscription_tier ? studio.subscription_tier.toUpperCase() : "BASIC"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="flex items-center justify-between p-4 rounded-lg border border-indigo-100 bg-indigo-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                      <BarChart3 className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Automatic emails sent this month</p>
                      <p className="text-xs text-gray-500">Tracked from the email events log</p>
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-indigo-700">
                    {emailUsage.loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      emailUsage.thisMonth
                    )}
                  </div>
                </div>

                {studio.subscription_tier !== "plus" ? (
                  <div className="text-sm text-gray-600">
                    Email reminders are available on the Plus tier. Contact support to upgrade this studio.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <Label className="text-sm font-semibold text-gray-700">Studio Email *</Label>
                        <Input
                          value={emailSettings.studio_email}
                          onChange={(e) => setEmailSettings({ ...emailSettings, studio_email: e.target.value })}
                          placeholder="studio@example.com"
                          required
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          This email will be shown as the contact in appointment emails
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-semibold text-gray-700">Timezone</Label>
                        <Select
                          value={emailSettings.timezone}
                          onValueChange={(value) => setEmailSettings({ ...emailSettings, timezone: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select timezone" />
                          </SelectTrigger>
                          <SelectContent>
                            {["United States", "Canada", "Mexico", "Caribbean", "Other"].map((region) => {
                              const regionTimezones = NORTH_AMERICAN_TIMEZONES.filter(tz => tz.region === region);
                              if (regionTimezones.length === 0) return null;
                              return (
                                <React.Fragment key={region}>
                                  <SelectItem value={`__header_${region}`} disabled className="font-semibold text-gray-500 text-xs uppercase tracking-wide">
                                    {region}
                                  </SelectItem>
                                  {regionTimezones.map((tz) => (
                                    <SelectItem key={tz.value} value={tz.value}>
                                      {tz.label}
                                    </SelectItem>
                                  ))}
                                </React.Fragment>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
                      <div>
                        <Label className="cursor-pointer">Enable Email Reminders</Label>
                        <p className="text-sm text-gray-500">Send automatic reminders to clients</p>
                      </div>
                      <Switch
                        checked={emailSettings.email_reminders_enabled}
                        onCheckedChange={(checked) =>
                          setEmailSettings({ ...emailSettings, email_reminders_enabled: checked })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-gray-700">Reminder Timing</Label>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center">
                          <Clock className="w-5 h-5 text-indigo-600" />
                        </div>
                        <Select
                          value={String(emailSettings.reminder_minutes_before)}
                          onValueChange={(value) =>
                            setEmailSettings({ ...emailSettings, reminder_minutes_before: Number(value) })
                          }
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Select reminder timing" />
                          </SelectTrigger>
                          <SelectContent>
                            {reminderOptions.map((option) => (
                              <SelectItem key={option.value} value={String(option.value)}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-sm text-gray-500">
                        Only one reminder will be sent at the selected time.
                      </p>
                    </div>

                    <Button 
                      className={saved ? "bg-green-600 hover:bg-green-700" : "bg-indigo-600 hover:bg-indigo-700"} 
                      onClick={handleSaveEmailSettings}
                    >
                      {saved ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          Saved!
                        </>
                      ) : (
                        "Save Email Settings"
                      )}
                    </Button>
                  </>
                )}
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
                            <strong className="font-medium text-gray-800">artist type</strong> (tattoo, piercer, or both), primary location, and keep them active. Public online booking currently lists piercers (&quot;piercer&quot; or &quot;both&quot;) when clients choose an artist; plan types and artist types accordingly.
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
                          On Plus, set reply-to studio email and timezone above, enable reminders, and pick timing. The same tally shown in Automatic emails sent this month applies to outbound automated reminders logged for your studio (reset each calendar month).
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