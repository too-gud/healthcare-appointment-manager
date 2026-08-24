import React, { useEffect, useState } from "react";
import api from "../../api/client.js";
import UrgencyBadge from "../../components/UrgencyBadge.jsx";

export default function Schedule() {
  const [appts, setAppts] = useState([]);
  const [open, setOpen] = useState(null); // appointment id being annotated
  const [notes, setNotes] = useState("");
  const [prescription, setPrescription] = useState([{ medication: "", dosage: "", frequencyPerDay: 1, durationDays: 5 }]);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState("");

  async function load() {
    const { data } = await api.get("/appointments");
    setAppts(data.filter((a) => a.status === "BOOKED" || a.status === "COMPLETED"));
  }
  useEffect(() => { load(); }, []);

  function addRow() {
    setPrescription([...prescription, { medication: "", dosage: "", frequencyPerDay: 1, durationDays: 5 }]);
  }
  function updateRow(i, field, value) {
    const next = [...prescription];
    next[i][field] = value;
    setPrescription(next);
  }

  async function submitPostvisit(id) {
    setBusy(true);
    setWarning("");
    try {
      const cleanPrescription = prescription
        .filter((p) => p.medication.trim())
        .map((p) => ({ ...p, frequencyPerDay: Number(p.frequencyPerDay), durationDays: Number(p.durationDays) }));
      const { data } = await api.post(`/appointments/${id}/postvisit`, { notes, prescription: cleanPrescription });
      if (data.llmWarning) setWarning(data.llmWarning);
      setOpen(null);
      setNotes("");
      setPrescription([{ medication: "", dosage: "", frequencyPerDay: 1, durationDays: 5 }]);
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My Schedule</h1>
      {warning && <p className="text-sm text-amber-600">⚠ {warning}</p>}
      {appts.map((a) => (
        <div key={a.id} className="card">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-medium">{a.patient.name}</p>
              <p className="text-sm text-gray-500">{new Date(a.slotStart).toLocaleString()}</p>
            </div>
            <span className="badge bg-blue-100 text-blue-800">{a.status}</span>
          </div>

          {a.previsitSummary && (
            <div className="bg-gray-50 rounded-lg p-3 mt-3 text-sm space-y-1">
              <div className="flex items-center gap-2">
                <strong>Urgency:</strong> <UrgencyBadge level={a.previsitSummary.urgency} />
              </div>
              <p><strong>Chief complaint:</strong> {a.previsitSummary.chiefComplaint}</p>
              {a.previsitSummary.suggestedQuestions?.length > 0 && (
                <div>
                  <strong>Suggested questions:</strong>
                  <ul className="list-disc list-inside">
                    {a.previsitSummary.suggestedQuestions.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-gray-400 italic">Raw symptoms: {a.symptomsText}</p>
            </div>
          )}

          {a.status === "BOOKED" && open !== a.id && (
            <button className="btn-primary mt-3 !py-1 !px-3" onClick={() => setOpen(a.id)}>Add visit notes</button>
          )}

          {open === a.id && (
            <div className="mt-4 space-y-3 border-t pt-4">
              <div>
                <label className="label">Clinical notes</label>
                <textarea className="input min-h-[100px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div>
                <label className="label">Prescription</label>
                {prescription.map((p, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 mb-2">
                    <input className="input" placeholder="Medication" value={p.medication} onChange={(e) => updateRow(i, "medication", e.target.value)} />
                    <input className="input" placeholder="Dosage (e.g. 500mg)" value={p.dosage} onChange={(e) => updateRow(i, "dosage", e.target.value)} />
                    <input className="input" type="number" min="1" max="6" placeholder="Times/day" value={p.frequencyPerDay} onChange={(e) => updateRow(i, "frequencyPerDay", e.target.value)} />
                    <input className="input" type="number" min="1" max="90" placeholder="Duration (days)" value={p.durationDays} onChange={(e) => updateRow(i, "durationDays", e.target.value)} />
                  </div>
                ))}
                <button className="btn-secondary !py-1 !px-3" onClick={addRow}>+ Add medication</button>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={busy} onClick={() => submitPostvisit(a.id)}>
                  {busy ? "Saving…" : "Complete visit & notify patient"}
                </button>
                <button className="btn-secondary" onClick={() => setOpen(null)}>Cancel</button>
              </div>
            </div>
          )}

          {a.postvisitSummary && (
            <div className="bg-green-50 rounded-lg p-3 mt-3 text-sm">
              <p className="font-medium">Post-visit summary sent to patient</p>
              <p>{a.postvisitSummary.summary}</p>
            </div>
          )}
        </div>
      ))}
      {appts.length === 0 && <p className="text-sm text-gray-500">No appointments.</p>}
    </div>
  );
}
