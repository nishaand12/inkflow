import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Settings, Pencil } from "lucide-react";
import WorkStationDialog from "../components/workstations/WorkStationDialog";
import LocationCapacityDialog from "../components/workstations/LocationCapacityDialog";

export default function WorkStations() {
  const [showStationDialog, setShowStationDialog] = useState(false);
  const [showCapacityDialog, setShowCapacityDialog] = useState(false);
  const [selectedStation, setSelectedStation] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [user, setUser] = useState(null);

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

  const { data: workStations = [] } = useQuery({
    queryKey: ['workStations', user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.WorkStation.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  const handleEditStation = (station) => {
    setSelectedStation(station);
    setShowStationDialog(true);
  };

  const handleNewStation = (locationId) => {
    setSelectedLocation(locationId);
    setSelectedStation(null);
    setShowStationDialog(true);
  };

  const handleEditCapacity = (location) => {
    setSelectedLocation(location);
    setShowCapacityDialog(true);
  };

  const getStationsForLocation = (locationId) => {
    return workStations.filter(ws => ws.location_id === locationId);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Work Stations</h1>
            <p className="text-gray-500 mt-1">Manage work stations across all locations</p>
          </div>
        </div>

        <Tabs defaultValue={locations[0]?.id} className="space-y-6">
          <TabsList className="bg-white border border-gray-200">
            {locations.map(location => (
              <TabsTrigger key={location.id} value={location.id}>
                {location.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {locations.map(location => {
            const locationStations = getStationsForLocation(location.id);
            const activeCount = locationStations.filter(ws => ws.status === 'active').length;

            return (
              <TabsContent key={location.id} value={location.id} className="space-y-4">
                <Card className="bg-white border-none shadow-md">
                  <CardHeader>
                    <div className="flex justify-between items-center">
                      <div>
                        <CardTitle className="text-xl">{location.name} Configuration</CardTitle>
                        <p className="text-sm text-gray-500 mt-1">
                          Station Capacity: {location.station_capacity || 8} • Active Stations: {activeCount}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => handleEditCapacity(location)}
                        >
                          <Settings className="w-4 h-4 mr-2" />
                          Edit Capacity
                        </Button>
                        <Button
                          onClick={() => handleNewStation(location.id)}
                          className="bg-indigo-600 hover:bg-indigo-700"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Add Station
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                </Card>

                {locationStations.length === 0 ? (
                  <Card className="bg-white border-none shadow-lg">
                    <CardContent className="p-12 text-center">
                      <p className="text-gray-500 mb-4">No work stations configured</p>
                      <Button
                        onClick={() => handleNewStation(location.id)}
                        className="bg-indigo-600 hover:bg-indigo-700"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add First Station
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {locationStations.map(station => (
                      <Card
                        key={station.id}
                        className={`bg-white border-2 shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer ${
                          station.status === 'active' ? 'border-green-200' : 'border-gray-200'
                        }`}
                        onClick={() => handleEditStation(station)}
                      >
                        <CardContent className="p-6">
                          <div className="flex justify-between items-start mb-3">
                            <h3 className="font-bold text-lg text-gray-900">{station.name}</h3>
                            <Badge className={station.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                              {station.status}
                            </Badge>
                          </div>
                          {station.notes && (
                            <p className="text-sm text-gray-600 line-clamp-2">{station.notes}</p>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full mt-3 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditStation(station);
                            }}
                          >
                            <Pencil className="w-3 h-3 mr-2" />
                            Edit Station
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </div>

      <WorkStationDialog
        open={showStationDialog}
        onOpenChange={setShowStationDialog}
        station={selectedStation}
        locationId={selectedLocation}
        locations={locations}
        currentUser={user}
      />

      <LocationCapacityDialog
        open={showCapacityDialog}
        onOpenChange={setShowCapacityDialog}
        location={selectedLocation}
      />
    </div>
  );
}