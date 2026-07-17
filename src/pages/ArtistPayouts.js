import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { DollarSign, Plus } from "lucide-react";
import { normalizeUserRole } from "@/utils/roles";
import { isSupportStaffArtistType } from "@/utils/artistTypes";
import {
  toReportsArtistId,
  useWorkspaceFilters,
  useWorkspaceUrlSync,
} from "@/hooks/useWorkspaceFilters";

const PAYOUTS_URL_PARAMS = {
  start: "startDate",
  end: "endDate",
  artist: "artistId",
};

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toFixed(2)}`;
}

function entryLabel(type) {
  if (type === "settlement_share") return "Service fees";
  if (type === "tip") return "Tips";
  if (type === "payout") return "Payout";
  return "Adjustment";
}

function inDateRange(occurredOn, start, end) {
  if (!occurredOn) return false;
  return occurredOn >= start && occurredOn <= end;
}

function computeBalances(artists, artistById, entries) {
  const map = {};
  for (const artist of artists) {
    map[artist.id] = {
      artist_id: artist.id,
      artist_name: artist.full_name || "Unknown",
      balance: 0,
      earned: 0,
      paid: 0,
    };
  }
  for (const entry of entries) {
    if (!map[entry.artist_id]) {
      map[entry.artist_id] = {
        artist_id: entry.artist_id,
        artist_name: artistById[entry.artist_id]?.full_name || "Unknown",
        balance: 0,
        earned: 0,
        paid: 0,
      };
    }
    const amount = Number(entry.amount) || 0;
    map[entry.artist_id].balance += amount;
    if (amount >= 0) map[entry.artist_id].earned += amount;
    else map[entry.artist_id].paid += Math.abs(amount);
  }
  return Object.values(map);
}

export default function ArtistPayouts() {
  const queryClient = useQueryClient();
  const { filters, setFilters } = useWorkspaceFilters();
  useWorkspaceUrlSync(PAYOUTS_URL_PARAMS);

  const startDate = filters.startDate;
  const endDate = filters.endDate;
  const filterArtist = toReportsArtistId(filters.artistId);

  const setStartDate = (value) => setFilters({ startDate: value });
  const setEndDate = (value) => setFilters({ endDate: value });
  const setFilterArtist = (value) => setFilters({ artistId: value });

  const [user, setUser] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({
    artist_id: "",
    amount: "",
    payout_method: "E-Transfer",
    payout_date: format(new Date(), "yyyy-MM-dd"),
    notes: "",
  });

  useEffect(() => {
    (async () => {
      try {
        setUser(await base44.auth.me());
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const studioId = user?.studio_id;

  const { data: artists = [] } = useQuery({
    queryKey: ["artists", studioId],
    queryFn: () => base44.entities.Artist.filter({ studio_id: studioId }),
    enabled: !!studioId,
  });

  const { data: ledgerEntries = [], isLoading: loadingLedger } = useQuery({
    queryKey: ["artistLedgerEntries", studioId],
    queryFn: () => base44.entities.ArtistLedgerEntry.filter({ studio_id: studioId }),
    enabled: !!studioId,
  });

  const userRole = user
    ? normalizeUserRole(user.user_role || (user.role === "admin" ? "Admin" : "Front_Desk"))
    : null;
  const isAdmin = userRole === "Admin" || userRole === "Owner";
  const isArtist = userRole === "Artist";

  const userArtist = useMemo(
    () => artists.find((a) => a.user_id === user?.id),
    [artists, user]
  );

  const artistById = useMemo(() => {
    const m = {};
    for (const artist of artists) m[artist.id] = artist;
    return m;
  }, [artists]);

  // Payouts only concern tattoo artists / piercers — never counter or scrub staff.
  const payoutArtists = useMemo(
    () => artists.filter((a) => !isSupportStaffArtistType(a.artist_type)),
    [artists]
  );

  const supportStaffIds = useMemo(
    () =>
      new Set(
        artists.filter((a) => isSupportStaffArtistType(a.artist_type)).map((a) => a.id)
      ),
    [artists]
  );

  const periodEntries = useMemo(
    () => ledgerEntries.filter((e) => inDateRange(e.occurred_on, startDate, endDate)),
    [ledgerEntries, startDate, endDate]
  );

  const balances = useMemo(() => {
    const allTimeByArtist = Object.fromEntries(
      computeBalances(payoutArtists, artistById, ledgerEntries).map((b) => [b.artist_id, b.balance])
    );
    return computeBalances(payoutArtists, artistById, periodEntries)
      .filter((row) => !supportStaffIds.has(row.artist_id))
      .map((row) => ({
        ...row,
        totalBalance: allTimeByArtist[row.artist_id] ?? 0,
      }))
      .sort((a, b) => b.totalBalance - a.totalBalance);
  }, [payoutArtists, artistById, ledgerEntries, periodEntries, supportStaffIds]);

  const recentLedgerEntries = useMemo(
    () =>
      [...periodEntries].sort((a, b) => {
        const dateCompare = (b.occurred_on || "").localeCompare(a.occurred_on || "");
        if (dateCompare !== 0) return dateCompare;
        return (b.created_at || "").localeCompare(a.created_at || "");
      }),
    [periodEntries]
  );

  const visibleBalances = useMemo(() => {
    const scoped = isAdmin
      ? balances
      : balances.filter((b) => b.artist_id === userArtist?.id);
    if (isAdmin && filterArtist !== "all") {
      return scoped.filter((b) => b.artist_id === filterArtist);
    }
    return scoped;
  }, [isAdmin, balances, userArtist, filterArtist]);

  const visibleLedgerEntries = useMemo(() => {
    const withoutSupportStaff = recentLedgerEntries.filter(
      (e) => !supportStaffIds.has(e.artist_id)
    );
    const scoped = isAdmin
      ? withoutSupportStaff
      : withoutSupportStaff.filter((e) => e.artist_id === userArtist?.id);
    if (isAdmin && filterArtist !== "all") {
      return scoped.filter((e) => e.artist_id === filterArtist);
    }
    return scoped;
  }, [isAdmin, recentLedgerEntries, userArtist, filterArtist, supportStaffIds]);

  const recordPayout = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(form.amount);
      if (!form.artist_id || !Number.isFinite(amount) || amount <= 0) {
        throw new Error("Choose an artist and enter a payout amount.");
      }

      const payout = await base44.entities.ArtistPayout.create({
        studio_id: studioId,
        artist_id: form.artist_id,
        amount,
        payout_method: form.payout_method,
        payout_date: form.payout_date,
        notes: form.notes || null,
        created_by: user.id,
      });

      await base44.entities.ArtistLedgerEntry.create({
        studio_id: studioId,
        artist_id: form.artist_id,
        payout_id: payout.id,
        entry_type: "payout",
        amount: -amount,
        description: form.notes || `Artist payout via ${form.payout_method}`,
        occurred_on: form.payout_date,
        created_by: user.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artistPayouts"] });
      queryClient.invalidateQueries({ queryKey: ["artistLedgerEntries"] });
      setShowDialog(false);
      setForm({
        artist_id: "",
        amount: "",
        payout_method: "E-Transfer",
        payout_date: format(new Date(), "yyyy-MM-dd"),
        notes: "",
      });
    },
  });

  if (!isAdmin && !isArtist) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">Only Owners, Admins, and Artists can view payouts.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <DollarSign className="w-8 h-8 text-indigo-600" />
              {isAdmin ? "Artist Payouts" : "My Earnings"}
            </h1>
            <p className="text-gray-500 mt-1">
              {isAdmin
                ? "Track what the studio owes artists from settlements and record manual payouts."
                : "Your accrued earnings and payouts from daily settlements."}
            </p>
          </div>
          {isAdmin && (
            <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={() => setShowDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Record Payout
            </Button>
          )}
        </div>

        <Card className="bg-white border-none shadow-lg">
          <CardHeader>
            <CardTitle>Artist Balances</CardTitle>
            <p className="text-sm text-gray-500 font-normal">
              Earned, Paid, and Balance Owed reflect the selected date range. Total Balance Owed is
              across all periods.
            </p>
            <div className="flex flex-wrap gap-4 items-end pt-2">
              <div className="space-y-1">
                <Label htmlFor="start-date">Start date</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="end-date">End date</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              {isAdmin && (
                <div className="space-y-1">
                  <Label>Artist</Label>
                  <Select value={filterArtist} onValueChange={setFilterArtist}>
                    <SelectTrigger className="min-w-[180px]">
                      <SelectValue placeholder="All artists" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All artists</SelectItem>
                      {payoutArtists.map((artist) => (
                        <SelectItem key={artist.id} value={artist.id}>
                          {artist.full_name || "Unknown"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loadingLedger ? (
              <p className="text-gray-500">Loading balances…</p>
            ) : visibleBalances.length === 0 ? (
              <p className="text-gray-500">No artists found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artist</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance Owed</TableHead>
                    <TableHead className="text-right">Total Balance Owed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleBalances.map((row) => (
                    <TableRow key={row.artist_id}>
                      <TableCell className="font-medium">{row.artist_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.earned)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.paid)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.balance)}</TableCell>
                      <TableCell className="text-right tabular-nums font-bold text-indigo-900">
                        {money(row.totalBalance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="bg-white border-none shadow-lg">
          <CardHeader>
            <CardTitle>Ledger</CardTitle>
            <p className="text-sm text-gray-500 font-normal">
              Positive entries increase what the studio owes; payouts reduce it.
            </p>
          </CardHeader>
          <CardContent>
            {visibleLedgerEntries.length === 0 ? (
              <p className="text-gray-500">
                {ledgerEntries.length === 0
                  ? "No ledger entries yet. Generate a settlement to add earnings."
                  : "No ledger entries in the selected date range."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Artist</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleLedgerEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.occurred_on || "—"}</TableCell>
                      <TableCell>{artistById[entry.artist_id]?.full_name || "Unknown"}</TableCell>
                      <TableCell>
                        <Badge
                          className={
                            entry.entry_type === "payout"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-green-100 text-green-800"
                          }
                        >
                          {entryLabel(entry.entry_type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate">
                        {entry.description || "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-medium ${
                          Number(entry.amount) < 0 ? "text-blue-800" : "text-green-800"
                        }`}
                      >
                        {money(entry.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle>Record Artist Payout</DialogTitle>
              <DialogDescription>
                This records a manual payout and reduces the artist&apos;s outstanding balance.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Artist</Label>
                <Select
                  value={form.artist_id}
                  onValueChange={(artist_id) => setForm((prev) => ({ ...prev, artist_id }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose artist" />
                  </SelectTrigger>
                  <SelectContent>
                    {payoutArtists.map((artist) => (
                      <SelectItem key={artist.id} value={artist.id}>
                        {artist.full_name || "Unknown"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payout Date</Label>
                  <Input
                    type="date"
                    value={form.payout_date}
                    onChange={(e) => setForm((prev) => ({ ...prev, payout_date: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Method</Label>
                <Select
                  value={form.payout_method}
                  onValueChange={(payout_method) =>
                    setForm((prev) => ({ ...prev, payout_method }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="E-Transfer">E-Transfer</SelectItem>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                    <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Optional notes"
                />
              </div>

              {recordPayout.error && (
                <p className="text-sm text-red-600">{recordPayout.error.message}</p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>
                Cancel
              </Button>
              <Button
                className="bg-indigo-600 hover:bg-indigo-700"
                disabled={recordPayout.isPending}
                onClick={() => recordPayout.mutate()}
              >
                {recordPayout.isPending ? "Saving…" : "Save Payout"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
