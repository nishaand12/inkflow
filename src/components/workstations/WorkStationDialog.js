import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Save, Trash2 } from "lucide-react";

export default function WorkStationDialog({ open, onOpenChange, station, locationId, locations, currentUser }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    location_id: locationId || '',
    name: '',
    status: 'active',
    notes: ''
  });

  useEffect(() => {
    if (station) {
      setFormData(station);
    } else if (locationId) {
      setFormData(prev => ({
        ...prev,
        location_id: locationId
      }));
    }
  }, [station, locationId]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.WorkStation.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workStations'] });
      onOpenChange(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.WorkStation.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workStations'] });
      onOpenChange(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.WorkStation.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workStations'] });
      onOpenChange(false);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const submitData = {
      ...formData,
      studio_id: currentUser?.studio_id
    };
    if (station) {
      updateMutation.mutate({ id: station.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this work station?')) {
      deleteMutation.mutate(station.id);
    }
  };

  const resetForm = () => {
    setFormData({
      location_id: locationId || '',
      name: '',
      status: 'active',
      notes: ''
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            {station ? 'Edit Work Station' : 'Add Work Station'}
          </DialogTitle>
          <DialogDescription>
            {station ? 'Update work station details.' : 'Configure a new work station for this location.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="location_id">Location *</Label>
              <Select
                value={formData.location_id}
                onValueChange={(value) => setFormData({ ...formData, location_id: value })}
                required
                disabled={!!station}
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
              <Label htmlFor="name">Station Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="e.g., Station 1, Window Station, Corner Booth"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                placeholder="Special equipment, location details, etc."
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
              <div>
                <Label htmlFor="status" className="cursor-pointer">Active Status</Label>
                <p className="text-sm text-gray-500">Station is available for booking</p>
              </div>
              <Switch
                id="status"
                checked={formData.status === 'active'}
                onCheckedChange={(checked) => setFormData({ ...formData, status: checked ? 'active' : 'inactive' })}
              />
            </div>
          </div>

          <DialogFooter className="flex justify-between gap-2">
            {station && (
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
                {station ? 'Update' : 'Create'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}