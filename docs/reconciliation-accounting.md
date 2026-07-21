# Reconciliation accounting basis

A daily reconciliation is keyed on **(business_date, location)** and serves two
purposes on **two different date bases**. Keep them separate — mixing them is
what caused the Artist Payouts ↔ Reports drift and cross-day double counting.

## Cash / tender side — `business_date` (matches the POS terminal)

Driven by `payments.business_date`; a payment counts on the day the money moved.

- Tender totals (Visa / Mastercard / Amex / Cash / Stripe), `in_person_total`, `online_total`
- Refunds, `future_deposits_total`, `pos_reported_total`, `variance`

These must tie out to the POS terminal at end of day, so they never move to `sale_date`.

## Accrual side — `sale_date` (what was sold / earned that day)

Driven by `sales.sale_date` — completed sales at the reconciliation's location.

- Revenue summary: subtotal, tax, **Sales** (= subtotal + tax; labeled "Sales" in
  the UI — historically the misleading "Merchandise"), discounts, tips, total
- Category totals, per-artist and per-sale breakdowns
- Artist earnings ledger: `settlement_share` + `tip` rows in `artist_ledger_entries`

## Why they differ

Deposits are often collected ahead. A $50 deposit taken July 4 for a July 5
tattoo is **July 4 cash** but **July 5 revenue/earnings**. Forcing both onto one
date either breaks the POS match or counts the sale in both days its payments touch.

## Invariants (don't regress these)

- Never derive artist earnings or revenue from the payment-date sale-set ("any
  paid payment on business_date"). That reintroduces the cross-day double count.
- Accrual set = `sales` where `sale_date = business_date`, `location_id =` the
  reconciliation's location, and `status = 'completed'`.
- `close_daily_reconciliation` and any backfill both go through
  `post_reconciliation_ledger` + `snapshot_reconciliation_report`, so the ledger
  and the report snapshot can't diverge.
- Manual payouts and paybacks live in `artist_ledger_entries` with
  `reconciliation_id IS NULL`; never delete those when re-posting a reconciliation.
  Payouts (`entry_type = 'payout'`, negative amount) are shop → artist.
  Paybacks (`entry_type = 'payback'`, positive amount) are artist → shop.
  Both are headed by `artist_payouts` (`direction` `to_artist` / `to_shop`).

Reference migration: `supabase/migrations/20260705230000_accrual_by_sale_date.sql`.
