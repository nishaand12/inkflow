import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, MapPin, Instagram, Trash } from "lucide-react";
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

export default function Artists() {
  const [searchTerm, setSearchTerm] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [selectedArtist, setSelectedArtist] = useState(null);
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
                      {artist.specialty && (
                        <Badge variant="secondary" className="mt-1 bg-indigo-50 text-indigo-700">
                          {artist.specialty}
                        </Badge>
                      )}
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
                    <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
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
    </div>
  );
}