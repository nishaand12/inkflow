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
import TimePicker12h from "@/components/calendar/TimePicker12h";
import { DEFAULT_BOOKING_START_TIME, DEFAULT_AVAILABILITY_END_TIME } from "@/utils/index";
import { format } from "date-fns";
import { Save, Trash2 } from "lucide-react";

export default function AvailabilityDialog({ open, onOpenChange, date, availability, artistId, artists, locations, currentUser, isAdmin }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    artist_id: artistId || '',
    location_id: '',
    start_date: date ? format(date, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
    end_date: date ? format(date, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
    start_time: DEFAULT_BOOKING_START_TIME,
    end_time: DEFAULT_AVAILABILITY_END_TIME,
    is_blocked: false,
    is_all_day: false,
    notes: ''
  });

  useEffect(() => {
    if (availability) {
      setFormData({
        artist_id: availability.artist_id || artistId || '',
        location_id: availability.location_id || '',
        start_date: availability.start_date,
        end_date: availability.end_date,
        start_time: availability.start_time || DEFAULT_BOOKING_START_TIME,
        end_time: availability.end_time || DEFAULT_AVAILABILITY_END_TIME,
        is_blocked: availability.is_blocked || false,
        is_all_day: availability.is_all_day || false,
        notes: availability.notes || ''
      });
    } else if (date) {
      setFormData(prev => ({
        ...prev,
        artist_id: artistId || prev.artist_id || '',
        location_id: '',
        start_date: format(date, 'yyyy-MM-dd'),
        end_date: format(date, 'yyyy-MM-dd'),
        start_time: DEFAULT_BOOKING_START_TIME,
        end_time: DEFAULT_AVAILABILITY_END_TIME,
        is_blocked: false,
        is_all_day: false,
        notes: ''
      }));
    }
  }, [availability, date, artistId]);

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
    
    const { location_id, artist_id, ...restFormData } = formData;
    const submitData = {
      studio_id: currentUser?.studio_id,
      artist_id: artist_id || artistId,
      ...restFormData,
      ...(location_id ? { location_id } : { location_id: null }),
      ...(formData.is_all_day ? { start_time: null, end_time: null } : {}),
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
      artist_id: artistId || '',
      location_id: '',
      start_date: format(new Date(), 'yyyy-MM-dd'),
      end_date: format(new Date(), 'yyyy-MM-dd'),
      start_time: DEFAULT_BOOKING_START_TIME,
      end_time: DEFAULT_AVAILABILITY_END_TIME,
      is_blocked: false,
      is_all_day: false,
      notes: ''
    });
  };

  const showArtistPicker = isAdmin && artists && artists.length > 0 && !artistId;

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
          {showArtistPicker && (
            <div className="space-y-2">
              <Label htmlFor="artist_id">Artist *</Label>
              <Select
                value={formData.artist_id}
                onValueChange={(value) => setFormData({ ...formData, artist_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select artist" />
                </SelectTrigger>
                <SelectContent>
                  {artists.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
              value={formData.location_id || "__all__"}
              onValueChange={(value) => setFormData({ ...formData, location_id: value === "__all__" ? "" : value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Locations</SelectItem>
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

          <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
            <div>
              <Label htmlFor="is_all_day" className="cursor-pointer">All Day</Label>
              <p className="text-sm text-gray-500">
                {formData.is_blocked ? 'Block the entire day' : 'Mark as available all day'}
              </p>
            </div>
            <Switch
              id="is_all_day"
              checked={formData.is_all_day}
              onCheckedChange={(checked) => setFormData({ ...formData, is_all_day: checked })}
            />
          </div>

          {!formData.is_all_day && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_time">Start Time *</Label>
                <TimePicker12h
                  id="start_time"
                  value={formData.start_time}
                  onChange={(newStart) => setFormData({ ...formData, start_time: newStart })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="end_time">End Time *</Label>
                <TimePicker12h
                  id="end_time"
                  value={formData.end_time}
                  onChange={(newEnd) => setFormData({ ...formData, end_time: newEnd })}
                  required
                />
              </div>
            </div>
          )}

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
                disabled={createMutation.isPending || updateMutation.isPending || (showArtistPicker && !formData.artist_id)}
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
