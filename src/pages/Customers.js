import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Phone, Mail, Instagram, MapPin, CheckCircle2, XCircle } from "lucide-react";
import { normalizeUserRole } from "@/utils/roles";
import CustomerDialog from "../components/customers/CustomerDialog";

export default function Customers() {
  const [searchTerm, setSearchTerm] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
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

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Customer.filter({ studio_id: user.studio_id }, '-created_date');
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

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === 'admin' ? 'Admin' : 'Front_Desk'));
  };

  const userRole = getUserRole();
  const isAdmin = userRole === 'Admin' || userRole === 'Owner';
  const canEdit = isAdmin || userRole === 'Front_Desk';

  const filteredCustomers = customers.filter(customer =>
    customer.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.phone_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.instagram_username?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleEdit = (customer) => {
    setSelectedCustomer(customer);
    setShowDialog(true);
  };

  const handleNew = () => {
    setSelectedCustomer(null);
    setShowDialog(true);
  };

  if (!canEdit) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">
                Only Admins and Front Desk staff can access customer management.
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
            <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
            <p className="text-gray-500 mt-1">Manage customer profiles and contact information</p>
          </div>
          <Button 
            onClick={handleNew}
            className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Customer
          </Button>
        </div>

        <Card className="bg-white border-none shadow-md">
          <CardContent className="p-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search by name, email, phone, or Instagram..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-none shadow-lg">
          <CardHeader>
            <CardTitle>All Customers ({filteredCustomers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {filteredCustomers.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">No customers found</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCustomers.map(customer => {
                  const preferredLocation = locations.find(l => l.id === customer.preferred_location_id);

                  return (
                    <div
                      key={customer.id}
                      onClick={() => handleEdit(customer)}
                      className="p-4 rounded-xl border-2 border-gray-100 hover:border-indigo-200 hover:shadow-md transition-all duration-200 cursor-pointer"
                    >
                      <div className="flex flex-col lg:flex-row justify-between gap-4">
                        <div className="flex-1 space-y-3">
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">
                              {customer.name?.charAt(0) || 'C'}
                            </div>
                            <div>
                              <h3 className="font-semibold text-gray-900">{customer.name}</h3>
                              <div className="flex items-center gap-2 flex-wrap mt-1">
                                {!customer.is_active && (
                                  <Badge className="bg-gray-100 text-gray-800 border-gray-200 border">
                                    Inactive
                                  </Badge>
                                )}
                                {customer.consent_obtained ? (
                                  <Badge className="bg-green-100 text-green-800 border-green-200 border flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Consent On File
                                  </Badge>
                                ) : (
                                  <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 border flex items-center gap-1">
                                    <XCircle className="w-3 h-3" />
                                    No Consent
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                            <div className="flex items-center gap-2 text-gray-600">
                              <Phone className="w-4 h-4" />
                              {customer.phone_number}
                            </div>
                            <div className="flex items-center gap-2 text-gray-600">
                              <Mail className="w-4 h-4" />
                              {customer.email}
                            </div>
                            {customer.instagram_username && (
                              <div className="flex items-center gap-2 text-gray-600">
                                <Instagram className="w-4 h-4" />
                                @{customer.instagram_username}
                              </div>
                            )}
                            {preferredLocation && (
                              <div className="flex items-center gap-2 text-gray-600">
                                <MapPin className="w-4 h-4" />
                                {preferredLocation.name}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <CustomerDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        customer={selectedCustomer}
        locations={locations}
        isAdmin={isAdmin}
        currentUser={user}
      />
    </div>
  );
}