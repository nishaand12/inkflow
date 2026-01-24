import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save } from "lucide-react";

export default function UserRoleDialog({ open, onOpenChange, user }) {
  const queryClient = useQueryClient();
  const [userRole, setUserRole] = useState('Front_Desk');

  useEffect(() => {
    if (user) {
      // Initialize userRole. If user.user_role exists, use it.
      // Otherwise, if user.role is 'admin', set to 'Admin', else default to 'Front_Desk'.
      // This also handles cases where an old role like 'Studio_Admin' might exist in `user.user_role`
      // but is no longer an option, it will still display that role. The select will then allow changing it.
      // If user.user_role is null/undefined and user.role is not 'admin', it defaults to 'Front_Desk'.
      setUserRole(user.user_role || (user.role === 'admin' ? 'Admin' : 'Front_Desk'));
    }
  }, [user]);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.User.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onOpenChange(false);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (user) {
      updateMutation.mutate({
        id: user.id,
        data: { user_role: userRole }
      });
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            Edit User Role & Permissions
          </DialogTitle>
          <DialogDescription>
            Change the role and permissions for {user.email}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="user_role">User Role</Label>
            <Select
              value={userRole}
              onValueChange={setUserRole}
              required
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Owner">Owner (Full Access)</SelectItem>
                <SelectItem value="Admin">Admin (Full Access)</SelectItem>
                <SelectItem value="Front_Desk">Front Desk (Manage Appointments)</SelectItem>
                <SelectItem value="Artist">Artist (Own Schedule Only)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 mb-2">Role Permissions:</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              {(userRole === 'Owner' || userRole === 'Admin') && (
                <>
                  <li>• Full system access to all features</li>
                  <li>• Manage all users, locations, and workstations</li>
                  <li>• Create and manage all appointments</li>
                  <li>• Access revenue reports and analytics</li>
                  <li>• View and edit all studio data</li>
                </>
              )}
              {userRole === 'Front_Desk' && (
                <>
                  <li>• View and manage all appointments</li>
                  <li>• Create appointments for any active artist</li>
                  <li>• Manage customer profiles</li>
                  <li>• Cannot access reports or system settings</li>
                  <li>• Cannot manage users or locations</li>
                </>
              )}
              {userRole === 'Artist' && (
                <>
                  <li>• View and manage own appointments only</li>
                  <li>• Set personal availability schedule</li>
                  <li>• Create new appointments</li>
                  <li>• Cannot access other artists' schedules</li>
                  <li>• Cannot access system administration</li>
                </>
              )}
            </ul>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-700"
              disabled={updateMutation.isPending}
            >
              <Save className="w-4 h-4 mr-2" />
              Update Role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}