import React, { useEffect, useState } from "react";
import api from "../../api/client.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Doctors() {
  const [doctors, setDoctors] = useState([]);
  const [form, setForm] = useState({
    email: "", password: "", name: "", specialisation: "", slotDurationMin: 30,
    workingHours: [1, 2, 3, 4, 5].map((d) => ({ day: d, start: "09:00", end: "17:00" })),
  });
  const [leaveForm, setLeaveForm] = useState({});
  const [msg, setMsg] = useState("");

  async function load() {
    const { data } = await api.get("/admin/doctors");
    setDoctors(data);
  }
  useEffect(() => { load(); }, []);

  async function createDoctor(e) {
    e.preventDefault();
    setMsg("");
    try {
      await api.post("/admin/doctors", { ...form, slotDurationMin: Number(form.slotDurationMin) });
      setMsg("Doctor created.");
      setForm({ ...form, email: "", password: "", name: "", specialisation: "" });
      load();
    } catch (err) {
      setMsg(err.response?.data?.error?.toString() || "Failed to create doctor");
    }
  }

  function toggleDay(day) {
    const exists = form.workingHours.find((w) => w.day === day);
    setForm({
      ...form,
      workingHours: exists
        ? form.workingHours.filter((w) => w.day !== day)
        : [...form.workingHours, { day, start: "09:00", end: "17:00" }],
    });
  }

  async function markLeave(profileId) {
    const { date, reason } = leaveForm[profileId] || {};
    if (!date) return;
    const { data } = await api.post(`/admin/doctors/${profileId}/leave`, { date, reason });
    setMsg(`Leave recorded. ${data.cancelledAppointments} appointment(s) cancelled and patients notified.`);
    load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Manage Doctors</h1>
      {msg && <p className="text-sm text-brand-700 bg-brand-50 rounded-lg p-2">{msg}</p>}

      <div className="card">
        <h2 className="font-semibold mb-3">Add a doctor</h2>
        <form onSubmit={createDoctor} className="grid sm:grid-cols-2 gap-3">
          <div><label className="label">Name</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Email</label><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="label">Temp password</label><input className="input" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div><label className="label">Specialisation</label><input className="input" required value={form.specialisation} onChange={(e) => setForm({ ...form, specialisation: e.target.value })} /></div>
          <div><label className="label">Slot duration (min)</label><input className="input" type="number" value={form.slotDurationMin} onChange={(e) => setForm({ ...form, slotDurationMin: e.target.value })} /></div>
          <div className="sm:col-span-2">
            <label className="label">Working days</label>
            <div className="flex gap-2 flex-wrap">
              {DAYS.map((d, i) => (
                <button type="button" key={i} onClick={() => toggleDay(i)}
                  className={`btn-secondary !py-1 !px-3 ${form.workingHours.find((w) => w.day === i) ? "!bg-brand-500 !text-white" : ""}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <button className="btn-primary sm:col-span-2">Create doctor</button>
        </form>
      </div>

      <div className="space-y-3">
        {doctors.map((d) => (
          <div key={d.id} className="card">
            <p className="font-medium">Dr. {d.user.name} — {d.specialisation}</p>
            <p className="text-sm text-gray-500">{d.slotDurationMin} min slots · {d.user.email}</p>
            {d.leaves?.length > 0 && (
              <p className="text-sm text-gray-500 mt-1">On leave: {d.leaves.map((l) => l.date).join(", ")}</p>
            )}
            <div className="flex gap-2 mt-3">
              <input type="date" className="input max-w-[160px]" onChange={(e) => setLeaveForm({ ...leaveForm, [d.id]: { ...leaveForm[d.id], date: e.target.value } })} />
              <input className="input" placeholder="Reason (optional)" onChange={(e) => setLeaveForm({ ...leaveForm, [d.id]: { ...leaveForm[d.id], reason: e.target.value } })} />
              <button className="btn-secondary" onClick={() => markLeave(d.id)}>Mark leave</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
