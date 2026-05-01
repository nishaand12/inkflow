import React, { useState, useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Wallet, Lock, Calendar } from "lucide-react";
import { format, parseISO } from "date-fns";
import { normalizeUserRole } from "@/utils/roles";
import { createPageUrl } from "@/utils/index";

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toFixed(2)}`;
}

export default function SettlementDetail() {
  const { settlementId } = useParams();
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setUser(await base44.auth.me());
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const { data: settlement, isLoading: loadingSettlement } = useQuery({
    queryKey: ["dailySettlement", settlementId],
    queryFn: async () => {
      const rows = await base44.entities.DailySettlement.filter({ id: settlementId });
      return rows[0] || null;
    },
    enabled: !!settlementId,
  });

  const studioId = user?.studio_id;

  const { data: lines = [], isLoading: loadingLines } = useQuery({
    queryKey: ["dailySettlementLines", settlementId],
    queryFn: () => base44.entities.DailySettlementLine.filter({ settlement_id: settlementId }),
    enabled: !!settlementId && !!settlement,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", studioId],
    queryFn: () => base44.entities.Location.filter({ studio_id: studioId }),
    enabled: !!studioId,
  });

  const { data: artists = [] } = useQuery({
    queryKey: ["artists", studioId],
    queryFn: () => base44.entities.Artist.filter({ studio_id: studioId }),
    enabled: !!studioId,
  });

  const appointmentIds = useMemo(
    () => [...new Set(lines.map((l) => l.appointment_id).filter(Boolean))],
    [lines]
  );

  const appointmentIdsKey = useMemo(() => [...appointmentIds].sort().join(","), [appointmentIds]);

  const { data: appointments = [] } = useQuery({
    queryKey: ["appointmentsForSettlement", studioId, appointmentIdsKey],
    queryFn: async () => {
      const all = await base44.entities.Appointment.filter({ studio_id: studioId });
      const idSet = new Set(appointmentIds);
      return all.filter((a) => idSet.has(a.id));
    },
    enabled: !!studioId && appointmentIds.length > 0,
  });

  const { data: appointmentTypes = [] } = useQuery({
    queryKey: ["appointmentTypes", studioId],
    queryFn: () => base44.entities.AppointmentType.filter({ studio_id: studioId }),
    enabled: !!studioId && !!settlement,
  });

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(
      user.user_role || (user.role === "admin" ? "Admin" : "Front_Desk")
    );
  };
  const isAdmin = getUserRole() === "Admin" || getUserRole() === "Owner";

  const locationName = locations.find((l) => l.id === settlement?.location_id)?.name || "—";

  const artistById = useMemo(() => {
    const m = {};
    for (const a of artists) m[a.id] = a;
    return m;
  }, [artists]);

  const aptById = useMemo(() => {
    const m = {};
    for (const a of appointments) m[a.id] = a;
    return m;
  }, [appointments]);

  const typesById = useMemo(() => {
    const m = {};
    for (const t of appointmentTypes) m[t.id] = t;
    return m;
  }, [appointmentTypes]);

  const byArtist = useMemo(() => {
    const map = {};
    for (const line of lines) {
      const aid = line.artist_id || "unknown";
      if (!map[aid]) {
        map[aid] = {
          artist_id: aid,
          gross: 0,
          artist_share: 0,
          shop_share: 0,
          lines: [],
        };
      }
      map[aid].gross += Number(line.gross_amount) || 0;
      map[aid].artist_share += Number(line.artist_share) || 0;
      map[aid].shop_share += Number(line.shop_share) || 0;
      map[aid].lines.push(line);
    }
    return Object.values(map);
  }, [lines]);

  const totalsCheck = useMemo(() => {
    const sumGross = lines.reduce((s, l) => s + (Number(l.gross_amount) || 0), 0);
    const sumArtist = lines.reduce((s, l) => s + (Number(l.artist_share) || 0), 0);
    const sumShop = lines.reduce((s, l) => s + (Number(l.shop_share) || 0), 0);
    const headerGross = Number(settlement?.gross_total) || 0;
    return { sumGross, sumArtist, sumShop, headerGross, grossMatch: Math.abs(sumGross - headerGross) < 0.02 };
  }, [lines, settlement]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">Only Owners and Admins can view settlement details.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (user && settlement && settlement.studio_id !== user.studio_id) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="p-12 text-center">
              <p className="text-gray-600">This settlement does not belong to your studio.</p>
              <Button asChild className="mt-4">
                <Link to={createPageUrl("Settlements")}>Back to settlements</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const lockedAtLabel = settlement?.locked_at
    ? (() => {
        try {
          return format(parseISO(settlement.locked_at), "MMM d, yyyy h:mm a");
        } catch {
          return settlement.locked_at;
        }
      })()
    : "—";

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button variant="outline" size="icon" asChild className="shrink-0 mt-1">
              <Link to={createPageUrl("Settlements")} aria-label="Back to settlements">
                <ArrowLeft className="w-4 h-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2 flex-wrap">
                <Wallet className="w-8 h-8 text-indigo-600" />
                Settlement detail
              </h1>
              <p className="text-gray-500 mt-1">
                Frozen totals and per-appointment split as recorded when this settlement was
                generated. Changing appointments later does not change this snapshot.
              </p>
            </div>
          </div>
        </div>

        {loadingSettlement || !user ? (
          <Card>
            <CardContent className="py-16 text-center text-gray-500">Loading…</CardContent>
          </Card>
        ) : !settlement ? (
          <Card>
            <CardContent className="py-16 text-center text-gray-500">
              Settlement not found.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="bg-white border-none shadow-lg">
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <CardTitle className="text-xl flex items-center gap-2 flex-wrap">
                    <Calendar className="w-5 h-5 text-gray-500" />
                    {settlement.settlement_date}
                    <span className="text-gray-400 font-normal">·</span>
                    <span className="font-normal text-gray-700">{locationName}</span>
                  </CardTitle>
                  <Badge
                    className={
                      settlement.status === "locked"
                        ? "bg-green-100 text-green-800 border-green-200"
                        : "bg-amber-100 text-amber-800"
                    }
                  >
                    <Lock className="w-3 h-3 mr-1 inline" />
                    {settlement.status === "locked" ? "Locked" : "Draft"}
                  </Badge>
                </div>
                <p className="text-sm text-gray-500">
                  Locked at {lockedAtLabel}
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Gross</p>
                    <p className="text-xl font-bold text-gray-900">{money(settlement.gross_total)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Tax</p>
                    <p className="text-xl font-bold text-gray-900">{money(settlement.tax_total)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Discounts</p>
                    <p className="text-xl font-bold text-red-700">{money(settlement.discount_total)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4 bg-indigo-50/80 border-indigo-100">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Net</p>
                    <p className="text-xl font-bold text-indigo-900">{money(settlement.net_total)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">POS collected</p>
                    <p className="text-lg font-semibold text-gray-900">{money(settlement.pos_collected)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Online collected</p>
                    <p className="text-lg font-semibold text-gray-900">{money(settlement.online_collected)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Gift card sales</p>
                    <p className="text-lg font-semibold text-gray-900">{money(settlement.gift_card_sales)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Gift card returns</p>
                    <p className="text-lg font-semibold text-gray-900">{money(settlement.gift_card_returns)}</p>
                  </div>
                </div>
                {!totalsCheck.grossMatch && lines.length > 0 && (
                  <p className="text-xs text-amber-700 mt-4">
                    Note: Sum of line gross ({money(totalsCheck.sumGross)}) differs from header gross (
                    {money(totalsCheck.headerGross)}). Header values are what was stored on the settlement
                    record; lines reflect per-appointment allocation at generation time.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="bg-white border-none shadow-lg">
              <CardHeader>
                <CardTitle>Totals by artist</CardTitle>
                <p className="text-sm text-gray-500 font-normal">
                  Aggregated from settlement lines (split % frozen at generation).
                </p>
              </CardHeader>
              <CardContent>
                {loadingLines ? (
                  <p className="text-gray-500">Loading lines…</p>
                ) : byArtist.length === 0 ? (
                  <p className="text-gray-500">No line items.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Artist</TableHead>
                        <TableHead className="text-right">Appointments</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right">Artist share</TableHead>
                        <TableHead className="text-right">Shop share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byArtist.map((row) => {
                        const name =
                          artistById[row.artist_id]?.full_name || row.artist_id || "Unknown";
                        return (
                          <TableRow key={row.artist_id}>
                            <TableCell className="font-medium">{name}</TableCell>
                            <TableCell className="text-right">{row.lines.length}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(row.gross)}</TableCell>
                            <TableCell className="text-right tabular-nums text-green-800">
                              {money(row.artist_share)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-indigo-800">
                              {money(row.shop_share)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="bg-white border-none shadow-lg">
              <CardHeader>
                <CardTitle>Per-appointment lines</CardTitle>
                <p className="text-sm text-gray-500 font-normal">
                  Each row is one completed appointment included in this settlement.
                </p>
              </CardHeader>
              <CardContent>
                {loadingLines ? (
                  <p className="text-gray-500">Loading…</p>
                ) : lines.length === 0 ? (
                  <p className="text-gray-500">No lines.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Appointment</TableHead>
                          <TableHead>Artist</TableHead>
                          <TableHead className="text-right">Split %</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                          <TableHead className="text-right">Artist</TableHead>
                          <TableHead className="text-right">Shop</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((line) => {
                          const apt = aptById[line.appointment_id];
                          const typeName = typesById[apt?.appointment_type_id]?.name || "";
                          const aptLabel = apt
                            ? `${apt.appointment_date} · ${typeName || "Service"}`
                            : line.appointment_id;
                          const artistName =
                            artistById[line.artist_id]?.full_name || line.artist_id || "—";
                          return (
                            <TableRow key={line.id}>
                              <TableCell className="max-w-[220px]">
                                <span className="font-medium text-gray-900">{aptLabel}</span>
                              </TableCell>
                              <TableCell>{artistName}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {Number(line.split_percent) || 0}%
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {money(line.gross_amount)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-green-800">
                                {money(line.artist_share)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-indigo-800">
                                {money(line.shop_share)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
