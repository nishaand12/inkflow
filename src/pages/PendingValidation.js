import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, LogIn } from "lucide-react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";

export default function PendingValidation() {
  const [autoRedirectTime, setAutoRedirectTime] = useState(30);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      window.location.href = 'mailto:ceteasystems@gmail.com?subject=Studio Validation Request';
    }, 30000);

    const countdown = setInterval(() => {
      setAutoRedirectTime(prev => prev > 0 ? prev - 1 : 0);
    }, 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(countdown);
    };
  }, []);

  const handleSignOutToAuth = async () => {
    setSigningOut(true);
    try {
      await base44.auth.logout();
    } catch (e) {
      console.error(e);
    } finally {
      window.location.replace("/auth");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardContent className="pt-12 pb-12 text-center space-y-6">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
            <Clock className="w-10 h-10 text-amber-600 animate-pulse" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">Pending Validation</h1>
            <p className="text-gray-600">
              Your studio is awaiting validation. You will be able to use the full application after your studio has been approved.
            </p>
            <p className="text-gray-600 text-sm mt-3">
              Once you have confirmation that your studio is active, sign out and sign in again at the login page so your account picks up the updated access.
            </p>
          </div>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              Need help? Email{' '}
              <a href="mailto:ceteasystems@gmail.com" className="font-semibold underline">
                ceteasystems@gmail.com
              </a>
            </p>
            {autoRedirectTime > 0 && (
              <p className="text-xs text-blue-700 mt-2">
                Auto-redirecting in {autoRedirectTime}s...
              </p>
            )}
          </div>

          <Button
            type="button"
            className="w-full bg-indigo-600 hover:bg-indigo-700"
            disabled={signingOut}
            onClick={handleSignOutToAuth}
          >
            <LogIn className="w-4 h-4 mr-2" />
            {signingOut ? "Signing out…" : "Sign out — then sign in at Login"}
          </Button>
          <p className="text-xs text-gray-500 text-center">
            Or go to{" "}
            <Link to="/auth" className="text-indigo-600 font-medium underline">
              /auth
            </Link>{" "}
            after you sign out (or use Sign out above).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}