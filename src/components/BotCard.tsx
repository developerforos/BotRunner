import React, { useState, useEffect } from "react";
import { Bot } from "../types";
import { Play, Square, Trash2, Settings, Terminal, Calendar, Code, AlertTriangle, CheckCircle2, Clock, Activity, Cpu } from "lucide-react";
import { formatDurationSeconds } from "../utils/formatters";

interface BotCardProps {
  key?: any;
  bot: Bot;
  onAction: () => void;
  onViewLogs: (bot: Bot) => void;
  onConfigEnv: (bot: Bot) => void;
}

export default function BotCard({ bot, onAction, onViewLogs, onConfigEnv }: BotCardProps) {
  const [uptimeStr, setUptimeStr] = useState("Offline");
  const [deployedTimeStr, setDeployedTimeStr] = useState("");
  const [loading, setLoading] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  useEffect(() => {
    const updateTimes = () => {
      const deploySecs = Math.max(0, Math.floor((Date.now() - new Date(bot.created).getTime()) / 1000));
      setDeployedTimeStr(formatDurationSeconds(deploySecs));

      if (bot.status === "running" && bot.uptime) {
        const sessionSecs = Math.max(0, Math.floor((Date.now() - bot.uptime) / 1000));
        setUptimeStr(formatDurationSeconds(sessionSecs));
      } else {
        setUptimeStr("Offline");
      }
    };

    updateTimes();
    const timer = setInterval(updateTimes, 1000);
    return () => clearInterval(timer);
  }, [bot.created, bot.status, bot.uptime]);

  const handleStart = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bots/${bot.id}/start`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to start process");
      onAction();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bots/${bot.id}/stop`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to stop process");
      onAction();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteDelete = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bots/${bot.id}/delete`, { method: "POST" });
      if (!res.ok) {
        const delRes = await fetch(`/api/bots/${bot.id}`, { method: "DELETE" });
        if (!delRes.ok) throw new Error("Failed to delete deployment");
      }
      setIsConfirmingDelete(false);
      onAction();
    } catch (e) {
      console.error("Delete failed:", e);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = () => {
    switch (bot.status) {
      case "running":
        return "bg-green-50 text-green-700 border-green-200";
      case "crashed":
        return "bg-red-50 text-red-700 border-red-200";
      default:
        return "bg-neutral-50 text-neutral-600 border-neutral-200";
    }
  };

  const getHealthBadge = () => {
    if (bot.status !== "running") {
      return (
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-neutral-50 text-neutral-500 border-neutral-200">
          Idle
        </span>
      );
    }

    switch (bot.health) {
      case "healthy":
        return (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            Healthy
          </span>
        );
      case "degraded":
        return (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            Degraded
          </span>
        );
      case "unhealthy":
        return (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
            Unhealthy
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-xl shadow-sm hover:shadow-md hover:border-neutral-300 transition-all p-5 flex flex-col justify-between">
      {/* Upper header section */}
      <div>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${
                bot.language === "python"
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
              }`}
            >
              {bot.language === "python" ? "🐍 Python" : "🟢 Node.js"}
            </span>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${getStatusColor()}`}>
              {bot.status === "running" ? "Running" : bot.status === "crashed" ? "Crashed" : "Stopped"}
            </span>
            {getHealthBadge()}
            {bot.ownerUsername && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-sky-50 text-sky-700 border-sky-200">
                👤 {bot.ownerUsername}
              </span>
            )}
          </div>

          {/* Delete action button */}
          <button
            onClick={() => setIsConfirmingDelete(!isConfirmingDelete)}
            className={`p-1.5 rounded-lg transition-colors ${
              isConfirmingDelete
                ? "text-red-600 bg-red-50"
                : "text-neutral-400 hover:text-red-500 hover:bg-neutral-50"
            }`}
            title="Delete bot deployment"
            disabled={loading}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Delete Confirmation Banner */}
        {isConfirmingDelete && (
          <div className="mb-3.5 p-3 bg-red-50/90 border border-red-200 rounded-lg flex flex-col gap-2 animate-in fade-in duration-150">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-red-800">
              <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
              Delete "{bot.name}" and erase workspace files?
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setIsConfirmingDelete(false)}
                disabled={loading}
                className="px-2.5 py-1 text-xs font-medium text-neutral-600 bg-white border border-neutral-200 hover:bg-neutral-50 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteDelete}
                disabled={loading}
                className="px-2.5 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors flex items-center gap-1 shadow-xs"
              >
                <Trash2 className="w-3 h-3" />
                {loading ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        )}

        <h4 className="text-base font-bold text-neutral-800 tracking-tight leading-snug hover:text-blue-600 transition-colors">
          {bot.name}
        </h4>
        
        {/* Entry path snippet */}
        <p className="text-xs text-neutral-400 flex items-center gap-1 mt-1 font-mono break-all">
          <Code className="w-3 h-3 text-neutral-300 shrink-0" />
          {bot.entryPoint}
        </p>

        {/* Process Metrics Pill */}
        {bot.status === "running" && (
          <div className="flex items-center gap-3 mt-3 px-2.5 py-1.5 rounded-lg bg-neutral-50 border border-neutral-100 text-xs text-neutral-600">
            <div className="flex items-center gap-1 font-mono">
              <span className="text-neutral-400 text-[10px]">PID:</span>
              <span className="font-semibold">{bot.pid || "Active"}</span>
            </div>
            <div className="h-3 w-px bg-neutral-200" />
            <div className="flex items-center gap-1 font-mono">
              <span className="text-neutral-400 text-[10px]">RAM:</span>
              <span className="font-semibold">{bot.memoryMB ? `${bot.memoryMB} MB` : "<1 MB"}</span>
            </div>
            {bot.restarts !== undefined && bot.restarts > 0 && (
              <>
                <div className="h-3 w-px bg-neutral-200" />
                <div className="flex items-center gap-1 font-mono text-amber-600">
                  <span className="text-[10px]">Restarts:</span>
                  <span className="font-semibold">{bot.restarts}</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Display Error Message if crashed */}
        {bot.status === "crashed" && bot.error && (
          <div className="bg-red-50/50 border border-red-100 rounded-lg p-2.5 mt-3 flex items-start gap-1.5 text-xs text-red-700">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{bot.error}</span>
          </div>
        )}

        {/* Info list */}
        <div className="grid grid-cols-2 gap-y-3 mt-4 pt-3.5 border-t border-neutral-100 text-xs">
          <div>
            <span className="text-neutral-400">Created:</span>
            <div className="text-neutral-700 mt-0.5 flex items-center gap-1">
              <Calendar className="w-3 h-3 text-neutral-400" />
              {new Date(bot.created).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </div>
          </div>
          <div>
            <span className="text-neutral-400">Uptime session:</span>
            <div className="text-neutral-700 mt-0.5 font-mono font-medium">
              {uptimeStr}
            </div>
          </div>
          <div className="col-span-2 border-t border-dashed border-neutral-100 pt-2 flex items-center justify-between">
            <span className="text-neutral-400">Total Deployment Time:</span>
            <div className="text-neutral-800 font-mono font-semibold flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              {deployedTimeStr}
            </div>
          </div>
        </div>

        {/* Auto-extracted dependencies list */}
        <div className="mt-4 pt-3.5 border-t border-neutral-100">
          <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider block mb-1.5">
            Imports & Dependencies
          </span>
          <div className="flex flex-wrap gap-1">
            {bot.dependencies && bot.dependencies.length > 0 ? (
              bot.dependencies.map((dep, idx) => (
                <span key={idx} className="bg-neutral-100 text-neutral-600 text-[10px] font-medium px-2 py-0.5 rounded-full">
                  {dep}
                </span>
              ))
            ) : (
              <span className="text-[11px] italic text-neutral-400">None detected</span>
            )}
          </div>
        </div>
      </div>

      {/* Primary Actions Grid */}
      <div className="grid grid-cols-3 gap-2 mt-5">
        {bot.status === "running" ? (
          <button
            onClick={handleStop}
            className="flex items-center justify-center gap-1.5 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-lg py-2 transition-colors border border-neutral-200"
            title="Stop Process"
            disabled={loading}
          >
            <Square className="w-3 h-3 fill-neutral-700 text-neutral-700" />
            Stop
          </button>
        ) : (
          <button
            onClick={handleStart}
            className="flex items-center justify-center gap-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 transition-colors border border-blue-700"
            title="Start Process"
            disabled={loading}
          >
            <Play className="w-3 h-3 fill-white text-white" />
            Start
          </button>
        )}

        <button
          onClick={() => onViewLogs(bot)}
          className="flex items-center justify-center gap-1.5 text-xs font-semibold bg-neutral-50 hover:bg-neutral-100 text-neutral-700 rounded-lg py-2 transition-colors border border-neutral-200"
          title="Terminal Logs"
          disabled={loading}
        >
          <Terminal className="w-3 h-3 text-neutral-500" />
          Logs
        </button>

        <button
          onClick={() => onConfigEnv(bot)}
          className="flex items-center justify-center gap-1.5 text-xs font-semibold bg-neutral-50 hover:bg-neutral-100 text-neutral-700 rounded-lg py-2 transition-colors border border-neutral-200"
          title="Config Environmental Variables"
          disabled={loading}
        >
          <Settings className="w-3 h-3 text-neutral-500" />
          Config
        </button>
      </div>
    </div>
  );
}
