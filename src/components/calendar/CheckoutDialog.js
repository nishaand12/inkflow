import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle } from "lucide-react";

export default function CheckoutDialog({ open, onOpenChange, appointment, artists, locations, appointmentTypes, customers }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    charge_amount: '',
    tax_amount: '',
    payment_method: ''
  });

  useEffect(() => {
    if (appointment) {
      setFormData({
        charge_amount: appointment.charge_amount || '',
        tax_amount: appointment.tax_amount || '',
        payment_method: appointment.payment_method || ''
      });
    }
  }, [appointment]);

  const checkoutMutation = useMutation({
    mutationFn: (data) => base44.entities.Appointment.update(appointment.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      onOpenChange(false);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const updateData = {
      status: 'completed',
      charge_amount: formData.charge_amount ? parseFloat(formData.charge_amount) : null,
      tax_amount: formData.tax_amount ? parseFloat(formData.tax_amount) : null,
      payment_method: formData.payment_method || null
    };

    checkoutMutation.mutate(updateData);
  };

  if (!appointment) return null;

  const artist = artists?.find(a => a.id === appointment.artist_id);
  const location = locations?.find(l => l.id === appointment.location_id);
  const appointmentType = appointmentTypes?.find(t => t.id === appointment.appointment_type_id);
  const customer = customers?.find(c => c.id === appointment.customer_id);
  const clientName = customer?.name || appointment.client_name || 'Unknown';

  const calculateEndTime = (startTime, duration) => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + (duration * 60);
    const endHours = Math.floor(totalMinutes / 60);
    const endMinutes = totalMinutes % 60;
    return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-white max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl font-bold flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            Check Out Appointment
          </DialogTitle>
          <DialogDescription className="text-sm">
            Complete the appointment by entering the final charge and payment details.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
          {/* Read-only appointment details */}
          <div className="bg-gray-50 rounded-lg p-3 sm:p-4 space-y-3">
            <h3 className="font-semibold text-gray-900 text-sm sm:text-base mb-2 sm:mb-3">Appointment Details</h3>
            
            <div className="grid grid-cols-2 gap-2 sm:gap-3 text-xs sm:text-sm">
              <div>
                <span className="text-gray-500">Client:</span>
                <p className="font-medium truncate">{clientName}</p>
              </div>
              <div>
                <span className="text-gray-500">Artist:</span>
                <p className="font-medium truncate">{artist?.full_name || 'Unknown'}</p>
              </div>
              <div>
                <span className="text-gray-500">Date:</span>
                <p className="font-medium">{appointment.appointment_date}</p>
              </div>
              <div>
                <span className="text-gray-500">Time:</span>
                <p className="font-medium">
                  {appointment.start_time} - {calculateEndTime(appointment.start_time, appointment.duration_hours)}
                </p>
              </div>
              <div>
                <span className="text-gray-500">Service:</span>
                <p className="font-medium truncate">{appointmentType?.name || 'No Type'}</p>
              </div>
              <div>
                <span className="text-gray-500">Location:</span>
                <p className="font-medium truncate">{location?.name || 'Unknown'}</p>
              </div>
              <div>
                <span className="text-gray-500">Deposit:</span>
                <p className="font-medium">${(appointment.deposit_amount || 0).toFixed(2)}</p>
              </div>
              <div>
                <span className="text-gray-500">Estimate:</span>
                <p className="font-medium">${(appointment.total_estimate || 0).toFixed(2)}</p>
              </div>
            </div>

            {appointment.notes && (
              <div className="pt-2 border-t border-gray-200">
                <span className="text-gray-500 text-xs sm:text-sm">Notes:</span>
                <p className="text-xs sm:text-sm mt-1">{appointment.notes}</p>
              </div>
            )}
          </div>

          {/* Editable checkout fields */}
          <div className="space-y-3 sm:space-y-4">
            <h3 className="font-semibold text-gray-900 text-sm sm:text-base">Payment Information</h3>
            
            <div className="grid grid-cols-2 gap-2 sm:gap-4">
              <div className="space-y-2">
                <Label htmlFor="charge_amount" className="text-sm">Charge ($)</Label>
                <Input
                  id="charge_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.charge_amount}
                  onChange={(e) => setFormData({ ...formData, charge_amount: e.target.value })}
                  placeholder="0.00"
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
                  onChange={(e) => setFormData({ ...formData, tax_amount: e.target.value })}
                  placeholder="0.00"
                  className="text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="payment_method" className="text-sm">Payment Method</Label>
              <Select
                value={formData.payment_method}
                onValueChange={(value) => setFormData({ ...formData, payment_method: value })}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Select payment method (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Card">Card</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="E-Transfer">E-Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-4 border-t border-gray-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-green-600 hover:bg-green-700 w-full sm:w-auto"
              disabled={checkoutMutation.isPending}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Complete Checkout
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}