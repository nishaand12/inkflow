import React from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle } from "lucide-react";

export default function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const studioName = searchParams.get("studio") || "the studio";
  const paymentType = searchParams.get("type") || "payment";

  const heading =
    paymentType === "deposit" ? "Deposit Received!" : "Payment Successful!";
  const description =
    paymentType === "deposit"
      ? `Your deposit to ${studioName} has been successfully processed.`
      : `Your payment to ${studioName} has been successfully processed.`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{heading}</h1>
        <p className="text-gray-600 mb-6">{description}</p>
        <p className="text-sm text-gray-500">
          You can close this page. If you have any questions about your
          appointment, please contact the studio directly.
        </p>
      </div>
    </div>
  );
}
