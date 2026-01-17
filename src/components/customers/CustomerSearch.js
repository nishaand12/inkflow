import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Search, Plus, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default function CustomerSearch({ customers, onSelect, onNewCustomer, onAdvancedSearch, selectedCustomer }) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const activeCustomers = customers.filter(customer => customer.is_active);

  const filteredCustomers = searchTerm.trim() === ''
    ? activeCustomers.slice(0, 10)
    : activeCustomers.filter(customer =>
        customer.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.phone_number?.includes(searchTerm)
      ).slice(0, 10);

  const handleSelect = (customer) => {
    onSelect(customer);
    setOpen(false);
    setSearchTerm('');
  };

  return (
    <div className="space-y-2" ref={dropdownRef}>
      <div className="relative">
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(!open)}
          className="w-full justify-between text-left"
        >
          <span className={selectedCustomer ? "text-gray-900" : "text-gray-500"}>
            {selectedCustomer ? selectedCustomer.name : "Search customer by name..."}
          </span>
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>

        {open && (
          <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-md shadow-lg max-h-[300px] overflow-auto">
            <div className="p-2 border-b border-gray-200">
              <Input
                placeholder="Search by name, email or phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
                className="h-9"
              />
            </div>
            
            <div className="py-1">
              {filteredCustomers.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-500 text-center">
                  No customers found
                </div>
              ) : (
                filteredCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => handleSelect(customer)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-100 cursor-pointer flex items-center gap-2 transition-colors"
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        selectedCustomer?.id === customer.id ? "opacity-100 text-indigo-600" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="font-medium text-gray-900 truncate">{customer.name}</span>
                      <span className="text-xs text-gray-500 truncate">
                        {customer.email} • {customer.phone_number}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAdvancedSearch}
          className="flex-1"
        >
          <Search className="w-4 h-4 mr-2" />
          Advanced Search
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onNewCustomer}
          className="flex-1"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Customer
        </Button>
      </div>
    </div>
  );
}