import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Calendar, Clock, MapPin, X, ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, startOfWeek, endOfWeek, addMonths, subMonths, parseISO, isWithinInterval, isSameMonth } from "date-fns";
import AvailabilityDialog from "../components/availability/AvailabilityDialog";

export default function MyAvailability() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showDialog, setShowDialog] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedAvailability, setSelectedAvailability] = useState(null);
  const [userArtist, setUserArtist] = useState(null);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const queryClient = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: artists = [] } = useQuery({
    queryKey: ['artists', user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Artist.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Location.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  const { data: availabilities = [] } = useQuery({
    queryKey: ['availabilities', user?.studio_id, userArtist?.id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Availability.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id && !!userArtist
  });

  const createArtistMutation = useMutation({
    mutationFn: (data) => base44.entities.Artist.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists'] });
      setIsCreatingProfile(false);
    },
    onError: (error) => {
      console.error("Error creating artist profile:", error);
      setIsCreatingProfile(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Availability.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availabilities'] });
    }
  });

  useEffect(() => {
    if (user && artists.length > 0) {
      const artist = artists.find(a => a.user_id === user.id);
      
      if (!artist && (user.user_role === 'Admin' || user.user_role === 'Owner') && !isCreatingProfile) {
        setIsCreatingProfile(true);
        const firstLocation = locations[0];
        
        if (firstLocation) {
          createArtistMutation.mutate({
            studio_id: user.studio_id,
            user_id: user.id,
            full_name: user.full_name || user.email,
            primary_location_id: firstLocation.id,
            is_active: true
          });
        }
      } else {
        setUserArtist(artist);
      }
    }
  }, [user, artists, locations]);

  const getDaysToShow = () => {
    const start = startOfWeek(startOfMonth(currentDate));
    const end = endOfWeek(endOfMonth(currentDate));
    return eachDayOfInterval({ start, end });
  };

  const getAvailabilityForDay = (day) => {
    if (!userArtist) return [];
    return availabilities.filter(avail => {
      if (avail.artist_id !== userArtist.id) return false;
      
      // Parse dates as local dates
      const startDate = parseISO(avail.start_date + 'T00:00:00');
      const endDate = parseISO(avail.end_date + 'T00:00:00');
      
      // Check if day falls within the availability period
      return isWithinInterval(day, { start: startDate, end: endDate });
    });
  };

  const handleAddAvailability = (date) => {
    if (!userArtist) return;
    setSelectedDate(date);
    setSelectedAvailability(null);
    setShowDialog(true);
  };

  const handleEditAvailability = (availability, e) => {
    e.stopPropagation();
    if (!userArtist) return;
    setSelectedAvailability(availability);
    setSelectedDate(null);
    setShowDialog(true);
  };

  const handleDelete = (id, e) => {
    e.stopPropagation();
    if (window.confirm('Remove this availability slot?')) {
      deleteMutation.mutate(id);
    }
  };

  const handlePrevMonth = () => {
    setCurrentDate(subMonths(currentDate, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(addMonths(currentDate, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const days = getDaysToShow();

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-gray-900 mb-2">Loading...</h2>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (user.user_role !== 'Artist' && user.user_role !== 'Admin' && user.user_role !== 'Owner') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">
                Only Artists, Owners, and Admins can manage availability. Your current role is: {user.user_role}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isCreatingProfile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-indigo-600 mx-auto mb-4"></div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Setting Up Your Artist Profile</h2>
              <p className="text-gray-500">
                Please wait while we create your artist profile...
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">My Availability</h1>
            <p className="text-gray-500 mt-1">Set your working hours and time off</p>
          </div>
        </div>

        <Card className="bg-white border-none shadow-lg">
          <CardContent className="p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">
                {format(currentDate, 'MMMM yyyy')}
              </h2>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handlePrevMonth}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" onClick={handleToday}>
                  Today
                </Button>
                <Button variant="outline" onClick={handleNextMonth}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center font-semibold text-gray-600 text-sm p-2">
                  {day}
                </div>
              ))}

              {days.map((day, idx) => {
                const dayAvailabilities = getAvailabilityForDay(day);
                const isToday = isSameDay(day, new Date());
                const isCurrentMonth = isSameMonth(day, currentDate);

                return (
                  <div
                    key={idx}
                    className={`min-h-[120px] p-2 rounded-lg border-2 transition-all duration-200 ${
                      isToday ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100'
                    } ${
                      !isCurrentMonth ? 'bg-gray-50' : 'bg-white'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <div className={`text-sm font-medium ${
                        isToday ? 'text-indigo-600' : isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
                      }`}>
                        {format(day, 'd')}
                      </div>
                      {isCurrentMonth && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 hover:bg-indigo-100"
                          onClick={() => handleAddAvailability(day)}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      )}
                    </div>

                    <div className="space-y-1">
                      {dayAvailabilities.map(avail => {
                        const location = locations.find(l => l.id === avail.location_id);
                        const isMultiDay = avail.start_date !== avail.end_date;
                        
                        return (
                          <div
                            key={avail.id}
                            onClick={(e) => handleEditAvailability(avail, e)}
                            className={`text-xs p-2 rounded cursor-pointer ${
                              avail.is_blocked
                                ? 'bg-red-100 border border-red-200 hover:bg-red-200'
                                : 'bg-green-100 border border-green-200 hover:bg-green-200'
                            } group relative transition-colors`}
                          >
                            <button
                              onClick={(e) => handleDelete(avail.id, e)}
                              className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-3 h-3 text-gray-600 hover:text-red-600" />
                            </button>
                            <div className={`font-medium ${
                              avail.is_blocked ? 'text-red-900' : 'text-green-900'
                            }`}>
                              {avail.start_time} - {avail.end_time}
                            </div>
                            {isMultiDay && (
                              <div className={`text-xs ${
                                avail.is_blocked ? 'text-red-700' : 'text-green-700'
                              }`}>
                                {format(parseISO(avail.start_date + 'T00:00:00'), 'MMM d')} - {format(parseISO(avail.end_date + 'T00:00:00'), 'MMM d')}
                              </div>
                            )}
                            {location && (
                              <div className={`${
                                avail.is_blocked ? 'text-red-700' : 'text-green-700'
                              } truncate`}>
                                {location.name}
                              </div>
                            )}
                            {!location && (
                              <div className={`${
                                avail.is_blocked ? 'text-red-700' : 'text-green-700'
                              } truncate`}>
                                All Locations
                              </div>
                            )}
                            {avail.is_blocked && (
                              <div className="text-red-600 font-medium">Blocked</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-none shadow-md">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Clock className="w-6 h-6 text-indigo-600 mt-1" />
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">How to Set Your Availability</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  <li>• Click the + button on any day to add availability</li>
                  <li>• Set date ranges for multi-day periods (like vacations)</li>
                  <li>• Choose a specific location or leave blank for all locations</li>
                  <li>• Mark time as "blocked" for time off or breaks</li>
                  <li>• Click on any availability to edit or remove it</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {userArtist && user && (
        <AvailabilityDialog
          open={showDialog}
          onOpenChange={setShowDialog}
          date={selectedDate}
          availability={selectedAvailability}
          artistId={userArtist.id}
          locations={locations}
          currentUser={user}
        />
      )}
    </div>
  );
}