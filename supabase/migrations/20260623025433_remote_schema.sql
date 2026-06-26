


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."apply_product_checkout_stock"("p_lines" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record;
  v_studio uuid;
  v_stock integer;
begin
  for r in
    select (x->>'product_id')::uuid as product_id,
           (x->>'quantity')::int as quantity
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
  loop
    if r.product_id is null or r.quantity is null or r.quantity <= 0 then
      continue;
    end if;

    select studio_id, stock_quantity into v_studio, v_stock
    from public.products
    where id = r.product_id
    for update;

    if v_studio is null then
      raise exception 'Product not found';
    end if;
    if v_studio is distinct from public.current_user_studio() then
      raise exception 'Not allowed';
    end if;

    if v_stock is null then
      continue;
    end if;

    if v_stock < r.quantity then
      raise exception 'Insufficient stock';
    end if;

    update public.products
    set stock_quantity = v_stock - r.quantity
    where id = r.product_id;
  end loop;
end;
$$;


ALTER FUNCTION "public"."apply_product_checkout_stock"("p_lines" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_product_checkout_stock_system"("p_studio_id" "uuid", "p_lines" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record;
  v_studio uuid;
  v_stock integer;
begin
  if p_studio_id is null then
    raise exception 'studio_id required';
  end if;

  for r in
    select (x->>'product_id')::uuid as product_id,
           (x->>'quantity')::int as quantity
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
  loop
    if r.product_id is null or r.quantity is null or r.quantity <= 0 then
      continue;
    end if;

    select studio_id, stock_quantity into v_studio, v_stock
    from public.products
    where id = r.product_id
    for update;

    if v_studio is null then
      raise exception 'Product not found';
    end if;
    if v_studio is distinct from p_studio_id then
      raise exception 'Not allowed';
    end if;

    if v_stock is null then
      continue;
    end if;

    if v_stock < r.quantity then
      raise exception 'Insufficient stock';
    end if;

    update public.products
    set stock_quantity = v_stock - r.quantity
    where id = r.product_id;
  end loop;
end;
$$;


ALTER FUNCTION "public"."apply_product_checkout_stock_system"("p_studio_id" "uuid", "p_lines" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select user_role from public.users where id = auth.uid();
$$;


ALTER FUNCTION "public"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_studio"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select studio_id from public.users where id = auth.uid();
$$;


ALTER FUNCTION "public"."current_user_studio"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_booking_data"("p_studio_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result json;
begin
  if not exists (
    select 1 from studios where id = p_studio_id and is_active = true
  ) then
    return null;
  end if;

  select json_build_object(
    'studio', (
      select row_to_json(s) from studios s where s.id = p_studio_id
    ),
    'appointment_types', coalesce((
      select json_agg(row_to_json(at))
      from appointment_types at
      where at.studio_id = p_studio_id
        and at.is_active = true
        and at.is_public_bookable = true
    ), '[]'::json),
    'appointment_kind_categories', coalesce((
      select json_agg(row_to_json(rc))
      from (
        select id, parent_id, name, display_order, category_role, is_active
        from reporting_categories
        where studio_id = p_studio_id
          and category_role = 'appointment_kind'
          and is_active = true
        order by display_order asc, name asc
      ) rc
    ), '[]'::json),
    'artists', coalesce((
      select json_agg(row_to_json(a))
      from artists a
      where a.studio_id = p_studio_id and a.is_active = true
    ), '[]'::json),
    'locations', coalesce((
      select json_agg(row_to_json(l))
      from locations l
      where l.studio_id = p_studio_id and l.is_active = true
    ), '[]'::json),
    'availabilities', coalesce((
      select json_agg(row_to_json(av))
      from availabilities av
      where av.studio_id = p_studio_id
    ), '[]'::json),
    'weekly_schedules', coalesce((
      select json_agg(row_to_json(ws))
      from artist_weekly_schedules ws
      where ws.studio_id = p_studio_id and ws.is_active = true
    ), '[]'::json),
    'appointments', coalesce((
      select json_agg(row_to_json(ap))
      from (
        select id, artist_id, location_id, appointment_date,
               start_time, end_time, work_station_id, status
        from appointments
        where studio_id = p_studio_id
          and status not in ('cancelled', 'no_show')
      ) ap
    ), '[]'::json),
    'workstations', coalesce((
      select json_agg(row_to_json(wst))
      from workstations wst
      where wst.studio_id = p_studio_id and wst.status = 'active'
    ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."get_public_booking_data"("p_studio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."appointment_charges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "appointment_id" "uuid",
    "line_type" "text" DEFAULT 'product'::"text" NOT NULL,
    "reporting_category_id" "uuid",
    "reporting_category_name" "text",
    "product_id" "uuid",
    "description" "text" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "unit_price" numeric DEFAULT 0 NOT NULL,
    "discount_amount" numeric DEFAULT 0 NOT NULL,
    "line_total" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."appointment_charges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointment_kind_notification_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "kind_category_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."appointment_kind_notification_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointment_manage_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "appointment_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."appointment_manage_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointment_refunds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "appointment_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "refund_method" "text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "appointment_refunds_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "appointment_refunds_refund_method_check" CHECK (("refund_method" = ANY (ARRAY['card'::"text", 'cash'::"text", 'store_credit'::"text"])))
);


ALTER TABLE "public"."appointment_refunds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointment_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "category" "text",
    "name" "text" NOT NULL,
    "description" "text",
    "default_duration_minutes" integer NOT NULL,
    "default_deposit" numeric NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_public_bookable" boolean DEFAULT false,
    "reporting_category_id" "uuid",
    "service_cost" numeric,
    "appointment_kind_category_id" "uuid",
    "price_includes_tax" boolean DEFAULT false NOT NULL,
    "image_url" "text"
);


ALTER TABLE "public"."appointment_types" OWNER TO "postgres";


COMMENT ON COLUMN "public"."appointment_types"."appointment_kind_category_id" IS 'Leaf reporting_categories row (category_role=appointment_kind) for this type';



COMMENT ON COLUMN "public"."appointment_types"."price_includes_tax" IS 'When true, service line at checkout is tax-inclusive (default studio tax rate applies to extract tax). When false, tax is added on top of the service amount.';



CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "artist_id" "uuid",
    "location_id" "uuid",
    "work_station_id" "uuid",
    "customer_id" "uuid",
    "appointment_type_id" "uuid",
    "client_name" "text",
    "client_email" "text",
    "client_phone" "text",
    "appointment_date" "date" NOT NULL,
    "start_time" "text" NOT NULL,
    "deposit_amount" numeric,
    "total_estimate" numeric,
    "charge_amount" numeric,
    "tax_amount" numeric,
    "payment_method" "text",
    "design_description" "text",
    "placement" "text",
    "notes" "text",
    "invitees" "jsonb",
    "status" "text" DEFAULT 'scheduled'::"text",
    "reminder_sent_week" boolean DEFAULT false,
    "reminder_sent_day" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "email_send_status" "text" DEFAULT 'pending'::"text",
    "email_send_failed_reason" "text",
    "email_sent_at" timestamp with time zone,
    "reminder_sent_at" timestamp with time zone,
    "reminder_minutes_before" integer,
    "deposit_status" "text" DEFAULT 'none'::"text",
    "health_fields" "jsonb" DEFAULT '{}'::"jsonb",
    "discount_amount" numeric DEFAULT 0,
    "end_time" "text",
    "tip_amount" numeric DEFAULT 0 NOT NULL,
    "reminder_primary_sent_at" timestamp with time zone,
    "reminder_secondary_sent_at" timestamp with time zone,
    "followup_quick_sent_at" timestamp with time zone,
    "followup_longterm_sent_at" timestamp with time zone,
    "reminder_tertiary_sent_at" timestamp with time zone,
    "followup_midterm_sent_at" timestamp with time zone,
    "notification_anchor_at" timestamp with time zone DEFAULT "now"(),
    "booking_source" "text"
);


ALTER TABLE "public"."appointments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."artist_ledger_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "artist_id" "uuid" NOT NULL,
    "settlement_id" "uuid",
    "settlement_line_id" "uuid",
    "appointment_id" "uuid",
    "payout_id" "uuid",
    "entry_type" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "description" "text",
    "occurred_on" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "artist_ledger_entries_entry_type_check" CHECK (("entry_type" = ANY (ARRAY['settlement_share'::"text", 'tip'::"text", 'payout'::"text", 'adjustment'::"text"])))
);


ALTER TABLE "public"."artist_ledger_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."artist_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "artist_id" "uuid",
    "location_id" "uuid",
    "days_available" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."artist_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."artist_payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "artist_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "payout_method" "text",
    "payout_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "artist_payouts_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."artist_payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."artist_split_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "artist_id" "uuid",
    "split_percent" numeric DEFAULT 50 NOT NULL,
    "eligible_category_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "appointment_type_id" "uuid",
    "split_mode" "text" DEFAULT 'percent'::"text" NOT NULL,
    "split_value" numeric,
    CONSTRAINT "artist_split_rules_scope_check" CHECK ((("artist_id" IS NOT NULL) OR ("appointment_type_id" IS NOT NULL))),
    CONSTRAINT "artist_split_rules_split_mode_check" CHECK (("split_mode" = ANY (ARRAY['percent'::"text", 'fixed_amount'::"text"])))
);


ALTER TABLE "public"."artist_split_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."artist_weekly_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "artist_id" "uuid",
    "day_of_week" integer NOT NULL,
    "start_time" "text" NOT NULL,
    "end_time" "text" NOT NULL,
    "location_id" "uuid",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "artist_weekly_schedules_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6)))
);


ALTER TABLE "public"."artist_weekly_schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."artists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "user_id" "uuid",
    "full_name" "text" NOT NULL,
    "specialty" "text",
    "bio" "text",
    "phone" "text",
    "instagram" "text",
    "hourly_rate" numeric,
    "primary_location_id" "uuid",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "artist_type" "text" DEFAULT 'tattoo'::"text" NOT NULL,
    "calendar_color" "text",
    "preferred_work_station_id" "uuid"
);


