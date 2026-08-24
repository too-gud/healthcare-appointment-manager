import React from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/client.js";

export default function Settings() {
  const [params] = useSearchParams();
  const status = params.get("calendar");

  async function connect() {
    const { data } = await api.get("/calendar/oauth/connect");
    window.location.href = data.url;
  }

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-semibold mb-4">Settings</h1>
      <div className="card">
        <p className="font-medium mb-1">Google Calendar</p>
        <p className="text-sm text-gray-500 mb-3">
          Connect your Google account so appointment events are added, updated, and removed automatically.
        </p>
        {status === "connected" && <p className="text-sm text-green-700 mb-2">✅ Connected successfully.</p>}
        {status === "error" && <p className="text-sm text-red-600 mb-2">Something went wrong connecting Google Calendar. Try again.</p>}
        <button className="btn-primary" onClick={connect}>Connect Google Calendar</button>
      </div>
    </div>
  );
}
