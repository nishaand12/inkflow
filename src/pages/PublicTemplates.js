import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Mail, Clock, BarChart3, Check, Loader2, FileText, Bell, Plus, Trash2, Save } from "lucide-react";
import { supabase } from "@/utils/supabase";
import { normalizeUserRole } from "@/utils/roles";
import { NORTH_AMERICAN_TIMEZONES } from "@/utils/timezones";
import {
  NOTIFICATION_ITEMS,
  DEFAULT_TEMPLATES,
  TEMPLATE_PLACEHOLDERS,
  formatMinutes,
  buildEmailSettingsFromStudio,
  buildEmailSavePayload,
} from "@/constants/notificationTemplates";
import {
  filterCategoriesByRole,
  CATEGORY_ROLE_APPOINTMENT_KIND,
} from "@/utils/reportingCategories";

const DEFAULT_DISCLAIMER = `Earlobes age 5+ with a custodial parent present / Most common piercings age 13–15 with a custodial parent present or 16+ with picture ID / Extreme and genital piercings 18+ with picture ID

ONLINE DEPOSITS ARE NON-REFUNDABLE

Custodial parent must present valid government photo ID. Minor with parent must also present ID to get pierced; a non-photo health card is fine.`;

const PROFILE_SLOTS = [
  { label: "Confirmation", field: "confirmation", noMinutes: true },
  { label: "3-day reminder", field: "reminder_secondary", direction: "before" },
  { label: "1-day reminder", field: "reminder_primary", direction: "before" },
  { label: "Day-of reminder", field: "reminder_tertiary", direction: "before" },
  { label: "Quick follow-up", field: "followup_quick", direction: "after" },
  { label: "Long-term follow-up", field: "followup_longterm", direction: "after" },
  { label: "75-day follow-up", field: "followup_midterm", direction: "after" },
];