ALTER TABLE "public"."artists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."availabilities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "artist_id" "uuid",
    "location_id" "uuid",
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "start_time" "text" NOT NULL,
    "end_time" "text" NOT NULL,
    "is_blocked" boolean DEFAULT false,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."availabilities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "name" "text" NOT NULL,
    "phone_number" "text" NOT NULL,
    "email" "text",
    "instagram_username" "text",
    "preferred_location_id" "uuid",
    "consent_obtained" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "send_calendar_invites" boolean DEFAULT false,
    "email_bounced" boolean DEFAULT false,
    "email_bounce_reason" "text",
    "email_bounced_at" timestamp with time zone,
    "email_unsubscribed" boolean DEFAULT false,
    "email_unsubscribed_at" timestamp with time zone
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_settlement_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "settlement_id" "uuid",
    "artist_id" "uuid",
    "appointment_id" "uuid",
    "gross_amount" numeric DEFAULT 0 NOT NULL,
    "artist_share" numeric DEFAULT 0 NOT NULL,
    "shop_share" numeric DEFAULT 0 NOT NULL,
    "split_percent" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "service_amount" numeric DEFAULT 0 NOT NULL,
    "product_amount" numeric DEFAULT 0 NOT NULL,
    "tip_amount" numeric DEFAULT 0 NOT NULL,
    "split_mode" "text" DEFAULT 'percent'::"text" NOT NULL,
    "split_value" numeric DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."daily_settlement_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_settlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "location_id" "uuid",
    "settlement_date" "date" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "gross_total" numeric DEFAULT 0 NOT NULL,
    "tax_total" numeric DEFAULT 0 NOT NULL,
    "discount_total" numeric DEFAULT 0 NOT NULL,
    "net_total" numeric DEFAULT 0 NOT NULL,
    "pos_collected" numeric DEFAULT 0 NOT NULL,
    "online_collected" numeric DEFAULT 0 NOT NULL,
    "gift_card_sales" numeric DEFAULT 0 NOT NULL,
    "gift_card_returns" numeric DEFAULT 0 NOT NULL,
    "locked_at" timestamp with time zone,
    "locked_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tip_total" numeric DEFAULT 0 NOT NULL,
    "cash_collected" numeric DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."daily_settlements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "customer_id" "uuid",
    "appointment_id" "uuid",
    "email" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "reason" "text",
    "occurred_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb",
    "delivery_status" "text" DEFAULT 'sent'::"text",
    "provider_event_type" "text",
    "provider_event_at" timestamp with time zone
);


