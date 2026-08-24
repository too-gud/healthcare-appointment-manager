import React from "react";

const COLORS = {
  Low: "bg-green-100 text-green-800",
  Medium: "bg-amber-100 text-amber-800",
  High: "bg-red-100 text-red-800",
};

export default function UrgencyBadge({ level }) {
  return <span className={`badge ${COLORS[level] || "bg-gray-100 text-gray-700"}`}>{level || "Unknown"}</span>;
}
