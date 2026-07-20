import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/utils/supabase";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { Trash2, Save, AlertCircle, CheckCircle, Unlock, Mail, Loader2, Link2, Copy, Check, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import CustomerSearch from "../customers/CustomerSearch";
import CustomerDialog from "../customers/CustomerDialog";
import AdvancedSearchDialog from "../customers/AdvancedSearchDialog";
import CheckoutDialog from "./CheckoutDialog";
import RefundDialog from "./RefundDialog";
import TimePicker12h from "./TimePicker12h";
import { normalizeUserRole } from "@/utils/roles";
import { addMinutesToTime, formatDuration, formatTime12h, DEFAULT_BOOKING_START_TIME, DEFAULT_APPOINTMENT_END_TIME } from "@/utils/index";
import { getAppointmentTypeDisplaySections } from "@/utils/reportingCategories";
import { useCheckoutPaymentMethods } from "@/utils/useCheckoutPaymentMethods";
import { filterArtistsSelectableForBooking } from "@/utils/artistTypes";
import { getAppointmentStatusLabel } from "@/utils/appointmentStatus";
import {
  buildExclusionKeySet,
  filterArtistsForAppointmentType,
  filterAppointmentTypesForArtist,
  canArtistBookAppointmentType,
} from "@/utils/artistServiceEligibility";
import { pickPreferredWorkStationId } from "@/utils/workStationSelection";
import LinkifiedText, { textContainsUrl } from "@/components/common/LinkifiedText";
import {
  buildCheckoutSummaryFromLegacyCharges,
  buildCheckoutSummaryFromSale,
} from "@/utils/saleLines";
import { joinPaymentMethods } from "@/utils/splitTender";

// Stable empty array to prevent new references on each render
const EMPTY_ARRAY = [];

/** Minimum span between start and end time (e.g. short piercing visits). */
const MIN_APPOINTMENT_DURATION_MINUTES = 5;

function sortLocationsByCreatedAt(locationsList) {
  return [...locationsList].sort((a, b) =>
    String(a.created_at || "").localeCompare(String(b.created_at || ""))
  );
}

/** Active locations sorted by created_at; prefer artist primary, else keep previous if valid, else first. */
function resolveDefaultLocationId(locations, artistId, artists, previousLocationId) {
  const activeSorted = sortLocationsByCreatedAt(locations.filter((l) => l.is_active));
  if (activeSorted.length === 0) return "";
  if (artistId) {
    const artist = artists.find((a) => a.id === artistId);
    if (
      artist?.primary_location_id &&
      activeSorted.some((l) => l.id === artist.primary_location_id)
    ) {
      return artist.primary_location_id;
    }
  }
  if (previousLocationId && activeSorted.some((l) => l.id === previousLocationId)) {
    return previousLocationId;
  }
  return activeSorted[0].id;
}

