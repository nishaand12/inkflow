import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { AlertTriangle, DollarSign, Plus } from "lucide-react";
import { normalizeUserRole } from "@/utils/roles";
import { isSupportStaffArtistType } from "@/utils/artistTypes";
import {
  toReportsArtistId,
  useWorkspaceFilters,
  useWorkspaceUrlSync,
} from "@/hooks/useWorkspaceFilters";
import { nextDateRange } from "@/lib/dateRange";
import {
  computeBalances,
  entryLabel,
  entryTypeForDirection,
  ledgerAmountForDirection,
} from "@/utils/artistLedger";

const PAYOUTS_URL_PARAMS = {
  start: "startDate",
  end: "endDate",
  artist: "artistId",
};

const EMPTY_FORM = {
  artist_id: "",
  amount: "",
  direction: "to_artist",
  payout_method: "E-Transfer",
  payout_date: format(new Date(), "yyyy-MM-dd"),
  notes: "",
};

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toFixed(2)}`;
}

function entryBadgeClass(type) {
  if (type === "payout") return "bg-blue-100 text-blue-800";
  if (type === "payback") return "bg-amber-100 text-amber-900";
  return "bg-green-100 text-green-800";
}

function entryAmountClass(entry) {
  if (entry.entry_type === "payout") return "text-blue-800";
  if (entry.entry_type === "payback") return "text-amber-900";
  return Number(entry.amount) < 0 ? "text-blue-800" : "text-green-800";
}

function inDateRange(occurredOn, start, end) {
  if (!occurredOn) return false;
  return occurredOn >= start && occurredOn <= end;
}

function balanceHint(balance) {
  const v = Number(balance) || 0;
  if (v < 0) return "Artist owes studio";
  if (v > 0) return "Studio owes artist";
  return "Settled";
}

export default function ArtistPayouts() {
  const queryClient = useQueryClient();
  const { filters, setFilters } = useWorkspaceFilters();
  useWorkspaceUrlSync(PAYOUTS_URL_PARAMS);

  const startDate = filters.startDate;
  const endDate = filters.endDate;
  const filterArtist = toReportsArtistId(filters.artistId);

  const setStartDate = (value) => setFilters(nextDateRange("start", value, startDate, endDate));
  const setEndDate = (value) => setFilters(nextDateRange("end", value, startDate, endDate));
  const setFilterArtist = (value) => setFilters({ artistId: value });

  const [user, setUser] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

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

  const allTimeBalances = useMemo(() => {
    const rows = computeBalances(payoutArtists, artistById, ledgerEntries);
    return Object.fromEntries(rows.map((b) => [b.artist_id, b.balance]));
  }, [payoutArtists, artistById, ledgerEntries]);

  const balances = useMemo(() => {
    return computeBalances(payoutArtists, artistById, periodEntries)
      .filter((row) => !supportStaffIds.has(row.artist_id))
      .map((row) => ({
        ...row,
        totalBalance: allTimeBalances[row.artist_id] ?? 0,
      }))
      .sort((a, b) => b.totalBalance - a.totalBalance);
  }, [payoutArtists, artistById, periodEntries, supportStaffIds, allTimeBalances]);

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

  const isPayback = form.direction === "to_shop";
  const selectedTotalBalance = form.artist_id
    ? Number(allTimeBalances[form.artist_id]) || 0
    : null;

  const directionWarning = useMemo(() => {
    if (!form.artist_id || selectedTotalBalance === null) return null;
    if (isPayback && selectedTotalBalance >= 0) {
      return `This artist does not currently owe the studio (total balance ${money(
        selectedTotalBalance
      )}). Recording a payback will increase what the studio owes them.`;
    }
    if (!isPayback && selectedTotalBalance <= 0) {
      return `The studio does not currently owe this artist (total balance ${money(
        selectedTotalBalance
      )}). Recording a payout will increase what the artist owes the studio.`;
    }
    return null;
  }, [form.artist_id, selectedTotalBalance, isPayback]);

  const recordPayment = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(form.amount);
      if (!form.artist_id || !Number.isFinite(amount) || amount <= 0) {
        throw new Error(
          isPayback
            ? "Choose an artist and enter a payback amount."
            : "Choose an artist and enter a payout amount."
        );
      }

      const direction = form.direction === "to_shop" ? "to_shop" : "to_artist";
      const entryType = entryTypeForDirection(direction);
      const ledgerAmount = ledgerAmountForDirection(direction, amount);
      const label = direction === "to_shop" ? "payback" : "payout";

      const payout = await base44.entities.ArtistPayout.create({
        studio_id: studioId,
        artist_id: form.artist_id,
        amount,
        direction,
        payout_method: form.payout_method,
        payout_date: form.payout_date,
        notes: form.notes || null,
        created_by: user.id,
      });

      await base44.entities.ArtistLedgerEntry.create({
        studio_id: studioId,
        artist_id: form.artist_id,
        payout_id: payout.id,
        entry_type: entryType,
        amount: ledgerAmount,
        description: form.notes || `Artist ${label} via ${form.payout_method}`,
        occurred_on: form.payout_date,
        created_by: user.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artistPayouts"] });
      queryClient.invalidateQueries({ queryKey: ["artistLedgerEntries"] });
      setShowDialog(false);
      setForm({
        ...EMPTY_FORM,
        payout_date: format(new Date(), "yyyy-MM-dd"),
      });
    },
  });

  const openRecordDialog = () => {
    setForm({
      ...EMPTY_FORM,
      payout_date: format(new Date(), "yyyy-MM-dd"),
    });
    setShowDialog(true);
  };

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
                ? "Track artist balances from daily reconciliations and record payouts or paybacks."
                : "Your accrued earnings, payouts, and paybacks from daily reconciliations."}
            </p>
          </div>
          {isAdmin && (
            <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={openRecordDialog}>
              <Plus className="w-4 h-4 mr-2" />
              Record Payment
            </Button>
          )}
        </div>

        <Card className="bg-white border-none shadow-lg">
          <CardHeader>
            <CardTitle>Artist Balances</CardTitle>
            <p className="text-sm text-gray-500 font-normal">
              Earned, Paid, Payback, and period balance reflect the selected date range. Total
              Balance is across all periods. Positive totals mean the studio owes the artist;
              negative totals mean the artist owes the studio.
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
                    <TableHead className="text-right">Payback</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Total Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleBalances.map((row) => (
                    <TableRow key={row.artist_id}>
                      <TableCell className="font-medium">{row.artist_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.earned)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.paid)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.payback)}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          row.balance < 0 ? "text-amber-900" : ""
                        }`}
                        title={balanceHint(row.balance)}
                      >
                        {money(row.balance)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-bold ${
                          row.totalBalance < 0 ? "text-amber-900" : "text-indigo-900"
                        }`}
                        title={balanceHint(row.totalBalance)}
                      >
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
              Positive entries increase what the studio owes; payouts reduce it; paybacks increase
              it (settling when an artist owes the studio).
            </p>
          </CardHeader>
          <CardContent>
            {visibleLedgerEntries.length === 0 ? (
              <p className="text-gray-500">
                {ledgerEntries.length === 0
                  ? "No ledger entries yet. Close a daily reconciliation to add earnings."
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
                        <Badge className={entryBadgeClass(entry.entry_type)}>
                          {entryLabel(entry.entry_type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate">
                        {entry.description || "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-medium ${entryAmountClass(entry)}`}
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
              <DialogTitle>Record Artist Payment</DialogTitle>
              <DialogDescription>
                Choose a direction: payout (shop → artist) or payback (artist → shop).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Direction</Label>
                <Select
                  value={form.direction}
                  onValueChange={(direction) => setForm((prev) => ({ ...prev, direction }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="to_artist">Payout — shop pays artist</SelectItem>
                    <SelectItem value="to_shop">Payback — artist pays shop</SelectItem>
                  </SelectContent>
                </Select>
              </div>

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
                {form.artist_id && (
                  <p className="text-xs text-gray-500">
                    Total balance: {money(selectedTotalBalance)} ({balanceHint(selectedTotalBalance)})
                  </p>
                )}
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
                  <Label>{isPayback ? "Payback Date" : "Payout Date"}</Label>
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

              {directionWarning && (
                <Alert className="border-amber-300 bg-amber-50 text-amber-950">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                  <AlertDescription>{directionWarning}</AlertDescription>
                </Alert>
              )}

              {recordPayment.error && (
                <p className="text-sm text-red-600">{recordPayment.error.message}</p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>
                Cancel
              </Button>
              <Button
                className="bg-indigo-600 hover:bg-indigo-700"
                disabled={recordPayment.isPending}
                onClick={() => recordPayment.mutate()}
              >
                {recordPayment.isPending
                  ? "Saving…"
                  : isPayback
                    ? "Save Payback"
                    : "Save Payout"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
