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
import { Mail, Clock, BarChart3, Check, Loader2, FileText, Layers } from "lucide-react";
import { supabase } from "@/utils/supabase";
import { normalizeUserRole } from "@/utils/roles";
import { NORTH_AMERICAN_TIMEZONES } from "@/utils/timezones";
import {
  NOTIFICATION_ITEMS,
  CRON_NOTIFICATION_ITEMS,
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

const CATEGORY_PLACEHOLDERS = [
  "{{customer_name}}",
  "{{studio_name}}",
  "{{appointment_date_time}}",
  "{{location_name}}",
  "{{artist_name}}",
  "{{studio_email}}",
];

export default function PublicTemplates() {
  const [user, setUser] = useState(null);
  const [studio, setStudio] = useState(null);
  const [saved, setSaved] = useState(false);
  const [disclaimerSaved, setDisclaimerSaved] = useState(false);
  const [categorySaved, setCategorySaved] = useState(false);
  const [emailSettings, setEmailSettings] = useState(null);
  const [disclaimerText, setDisclaimerText] = useState("");
  const [emailUsage, setEmailUsage] = useState({ thisMonth: 0, loading: false });
  const [kindRoots, setKindRoots] = useState([]);
  const [kindSettings, setKindSettings] = useState({});
  

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

          const roots = filterCategoriesByRole(categories, CATEGORY_ROLE_APPOINTMENT_KIND)
            .filter((c) => !c.parent_id)
            .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || (a.name || "").localeCompare(b.name || ""));
          setKindRoots(roots);

          loadKindNotificationSettings(loadedStudio.id);
        }
      }
    } catch (error) {
      console.error("Error loading studio:", error);
    }
  };

  const loadKindNotificationSettings = async (studioId) => {
    try {
      const { data, error } = await supabase
        .from("appointment_kind_notification_settings")
        .select("*")
        .eq("studio_id", studioId);
      if (error) throw error;
      const map = {};
      for (const row of data || []) {
        const key = `${row.kind_root_category_id}__${row.notification_kind}`;
        map[key] = {
          id: row.id,
          enabled: row.enabled,
          minutes: row.minutes,
          subject_template: row.subject_template || "",
          body_template: row.body_template || "",
        };
      }
      setKindSettings(map);
    } catch (err) {
      console.error("Error loading kind notification settings:", err);
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

  const updateKindSetting = (rootId, notificationKind, field, value) => {
    const key = `${rootId}__${notificationKind}`;
    setKindSettings((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [field]: value },
    }));
  };

  const handleSaveKindSettings = async () => {
    if (!studio) return;
    try {
      for (const root of kindRoots) {
        for (const item of CRON_NOTIFICATION_ITEMS) {
          const notifKind = item.key === "primary_reminder" ? "reminder_primary"
            : item.key === "secondary_reminder" ? "reminder_secondary"
            : item.key === "quick_followup" ? "followup_quick"
            : "followup_longterm";
          const key = `${root.id}__${notifKind}`;
          const setting = kindSettings[key];
          if (!setting) continue;

          const hasOverride = setting.enabled != null ||
            (setting.minutes != null && setting.minutes !== "") ||
            setting.subject_template?.trim() ||
            setting.body_template?.trim();

          if (!hasOverride && !setting.id) continue;

          const payload = {
            studio_id: studio.id,
            kind_root_category_id: root.id,
            notification_kind: notifKind,
            enabled: setting.enabled ?? null,
            minutes: setting.minutes != null && setting.minutes !== "" ? Number(setting.minutes) : null,
            subject_template: setting.subject_template?.trim() || null,
            body_template: setting.body_template?.trim() || null,
          };

          if (setting.id) {
            await supabase
              .from("appointment_kind_notification_settings")
              .update(payload)
              .eq("id", setting.id);
          } else {
            const { data } = await supabase
              .from("appointment_kind_notification_settings")
              .insert(payload)
              .select("id")
              .single();
            if (data) {
              setKindSettings((prev) => ({
                ...prev,
                [key]: { ...prev[key], id: data.id },
              }));
            }
          }
        }
      }
      setCategorySaved(true);
      setTimeout(() => setCategorySaved(false), 2000);
    } catch (error) {
      console.error("Error saving kind settings:", error);
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
              <TabsTrigger value="category" className="flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Category Notifications
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

            {/* ── Category Notifications tab ─────────────────────────── */}
            <TabsContent value="category" className="mt-6">
              <Card className="bg-white border-none shadow-lg">
                <CardHeader className="border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                      <Layers className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                      <CardTitle className="text-xl text-gray-900">Category Notifications</CardTitle>
                      <p className="text-sm text-gray-600">
                        Override reminder and follow-up templates per top-level booking category
                      </p>
                    </div>
                    <Badge className="ml-auto bg-indigo-100 text-indigo-700">
                      {studio.subscription_tier ? studio.subscription_tier.toUpperCase() : "BASIC"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                  {!isPlus && (
                    <div className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      Per-category notification overrides are available on the Plus tier.
                    </div>
                  )}

                  <div className="rounded-lg border border-gray-200 p-4 space-y-2 bg-gray-50/60">
                    <p className="text-sm font-semibold text-gray-900">Supported placeholders</p>
                    <p className="text-xs text-gray-600 break-words">
                      {CATEGORY_PLACEHOLDERS.join(", ")}
                    </p>
                  </div>

                  {kindRoots.length === 0 ? (
                    <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-4 text-center">
                      No booking hierarchy categories found. Create top-level booking categories in the Categories page first.
                    </div>
                  ) : (
                    <Accordion type="single" collapsible className="w-full space-y-3">
                      {kindRoots.map((root) => (
                        <AccordionItem key={root.id} value={root.id} className="border rounded-lg px-3">
                          <AccordionTrigger className="hover:no-underline py-3">
                            <div className="text-left">
                              <p className="font-medium text-gray-900">{root.name}</p>
                              <p className="text-xs text-gray-500">
                                Override reminders and follow-ups for all {root.name} appointments
                              </p>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="space-y-4 pb-4">
                            {CRON_NOTIFICATION_ITEMS.map((item) => {
                              const notifKind = item.key === "primary_reminder" ? "reminder_primary"
                                : item.key === "secondary_reminder" ? "reminder_secondary"
                                : item.key === "quick_followup" ? "followup_quick"
                                : "followup_longterm";
                              const key = `${root.id}__${notifKind}`;
                              const setting = kindSettings[key] || {};
                              const studioEnabled = Boolean(emailSettings[item.enabledField]);
                              const studioMinutes = emailSettings[item.timingField];
                              const studioSubject = emailSettings[item.subjectField];

                              return (
                                <div key={item.key} className="rounded-lg border border-gray-100 p-4 space-y-3">
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="font-medium text-gray-900 text-sm">{item.title}</p>
                                        <p className="text-xs text-gray-400">
                                          Studio default: {studioEnabled ? "enabled" : "disabled"}
                                          {item.timingField && `, ${formatMinutes(studioMinutes, item.timingDirection)}`}
                                        </p>
                                      </div>
                                      <div className="flex flex-col items-end gap-1">
                                        <div className="flex items-center gap-2">
                                          <Label className="text-xs text-gray-600">Send for this category</Label>
                                          <Select
                                            value={setting.enabled == null ? "inherit" : setting.enabled ? "on" : "off"}
                                            disabled={!isPlus}
                                            onValueChange={(val) =>
                                              updateKindSetting(root.id, notifKind, "enabled",
                                                val === "inherit" ? null : val === "on")
                                            }
                                          >
                                            <SelectTrigger className="w-28 h-8 text-xs">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="inherit">Inherit</SelectItem>
                                              <SelectItem value="on">Enabled</SelectItem>
                                              <SelectItem value="off">Disabled</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      </div>
                                    </div>
                                    <p className="text-xs text-gray-500">
                                      <strong className="font-medium text-gray-600">Inherit</strong> — use the on/off
                                      setting from Default Emails for this category.{" "}
                                      <strong className="font-medium text-gray-600">Enabled</strong> — always send for{" "}
                                      {root.name} appointments, even if studio default is off.{" "}
                                      <strong className="font-medium text-gray-600">Disabled</strong> — never send for{" "}
                                      {root.name}, even if studio default is on.
                                    </p>
                                  </div>
                                  {item.timingField && (
                                    <div className="space-y-1">
                                      <Label className="text-xs text-gray-600">
                                        Timing override (minutes {item.timingDirection} appointment)
                                      </Label>
                                      <Input
                                        type="number"
                                        min="1"
                                        step="1"
                                        placeholder={`Inherit (${studioMinutes})`}
                                        value={setting.minutes ?? ""}
                                        disabled={!isPlus}
                                        onChange={(e) =>
                                          updateKindSetting(root.id, notifKind, "minutes",
                                            e.target.value === "" ? null : Math.max(1, Number(e.target.value) || 1))
                                        }
                                      />
                                    </div>
                                  )}
                                  <div className="space-y-1">
                                    <Label className="text-xs text-gray-600">Subject override</Label>
                                    <Input
                                      placeholder={`Inherit: ${studioSubject}`}
                                      value={setting.subject_template || ""}
                                      disabled={!isPlus}
                                      onChange={(e) => updateKindSetting(root.id, notifKind, "subject_template", e.target.value)}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-gray-600">Body override</Label>
                                    <Textarea
                                      rows={5}
                                      placeholder={`Inherit from studio default`}
                                      value={setting.body_template || ""}
                                      disabled={!isPlus}
                                      onChange={(e) => updateKindSetting(root.id, notifKind, "body_template", e.target.value)}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  )}

                  {kindRoots.length > 0 && (
                    <Button
                      className={categorySaved ? "bg-green-600 hover:bg-green-700" : "bg-indigo-600 hover:bg-indigo-700"}
                      onClick={handleSaveKindSettings}
                      disabled={!isPlus}
                    >
                      {categorySaved ? (
                        <><Check className="w-4 h-4 mr-2" />Saved!</>
                      ) : (
                        "Save Category Overrides"
                      )}
                    </Button>
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
