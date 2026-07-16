/**
 * Report tender groups: how in-person tenders roll up into report columns
 * (Daily Totals, reconciliation detail cards).
 *
 * A studio can override the grouping with rows in reporting_tender_groups
 * (tender_type -> group_key/group_label/sort_order); anything unconfigured
 * falls back to the defaults below. Keep the defaults in sync with the SQL
 * function public.report_tender_group.
 *
 * Stripe is an online-channel tender and never enters these groups — online
 * activity is reported only under Reports → Stripe Deposits.
 */

export const DEFAULT_TENDER_GROUP_DEFS = [
  { key: "plastic", label: "Plastic", sort: 10 },
  { key: "cash", label: "Cash", sort: 20 },
  { key: "other", label: "Other", sort: 30 },
];

/**
 * Default position of each payment method in payment-method lists (matches the
 * checkout dropdown order). Keep in sync with public.report_tender_group.
 */
export const DEFAULT_TENDER_DISPLAY_ORDER = {
  Cash: 10,
  "E-Transfer": 20,
  Amex: 30,
  Mastercard: 40,
  Visa: 50,
  Debit: 60,
  Other: 70,
};

export function resolveTenderDisplayOrder(tenderType, configRows = []) {
  const row = configRows.find((r) => r.tender_type === tenderType);
  if (row?.display_order != null) return row.display_order;
  return DEFAULT_TENDER_DISPLAY_ORDER[tenderType] ?? 100;
}

/**
 * Order per-tender rows the way the studio configured (display_order from the
 * row itself when the RPC provided it, else config/defaults).
 */
export function sortTendersForDisplay(rows, configRows = []) {
  return [...rows].sort((a, b) => {
    const oa = a.display_order ?? resolveTenderDisplayOrder(a.tender_type, configRows);
    const ob = b.display_order ?? resolveTenderDisplayOrder(b.tender_type, configRows);
    return oa - ob || String(a.tender_type).localeCompare(String(b.tender_type));
  });
}

const DEFAULT_BY_TENDER = {
  Cash: DEFAULT_TENDER_GROUP_DEFS[1],
  Other: DEFAULT_TENDER_GROUP_DEFS[2],
};

/** Resolve a tender type to its report group, honoring studio config rows. */
export function resolveTenderGroup(tenderType, configRows = []) {
  const row = configRows.find((r) => r.tender_type === tenderType);
  if (row) {
    return {
      key: row.group_key,
      label: row.group_label,
      sort: row.sort_order ?? 50,
    };
  }
  return DEFAULT_BY_TENDER[tenderType] || DEFAULT_TENDER_GROUP_DEFS[0];
}

/**
 * Roll per-tender amounts up into groups.
 * Rows may carry their group already (group_key/group_label from the detail
 * snapshot RPC); otherwise the group is resolved from configRows/defaults.
 * @param {Array<{tender_type: string, amount: number, group_key?: string, group_label?: string, sort_order?: number}>} rows
 * @returns {Array<{key: string, label: string, amount: number}>} sorted by group order
 */
export function groupTenderAmounts(rows, configRows = []) {
  const byKey = {};
  for (const row of rows) {
    const group = row.group_key
      ? { key: row.group_key, label: row.group_label || row.group_key, sort: row.sort_order ?? 50 }
      : resolveTenderGroup(row.tender_type, configRows);
    if (!byKey[group.key]) byKey[group.key] = { ...group, amount: 0 };
    byKey[group.key].amount += Number(row.amount) || 0;
  }
  return Object.values(byKey).sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
}

/**
 * Column definitions to render: every default group plus any group present in
 * `groups`, in sort order. Ensures Plastic / Cash / Other always show.
 */
export function mergeTenderGroupDefs(groups = [], configRows = []) {
  const byKey = {};
  for (const def of DEFAULT_TENDER_GROUP_DEFS) byKey[def.key] = { ...def };
  for (const row of configRows) {
    byKey[row.group_key] = {
      key: row.group_key,
      label: row.group_label,
      sort: row.sort_order ?? 50,
    };
  }
  for (const g of groups) {
    if (!byKey[g.key]) byKey[g.key] = { key: g.key, label: g.label, sort: g.sort ?? 50 };
  }
  return Object.values(byKey).sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
}
