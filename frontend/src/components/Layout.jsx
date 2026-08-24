import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const links = {
    PATIENT: [
      { to: "/patient", label: "Book Appointment" },
      { to: "/patient/appointments", label: "My Appointments" },
      { to: "/settings", label: "Settings" },
    ],
    DOCTOR: [
      { to: "/doctor", label: "My Schedule" },
      { to: "/settings", label: "Settings" },
    ],
    ADMIN: [
      { to: "/admin", label: "Doctors" },
      { to: "/admin/notifications", label: "Notifications" },
    ],
  };

  return (
    <div className="min-h-screen">
      <header className="bg-brand-500 text-white">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 py-3">
          <Link to="/" className="font-semibold text-lg">🏥 Clinic Appointment Manager</Link>
          {user && (
            <nav className="flex items-center gap-4 text-sm">
              {(links[user.role] || []).map((l) => (
                <Link key={l.to} to={l.to} className="hover:underline">
                  {l.label}
                </Link>
              ))}
              <span className="opacity-80">{user.name} ({user.role})</span>
              <button
                className="btn-secondary !py-1 !px-3"
                onClick={() => {
                  logout();
                  navigate("/login");
                }}
              >
                Logout
              </button>
            </nav>
          )}
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