ALTER TABLE "public"."email_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "name" "text" NOT NULL,
    "address" "text" NOT NULL,
    "city" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "station_capacity" integer DEFAULT 8,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "appointment_id" "uuid",
    "customer_id" "uuid",
    "stripe_checkout_session_id" "text",
    "stripe_payment_intent_id" "text",
    "amount" numeric NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text",
    "status" "text" DEFAULT 'pending'::"text",
    "payment_type" "text" DEFAULT 'deposit'::"text",
    "checkout_url" "text",
    "paid_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "reporting_category_id" "uuid",
    "name" "text" NOT NULL,
    "sku" "text",
    "barcode" "text",
    "price" numeric DEFAULT 0 NOT NULL,
    "cost" numeric,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "supplier_name" "text",
    "supplier_sku" "text",
    "stock_quantity" integer,
    "tax_rate" numeric DEFAULT 0.13 NOT NULL,
    "price_includes_tax" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."products" OWNER TO "postgres";


COMMENT ON COLUMN "public"."products"."stock_quantity" IS 'When null, stock is not tracked at checkout. When set, must be sufficient to complete sale.';



COMMENT ON COLUMN "public"."products"."tax_rate" IS 'Decimal rate, e.g. 0.13 for 13%. Use 0 for non-taxable items such as gift cards.';



COMMENT ON COLUMN "public"."products"."price_includes_tax" IS 'When true, price (and line total after discount) includes sales tax; tax is backed out for reporting. When false, tax is added on top.';



CREATE TABLE IF NOT EXISTS "public"."reporting_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "name" "text" NOT NULL,
    "category_type" "text" DEFAULT 'item'::"text" NOT NULL,
    "display_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "parent_id" "uuid",
    "category_role" "text" DEFAULT 'reporting'::"text" NOT NULL,
    "clinical_profile" "text",
    "revenue_sign" "text" DEFAULT 'positive'::"text" NOT NULL,
    CONSTRAINT "reporting_categories_category_role_check" CHECK (("category_role" = ANY (ARRAY['reporting'::"text", 'appointment_kind'::"text"]))),
    CONSTRAINT "reporting_categories_clinical_profile_check" CHECK ((("clinical_profile" IS NULL) OR ("clinical_profile" = ANY (ARRAY['tattoo'::"text", 'piercing'::"text"])))),
    CONSTRAINT "reporting_categories_revenue_sign_check" CHECK (("revenue_sign" = ANY (ARRAY['positive'::"text", 'negative'::"text"])))
);


ALTER TABLE "public"."reporting_categories" OWNER TO "postgres";


COMMENT ON COLUMN "public"."reporting_categories"."parent_id" IS 'Parent category in the same role tree (reporting vs appointment_kind)';



COMMENT ON COLUMN "public"."reporting_categories"."category_role" IS 'reporting: revenue hierarchy; appointment_kind: configurable appointment type categories';



COMMENT ON COLUMN "public"."reporting_categories"."clinical_profile" IS 'Optional: tattoo or piercing clinical fields when this appointment_kind node applies';



COMMENT ON COLUMN "public"."reporting_categories"."revenue_sign" IS 'positive: normal revenue. negative: staff enters positive amounts but line_total is stored negative (e.g. gift card returns, discount coupons).';



CREATE TABLE IF NOT EXISTS "public"."studio_notification_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "confirmation_enabled" boolean DEFAULT true NOT NULL,
    "confirmation_subject" "text",
    "confirmation_body" "text",
    "reminder_secondary_enabled" boolean DEFAULT true NOT NULL,
    "reminder_secondary_minutes" integer DEFAULT 4320 NOT NULL,
    "reminder_secondary_subject" "text",
    "reminder_secondary_body" "text",
    "reminder_primary_enabled" boolean DEFAULT false NOT NULL,
    "reminder_primary_minutes" integer DEFAULT 1440 NOT NULL,
    "reminder_primary_subject" "text",
    "reminder_primary_body" "text",
    "reminder_tertiary_enabled" boolean DEFAULT false NOT NULL,
    "reminder_tertiary_minutes" integer DEFAULT 120 NOT NULL,
    "reminder_tertiary_subject" "text",
    "reminder_tertiary_body" "text",
    "followup_quick_enabled" boolean DEFAULT true NOT NULL,
    "followup_quick_minutes" integer DEFAULT 120 NOT NULL,
    "followup_quick_subject" "text",
    "followup_quick_body" "text",
    "followup_longterm_enabled" boolean DEFAULT true NOT NULL,
    "followup_longterm_minutes" integer DEFAULT 30240 NOT NULL,
    "followup_longterm_subject" "text",
    "followup_longterm_body" "text",
    "followup_midterm_enabled" boolean DEFAULT false NOT NULL,
    "followup_midterm_minutes" integer DEFAULT 108000 NOT NULL,
    "followup_midterm_subject" "text",
    "followup_midterm_body" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."studio_notification_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "hq_location" "text",
    "phone" "text",
    "currency" "text" DEFAULT 'USD'::"text",
    "invite_code" "text",
    "is_active" boolean DEFAULT false,
    "owner_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "studio_email" "text",
    "timezone" "text" DEFAULT 'UTC'::"text",
    "subscription_tier" "text" DEFAULT 'basic'::"text",
    "email_reminders_enabled" boolean DEFAULT false,
    "reminder_minutes_before" integer DEFAULT 1440,
    "stripe_account_id" "text",
    "stripe_onboarding_complete" boolean DEFAULT false,
    "stripe_charges_enabled" boolean DEFAULT false,
    "stripe_payouts_enabled" boolean DEFAULT false,
    "email_confirmations_enabled" boolean DEFAULT true NOT NULL,
    "booking_confirmation_subject_template" "text",
    "booking_confirmation_body_template" "text",
    "booking_reminder_subject_template" "text",
    "booking_reminder_body_template" "text",
    "reminder_secondary_enabled" boolean DEFAULT true,
    "reminder_secondary_minutes_before" integer DEFAULT 4320,
    "booking_reminder_secondary_subject_template" "text",
    "booking_reminder_secondary_body_template" "text",
    "followup_quick_enabled" boolean DEFAULT true,
    "followup_quick_minutes_after" integer DEFAULT 180,
    "booking_followup_quick_subject_template" "text",
    "booking_followup_quick_body_template" "text",
    "followup_longterm_enabled" boolean DEFAULT true,
    "followup_longterm_minutes_after" integer DEFAULT 30240,
    "booking_followup_longterm_subject_template" "text",
    "booking_followup_longterm_body_template" "text",
    "booking_page_disclaimer_template" "text"
);


