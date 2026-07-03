import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/utils/supabase";
import {
  getResetPasswordRedirectUrl,
  markPasswordRecovery
} from "@/utils/passwordRecovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState("request");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleRequestReset = async (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const redirectTo = getResetPasswordRedirectUrl();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo
      });
      if (resetError) throw resetError;
      setStep("verify");
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp.trim(),
        type: "recovery"
      });
      if (verifyError) throw verifyError;
      markPasswordRecovery();
      navigate("/reset-password", { replace: true });
    } catch (err) {
      setError(err.message || "Invalid or expired code.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 px-4">
      <div className="w-full max-w-md bg-white shadow-xl rounded-2xl p-8 border border-gray-100">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">InkFlow</h1>
        <p className="text-gray-500 mb-6">
          {step === "request" ? "Reset your password" : "Check your email"}
        </p>

        {step === "request" ? (
          <form onSubmit={handleRequestReset} className="space-y-4">
            <p className="text-sm text-gray-500">
              Enter your email and we&apos;ll send a reset link and a one-time code.
            </p>

            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@studio.com"
                required
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
              {loading ? "Please wait..." : "Send reset instructions"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <p className="text-sm text-gray-500">
              If an account exists for <strong className="text-gray-700">{email}</strong>, we sent
              instructions. Click the link in the email, or enter the 8-digit code below.
            </p>

            <div className="space-y-1">
              <Label htmlFor="otp">One-time code</Label>
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="12345678"
                maxLength={8}
                pattern="[0-9]{8}"
                required
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700"
              disabled={loading || otp.length !== 8}
            >
              {loading ? "Please wait..." : "Verify code"}
            </Button>

            <button
              type="button"
              className="w-full text-sm text-gray-500 hover:text-gray-700"
              onClick={() => {
                setStep("request");
                setOtp("");
                setError(null);
              }}
            >
              Use a different email
            </button>
          </form>
        )}

        <div className="mt-6 text-center text-sm text-gray-500">
          <Link to="/auth" className="text-indigo-600 hover:text-indigo-700">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
