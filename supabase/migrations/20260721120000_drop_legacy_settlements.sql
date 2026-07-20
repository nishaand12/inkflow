-- Drop the legacy daily-settlement stack, superseded by daily_reconciliations +
-- reconciliation_tenders + reconciliation_report_* snapshots (July 5 accounting
-- migrations). Nothing has written to these tables or called these functions
-- since the cutover; the only reader (the SettlementDetail page) is removed in
-- the same release.
--
-- Kept deliberately:
--   * reopen_daily_reconciliation — admin escape hatch for reopening a closed day
--   * artist_ledger_entries.entry_type value 'settlement_share' — live data value
--     still written by post_reconciliation_ledger
--   * appointment_manage_tokens — used by the public booking/manage edge functions

-- Legacy linkage columns on the ledger (new postings use reconciliation_id).
-- Dropping them also drops their FKs and the settlement_id index.
alter table public.artist_ledger_entries
  drop column if exists settlement_id,
  drop column if exists settlement_line_id;

-- Lines first (FK to daily_settlements), then the header table.
drop table if exists public.daily_settlement_lines;
drop table if exists public.daily_settlements;

-- Client-facing stock RPC replaced by apply_product_checkout_stock_system
-- (called internally by finalize_sale_internal).
drop function if exists public.apply_product_checkout_stock(jsonb);

-- Soft-void helper never wired up; finalize_sale_internal clears prior sales
-- itself on re-checkout.
drop function if exists public.void_appointment_sale(uuid);

-- One-time helper for the 20260705130000 accounting backfill.
drop function if exists public.normalize_tender(text);

-- Service-role wrapper only called by the stripe-webhook's online service
-- checkout branch, removed along with the create-checkout-payment edge
-- function (online payments are deposits only; service checkout is in-person
-- via finalize_sale).
drop function if exists public.finalize_sale_system(uuid, jsonb, jsonb, jsonb);
