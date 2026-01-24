import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Building2, Key, Copy, Check, Mail, Clock } from "lucide-react";
import { normalizeUserRole } from "@/utils/roles";
import { NORTH_AMERICAN_TIMEZONES } from "@/utils/timezones";

export default function StudioSettings() {
  const [user, setUser] = useState(null);
  const [studio, setStudio] = useState(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [emailSettings, setEmailSettings] = useState({
    studio_email: "",
    timezone: "UTC",
    email_reminders_enabled: false,
    reminder_minutes_before: 1440
  });

  useEffect(() => {
    loadUserAndStudio();
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
        }
      }
    } catch (error) {
      console.error("Error loading studio:", error);
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
          </>
        )}
      </div>
    </div>
  );
}