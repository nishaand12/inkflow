import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, Users } from "lucide-react";

export default function OnboardingChoice() {
  const [mode, setMode] = useState(null); // 'create' or 'join'
  const [formData, setFormData] = useState({
    name: '',
    hq_location: '',
    phone: '',
    currency: 'USD'
  });
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const generateInviteCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const createStudioMutation = useMutation({
    mutationFn: async (data) => {
      setIsSubmitting(true);
      const currentUser = await base44.auth.me();
      const code = generateInviteCode();
      
      const studio = await base44.entities.Studio.create({
        name: data.name,
        hq_location: data.hq_location,
        phone: data.phone,
        currency: data.currency,
        invite_code: code,
        is_active: false,
        owner_id: currentUser.id
      });

      await base44.auth.updateMe({
        studio_id: studio.id,
        user_role: 'Owner',
        is_onboarded: true
      });

      return studio;
    },
    onSuccess: () => {
      window.location.href = '/';
    },
    onError: (err) => {
      setIsSubmitting(false);
      setError(err.message || 'Failed to create studio');
    }
  });

  const joinStudioMutation = useMutation({
    mutationFn: async (code) => {
      setIsSubmitting(true);
      const studios = await base44.entities.Studio.filter({ invite_code: code });
      
      if (studios.length === 0) {
        throw new Error('Invalid invite code');
      }

      const studio = studios[0];

      await base44.auth.updateMe({
        studio_id: studio.id,
        user_role: 'Artist',
        is_onboarded: true
      });

      return studio;
    },
    onSuccess: () => {
      window.location.href = '/';
    },
    onError: (err) => {
      setIsSubmitting(false);
      setError(err.message || 'Failed to join studio');
    }
  });

  const handleCreateStudio = (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError('');
    createStudioMutation.mutate(formData);
  };

  const handleJoinStudio = (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError('');
    joinStudioMutation.mutate(inviteCode);
  };

  if (!mode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center p-6">
        <div className="max-w-4xl w-full">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Welcome to InkFlow</h1>
            <p className="text-gray-600">Choose how you'd like to get started</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card className="cursor-pointer hover:shadow-xl transition-shadow border-2 hover:border-indigo-400" onClick={() => setMode('create')}>
              <CardHeader className="text-center">
                <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Building2 className="w-8 h-8 text-indigo-600" />
                </div>
                <CardTitle className="text-2xl">Create New Studio</CardTitle>
                <CardDescription>Start your own tattoo studio and invite your team</CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <Button className="bg-indigo-600 hover:bg-indigo-700 w-full">
                  Get Started
                </Button>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-xl transition-shadow border-2 hover:border-purple-400" onClick={() => setMode('join')}>
              <CardHeader className="text-center">
                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-purple-600" />
                </div>
                <CardTitle className="text-2xl">Join Existing Studio</CardTitle>
                <CardDescription>Enter an invite code to join a studio</CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <Button className="bg-purple-600 hover:bg-purple-700 w-full">
                  Join Studio
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'create') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center p-6">
        <Card className="max-w-2xl w-full">
          <CardHeader>
            <CardTitle className="text-2xl">Create Your Studio</CardTitle>
            <CardDescription>Set up your tattoo studio profile</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateStudio} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="name">Studio Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="hq_location">Headquarters Location *</Label>
                <Input
                  id="hq_location"
                  value={formData.hq_location}
                  onChange={(e) => setFormData({ ...formData, hq_location: e.target.value })}
                  placeholder="City, State/Province"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Input
                  id="currency"
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                  placeholder="USD, CAD, EUR, etc."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setMode(null)} className="flex-1">
                  Back
                </Button>
                <Button 
                  type="submit" 
                  className="bg-indigo-600 hover:bg-indigo-700 flex-1"
                  disabled={isSubmitting || createStudioMutation.isPending}
                >
                  {isSubmitting || createStudioMutation.isPending ? 'Creating...' : 'Create Studio'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="text-2xl">Join a Studio</CardTitle>
          <CardDescription>Enter the 8-character invite code</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleJoinStudio} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="invite_code">Invite Code *</Label>
              <Input
                id="invite_code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="XXXXXXXX"
                maxLength={8}
                className="text-lg tracking-wider text-center font-mono"
                required
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setMode(null)} className="flex-1">
                Back
              </Button>
              <Button 
                type="submit" 
                className="bg-purple-600 hover:bg-purple-700 flex-1"
                disabled={isSubmitting || joinStudioMutation.isPending || inviteCode.length !== 8}
              >
                {isSubmitting || joinStudioMutation.isPending ? 'Joining...' : 'Join Studio'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}