ALTER TABLE "public"."studios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "item_name" "text" NOT NULL,
    "item_description" "text",
    "supplier" "text",
    "status" "text" DEFAULT 'In Stock'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "supplies_status_check" CHECK (("status" = ANY (ARRAY['In Stock'::"text", 'Running Low'::"text", 'Order Now'::"text", 'Out of Stock'::"text", 'Ordered'::"text"])))
);


ALTER TABLE "public"."supplies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "user_role" "text" DEFAULT 'Artist'::"text" NOT NULL,
    "studio_id" "uuid",
    "is_onboarded" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workstations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "location_id" "uuid",
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."workstations" OWNER TO "postgres";


ALTER TABLE ONLY "public"."appointment_charges"
    ADD CONSTRAINT "appointment_charges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointment_kind_notification_assignments"
    ADD CONSTRAINT "appointment_kind_notification_as_studio_id_kind_category_id_key" UNIQUE ("studio_id", "kind_category_id");



ALTER TABLE ONLY "public"."appointment_kind_notification_assignments"
    ADD CONSTRAINT "appointment_kind_notification_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointment_manage_tokens"
    ADD CONSTRAINT "appointment_manage_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointment_manage_tokens"
    ADD CONSTRAINT "appointment_manage_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."appointment_refunds"
    ADD CONSTRAINT "appointment_refunds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointment_types"
    ADD CONSTRAINT "appointment_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."artist_ledger_entries"
    ADD CONSTRAINT "artist_ledger_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."artist_locations"
    ADD CONSTRAINT "artist_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."artist_payouts"
    ADD CONSTRAINT "artist_payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."artist_split_rules"
    ADD CONSTRAINT "artist_split_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."artist_weekly_schedules"
    ADD CONSTRAINT "artist_weekly_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."artists"
    ADD CONSTRAINT "artists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."availabilities"
    ADD CONSTRAINT "availabilities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_settlement_lines"
    ADD CONSTRAINT "daily_settlement_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_settlements"
    ADD CONSTRAINT "daily_settlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reporting_categories"
    ADD CONSTRAINT "reporting_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studio_notification_profiles"
    ADD CONSTRAINT "studio_notification_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studios"
    ADD CONSTRAINT "studios_invite_code_key" UNIQUE ("invite_code");



ALTER TABLE ONLY "public"."studios"
    ADD CONSTRAINT "studios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplies"
    ADD CONSTRAINT "supplies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workstations"
    ADD CONSTRAINT "workstations_pkey" PRIMARY KEY ("id");



CREATE INDEX "akna_studio_idx" ON "public"."appointment_kind_notification_assignments" USING "btree" ("studio_id");



CREATE INDEX "amt_appointment_idx" ON "public"."appointment_manage_tokens" USING "btree" ("appointment_id");



CREATE INDEX "amt_token_idx" ON "public"."appointment_manage_tokens" USING "btree" ("token");



CREATE INDEX "appointment_charges_appointment_idx" ON "public"."appointment_charges" USING "btree" ("appointment_id");



CREATE INDEX "appointment_charges_studio_idx" ON "public"."appointment_charges" USING "btree" ("studio_id");



CREATE INDEX "appointment_refunds_appointment_idx" ON "public"."appointment_refunds" USING "btree" ("appointment_id");



CREATE INDEX "appointment_refunds_studio_idx" ON "public"."appointment_refunds" USING "btree" ("studio_id");



CREATE INDEX "artist_ledger_entries_artist_date_idx" ON "public"."artist_ledger_entries" USING "btree" ("artist_id", "occurred_on");



CREATE INDEX "artist_ledger_entries_payout_idx" ON "public"."artist_ledger_entries" USING "btree" ("payout_id");



CREATE INDEX "artist_ledger_entries_settlement_idx" ON "public"."artist_ledger_entries" USING "btree" ("settlement_id");



CREATE INDEX "artist_ledger_entries_studio_idx" ON "public"."artist_ledger_entries" USING "btree" ("studio_id");



CREATE INDEX "artist_payouts_artist_date_idx" ON "public"."artist_payouts" USING "btree" ("artist_id", "payout_date");



CREATE INDEX "artist_payouts_studio_idx" ON "public"."artist_payouts" USING "btree" ("studio_id");



CREATE UNIQUE INDEX "artist_split_rules_appointment_artist_unique_idx" ON "public"."artist_split_rules" USING "btree" ("studio_id", "appointment_type_id", "artist_id") WHERE (("is_active" = true) AND ("appointment_type_id" IS NOT NULL) AND ("artist_id" IS NOT NULL));



CREATE UNIQUE INDEX "artist_split_rules_appointment_default_unique_idx" ON "public"."artist_split_rules" USING "btree" ("studio_id", "appointment_type_id") WHERE (("is_active" = true) AND ("appointment_type_id" IS NOT NULL) AND ("artist_id" IS NULL));



CREATE INDEX "artist_split_rules_appointment_type_idx" ON "public"."artist_split_rules" USING "btree" ("appointment_type_id");



CREATE UNIQUE INDEX "artist_split_rules_artist_default_unique_idx" ON "public"."artist_split_rules" USING "btree" ("studio_id", "artist_id") WHERE (("is_active" = true) AND ("artist_id" IS NOT NULL) AND ("appointment_type_id" IS NULL));



CREATE INDEX "artist_split_rules_artist_idx" ON "public"."artist_split_rules" USING "btree" ("artist_id");



