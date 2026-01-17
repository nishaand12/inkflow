import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { Trash2, Save, AlertCircle, CheckCircle, Unlock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import CustomerSearch from "../customers/CustomerSearch";
import CustomerDialog from "../customers/CustomerDialog";
import AdvancedSearchDialog from "../customers/AdvancedSearchDialog";
import CheckoutDialog from "./CheckoutDialog";
import { normalizeUserRole } from "@/utils/roles";

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
    duration_hours: 2,
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

  const [validationErrors, setValidationErrors] = useState({
    artistConflict: null,
    stationsFull: false
  });

  const getUserRole = () => {
    if (!currentUser) return null;
    return normalizeUserRole(currentUser.user_role || (currentUser.role === 'admin' ? 'Admin' : 'Front_Desk'));
  };

  const userRole = getUserRole();
  const isArtist = userRole === 'Artist';
  const isAdmin = userRole === 'Admin' || userRole === 'Owner';
  
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

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.Customer.filter({ studio_id: currentUser.studio_id });
    },
    enabled: !!currentUser?.studio_id
  });

  const { data: appointmentTypes = [] } = useQuery({
    queryKey: ['appointmentTypes', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.AppointmentType.filter({ studio_id: currentUser.studio_id });
    },
    enabled: !!currentUser?.studio_id
  });

  const { data: allAppointments = [] } = useQuery({
    queryKey: ['appointments', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.Appointment.filter({ studio_id: currentUser.studio_id });
    },
    enabled: !!currentUser?.studio_id
  });

  const { data: workStations = [], isLoading: workStationsLoading } = useQuery({
    queryKey: ['workStations', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.WorkStation.filter({ studio_id: currentUser.studio_id });
    },
    enabled: !!currentUser?.studio_id
  });

  const { data: availabilities = [] } = useQuery({
    queryKey: ['availabilities', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.Availability.filter({ studio_id: currentUser.studio_id });
    },
    enabled: open && !!currentUser?.studio_id
  });

  useEffect(() => {
    if (appointment) {
      setFormData(appointment);
      
      // Find and set the selected customer if customer_id exists
      if (appointment.customer_id) {
        const customer = customers.find(c => c.id === appointment.customer_id);
        setSelectedCustomer(customer || null);
      } else {
        setSelectedCustomer(null);
      }
    } else {
      // For new appointments, auto-assign artist if user is an artist
      const initialArtistId = (isArtist && !isAdmin && userArtist) ? userArtist.id : '';

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
        duration_hours: 2,
        deposit_amount: 0,
        total_estimate: 0,
        tax_amount: 0,
        design_description: '',
        placement: '',
        notes: '',
        status: 'scheduled'
      });
      setSelectedCustomer(null);
    }
    setValidationErrors({ artistConflict: null, stationsFull: false });
  }, [appointment, defaultDate, open, isArtist, isAdmin, userArtist, customers]);

  useEffect(() => {
    if (open && formData.artist_id && formData.appointment_date && formData.start_time && formData.location_id) {
      validateAppointment();
    } else {
      setValidationErrors({ artistConflict: null, stationsFull: false });
    }
  }, [formData.artist_id, formData.appointment_date, formData.start_time, formData.duration_hours, formData.location_id, open, allAppointments, workStations, availabilities]);

  const handleCustomerSelect = (customer) => {
    setSelectedCustomer(customer);
    setFormData(prev => ({
      ...prev,
      customer_id: customer.id,
      client_name: customer.name,
      client_email: customer.email || '',
      client_phone: customer.phone_number || '',
      location_id: customer.preferred_location_id || prev.location_id
    }));
  };

  const handleAppointmentTypeSelect = (typeId) => {
    const type = appointmentTypes.find(t => t.id === typeId);
    if (type) {
      setFormData(prev => ({
        ...prev,
        appointment_type_id: typeId,
        duration_hours: type.default_duration,
        deposit_amount: type.default_deposit
      }));
    }
  };

  const validateAppointment = () => {
    const errors = {
      artistConflict: null,
      stationsFull: false
    };

    if (formData.artist_id && formData.appointment_date && formData.start_time) {
      const startMinutes = timeToMinutes(formData.start_time);
      const endMinutes = startMinutes + (formData.duration_hours * 60);
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
        const conflictingAppointment = allAppointments.find(apt => {
          if (appointment && apt.id === appointment.id) return false;
          if (apt.artist_id !== formData.artist_id) return false;
          if (apt.appointment_date !== formData.appointment_date) return false;
          if (apt.status === 'cancelled' || apt.status === 'no_show') return false;

          const aptStart = timeToMinutes(apt.start_time);
          const aptEnd = aptStart + (apt.duration_hours * 60);

          return (startMinutes < aptEnd && endMinutes > aptStart);
        });

        if (conflictingAppointment) {
          const conflictLocation = locations.find(l => l.id === conflictingAppointment.location_id);
          errors.artistConflict = `This artist is already booked from ${conflictingAppointment.start_time} to ${calculateEndTime(conflictingAppointment.start_time, conflictingAppointment.duration_hours)} at ${conflictLocation?.name || 'another location'}.`;
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

  const calculateEndTime = (startTime, duration) => {
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = startMinutes + (duration * 60);
    const hours = Math.floor(endMinutes / 60);
    const minutes = endMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };

  const getAvailableStations = () => {
    if (!formData.location_id || !formData.appointment_date || !formData.start_time) {
      return [];
    }

    const locationStations = workStations.filter(ws => 
      ws.location_id === formData.location_id && ws.status === 'active'
    );

    const startMinutes = timeToMinutes(formData.start_time);
    const endMinutes = startMinutes + (formData.duration_hours * 60);

    const occupiedStationIds = allAppointments
      .filter(apt => {
        if (appointment && apt.id === appointment.id) return false;
        if (apt.location_id !== formData.location_id) return false;
        if (apt.appointment_date !== formData.appointment_date) return false;
        if (apt.status === 'cancelled' || apt.status === 'no_show') return false;

        const aptStart = timeToMinutes(apt.start_time);
        const aptEnd = aptStart + (apt.duration_hours * 60);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      onOpenChange(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Appointment.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      onOpenChange(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Appointment.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      onOpenChange(false);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validationErrors.artistConflict || validationErrors.stationsFull) {
      return;
    }

    if (formData.location_id && formData.appointment_date && formData.start_time && !formData.work_station_id) {
      if (getAvailableStations().length > 0) {
        alert('Please select a work station.');
        return;
      }
    }

    const dataToSave = {
      ...formData,
      studio_id: currentUser?.studio_id
    };

    if (appointment) {
      updateMutation.mutate({ id: appointment.id, data: dataToSave });
    } else {
      createMutation.mutate(dataToSave);
    }
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
      duration_hours: 2,
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

  const activeAppointmentTypes = appointmentTypes.filter(t => t.is_active);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              {appointment ? ((isArtist && !isAdmin) ? 'View/Edit Appointment' : 'Edit Appointment') : 'New Appointment'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
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
                    {activeAppointmentTypes.map(type => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name} - {type.default_duration}h, ${type.default_deposit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location_id">Location *</Label>
                <Select
                  value={formData.location_id}
                  onValueChange={(value) => {
                    setFormData({ ...formData, location_id: value, work_station_id: '' });
                  }}
                  required
                  disabled={!canEditLocation() || !canEdit()}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map(location => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="artist_id">Artist *</Label>
                <Select
                  value={formData.artist_id}
                  onValueChange={(value) => setFormData({ ...formData, artist_id: value })}
                  required
                  disabled={!canEditArtist() || !canEdit()}
                >
                  <SelectTrigger>
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

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={formData.appointment_date}
                  onChange={(e) => setFormData({ ...formData, appointment_date: e.target.value, work_station_id: '' })}
                  required
                  disabled={!canEdit()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="start_time">Start Time *</Label>
                <Input
                  id="start_time"
                  type="time"
                  value={formData.start_time}
                  onChange={(e) => setFormData({ ...formData, start_time: e.target.value, work_station_id: '' })}
                  required
                  disabled={!canEdit()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="duration_hours">Duration (h) *</Label>
                <Input
                  id="duration_hours"
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={formData.duration_hours}
                  onChange={(e) => setFormData({ ...formData, duration_hours: parseFloat(e.target.value), work_station_id: '' })}
                  required
                  disabled={!canEdit()}
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="client_name">Client Name *</Label>
                  <Input
                    id="client_name"
                    value={formData.client_name}
                    onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
                    required
                    disabled={!canEdit()}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="client_email">Client Email</Label>
                  <Input
                    id="client_email"
                    type="email"
                    value={formData.client_email}
                    onChange={(e) => setFormData({ ...formData, client_email: e.target.value })}
                    disabled={!canEdit()}
                  />
                </div>
              </div>
            )}

            {!selectedCustomer && (
              <div className="space-y-2">
                <Label htmlFor="client_phone">Client Phone</Label>
                <Input
                  id="client_phone"
                  value={formData.client_phone}
                  onChange={(e) => setFormData({ ...formData, client_phone: e.target.value })}
                  disabled={!canEdit()}
                />
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="deposit_amount">Deposit ($)</Label>
                <Input
                  id="deposit_amount"
                  type="number"
                  min="0"
                  value={formData.deposit_amount}
                  onChange={(e) => setFormData({ ...formData, deposit_amount: parseFloat(e.target.value) })}
                  disabled={!canEdit()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="total_estimate">Estimate ($)</Label>
                <Input
                  id="total_estimate"
                  type="number"
                  min="0"
                  value={formData.total_estimate}
                  onChange={(e) => setFormData({ ...formData, total_estimate: parseFloat(e.target.value) })}
                  disabled={!canEdit()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tax_amount">Tax ($)</Label>
                <Input
                  id="tax_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.tax_amount}
                  onChange={(e) => setFormData({ ...formData, tax_amount: parseFloat(e.target.value) })}
                  disabled={!canEdit()}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="design_description">Design Description</Label>
              <Textarea
                id="design_description"
                value={formData.design_description}
                onChange={(e) => setFormData({ ...formData, design_description: e.target.value })}
                rows={3}
                disabled={!canEdit()}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="placement">Placement</Label>
              <Input
                id="placement"
                value={formData.placement}
                onChange={(e) => setFormData({ ...formData, placement: e.target.value })}
                placeholder="e.g., Upper arm, back, etc."
                disabled={!canEdit()}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={2}
                disabled={!canEdit()}
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
                    <SelectItem value="confirmed">Confirmed</SelectItem>
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
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-emerald-600">Charge:</span>
                    <p className="font-medium text-emerald-900">${(appointment.charge_amount || 0).toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-emerald-600">Tax:</span>
                    <p className="font-medium text-emerald-900">${(appointment.tax_amount || 0).toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-emerald-600">Payment:</span>
                    <p className="font-medium text-emerald-900">{appointment.payment_method || 'N/A'}</p>
                  </div>
                </div>
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

            <DialogFooter className="flex flex-wrap justify-between gap-2">
              <div className="flex gap-2">
                {appointment && canDelete() && appointment.status !== 'completed' && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending || updateMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {(isArtist && !isAdmin) ? 'Cancel' : 'Delete'}
                  </Button>
                )}
                {canUnlockAppointment() && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (window.confirm('Unlock this appointment? It will be set to Scheduled and removed from revenue reports.')) {
                        updateMutation.mutate({ id: appointment.id, data: { ...formData, status: 'scheduled' } });
                      }
                    }}
                    disabled={updateMutation.isPending}
                  >
                    <Unlock className="w-4 h-4 mr-2" />
                    Unlock
                  </Button>
                )}
              </div>
              <div className="flex gap-2 ml-auto">
                {canCheckout() && (
                  <Button
                    type="button"
                    className="bg-green-600 hover:bg-green-700"
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
                >
                  {canEdit() ? 'Cancel' : 'Close'}
                </Button>
                {canEdit() && (
                  <Button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-700"
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
      />
    </>
  );
}