import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Returns the hosted checkout URL for a still-payable session so the
// deposit-cancelled page can offer a retry link. The Stripe session id acts as
// the bearer secret: it is unguessable and only known to the customer who was
// just on that checkout page.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { sessionId } = await req.json();
    if (!sessionId || typeof sessionId !== "string" || !sessionId.startsWith("cs_")) {
      return json({ error: "Invalid sessionId" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: payment, error } = await supabase
      .from("payments")
      .select("checkout_url, expires_at, status, amount, currency")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();

    if (error) {
      console.error("get-checkout-link lookup failed:", error);
      return json({ error: "Lookup failed" }, 500);
    }

    if (payment?.status === "paid") {
      return json({ paid: true });
    }

    const expiresAt = payment?.expires_at ? new Date(payment.expires_at) : null;
    const payable =
      payment?.status === "pending" &&
      Boolean(payment.checkout_url) &&
      expiresAt !== null &&
      expiresAt > new Date();

    if (!payable) {
      return json({ expired: true });
    }

    return json({
      checkout_url: payment.checkout_url,
      expires_at: payment.expires_at,
      amount: payment.amount,
      currency: payment.currency,
    });
  } catch (err) {
    console.error("get-checkout-link error:", err);
    return json({ error: err.message || "Unknown error" }, 500);
  }
});

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
