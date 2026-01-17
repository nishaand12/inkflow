import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Key, Copy, Check } from "lucide-react";
import { normalizeUserRole } from "@/utils/roles";

export default function StudioSettings() {
  const [user, setUser] = useState(null);
  const [studio, setStudio] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadUserAndStudio();
  }, []);

  const loadUserAndStudio = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      if (currentUser.studio_id) {
        const studios = await base44.entities.Studio.filter({ id: currentUser.studio_id });
        if (studios.length > 0) {
          setStudio(studios[0]);
        }
      }
    } catch (error) {
      console.error("Error loading studio:", error);
    }
  };

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === 'admin' ? 'Admin' : 'Front_Desk'));
  };

  const userRole = getUserRole();
  const isOwnerOrAdmin = userRole === 'Owner' || userRole === 'Admin';

  const handleCopyInviteCode = () => {
    if (studio?.invite_code) {
      navigator.clipboard.writeText(studio.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isOwnerOrAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">
                Only Owners and Admins can access studio settings.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Studio Settings</h1>
          <p className="text-gray-500 mt-1">Manage your studio configuration</p>
        </div>

        {studio && (
          <>
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                    <Building2 className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl">{studio.name}</CardTitle>
                    <p className="text-sm text-gray-500">{studio.hq_location}</p>
                  </div>
                  <Badge className={studio.is_active ? 'bg-green-100 text-green-800 ml-auto' : 'bg-amber-100 text-amber-800 ml-auto'}>
                    {studio.is_active ? 'Active' : 'Pending Validation'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Phone</label>
                    <p className="text-gray-900 mt-1">{studio.phone || 'Not set'}</p>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Currency</label>
                    <p className="text-gray-900 mt-1">{studio.currency}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-indigo-50 to-purple-50 border-none shadow-lg">
              <CardHeader className="border-b border-indigo-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center">
                    <Key className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl text-gray-900">Studio Invite Code</CardTitle>
                    <p className="text-sm text-gray-600">Share this code to invite team members</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="bg-white border-2 border-indigo-200 rounded-xl p-4 text-center">
                      <div className="text-3xl font-bold text-indigo-600 tracking-wider font-mono">
                        {studio.invite_code}
                      </div>
                    </div>
                  </div>
                  <Button
                    onClick={handleCopyInviteCode}
                    className="bg-indigo-600 hover:bg-indigo-700"
                    size="lg"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy Code
                      </>
                    )}
                  </Button>
                </div>

                <div className="mt-6 bg-white/70 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-2">How to invite team members:</h4>
                  <ol className="text-sm text-gray-600 space-y-1 ml-4 list-decimal">
                    <li>Share this invite code with your team member</li>
                    <li>They sign up for InkFlow using their email</li>
                    <li>During onboarding, they select "Join Existing Studio"</li>
                    <li>They enter this invite code to join your studio</li>
                    <li>Set their role by contacting ceteasystems@gmail.com</li>
                  </ol>
                </div>
              </CardContent>
            </Card>

            {!studio.is_active && (
              <Card className="bg-amber-50 border-2 border-amber-200 shadow-lg">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-amber-900 mb-2">Studio Activation Pending</h3>
                      <p className="text-sm text-amber-800 mb-3">
                        Your studio is awaiting validation. Once approved, you'll have full access to all features.
                      </p>
                      <p className="text-sm text-amber-700">
                        Contact{' '}
                        <a href="mailto:ceteasystems@gmail.com" className="font-semibold underline">
                          ceteasystems@gmail.com
                        </a>
                        {' '}for assistance.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}