CREATE INDEX "artist_split_rules_studio_idx" ON "public"."artist_split_rules" USING "btree" ("studio_id");



CREATE INDEX "artist_weekly_schedules_artist_idx" ON "public"."artist_weekly_schedules" USING "btree" ("artist_id");



CREATE INDEX "artist_weekly_schedules_studio_idx" ON "public"."artist_weekly_schedules" USING "btree" ("studio_id");



CREATE INDEX "artists_preferred_work_station_id_idx" ON "public"."artists" USING "btree" ("preferred_work_station_id") WHERE ("preferred_work_station_id" IS NOT NULL);



CREATE INDEX "daily_settlement_lines_artist_idx" ON "public"."daily_settlement_lines" USING "btree" ("artist_id");



CREATE INDEX "daily_settlement_lines_settlement_idx" ON "public"."daily_settlement_lines" USING "btree" ("settlement_id");



CREATE INDEX "daily_settlements_studio_date_idx" ON "public"."daily_settlements" USING "btree" ("studio_id", "settlement_date");



CREATE UNIQUE INDEX "daily_settlements_unique_idx" ON "public"."daily_settlements" USING "btree" ("studio_id", "location_id", "settlement_date");



CREATE INDEX "email_events_appointment_idx" ON "public"."email_events" USING "btree" ("appointment_id");



CREATE INDEX "email_events_email_idx" ON "public"."email_events" USING "btree" ("email");



CREATE INDEX "email_events_studio_event_time_idx" ON "public"."email_events" USING "btree" ("studio_id", "event_type", "occurred_at");



CREATE INDEX "payments_appointment_idx" ON "public"."payments" USING "btree" ("appointment_id");



CREATE INDEX "payments_stripe_session_idx" ON "public"."payments" USING "btree" ("stripe_checkout_session_id");



CREATE INDEX "payments_studio_idx" ON "public"."payments" USING "btree" ("studio_id");



CREATE INDEX "products_barcode_idx" ON "public"."products" USING "btree" ("studio_id", "barcode");



CREATE INDEX "products_sku_idx" ON "public"."products" USING "btree" ("studio_id", "sku");



CREATE INDEX "products_studio_idx" ON "public"."products" USING "btree" ("studio_id");



CREATE INDEX "reporting_categories_parent_idx" ON "public"."reporting_categories" USING "btree" ("parent_id");



CREATE INDEX "reporting_categories_studio_idx" ON "public"."reporting_categories" USING "btree" ("studio_id");



CREATE INDEX "snp_studio_idx" ON "public"."studio_notification_profiles" USING "btree" ("studio_id");



CREATE INDEX "supplies_studio_idx" ON "public"."supplies" USING "btree" ("studio_id");



CREATE OR REPLACE TRIGGER "set_akna_updated_at" BEFORE UPDATE ON "public"."appointment_kind_notification_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_appointment_charges_updated_at" BEFORE UPDATE ON "public"."appointment_charges" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_appointment_types_updated_at" BEFORE UPDATE ON "public"."appointment_types" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_appointments_updated_at" BEFORE UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_artist_locations_updated_at" BEFORE UPDATE ON "public"."artist_locations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_artist_payouts_updated_at" BEFORE UPDATE ON "public"."artist_payouts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_artist_split_rules_updated_at" BEFORE UPDATE ON "public"."artist_split_rules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_artist_weekly_schedules_updated_at" BEFORE UPDATE ON "public"."artist_weekly_schedules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_artists_updated_at" BEFORE UPDATE ON "public"."artists" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_availabilities_updated_at" BEFORE UPDATE ON "public"."availabilities" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_customers_updated_at" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_daily_settlements_updated_at" BEFORE UPDATE ON "public"."daily_settlements" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_locations_updated_at" BEFORE UPDATE ON "public"."locations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_payments_updated_at" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_products_updated_at" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_reporting_categories_updated_at" BEFORE UPDATE ON "public"."reporting_categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_snp_updated_at" BEFORE UPDATE ON "public"."studio_notification_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_studios_updated_at" BEFORE UPDATE ON "public"."studios" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_supplies_updated_at" BEFORE UPDATE ON "public"."supplies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_workstations_updated_at" BEFORE UPDATE ON "public"."workstations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."appointment_charges"
    ADD CONSTRAINT "appointment_charges_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_charges"
    ADD CONSTRAINT "appointment_charges_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."appointment_charges"
    ADD CONSTRAINT "appointment_charges_reporting_category_id_fkey" FOREIGN KEY ("reporting_category_id") REFERENCES "public"."reporting_categories"("id");



ALTER TABLE ONLY "public"."appointment_charges"
    ADD CONSTRAINT "appointment_charges_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."appointment_kind_notification_assignments"
    ADD CONSTRAINT "appointment_kind_notification_assignments_kind_category_id_fkey" FOREIGN KEY ("kind_category_id") REFERENCES "public"."reporting_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_kind_notification_assignments"
    ADD CONSTRAINT "appointment_kind_notification_assignments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."studio_notification_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_kind_notification_assignments"
    ADD CONSTRAINT "appointment_kind_notification_assignments_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_manage_tokens"
    ADD CONSTRAINT "appointment_manage_tokens_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_refunds"
    ADD CONSTRAINT "appointment_refunds_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_refunds"
    ADD CONSTRAINT "appointment_refunds_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."appointment_types"
    ADD CONSTRAINT "appointment_types_appointment_kind_category_id_fkey" FOREIGN KEY ("appointment_kind_category_id") REFERENCES "public"."reporting_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointment_types"
    ADD CONSTRAINT "appointment_types_reporting_category_id_fkey" FOREIGN KEY ("reporting_category_id") REFERENCES "public"."reporting_categories"("id");



ALTER TABLE ONLY "public"."appointment_types"
    ADD CONSTRAINT "appointment_types_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_appointment_type_id_fkey" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_types"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_work_station_id_fkey" FOREIGN KEY ("work_station_id") REFERENCES "public"."workstations"("id");



ALTER TABLE ONLY "public"."artist_ledger_entries"
    ADD CONSTRAINT "artist_ledger_entries_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."artist_ledger_entries"
    ADD CONSTRAINT "artist_ledger_entries_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id");



