import React, { useEffect, useState } from "react";
import api from "../../api/client.js";

const STATUS_COLORS = {
  SENT: "bg-green-100 text-green-800",
  PENDING: "bg-amber-100 text-amber-800",
  FAILED: "bg-red-100 text-red-800",
  ABANDONED: "bg-gray-200 text-gray-700",
};

export default function Notifications() {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    api.get("/admin/notifications").then(({ data }) => setLogs(data));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Notification Delivery</h1>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Recipient</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Retries</th>
              <th className="py-2 pr-3">Last error</th>
              <th className="py-2 pr-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="py-2 pr-3">{l.type}</td>
                <td className="py-2 pr-3">{l.recipient}</td>
                <td className="py-2 pr-3"><span className={`badge ${STATUS_COLORS[l.status]}`}>{l.status}</span></td>
                <td className="py-2 pr-3">{l.retryCount}/{l.maxRetries}</td>
                <td className="py-2 pr-3 text-red-600 max-w-xs truncate">{l.lastError}</td>
                <td className="py-2 pr-3 text-gray-400">{new Date(l.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && <p className="text-sm text-gray-500 mt-2">No notifications yet.</p>}
      </div>
    </div>
  );
}
