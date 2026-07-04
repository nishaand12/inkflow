import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, CreditCard, Loader2 } from "lucide-react";
import { supabase } from "@/utils/supabase";

export default function DepositCancelled() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");

  // null = loading, otherwise { checkout_url?, expires_at?, paid?, expired? }
  const [link, setLink] = useState(sessionId ? null : { expired: true });

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("get-checkout-link", {
          body: { sessionId },
        });
        if (!active) return;
        if (error || !data) {
          setLink({ expired: true });
        } else {
          setLink(data);
        }
      } catch (_) {
        if (active) setLink({ expired: true });
      }
    })();
    return () => {
      active = false;
    };
  }, [sessionId]);

  const expiresText = link?.expires_at
    ? new Date(link.expires_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-8 h-8 text-amber-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Cancelled</h1>

        {link === null ? (
          <div className="flex items-center justify-center gap-2 text-gray-500 py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Checking your booking…</span>
          </div>
        ) : link.paid ? (
          <p className="text-gray-600">
            Good news — your deposit has already been received and your appointment is
            confirmed. No further payment is needed.
          </p>
        ) : link.checkout_url ? (
          <>
            <p className="text-gray-600 mb-6">
              Your appointment is <span className="font-semibold">NOT</span> confirmed and no
              charges have been made.
            </p>
            <a
              href={link.checkout_url}
              className="inline-flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-colors mb-4"
            >
              <CreditCard className="w-5 h-5" />
              Pay Deposit &amp; Confirm Appointment
            </a>
            <p className="text-sm text-gray-500">
              {expiresText
                ? `This payment link expires at ${expiresText}, after which your requested time will be released.`
                : "This payment link expires 1 hour after booking, after which your requested time will be released."}
            </p>
          </>
        ) : (
          <>
            <p className="text-gray-600 mb-6">
              Your appointment is <span className="font-semibold">NOT</span> confirmed and no
              charges have been made.
            </p>
            <p className="text-sm text-gray-500">
              This payment link has expired and your requested time has been released. Please
              book again on the studio's booking page, or contact the studio directly.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
