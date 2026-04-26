import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Save, Trash2, AlertCircle } from "lucide-react";
import { ARTIST_PALETTE, autoAssignColor } from "@/utils/artistColors";

export default function ArtistDialog({ open, onOpenChange, artist, locations }) {
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState(null);
  const [formData, setFormData] = useState({
    user_id: '',
    full_name: '',
    artist_type: 'tattoo',
    specialty: '',
    bio: '',
    phone: '',
    instagram: '',
    hourly_rate: 150,
    primary_location_id: '',
    is_active: true,
    calendar_color: ARTIST_PALETTE[0]
  });

  const [currentUser, setCurrentUser] = React.useState(null);

  React.useEffect(() => {
    if (open) {
      setErrorMessage(null);
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
      setFormData({ ...artist, calendar_color: artist.calendar_color || ARTIST_PALETTE[0] });
    } else {
      const autoColor = autoAssignColor(artists);
      setFormData({
        user_id: '',
        full_name: '',
        artist_type: 'tattoo',
        specialty: '',
        bio: '',
        phone: '',
        instagram: '',
        hourly_rate: 150,
        primary_location_id: '',
        is_active: true,
        calendar_color: autoColor
      });
    }
  }, [artist, open, artists]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Artist.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists'] });
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      setErrorMessage(error?.message || 'Failed to create artist. Please try again.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Artist.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists'] });
      onOpenChange(false);
    },
    onError: (error) => {
      setErrorMessage(error?.message || 'Failed to update artist. Please try again.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Artist.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists'] });
      onOpenChange(false);
    },
    onError: (error) => {
      const msg = error?.message || '';
      if (msg.includes('foreign key') || msg.includes('violates') || msg.includes('constraint')) {
        setErrorMessage(
          'This artist cannot be deleted because they have related records (e.g. availability, appointments). Remove those first, then delete the artist.'
        );
      } else {
        setErrorMessage(msg || 'Failed to delete artist. Please try again.');
      }
    }
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
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
      setErrorMessage(null);
      deleteMutation.mutate(artist.id);
    }
  };

  const resetForm = () => {
    setFormData({
      user_id: '',
      full_name: '',
      artist_type: 'tattoo',
      specialty: '',
      bio: '',
      phone: '',
      instagram: '',
      hourly_rate: 150,
      primary_location_id: '',
      is_active: true,
      calendar_color: autoAssignColor(artists)
    });
  };

  const userRole = currentUser?.user_role || currentUser?.role || null;
  const isAdmin = userRole === 'Admin' || userRole === 'Owner';

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
          <DialogDescription>
            {artist ? 'Update artist profile and settings.' : 'Enter the details for the new artist.'}
          </DialogDescription>
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
              <Label htmlFor="artist_type">Artist Type *</Label>
              <Select
                value={formData.artist_type}
                onValueChange={(value) => setFormData({ ...formData, artist_type: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tattoo">Tattoo Artist</SelectItem>
                  <SelectItem value="piercer">Piercer</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
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

          <div className="space-y-3">
            <Label>Calendar Color</Label>
            <p className="text-xs text-gray-500 -mt-1">Used to color this artist's appointments on the calendar</p>
            <div className="flex flex-wrap gap-2">
              {ARTIST_PALETTE.map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setFormData({ ...formData, calendar_color: color })}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110 focus:outline-none"
                  style={{
                    backgroundColor: color,
                    ring: formData.calendar_color === color ? `3px solid ${color}` : 'none',
                    boxShadow: formData.calendar_color === color
                      ? `0 0 0 2px white, 0 0 0 4px ${color}`
                      : 'none'
                  }}
                  title={color}
                />
              ))}
            </div>
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-lg border-2 border-gray-200 shrink-0"
                style={{ backgroundColor: formData.calendar_color }}
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor="custom_color" className="text-xs text-gray-500">Custom color</Label>
                <input
                  id="custom_color"
                  type="color"
                  value={formData.calendar_color || '#4f46e5'}
                  onChange={(e) => setFormData({ ...formData, calendar_color: e.target.value })}
                  className="h-8 w-20 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
                />
              </div>
            </div>
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
            {errorMessage && (
              <div className="col-span-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 w-full mb-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
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