function timeToMinutesFromTime(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Stations at location free for the slot (always includes includeStationId if set, e.g. current appt when editing). */
function computeAvailableStations({
  locationId,
  appointmentDate,
  startTime,
  endTime,
  workStations,
  allAppointments,
  excludeAppointmentId,
  includeStationId,
}) {
  if (!locationId || !appointmentDate || !startTime) return [];

  const locationStations = workStations.filter(
    (ws) => ws.location_id === locationId && ws.status === "active"
  );

  const startMinutes = timeToMinutesFromTime(startTime);
  const endMinutes = endTime ? timeToMinutesFromTime(endTime) : startMinutes + 60;

  const occupiedStationIds = allAppointments
    .filter((apt) => {
      if (excludeAppointmentId && apt.id === excludeAppointmentId) return false;
      if (apt.location_id !== locationId) return false;
      if (apt.appointment_date !== appointmentDate) return false;
      if (apt.status === "cancelled" || apt.status === "no_show") return false;
      if (apt.is_all_day) return false;

      const aptStart = timeToMinutesFromTime(apt.start_time);
      const aptEnd = apt.end_time ? timeToMinutesFromTime(apt.end_time) : aptStart + 60;

      return startMinutes < aptEnd && endMinutes > aptStart;
    })
    .map((apt) => apt.work_station_id)
    .filter(Boolean);

  return locationStations.filter(
    (ws) => !occupiedStationIds.includes(ws.id) || ws.id === includeStationId
  );
}

/** Prefer artist's saved station if free for the slot; else first available by created_at/name. */
function pickDefaultWorkStationId(availableStations, artistId, artists) {
  const preferred = artistId
    ? artists.find((a) => a.id === artistId)?.preferred_work_station_id || null
    : null;
  return pickPreferredWorkStationId(availableStations, preferred);
}

function numSnapshot(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Deposit / Stripe edge functions read `deposit_amount` from the DB. Changing appointment type
 * only updates local form state until Save — sync these snapshot fields first so recording
 * a deposit or creating a link sees the correct amount.
 */
function buildAppointmentTypeDepositSnapshotPatch(appointment, formData, sanitizeUuid) {
  if (!appointment?.id) return null;
  const typeSaved = appointment.appointment_type_id || "";
  const typeForm = formData.appointment_type_id || "";
  const depSaved = numSnapshot(appointment.deposit_amount);
  const depForm = numSnapshot(formData.deposit_amount);
  const endSaved = appointment.end_time || "";
  const endForm = formData.end_time || "";
  const estSaved = numSnapshot(appointment.total_estimate);
  const estForm = numSnapshot(formData.total_estimate);

  if (
    typeSaved !== typeForm ||
    depSaved !== depForm ||
    endSaved !== endForm ||
    estSaved !== estForm
  ) {
    return {
      appointment_type_id: sanitizeUuid(formData.appointment_type_id),
      deposit_amount: formData.deposit_amount,
      end_time: formData.end_time,
      total_estimate: formData.total_estimate,
    };
  }
  return null;
}

async function persistAppointmentDepositSnapshotIfStale(appointment, formData, queryClient) {
  const sanitizeUuid = (v) => (v === "" || v == null ? null : v);
  const patch = buildAppointmentTypeDepositSnapshotPatch(appointment, formData, sanitizeUuid);
  if (!patch) return { ok: true };
  try {
    await base44.entities.Appointment.update(appointment.id, patch);
    await queryClient.invalidateQueries({ queryKey: ["appointments"] });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "Could not save appointment changes." };
  }
}

export default function AppointmentDialog({ open, onOpenChange, appointment, defaultDate, defaultArtistId, defaultStartTime, artists, locations, currentUser, userArtist }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    artist_id: '',
    location_id: '',
    work_station_id: '',
    customer_id: '',
    appointment_type_id: '',
    client_name: '',
    client_email: '',
    client_phone: '',
    appointment_date: defaultDate ? format(defaultDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
    start_time: defaultStartTime || DEFAULT_BOOKING_START_TIME,
    end_time: defaultStartTime
      ? addMinutesToTime(defaultStartTime, 120)
      : DEFAULT_APPOINTMENT_END_TIME,
    is_all_day: false,
    deposit_amount: 0,
    total_estimate: 0,
    design_description: '',
    placement: '',
    appointment_name: '',
    notes: '',
    status: 'scheduled'
  });

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showCustomerDialog, setShowCustomerDialog] = useState(false);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [showCheckoutDialog, setShowCheckoutDialog] = useState(false);
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [depositLinkLoading, setDepositLinkLoading] = useState(false);
  const [depositLinkMessage, setDepositLinkMessage] = useState(null);
  const [depositCheckoutUrl, setDepositCheckoutUrl] = useState(null);
  const [copiedDepositUrl, setCopiedDepositUrl] = useState(false);

  const [depositPaidInPersonCreate, setDepositPaidInPersonCreate] = useState(false);
  const [inPersonDepositMethod, setInPersonDepositMethod] = useState("Cash");
  const [inPersonDepositNote, setInPersonDepositNote] = useState("");
  const [inPersonDepositAmountInput, setInPersonDepositAmountInput] = useState("");
  const [recordInPersonLoading, setRecordInPersonLoading] = useState(false);
  const [editingPaymentMethod, setEditingPaymentMethod] = useState(false);
  const [paymentMethodDrafts, setPaymentMethodDrafts] = useState([]);
  const [paymentMethodError, setPaymentMethodError] = useState(null);
  const [editingDeposit, setEditingDeposit] = useState(false);
  const [depositDraftMethod, setDepositDraftMethod] = useState("Cash");
  const [depositDraftAmount, setDepositDraftAmount] = useState("");
  const [depositDraftNote, setDepositDraftNote] = useState("");
  const [depositEditError, setDepositEditError] = useState(null);

  const [validationErrors, setValidationErrors] = useState({
    artistConflict: null,
    stationsFull: false
  });

  const [emailSendWarning, setEmailSendWarning] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [savingHealthNotes, setSavingHealthNotes] = useState(false);

  const userRole = useMemo(() => {
    if (!currentUser) return null;
    return normalizeUserRole(currentUser.user_role || (currentUser.role === 'admin' ? 'Admin' : 'Front_Desk'));
  }, [currentUser]);

  const isArtist = useMemo(() => userRole === 'Artist', [userRole]);
  const isAdmin = useMemo(() => userRole === 'Admin' || userRole === 'Owner', [userRole]);
  const selectableLocations = useMemo(
    () =>
      sortLocationsByCreatedAt(
        locations.filter(
          (location) => location.is_active || location.id === formData.location_id
        )
      ),
    [locations, formData.location_id]
  );
  
  const canEdit = () => {
    if (!currentUser) return false;
    // Completed appointments are locked for Front_Desk and Artists
    if (appointment && appointment.status === 'completed') {
      return isAdmin;
    }
    if (isAdmin || userRole === 'Front_Desk') return true;
    // Artists can create new appointments or edit their own
    if (isArtist && userArtist) {
      if (!appointment) return true; // Can create new
      if (appointment.artist_id === userArtist.id) return true; // Can edit own
    }
    return false;
  };

  // Health Notes are often filled in at the end of the day/week, after checkout.
  // Allow any studio user to update just the Health Notes on a checked-out
  // (completed) appointment without unlocking it.
  const canEditHealthNotes = () => {
    if (!currentUser) return false;
    if (canEdit()) return true; // full editors can already edit everything
    if (appointment && appointment.status === 'completed') return true;
    return false;
  };

  const canCheckout = () => {
    if (!currentUser || !appointment) return false;
    if (appointment.status === 'completed') return false;
    if (!userRole) return false;
    // All studio roles may run checkout; tax and payment are captured there.
    return ['Admin', 'Owner', 'Front_Desk', 'Artist'].includes(userRole);
  };

  const canUnlockAppointment = () => {
    if (!currentUser || !appointment) return false;
    return isAdmin && appointment.status === 'completed';
  };

  const canRecordRefund = () => {
    if (!currentUser || !appointment) return false;
    if (appointment.status !== 'completed') return false;
    return isAdmin || userRole === 'Front_Desk';
  };

  const canEditCheckoutPayment = () => {
    if (!currentUser || !appointment) return false;
    if (appointment.status !== 'completed') return false;
    return isAdmin || userRole === 'Front_Desk';
  };

  const canDelete = () => {
    if (!currentUser || !appointment) return false;
    if (isAdmin || userRole === 'Front_Desk') return true;
    if (isArtist && userArtist && appointment.artist_id === userArtist.id) return true;
    return false;
  };

  const canEditArtist = () => {
    return isAdmin || userRole === 'Front_Desk';
  };

  const canEditLocation = () => {
    return canEdit();
  };

  const { options: paymentMethodOptions, values: paymentMethodValues } =
    useCheckoutPaymentMethods(currentUser?.studio_id);

  const { data: customers = EMPTY_ARRAY } = useQuery({
    queryKey: ['customers', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.Customer.filter({ studio_id: currentUser.studio_id });
    },
    enabled: !!currentUser?.studio_id
  });

  const { data: appointmentTypes = EMPTY_ARRAY } = useQuery({
    queryKey: ['appointmentTypes', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.AppointmentType.filter({ studio_id: currentUser.studio_id });
    },
    enabled: !!currentUser?.studio_id
  });

  const { data: reportingCategories = EMPTY_ARRAY } = useQuery({
    queryKey: ['reportingCategories', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.ReportingCategory.filter({ studio_id: currentUser.studio_id });
    },
    enabled: !!currentUser?.studio_id
  });

  const { data: allAppointments = EMPTY_ARRAY } = useQuery({
    queryKey: ['appointments', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.Appointment.filter({ studio_id: currentUser.studio_id });
    },
    enabled: !!currentUser?.studio_id
  });

  const { data: workStations = EMPTY_ARRAY } = useQuery({
    queryKey: ['workStations', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.WorkStation.filter({ studio_id: currentUser.studio_id });
    },
    enabled: !!currentUser?.studio_id
  });

  const { data: availabilities = EMPTY_ARRAY } = useQuery({
    queryKey: ['availabilities', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.Availability.filter({ studio_id: currentUser.studio_id });
    },
    enabled: open && !!currentUser?.studio_id
  });

  const { data: weeklySchedules = EMPTY_ARRAY } = useQuery({
    queryKey: ['weeklySchedules', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.ArtistWeeklySchedule.filter({ studio_id: currentUser.studio_id });
    },
    enabled: open && !!currentUser?.studio_id
  });

  const { data: serviceExclusions = EMPTY_ARRAY } = useQuery({
    queryKey: ['artistAppointmentTypeExclusions', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.ArtistAppointmentTypeExclusion.filter({ studio_id: currentUser.studio_id });
    },
    enabled: !!currentUser?.studio_id
  });

  const { data: studio } = useQuery({
    queryKey: ['studio', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return null;
      const studios = await base44.entities.Studio.filter({ id: currentUser.studio_id });
      return studios[0] || null;
    },
    enabled: !!currentUser?.studio_id
  });

  const { data: checkoutSaleData, isLoading: checkoutChargesLoading } = useQuery({
    queryKey: ['checkoutSale', appointment?.id],
    queryFn: async () => {
      if (!appointment?.id) return null;
      const sales = await base44.entities.Sale.filter({ appointment_id: appointment.id });
      const sale = sales?.[0];
      if (!sale) {
        const legacyCharges = await base44.entities.AppointmentCharge.filter({
          appointment_id: appointment.id,
        });
        return { sale: null, lineItems: legacyCharges };
      }
      const lineItems = await base44.entities.SaleLineItem.filter({ sale_id: sale.id });
      return { sale, lineItems };
    },
    enabled: open && !!appointment?.id && appointment.status === 'completed',
  });

  const checkoutSummary = useMemo(() => {
    if (!checkoutSaleData || !appointment) return null;
    const { sale, lineItems } = checkoutSaleData;
    if (!lineItems?.length) return null;
    if (sale) {
      return buildCheckoutSummaryFromSale(sale, lineItems, appointment);
    }
    return buildCheckoutSummaryFromLegacyCharges(lineItems, appointment);
  }, [checkoutSaleData, appointment]);

  // Use userArtist?.id for stable dependency instead of the full object
  const userArtistId = userArtist?.id;

  // Prefer list cache so deposit_status / status update after mutations without stale props
  const appointmentForForm = useMemo(() => {
    if (!appointment?.id) return null;
    const cached = allAppointments.find((a) => a.id === appointment.id);
    return cached ?? appointment;
  }, [appointment, allAppointments]);

  useEffect(() => {
    setEditingPaymentMethod(false);
    setPaymentMethodError(null);
  }, [appointment?.id, open]);

  useEffect(() => {
    if (appointment) {
      const src = appointmentForForm || appointment;
      // Merge appointment with defaults to ensure no undefined/null values for inputs
      setFormData({
        ...src,
        // Ensure string fields have empty string defaults (not null/undefined)
        artist_id: src.artist_id || '',
        location_id: src.location_id || '',
        work_station_id: src.work_station_id || '',
        customer_id: src.customer_id || '',
        appointment_type_id: src.appointment_type_id || '',
        client_name: src.client_name || '',
        client_email: src.client_email || '',
        client_phone: src.client_phone || '',
        appointment_date: src.appointment_date || format(new Date(), 'yyyy-MM-dd'),
        start_time: src.start_time || DEFAULT_BOOKING_START_TIME,
        design_description: src.design_description || '',
        placement: src.placement || '',
        appointment_name: src.appointment_name || '',
        notes: src.notes || '',
        status: src.status || 'scheduled',
        end_time: src.end_time || DEFAULT_APPOINTMENT_END_TIME,
        is_all_day: src.is_all_day || false,
        deposit_amount: src.deposit_amount ?? 0,
        total_estimate: src.total_estimate ?? 0,
        tax_amount: src.tax_amount ?? 0,
      });

      if (src.customer_id) {
        const customer = customers.find(c => c.id === src.customer_id);
        setSelectedCustomer(customer || null);
      } else {
        setSelectedCustomer(null);
      }
    } else {
      // For new appointments, auto-assign artist if user is an artist
      const initialArtistId = defaultArtistId
        || ((isArtist && !isAdmin && userArtistId) ? userArtistId : '');
      const defaultLocationId = resolveDefaultLocationId(locations, initialArtistId, artists, "");

      const initialStartTime = defaultStartTime || DEFAULT_BOOKING_START_TIME;
      const initialEndTime = defaultStartTime
        ? addMinutesToTime(defaultStartTime, 120)
        : DEFAULT_APPOINTMENT_END_TIME;

      setFormData({
        artist_id: initialArtistId,
        location_id: defaultLocationId,
        work_station_id: '',
        customer_id: '',
        appointment_type_id: '',
        client_name: '',
        client_email: '',
        client_phone: '',
        appointment_date: defaultDate ? format(defaultDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
        start_time: initialStartTime,
        end_time: initialEndTime,
        is_all_day: false,
        deposit_amount: 0,
        total_estimate: 0,
        tax_amount: 0,
        design_description: '',
        placement: '',
        appointment_name: '',
        notes: '',
        status: 'scheduled'
      });
      setSelectedCustomer(null);
    }
    setValidationErrors({ artistConflict: null, stationsFull: false });
    setDepositLinkMessage(null);
    setDepositCheckoutUrl(null);
    setCopiedDepositUrl(false);
    setDepositPaidInPersonCreate(false);
    setInPersonDepositMethod("Cash");
    setInPersonDepositNote("");
    setInPersonDepositAmountInput("");
    setRecordInPersonLoading(false);
    setEditingDeposit(false);
    setDepositEditError(null);
    setSaveError(null);
  }, [appointment, appointmentForForm, defaultDate, defaultArtistId, defaultStartTime, open, isArtist, isAdmin, userArtistId, customers, artists, locations]);

  useEffect(() => {
    const canValidateTimed =
      formData.artist_id &&
      formData.appointment_date &&
      formData.start_time &&
      formData.end_time &&
      !formData.is_all_day;
    const canValidateAllDay =
      formData.artist_id && formData.appointment_date && formData.is_all_day;

    if (open && (canValidateTimed || canValidateAllDay)) {
      validateAppointment();
    } else {
      setValidationErrors({ artistConflict: null, stationsFull: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.artist_id, formData.appointment_date, formData.start_time, formData.end_time, formData.is_all_day, formData.location_id, formData.work_station_id, open, allAppointments, workStations, availabilities, appointment, weeklySchedules, locations]);

  const availableStations = useMemo(
    () =>
      computeAvailableStations({
        locationId: formData.location_id,
        appointmentDate: formData.appointment_date,
        startTime: formData.start_time,
        endTime: formData.end_time,
        workStations,
        allAppointments,
        excludeAppointmentId: appointment?.id,
        includeStationId: appointment?.work_station_id,
      }),
    [
      formData.location_id,
      formData.appointment_date,
      formData.start_time,
      formData.end_time,
      workStations,
      allAppointments,
      appointment?.id,
      appointment?.work_station_id,
    ]
  );

  useEffect(() => {
    if (!open || appointment) return;
    if (!formData.location_id || !formData.appointment_date || !formData.start_time) return;

    setFormData((prev) => {
      const stations = computeAvailableStations({
        locationId: prev.location_id,
        appointmentDate: prev.appointment_date,
        startTime: prev.start_time,
        endTime: prev.end_time,
        workStations,
        allAppointments,
        excludeAppointmentId: undefined,
        includeStationId: undefined,
      });
      if (prev.work_station_id && stations.some((s) => s.id === prev.work_station_id)) {
        return prev;
      }
      const pick = pickDefaultWorkStationId(stations, prev.artist_id, artists);
      if (pick === prev.work_station_id) return prev;
      return { ...prev, work_station_id: pick };
    });
  }, [
    open,
    appointment,
    formData.artist_id,
    formData.location_id,
    formData.appointment_date,
    formData.start_time,
    formData.end_time,
    workStations,
    allAppointments,
    artists,
  ]);

  const depositSatisfied = useMemo(() => {
    const ds = formData.deposit_status;
    const st = formData.status;
    return ds === "paid" || st === "deposit_paid";
  }, [formData.deposit_status, formData.status]);

  const handleCustomerSelect = (customer) => {
    const preferredLocation = locations.find(location => location.id === customer.preferred_location_id);
    setSelectedCustomer(customer);
    setFormData(prev => ({
      ...prev,
      customer_id: customer.id,
      client_name: customer.name,
      client_email: customer.email || '',
      client_phone: customer.phone_number || '',
      location_id: preferredLocation?.is_active ? customer.preferred_location_id : prev.location_id,
      work_station_id:
        preferredLocation?.is_active && customer.preferred_location_id !== prev.location_id
          ? ''
          : prev.work_station_id,
    }));
  };

  const handleClearCustomer = () => {
    setSelectedCustomer(null);
    setFormData((prev) => ({
      ...prev,
      customer_id: '',
      client_name: '',
      client_email: '',
      client_phone: '',
    }));
  };

  const handleArtistChange = (value) => {
    setFormData((prev) => {
      const next = {
        ...prev,
        artist_id: value,
        location_id: resolveDefaultLocationId(locations, value, artists, prev.location_id),
        work_station_id: '',
      };
      if (
        prev.appointment_type_id &&
        value &&
        !canArtistBookAppointmentType(value, prev.appointment_type_id, buildExclusionKeySet(serviceExclusions))
      ) {
        next.appointment_type_id = '';
      }
      return next;
    });
  };

  const resolveClientEmail = () => {
    if (selectedCustomer?.email?.trim()) return selectedCustomer.email.trim();
    return null;
  };

  const shouldShowEmailWarnings = studio?.subscription_tier === "plus";

  const getEmailWarningMessage = () => {
    if (!shouldShowEmailWarnings) return null;
    if (!selectedCustomer) return null;

    const email = resolveClientEmail();
    if (!email) return "No email address available. Email reminders will be skipped.";
    if (selectedCustomer?.email_bounced) {
      return `This email bounced${selectedCustomer.email_bounce_reason ? `: ${selectedCustomer.email_bounce_reason}` : "."}`;
    }
    if (selectedCustomer?.email_unsubscribed) {
      return "This customer has unsubscribed from email reminders.";
    }
    return null;
  };

  const handleAppointmentTypeSelect = (typeId) => {
    const type = appointmentTypes.find(t => t.id === typeId);
    if (type) {
      setFormData(prev => {
        const keys = buildExclusionKeySet(serviceExclusions);
        const clearArtist =
          prev.artist_id &&
          typeId &&
          !canArtistBookAppointmentType(prev.artist_id, typeId, keys);
        if (prev.is_all_day) {
          const svc = type.service_cost != null ? Number(type.service_cost) : NaN;
          return {
            ...prev,
            appointment_type_id: typeId,
            ...(clearArtist ? { artist_id: '' } : {}),
            deposit_amount: type.default_deposit,
            ...(Number.isFinite(svc) && svc > 0 ? { total_estimate: svc } : {}),
          };
        }
        const newEnd = addMinutesToTime(prev.start_time, type.default_duration_minutes || 120);
        const svc = type.service_cost != null ? Number(type.service_cost) : NaN;
        return {
          ...prev,
          appointment_type_id: typeId,
          ...(clearArtist ? { artist_id: '' } : {}),
          end_time: newEnd,
          deposit_amount: type.default_deposit,
          ...(Number.isFinite(svc) && svc > 0 ? { total_estimate: svc } : {}),
        };
      });
    }
  };

  const isActiveAppointment = (apt) =>
    apt.status !== 'cancelled' && apt.status !== 'no_show';

  const validateAppointment = () => {
    const errors = {
      artistConflict: null,
      stationsFull: false
    };

    if (!formData.artist_id || !formData.appointment_date) {
      setValidationErrors(errors);
      return;
    }

    const appointmentDate = parseISO(formData.appointment_date + 'T00:00:00');

    if (formData.is_all_day) {
      const unavailableSlot = availabilities.find(avail => {
        if (avail.artist_id !== formData.artist_id) return false;
        if (!avail.is_blocked) return false;
        const availStartDate = parseISO(avail.start_date + 'T00:00:00');
        const availEndDate = parseISO(avail.end_date + 'T00:00:00');
        const isDateInRange = appointmentDate >= availStartDate && appointmentDate <= availEndDate;
        if (!isDateInRange) return false;
        if (avail.location_id && avail.location_id !== formData.location_id) return false;
        return avail.is_all_day;
      });

      if (unavailableSlot) {
        const location = unavailableSlot.location_id
          ? locations.find(l => l.id === unavailableSlot.location_id)?.name || 'this location'
          : 'all locations';
        errors.artistConflict = `This artist is unavailable all day at ${location}.`;
      } else {
        const conflictingAppointment = allAppointments.find(apt => {
          if (appointment && apt.id === appointment.id) return false;
          if (apt.artist_id !== formData.artist_id) return false;
          if (apt.appointment_date !== formData.appointment_date) return false;
          if (!isActiveAppointment(apt)) return false;
          return true;
        });

        if (conflictingAppointment) {
          if (conflictingAppointment.is_all_day) {
            errors.artistConflict = 'This artist already has an all-day appointment on this date.';
          } else {
            const conflictLocation = locations.find(l => l.id === conflictingAppointment.location_id);
            errors.artistConflict = `This artist is already booked from ${formatTime12h(conflictingAppointment.start_time)} to ${formatTime12h(conflictingAppointment.end_time)} at ${conflictLocation?.name || 'another location'}.`;
          }
        }
      }

      setValidationErrors(errors);
      return;
    }

    if (formData.start_time && formData.end_time) {
      const startMinutes = timeToMinutes(formData.start_time);
      const endMinutes = timeToMinutes(formData.end_time);

      const allDayConflict = allAppointments.find(apt => {
        if (appointment && apt.id === appointment.id) return false;
        if (apt.artist_id !== formData.artist_id) return false;
        if (apt.appointment_date !== formData.appointment_date) return false;
        if (!isActiveAppointment(apt)) return false;
        return apt.is_all_day;
      });

      if (allDayConflict) {
        errors.artistConflict = 'This artist has an all-day appointment on this date.';
      } else {
      const unavailableSlot = availabilities.find(avail => {
        if (avail.artist_id !== formData.artist_id) return false;
        if (!avail.is_blocked) return false;

        const availStartDate = parseISO(avail.start_date + 'T00:00:00');
        const availEndDate = parseISO(avail.end_date + 'T00:00:00');

        const isDateInRange = appointmentDate >= availStartDate && appointmentDate <= availEndDate;
        if (!isDateInRange) return false;

        if (avail.location_id && avail.location_id !== formData.location_id) return false;

        if (avail.is_all_day) return true;

        const availStart = timeToMinutes(avail.start_time);
        const availEnd = timeToMinutes(avail.end_time);

        return (startMinutes < availEnd && endMinutes > availStart);
      });

      if (unavailableSlot) {
        if (unavailableSlot.is_all_day) {
          const location = unavailableSlot.location_id
            ? locations.find(l => l.id === unavailableSlot.location_id)?.name || 'this location'
            : 'all locations';
          errors.artistConflict = `This artist is unavailable all day at ${location}.`;
        } else {
          const location = unavailableSlot.location_id 
            ? locations.find(l => l.id === unavailableSlot.location_id)?.name || 'this location'
            : 'all locations';
          errors.artistConflict = `This artist is unavailable from ${formatTime12h(unavailableSlot.start_time)} to ${formatTime12h(unavailableSlot.end_time)} at ${location}.`;
        }
      } else {
        const dow = appointmentDate.getDay();
        const artistWeeklyEntries = weeklySchedules.filter(
          ws => ws.artist_id === formData.artist_id && ws.day_of_week === dow && ws.is_active
        );
        const artistOneOffAvail = availabilities.filter(avail => {
          if (avail.artist_id !== formData.artist_id || avail.is_blocked) return false;
          const sd = parseISO(avail.start_date + 'T00:00:00');
          const ed = parseISO(avail.end_date + 'T00:00:00');
          return appointmentDate >= sd && appointmentDate <= ed;
        });

        const hasAnySchedule = artistWeeklyEntries.length > 0 || artistOneOffAvail.length > 0;

        if (hasAnySchedule) {
          const fitsWeekly = artistWeeklyEntries.some(ws => {
            const wsStart = timeToMinutes(ws.start_time);
            const wsEnd = timeToMinutes(ws.end_time);
            if (ws.location_id && ws.location_id !== formData.location_id) return false;
            return startMinutes >= wsStart && endMinutes <= wsEnd;
          });
          const fitsOneOff = artistOneOffAvail.some(avail => {
            const aStart = timeToMinutes(avail.start_time);
            const aEnd = timeToMinutes(avail.end_time);
            if (avail.location_id && avail.location_id !== formData.location_id) return false;
            return startMinutes >= aStart && endMinutes <= aEnd;
          });
          if (!fitsWeekly && !fitsOneOff) {
            errors.artistConflict = `This artist is not scheduled to work at this time. Check their weekly schedule or one-off availability.`;
          }
        }

        if (!errors.artistConflict) {
          const conflictingAppointment = allAppointments.find(apt => {
            if (appointment && apt.id === appointment.id) return false;
            if (apt.artist_id !== formData.artist_id) return false;
            if (apt.appointment_date !== formData.appointment_date) return false;
            if (apt.status === 'cancelled' || apt.status === 'no_show') return false;
            if (apt.is_all_day) return false;

            const aptStart = timeToMinutes(apt.start_time);
            const aptEnd = apt.end_time ? timeToMinutes(apt.end_time) : aptStart + 60;

            return (startMinutes < aptEnd && endMinutes > aptStart);
          });

          if (conflictingAppointment) {
            const conflictLocation = locations.find(l => l.id === conflictingAppointment.location_id);
            errors.artistConflict = `This artist is already booked from ${formatTime12h(conflictingAppointment.start_time)} to ${formatTime12h(conflictingAppointment.end_time)} at ${conflictLocation?.name || 'another location'}.`;
          }
        }
      }
      }
    }

    if (
      !formData.is_all_day &&
      formData.location_id &&
      formData.appointment_date &&
      formData.start_time &&
      formData.artist_id
    ) {
      const stationsForValidation = computeAvailableStations({
        locationId: formData.location_id,
        appointmentDate: formData.appointment_date,
        startTime: formData.start_time,
        endTime: formData.end_time,
        workStations,
        allAppointments,
        excludeAppointmentId: appointment?.id,
        includeStationId: appointment?.work_station_id,
      });
      if (stationsForValidation.length === 0 && formData.work_station_id === '') {
        errors.stationsFull = true;
      } else if (formData.work_station_id && !stationsForValidation.find(ws => ws.id === formData.work_station_id)) {
        if (stationsForValidation.length === 0) errors.stationsFull = true;
      }
    }

    setValidationErrors(errors);
  };

  const timeToMinutes = (time) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const createMutation = useMutation({
    mutationFn: async (vars) => {
      const createdAppointment = await base44.entities.Appointment.create(vars.dataToSave);
      return { createdAppointment, ...vars };
    },
    onSuccess: async ({
      createdAppointment,
      recordInPersonDeposit,
      inPersonDepositMethod: method,
      inPersonDepositNote: note,
      inPersonDepositAmount,
    }) => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });

      const deposit = Number(createdAppointment.deposit_amount) || 0;
      if (recordInPersonDeposit && deposit > 0) {
        const { data, error } = await supabase.functions.invoke("record-in-person-deposit", {
          body: {
            appointmentId: createdAppointment.id,
            method,
            note: note || undefined,
            amount:
              inPersonDepositAmount != null && Number.isFinite(inPersonDepositAmount)
                ? inPersonDepositAmount
                : undefined,
          },
        });
        if (error || data?.error) {
          const msg =
            data?.error ||
            error?.message ||
            "Could not record the in-person deposit.";
          window.alert(
            `Appointment was created, but ${msg} Open the appointment from the calendar and use "Record in-person deposit". Confirmation email was not sent so the customer does not get an incorrect online payment link.`
          );
          onOpenChange(false);
          resetForm();
          return;
        }
        await queryClient.refetchQueries({ queryKey: ['appointments'] });
      }

      onOpenChange(false);
      resetForm();
      await sendAppointmentEmail(createdAppointment, "created");
    },
    onError: (error) => {
      setSaveError(error?.message || 'Failed to save appointment. Please try again.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Appointment.update(id, data),
    onSuccess: async (updatedAppointment, variables) => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      onOpenChange(false);

      if (appointment) {
        const prevStatus = appointment.status;
        const nextStatus = variables?.data?.status ?? updatedAppointment?.status;

        if (nextStatus === 'cancelled' && prevStatus !== 'cancelled') {
          await sendAppointmentEmail(updatedAppointment, "cancelled");
          return;
        }

        const hasScheduleChange =
          appointment.appointment_date !== variables.data.appointment_date ||
          appointment.start_time !== variables.data.start_time ||
          appointment.location_id !== variables.data.location_id ||
          appointment.artist_id !== variables.data.artist_id ||
          appointment.appointment_type_id !== variables.data.appointment_type_id;

        if (hasScheduleChange) {
          await sendAppointmentEmail(updatedAppointment, "updated");
        }
      }
    },
    onError: (error) => {
      setSaveError(error?.message || 'Failed to update appointment. Please try again.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      try {
        return await base44.entities.Appointment.delete(id);
      } catch (error) {
        const errorText = `${error?.message || ''} ${error?.details || ''}`;
        const isPaymentReferenceError =
          error?.code === '23503' &&
          (errorText.includes('payments_appointment_id_fkey') || errorText.includes('table "payments"'));
        const isEmailEventsReferenceError =
          error?.code === '23503' &&
          (errorText.includes('email_events_appointment_id_fkey') || errorText.includes('table "email_events"'));

        if (!isPaymentReferenceError && !isEmailEventsReferenceError) throw error;

        if (isPaymentReferenceError) {
          const { error: paymentError } = await supabase
            .from('payments')
            .update({ appointment_id: null })
            .eq('appointment_id', id);
          if (paymentError) throw paymentError;
        }

        if (isEmailEventsReferenceError) {
          const { error: emailEventError } = await supabase
            .from('email_events')
            .update({ appointment_id: null })
            .eq('appointment_id', id);
          if (emailEventError) throw emailEventError;
        }

        return base44.entities.Appointment.delete(id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      onOpenChange(false);
    },
    onError: (error) => {
      setSaveError(error?.message || 'Failed to delete appointment. Please try again.');
    }
  });

  // Paid balance payment row(s) for post-checkout tender edits (split tender = 1–2 rows).
  const { data: balancePaymentRows = EMPTY_ARRAY } = useQuery({
    queryKey: ['appointmentBalancePayments', appointment?.id],
    enabled: !!(open && appointment?.id && appointment.status === 'completed'),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('id, amount, tender_type, status, metadata, purpose')
        .eq('appointment_id', appointment.id)
        .in('purpose', ['balance', 'retail'])
        .eq('status', 'paid')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  /**
   * Update tender type(s) after checkout without unlocking. Each balance payment
   * row gets its own dropdown; amounts and tips are left untouched. Writes the
   * cash-ledger rows first, then the denormalized comma-joined appointment field.
   */
  const updatePaymentMethodMutation = useMutation({
    mutationFn: async (drafts) => {
      if (!appointment?.id) throw new Error('No appointment.');
      if (!balancePaymentRows.length) throw new Error('No checkout payments to update.');
      if (drafts.length !== balancePaymentRows.length) {
        throw new Error('Payment method count mismatch.');
      }
      if (drafts.some((m) => !paymentMethodValues.includes(m))) {
        throw new Error('Choose a valid payment method for each tender.');
      }
      if (new Set(drafts).size !== drafts.length) {
        throw new Error('Each payment method can only be used once.');
      }

      for (let i = 0; i < balancePaymentRows.length; i++) {
        const { error: payErr } = await supabase
          .from('payments')
          .update({ tender_type: drafts[i], channel: 'in_person' })
          .eq('id', balancePaymentRows[i].id);
        if (payErr) throw new Error(payErr.message || 'Could not update the payment ledger.');
      }

      const joined = joinPaymentMethods(drafts);
      const { error: aptErr } = await supabase
        .from('appointments')
        .update({ payment_method: joined })
        .eq('id', appointment.id);
      if (aptErr) throw new Error(aptErr.message || 'Could not update the appointment.');
      return joined;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['checkoutSale', appointment?.id] });
      queryClient.invalidateQueries({ queryKey: ['appointmentBalancePayments', appointment?.id] });
      queryClient.invalidateQueries({ queryKey: ['reconciliations'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliationTenders'] });
      setEditingPaymentMethod(false);
    },
    onError: (err) => {
      setPaymentMethodError(err?.message || 'Failed to update payment method.');
    },
  });

  // Paid deposit payment row(s) — used to let admins correct a mis-keyed manual deposit.
  const { data: depositPaymentRows = EMPTY_ARRAY } = useQuery({
    queryKey: ['appointmentDeposit', appointment?.id],
    enabled: !!(open && appointment?.id && depositSatisfied),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('id, amount, tender_type, channel, metadata, business_date, stripe_payment_intent_id, stripe_checkout_session_id')
        .eq('appointment_id', appointment.id)
        .eq('payment_type', 'deposit')
        .eq('status', 'paid')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // A manual deposit has no Stripe references. Only a single, unambiguous manual row is editable.
  const manualDepositRow = useMemo(() => {
    const manual = depositPaymentRows.filter(
      (p) => !p.stripe_payment_intent_id && !p.stripe_checkout_session_id
    );
    const hasStripeDeposit = depositPaymentRows.some(
      (p) => p.stripe_payment_intent_id || p.stripe_checkout_session_id
    );
    if (manual.length === 1 && !hasStripeDeposit) return manual[0];
    return null;
  }, [depositPaymentRows]);

  const isEditableDeposit = isAdmin && !!manualDepositRow;

  const parseDepositMetadata = (raw) => {
    if (!raw) return {};
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    return {};
  };

  const beginEditDeposit = () => {
    if (!manualDepositRow) return;
    const meta = parseDepositMetadata(manualDepositRow.metadata);
    setDepositEditError(null);
    setDepositDraftMethod(
      paymentMethodValues.includes(manualDepositRow.tender_type)
        ? manualDepositRow.tender_type
        : (paymentMethodValues.includes(meta.method) ? meta.method : 'Cash')
    );
    setDepositDraftAmount(
      manualDepositRow.amount != null ? String(Number(manualDepositRow.amount)) : ''
    );
    setDepositDraftNote(typeof meta.note === 'string' ? meta.note : '');
    setEditingDeposit(true);
  };

  // Correct a manual deposit's amount / method / note. The cash-ledger date fields
  // (business_date, occurred_at, paid_at) are deliberately left untouched so the
  // payment stays on its original day.
  const editDepositMutation = useMutation({
    mutationFn: async () => {
      if (!manualDepositRow?.id) throw new Error('No editable deposit found.');
      const parsedAmount = Number(depositDraftAmount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Enter a valid amount greater than 0.');
      }
      const amount = Math.round(parsedAmount * 100) / 100;
      if (!paymentMethodValues.includes(depositDraftMethod)) {
        throw new Error('Choose a valid payment method.');
      }
      const note = depositDraftNote.trim().slice(0, 500);
      const nextMeta = {
        ...parseDepositMetadata(manualDepositRow.metadata),
        collection_channel: 'in_person',
        method: depositDraftMethod,
        note: note || undefined,
      };
      const { error } = await supabase
        .from('payments')
        .update({
          amount,
          tender_type: depositDraftMethod,
          channel: 'in_person',
          metadata: nextMeta,
        })
        .eq('id', manualDepositRow.id);
      if (error) throw new Error(error.message || 'Could not update the deposit.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['appointmentDeposit', appointment?.id] });
      queryClient.invalidateQueries({ queryKey: ['reconciliations'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliationTenders'] });
      setEditingDeposit(false);
    },
    onError: (err) => {
      setDepositEditError(err?.message || 'Failed to update deposit.');
    },
  });

  const renderCheckoutPaymentField = () => {
    const current =
      joinPaymentMethods(balancePaymentRows.map((p) => p.tender_type)) ||
      appointment.payment_method ||
      "";
    if (!canEditCheckoutPayment()) {
      return (
        <div>
          <span className="text-emerald-600">Payment:</span>
          <p className="font-medium text-emerald-900">{current || "N/A"}</p>
        </div>
      );
    }
    if (!editingPaymentMethod) {
      return (
        <div>
          <span className="text-emerald-600">Payment:</span>
          <div className="flex items-center gap-2">
            <p className="font-medium text-emerald-900">{current || "N/A"}</p>
            {balancePaymentRows.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setPaymentMethodError(null);
                  setPaymentMethodDrafts(
                    balancePaymentRows.map((p) =>
                      paymentMethodValues.includes(p.tender_type) ? p.tender_type : ""
                    )
                  );
                  setEditingPaymentMethod(true);
                }}
                className="text-xs text-emerald-700 underline hover:text-emerald-900"
              >
                Edit
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="col-span-2">
        <span className="text-emerald-600">Payment:</span>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {paymentMethodDrafts.map((draft, idx) => {
            const used = new Set(paymentMethodDrafts.filter((_, i) => i !== idx));
            const options = paymentMethodOptions.filter(
              ({ value }) => value === draft || !used.has(value)
            );
            return (
              <Select
                key={balancePaymentRows[idx]?.id || idx}
                value={draft || undefined}
                onValueChange={(v) => {
                  setPaymentMethodDrafts((prev) => prev.map((m, i) => (i === idx ? v : m)));
                }}
              >
                <SelectTrigger className="h-8 text-sm bg-white w-36">
                  <SelectValue placeholder={`Method ${idx + 1}`} />
                </SelectTrigger>
                <SelectContent>
                  {options.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })}
          <Button
            type="button"
            size="sm"
            className="h-8 bg-emerald-600 hover:bg-emerald-700"
            disabled={
              paymentMethodDrafts.some((m) => !m) || updatePaymentMethodMutation.isPending
            }
            onClick={() => {
              setPaymentMethodError(null);
              updatePaymentMethodMutation.mutate(paymentMethodDrafts);
            }}
          >
            {updatePaymentMethodMutation.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-emerald-800"
            disabled={updatePaymentMethodMutation.isPending}
            onClick={() => {
              setEditingPaymentMethod(false);
              setPaymentMethodError(null);
            }}
          >
            Cancel
          </Button>
        </div>
        {paymentMethodError && <p className="text-xs text-red-600 mt-1">{paymentMethodError}</p>}
        <p className="text-[10px] text-emerald-700 mt-1">
          Updates tender types only (amounts unchanged). Rebuild Daily Reconciliation to refresh tender totals.
        </p>
      </div>
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setEmailSendWarning(null);
    if (validationErrors.artistConflict || validationErrors.stationsFull) {
      return;
    }

    if (!appointment && !formData.appointment_type_id && appointmentTypes.some((t) => t.is_active)) {
      setSaveError('Please select an appointment type.');
      return;
    }

    if (
      !formData.is_all_day &&
      formData.location_id &&
      formData.appointment_date &&
      formData.start_time &&
      !formData.work_station_id
    ) {
      if (availableStations.length > 0) {
        alert('Please select a work station.');
        return;
      }
    }

    setSaveError(null);

    // UUID columns reject empty strings — convert '' → null before sending to Supabase
    const sanitizeUuid = (v) => (v === '' || v == null ? null : v);
    const {
      deposit_status,
      email_send_status,
      email_send_failed_reason,
      email_sent_at,
      reminder_primary_sent_at,
      reminder_secondary_sent_at,
      reminder_tertiary_sent_at,
      followup_quick_sent_at,
      followup_longterm_sent_at,
      followup_midterm_sent_at,
      notification_anchor_at,
      booking_source,
      created_at,
      updated_at,
      ...editableFormData
    } = formData;

    const dataToSave = {
      ...editableFormData,
      studio_id: currentUser?.studio_id,
      appointment_type_id: sanitizeUuid(formData.appointment_type_id),
      customer_id: sanitizeUuid(formData.customer_id),
      work_station_id: formData.is_all_day ? null : sanitizeUuid(formData.work_station_id),
      artist_id: sanitizeUuid(formData.artist_id),
      location_id: sanitizeUuid(formData.location_id),
      health_fields: appointment?.health_fields ?? {},
      is_all_day: formData.is_all_day,
      ...(formData.is_all_day ? { start_time: null, end_time: null } : {}),
    };

    // Tax is set at checkout only; do not persist it from the booking form.
    if (formData.status !== "completed") {
      delete dataToSave.tax_amount;
    }

    if (appointment && formData.status === appointment.status) {
      delete dataToSave.status;
    }

    if (appointment) {
      updateMutation.mutate({ id: appointment.id, data: dataToSave });
    } else {
      dataToSave.booking_source = "staff";
      dataToSave.notification_anchor_at = new Date().toISOString();
      const depositNum = Number(formData.deposit_amount) || 0;
      const recordInPersonDeposit = depositPaidInPersonCreate && depositNum > 0;
      let inPersonDepositAmount = null;
      if (recordInPersonDeposit && inPersonDepositAmountInput.trim() !== "") {
        inPersonDepositAmount = parseFloat(inPersonDepositAmountInput);
        if (!Number.isFinite(inPersonDepositAmount) || inPersonDepositAmount <= 0) {
          setSaveError("Enter a valid in-person deposit amount, or leave blank to use the full deposit.");
          return;
        }
        if (inPersonDepositAmount > depositNum + 0.0001) {
          setSaveError("In-person deposit amount cannot exceed the appointment deposit.");
          return;
        }
      }
      createMutation.mutate({
        dataToSave,
        recordInPersonDeposit,
        inPersonDepositMethod,
        inPersonDepositNote: inPersonDepositNote.trim(),
        inPersonDepositAmount,
      });
    }
  };

  const sendAppointmentEmail = async (appointmentRecord, eventType) => {
    try {
      if (!studio) return;

      const { data, error } = await supabase.functions.invoke("send-appointment-email", {
        body: {
          appointmentId: appointmentRecord.id,
          eventType
        }
      });

      if (error || data?.skipped || data?.error) {
        setEmailSendWarning(
          data?.message ||
          data?.error ||
          "Email could not be sent. Please verify the customer email."
        );
      }
    } catch (err) {
      setEmailSendWarning("Email could not be sent. Please verify the customer email.");
      console.error("Failed to send appointment email:", err);
    }
  };

  const handleSendDepositLink = async () => {
    if (!appointment) return;
    setDepositLinkLoading(true);
    setDepositLinkMessage(null);
    setDepositCheckoutUrl(null);
    setCopiedDepositUrl(false);
    try {
      const sync = await persistAppointmentDepositSnapshotIfStale(appointment, formData, queryClient);
      if (!sync.ok) {
        setDepositLinkMessage({ type: "error", text: sync.error || "Could not save appointment before creating link." });
        return;
      }
      const { data, error } = await supabase.functions.invoke("create-deposit-checkout", {
        body: { appointmentId: appointment.id }
      });
      if (error || data?.error) {
        setDepositLinkMessage({ type: 'error', text: data?.error || 'Failed to create deposit link.' });
      } else if (data?.paid) {
        setDepositLinkMessage({
          type: 'success',
          text: 'Deposit already paid. Any online payment link has been cancelled.',
        });
        setFormData((prev) => ({
          ...prev,
          deposit_status: 'paid',
          status: prev.status === 'completed' ? prev.status : 'deposit_paid',
        }));
        queryClient.invalidateQueries({ queryKey: ['appointments'] });
      } else if (data?.checkout_url) {
        setDepositCheckoutUrl(data.checkout_url);
        try {
          await navigator.clipboard.writeText(data.checkout_url);
          setDepositLinkMessage({
            type: 'success',
            text: data?.reused ? 'Existing deposit link copied to clipboard!' : 'Deposit link created and copied to clipboard!'
          });
        } catch (_) {
          setDepositLinkMessage({
            type: 'success',
            text: data?.reused ? 'Existing deposit link found. Copy the link below to share with the client.' : 'Deposit link created! Copy the link below to share with the client.'
          });
        }
        queryClient.invalidateQueries({ queryKey: ['appointments'] });
      }
    } catch (err) {
      setDepositLinkMessage({ type: 'error', text: 'Failed to create deposit link.' });
    } finally {
      setDepositLinkLoading(false);
    }
  };

  const handleRecordInPersonDeposit = async () => {
    if (!appointment) return;
    setRecordInPersonLoading(true);
    setDepositLinkMessage(null);
    try {
      const sync = await persistAppointmentDepositSnapshotIfStale(appointment, formData, queryClient);
      if (!sync.ok) {
        setDepositLinkMessage({ type: "error", text: sync.error || "Could not save appointment before recording deposit." });
        return;
      }
      const trimmedAmt = inPersonDepositAmountInput.trim();
      let amountPayload = undefined;
      if (trimmedAmt !== "") {
        const parsed = parseFloat(trimmedAmt);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setDepositLinkMessage({ type: 'error', text: 'Enter a valid amount or leave blank for the full deposit.' });
          setRecordInPersonLoading(false);
          return;
        }
        const due = Number(formData.deposit_amount) || 0;
        if (parsed > due + 0.0001) {
          setDepositLinkMessage({ type: 'error', text: `Amount cannot exceed deposit due (${due.toFixed(2)}).` });
          setRecordInPersonLoading(false);
          return;
        }
        amountPayload = parsed;
      }
      const { data, error } = await supabase.functions.invoke("record-in-person-deposit", {
        body: {
          appointmentId: appointment.id,
          method: inPersonDepositMethod,
          note: inPersonDepositNote.trim() || undefined,
          amount: amountPayload,
        },
      });
      if (error || data?.error) {
        setDepositLinkMessage({ type: 'error', text: data?.error || error.message || 'Failed to record deposit.' });
        return;
      }
      setDepositLinkMessage({ type: 'success', text: data?.message || 'Deposit recorded.' });
      setFormData((prev) => ({
        ...prev,
        deposit_status: 'paid',
        status: prev.status === 'completed' ? prev.status : 'deposit_paid',
      }));
      setDepositCheckoutUrl(null);
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    } catch (err) {
      setDepositLinkMessage({ type: 'error', text: err?.message || 'Failed to record deposit.' });
    } finally {
      setRecordInPersonLoading(false);
    }
  };

  const handleCopyDepositUrl = async () => {
    if (!depositCheckoutUrl) return;
    try {
      await navigator.clipboard.writeText(depositCheckoutUrl);
      setCopiedDepositUrl(true);
      setTimeout(() => setCopiedDepositUrl(false), 2000);
    } catch (_) { /* ignore */ }
  };

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to ${(isArtist && !isAdmin) ? 'cancel' : 'delete'} this appointment?`)) {
      if ((isArtist && !isAdmin)) {
        updateMutation.mutate({ id: appointment.id, data: { ...formData, status: 'cancelled' } });
      } else {
        deleteMutation.mutate(appointment.id);
      }
    }
  };

  /**
   * Unhook a completed visit from revenue: reports only count completed appointments, but
   * appointment_charges rows persist. Without deleting them, a second checkout would double-count.
   */
  /**
   * Open checkout to edit a completed visit. Does not void the sale or change
   * status — Cancel leaves the appointment completed with prior data intact.
   * Completing checkout again replaces the sale/payments via finalize_sale.
   */
  const handleUnlockAppointment = () => {
    if (!appointment) return;
    setSaveError(null);
    setShowCheckoutDialog(true);
  };

  /**
   * Save only the Health Notes on a checked-out appointment. This updates the
   * single `notes` column and never touches status, totals, or appointment_charges,
   * so products/discounts captured at checkout are preserved (no unlock required).
   */
  const handleSaveHealthNotes = async () => {
    if (!appointment) return;
    setSaveError(null);
    setSavingHealthNotes(true);
    try {
      await base44.entities.Appointment.update(appointment.id, { notes: formData.notes });
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      onOpenChange(false);
    } catch (e) {
      setSaveError(e?.message || "Could not save Health Notes.");
    } finally {
      setSavingHealthNotes(false);
    }
  };

  const resetForm = () => {
    setFormData({
      artist_id: '',
      location_id: '',
      work_station_id: '',
      customer_id: '',
      appointment_type_id: '',
      client_name: '',
      client_email: '',
      client_phone: '',
      appointment_date: format(new Date(), 'yyyy-MM-dd'),
      start_time: DEFAULT_BOOKING_START_TIME,
      end_time: DEFAULT_APPOINTMENT_END_TIME,
      is_all_day: false,
      deposit_amount: 0,
      total_estimate: 0,
      design_description: '',
      placement: '',
      appointment_name: '',
      notes: '',
      status: 'scheduled'
    });
    setSelectedCustomer(null);
    setValidationErrors({ artistConflict: null, stationsFull: false });
    setDepositPaidInPersonCreate(false);
    setInPersonDepositMethod("Cash");
    setInPersonDepositNote("");
    setInPersonDepositAmountInput("");
  };

  const hasErrors = validationErrors.artistConflict || validationErrors.stationsFull;

  const exclusionKeys = useMemo(
    () => buildExclusionKeySet(serviceExclusions),
    [serviceExclusions]
  );

  const selectableArtists = useMemo(() => {
    const fallbackId =
      appointmentForForm?.artist_id ||
      appointment?.artist_id ||
      null;
    let base;
    if (isAdmin || userRole === "Front_Desk") {
      const artistsBase = isAdmin ? artists : artists.filter((a) => a.is_active);
      base = filterArtistsSelectableForBooking(artistsBase, { alwaysIncludeArtistId: fallbackId });
    } else {
      base = artists;
    }
    if (!formData.appointment_type_id) return base;
    return filterArtistsForAppointmentType(
      base,
      formData.appointment_type_id,
      exclusionKeys,
      { alwaysIncludeArtistId: fallbackId }
    );
  }, [
    isAdmin,
    userRole,
    artists,
    appointmentForForm?.artist_id,
    appointment?.artist_id,
    formData.appointment_type_id,
    exclusionKeys,
  ]);

  const activeAppointmentTypes = useMemo(() => {
    const active = appointmentTypes.filter((t) => t.is_active);
    const fallbackTypeId =
      appointmentForForm?.appointment_type_id ||
      appointment?.appointment_type_id ||
      null;
    if (!formData.artist_id) return active;
    return filterAppointmentTypesForArtist(active, formData.artist_id, exclusionKeys, {
      alwaysIncludeTypeId: fallbackTypeId,
    });
  }, [
    appointmentTypes,
    formData.artist_id,
    exclusionKeys,
    appointmentForForm?.appointment_type_id,
    appointment?.appointment_type_id,
  ]);
  const appointmentTypeSections = useMemo(() => {
    const sections = getAppointmentTypeDisplaySections(activeAppointmentTypes, reportingCategories);
    return sections
      .map((section) => ({
        ...section,
        types: [...section.types].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
      }))
      .sort((a, b) => (a.label || "").localeCompare(b.label || ""));
  }, [activeAppointmentTypes, reportingCategories]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto bg-white p-4 sm:p-6 mx-2 sm:mx-auto rounded-lg">
          <DialogHeader className="pb-2 sm:pb-4">
            <DialogTitle className="text-xl sm:text-2xl font-bold">
              {appointment ? ((isArtist && !isAdmin) ? 'View/Edit Appointment' : 'Edit Appointment') : 'New Appointment'}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {appointment ? 'Update the appointment details below.' : 'Fill in the details to create a new appointment.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
            <input type="hidden" name="studio_id" value={currentUser?.studio_id || ''} />
            {validationErrors.artistConflict && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{validationErrors.artistConflict}</AlertDescription>
              </Alert>
            )}

            {validationErrors.stationsFull && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  All work stations are booked at this location for the selected time.
                </AlertDescription>
              </Alert>
            )}

            {getEmailWarningMessage() && (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  {getEmailWarningMessage()}
                </AlertDescription>
              </Alert>
            )}

            {saveError && (
              <Alert className="border-red-200 bg-red-50">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">{saveError}</AlertDescription>
              </Alert>
            )}

            {(emailSendWarning || appointment?.email_send_status === "failed" || appointment?.email_send_status === "skipped") && (
              <Alert className="border-red-200 bg-red-50">
                <Mail className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">
                  {emailSendWarning ||
                    appointment?.email_send_failed_reason ||
                    "Email could not be sent. Please verify the customer email."}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>Customer (optional)</Label>
              <CustomerSearch
                customers={customers}
                onSelect={handleCustomerSelect}
                onNewCustomer={() => setShowCustomerDialog(true)}
                onAdvancedSearch={() => setShowAdvancedSearch(true)}
                selectedCustomer={selectedCustomer}
                emptyLabel="No customer yet"
                allowClear
                onClear={handleClearCustomer}
              />
              {!selectedCustomer && formData.client_name && (
                <p className="text-xs text-amber-600">
                  Legacy appointment — no customer linked. Search to link a customer.
                </p>
              )}
            </div>

            {activeAppointmentTypes.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="appointment_type_id">
                  Appointment Type{!appointment ? ' *' : ''}
                </Label>
                <Select
                  value={formData.appointment_type_id}
                  onValueChange={handleAppointmentTypeSelect}
                  disabled={!canEdit()}
                  required={!appointment}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={appointment ? 'Select type (optional)' : 'Select type'} />
                  </SelectTrigger>
                  <SelectContent>
                    {appointment && <SelectItem value={null}>No Type</SelectItem>}
                    {appointment && <SelectSeparator />}
                    {appointmentTypeSections.map((section) => (
                      <React.Fragment key={section.key}>
                        <SelectGroup>
                          <SelectLabel className="text-xs uppercase tracking-wide text-gray-500">
                            {section.label}
                          </SelectLabel>
                          {section.types.map(type => (
                            <SelectItem key={type.id} value={type.id}>
                              {type.name} — {formatDuration(type.default_duration_minutes)}, ${type.default_deposit} deposit
                            </SelectItem>
                          ))}
                        </SelectGroup>
                        <SelectSeparator />
                      </React.Fragment>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="space-y-2">
                <Label htmlFor="location_id" className="text-sm">Location *</Label>
                <Select
                  value={formData.location_id}
                  onValueChange={(value) => {
                    setFormData({ ...formData, location_id: value, work_station_id: '' });
                  }}
                  required
                  disabled={!canEditLocation() || !canEdit()}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableLocations.map(location => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.name}{!location.is_active ? ' (Inactive)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="artist_id" className="text-sm">Artist *</Label>
                <Select
                  value={formData.artist_id}
                  onValueChange={handleArtistChange}
                  required
                  disabled={!canEditArtist() || !canEdit()}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Select artist" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableArtists.map(artist => (
                      <SelectItem key={artist.id} value={artist.id}>
                        {artist.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 sm:p-4 rounded-lg border border-gray-200">
              <div>
                <Label htmlFor="is_all_day" className="cursor-pointer text-sm">All day</Label>
                <p className="text-xs text-gray-500">Appointment spans the entire day (no specific time)</p>
              </div>
              <Switch
                id="is_all_day"
                checked={formData.is_all_day}
                onCheckedChange={(checked) =>
                  setFormData({
                    ...formData,
                    is_all_day: checked,
                    work_station_id: checked ? '' : formData.work_station_id,
                  })
                }
                disabled={!canEdit()}
              />
            </div>

            {!formData.is_all_day && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label className="text-sm">Date *</Label>
                <Input
                  type="date"
                  value={formData.appointment_date}
                  onChange={(e) => setFormData({ ...formData, appointment_date: e.target.value, work_station_id: '' })}
                  required
                  disabled={!canEdit()}
                  className="text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="start_time" className="text-sm">Start Time *</Label>
                <TimePicker12h
                  id="start_time"
                  value={formData.start_time}
                  onChange={(newStart) => {
                    const currentDuration = timeToMinutes(formData.end_time) - timeToMinutes(formData.start_time);
                    const newEnd = addMinutesToTime(newStart, Math.max(currentDuration, MIN_APPOINTMENT_DURATION_MINUTES));
                    setFormData({ ...formData, start_time: newStart, end_time: newEnd, work_station_id: '' });
                  }}
                  required
                  disabled={!canEdit()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="end_time" className="text-sm">End Time *</Label>
                <TimePicker12h
                  id="end_time"
                  value={formData.end_time}
                  onChange={(newEnd) => setFormData({ ...formData, end_time: newEnd, work_station_id: '' })}
                  required
                  disabled={!canEdit()}
                />
              </div>
            </div>
            )}

            {!formData.is_all_day && formData.location_id && formData.appointment_date && formData.start_time && canEdit() && (
              <div className="space-y-2">
                <Label htmlFor="work_station_id">Work Station *</Label>
                <Select
                  value={formData.work_station_id}
                  onValueChange={(value) => setFormData({ ...formData, work_station_id: value })}
                  required
                  disabled={availableStations.length === 0 || !canEdit()}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={availableStations.length === 0 ? "No stations available" : "Select work station"} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableStations.map(station => (
                      <SelectItem key={station.id} value={station.id}>
                        {station.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">
                  {availableStations.length} of {workStations.filter(ws => ws.location_id === formData.location_id && ws.status === 'active').length} stations available
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:gap-4">
              <div className="space-y-2">
                <Label htmlFor="deposit_amount" className="text-sm">Deposit ($)</Label>
                <Input
                  id="deposit_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.deposit_amount}
                  onChange={(e) => setFormData({ ...formData, deposit_amount: parseFloat(e.target.value) })}
                  disabled={!canEdit()}
                  className="text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="total_estimate" className="text-sm">Estimate ($)</Label>
                <Input
                  id="total_estimate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.total_estimate}
                  onChange={(e) => setFormData({ ...formData, total_estimate: parseFloat(e.target.value) })}
                  disabled={!canEdit()}
                  className="text-sm"
                />
              </div>
            </div>

            {!appointment && formData.deposit_amount > 0 && canEdit() && (
              <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3 space-y-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="deposit-paid-in-person-create"
                    checked={depositPaidInPersonCreate}
                    onCheckedChange={(v) => setDepositPaidInPersonCreate(v === true)}
                  />
                  <div className="space-y-1">
                    <label htmlFor="deposit-paid-in-person-create" className="text-sm font-medium text-gray-800 cursor-pointer">
                      Customer already paid deposit in person
                    </label>
                    <p className="text-xs text-gray-600">
                      Confirmation email will not include an online payment link. Use when cash, card machine, or other in-shop payment was taken before saving. Appointment status will be set to deposit paid.
                    </p>
                  </div>
                </div>
                {depositPaidInPersonCreate && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-7 sm:pl-0">
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-600">Payment method</Label>
                          <Select value={inPersonDepositMethod} onValueChange={setInPersonDepositMethod}>
                            <SelectTrigger className="text-sm h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {paymentMethodOptions.map(({ value, label }) => (
                                <SelectItem key={value} value={value}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-600">Amount collected (optional)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={`Default: ${Number(formData.deposit_amount).toFixed(2)}`}
                        value={inPersonDepositAmountInput}
                        onChange={(e) => setInPersonDepositAmountInput(e.target.value)}
                        className="text-sm h-9"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label className="text-xs text-gray-600">Note (optional)</Label>
                      <Input
                        value={inPersonDepositNote}
                        onChange={(e) => setInPersonDepositNote(e.target.value)}
                        placeholder="e.g. receipt #, reference"
                        className="text-sm h-9"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {appointment && formData.deposit_amount > 0 && (
              <Accordion type="single" collapsible className="border border-gray-200 rounded-lg overflow-hidden">
                <AccordionItem value="deposit" className="border-0">
                  <AccordionTrigger className="px-3 py-2.5 hover:no-underline hover:bg-gray-50 [&[data-state=open]]:bg-gray-50">
                    <div className="flex items-center justify-between w-full pr-2">
                      <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-gray-700" />
                        <span className="text-sm font-medium text-gray-700">Deposit</span>
                      </div>
                      {depositSatisfied && (
                        <Badge className="bg-green-100 text-green-800 text-xs">Paid</Badge>
                      )}
                      {!depositSatisfied && formData.deposit_status === 'pending' && (
                        <Badge className="bg-amber-100 text-amber-800 text-xs">Link Sent</Badge>
                      )}
                      {!depositSatisfied && formData.deposit_status === 'failed' && (
                        <Badge className="bg-red-100 text-red-800 text-xs">Failed</Badge>
                      )}
                      {!depositSatisfied && (!formData.deposit_status || formData.deposit_status === 'none') && (
                        <Badge className="bg-gray-100 text-gray-600 text-xs">Unpaid</Badge>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3 pt-0 space-y-3">
                    {depositSatisfied ? (
                      <div className="space-y-3">
                        <div className="flex gap-3 rounded-lg border border-green-200 bg-green-50/80 p-3">
                          <CheckCircle className="w-5 h-5 text-green-700 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-green-900">Deposit already paid</p>
                            <p className="text-xs text-green-800 mt-1">
                              The deposit for this appointment has been collected (online or recorded in person). No further deposit action is needed.
                            </p>
                          </div>
                        </div>

                        {isEditableDeposit && !editingDeposit && (
                          <div className="rounded-lg border border-gray-200 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs text-gray-700">
                                <p className="font-medium text-gray-800">
                                  Recorded: {manualDepositRow.tender_type || '—'} · ${Number(manualDepositRow.amount || 0).toFixed(2)}
                                </p>
                                {manualDepositRow.business_date && (
                                  <p className="text-gray-500 mt-0.5">Payment day: {manualDepositRow.business_date}</p>
                                )}
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="shrink-0"
                                onClick={beginEditDeposit}
                              >
                                Edit deposit
                              </Button>
                            </div>
                          </div>
                        )}

                        {isEditableDeposit && editingDeposit && (
                          <div className="rounded-lg border border-gray-200 p-3 space-y-3">
                            <p className="text-xs font-medium text-gray-700">Correct recorded deposit</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-2">
                                <Label className="text-xs text-gray-600">Payment method</Label>
                                <Select value={depositDraftMethod} onValueChange={setDepositDraftMethod}>
                                  <SelectTrigger className="text-sm h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {paymentMethodOptions.map(({ value, label }) => (
                                      <SelectItem key={value} value={value}>{label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs text-gray-600">Amount</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={depositDraftAmount}
                                  onChange={(e) => setDepositDraftAmount(e.target.value)}
                                  className="text-sm h-9"
                                />
                              </div>
                              <div className="space-y-2 sm:col-span-2">
                                <Label className="text-xs text-gray-600">Note (optional)</Label>
                                <Input
                                  value={depositDraftNote}
                                  onChange={(e) => setDepositDraftNote(e.target.value)}
                                  placeholder="e.g. receipt #, reference"
                                  className="text-sm h-9"
                                />
                              </div>
                            </div>
                            <p className="text-xs text-gray-500">
                              Payment day{manualDepositRow.business_date ? ` (${manualDepositRow.business_date})` : ''} stays the same.
                            </p>
                            {depositEditError && (
                              <p className="text-xs text-red-600">{depositEditError}</p>
                            )}
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                className="bg-emerald-700 hover:bg-emerald-800"
                                onClick={() => editDepositMutation.mutate()}
                                disabled={editDepositMutation.isPending}
                              >
                                {editDepositMutation.isPending ? (
                                  <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Saving...
                                  </>
                                ) : (
                                  <>
                                    <Save className="w-4 h-4 mr-2" />
                                    Save changes
                                  </>
                                )}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => { setEditingDeposit(false); setDepositEditError(null); }}
                                disabled={editDepositMutation.isPending}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        {studio?.stripe_charges_enabled ? (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-gray-700">Pay online (Stripe)</p>
                            <p className="text-xs text-gray-600">
                              Create or retrieve a checkout link to send or show the client. Links expire after 12 hours.
                            </p>
                            {canEdit() && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full text-purple-700 border-purple-200 hover:bg-purple-50"
                                onClick={handleSendDepositLink}
                                disabled={depositLinkLoading}
                              >
                                {depositLinkLoading ? (
                                  <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Creating link...
                                  </>
                                ) : (
                                  <>
                                    <Link2 className="w-4 h-4 mr-2" />
                                    {formData.deposit_status === 'pending' ? 'Show deposit link' : 'Create deposit link'}
                                  </>
                                )}
                              </Button>
                            )}
                            {depositCheckoutUrl && (
                              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5">
                                <input
                                  readOnly
                                  value={depositCheckoutUrl}
                                  className="text-xs text-gray-600 flex-1 bg-transparent min-w-0 truncate outline-none"
                                  onFocus={e => e.target.select()}
                                />
                                <button
                                  type="button"
                                  onClick={handleCopyDepositUrl}
                                  className="shrink-0 text-gray-400 hover:text-gray-700 transition-colors"
                                  title="Copy link"
                                >
                                  {copiedDepositUrl
                                    ? <Check className="w-3.5 h-3.5 text-green-600" />
                                    : <Copy className="w-3.5 h-3.5" />
                                  }
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-600">
                            Stripe is not connected for this studio. Record an in-person deposit below, or connect Stripe under studio settings to generate payment links.
                          </p>
                        )}

                        {canEdit() && (
                          <div className={`space-y-3 ${studio?.stripe_charges_enabled ? 'border-t border-gray-200 pt-3' : ''}`}>
                            <div>
                              <p className="text-xs font-medium text-gray-700">Pay in person</p>
                              <p className="text-xs text-gray-600 mt-1">
                                Record cash, e-transfer, or card taken at the shop (non-Stripe). Any pending online deposit link will be cancelled.
                              </p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-2">
                                <Label className="text-xs text-gray-600">Payment method</Label>
                          <Select value={inPersonDepositMethod} onValueChange={setInPersonDepositMethod}>
                            <SelectTrigger className="text-sm h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {paymentMethodOptions.map(({ value, label }) => (
                                <SelectItem key={value} value={value}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs text-gray-600">Amount collected (optional)</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  placeholder={`Default: ${Number(formData.deposit_amount).toFixed(2)}`}
                                  value={inPersonDepositAmountInput}
                                  onChange={(e) => setInPersonDepositAmountInput(e.target.value)}
                                  className="text-sm h-9"
                                />
                              </div>
                              <div className="space-y-2 sm:col-span-2">
                                <Label className="text-xs text-gray-600">Note (optional)</Label>
                                <Input
                                  value={inPersonDepositNote}
                                  onChange={(e) => setInPersonDepositNote(e.target.value)}
                                  placeholder="e.g. receipt #, reference"
                                  className="text-sm h-9"
                                />
                              </div>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              className="w-full sm:w-auto bg-emerald-700 hover:bg-emerald-800"
                              onClick={handleRecordInPersonDeposit}
                              disabled={recordInPersonLoading}
                            >
                              {recordInPersonLoading ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Recording…
                                </>
                              ) : (
                                "Record in-person deposit"
                              )}
                            </Button>
                          </div>
                        )}

                        {depositLinkMessage && (
                          <p className={`text-xs ${depositLinkMessage.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                            {depositLinkMessage.text}
                          </p>
                        )}
                      </>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            <div className="space-y-2">
              <Label htmlFor="appointment_name" className="text-sm">Appointment Name</Label>
              <Input
                id="appointment_name"
                value={formData.appointment_name}
                onChange={(e) => setFormData({ ...formData, appointment_name: e.target.value })}
                placeholder="e.g., Sleeve consult, Touch-up"
                disabled={!canEdit()}
                className="text-sm"
              />
              <p className="text-xs text-gray-500">Optional label on the calendar beside the customer name. If left blank, the appointment type is shown instead.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="design_description" className="text-sm">Design Description</Label>
              {canEdit() ? (
                <>
                  <Textarea
                    id="design_description"
                    value={formData.design_description}
                    onChange={(e) => setFormData({ ...formData, design_description: e.target.value })}
                    rows={2}
                    className="text-sm"
                  />
                  {textContainsUrl(formData.design_description) && (
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 [overflow-wrap:anywhere]">
                      <LinkifiedText text={formData.design_description} />
                    </div>
                  )}
                </>
              ) : (
                <div
                  id="design_description"
                  className="min-h-[60px] rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-gray-700 [overflow-wrap:anywhere]"
                >
                  {formData.design_description ? (
                    <LinkifiedText text={formData.design_description} />
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="placement" className="text-sm">Placement</Label>
              <Input
                id="placement"
                value={formData.placement}
                onChange={(e) => setFormData({ ...formData, placement: e.target.value })}
                placeholder="e.g., Upper arm, back, etc."
                disabled={!canEdit()}
                className="text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes" className="text-sm">Health Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={2}
                disabled={!canEditHealthNotes()}
                className="text-sm"
              />
            </div>

            {appointment && canEdit() && appointment.status !== 'completed' && (
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="confirmed">{getAppointmentStatusLabel("confirmed")}</SelectItem>
                    {formData.status === 'pending_deposit' && (
                      <SelectItem value="pending_deposit">Pending Deposit</SelectItem>
                    )}
                    <SelectItem value="deposit_paid">Deposit Paid</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="no_show">No Show</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {appointment && appointment.status === 'completed' && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                  <span className="font-semibold text-emerald-800">Checked Out</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  {checkoutSummary ? (
                    <>
                      <div>
                        <span className="text-emerald-600">
                          {checkoutSummary.allTaxInclusive ? "Merchandise" : "Charge (net)"}:
                        </span>
                        <p className="font-medium text-emerald-900 tabular-nums">
                          ${checkoutSummary.allTaxInclusive
                            ? checkoutSummary.merchandiseTotal.toFixed(2)
                            : checkoutSummary.netPreTax.toFixed(2)}
                        </p>
                      </div>
                      {checkoutSummary.tax > 0 && (
                        <div>
                          <span className="text-emerald-600">
                            {checkoutSummary.allTaxInclusive ? "Tax (incl.)" : "Tax"}:
                          </span>
                          <p className="font-medium text-emerald-900 tabular-nums">
                            ${checkoutSummary.tax.toFixed(2)}
                          </p>
                        </div>
                      )}
                      <div>
                        <span className="text-emerald-600">Tip:</span>
                        <p className="font-medium text-emerald-900 tabular-nums">
                          ${checkoutSummary.tip.toFixed(2)}
                        </p>
                      </div>
                      {renderCheckoutPaymentField()}
                      {checkoutSummary.depositCredited > 0 && (
                        <>
                          <div>
                            <span className="text-emerald-600">Deposit applied:</span>
                            <p className="font-medium text-emerald-900 tabular-nums">
                              -${checkoutSummary.depositCredited.toFixed(2)}
                            </p>
                          </div>
                          <div>
                            <span className="text-emerald-600">Collected at checkout:</span>
                            <p className="font-bold text-emerald-950 tabular-nums">
                              ${checkoutSummary.amountDue.toFixed(2)}
                            </p>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <div>
                        <span className="text-emerald-600">Charge:</span>
                        <p className="font-medium text-emerald-900">
                          ${(appointment.charge_amount || 0).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <span className="text-emerald-600">Tax:</span>
                        <p className="font-medium text-emerald-900">
                          ${(appointment.tax_amount || 0).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <span className="text-emerald-600">Tip:</span>
                        <p className="font-medium text-emerald-900">
                          ${(appointment.tip_amount || 0).toFixed(2)}
                        </p>
                      </div>
                      {renderCheckoutPaymentField()}
                    </>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-emerald-200">
                  <p className="text-sm font-semibold text-emerald-800 mb-3">Checkout Summary</p>
                  {checkoutChargesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-emerald-700">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading line items…
                    </div>
                  ) : checkoutSummary ? (
                    <>
                      <div className="rounded-lg border border-emerald-200 bg-white/70 overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-emerald-100/60">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-emerald-900">Item</th>
                              <th className="px-3 py-2 text-right font-medium text-emerald-900 w-12">Qty</th>
                              <th className="px-3 py-2 text-right font-medium text-emerald-900 w-16">Price</th>
                              <th className="px-3 py-2 text-right font-medium text-emerald-900 w-16">Disc</th>
                              <th className="px-3 py-2 text-right font-medium text-emerald-900 w-16">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-emerald-100">
                            {checkoutSummary.lines.map((charge) => {
                              const lineTotal = Number(charge.line_total) || 0;
                              const discount = Number(charge.discount_amount) || 0;
                              return (
                                <tr key={charge.id}>
                                  <td className="px-3 py-2">
                                    <div className="font-medium text-emerald-950 text-xs">{charge.description}</div>
                                    {lineTotal < 0 && (
                                      <span className="text-[10px] text-red-600 font-medium">Negative revenue</span>
                                    )}
                                    {charge.reporting_category_name && (
                                      <div className="text-[10px] text-emerald-600">{charge.reporting_category_name}</div>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right text-xs tabular-nums text-emerald-900">
                                    {charge.quantity}
                                  </td>
                                  <td className="px-3 py-2 text-right text-xs tabular-nums text-emerald-900">
                                    ${(Number(charge.unit_price) || 0).toFixed(2)}
                                  </td>
                                  <td className="px-3 py-2 text-right text-xs tabular-nums text-emerald-900">
                                    {discount > 0 ? `-$${discount.toFixed(2)}` : "$0.00"}
                                  </td>
                                  <td className="px-3 py-2 text-right text-xs font-medium tabular-nums text-emerald-900">
                                    ${lineTotal.toFixed(2)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-3 rounded-lg bg-white/70 border border-emerald-200 p-3 space-y-1 text-sm">
                        <div className="flex justify-between text-emerald-800">
                          <span className="text-emerald-600">Subtotal (before discounts):</span>
                          <span className="tabular-nums">${checkoutSummary.grossBeforeDiscounts.toFixed(2)}</span>
                        </div>
                        {checkoutSummary.lineDiscountsTotal > 0 && (
                          <div className="flex justify-between text-red-600">
                            <span>Line discounts:</span>
                            <span className="tabular-nums">-${checkoutSummary.lineDiscountsTotal.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-medium text-emerald-900">
                          <span className="text-emerald-600">
                            {checkoutSummary.allTaxInclusive ? "Merchandise (tax included in prices)" : "Net (pre-tax)"}:
                          </span>
                          <span className="tabular-nums">
                            ${checkoutSummary.allTaxInclusive
                              ? checkoutSummary.merchandiseTotal.toFixed(2)
                              : checkoutSummary.netPreTax.toFixed(2)}
                          </span>
                        </div>
                        {checkoutSummary.tax > 0 && (
                          <div className="flex justify-between text-emerald-800">
                            <span className="text-emerald-600">
                              {checkoutSummary.allTaxInclusive ? "Tax (included above)" : "Tax"}:
                            </span>
                            <span className="tabular-nums">${checkoutSummary.tax.toFixed(2)}</span>
                          </div>
                        )}
                        {checkoutSummary.tip > 0 && (
                          <div className="flex justify-between text-emerald-800">
                            <span className="text-emerald-600">Tip to artist:</span>
                            <span className="tabular-nums">${checkoutSummary.tip.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-semibold border-t border-emerald-200 pt-1 mt-1 text-emerald-900">
                          <span>Total{checkoutSummary.tip > 0 ? " (incl. tip)" : ""}:</span>
                          <span className="tabular-nums">${checkoutSummary.grandTotal.toFixed(2)}</span>
                        </div>
                        {checkoutSummary.depositCredited > 0 && (
                          <>
                            <div className="flex justify-between text-emerald-800">
                              <span className="text-emerald-600">Paid deposit applied:</span>
                              <span className="tabular-nums">-${checkoutSummary.depositCredited.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between font-bold text-emerald-950">
                              <span>Collected at checkout:</span>
                              <span className="tabular-nums">${checkoutSummary.amountDue.toFixed(2)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-emerald-700">
                      No line item details recorded for this checkout.
                    </p>
                  )}
                </div>

                {canRecordRefund() && studio && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 border-amber-300 text-amber-900 hover:bg-amber-50"
                    onClick={() => setShowRefundDialog(true)}
                  >
                    Record refund
                  </Button>
                )}
              </div>
            )}

            {!canEdit() && appointment && appointment.status !== 'completed' && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-800">
                  You can only view this appointment. To make changes, please contact front desk staff or an admin.
                </p>
              </div>
            )}

            {!canEdit() && appointment && appointment.status === 'completed' && !isAdmin && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <p className="text-sm text-emerald-800">
                  This appointment has been checked out and is now locked. You can still update the Health Notes above; contact an admin for any other changes.
                </p>
              </div>
            )}

            <DialogFooter className="flex flex-col-reverse sm:flex-row sm:flex-wrap sm:justify-between gap-2 pt-4 border-t border-gray-100">
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                {appointment && canDelete() && appointment.status !== 'completed' && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending || updateMutation.isPending}
                    className="w-full sm:w-auto text-sm"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {(isArtist && !isAdmin) ? 'Cancel' : 'Delete'}
                  </Button>
                )}
                {canUnlockAppointment() && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleUnlockAppointment}
                    className="w-full sm:w-auto text-sm"
                  >
                    <Unlock className="w-4 h-4 mr-2" />
                    Unlock / Edit Checkout
                  </Button>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:ml-auto">
                {canCheckout() && (
                  <Button
                    type="button"
                    className="bg-green-600 hover:bg-green-700 w-full sm:w-auto text-sm"
                    onClick={() => setShowCheckoutDialog(true)}
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Check Out
                  </Button>
                )}
                {appointment && !canEdit() && canEditHealthNotes() && (
                  <Button
                    type="button"
                    className="bg-indigo-600 hover:bg-indigo-700 w-full sm:w-auto text-sm"
                    onClick={handleSaveHealthNotes}
                    disabled={savingHealthNotes}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Save Health Notes
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="w-full sm:w-auto text-sm"
                >
                  {canEdit() ? 'Cancel' : 'Close'}
                </Button>
                {canEdit() && (
                  <Button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-700 w-full sm:w-auto text-sm"
                    disabled={hasErrors || createMutation.isPending || updateMutation.isPending}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {appointment ? 'Update' : 'Create'}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CustomerDialog
        open={showCustomerDialog}
        onOpenChange={setShowCustomerDialog}
        customer={null}
        locations={locations}
        isAdmin={isAdmin}
        currentUser={currentUser}
        onCreated={handleCustomerSelect}
      />

      <AdvancedSearchDialog
        open={showAdvancedSearch}
        onOpenChange={setShowAdvancedSearch}
        customers={customers}
        onSelectCustomer={handleCustomerSelect}
      />

      <RefundDialog
        open={showRefundDialog}
        onOpenChange={setShowRefundDialog}
        appointment={appointment}
        studio={studio}
      />

      <CheckoutDialog
        open={showCheckoutDialog}
        onOpenChange={setShowCheckoutDialog}
        onCheckoutComplete={() => onOpenChange(false)}
        appointment={appointment}
        artists={artists}
        locations={locations}
        appointmentTypes={appointmentTypes}
        customers={customers}
        studio={studio}
      />
    </>
  );
}