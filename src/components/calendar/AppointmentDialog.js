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
import { Trash2, Save, AlertCircle, CheckCircle, Unlock, Mail, CreditCard, Loader2, Link2, Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import CustomerSearch from "../customers/CustomerSearch";
import CustomerDialog from "../customers/CustomerDialog";
import AdvancedSearchDialog from "../customers/AdvancedSearchDialog";
import CheckoutDialog from "./CheckoutDialog";
import RefundDialog from "./RefundDialog";
import { normalizeUserRole } from "@/utils/roles";
import { addMinutesToTime, formatDuration } from "@/utils/index";
import {
  getAppointmentTypeDisplaySections,
  isPiercingClinicalProfile,
  isTattooClinicalProfile,
} from "@/utils/reportingCategories";

// Stable empty array to prevent new references on each render
const EMPTY_ARRAY = [];

export default function AppointmentDialog({ open, onOpenChange, appointment, defaultDate, artists, locations, currentUser, userArtist }) {
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
    start_time: '10:00',
    end_time: '12:00',
    deposit_amount: 0,
    total_estimate: 0,
    design_description: '',
    placement: '',
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

  const [healthFields, setHealthFields] = useState({});

  const [validationErrors, setValidationErrors] = useState({
    artistConflict: null,
    stationsFull: false
  });

  const [emailSendWarning, setEmailSendWarning] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const userRole = useMemo(() => {
    if (!currentUser) return null;
    return normalizeUserRole(currentUser.user_role || (currentUser.role === 'admin' ? 'Admin' : 'Front_Desk'));
  }, [currentUser]);

  const isArtist = useMemo(() => userRole === 'Artist', [userRole]);
  const isAdmin = useMemo(() => userRole === 'Admin' || userRole === 'Owner', [userRole]);
  const selectableLocations = useMemo(
    () => locations.filter(location => location.is_active || location.id === formData.location_id),
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

  const canCheckout = () => {
    if (!currentUser || !appointment) return false;
    if (appointment.status === 'completed') return false;
    return isAdmin || userRole === 'Front_Desk';
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

  const { data: studio } = useQuery({
    queryKey: ['studio', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return null;
      const studios = await base44.entities.Studio.filter({ id: currentUser.studio_id });
      return studios[0] || null;
    },
    enabled: !!currentUser?.studio_id
  });

  // Use userArtist?.id for stable dependency instead of the full object
  const userArtistId = userArtist?.id;

  useEffect(() => {
    if (appointment) {
      // Merge appointment with defaults to ensure no undefined/null values for inputs
      setFormData({
        ...appointment,
        // Ensure string fields have empty string defaults (not null/undefined)
        artist_id: appointment.artist_id || '',
        location_id: appointment.location_id || '',
        work_station_id: appointment.work_station_id || '',
        customer_id: appointment.customer_id || '',
        appointment_type_id: appointment.appointment_type_id || '',
        client_name: appointment.client_name || '',
        client_email: appointment.client_email || '',
        client_phone: appointment.client_phone || '',
        appointment_date: appointment.appointment_date || format(new Date(), 'yyyy-MM-dd'),
        start_time: appointment.start_time || '10:00',
        design_description: appointment.design_description || '',
        placement: appointment.placement || '',
        notes: appointment.notes || '',
        status: appointment.status || 'scheduled',
        end_time: appointment.end_time || '12:00',
        deposit_amount: appointment.deposit_amount ?? 0,
        total_estimate: appointment.total_estimate ?? 0,
        tax_amount: appointment.tax_amount ?? 0,
      });
      
      setHealthFields(appointment.health_fields || {});

      if (appointment.customer_id) {
        const customer = customers.find(c => c.id === appointment.customer_id);
        setSelectedCustomer(customer || null);
      } else {
        setSelectedCustomer(null);
      }
    } else {
      // For new appointments, auto-assign artist if user is an artist
      const initialArtistId = (isArtist && !isAdmin && userArtistId) ? userArtistId : '';

      setFormData({
        artist_id: initialArtistId,
        location_id: '',
        work_station_id: '',
        customer_id: '',
        appointment_type_id: '',
        client_name: '',
        client_email: '',
        client_phone: '',
        appointment_date: defaultDate ? format(defaultDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
        start_time: '10:00',
        end_time: '12:00',
        deposit_amount: 0,
        total_estimate: 0,
        tax_amount: 0,
        design_description: '',
        placement: '',
        notes: '',
        status: 'scheduled'
      });
      setSelectedCustomer(null);
      setHealthFields({});
    }
    setValidationErrors({ artistConflict: null, stationsFull: false });
    setDepositLinkMessage(null);
    setDepositCheckoutUrl(null);
    setCopiedDepositUrl(false);
    setSaveError(null);
  }, [appointment, defaultDate, open, isArtist, isAdmin, userArtistId, customers]);

  useEffect(() => {
    if (open && formData.artist_id && formData.appointment_date && formData.start_time && formData.location_id) {
      validateAppointment();
    } else {
      setValidationErrors({ artistConflict: null, stationsFull: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.artist_id, formData.appointment_date, formData.start_time, formData.end_time, formData.location_id, open, allAppointments, workStations, availabilities]);

  const handleCustomerSelect = (customer) => {
    setSelectedCustomer(customer);
    const preferredLocation = locations.find(location => location.id === customer.preferred_location_id);
    setFormData(prev => ({
      ...prev,
      customer_id: customer.id,
      client_name: customer.name,
      client_email: customer.email || '',
      client_phone: customer.phone_number || '',
      location_id: preferredLocation?.is_active ? customer.preferred_location_id : prev.location_id
    }));
  };

  const resolveClientEmail = () => {
    if (formData.client_email?.trim()) return formData.client_email.trim();
    if (selectedCustomer?.email?.trim()) return selectedCustomer.email.trim();
    return null;
  };

  const shouldShowEmailWarnings = studio?.subscription_tier === "plus";

  const getEmailWarningMessage = () => {
    if (!shouldShowEmailWarnings) return null;
    
    // Only show email warnings if a customer has been selected or client info is filled in
    const hasCustomerOrClient = selectedCustomer || formData.client_name?.trim();
    if (!hasCustomerOrClient) return null;
    
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
        const newEnd = addMinutesToTime(prev.start_time, type.default_duration_minutes || 120);
        const svc = type.service_cost != null ? Number(type.service_cost) : NaN;
        return {
          ...prev,
          appointment_type_id: typeId,
          end_time: newEnd,
          deposit_amount: type.default_deposit,
          ...(Number.isFinite(svc) && svc > 0 ? { total_estimate: svc } : {}),
        };
      });
    }
  };

  const validateAppointment = () => {
    const errors = {
      artistConflict: null,
      stationsFull: false
    };

    if (formData.artist_id && formData.appointment_date && formData.start_time && formData.end_time) {
      const startMinutes = timeToMinutes(formData.start_time);
      const endMinutes = timeToMinutes(formData.end_time);
      const appointmentDate = parseISO(formData.appointment_date + 'T00:00:00');

      const unavailableSlot = availabilities.find(avail => {
        if (avail.artist_id !== formData.artist_id) return false;
        if (!avail.is_blocked) return false;

        const availStartDate = parseISO(avail.start_date + 'T00:00:00');
        const availEndDate = parseISO(avail.end_date + 'T00:00:00');

        const isDateInRange = appointmentDate >= availStartDate && appointmentDate <= availEndDate;
        if (!isDateInRange) return false;

        if (avail.location_id && avail.location_id !== formData.location_id) return false;

        const availStart = timeToMinutes(avail.start_time);
        const availEnd = timeToMinutes(avail.end_time);

        return (startMinutes < availEnd && endMinutes > availStart);
      });

      if (unavailableSlot) {
        const location = unavailableSlot.location_id 
          ? locations.find(l => l.id === unavailableSlot.location_id)?.name || 'this location'
          : 'all locations';
        errors.artistConflict = `This artist is unavailable from ${unavailableSlot.start_time} to ${unavailableSlot.end_time} at ${location}.`;
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

            const aptStart = timeToMinutes(apt.start_time);
            const aptEnd = apt.end_time ? timeToMinutes(apt.end_time) : aptStart + 60;

            return (startMinutes < aptEnd && endMinutes > aptStart);
          });

          if (conflictingAppointment) {
            const conflictLocation = locations.find(l => l.id === conflictingAppointment.location_id);
            errors.artistConflict = `This artist is already booked from ${conflictingAppointment.start_time} to ${conflictingAppointment.end_time} at ${conflictLocation?.name || 'another location'}.`;
          }
        }
      }
    }

    if (formData.location_id && formData.appointment_date && formData.start_time && formData.artist_id) {
      const availableStations = getAvailableStations();
      if (availableStations.length === 0 && formData.work_station_id === '') {
        errors.stationsFull = true;
      } else if (formData.work_station_id && !availableStations.find(ws => ws.id === formData.work_station_id)) {
        if (availableStations.length === 0) errors.stationsFull = true;
      }
    }

    setValidationErrors(errors);
  };

  const timeToMinutes = (time) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const getAvailableStations = () => {
    if (!formData.location_id || !formData.appointment_date || !formData.start_time) {
      return [];
    }

    const locationStations = workStations.filter(ws => 
      ws.location_id === formData.location_id && ws.status === 'active'
    );

    const startMinutes = timeToMinutes(formData.start_time);
    const endMinutes = formData.end_time ? timeToMinutes(formData.end_time) : startMinutes + 60;

    const occupiedStationIds = allAppointments
      .filter(apt => {
        if (appointment && apt.id === appointment.id) return false;
        if (apt.location_id !== formData.location_id) return false;
        if (apt.appointment_date !== formData.appointment_date) return false;
        if (apt.status === 'cancelled' || apt.status === 'no_show') return false;

        const aptStart = timeToMinutes(apt.start_time);
        const aptEnd = apt.end_time ? timeToMinutes(apt.end_time) : aptStart + 60;

        return (startMinutes < aptEnd && endMinutes > aptStart);
      })
      .map(apt => apt.work_station_id)
      .filter(Boolean);

    // Always include the current appointment's station if editing
    const currentStationId = appointment?.work_station_id;
    
    return locationStations.filter(ws => 
      !occupiedStationIds.includes(ws.id) || ws.id === currentStationId
    );
  };

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Appointment.create(data),
    onSuccess: async (createdAppointment) => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
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
        const hasScheduleChange =
          appointment.appointment_date !== variables.data.appointment_date ||
          appointment.start_time !== variables.data.start_time ||
          appointment.location_id !== variables.data.location_id;

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

        if (!isPaymentReferenceError) throw error;

        const { error: paymentError } = await supabase
          .from('payments')
          .update({ appointment_id: null })
          .eq('appointment_id', id);
        if (paymentError) throw paymentError;

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

  const handleSubmit = (e) => {
    e.preventDefault();
    setEmailSendWarning(null);
    if (validationErrors.artistConflict || validationErrors.stationsFull) {
      return;
    }

    if (formData.location_id && formData.appointment_date && formData.start_time && !formData.work_station_id) {
      if (getAvailableStations().length > 0) {
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
      reminder_sent_week,
      reminder_sent_day,
      reminder_sent_at,
      created_at,
      updated_at,
      ...editableFormData
    } = formData;

    const dataToSave = {
      ...editableFormData,
      studio_id: currentUser?.studio_id,
      appointment_type_id: sanitizeUuid(formData.appointment_type_id),
      customer_id: sanitizeUuid(formData.customer_id),
      work_station_id: sanitizeUuid(formData.work_station_id),
      artist_id: sanitizeUuid(formData.artist_id),
      location_id: sanitizeUuid(formData.location_id),
      health_fields: Object.keys(healthFields).length > 0 ? healthFields : {},
    };

    if (appointment && formData.status === appointment.status) {
      delete dataToSave.status;
    }

    if (appointment) {
      updateMutation.mutate({ id: appointment.id, data: dataToSave });
    } else {
      createMutation.mutate(dataToSave);
    }
  };

  const sendAppointmentEmail = async (appointmentRecord, eventType) => {
    try {
      if (!studio || studio.subscription_tier !== "plus") return;
      if (!studio.email_reminders_enabled) return;

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
      const { data, error } = await supabase.functions.invoke("create-deposit-checkout", {
        body: { appointmentId: appointment.id }
      });
      if (error || data?.error) {
        setDepositLinkMessage({ type: 'error', text: data?.error || 'Failed to create deposit link.' });
      } else if (data?.paid) {
        setDepositLinkMessage({ type: 'success', text: 'Deposit payment confirmed.' });
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
  const handleUnlockAppointment = async () => {
    if (!appointment) return;
    if (
      !window.confirm(
        "Unlock this appointment? All checkout line items will be deleted, sale totals cleared, and status set to Scheduled. It will not appear in revenue reports until checked out again. Deposits already collected are unchanged."
      )
    ) {
      return;
    }
    setSaveError(null);
    try {
      const { error: delErr } = await supabase
        .from("appointment_charges")
        .delete()
        .eq("appointment_id", appointment.id);
      if (delErr) throw delErr;

      const sanitizeUuid = (v) => (v === "" || v == null ? null : v);
      const data = {
        ...formData,
        studio_id: currentUser?.studio_id,
        appointment_type_id: sanitizeUuid(formData.appointment_type_id),
        customer_id: sanitizeUuid(formData.customer_id),
        work_station_id: sanitizeUuid(formData.work_station_id),
        artist_id: sanitizeUuid(formData.artist_id),
        location_id: sanitizeUuid(formData.location_id),
        health_fields: Object.keys(healthFields).length > 0 ? healthFields : {},
        status: "scheduled",
        charge_amount: 0,
        tax_amount: 0,
        discount_amount: 0,
        payment_method: null,
      };

      await updateMutation.mutateAsync({ id: appointment.id, data });
      queryClient.invalidateQueries({ queryKey: ["appointmentCharges"] });
    } catch (e) {
      setSaveError(e?.message || "Could not unlock appointment.");
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
      start_time: '10:00',
      end_time: '12:00',
      deposit_amount: 0,
      total_estimate: 0,
      design_description: '',
      placement: '',
      notes: '',
      status: 'scheduled'
    });
    setSelectedCustomer(null);
    setValidationErrors({ artistConflict: null, stationsFull: false });
  };

  const availableStations = getAvailableStations();
  const hasErrors = validationErrors.artistConflict || validationErrors.stationsFull;

  const selectableArtists = (isAdmin || userRole === 'Front_Desk') 
    ? (isAdmin ? artists : artists.filter(a => a.is_active))
    : artists;

  const activeAppointmentTypes = useMemo(
    () => appointmentTypes.filter(t => t.is_active),
    [appointmentTypes]
  );
  const appointmentTypeSections = useMemo(() => {
    const sections = getAppointmentTypeDisplaySections(activeAppointmentTypes, reportingCategories);
    return sections
      .map((section) => ({
        ...section,
        types: [...section.types].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
      }))
      .sort((a, b) => (a.label || "").localeCompare(b.label || ""));
  }, [activeAppointmentTypes, reportingCategories]);
  const selectedAppointmentType = appointmentTypes.find(t => t.id === formData.appointment_type_id);

  const showPiercingHealthFields = useMemo(() => {
    if (!selectedAppointmentType?.appointment_kind_category_id) return false;
    return isPiercingClinicalProfile(
      reportingCategories,
      selectedAppointmentType.appointment_kind_category_id
    );
  }, [selectedAppointmentType, reportingCategories]);

  const showTattooHealthFields = useMemo(() => {
    if (!selectedAppointmentType?.appointment_kind_category_id) return false;
    return isTattooClinicalProfile(
      reportingCategories,
      selectedAppointmentType.appointment_kind_category_id
    );
  }, [selectedAppointmentType, reportingCategories]);

  const showHealthClinicalSection = showPiercingHealthFields || showTattooHealthFields;

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
              <Label>Customer *</Label>
              <CustomerSearch
                customers={customers}
                onSelect={handleCustomerSelect}
                onNewCustomer={() => setShowCustomerDialog(true)}
                onAdvancedSearch={() => setShowAdvancedSearch(true)}
                selectedCustomer={selectedCustomer}
              />
              {!selectedCustomer && formData.client_name && (
                <p className="text-xs text-amber-600">
                  Legacy appointment - no customer linked. Search to link a customer or leave as is.
                </p>
              )}
            </div>

            {activeAppointmentTypes.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="appointment_type_id">Appointment Type</Label>
                <Select
                  value={formData.appointment_type_id}
                  onValueChange={handleAppointmentTypeSelect}
                  disabled={!canEdit()}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>No Type</SelectItem>
                    <SelectSeparator />
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
                  onValueChange={(value) => setFormData({ ...formData, artist_id: value })}
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
                <Input
                  id="start_time"
                  type="time"
                  value={formData.start_time}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    const currentDuration = timeToMinutes(formData.end_time) - timeToMinutes(formData.start_time);
                    const newEnd = addMinutesToTime(newStart, Math.max(currentDuration, 15));
                    setFormData({ ...formData, start_time: newStart, end_time: newEnd, work_station_id: '' });
                  }}
                  required
                  disabled={!canEdit()}
                  className="text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="end_time" className="text-sm">End Time *</Label>
                <Input
                  id="end_time"
                  type="time"
                  value={formData.end_time}
                  onChange={(e) => setFormData({ ...formData, end_time: e.target.value, work_station_id: '' })}
                  required
                  disabled={!canEdit()}
                  className="text-sm"
                />
              </div>
            </div>

            {formData.location_id && formData.appointment_date && formData.start_time && canEdit() && (
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

            {!selectedCustomer && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="space-y-2">
                  <Label htmlFor="client_name" className="text-sm">Client Name *</Label>
                  <Input
                    id="client_name"
                    value={formData.client_name}
                    onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
                    required
                    disabled={!canEdit()}
                    className="text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="client_email" className="text-sm">Client Email</Label>
                  <Input
                    id="client_email"
                    type="email"
                    value={formData.client_email}
                    onChange={(e) => setFormData({ ...formData, client_email: e.target.value })}
                    disabled={!canEdit()}
                    className="text-sm"
                  />
                </div>
              </div>
            )}

            {!selectedCustomer && (
              <div className="space-y-2">
                <Label htmlFor="client_phone" className="text-sm">Client Phone</Label>
                <Input
                  id="client_phone"
                  value={formData.client_phone}
                  onChange={(e) => setFormData({ ...formData, client_phone: e.target.value })}
                  disabled={!canEdit()}
                  className="text-sm"
                />
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <div className="space-y-2">
                <Label htmlFor="deposit_amount" className="text-sm">Deposit ($)</Label>
                <Input
                  id="deposit_amount"
                  type="number"
                  min="0"
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
                  value={formData.total_estimate}
                  onChange={(e) => setFormData({ ...formData, total_estimate: parseFloat(e.target.value) })}
                  disabled={!canEdit()}
                  className="text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tax_amount" className="text-sm">Tax ($)</Label>
                <Input
                  id="tax_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.tax_amount}
                  onChange={(e) => setFormData({ ...formData, tax_amount: parseFloat(e.target.value) })}
                  disabled={!canEdit()}
                  className="text-sm"
                />
              </div>
            </div>

            {appointment && studio?.stripe_charges_enabled && formData.deposit_amount > 0 && (
              <Accordion type="single" collapsible>
                <AccordionItem value="deposit" className="border border-gray-200 rounded-lg overflow-hidden">
                  <AccordionTrigger className="px-3 py-2.5 hover:no-underline hover:bg-gray-50 [&[data-state=open]]:bg-gray-50">
                    <div className="flex items-center justify-between w-full pr-2">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-purple-600" />
                        <span className="text-sm font-medium text-gray-700">Online Deposit</span>
                      </div>
                      {appointment.deposit_status === 'paid' && (
                        <Badge className="bg-green-100 text-green-800 text-xs">Paid</Badge>
                      )}
                      {appointment.deposit_status === 'pending' && (
                        <Badge className="bg-amber-100 text-amber-800 text-xs">Link Sent</Badge>
                      )}
                      {appointment.deposit_status === 'failed' && (
                        <Badge className="bg-red-100 text-red-800 text-xs">Failed</Badge>
                      )}
                      {(!appointment.deposit_status || appointment.deposit_status === 'none') && (
                        <Badge className="bg-gray-100 text-gray-600 text-xs">Not Requested</Badge>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3 pt-0 space-y-2">
                    {appointment.deposit_status !== 'paid' && canEdit() && (
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
                            {appointment.deposit_status === 'pending' ? 'Show Deposit Link' : 'Create Deposit Link'}
                          </>
                        )}
                      </Button>
                    )}

                    {depositLinkMessage && (
                      <p className={`text-xs ${depositLinkMessage.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                        {depositLinkMessage.text}
                      </p>
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
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            <div className="space-y-2">
              <Label htmlFor="design_description" className="text-sm">Design Description</Label>
              <Textarea
                id="design_description"
                value={formData.design_description}
                onChange={(e) => setFormData({ ...formData, design_description: e.target.value })}
                rows={2}
                disabled={!canEdit()}
                className="text-sm"
              />
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
              <Label htmlFor="notes" className="text-sm">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={2}
                disabled={!canEdit()}
                className="text-sm"
              />
            </div>

            {showHealthClinicalSection && (
              <details className="border border-gray-200 rounded-lg p-3">
                <summary className="cursor-pointer text-sm font-medium text-gray-700">Health & Clinical Fields</summary>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  {showPiercingHealthFields && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">Needle Lot #</Label>
                        <Input
                          value={healthFields.needle_lot || ''}
                          onChange={(e) => setHealthFields({ ...healthFields, needle_lot: e.target.value })}
                          disabled={!canEdit()}
                          className="text-sm"
                          placeholder="Lot number"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Jewellery Lot #</Label>
                        <Input
                          value={healthFields.jewellery_lot || ''}
                          onChange={(e) => setHealthFields({ ...healthFields, jewellery_lot: e.target.value })}
                          disabled={!canEdit()}
                          className="text-sm"
                          placeholder="Lot number"
                        />
                      </div>
                    </>
                  )}
                  {showTattooHealthFields && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">Ink Brand / Lot #</Label>
                        <Input
                          value={healthFields.ink_lot || ''}
                          onChange={(e) => setHealthFields({ ...healthFields, ink_lot: e.target.value })}
                          disabled={!canEdit()}
                          className="text-sm"
                          placeholder="Brand and lot number"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Needle Cartridge Lot #</Label>
                        <Input
                          value={healthFields.needle_cartridge_lot || ''}
                          onChange={(e) => setHealthFields({ ...healthFields, needle_cartridge_lot: e.target.value })}
                          disabled={!canEdit()}
                          className="text-sm"
                          placeholder="Cartridge lot number"
                        />
                      </div>
                    </>
                  )}
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs">Sterilization Notes</Label>
                    <Input
                      value={healthFields.sterilization_notes || ''}
                      onChange={(e) => setHealthFields({ ...healthFields, sterilization_notes: e.target.value })}
                      disabled={!canEdit()}
                      className="text-sm"
                      placeholder="Autoclave cycle, spore test, etc."
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs">Skin Prep / Aftercare Notes</Label>
                    <Input
                      value={healthFields.skin_prep_notes || ''}
                      onChange={(e) => setHealthFields({ ...healthFields, skin_prep_notes: e.target.value })}
                      disabled={!canEdit()}
                      className="text-sm"
                      placeholder="Skin prep method, aftercare instructions given, etc."
                    />
                  </div>
                </div>
              </details>
            )}

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
                    <SelectItem value="confirmed">Confirmed</SelectItem>
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
                  <div>
                    <span className="text-emerald-600">Charge:</span>
                    <p className="font-medium text-emerald-900">${(appointment.charge_amount || 0).toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-emerald-600">Tax:</span>
                    <p className="font-medium text-emerald-900">${(appointment.tax_amount || 0).toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-emerald-600">Tip:</span>
                    <p className="font-medium text-emerald-900">${(appointment.tip_amount || 0).toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-emerald-600">Payment:</span>
                    <p className="font-medium text-emerald-900">{appointment.payment_method || 'N/A'}</p>
                  </div>
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
                  This appointment has been checked out and is now locked. Contact an admin to make changes.
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
                    disabled={updateMutation.isPending}
                    className="w-full sm:w-auto text-sm"
                  >
                    <Unlock className="w-4 h-4 mr-2" />
                    Unlock
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
        onOpenChange={(isOpen) => {
          setShowCheckoutDialog(isOpen);
          if (!isOpen) {
            onOpenChange(false);
          }
        }}
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