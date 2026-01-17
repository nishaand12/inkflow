import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Clock, DollarSign } from "lucide-react";
import { normalizeUserRole } from "@/utils/roles";
import AppointmentTypeDialog from "../components/appointment-types/AppointmentTypeDialog";

const categoryColors = {
  'Tattoo': 'bg-purple-100 text-purple-800 border-purple-200',
  'Piercing': 'bg-pink-100 text-pink-800 border-pink-200',
  'Deposit': 'bg-green-100 text-green-800 border-green-200',
  'Other': 'bg-gray-100 text-gray-800 border-gray-200'
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
    queryKey: ['appointmentTypes', user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.AppointmentType.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id
  });

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === 'admin' ? 'Admin' : 'Front_Desk'));
  };

  const userRole = getUserRole();
  const isAdmin = userRole === 'Admin' || userRole === 'Owner';

  const groupedTypes = appointmentTypes.reduce((acc, type) => {
    if (!acc[type.category]) {
      acc[type.category] = [];
    }
    acc[type.category].push(type);
    return acc;
  }, {});

  const handleEdit = (type) => {
    setSelectedType(type);
    setShowDialog(true);
  };

  const handleNew = () => {
    setSelectedType(null);
    setShowDialog(true);
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">
                Only Admins can manage appointment types.
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
            <h1 className="text-3xl font-bold text-gray-900">Appointment Types</h1>
            <p className="text-gray-500 mt-1">Manage appointment categories and defaults</p>
          </div>
          <Button 
            onClick={handleNew}
            className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Appointment Type
          </Button>
        </div>

        {['Tattoo', 'Piercing', 'Deposit', 'Other'].map(category => {
          const types = groupedTypes[category] || [];
          if (types.length === 0) return null;

          return (
            <Card key={category} className="bg-white border-none shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge className={`${categoryColors[category]} border`}>
                    {category}
                  </Badge>
                  <span className="text-gray-500 text-sm font-normal">
                    ({types.length} {types.length === 1 ? 'type' : 'types'})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {types.map(type => (
                    <div
                      key={type.id}
                      onClick={() => handleEdit(type)}
                      className="p-4 rounded-xl border-2 border-gray-100 hover:border-indigo-200 hover:shadow-md transition-all duration-200 cursor-pointer"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <h3 className="font-bold text-gray-900">{type.name}</h3>
                        <Badge className={type.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                          {type.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      {type.description && (
                        <p className="text-sm text-gray-600 mb-3 line-clamp-2">{type.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1 text-gray-600">
                          <Clock className="w-4 h-4" />
                          <span>{type.default_duration}h</span>
                        </div>
                        <div className="flex items-center gap-1 text-gray-600">
                          <DollarSign className="w-4 h-4" />
                          <span>${type.default_deposit}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}

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