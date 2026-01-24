import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Phone, Mail, Instagram, CheckCircle2, XCircle } from "lucide-react";

export default function AdvancedSearchDialog({ open, onOpenChange, customers, onSelectCustomer }) {
  const [filters, setFilters] = useState({
    name: '',
    phone_number: '',
    email: '',
    instagram_username: ''
  });

  const filteredResults = customers.filter(customer => {
    const nameMatch = !filters.name || customer.name?.toLowerCase().includes(filters.name.toLowerCase());
    const phoneMatch = !filters.phone_number || customer.phone_number?.includes(filters.phone_number);
    const emailMatch = !filters.email || customer.email?.toLowerCase().includes(filters.email.toLowerCase());
    const instagramMatch = !filters.instagram_username || customer.instagram_username?.toLowerCase().includes(filters.instagram_username.toLowerCase());
    
    return nameMatch && phoneMatch && emailMatch && instagramMatch;
  });

  const handleSelect = (customer) => {
    onSelectCustomer(customer);
    onOpenChange(false);
  };

  const clearFilters = () => {
    setFilters({
      name: '',
      phone_number: '',
      email: '',
      instagram_username: ''
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Advanced Customer Search</DialogTitle>
          <DialogDescription>
            Search for customers by name, email, or phone number.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="search-name">Name</Label>
              <Input
                id="search-name"
                placeholder="Search by name..."
                value={filters.name}
                onChange={(e) => setFilters({ ...filters, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="search-phone">Phone Number</Label>
              <Input
                id="search-phone"
                placeholder="Search by phone..."
                value={filters.phone_number}
                onChange={(e) => setFilters({ ...filters, phone_number: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="search-email">Email</Label>
              <Input
                id="search-email"
                placeholder="Search by email..."
                value={filters.email}
                onChange={(e) => setFilters({ ...filters, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="search-instagram">Instagram</Label>
              <Input
                id="search-instagram"
                placeholder="Search by Instagram..."
                value={filters.instagram_username}
                onChange={(e) => setFilters({ ...filters, instagram_username: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">
              {filteredResults.length} {filteredResults.length === 1 ? 'result' : 'results'} found
            </p>
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear Filters
            </Button>
          </div>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {filteredResults.length === 0 ? (
              <div className="text-center py-12">
                <Search className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No customers found matching your criteria</p>
              </div>
            ) : (
              filteredResults.map(customer => (
                <div
                  key={customer.id}
                  onClick={() => handleSelect(customer)}
                  className="p-4 rounded-xl border-2 border-gray-100 hover:border-indigo-200 hover:shadow-md transition-all duration-200 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-bold">
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
                                Consent
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

                      <div className="flex flex-wrap gap-4 text-sm">
                        <div className="flex items-center gap-1 text-gray-600">
                          <Phone className="w-4 h-4" />
                          {customer.phone_number}
                        </div>
                        <div className="flex items-center gap-1 text-gray-600">
                          <Mail className="w-4 h-4" />
                          {customer.email}
                        </div>
                        {customer.instagram_username && (
                          <div className="flex items-center gap-1 text-gray-600">
                            <Instagram className="w-4 h-4" />
                            @{customer.instagram_username}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}