import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Phone, Mail } from "lucide-react";
import LocationDialog from "../components/locations/LocationDialog";

export default function Locations() {
  const [showDialog, setShowDialog] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);
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

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Location.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  const handleEdit = (location) => {
    setSelectedLocation(location);
    setShowDialog(true);
  };

  const handleNew = () => {
    setSelectedLocation(null);
    setShowDialog(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Studio Locations</h1>
            <p className="text-gray-500 mt-1">Manage your studio locations</p>
          </div>
          <Button 
            onClick={handleNew}
            className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Location
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {locations.map(location => (
            <Card
              key={location.id}
              onClick={() => handleEdit(location)}
              className="bg-white border-none shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer overflow-hidden"
            >
              <div className="h-2 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-xl">{location.name}</CardTitle>
                    <p className="text-sm text-gray-500 mt-1">{location.city}</p>
                  </div>
                  <Badge className={location.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                    {location.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2 text-sm text-gray-600">
                  <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{location.address}</span>
                </div>
                {location.phone && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Phone className="w-4 h-4" />
                    <span>{location.phone}</span>
                  </div>
                )}
                {location.email && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Mail className="w-4 h-4" />
                    <span>{location.email}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {locations.length === 0 && (
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No locations added yet</p>
            </CardContent>
          </Card>
        )}
      </div>

      <LocationDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        location={selectedLocation}
        currentUser={user}
      />
    </div>
  );
}