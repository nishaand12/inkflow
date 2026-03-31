import React from "react";
import { AlertCircle } from "lucide-react";

export default function DepositCancelled() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-8 h-8 text-amber-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Cancelled</h1>
        <p className="text-gray-600 mb-6">
          Your deposit payment was not completed. No charges have been made.
        </p>
        <p className="text-sm text-gray-500">
          If you'd like to pay your deposit, please use the payment link from your
          confirmation email or contact the studio directly.
        </p>
      </div>
    </div>
  );
}
