import React, { useState } from "react";
import { supabase } from "@/utils/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Auth() {
  const [mode, setMode] = useState("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === "sign-up") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName
            }
          }
        });
        if (signUpError) throw signUpError;
        setMessage("Check your email to confirm your account.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (signInError) throw signInError;
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 px-4">
      <div className="w-full max-w-md bg-white shadow-xl rounded-2xl p-8 border border-gray-100">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">InkFlow</h1>
        <p className="text-gray-500 mb-6">
          {mode === "sign-up" ? "Create your account" : "Sign in to your studio"}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "sign-up" && (
            <div className="space-y-1">
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jordan Ink"
                required
              />
            </div>
          )}

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

          <div className="space-y-1">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
              {error}
            </div>
          )}

          {message && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg p-2">
              {message}
            </div>
          )}

          <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
            {loading ? "Please wait..." : mode === "sign-up" ? "Create account" : "Sign in"}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          {mode === "sign-up" ? (
            <button
              type="button"
              className="text-indigo-600 hover:text-indigo-700"
              onClick={() => setMode("sign-in")}
            >
              Already have an account? Sign in
            </button>
          ) : (
            <button
              type="button"
              className="text-indigo-600 hover:text-indigo-700"
              onClick={() => setMode("sign-up")}
            >
              Need an account? Sign up
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
