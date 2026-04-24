import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, MapPin, Instagram, Trash, Percent } from "lucide-react";
import { normalizeUserRole } from "@/utils/roles";
import ArtistDialog from "../components/artists/ArtistDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function SplitRuleDialog({ open, onOpenChange, artist, studioId }) {
  const queryClient = useQueryClient();
  const [splitPercent, setSplitPercent] = useState(50);
  const [eligibleCategoryIds, setEligibleCategoryIds] = useState([]);

  const { data: reportingCategories = [] } = useQuery({
    queryKey: ['reportingCategories', studioId],
    queryFn: () => base44.entities.ReportingCategory.filter({ studio_id: studioId }),
    enabled: open && !!studioId
  });

  const { data: splitRules = [] } = useQuery({
    queryKey: ['artistSplitRules', studioId],
    queryFn: () => base44.entities.ArtistSplitRule.filter({ studio_id: studioId }),
    enabled: open && !!studioId
  });

  useEffect(() => {
    if (artist && splitRules.length >= 0) {
      const existing = splitRules.find(r => r.artist_id === artist.id && r.is_active);
      if (existing) {
        setSplitPercent(existing.split_percent);
        setEligibleCategoryIds(existing.eligible_category_ids || []);
      } else {
        setSplitPercent(50);
        setEligibleCategoryIds([]);
      }
    }
  }, [artist, splitRules]);

  const handleSave = async () => {
    const existing = splitRules.find(r => r.artist_id === artist.id && r.is_active);
    const ruleData = {
      studio_id: studioId,
      artist_id: artist.id,
      split_percent: splitPercent,
      eligible_category_ids: eligibleCategoryIds,
      is_active: true
    };
    if (existing) {
      await base44.entities.ArtistSplitRule.update(existing.id, ruleData);
    } else {
      await base44.entities.ArtistSplitRule.create(ruleData);
    }
    queryClient.invalidateQueries({ queryKey: ['artistSplitRules'] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle>Revenue Split — {artist?.full_name}</DialogTitle>
          <DialogDescription>Configure this artist's revenue share with the studio.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Artist Split (%)</Label>
            <Input
              type="number" min="0" max="100" step="1"
              value={splitPercent}
              onChange={(e) => setSplitPercent(parseFloat(e.target.value) || 0)}
              className="w-32"
            />
            <p className="text-xs text-gray-500">
              Artist receives {splitPercent}%, shop receives {100 - splitPercent}%
            </p>
          </div>
          {reportingCategories.length > 0 && (
            <div className="space-y-2">
              <Label>Eligible Categories</Label>
              <p className="text-xs text-gray-500">Select which revenue categories this split applies to</p>
              <div className="grid grid-cols-2 gap-2">
                {reportingCategories.filter(c => c.is_active).map(cat => (
                  <label key={cat.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={eligibleCategoryIds.includes(cat.id)}
                      onCheckedChange={(checked) => {
                        setEligibleCategoryIds(prev =>
                          checked ? [...prev, cat.id] : prev.filter(id => id !== cat.id)
                        );
                      }}
                    />
                    {cat.name}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={handleSave}>Save Split Rule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Artists() {
  const [searchTerm, setSearchTerm] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [splitArtist, setSplitArtist] = useState(null);
  const [showSplitDialog, setShowSplitDialog] = useState(false);
  const [user, setUser] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
    } catch (error) {
      console.error("Error loading user:", error);
    }
  };

  const { data: artists = [] } = useQuery({
    queryKey: ['artists', user?.studio_id],
    queryFn: async () => {
      return base44.entities.Artist.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', user?.studio_id],
    queryFn: async () => {
      return base44.entities.Location.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  const { data: splitRules = [] } = useQuery({
    queryKey: ['artistSplitRules', user?.studio_id],
    queryFn: () => base44.entities.ArtistSplitRule.filter({ studio_id: user.studio_id }),
    enabled: !!user?.studio_id
  });

  const deleteArtistMutation = useMutation({
    mutationFn: (artistId) => base44.entities.Artist.delete(artistId),
    onSuccess: () => {
      queryClient.invalidateQueries(['artists']);
    },
    onError: (error) => {
      console.error("Error deleting artist:", error);
    },
  });

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === 'admin' ? 'Admin' : 'Front_Desk'));
  };

  const userRole = getUserRole();
  const isAdmin = userRole === 'Admin' || userRole === 'Owner';
  const canEdit = isAdmin;

  const filteredArtists = artists.filter(artist =>
    artist.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    artist.specialty?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleEdit = (artist) => {
    setSelectedArtist(artist);
    setShowDialog(true);
  };

  const handleNew = () => {
    setSelectedArtist(null);
    setShowDialog(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Artists</h1>
            <p className="text-gray-500 mt-1">
              {canEdit ? 'Manage your studio artists' : 'View studio artists'}
            </p>
          </div>
          {canEdit && (
            <Button 
              onClick={handleNew}
              className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Artist
            </Button>
          )}
        </div>

        <Card className="bg-white border-none shadow-md">
          <CardContent className="p-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search artists by name or specialty..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredArtists.map(artist => {
            const primaryLocation = locations.find(l => l.id === artist.primary_location_id);

            return (
              <Card
                key={artist.id}
                onClick={() => canEdit && handleEdit(artist)}
                className={`bg-white border-none shadow-lg hover:shadow-xl transition-all duration-300 ${
                  canEdit ? 'cursor-pointer' : ''
                } overflow-hidden`}
              >
                <div className="h-2 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
                <CardContent className="p-6">
                  <div className="flex items-start gap-4 mb-4">
                    <Avatar className="w-16 h-16 border-4 border-indigo-100">
                      <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white text-xl font-bold">
                        {artist.full_name?.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <h3 className="font-bold text-lg text-gray-900">{artist.full_name}</h3>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        <Badge variant="secondary" className={
                          artist.artist_type === 'piercer' ? 'bg-purple-50 text-purple-700' :
                          artist.artist_type === 'both' ? 'bg-amber-50 text-amber-700' :
                          'bg-indigo-50 text-indigo-700'
                        }>
                          {artist.artist_type === 'piercer' ? 'Piercer' : artist.artist_type === 'both' ? 'Tattoo & Piercer' : 'Tattoo Artist'}
                        </Badge>
                        {artist.specialty && (
                          <Badge variant="secondary" className="bg-gray-50 text-gray-600">
                            {artist.specialty}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Badge className={artist.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                      {artist.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>

                  {artist.bio && (
                    <p className="text-sm text-gray-600 mb-4 line-clamp-3">{artist.bio}</p>
                  )}

                  <div className="space-y-2 text-sm">
                    {primaryLocation && (
                      <div className="flex items-center gap-2 text-gray-600">
                        <MapPin className="w-4 h-4" />
                        <span>{primaryLocation.name}</span>
                      </div>
                    )}
                    {artist.instagram && (
                      <div className="flex items-center gap-2 text-gray-600">
                        <Instagram className="w-4 h-4" />
                        <span>@{artist.instagram}</span>
                      </div>
                    )}
                    {artist.hourly_rate && (
                      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                        <span className="text-gray-500">Hourly Rate:</span>
                        <span className="font-bold text-gray-900">${artist.hourly_rate}/hr</span>
                      </div>
                    )}
                  </div>
                  
                  {canEdit && (
                    <div className="flex justify-end mt-4 pt-4 border-t border-gray-100 gap-2">
                      {(() => {
                        const rule = splitRules.find(r => r.artist_id === artist.id && r.is_active);
                        return (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setSplitArtist(artist); setShowSplitDialog(true); }}
                          >
                            <Percent className="w-4 h-4 mr-1" />
                            {rule ? `${rule.split_percent}%` : 'Set Split'}
                          </Button>
                        );
                      })()}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={(e) => e.stopPropagation()}
                            disabled={deleteArtistMutation.isLoading}
                          >
                            <Trash className="w-4 h-4 mr-2" />
                            Remove
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This action cannot be undone. This will permanently delete the artist
                              &quot;{artist.full_name}&quot; from your records.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={deleteArtistMutation.isLoading}>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteArtistMutation.mutate(artist.id);
                              }}
                              disabled={deleteArtistMutation.isLoading}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              {deleteArtistMutation.isLoading ? 'Deleting...' : 'Delete'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {filteredArtists.length === 0 && (
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <p className="text-gray-500">No artists found</p>
            </CardContent>
          </Card>
        )}
      </div>

      {canEdit && (
        <ArtistDialog
          open={showDialog}
          onOpenChange={setShowDialog}
          artist={selectedArtist}
          locations={locations}
        />
      )}

      {canEdit && splitArtist && (
        <SplitRuleDialog
          open={showSplitDialog}
          onOpenChange={setShowSplitDialog}
          artist={splitArtist}
          studioId={user?.studio_id}
        />
      )}
    </div>
  );
}