ALTER TABLE ONLY "public"."artist_ledger_entries"
    ADD CONSTRAINT "artist_ledger_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."artist_ledger_entries"
    ADD CONSTRAINT "artist_ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "public"."artist_payouts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."artist_ledger_entries"
    ADD CONSTRAINT "artist_ledger_entries_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "public"."daily_settlements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."artist_ledger_entries"
    ADD CONSTRAINT "artist_ledger_entries_settlement_line_id_fkey" FOREIGN KEY ("settlement_line_id") REFERENCES "public"."daily_settlement_lines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."artist_ledger_entries"
    ADD CONSTRAINT "artist_ledger_entries_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."artist_locations"
    ADD CONSTRAINT "artist_locations_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id");



ALTER TABLE ONLY "public"."artist_locations"
    ADD CONSTRAINT "artist_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."artist_locations"
    ADD CONSTRAINT "artist_locations_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."artist_payouts"
    ADD CONSTRAINT "artist_payouts_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id");



ALTER TABLE ONLY "public"."artist_payouts"
    ADD CONSTRAINT "artist_payouts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."artist_payouts"
    ADD CONSTRAINT "artist_payouts_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."artist_split_rules"
    ADD CONSTRAINT "artist_split_rules_appointment_type_id_fkey" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."artist_split_rules"
    ADD CONSTRAINT "artist_split_rules_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id");



ALTER TABLE ONLY "public"."artist_split_rules"
    ADD CONSTRAINT "artist_split_rules_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."artist_weekly_schedules"
    ADD CONSTRAINT "artist_weekly_schedules_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id");



ALTER TABLE ONLY "public"."artist_weekly_schedules"
    ADD CONSTRAINT "artist_weekly_schedules_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."artist_weekly_schedules"
    ADD CONSTRAINT "artist_weekly_schedules_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."artists"
    ADD CONSTRAINT "artists_preferred_work_station_id_fkey" FOREIGN KEY ("preferred_work_station_id") REFERENCES "public"."workstations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."artists"
    ADD CONSTRAINT "artists_primary_location_id_fkey" FOREIGN KEY ("primary_location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."artists"
    ADD CONSTRAINT "artists_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."artists"
    ADD CONSTRAINT "artists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."availabilities"
    ADD CONSTRAINT "availabilities_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id");



ALTER TABLE ONLY "public"."availabilities"
    ADD CONSTRAINT "availabilities_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."availabilities"
    ADD CONSTRAINT "availabilities_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_preferred_location_id_fkey" FOREIGN KEY ("preferred_location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."daily_settlement_lines"
    ADD CONSTRAINT "daily_settlement_lines_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id");



ALTER TABLE ONLY "public"."daily_settlement_lines"
    ADD CONSTRAINT "daily_settlement_lines_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id");



ALTER TABLE ONLY "public"."daily_settlement_lines"
    ADD CONSTRAINT "daily_settlement_lines_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "public"."daily_settlements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_settlement_lines"
    ADD CONSTRAINT "daily_settlement_lines_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."daily_settlements"
    ADD CONSTRAINT "daily_settlements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."daily_settlements"
    ADD CONSTRAINT "daily_settlements_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."daily_settlements"
    ADD CONSTRAINT "daily_settlements_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_reporting_category_id_fkey" FOREIGN KEY ("reporting_category_id") REFERENCES "public"."reporting_categories"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."reporting_categories"
    ADD CONSTRAINT "reporting_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."reporting_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reporting_categories"
    ADD CONSTRAINT "reporting_categories_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."studio_notification_profiles"
    ADD CONSTRAINT "studio_notification_profiles_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplies"
    ADD CONSTRAINT "supplies_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



ALTER TABLE ONLY "public"."workstations"
    ADD CONSTRAINT "workstations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."workstations"
    ADD CONSTRAINT "workstations_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id");



CREATE POLICY "akna_delete" ON "public"."appointment_kind_notification_assignments" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "akna_insert" ON "public"."appointment_kind_notification_assignments" FOR INSERT WITH CHECK ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "akna_select" ON "public"."appointment_kind_notification_assignments" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "akna_update" ON "public"."appointment_kind_notification_assignments" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "amt_select" ON "public"."appointment_manage_tokens" FOR SELECT USING (("appointment_id" IN ( SELECT "a"."id"
   FROM ("public"."appointments" "a"
     JOIN "public"."users" "u" ON (("u"."studio_id" = "a"."studio_id")))
  WHERE ("u"."id" = "auth"."uid"()))));



ALTER TABLE "public"."appointment_charges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appointment_charges_delete" ON "public"."appointment_charges" FOR DELETE USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "appointment_charges_insert" ON "public"."appointment_charges" FOR INSERT WITH CHECK (true);



CREATE POLICY "appointment_charges_select" ON "public"."appointment_charges" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "appointment_charges_update" ON "public"."appointment_charges" FOR UPDATE USING (("studio_id" = "public"."current_user_studio"()));



ALTER TABLE "public"."appointment_kind_notification_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."appointment_manage_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."appointment_refunds" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appointment_refunds_delete" ON "public"."appointment_refunds" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "appointment_refunds_insert" ON "public"."appointment_refunds" FOR INSERT WITH CHECK (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "appointment_refunds_select" ON "public"."appointment_refunds" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "appointment_refunds_update" ON "public"."appointment_refunds" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



ALTER TABLE "public"."appointment_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appointment_types_delete" ON "public"."appointment_types" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "appointment_types_insert" ON "public"."appointment_types" FOR INSERT WITH CHECK (("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"])));



CREATE POLICY "appointment_types_select" ON "public"."appointment_types" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "appointment_types_update" ON "public"."appointment_types" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appointments_delete" ON "public"."appointments" FOR DELETE USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "appointments_insert" ON "public"."appointments" FOR INSERT WITH CHECK (true);



CREATE POLICY "appointments_select" ON "public"."appointments" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "appointments_update" ON "public"."appointments" FOR UPDATE USING (("studio_id" = "public"."current_user_studio"()));



