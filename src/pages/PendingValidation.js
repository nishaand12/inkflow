import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";

export default function PendingValidation() {
  const [autoRedirectTime, setAutoRedirectTime] = useState(30);

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
              Your studio is awaiting validation. You'll be able to access the full application once your studio has been approved.
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

          <Link to={createPageUrl("StudioSettings")}>
            <Button variant="outline" className="w-full">
              View Studio Settings
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}