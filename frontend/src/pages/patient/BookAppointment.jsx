import React, { useEffect, useState } from "react";
import api from "../../api/client.js";

export default function BookAppointment() {
  const [specialisation, setSpecialisation] = useState("");
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState([]);
  const [slotsMsg, setSlotsMsg] = useState("");
  const [held, setHeld] = useState(null); // { appointmentId, holdExpiresAt, slot }
  const [symptoms, setSymptoms] = useState("");
  const [confirmResult, setConfirmResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    searchDoctors();
  }, []);

  async function searchDoctors() {
    const { data } = await api.get("/doctors", { params: specialisation ? { specialisation } : {} });
    setDoctors(data);
  }

  async function loadSlots(doctor) {
    setSelectedDoctor(doctor);
    setHeld(null);
    setConfirmResult(null);
    setError("");
    const { data } = await api.get(`/doctors/${doctor.id}/slots`, { params: { date } });
    if (!data.available) {
      setSlots([]);
      setSlotsMsg(data.reason);
    } else {
      setSlots(data.slots);
      setSlotsMsg(data.slots.length ? "" : "No open slots this day.");
    }
  }

  async function holdSlot(slot) {
    setError("");
    setBusy(true);
    try {
      const { data } = await api.post("/appointments/hold", {
        doctorId: selectedDoctor.id,
        slotStart: slot.start,
        slotEnd: slot.end,
      });
      setHeld({ appointmentId: data.appointmentId, holdExpiresAt: data.holdExpiresAt, slot });
    } catch (err) {
      setError(err.response?.data?.error || "Could not hold slot");
      if (selectedDoctor) loadSlots(selectedDoctor); // refresh — someone else may have taken it
    } finally {
      setBusy(false);
    }
  }

  async function confirmBooking(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { data } = await api.post(`/appointments/${held.appointmentId}/confirm`, { symptomsText: symptoms });
      setConfirmResult(data);
    } catch (err) {
      setError(err.response?.data?.error || "Could not confirm booking");
    } finally {
      setBusy(false);
    }
  }

  if (confirmResult) {
    const s = confirmResult.appointment.previsitSummary;
    return (
      <div className="card max-w-xl mx-auto">
        <h2 className="text-lg font-semibold mb-2">✅ Appointment booked</h2>
        <p className="text-sm text-gray-600 mb-4">
          With {selectedDoctor.name} on {new Date(held.slot.start).toLocaleString()}. A confirmation email and calendar
          invite have been sent.
        </p>
        {confirmResult.llmWarning && <p className="text-sm text-amber-600 mb-3">⚠ {confirmResult.llmWarning}</p>}
        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <p><strong>Chief complaint:</strong> {s.chiefComplaint}</p>
          <p><strong>Urgency:</strong> {s.urgency}</p>
        </div>
        <a href="/patient/appointments" className="btn-primary mt-4 inline-block">View my appointments</a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Find a doctor</h2>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="Search by specialisation (e.g. Cardiology)"
            value={specialisation}
            onChange={(e) => setSpecialisation(e.target.value)}
          />
          <button className="btn-secondary" onClick={searchDoctors}>Search</button>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          {doctors.map((d) => (
            <button
              key={d.id}
              onClick={() => loadSlots(d)}
              className={`text-left card hover:border-brand-500 ${selectedDoctor?.id === d.id ? "border-brand-500 ring-1 ring-brand-500" : ""}`}
            >
              <p className="font-medium">Dr. {d.name}</p>
              <p className="text-sm text-gray-500">{d.specialisation} · {d.slotDurationMin} min slots</p>
            </button>
          ))}
          {doctors.length === 0 && <p className="text-sm text-gray-500">No doctors found.</p>}
        </div>
      </div>

      {selectedDoctor && !held && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Pick a slot with Dr. {selectedDoctor.name}</h2>
          <input
            className="input max-w-xs"
            type="date"
            value={date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => {
              setDate(e.target.value);
              loadSlots(selectedDoctor);
            }}
          />
          <div className="flex flex-wrap gap-2 mt-4">
            {slots.map((s) => (
              <button key={s.start} disabled={busy} className="btn-secondary" onClick={() => holdSlot(s)}>
                {new Date(s.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </button>
            ))}
          </div>
          {slotsMsg && <p className="text-sm text-gray-500 mt-3">{slotsMsg}</p>}
        </div>
      )}

      {held && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-1">Tell us your symptoms</h2>
          <p className="text-sm text-gray-500 mb-3">
            Slot held until {new Date(held.holdExpiresAt).toLocaleTimeString()} — confirm before then or it will be
            released.
          </p>
          <form onSubmit={confirmBooking} className="space-y-3">
            <textarea
              className="input min-h-[120px]"
              placeholder="Describe your symptoms in your own words…"
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              required
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy}>{busy ? "Confirming…" : "Confirm appointment"}</button>
              <button type="button" className="btn-secondary" onClick={() => setHeld(null)}>Change slot</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
