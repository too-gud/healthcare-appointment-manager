import React, { useEffect, useState } from "react";
import api from "../../api/client.js";
import UrgencyBadge from "../../components/UrgencyBadge.jsx";

const STATUS_COLORS = {
  BOOKED: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-600",
  HELD: "bg-amber-100 text-amber-800",
};

export default function MyAppointments() {
  const [appts, setAppts] = useState([]);

  async function load() {
    const { data } = await api.get("/appointments");
    setAppts(data);
  }
  useEffect(() => { load(); }, []);

  async function cancel(id) {
    if (!confirm("Cancel this appointment?")) return;
    await api.post(`/appointments/${id}/cancel`, { reason: "Cancelled by patient" });
    load();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My Appointments</h1>
      {appts.map((a) => (
        <div key={a.id} className="card">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-medium">Dr. {a.doctor.user.name}</p>
              <p className="text-sm text-gray-500">{new Date(a.slotStart).toLocaleString()}</p>
            </div>
            <span className={`badge ${STATUS_COLORS[a.status]}`}>{a.status}</span>
          </div>

          {a.previsitSummary && (
            <div className="bg-gray-50 rounded-lg p-3 mt-3 text-sm space-y-1">
              <div className="flex items-center gap-2">
                <strong>Urgency:</strong> <UrgencyBadge level={a.previsitSummary.urgency} />
              </div>
              <p><strong>Chief complaint:</strong> {a.previsitSummary.chiefComplaint}</p>
            </div>
          )}

          {a.postvisitSummary && (
            <div className="bg-green-50 rounded-lg p-3 mt-3 text-sm space-y-2">
              <p className="font-medium">Visit summary</p>
              <p>{a.postvisitSummary.summary}</p>
              {a.postvisitSummary.medicationSchedule?.length > 0 && (
                <div>
                  <p className="font-medium">Medication schedule</p>
                  <ul className="list-disc list-inside">
                    {a.postvisitSummary.medicationSchedule.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}
              {a.postvisitSummary.followUpSteps?.length > 0 && (
                <div>
                  <p className="font-medium">Follow-up steps</p>
                  <ul className="list-disc list-inside">
                    {a.postvisitSummary.followUpSteps.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {a.status === "BOOKED" && (
            <button className="btn-danger mt-3 !py-1 !px-3" onClick={() => cancel(a.id)}>Cancel</button>
          )}
        </div>
      ))}
      {appts.length === 0 && <p className="text-sm text-gray-500">No appointments yet.</p>}
    </div>
  );
}
