
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save } from "lucide-react";

export default function LocationCapacityDialog({ open, onOpenChange, location }) {
  const queryClient = useQueryClient();
  const [capacity, setCapacity] = useState(8);

  useEffect(() => {
    if (location) {
      setCapacity(location.station_capacity || 8);
    }
  }, [location]);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Location.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      onOpenChange(false);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (location) {
      updateMutation.mutate({
        id: location.id,
        data: { ...location, station_capacity: capacity }
      });
    }
  };

  if (!location) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            Edit Station Capacity
          </DialogTitle>
          <p className="text-sm text-gray-500 mt-2">{location?.name}</p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="capacity">Maximum Number of Work Stations</Label>
            <Input
              id="capacity"
              type="number"
              min="1"
              max="50"
              value={capacity}
              onChange={(e) => setCapacity(parseInt(e.target.value))}
              required
            />
            <p className="text-xs text-gray-500">
              This sets the maximum capacity for this location. You can configure individual stations after setting the capacity.
            </p>
          </div>

          <DialogFooter>
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
              disabled={updateMutation.isPending}
            >
              <Save className="w-4 h-4 mr-2" />
              Update Capacity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
