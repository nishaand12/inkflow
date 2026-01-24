import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { Save, Trash2 } from "lucide-react";

export default function AvailabilityDialog({ open, onOpenChange, date, availability, artistId, locations, currentUser }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    location_id: '',
    start_date: date ? format(date, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
    end_date: date ? format(date, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
    start_time: '09:00',
    end_time: '17:00',
    is_blocked: false,
    notes: ''
  });

  useEffect(() => {
    if (availability) {
      setFormData({
        location_id: availability.location_id || '',
        start_date: availability.start_date,
        end_date: availability.end_date,
        start_time: availability.start_time,
        end_time: availability.end_time,
        is_blocked: availability.is_blocked || false,
        notes: availability.notes || ''
      });
    } else if (date) {
      setFormData({
        location_id: '',
        start_date: format(date, 'yyyy-MM-dd'),
        end_date: format(date, 'yyyy-MM-dd'),
        start_time: '09:00',
        end_time: '17:00',
        is_blocked: false,
        notes: ''
      });
    }
  }, [availability, date]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Availability.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availabilities'] });
      onOpenChange(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Availability.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availabilities'] });
      onOpenChange(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Availability.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availabilities'] });
      onOpenChange(false);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const submitData = {
      studio_id: currentUser?.studio_id,
      artist_id: artistId,
      ...formData,
      // Only include location_id if it's set
      ...(formData.location_id ? { location_id: formData.location_id } : {})
    };

    if (availability) {
      updateMutation.mutate({ id: availability.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this availability?')) {
      deleteMutation.mutate(availability.id);
    }
  };

  const resetForm = () => {
    setFormData({
      location_id: '',
      start_date: format(new Date(), 'yyyy-MM-dd'),
      end_date: format(new Date(), 'yyyy-MM-dd'),
      start_time: '09:00',
      end_time: '17:00',
      is_blocked: false,
      notes: ''
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            {availability ? 'Edit Availability' : 'Add Availability'}
          </DialogTitle>
          <DialogDescription>
            {availability ? 'Update availability or time-off settings.' : 'Set available hours or block time off.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date *</Label>
              <Input
                id="start_date"
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="end_date">End Date *</Label>
              <Input
                id="end_date"
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                min={formData.start_date}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="location_id">Location (Optional)</Label>
            <Select
              value={formData.location_id}
              onValueChange={(value) => setFormData({ ...formData, location_id: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>All Locations</SelectItem>
                {locations.map(location => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">
              Leave blank to apply this availability to all locations
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_time">Start Time *</Label>
              <Input
                id="start_time"
                type="time"
                value={formData.start_time}
                onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="end_time">End Time *</Label>
              <Input
                id="end_time"
                type="time"
                value={formData.end_time}
                onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
            <div>
              <Label htmlFor="is_blocked" className="cursor-pointer">Block This Time</Label>
              <p className="text-sm text-gray-500">Mark as unavailable for appointments</p>
            </div>
            <Switch
              id="is_blocked"
              checked={formData.is_blocked}
              onCheckedChange={(checked) => setFormData({ ...formData, is_blocked: checked })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
              placeholder="Add any notes..."
            />
          </div>

          <DialogFooter className="flex justify-between gap-2">
            {availability && (
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
                {availability ? 'Update' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}