export default function PublicTemplates() {
  const [user, setUser] = useState(null);
  const [studio, setStudio] = useState(null);
  const [saved, setSaved] = useState(false);
  const [disclaimerSaved, setDisclaimerSaved] = useState(false);
  const [emailSettings, setEmailSettings] = useState(null);
  const [disclaimerText, setDisclaimerText] = useState("");
  const [emailUsage, setEmailUsage] = useState({ thisMonth: 0, loading: false });
  const [profiles, setProfiles] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [allKindCategories, setAllKindCategories] = useState([]);

  useEffect(() => {
    loadUserAndStudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUserAndStudio = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      if (currentUser.studio_id) {
        const [studios, categories] = await Promise.all([
          base44.entities.Studio.filter({ id: currentUser.studio_id }),
          base44.entities.ReportingCategory.filter({ studio_id: currentUser.studio_id }),
        ]);
        if (studios.length > 0) {
          const loadedStudio = studios[0];
          setStudio(loadedStudio);
          setEmailSettings(buildEmailSettingsFromStudio(loadedStudio));
          setDisclaimerText(loadedStudio.booking_page_disclaimer_template || "");
          loadEmailUsage(loadedStudio.id);

          const kindCats = filterCategoriesByRole(categories, CATEGORY_ROLE_APPOINTMENT_KIND);
          setAllKindCategories(kindCats);

          loadProfiles(currentUser.studio_id);
        }
      }
    } catch (error) {
      console.error("Error loading studio:", error);
    }
  };

  const loadProfiles = async (studioId) => {
    try {
      const [profs, assigns] = await Promise.all([
        base44.entities.StudioNotificationProfile.filter({ studio_id: studioId }),
        base44.entities.AppointmentKindNotificationAssignment.filter({ studio_id: studioId }),
      ]);
      setProfiles((profs || []).sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)));
      setAssignments(assigns || []);
    } catch (err) {
      console.error("Error loading profiles:", err);
    }
  };

  const handleCreateProfile = async () => {
    if (!user?.studio_id) return;
    if (profiles.length >= 5) {
      alert("Maximum 5 profiles allowed.");
      return;
    }
    try {
      const newProfile = await base44.entities.StudioNotificationProfile.create({
        studio_id: user.studio_id,
        name: `Profile ${profiles.length + 1}`,
        is_default: profiles.length === 0,
        display_order: profiles.length,
      });
      setProfiles((prev) => [...prev, newProfile]);
    } catch (err) {
      console.error("Error creating profile:", err);
    }
  };

  const handleUpdateProfile = async (profileId, updates) => {
    try {
      const updated = await base44.entities.StudioNotificationProfile.update(profileId, updates);
      setProfiles((prev) => prev.map((p) => (p.id === profileId ? updated : p)));
    } catch (err) {
      console.error("Error updating profile:", err);
    }
  };

  const handleDeleteProfile = async (profileId) => {
    if (!window.confirm("Delete this notification profile? Assignments using it will be removed.")) return;
    try {
      await base44.entities.StudioNotificationProfile.delete(profileId);
      setProfiles((prev) => prev.filter((p) => p.id !== profileId));
      setAssignments((prev) => prev.filter((a) => a.profile_id !== profileId));
    } catch (err) {
      console.error("Error deleting profile:", err);
    }
  };

  const handleAssignmentChange = async (kindCategoryId, profileId) => {
    if (!user?.studio_id) return;
    const existing = assignments.find((a) => a.kind_category_id === kindCategoryId);
    try {
      if (profileId === "__default__") {
        if (existing) {
          await base44.entities.AppointmentKindNotificationAssignment.delete(existing.id);
          setAssignments((prev) => prev.filter((a) => a.id !== existing.id));
        }
      } else if (existing) {
        const updated = await base44.entities.AppointmentKindNotificationAssignment.update(existing.id, {
          profile_id: profileId,
        });
        setAssignments((prev) => prev.map((a) => (a.id === existing.id ? updated : a)));
      } else {
        const created = await base44.entities.AppointmentKindNotificationAssignment.create({
          studio_id: user.studio_id,
          kind_category_id: kindCategoryId,
          profile_id: profileId,
        });
        setAssignments((prev) => [...prev, created]);
      }
    } catch (err) {
      console.error("Error updating assignment:", err);
    }
  };

  const loadEmailUsage = async (studioId) => {
    setEmailUsage((prev) => ({ ...prev, loading: true }));
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
      setEmailUsage((prev) => ({ ...prev, loading: false }));
    }
  };

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === "admin" ? "Admin" : "Front_Desk"));
  };

  const userRole = getUserRole();
  const isOwnerOrAdmin = userRole === "Owner" || userRole === "Admin";
  const isPlus = studio?.subscription_tier === "plus";

  const resetEmailTemplatesToDefaults = () => {
    setEmailSettings((prev) => ({ ...prev, ...DEFAULT_TEMPLATES }));
  };

  const handleSaveEmailSettings = async () => {
    if (!studio || !emailSettings) return;
    try {
      const updated = await base44.entities.Studio.update(studio.id, buildEmailSavePayload(emailSettings));
      setStudio(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error("Error updating email settings:", error);
    }
  };

  const handleSaveDisclaimer = async () => {
    if (!studio) return;
    try {
      const updated = await base44.entities.Studio.update(studio.id, {
        booking_page_disclaimer_template: disclaimerText.trim() || null,
      });
      setStudio(updated);
      setDisclaimerSaved(true);
      setTimeout(() => setDisclaimerSaved(false), 2000);
    } catch (error) {
      console.error("Error saving disclaimer:", error);
    }
  };

  if (!isOwnerOrAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">Only Owners and Admins can access public templates.</p>
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
          <h1 className="text-3xl font-bold text-gray-900">Public Templates</h1>
          <p className="text-gray-500 mt-1">
            Manage email notifications, public booking page content, and per-category overrides
          </p>
        </div>

        {studio && emailSettings && (
          <Tabs defaultValue="email" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="booking" className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Public booking
              </TabsTrigger>
              <TabsTrigger value="email" className="flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Default Emails
              </TabsTrigger>
              <TabsTrigger value="profiles" className="flex items-center gap-2">
                <Bell className="w-4 h-4" />
                Profiles
              </TabsTrigger>
            </TabsList>

            {/* ── Public booking tab ─────────────────────────────────── */}
            <TabsContent value="booking" className="mt-6">
              <Card className="bg-white border-none shadow-lg">
                <CardHeader className="border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                      <FileText className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                      <CardTitle className="text-xl text-gray-900">Public Booking Page</CardTitle>
                      <p className="text-sm text-gray-600">
                        Customize the disclaimer shown at the top of your online booking page
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-gray-700">
                      Booking page disclaimer / policy
                    </Label>
                    <Textarea
                      rows={8}
                      value={disclaimerText}
                      onChange={(e) => setDisclaimerText(e.target.value)}
                      placeholder={DEFAULT_DISCLAIMER}
                    />
                    <p className="text-xs text-gray-500">
                      This text appears at the top of your public booking page. Leave empty to hide the disclaimer box.
                    </p>
                  </div>

                  {disclaimerText.trim() && (
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-gray-700">Preview</Label>
                      <div className="rounded-xl border border-indigo-200 bg-white/90 shadow-sm px-4 py-4 space-y-3 text-left text-sm text-gray-700">
                        {disclaimerText.split("\n\n").map((paragraph, i) => (
                          <p key={i} className={paragraph === paragraph.toUpperCase() && paragraph.length > 5 ? "font-semibold tracking-wide text-center text-gray-900" : ""}>
                            {paragraph}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button
                    className={disclaimerSaved ? "bg-green-600 hover:bg-green-700" : "bg-indigo-600 hover:bg-indigo-700"}
                    onClick={handleSaveDisclaimer}
                  >
                    {disclaimerSaved ? (
                      <><Check className="w-4 h-4 mr-2" />Saved!</>
                    ) : (
                      "Save Disclaimer"
                    )}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Default Emails tab ─────────────────────────── */}
            <TabsContent value="email" className="mt-6">
              <Card className="bg-white border-none shadow-lg">
                <CardHeader className="border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                      <Mail className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                      <CardTitle className="text-xl text-gray-900">Default Emails</CardTitle>
                      <p className="text-sm text-gray-600">
                        Configure confirmations, reminders, and email templates
                      </p>
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
                      {emailUsage.loading ? <Loader2 className="w-5 h-5 animate-spin" /> : emailUsage.thisMonth}
                    </div>
                  </div>

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
                            const regionTimezones = NORTH_AMERICAN_TIMEZONES.filter((tz) => tz.region === region);
                            if (regionTimezones.length === 0) return null;
                            return (
                              <React.Fragment key={region}>
                                <SelectItem value={`__header_${region}`} disabled className="font-semibold text-gray-500 text-xs uppercase tracking-wide">
                                  {region}
                                </SelectItem>
                                {regionTimezones.map((tz) => (
                                  <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                                ))}
                              </React.Fragment>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {!isPlus && (
                    <div className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      Automated notifications are available on the Plus tier. Contact support to upgrade this studio.
                    </div>
                  )}

                  <div className="rounded-lg border border-gray-200 p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-gray-900">Notification Templates</h4>
                        <p className="text-xs text-gray-500 mt-1">
                          Supported placeholders: {TEMPLATE_PLACEHOLDERS.join(", ")}.
                        </p>
                      </div>
                      <Button type="button" variant="outline" onClick={resetEmailTemplatesToDefaults}>
                        Reset Defaults
                      </Button>
                    </div>

                    <Accordion type="single" collapsible className="w-full">
                      {NOTIFICATION_ITEMS.map((item) => {
                        const enabled = Boolean(emailSettings[item.enabledField]);
                        const timingText = item.timingField
                          ? formatMinutes(emailSettings[item.timingField], item.timingDirection)
                          : item.timingLabel;

                        return (
                          <AccordionItem key={item.key} value={item.key} className="border rounded-lg px-3">
                            <div className="flex items-center gap-3">
                              <AccordionTrigger className="hover:no-underline py-3">
                                <div className="text-left">
                                  <p className="font-medium text-gray-900">{item.title}</p>
                                  <p className="text-xs text-gray-500">{timingText}</p>
                                </div>
                              </AccordionTrigger>
                              <div className="ml-auto flex items-center gap-2 pl-2">
                                <span className="text-xs text-gray-500">Enabled</span>
                                <Switch
                                  checked={enabled}
                                  disabled={!isPlus}
                                  onCheckedChange={(checked) =>
                                    setEmailSettings((prev) => ({ ...prev, [item.enabledField]: checked }))
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                            </div>
                            <AccordionContent className="space-y-3 pb-4">
                              {item.timingField && (
                                <div className="space-y-2">
                                  <Label className="text-sm font-semibold text-gray-700">
                                    Timing (minutes {item.timingDirection} appointment)
                                  </Label>
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center">
                                      <Clock className="w-5 h-5 text-indigo-600" />
                                    </div>
                                    <Input
                                      type="number"
                                      min="1"
                                      step="1"
                                      value={emailSettings[item.timingField]}
                                      disabled={!isPlus}
                                      onChange={(e) =>
                                        setEmailSettings((prev) => ({
                                          ...prev,
                                          [item.timingField]: Math.max(1, Number(e.target.value) || 1),
                                        }))
                                      }
                                    />
                                  </div>
                                </div>
                              )}
                              <div className="space-y-2">
                                <Label className="text-sm font-semibold text-gray-700">Subject</Label>
                                <Input
                                  value={emailSettings[item.subjectField]}
                                  disabled={!isPlus}
                                  onChange={(e) =>
                                    setEmailSettings((prev) => ({ ...prev, [item.subjectField]: e.target.value }))
                                  }
                                />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-sm font-semibold text-gray-700">Body</Label>
                                <Textarea
                                  rows={8}
                                  value={emailSettings[item.bodyField]}
                                  disabled={!isPlus}
                                  onChange={(e) =>
                                    setEmailSettings((prev) => ({ ...prev, [item.bodyField]: e.target.value }))
                                  }
                                />
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        );
                      })}
                    </Accordion>
                  </div>

                  <Button
                    className={saved ? "bg-green-600 hover:bg-green-700" : "bg-indigo-600 hover:bg-indigo-700"}
                    onClick={handleSaveEmailSettings}
                  >
                    {saved ? (
                      <><Check className="w-4 h-4 mr-2" />Saved!</>
                    ) : (
                      "Save Email Settings"
                    )}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Notification Profiles tab ─────────────────────────── */}
            <TabsContent value="profiles" className="mt-6">
              <Card className="bg-white border-none shadow-lg">
                <CardHeader className="border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                        <Bell className="w-6 h-6 text-indigo-600" />
                      </div>
                      <div>
                        <CardTitle className="text-xl text-gray-900">Notification Profiles</CardTitle>
                        <p className="text-sm text-gray-600">
                          Create reusable notification configurations and assign them to appointment types
                        </p>
                      </div>
                    </div>
                    {profiles.length < 5 && (
                      <Button onClick={handleCreateProfile} className="bg-indigo-600 hover:bg-indigo-700">
                        <Plus className="w-4 h-4 mr-2" />
                        New Profile
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                  {profiles.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <Bell className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                      <p>No notification profiles yet. Create one to customize notifications per appointment type.</p>
                      <p className="text-xs mt-1">The Default Emails tab is used as the fallback when no profile is assigned.</p>
                    </div>
                  )}

                  {profiles.map((profile) => (
                    <div key={profile.id} className="border rounded-xl p-4 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 flex-1">
                          <Input
                            value={profile.name}
                            onChange={(e) =>
                              setProfiles((prev) =>
                                prev.map((p) => (p.id === profile.id ? { ...p, name: e.target.value } : p))
                              )
                            }
                            className="font-semibold text-lg max-w-xs"
                          />
                          {profile.is_default && (
                            <Badge className="bg-indigo-100 text-indigo-800">Default</Badge>
                          )}
                          {!profile.is_default && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const updatedProfiles = profiles.map((p) => ({
                                  ...p,
                                  is_default: p.id === profile.id,
                                }));
                                setProfiles(updatedProfiles);
                                updatedProfiles.forEach((p) =>
                                  handleUpdateProfile(p.id, { is_default: p.id === profile.id })
                                );
                              }}
                              className="text-xs text-gray-500"
                            >
                              Set as default
                            </Button>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              handleUpdateProfile(profile.id, { name: profile.name })
                            }
                          >
                            <Save className="w-4 h-4" />
                          </Button>
                          {!profile.is_default && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteProfile(profile.id)}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 p-3 space-y-1 bg-gray-50/60">
                        <p className="text-xs font-semibold text-gray-700">Supported placeholders</p>
                        <p className="text-xs text-gray-500 break-words">{TEMPLATE_PLACEHOLDERS.join(", ")}</p>
                        <p className="text-[11px] text-gray-400">
                          Leave subject/body blank to use the studio default template from the Default Emails tab.
                        </p>
                      </div>

                      <Accordion type="single" collapsible className="w-full space-y-2">
                        {PROFILE_SLOTS.map((slot) => {
                          const enabled = profile[`${slot.field}_enabled`] !== false;
                          const minutes = profile[`${slot.field}_minutes`];
                          return (
                            <AccordionItem key={slot.field} value={`${profile.id}-${slot.field}`} className="border rounded-lg px-3">
                              <div className="flex items-center gap-3">
                                <AccordionTrigger className="hover:no-underline py-3 flex-1">
                                  <div className="text-left">
                                    <p className="font-medium text-gray-900 text-sm">{slot.label}</p>
                                    <p className="text-xs text-gray-500">
                                      {slot.noMinutes
                                        ? "Sent on booking"
                                        : formatMinutes(minutes, slot.direction)}
                                    </p>
                                  </div>
                                </AccordionTrigger>
                                <div className="flex items-center gap-2 pl-2">
                                  <span className="text-xs text-gray-500">Enabled</span>
                                  <Switch
                                    checked={enabled}
                                    onClick={(e) => e.stopPropagation()}
                                    onCheckedChange={(checked) => {
                                      setProfiles((prev) =>
                                        prev.map((p) =>
                                          p.id === profile.id ? { ...p, [`${slot.field}_enabled`]: checked } : p
                                        )
                                      );
                                      handleUpdateProfile(profile.id, { [`${slot.field}_enabled`]: checked });
                                    }}
                                  />
                                </div>
                              </div>
                              <AccordionContent className="space-y-3 pb-4">
                                {!slot.noMinutes && (
                                  <div className="space-y-1">
                                    <Label className="text-xs text-gray-600">
                                      Timing (minutes {slot.direction} appointment)
                                    </Label>
                                    <div className="flex items-center gap-2">
                                      <Clock className="w-4 h-4 text-indigo-500" />
                                      <Input
                                        type="number"
                                        min="1"
                                        className="h-8 text-sm w-32"
                                        value={minutes || ""}
                                        onChange={(e) => {
                                          const val = Math.max(1, Number(e.target.value) || 1);
                                          setProfiles((prev) =>
                                            prev.map((p) =>
                                              p.id === profile.id ? { ...p, [`${slot.field}_minutes`]: val } : p
                                            )
                                          );
                                        }}
                                        onBlur={() =>
                                          handleUpdateProfile(profile.id, {
                                            [`${slot.field}_minutes`]: profile[`${slot.field}_minutes`],
                                          })
                                        }
                                      />
                                    </div>
                                  </div>
                                )}
                                <div className="space-y-1">
                                  <Label className="text-xs text-gray-600">Subject</Label>
                                  <Input
                                    className="h-8 text-sm"
                                    placeholder="Use studio default"
                                    value={profile[`${slot.field}_subject`] || ""}
                                    onChange={(e) =>
                                      setProfiles((prev) =>
                                        prev.map((p) =>
                                          p.id === profile.id ? { ...p, [`${slot.field}_subject`]: e.target.value } : p
                                        )
                                      )
                                    }
                                    onBlur={() =>
                                      handleUpdateProfile(profile.id, {
                                        [`${slot.field}_subject`]: profile[`${slot.field}_subject`]?.trim() || null,
                                      })
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-gray-600">Body</Label>
                                  <Textarea
                                    rows={6}
                                    placeholder="Use studio default"
                                    value={profile[`${slot.field}_body`] || ""}
                                    onChange={(e) =>
                                      setProfiles((prev) =>
                                        prev.map((p) =>
                                          p.id === profile.id ? { ...p, [`${slot.field}_body`]: e.target.value } : p
                                        )
                                      )
                                    }
                                    onBlur={() =>
                                      handleUpdateProfile(profile.id, {
                                        [`${slot.field}_body`]: profile[`${slot.field}_body`]?.trim() || null,
                                      })
                                    }
                                  />
                                </div>
                                {slot.field === "reminder_tertiary" && (
                                  <p className="text-[11px] text-amber-700">
                                    Day-of reminders intentionally omit the reschedule link.
                                  </p>
                                )}
                              </AccordionContent>
                            </AccordionItem>
                          );
                        })}
                      </Accordion>
                    </div>
                  ))}

                  {profiles.length > 0 && allKindCategories.length > 0 && (
                    <div className="border-t pt-6 space-y-4">
                      <div>
                        <h3 className="font-semibold text-gray-900">Assignments</h3>
                        <p className="text-sm text-gray-500">
                          Assign a notification profile to each appointment type. Types without an assignment use the default profile.
                        </p>
                      </div>
                      <div className="space-y-2">
                        {allKindCategories
                          .filter((c) => !c.parent_id)
                          .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
                          .map((root) => {
                            const children = allKindCategories.filter((c) => c.parent_id === root.id);
                            const nodes = children.length > 0 ? children : [root];
                            return (
                              <div key={root.id} className="space-y-1">
                                {children.length > 0 && (
                                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{root.name}</p>
                                )}
                                {nodes.map((node) => {
                                  const assignment = assignments.find((a) => a.kind_category_id === node.id);
                                  return (
                                    <div key={node.id} className="flex items-center justify-between gap-3 bg-gray-50 rounded-lg px-3 py-2">
                                      <span className="text-sm text-gray-800">{node.name}</span>
                                      <Select
                                        value={assignment?.profile_id || "__default__"}
                                        onValueChange={(val) => handleAssignmentChange(node.id, val)}
                                      >
                                        <SelectTrigger className="w-[200px] h-8 text-sm">
                                          <SelectValue placeholder="Use default" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="__default__">Use default</SelectItem>
                                          {profiles.map((p) => (
                                            <SelectItem key={p.id} value={p.id}>
                                              {p.name}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>
        )}
      </div>
    </div>
  );
}
