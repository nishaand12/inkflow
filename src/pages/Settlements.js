import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Wallet, Lock, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { normalizeUserRole } from "@/utils/roles";

export default function Settlements() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [filterLocation, setFilterLocation] = useState('all');

  useEffect(() => {
    const loadUser = async () => {
      try {
        const currentUser = await base44.auth.me();
        setUser(currentUser);
      } catch (error) {
        console.error("Error loading user:", error);
      }
    };
    loadUser();
  }, []);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', user?.studio_id],
    queryFn: () => base44.entities.Location.filter({ studio_id: user.studio_id }),
    enabled: !!user?.studio_id
  });

  const { data: settlements = [] } = useQuery({
    queryKey: ['settlements', user?.studio_id],
    queryFn: () => base44.entities.DailySettlement.filter({ studio_id: user.studio_id }),
    enabled: !!user?.studio_id
  });

  const { data: appointments = [] } = useQuery({
    queryKey: ['appointments', user?.studio_id],
    queryFn: () => base44.entities.Appointment.filter({ studio_id: user.studio_id }),
    enabled: !!user?.studio_id
  });

  const { data: charges = [] } = useQuery({
    queryKey: ['appointmentCharges', user?.studio_id],
    queryFn: () => base44.entities.AppointmentCharge.filter({ studio_id: user.studio_id }),
    enabled: !!user?.studio_id
  });

  const { data: splitRules = [] } = useQuery({
    queryKey: ['artistSplitRules', user?.studio_id],
    queryFn: () => base44.entities.ArtistSplitRule.filter({ studio_id: user.studio_id }),
    enabled: !!user?.studio_id
  });

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === 'admin' ? 'Admin' : 'Front_Desk'));
  };

  const userRole = getUserRole();
  const isAdmin = userRole === 'Admin' || userRole === 'Owner';

  const generateSettlement = useMutation({
    mutationFn: async ({ locationId, date }) => {
      const dayAppointments = appointments.filter(
        a => a.appointment_date === date && a.status === 'completed' &&
          (locationId === 'all' || a.location_id === locationId)
      );

      const locationsToSettle = locationId === 'all'
        ? [...new Set(dayAppointments.map(a => a.location_id).filter(Boolean))]
        : [locationId];

      const results = [];

      for (const locId of locationsToSettle) {
        const locAppointments = dayAppointments.filter(a => a.location_id === locId);
        if (locAppointments.length === 0) continue;

        let grossTotal = 0;
        let taxTotal = 0;
        let discountTotal = 0;
        let posCollected = 0;
        let onlineCollected = 0;

        for (const apt of locAppointments) {
          const aptCharges = charges.filter(c => c.appointment_id === apt.id);
          const chargeSum = aptCharges.reduce((s, c) => s + (c.line_total || 0), 0);
          const serviceAmount = (apt.charge_amount || 0) + chargeSum;
          grossTotal += serviceAmount + (apt.deposit_amount || 0);
          taxTotal += apt.tax_amount || 0;
          discountTotal += apt.discount_amount || 0;

          if (apt.payment_method === 'Card' || apt.deposit_status === 'paid') {
            onlineCollected += serviceAmount + (apt.deposit_amount || 0);
          } else {
            posCollected += serviceAmount + (apt.deposit_amount || 0);
          }
        }

        const netTotal = grossTotal - taxTotal - discountTotal;

        const settlement = await base44.entities.DailySettlement.create({
          studio_id: user.studio_id,
          location_id: locId,
          settlement_date: date,
          status: 'locked',
          gross_total: grossTotal,
          tax_total: taxTotal,
          discount_total: discountTotal,
          net_total: netTotal,
          pos_collected: posCollected,
          online_collected: onlineCollected,
          locked_at: new Date().toISOString(),
          locked_by: user.id
        });

        for (const apt of locAppointments) {
          const rule = splitRules.find(r => r.artist_id === apt.artist_id && r.is_active);
          const splitPercent = rule?.split_percent ?? 0;
          const aptCharges = charges.filter(c => c.appointment_id === apt.id);
          const chargeSum = aptCharges.reduce((s, c) => s + (c.line_total || 0), 0);
          const grossAmount = (apt.charge_amount || 0) + (apt.deposit_amount || 0) + chargeSum;
          const artistShare = grossAmount * (splitPercent / 100);

          await base44.entities.DailySettlementLine.create({
            studio_id: user.studio_id,
            settlement_id: settlement.id,
            artist_id: apt.artist_id,
            appointment_id: apt.id,
            gross_amount: grossAmount,
            artist_share: artistShare,
            shop_share: grossAmount - artistShare,
            split_percent: splitPercent
          });
        }

        results.push(settlement);
      }

      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settlements'] });
    }
  });

  const existingSettlement = settlements.find(
    s => s.settlement_date === selectedDate &&
      (filterLocation === 'all' || s.location_id === filterLocation)
  );

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">Only Owners and Admins can access settlements.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const filteredSettlements = settlements
    .filter(s => filterLocation === 'all' || s.location_id === filterLocation)
    .sort((a, b) => b.settlement_date.localeCompare(a.settlement_date));

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Daily Settlements</h1>
          <p className="text-gray-500 mt-1">Generate and review daily payout settlements</p>
        </div>

        <Card className="bg-white border-none shadow-md">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="space-y-2">
                <Label>Settlement Date</Label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={filterLocation} onValueChange={setFilterLocation}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Locations" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Locations</SelectItem>
                    {locations.map(loc => (
                      <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => generateSettlement.mutate({ locationId: filterLocation, date: selectedDate })}
                disabled={generateSettlement.isPending || !!existingSettlement}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {generateSettlement.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                ) : existingSettlement ? (
                  <><Lock className="w-4 h-4 mr-2" /> Already Settled</>
                ) : (
                  <><Wallet className="w-4 h-4 mr-2" /> Generate Settlement</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-none shadow-lg">
          <CardHeader>
            <CardTitle>Settlement History</CardTitle>
          </CardHeader>
          <CardContent>
            {filteredSettlements.length === 0 ? (
              <div className="text-center py-12">
                <Wallet className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No settlements yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Date</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Location</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Gross</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Tax</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Discounts</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Net</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">POS</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Online</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-900">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredSettlements.map(s => {
                      const loc = locations.find(l => l.id === s.location_id);
                      return (
                        <tr key={s.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">{s.settlement_date}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{loc?.name || 'Unknown'}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">${(s.gross_total || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">${(s.tax_total || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">${(s.discount_total || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right font-bold">${(s.net_total || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">${(s.pos_collected || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">${(s.online_collected || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge className={s.status === 'locked' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                              {s.status === 'locked' ? 'Locked' : 'Draft'}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
