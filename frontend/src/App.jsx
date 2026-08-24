import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import Layout from "./components/Layout.jsx";

import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Settings from "./pages/Settings.jsx";
import BookAppointment from "./pages/patient/BookAppointment.jsx";
import MyAppointments from "./pages/patient/MyAppointments.jsx";
import Schedule from "./pages/doctor/Schedule.jsx";
import Doctors from "./pages/admin/Doctors.jsx";
import Notifications from "./pages/admin/Notifications.jsx";

function Protected({ role, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={{ PATIENT: "/patient", DOCTOR: "/doctor", ADMIN: "/admin" }[user.role]} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<Home />} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />

      <Route path="/patient" element={<Protected role="PATIENT"><BookAppointment /></Protected>} />
      <Route path="/patient/appointments" element={<Protected role="PATIENT"><MyAppointments /></Protected>} />

      <Route path="/doctor" element={<Protected role="DOCTOR"><Schedule /></Protected>} />

      <Route path="/admin" element={<Protected role="ADMIN"><Doctors /></Protected>} />
      <Route path="/admin/notifications" element={<Protected role="ADMIN"><Notifications /></Protected>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
