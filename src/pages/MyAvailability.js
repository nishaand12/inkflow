import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Calendar, Clock, X, ChevronLeft, ChevronRight, Save, Trash2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, startOfWeek, endOfWeek, addMonths, subMonths, parseISO, isWithinInterval, isSameMonth } from "date-fns";
import AvailabilityDialog from "../components/availability/AvailabilityDialog";

export default function MyAvailability() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showDialog, setShowDialog] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedAvailability, setSelectedAvailability] = useState(null);
  const [selectedArtistId, setSelectedArtistId] = useState(null);
  const queryClient = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const isAdmin = user?.user_role === 'Admin' || user?.user_role === 'Owner';

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

  const activeArtists = artists.filter(a => a.is_active);

  useEffect(() => {
    if (!user || artists.length === 0) return;
    if (selectedArtistId) return;

    const ownArtist = artists.find(a => a.user_id === user.id);
    if (ownArtist) {
      setSelectedArtistId(ownArtist.id);
    } else if (isAdmin && activeArtists.length > 0) {
      setSelectedArtistId(activeArtists[0].id);
    }
  }, [user, artists, activeArtists, isAdmin, selectedArtistId]);

  const currentArtist = artists.find(a => a.id === selectedArtistId) || null;

  const { data: availabilities = [] } = useQuery({
    queryKey: ['availabilities', user?.studio_id, selectedArtistId],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Availability.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id && !!selectedArtistId
  });

  const { data: weeklySchedules = [] } = useQuery({
    queryKey: ['weeklySchedules', user?.studio_id, selectedArtistId],
    queryFn: async () => {
      if (!user?.studio_id || !selectedArtistId) return [];
      return base44.entities.ArtistWeeklySchedule.filter({ studio_id: user.studio_id, artist_id: selectedArtistId });
    },
    enabled: !!user?.studio_id && !!selectedArtistId
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Availability.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availabilities'] });
    }
  });

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({ day_of_week: 1, start_time: '10:00', end_time: '18:00', location_id: '' });
  const [showScheduleForm, setShowScheduleForm] = useState(false);

  const createScheduleMutation = useMutation({
    mutationFn: (data) => base44.entities.ArtistWeeklySchedule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weeklySchedules'] });
      setShowScheduleForm(false);
      setEditingSchedule(null);
    }
  });

  const updateScheduleMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ArtistWeeklySchedule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weeklySchedules'] });
      setShowScheduleForm(false);
      setEditingSchedule(null);
    }
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id) => base44.entities.ArtistWeeklySchedule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weeklySchedules'] });
    }
  });

  const handleSaveSchedule = () => {
    const payload = {
      studio_id: user.studio_id,
      artist_id: selectedArtistId,
      day_of_week: scheduleForm.day_of_week,
      start_time: scheduleForm.start_time,
      end_time: scheduleForm.end_time,
      location_id: scheduleForm.location_id || null,
      is_active: true
    };
    if (editingSchedule) {
      updateScheduleMutation.mutate({ id: editingSchedule.id, data: payload });
    } else {
      createScheduleMutation.mutate(payload);
    }
  };

  const handleEditSchedule = (sched) => {
    setEditingSchedule(sched);
    setScheduleForm({
      day_of_week: sched.day_of_week,
      start_time: sched.start_time,
      end_time: sched.end_time,
      location_id: sched.location_id || ''
    });
    setShowScheduleForm(true);
  };

  const handleNewSchedule = () => {
    setEditingSchedule(null);
    setScheduleForm({ day_of_week: 1, start_time: '10:00', end_time: '18:00', location_id: '' });
    setShowScheduleForm(true);
  };

  const activeSchedules = weeklySchedules.filter(s => s.is_active).sort((a, b) => a.day_of_week - b.day_of_week);

  const getDaysToShow = () => {
    const start = startOfWeek(startOfMonth(currentDate));
    const end = endOfWeek(endOfMonth(currentDate));
    return eachDayOfInterval({ start, end });
  };

  const getAvailabilityForDay = (day) => {
    if (!selectedArtistId) return [];
    return availabilities.filter(avail => {
      if (avail.artist_id !== selectedArtistId) return false;
      const startDate = parseISO(avail.start_date + 'T00:00:00');
      const endDate = parseISO(avail.end_date + 'T00:00:00');
      return isWithinInterval(day, { start: startDate, end: endDate });
    });
  };

  const getWeeklyScheduleForDay = (day) => {
    const dow = day.getDay();
    return activeSchedules.filter(s => s.day_of_week === dow);
  };

  const handleAddAvailability = (date) => {
    if (!selectedArtistId) return;
    setSelectedDate(date);
    setSelectedAvailability(null);
    setShowDialog(true);
  };

  const handleEditAvailability = (availability, e) => {
    e.stopPropagation();
    if (!selectedArtistId) return;
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

  const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const handleToday = () => setCurrentDate(new Date());

  const canEdit = isAdmin || (currentArtist && currentArtist.user_id === user?.id);

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

  if (!currentArtist) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-gray-900 mb-2">No Artist Profile</h2>
              <p className="text-gray-500">
                {isAdmin
                  ? 'No active artists found. Add an artist from the Artists page first.'
                  : 'You need an artist profile to manage availability. Ask an admin to create one for you.'}
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
            <h1 className="text-3xl font-bold text-gray-900">Availability</h1>
            <p className="text-gray-500 mt-1">
              {isAdmin ? 'Manage artist working hours and time off' : 'Set your working hours and time off'}
            </p>
          </div>
          {isAdmin && activeArtists.length > 1 && (
            <div className="flex items-center gap-2">
              <Label className="text-sm text-gray-600 whitespace-nowrap">Artist:</Label>
              <Select
                value={selectedArtistId || ''}
                onValueChange={(v) => {
                  setSelectedArtistId(v);
                  setShowScheduleForm(false);
                  setEditingSchedule(null);
                }}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select artist" />
                </SelectTrigger>
                <SelectContent>
                  {activeArtists.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.full_name}
                      {a.user_id === user.id ? ' (You)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <Card className="bg-white border-none shadow-lg">
          <CardContent className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-900">Weekly Schedule</h2>
              {canEdit && (
                <Button size="sm" onClick={handleNewSchedule} className="bg-indigo-600 hover:bg-indigo-700">
                  <Plus className="w-4 h-4 mr-1" /> Add Day
                </Button>
              )}
            </div>

            {activeSchedules.length === 0 && !showScheduleForm && (
              <p className="text-sm text-gray-500 text-center py-4">No recurring weekly schedule set. Add regular working days.</p>
            )}

            {activeSchedules.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
                {activeSchedules.map(sched => {
                  const loc = locations.find(l => l.id === sched.location_id);
                  return (
                    <div key={sched.id} className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm group">
                      <div>
                        <span className="font-semibold text-green-900">{DAY_NAMES[sched.day_of_week]}</span>
                        <span className="text-green-700 ml-2">{sched.start_time} – {sched.end_time}</span>
                        {loc && <span className="text-green-600 ml-1 text-xs">({loc.name})</span>}
                      </div>
                      {canEdit && (
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => handleEditSchedule(sched)} className="text-gray-500 hover:text-indigo-600">
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deleteScheduleMutation.mutate(sched.id)} className="text-gray-500 hover:text-red-600">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {showScheduleForm && canEdit && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Day</Label>
                    <Select
                      value={String(scheduleForm.day_of_week)}
                      onValueChange={(v) => setScheduleForm({ ...scheduleForm, day_of_week: parseInt(v) })}
                    >
                      <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DAY_NAMES.map((name, idx) => (
                          <SelectItem key={idx} value={String(idx)}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Start</Label>
                    <Input
                      type="time"
                      value={scheduleForm.start_time}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, start_time: e.target.value })}
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">End</Label>
                    <Input
                      type="time"
                      value={scheduleForm.end_time}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, end_time: e.target.value })}
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Location</Label>
                    <Select
                      value={scheduleForm.location_id || '__all__'}
                      onValueChange={(v) => setScheduleForm({ ...scheduleForm, location_id: v === '__all__' ? '' : v })}
                    >
                      <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All Locations</SelectItem>
                        {locations.map(l => (
                          <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => { setShowScheduleForm(false); setEditingSchedule(null); }}>Cancel</Button>
                  <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={handleSaveSchedule}
                    disabled={createScheduleMutation.isPending || updateScheduleMutation.isPending}
                  >
                    {editingSchedule ? 'Update' : 'Save'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

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
                const dayWeeklySchedules = getWeeklyScheduleForDay(day);
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
                      {isCurrentMonth && canEdit && (
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
                      {dayWeeklySchedules.map(ws => {
                        const loc = locations.find(l => l.id === ws.location_id);
                        return (
                          <div key={'ws-' + ws.id} className="text-xs p-1.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700">
                            <div className="font-medium">{ws.start_time} – {ws.end_time}</div>
                            <div className="text-indigo-500 text-[10px]">{loc ? loc.name : 'All'} (weekly)</div>
                          </div>
                        );
                      })}
                      {dayAvailabilities.map(avail => {
                        const location = locations.find(l => l.id === avail.location_id);
                        const isMultiDay = avail.start_date !== avail.end_date;
                        
                        return (
                          <div
                            key={avail.id}
                            onClick={(e) => canEdit && handleEditAvailability(avail, e)}
                            className={`text-xs p-2 rounded ${canEdit ? 'cursor-pointer' : ''} ${
                              avail.is_blocked
                                ? 'bg-red-100 border border-red-200 hover:bg-red-200'
                                : 'bg-green-100 border border-green-200 hover:bg-green-200'
                            } group relative transition-colors`}
                          >
                            {canEdit && (
                              <button
                                onClick={(e) => handleDelete(avail.id, e)}
                                className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-3 h-3 text-gray-600 hover:text-red-600" />
                              </button>
                            )}
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
                <h3 className="font-semibold text-gray-900 mb-2">How Availability Works</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  <li>• Use <strong>Weekly Schedule</strong> to set regular working days (e.g. Mon/Wed/Fri 10am–6pm)</li>
                  <li>• Use the calendar to add one-off availability or block off specific time</li>
                  <li>• Set date ranges for multi-day periods (like vacations)</li>
                  <li>• Choose a specific location or leave blank for all locations</li>
                  <li>• Mark time as "blocked" for time off or breaks</li>
                  <li>• Appointments can only be booked during scheduled or available times</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedArtistId && user && (
        <AvailabilityDialog
          open={showDialog}
          onOpenChange={setShowDialog}
          date={selectedDate}
          availability={selectedAvailability}
          artistId={selectedArtistId}
          locations={locations}
          currentUser={user}
        />
      )}
    </div>
  );
}
