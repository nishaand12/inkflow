
import React, { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supabase } from "./utils/supabase";
import Layout from "./Layout";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Calendar from "./pages/Calendar";
import Appointments from "./pages/Appointments";
import Artists from "./pages/Artists";
import Locations from "./pages/Locations";
import WorkStations from "./pages/WorkStations";
import AppointmentTypes from "./pages/AppointmentTypes";
import Customers from "./pages/Customers";
import Reports from "./pages/Reports";
import MyAvailability from "./pages/MyAvailability";
import OnboardingChoice from "./pages/OnboardingChoice";
import PendingValidation from "./pages/PendingValidation";
import StudioSettings from "./pages/StudioSettings";
import UserManagement from "./pages/UserManagement";

const AppShell = ({ session }) => {
  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
};

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useMemo(() => new QueryClient(), []);

  useEffect(() => {
    let mounted = true;

    const initSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) {
        setSession(data.session || null);
        setLoading(false);
      }
    };

    initSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={<Navigate to={session ? "/dashboard" : "/auth"} replace />}
          />
          <Route
            path="/auth"
            element={session ? <Navigate to="/dashboard" replace /> : <Auth />}
          />

          <Route element={<AppShell session={session} />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/appointments" element={<Appointments />} />
            <Route path="/artists" element={<Artists />} />
            <Route path="/locations" element={<Locations />} />
            <Route path="/workstations" element={<WorkStations />} />
            <Route path="/appointment-types" element={<AppointmentTypes />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/my-availability" element={<MyAvailability />} />
            <Route path="/onboarding-choice" element={<OnboardingChoice />} />
            <Route path="/pending-validation" element={<PendingValidation />} />
            <Route path="/studio-settings" element={<StudioSettings />} />
            <Route path="/user-management" element={<UserManagement />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
