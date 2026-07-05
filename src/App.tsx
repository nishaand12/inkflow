
import React, { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supabase } from "./utils/supabase";
import {
  bootstrapRecoverySession,
  getRecoveryUrlState,
  isRecoveryMarked,
  markPasswordRecovery,
  redirectRecoveryHashToResetPage
} from "./utils/passwordRecovery";
import Layout from "./Layout";
import Auth from "./pages/Auth";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Calendar from "./pages/Calendar";
import Appointments from "./pages/Appointments";
import Artists from "./pages/Artists";
import Locations from "./pages/Locations";
import WorkStations from "./pages/WorkStations";
import AppointmentTypes from "./pages/AppointmentTypes";
import Customers from "./pages/Customers";
import Products from "./pages/Products";
import ReportingCategories from "./pages/ReportingCategories";
import Reports from "./pages/Reports";
import Sales from "./pages/Sales";
import Settlements from "./pages/Settlements";
import SettlementDetail from "./pages/SettlementDetail";
import ReconciliationDetail from "./pages/ReconciliationDetail";
import ArtistPayouts from "./pages/ArtistPayouts";
import MyAvailability from "./pages/MyAvailability";
import OnboardingChoice from "./pages/OnboardingChoice";
import PendingValidation from "./pages/PendingValidation";
import StudioSettings from "./pages/StudioSettings";
import PublicTemplates from "./pages/PublicTemplates";
import UserManagement from "./pages/UserManagement";
import Supplies from "./pages/Supplies";
import PublicBooking from "./pages/PublicBooking";
import ManageAppointment from "./pages/ManageAppointment";
import DepositSuccess from "./pages/DepositSuccess";
import DepositCancelled from "./pages/DepositCancelled";
import PaymentSuccess from "./pages/PaymentSuccess";
import PaymentCancelled from "./pages/PaymentCancelled";

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

const AuthLoadingScreen = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
  </div>
);

export default function App() {
  const initialRecoveryState = getRecoveryUrlState();
  const [session, setSession] = useState(null);
  const [isRecovering, setIsRecovering] = useState(
    () => isRecoveryMarked() || initialRecoveryState.hasPendingRecovery
  );
  const [recoveryBootstrapping, setRecoveryBootstrapping] = useState(
    () => initialRecoveryState.hasPendingRecovery || isRecoveryMarked()
  );
  const [loading, setLoading] = useState(true);
  const queryClient = useMemo(() => new QueryClient(), []);

  useEffect(() => {
    if (redirectRecoveryHashToResetPage()) {
      return;
    }

    let mounted = true;

    const initAuth = async () => {
      const recoveryState = getRecoveryUrlState();

      if (recoveryState.hasPendingRecovery || isRecoveryMarked()) {
        try {
          const bootstrapped = await bootstrapRecoverySession(supabase);
          if (mounted && bootstrapped) {
            setIsRecovering(true);
          }
        } catch (error) {
          console.error("Password recovery bootstrap failed:", error);
          if (mounted) {
            setIsRecovering(false);
          }
        }
      }

      const { data } = await supabase.auth.getSession();
      if (mounted) {
        setSession(data.session || null);
        if (data.session && isRecoveryMarked()) {
          setIsRecovering(true);
        }
        setRecoveryBootstrapping(false);
        setLoading(false);
      }
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") {
        markPasswordRecovery();
        setIsRecovering(true);
        setRecoveryBootstrapping(false);
      }
      setSession(nextSession);
    });

    initAuth();

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (loading || recoveryBootstrapping) {
    return <AuthLoadingScreen />;
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
            element={session && !isRecovering ? <Navigate to="/dashboard" replace /> : <Auth />}
          />
          <Route
            path="/forgot-password"
            element={
              session && !isRecovering ? <Navigate to="/dashboard" replace /> : <ForgotPassword />
            }
          />
          <Route
            path="/reset-password"
            element={
              !session || !isRecovering ? (
                <Navigate to="/forgot-password" replace />
              ) : (
                <ResetPassword onComplete={() => setIsRecovering(false)} />
              )
            }
          />
          <Route path="/book" element={<PublicBooking />} />
          <Route path="/manage-appointment" element={<ManageAppointment />} />
          <Route path="/deposit-success" element={<DepositSuccess />} />
          <Route path="/deposit-cancelled" element={<DepositCancelled />} />
          <Route path="/payment-success" element={<PaymentSuccess />} />
          <Route path="/payment-cancelled" element={<PaymentCancelled />} />

          <Route element={<AppShell session={session} />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/appointments" element={<Appointments />} />
            <Route path="/artists" element={<Artists />} />
            <Route path="/locations" element={<Locations />} />
            <Route path="/workstations" element={<WorkStations />} />
            <Route path="/appointment-types" element={<AppointmentTypes />} />
            <Route path="/products" element={<Products />} />
            <Route path="/reporting-categories" element={<ReportingCategories />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/sales" element={<Sales />} />
            <Route path="/settlements" element={<Settlements />} />
            <Route path="/settlements/:settlementId" element={<SettlementDetail />} />
            <Route path="/reconciliation/:reconciliationId" element={<ReconciliationDetail />} />
            <Route path="/artist-payouts" element={<ArtistPayouts />} />
            <Route path="/my-availability" element={<MyAvailability />} />
            <Route path="/onboarding-choice" element={<OnboardingChoice />} />
            <Route path="/pending-validation" element={<PendingValidation />} />
            <Route path="/studio-settings" element={<StudioSettings />} />
            <Route path="/public-templates" element={<PublicTemplates />} />
            <Route path="/user-management" element={<UserManagement />} />
            <Route path="/supplies" element={<Supplies />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