ALTER TABLE "public"."artist_ledger_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "artist_ledger_entries_delete" ON "public"."artist_ledger_entries" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "artist_ledger_entries_insert" ON "public"."artist_ledger_entries" FOR INSERT WITH CHECK ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "artist_ledger_entries_select" ON "public"."artist_ledger_entries" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "artist_ledger_entries_update" ON "public"."artist_ledger_entries" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



ALTER TABLE "public"."artist_locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "artist_locations_delete" ON "public"."artist_locations" FOR DELETE USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "artist_locations_insert" ON "public"."artist_locations" FOR INSERT WITH CHECK (true);



CREATE POLICY "artist_locations_select" ON "public"."artist_locations" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "artist_locations_update" ON "public"."artist_locations" FOR UPDATE USING (("studio_id" = "public"."current_user_studio"()));



ALTER TABLE "public"."artist_payouts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "artist_payouts_delete" ON "public"."artist_payouts" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "artist_payouts_insert" ON "public"."artist_payouts" FOR INSERT WITH CHECK ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "artist_payouts_select" ON "public"."artist_payouts" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "artist_payouts_update" ON "public"."artist_payouts" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



ALTER TABLE "public"."artist_split_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "artist_split_rules_delete" ON "public"."artist_split_rules" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "artist_split_rules_insert" ON "public"."artist_split_rules" FOR INSERT WITH CHECK (("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"])));



CREATE POLICY "artist_split_rules_select" ON "public"."artist_split_rules" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "artist_split_rules_update" ON "public"."artist_split_rules" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



ALTER TABLE "public"."artist_weekly_schedules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."artists" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "artists_delete" ON "public"."artists" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "artists_insert" ON "public"."artists" FOR INSERT WITH CHECK (("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"])));



CREATE POLICY "artists_select" ON "public"."artists" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "artists_self_update" ON "public"."artists" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("user_id" = "auth"."uid"()))) WITH CHECK ((("studio_id" = "public"."current_user_studio"()) AND ("user_id" = "auth"."uid"())));



CREATE POLICY "artists_update" ON "public"."artists" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



ALTER TABLE "public"."availabilities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "availabilities_delete" ON "public"."availabilities" FOR DELETE USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "availabilities_insert" ON "public"."availabilities" FOR INSERT WITH CHECK (true);



CREATE POLICY "availabilities_select" ON "public"."availabilities" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "availabilities_update" ON "public"."availabilities" FOR UPDATE USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "aws_delete" ON "public"."artist_weekly_schedules" FOR DELETE USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "aws_insert" ON "public"."artist_weekly_schedules" FOR INSERT WITH CHECK (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "aws_select" ON "public"."artist_weekly_schedules" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "aws_update" ON "public"."artist_weekly_schedules" FOR UPDATE USING (("studio_id" = "public"."current_user_studio"()));



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers_delete" ON "public"."customers" FOR DELETE USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "customers_insert" ON "public"."customers" FOR INSERT WITH CHECK (true);



CREATE POLICY "customers_select" ON "public"."customers" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "customers_update" ON "public"."customers" FOR UPDATE USING (("studio_id" = "public"."current_user_studio"()));



ALTER TABLE "public"."daily_settlement_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_settlement_lines_delete" ON "public"."daily_settlement_lines" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "daily_settlement_lines_insert" ON "public"."daily_settlement_lines" FOR INSERT WITH CHECK (("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"])));



CREATE POLICY "daily_settlement_lines_select" ON "public"."daily_settlement_lines" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



ALTER TABLE "public"."daily_settlements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_settlements_delete" ON "public"."daily_settlements" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "daily_settlements_insert" ON "public"."daily_settlements" FOR INSERT WITH CHECK (("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"])));



CREATE POLICY "daily_settlements_select" ON "public"."daily_settlements" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "daily_settlements_update" ON "public"."daily_settlements" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



ALTER TABLE "public"."email_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_events_insert" ON "public"."email_events" FOR INSERT WITH CHECK (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "email_events_select" ON "public"."email_events" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locations_delete" ON "public"."locations" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "locations_insert" ON "public"."locations" FOR INSERT WITH CHECK (("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"])));



CREATE POLICY "locations_select" ON "public"."locations" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "locations_update" ON "public"."locations" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payments_delete" ON "public"."payments" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "payments_insert" ON "public"."payments" FOR INSERT WITH CHECK (true);



CREATE POLICY "payments_select" ON "public"."payments" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "payments_update" ON "public"."payments" FOR UPDATE USING (("studio_id" = "public"."current_user_studio"()));



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "products_delete" ON "public"."products" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "products_insert" ON "public"."products" FOR INSERT WITH CHECK (("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"])));



CREATE POLICY "products_select" ON "public"."products" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "products_update" ON "public"."products" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



ALTER TABLE "public"."reporting_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reporting_categories_delete" ON "public"."reporting_categories" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "reporting_categories_insert" ON "public"."reporting_categories" FOR INSERT WITH CHECK (("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"])));



CREATE POLICY "reporting_categories_select" ON "public"."reporting_categories" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "reporting_categories_select_anon_appointment_kind" ON "public"."reporting_categories" FOR SELECT TO "anon" USING ((("category_role" = 'appointment_kind'::"text") AND ("is_active" = true) AND (EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "reporting_categories"."studio_id") AND ("s"."is_active" = true))))));



CREATE POLICY "reporting_categories_update" ON "public"."reporting_categories" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "snp_delete" ON "public"."studio_notification_profiles" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "snp_insert" ON "public"."studio_notification_profiles" FOR INSERT WITH CHECK ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "snp_select" ON "public"."studio_notification_profiles" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "snp_update" ON "public"."studio_notification_profiles" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



ALTER TABLE "public"."studio_notification_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "studios_delete" ON "public"."studios" FOR DELETE USING (("id" = "public"."current_user_studio"()));



CREATE POLICY "studios_insert" ON "public"."studios" FOR INSERT WITH CHECK (true);



CREATE POLICY "studios_select" ON "public"."studios" FOR SELECT USING ((("id" = "public"."current_user_studio"()) OR (("invite_code" IS NOT NULL) AND ("auth"."role"() = 'authenticated'::"text"))));



CREATE POLICY "studios_select_anon" ON "public"."studios" FOR SELECT TO "anon" USING (("is_active" = true));



