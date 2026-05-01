import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Clock, DollarSign } from "lucide-react";
import { normalizeUserRole } from "@/utils/roles";
import { formatDuration } from "@/utils/index";
import {
  CATEGORY_ROLE_APPOINTMENT_KIND,
  filterCategoriesByRole,
  getAppointmentTypeDisplaySections,
  getCategoryPathLabel,
} from "@/utils/reportingCategories";
import AppointmentTypeDialog from "@/components/appointment-types/AppointmentTypeDialog";

const getCategoryStyle = (sectionKey) => {
  if (sectionKey === "kind:orphan") return "bg-amber-100 text-amber-900 border-amber-200";
  if (sectionKey === "unassigned:kind") return "bg-orange-100 text-orange-900 border-orange-200";
  if (sectionKey?.startsWith("kind:")) return "bg-indigo-100 text-indigo-800 border-indigo-200";
  return "bg-gray-100 text-gray-800 border-gray-200";
};

export default function AppointmentTypes() {
  const [showDialog, setShowDialog] = useState(false);
  const [selectedType, setSelectedType] = useState(null);
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

  const { data: appointmentTypes = [] } = useQuery({
    queryKey: ["appointmentTypes", user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.AppointmentType.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id,
  });

  const { data: reportingCategories = [] } = useQuery({
    queryKey: ["reportingCategories", user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.ReportingCategory.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id,
  });

  const sections = useMemo(
    () => getAppointmentTypeDisplaySections(appointmentTypes, reportingCategories),
    [reportingCategories, appointmentTypes]
  );

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === "admin" ? "Admin" : "Front_Desk"));
  };

  const userRole = getUserRole();
  const isAdmin = userRole === "Admin" || userRole === "Owner";

  const handleEdit = (type) => {
    setSelectedType(type);
    setShowDialog(true);
  };

  const handleNew = () => {
    setSelectedType(null);
    setShowDialog(true);
  };

  const typeSubtitle = (type) => {
    if (type.appointment_kind_category_id) {
      return getCategoryPathLabel(
        filterCategoriesByRole(reportingCategories, CATEGORY_ROLE_APPOINTMENT_KIND),
        type.appointment_kind_category_id
      );
    }
    return type.category || "";
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">Only Admins can manage appointment types.</p>
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
            <h1 className="text-3xl font-bold text-gray-900">Appointment Types</h1>
            <p className="text-gray-500 mt-1">
              Booking hierarchy comes from Categories → Booking Hierarchy; reporting uses Reporting
              Categories
            </p>
          </div>
          <Button
            onClick={handleNew}
            className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Appointment Type
          </Button>
        </div>

        {sections.map((section) => (
          <Card key={section.key} className="bg-white border-none shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge className={`${getCategoryStyle(section.key)} border`}>{section.label}</Badge>
                <span className="text-gray-500 text-sm font-normal">
                  ({section.types.length} {section.types.length === 1 ? "type" : "types"})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {section.types.map((type) => (
                  <div
                    key={type.id}
                    onClick={() => handleEdit(type)}
                    className="p-4 rounded-xl border-2 border-gray-100 hover:border-indigo-200 hover:shadow-md transition-all duration-200 cursor-pointer"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-bold text-gray-900">{type.name}</h3>
                        {typeSubtitle(type) && (
                          <p className="text-xs text-gray-500 mt-0.5">{typeSubtitle(type)}</p>
                        )}
                      </div>
                      <Badge
                        className={
                          type.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                        }
                      >
                        {type.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    {type.description && (
                      <p className="text-sm text-gray-600 mb-3 line-clamp-2">{type.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-sm flex-wrap">
                      <div className="flex items-center gap-1 text-gray-600">
                        <Clock className="w-4 h-4" />
                        <span>{formatDuration(type.default_duration_minutes)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-gray-600">
                        <DollarSign className="w-4 h-4" />
                        <span>Deposit: ${type.default_deposit}</span>
                      </div>
                      {type.service_cost != null && (
                        <div className="flex items-center gap-1 text-indigo-600 font-medium">
                          <DollarSign className="w-4 h-4" />
                          <span>${type.service_cost}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}

        {appointmentTypes.length === 0 && (
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <p className="text-gray-500 mb-4">No appointment types configured</p>
              <Button onClick={handleNew} className="bg-indigo-600 hover:bg-indigo-700">
                <Plus className="w-4 h-4 mr-2" />
                Add First Type
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <AppointmentTypeDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        appointmentType={selectedType}
        currentUser={user}
      />
    </div>
  );
}
