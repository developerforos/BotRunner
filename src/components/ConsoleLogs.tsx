import { useState, useEffect, useRef } from "react";
import { Bot } from "../types";
import { X, Terminal, Copy, Download, RefreshCw, Check } from "lucide-react";

interface ConsoleLogsProps {
  bot: Bot;
  onClose: () => void;
}

export default function ConsoleLogs({ bot, onClose }: ConsoleLogsProps) {
  const [logs, setLogs] = useState("[System] Connecting to shell socket...");
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [copied, setCopied] = useState(false);
  const logContainerRef = useRef<HTMLPreElement>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bots/${bot.id}/logs`);
      if (!res.ok) throw new Error("Failed to read bot logs");
      const data = await res.json();
      setLogs(data.logs || "[System] Process idle. No console output recorded.");
    } catch (e: any) {
      setLogs(`[System Error] Failed to stream logs: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();

    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 2500);
    return () => clearInterval(interval);
  }, [bot.id, autoRefresh]);

  // Scroll to bottom when logs update
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleCopy = () => {
    navigator.clipboard.writeText(logs);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([logs], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bot.name.replace(/\s+/g, "_").toLowerCase()}_console.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm z-50 flex justify-end">
      <div className="bg-neutral-950 border-l border-neutral-800 w-full max-w-xl flex flex-col h-full shadow-2xl relative">
        
        {/* Console Header */}
        <div className="p-4 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-500" />
            <h4 className="text-sm font-bold text-neutral-200">
              Terminal stdout: <span className="text-neutral-400 font-mono font-normal">{bot.name}</span>
            </h4>
            {loading && <RefreshCw className="w-3 h-3 text-emerald-500 animate-spin ml-2" />}
          </div>
          
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-neutral-400 mr-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-neutral-700 bg-neutral-800 text-emerald-500 focus:ring-0 focus:ring-offset-0"
              />
              Auto-tail
            </label>

            <button
              onClick={handleCopy}
              className="text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 p-1.5 rounded-lg transition-colors flex items-center gap-1"
              title="Copy Output"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[10px] text-emerald-400">Copied</span>
                </>
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              onClick={handleDownload}
              className="text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 p-1.5 rounded-lg transition-colors"
              title="Download Log File"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 p-1.5 rounded-lg transition-colors"
              title="Close Drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Console logs viewport */}
        <pre
          ref={logContainerRef}
          className="p-5 flex-1 overflow-auto text-xs font-mono text-emerald-400 bg-neutral-950 space-y-1 selection:bg-emerald-800 selection:text-white"
        >
          {logs}
        </pre>

        {/* Console footer */}
        <div className="p-3 bg-neutral-900 border-t border-neutral-800 text-[10px] text-neutral-500 flex justify-between">
          <span>Language: {bot.language === "python" ? "Python 3" : "Node.js"}</span>
          <span>Buffer: Last 200 lines</span>
        </div>

      </div>
    </div>
  );
}
