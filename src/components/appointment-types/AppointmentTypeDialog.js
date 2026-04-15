import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Save, Trash2 } from "lucide-react";
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

export default function AppointmentTypeDialog({ open, onOpenChange, appointmentType, currentUser }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    category: 'Tattoo',
    name: '',
    description: '',
    default_duration: 2,
    default_deposit: 100,
    is_active: true,
    is_public_bookable: false,
    reporting_category_id: ''
  });
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);

  const { data: reportingCategories = [] } = useQuery({
    queryKey: ['reportingCategories', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.ReportingCategory.filter({ studio_id: currentUser.studio_id });
    },
    enabled: open && !!currentUser?.studio_id
  });

  useEffect(() => {
    if (appointmentType) {
      setFormData({
        category: appointmentType.category || 'Tattoo',
        name: appointmentType.name || '',
        description: appointmentType.description || '',
        default_duration: appointmentType.default_duration || 2,
        default_deposit: appointmentType.default_deposit || 100,
        is_active: appointmentType.is_active !== undefined ? appointmentType.is_active : true,
        is_public_bookable: appointmentType.is_public_bookable || false,
        reporting_category_id: appointmentType.reporting_category_id || ''
      });
    } else {
      setFormData({
        category: 'Tattoo',
        name: '',
        description: '',
        default_duration: 2,
        default_deposit: 100,
        is_active: true,
        is_public_bookable: false,
        reporting_category_id: ''
      });
    }
  }, [appointmentType, open]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.AppointmentType.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointmentTypes'] });
      onOpenChange(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AppointmentType.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointmentTypes'] });
      onOpenChange(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.AppointmentType.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointmentTypes'] });
      onOpenChange(false);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const submitData = {
      ...formData,
      studio_id: currentUser?.studio_id,
      reporting_category_id: formData.reporting_category_id || null
    };

    if (appointmentType) {
      updateMutation.mutate({ id: appointmentType.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const handleDelete = () => {
    setShowDeleteAlert(true);
  };

  const confirmDelete = () => {
    deleteMutation.mutate(appointmentType.id);
    setShowDeleteAlert(false);
  };

  const resetForm = () => {
    setFormData({
      category: 'Tattoo',
      name: '',
      description: '',
      default_duration: 2,
      default_deposit: 100,
      is_active: true,
      is_public_bookable: false,
      reporting_category_id: ''
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl bg-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              {appointmentType ? 'Edit Appointment Type' : 'New Appointment Type'}
            </DialogTitle>
            <DialogDescription>
              {appointmentType ? 'Update the appointment type settings.' : 'Create a new appointment type with default duration and deposit.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData({ ...formData, category: value })}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Tattoo">Tattoo</SelectItem>
                  <SelectItem value="Piercing">Piercing</SelectItem>
                  <SelectItem value="Deposit">Deposit</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="e.g., Small Tattoo, Ear Piercing"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                placeholder="Describe this appointment type..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="default_duration">Default Duration (hours) *</Label>
                <Input
                  id="default_duration"
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={formData.default_duration}
                  onChange={(e) => setFormData({ ...formData, default_duration: parseFloat(e.target.value) })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="default_deposit">Default Deposit ($) *</Label>
                <Input
                  id="default_deposit"
                  type="number"
                  min="0"
                  step="1"
                  value={formData.default_deposit}
                  onChange={(e) => setFormData({ ...formData, default_deposit: parseFloat(e.target.value) })}
                  required
                />
              </div>
            </div>

            {reportingCategories.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="reporting_category_id">Reporting Category</Label>
                <Select
                  value={formData.reporting_category_id}
                  onValueChange={(value) => setFormData({ ...formData, reporting_category_id: value === '__none__' ? '' : value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select reporting category (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {reportingCategories
                      .filter(c => c.is_active)
                      .sort((a, b) => a.display_order - b.display_order)
                      .map(cat => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name} ({cat.category_type})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
              <div>
                <Label htmlFor="is_public_bookable" className="cursor-pointer">Public Booking</Label>
                <p className="text-sm text-gray-500">Allow customers to self-book this service online</p>
              </div>
              <Switch
                id="is_public_bookable"
                checked={formData.is_public_bookable}
                onCheckedChange={(checked) => setFormData({ ...formData, is_public_bookable: checked })}
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
              <div>
                <Label htmlFor="is_active" className="cursor-pointer">Active</Label>
                <p className="text-sm text-gray-500">Inactive types won&apos;t appear in booking</p>
              </div>
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
            </div>

            <DialogFooter className="flex justify-between gap-2">
              {appointmentType && (
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
                  {appointmentType ? 'Update' : 'Create'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteAlert} onOpenChange={setShowDeleteAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Appointment Type?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete &quot;{appointmentType?.name}&quot;.
              Historical appointments will retain their original values.
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
    </>
  );
}