CREATE POLICY "studios_update" ON "public"."studios" FOR UPDATE USING (("id" = "public"."current_user_studio"()));



ALTER TABLE "public"."supplies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supplies_delete" ON "public"."supplies" FOR DELETE USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "supplies_insert" ON "public"."supplies" FOR INSERT WITH CHECK (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "supplies_select" ON "public"."supplies" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "supplies_update" ON "public"."supplies" FOR UPDATE USING (("studio_id" = "public"."current_user_studio"()));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_delete" ON "public"."users" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "users_insert" ON "public"."users" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "users_select" ON "public"."users" FOR SELECT USING ((("id" = "auth"."uid"()) OR ("studio_id" = "public"."current_user_studio"())));



CREATE POLICY "users_self_update" ON "public"."users" FOR UPDATE USING (("id" = "auth"."uid"())) WITH CHECK ((("id" = "auth"."uid"()) AND ((( SELECT "users_1"."studio_id"
   FROM "public"."users" "users_1"
  WHERE ("users_1"."id" = "auth"."uid"())) IS NULL) OR ("user_role" = ( SELECT "users_1"."user_role"
   FROM "public"."users" "users_1"
  WHERE ("users_1"."id" = "auth"."uid"()))))));



CREATE POLICY "users_update" ON "public"."users" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



ALTER TABLE "public"."workstations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workstations_delete" ON "public"."workstations" FOR DELETE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));



CREATE POLICY "workstations_insert" ON "public"."workstations" FOR INSERT WITH CHECK (("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"])));



CREATE POLICY "workstations_select" ON "public"."workstations" FOR SELECT USING (("studio_id" = "public"."current_user_studio"()));



CREATE POLICY "workstations_update" ON "public"."workstations" FOR UPDATE USING ((("studio_id" = "public"."current_user_studio"()) AND ("public"."current_user_role"() = ANY (ARRAY['Owner'::"text", 'Admin'::"text"]))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."apply_product_checkout_stock"("p_lines" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_product_checkout_stock"("p_lines" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_product_checkout_stock"("p_lines" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_product_checkout_stock_system"("p_studio_id" "uuid", "p_lines" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_product_checkout_stock_system"("p_studio_id" "uuid", "p_lines" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_product_checkout_stock_system"("p_studio_id" "uuid", "p_lines" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_studio"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_studio"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_studio"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_booking_data"("p_studio_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_booking_data"("p_studio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_booking_data"("p_studio_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";
























GRANT ALL ON TABLE "public"."appointment_charges" TO "anon";
GRANT ALL ON TABLE "public"."appointment_charges" TO "authenticated";
GRANT ALL ON TABLE "public"."appointment_charges" TO "service_role";



GRANT ALL ON TABLE "public"."appointment_kind_notification_assignments" TO "anon";
GRANT ALL ON TABLE "public"."appointment_kind_notification_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointment_kind_notification_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."appointment_manage_tokens" TO "anon";
GRANT ALL ON TABLE "public"."appointment_manage_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."appointment_manage_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."appointment_refunds" TO "anon";
GRANT ALL ON TABLE "public"."appointment_refunds" TO "authenticated";
GRANT ALL ON TABLE "public"."appointment_refunds" TO "service_role";



GRANT ALL ON TABLE "public"."appointment_types" TO "anon";
GRANT ALL ON TABLE "public"."appointment_types" TO "authenticated";
GRANT ALL ON TABLE "public"."appointment_types" TO "service_role";



GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



GRANT ALL ON TABLE "public"."artist_ledger_entries" TO "anon";
GRANT ALL ON TABLE "public"."artist_ledger_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."artist_ledger_entries" TO "service_role";



GRANT ALL ON TABLE "public"."artist_locations" TO "anon";
GRANT ALL ON TABLE "public"."artist_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."artist_locations" TO "service_role";



GRANT ALL ON TABLE "public"."artist_payouts" TO "anon";
GRANT ALL ON TABLE "public"."artist_payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."artist_payouts" TO "service_role";



GRANT ALL ON TABLE "public"."artist_split_rules" TO "anon";
GRANT ALL ON TABLE "public"."artist_split_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."artist_split_rules" TO "service_role";



GRANT ALL ON TABLE "public"."artist_weekly_schedules" TO "anon";
GRANT ALL ON TABLE "public"."artist_weekly_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."artist_weekly_schedules" TO "service_role";



GRANT ALL ON TABLE "public"."artists" TO "anon";
GRANT ALL ON TABLE "public"."artists" TO "authenticated";
GRANT ALL ON TABLE "public"."artists" TO "service_role";



GRANT ALL ON TABLE "public"."availabilities" TO "anon";
GRANT ALL ON TABLE "public"."availabilities" TO "authenticated";
GRANT ALL ON TABLE "public"."availabilities" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."daily_settlement_lines" TO "anon";
GRANT ALL ON TABLE "public"."daily_settlement_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_settlement_lines" TO "service_role";



GRANT ALL ON TABLE "public"."daily_settlements" TO "anon";
GRANT ALL ON TABLE "public"."daily_settlements" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_settlements" TO "service_role";



GRANT ALL ON TABLE "public"."email_events" TO "anon";
GRANT ALL ON TABLE "public"."email_events" TO "authenticated";
GRANT ALL ON TABLE "public"."email_events" TO "service_role";



GRANT ALL ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."reporting_categories" TO "anon";
GRANT ALL ON TABLE "public"."reporting_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."reporting_categories" TO "service_role";



GRANT ALL ON TABLE "public"."studio_notification_profiles" TO "anon";
GRANT ALL ON TABLE "public"."studio_notification_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_notification_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."studios" TO "anon";
GRANT ALL ON TABLE "public"."studios" TO "authenticated";
GRANT ALL ON TABLE "public"."studios" TO "service_role";



GRANT ALL ON TABLE "public"."supplies" TO "anon";
GRANT ALL ON TABLE "public"."supplies" TO "authenticated";
GRANT ALL ON TABLE "public"."supplies" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."workstations" TO "anon";
GRANT ALL ON TABLE "public"."workstations" TO "authenticated";
GRANT ALL ON TABLE "public"."workstations" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

create extension if not exists "pg_net" with schema "public";


