import React from "react";
import { Badge } from "@/components/ui/badge";
import { Clock, MapPin, User } from "lucide-react";

export default function AppointmentCard({ appointment, artists, locations, onClick, compact = false, detailed = false, isOwnAppointment = true }) {
  const artist = artists.find(a => a.id === appointment.artist_id);
  const location = locations.find(l => l.id === appointment.location_id);

  const statusColors = {
    scheduled: "bg-gray-100 text-gray-800 border-gray-200",
    confirmed: "bg-blue-100 text-blue-800 border-blue-200",
    completed: "bg-green-100 text-green-800 border-green-200",
    cancelled: "bg-red-100 text-red-800 border-red-200",
    no_show: "bg-red-100 text-red-800 border-red-200"
  };

  const statusBlockColors = {
    scheduled: "bg-gray-400 hover:bg-gray-500",
    confirmed: "bg-blue-500 hover:bg-blue-600",
    completed: "bg-green-500 hover:bg-green-600",
    cancelled: "bg-red-500 hover:bg-red-600",
    no_show: "bg-red-500 hover:bg-red-600"
  };

  // For month/week calendar view - super minimal
  if (compact) {
    const statusColor = statusBlockColors[appointment.status] || statusBlockColors.scheduled;
    return (
      <div
        onClick={onClick}
        className={`${statusColor} text-white rounded px-2 py-1 text-xs cursor-pointer transition-colors`}
      >
        <div className="font-medium truncate">{appointment.start_time}</div>
      </div>
    );
  }

  // For detailed day view
  if (detailed) {
    return (
      <div
        onClick={onClick}
        className="p-4 rounded-xl border-2 border-gray-100 hover:border-indigo-200 hover:shadow-md transition-all duration-200 cursor-pointer bg-white"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">
              {appointment.client_name?.charAt(0) || 'C'}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{appointment.client_name}</h3>
              <p className="text-sm text-gray-500">{artist?.full_name}</p>
            </div>
          </div>
          <Badge className={`${statusColors[appointment.status]} border`}>
            {appointment.status}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <Clock className="w-4 h-4" />
            {appointment.start_time} ({appointment.duration_hours}h)
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <MapPin className="w-4 h-4" />
            {location?.name}
          </div>
        </div>

        {appointment.design_description && (
          <p className="text-sm text-gray-600 mt-3 line-clamp-2">
            {appointment.design_description}
          </p>
        )}

        {appointment.total_estimate > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Total Estimate</span>
              <span className="text-lg font-bold text-gray-900">${appointment.total_estimate}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Default view for appointment list
  return (
    <div
      onClick={onClick}
      className="p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:shadow-sm transition-all duration-200 cursor-pointer bg-white"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="font-medium text-gray-900 truncate">
            {appointment.start_time} - {appointment.client_name}
          </span>
        </div>
        <Badge className={`${statusColors[appointment.status]} border text-xs shrink-0`}>
          {appointment.status}
        </Badge>
      </div>
      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
        <User className="w-3 h-3" />
        <span className="truncate">{artist?.full_name}</span>
        <span>•</span>
        <MapPin className="w-3 h-3" />
        <span className="truncate">{location?.name}</span>
      </div>
    </div>
  );
}