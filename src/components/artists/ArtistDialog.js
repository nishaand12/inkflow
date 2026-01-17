import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Save, Trash2 } from "lucide-react";

export default function ArtistDialog({ open, onOpenChange, artist, locations }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    user_id: '',
    full_name: '',
    specialty: '',
    bio: '',
    phone: '',
    instagram: '',
    hourly_rate: 150,
    primary_location_id: '',
    is_active: true
  });

  const [currentUser, setCurrentUser] = React.useState(null);

  React.useEffect(() => {
    if (open) {
      loadUser();
    }
  }, [open]);

  const loadUser = async () => {
    try {
      const user = await base44.auth.me();
      setCurrentUser(user);
    } catch (error) {
      console.error("Error loading user:", error);
    }
  };

  const { data: users = [] } = useQuery({
    queryKey: ['users', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      try {
        // Try to list users (only works for Admins due to built-in User entity restrictions)
        const allUsers = await base44.entities.User.list();
        return allUsers.filter(u => u.studio_id === currentUser.studio_id);
      } catch (error) {
        // If user is Owner (not Admin), they can't list users due to built-in restrictions
        // Return just the current user so they can add themselves as an artist
        if (currentUser.user_role === 'Owner') {
          return [currentUser];
        }
        return [];
      }
    },
    enabled: open && !artist && !!currentUser?.studio_id
  });

  const { data: artists = [] } = useQuery({
    queryKey: ['artists', currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.Artist.filter({ studio_id: currentUser.studio_id });
    },
    enabled: open && !!currentUser?.studio_id
  });

  useEffect(() => {
    if (artist) {
      setFormData(artist);
    } else {
      resetForm();
    }
  }, [artist]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Artist.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists'] });
      onOpenChange(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Artist.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists'] });
      onOpenChange(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Artist.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists'] });
      onOpenChange(false);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const submitData = {
      ...formData,
      studio_id: currentUser?.studio_id
    };
    if (artist) {
      updateMutation.mutate({ id: artist.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this artist?')) {
      deleteMutation.mutate(artist.id);
    }
  };

  const resetForm = () => {
    setFormData({
      user_id: '',
      full_name: '',
      specialty: '',
      bio: '',
      phone: '',
      instagram: '',
      hourly_rate: 150,
      primary_location_id: '',
      is_active: true
    });
  };

  const userRole = currentUser?.user_role || currentUser?.role || null;
  const isAdmin = userRole === 'Admin' || userRole === 'Owner';
  const isSelfEditing = artist && currentUser && artist.user_id === currentUser.id;

  // Get users with Artist, Admin, or Owner role who don't already have an artist profile
  const availableUsers = users.filter(u => {
    // Check user_role - must be Artist, Admin, or Owner
    const validRole = u.user_role === 'Artist' || u.user_role === 'Admin' || u.user_role === 'Owner';
    if (!validRole) return false;
    
    // Check if this user already has an artist profile (unless it's the current artist being edited)
    const existingArtist = artists.find(a => a.user_id === u.id);
    return !existingArtist || (artist && existingArtist.id === artist.id);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            {artist ? 'Edit Artist' : 'Add New Artist'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            {!artist && (
              <div className="space-y-2 col-span-2">
                <Label htmlFor="user_id">Select User *</Label>
                <Select
                  value={formData.user_id}
                  onValueChange={(value) => {
                    const selectedUser = users.find(u => u.id === value);
                    setFormData({ 
                      ...formData, 
                      user_id: value,
                      full_name: selectedUser?.full_name || '',
                      phone: selectedUser?.phone || ''
                    });
                  }}
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a user with Artist, Admin, or Owner role" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.map(user => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.full_name || user.email} - {user.email} ({user.user_role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availableUsers.length === 0 && (
                  <p className="text-xs text-amber-600">
                    No users with Artist, Admin, or Owner role available. Invite a new Artist: once they complete sign up and join your studio they will be available.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2 col-span-2">
              <Label htmlFor="full_name">Full Name *</Label>
              <Input
                id="full_name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="specialty">Specialty</Label>
              <Input
                id="specialty"
                value={formData.specialty}
                onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}
                placeholder="e.g., Traditional, Realism, Japanese"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="instagram">Instagram Handle</Label>
              <Input
                id="instagram"
                value={formData.instagram}
                onChange={(e) => setFormData({ ...formData, instagram: e.target.value })}
                placeholder="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="primary_location_id">Primary Location *</Label>
              <Select
                value={formData.primary_location_id}
                onValueChange={(value) => setFormData({ ...formData, primary_location_id: value })}
                required
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
              <Label htmlFor="hourly_rate">Hourly Rate ($)</Label>
              <Input
                id="hourly_rate"
                type="number"
                min="0"
                value={formData.hourly_rate}
                onChange={(e) => setFormData({ ...formData, hourly_rate: parseFloat(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              rows={4}
              placeholder="Tell us about this artist..."
            />
          </div>

            <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
            <div>
              <Label htmlFor="is_active" className="cursor-pointer">Active Status</Label>
              <p className="text-sm text-gray-500">Artist can receive appointments</p>
            </div>
            <Switch
              id="is_active"
              checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                disabled={!isAdmin}
            />
          </div>

          <DialogFooter className="flex justify-between gap-2">
            {artist && isAdmin && (
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
                disabled={createMutation.isPending || updateMutation.isPending || (!artist && availableUsers.length === 0)}
              >
                <Save className="w-4 h-4 mr-2" />
                {artist ? 'Update' : 'Create'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}