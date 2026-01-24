import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Save, Trash2, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function CustomerDialog({ open, onOpenChange, customer, locations, isAdmin, currentUser }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: '',
    phone_number: '',
    email: '',
    instagram_username: '',
    preferred_location_id: '',
    send_calendar_invites: false,
    consent_obtained: false,
    is_active: true
  });
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [showDuplicateAlert, setShowDuplicateAlert] = useState(false);
  const [duplicates, setDuplicates] = useState([]);

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.Customer.filter({ studio_id: currentUser.studio_id });
    },
    enabled: !!currentUser?.studio_id
  });

  useEffect(() => {
    if (customer) {
      setFormData({
        name: customer.name || '',
        phone_number: customer.phone_number || '',
        email: customer.email || '',
        instagram_username: customer.instagram_username || '',
        preferred_location_id: customer.preferred_location_id || '',
        send_calendar_invites: customer.send_calendar_invites || false,
        consent_obtained: customer.consent_obtained || false,
        is_active: customer.is_active !== undefined ? customer.is_active : true
      });
    } else {
      setFormData({
        name: '',
        phone_number: '',
        email: '',
        instagram_username: '',
        preferred_location_id: '',
        send_calendar_invites: false,
        consent_obtained: false,
        is_active: true
      });
    }
    setDuplicates([]);
  }, [customer, open]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Customer.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onOpenChange(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Customer.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onOpenChange(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Customer.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onOpenChange(false);
    }
  });

  const checkForDuplicates = () => {
    if (customer) return [];

    const potentialDuplicates = allCustomers.filter(c => {
      const emailMatch = c.email.toLowerCase() === formData.email.toLowerCase();
      const phoneMatch = c.phone_number === formData.phone_number;
      return emailMatch || phoneMatch;
    });

    return potentialDuplicates;
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!customer) {
      const foundDuplicates = checkForDuplicates();
      if (foundDuplicates.length > 0) {
        setDuplicates(foundDuplicates);
        setShowDuplicateAlert(true);
        return;
      }
    }

    proceedWithSave();
  };

  const proceedWithSave = () => {
    const submitData = {
      ...formData,
      studio_id: currentUser?.studio_id,
      preferred_location_id: formData.preferred_location_id || null
    };

    if (customer) {
      updateMutation.mutate({ id: customer.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
    setShowDuplicateAlert(false);
  };

  const handleDelete = () => {
    setShowDeleteAlert(true);
  };

  const confirmDelete = () => {
    deleteMutation.mutate(customer.id);
    setShowDeleteAlert(false);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      phone_number: '',
      email: '',
      instagram_username: '',
      preferred_location_id: '',
      send_calendar_invites: false,
      consent_obtained: false,
      is_active: true
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              {customer ? 'Edit Customer' : 'New Customer'}
            </DialogTitle>
            <DialogDescription>
              {customer ? 'Update customer information below.' : 'Enter the customer details to create a new record.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone_number">Phone Number *</Label>
                <Input
                  id="phone_number"
                  type="tel"
                  value={formData.phone_number}
                  onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
            </div>

            {customer?.email_bounced && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                This email address bounced{customer.email_bounce_reason ? `: ${customer.email_bounce_reason}` : "."}
                Please update the email before sending reminders.
              </div>
            )}

            {customer?.email_unsubscribed && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                This customer has unsubscribed from email reminders.
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="instagram_username">Instagram Username</Label>
                <Input
                  id="instagram_username"
                  value={formData.instagram_username}
                  onChange={(e) => setFormData({ ...formData, instagram_username: e.target.value })}
                  placeholder="@username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="preferred_location_id">Preferred Location</Label>
                <Select
                  value={formData.preferred_location_id}
                  onValueChange={(value) => setFormData({ ...formData, preferred_location_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>No Preference</SelectItem>
                    {locations.map(location => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
              <div>
                <Label htmlFor="consent_obtained" className="cursor-pointer">Consent Form Obtained</Label>
                <p className="text-sm text-gray-500">Tattoo consent form on file</p>
              </div>
              <Switch
                id="consent_obtained"
                checked={formData.consent_obtained}
                onCheckedChange={(checked) => setFormData({ ...formData, consent_obtained: checked })}
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
              <div>
                <Label htmlFor="send_calendar_invites" className="cursor-pointer">Send Calendar Invites</Label>
                <p className="text-sm text-gray-500">Include calendar invites for this customer</p>
              </div>
              <Switch
                id="send_calendar_invites"
                checked={formData.send_calendar_invites}
                onCheckedChange={(checked) => setFormData({ ...formData, send_calendar_invites: checked })}
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
              <div>
                <Label htmlFor="is_active" className="cursor-pointer">Active Customer</Label>
                <p className="text-sm text-gray-500">Inactive customers are hidden from search</p>
              </div>
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
            </div>

            <DialogFooter className="flex justify-between gap-2">
              {customer && isAdmin && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  <Save className="w-4 h-4 mr-2" />
                  {customer ? 'Update' : 'Create'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteAlert} onOpenChange={setShowDeleteAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete &quot;{customer?.name}&quot;.
              Past appointments with this customer will remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDuplicateAlert} onOpenChange={setShowDuplicateAlert}>
        <AlertDialogContent className="max-w-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              Potential Duplicate Customer Detected
            </AlertDialogTitle>
            <AlertDialogDescription>
              We found existing customers with matching email or phone number. Please review:
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="space-y-4">
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <h4 className="font-semibold text-green-900 mb-2">New Customer:</h4>
              <div className="text-sm space-y-1">
                <p><span className="font-medium">Name:</span> {formData.name}</p>
                <p><span className="font-medium">Email:</span> {formData.email}</p>
                <p><span className="font-medium">Phone:</span> {formData.phone_number}</p>
              </div>
            </div>

            {duplicates.map((dup, idx) => (
              <div key={idx} className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <h4 className="font-semibold text-amber-900 mb-2">Existing Customer:</h4>
                <div className="text-sm space-y-1">
                  <p><span className="font-medium">Name:</span> {dup.name}</p>
                  <p><span className="font-medium">Email:</span> {dup.email}</p>
                  <p><span className="font-medium">Phone:</span> {dup.phone_number}</p>
                  {dup.instagram_username && (
                    <p><span className="font-medium">Instagram:</span> @{dup.instagram_username}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDuplicateAlert(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={proceedWithSave}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Create Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}