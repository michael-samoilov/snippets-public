"use client";

import { useEffect, useRef, useState } from "react";

export function DebugOverlay() {
  const [logs, setLogs] = useState<Array<{ time: string; msg: string }>>([]);
  const [isOpen, setIsOpen] = useState(false);
  const logsRef = useRef<Array<{ time: string; msg: string }>>([]);

  useEffect(() => {
    // Intercept console.log to capture service worker logs
    const originalLog = console.log;
    console.log = (...args) => {
      const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (msg.includes("[SW")) {
        const time = new Date().toLocaleTimeString();
        logsRef.current.push({ time, msg });
        setLogs([...logsRef.current]);
      }
      originalLog(...args);
    };

    return () => {
      console.log = originalLog;
    };
  }, []);

  if (!logs.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999]">
      {isOpen && (
        <div className="bg-black text-white rounded p-3 max-w-sm max-h-64 overflow-y-auto font-mono text-xs mb-2 border border-gray-600">
          {logs.map((log, i) => (
            <div key={i} className="py-1 border-b border-gray-700 last:border-b-0">
              <span className="text-gray-500">{log.time}</span> {log.msg}
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-xs font-mono"
        >
          {isOpen ? "Hide" : "Logs"}
        </button>
        <button
          onClick={() => {
            const text = logs.map((l) => `${l.time} ${l.msg}`).join("\n");
            navigator.clipboard.writeText(text);
            alert("Logs copied to clipboard");
          }}
          className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded text-xs font-mono"
        >
          Copy
        </button>
        <button
          onClick={() => {
            logsRef.current = [];
            setLogs([]);
          }}
          className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded text-xs font-mono"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
