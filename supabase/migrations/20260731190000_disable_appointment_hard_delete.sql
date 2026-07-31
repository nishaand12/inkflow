-- Appointments must never be hard-deleted from client apps; staff cancel them
-- instead so history, deposits, and reporting stay intact. Dropping the policy
-- and revoking the privilege blocks DELETE for both anon and authenticated
-- roles regardless of app version; service_role is unaffected.
drop policy if exists "appointments_delete" on "public"."appointments";

revoke delete on table "public"."appointments" from "anon", "authenticated";
