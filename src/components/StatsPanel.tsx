import { Stats, BotInfo } from "../types";
import { Cpu, Layers, Play, AlertTriangle, Clock, Bot, ExternalLink, Activity, HardDrive } from "lucide-react";
import { formatBytes, formatDurationSeconds } from "../utils/formatters";

interface StatsPanelProps {
  stats: Stats | null;
  botInfo: BotInfo | null;
}

export default function StatsPanel({ stats, botInfo }: StatsPanelProps) {
  return (
    <div id="stats-panel" className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-8">
      {/* Bot Info Header Card */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm col-span-1 md:col-span-3 lg:col-span-2 flex flex-col justify-between">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs font-semibold tracking-wider uppercase text-neutral-400">Telegram Control Gateway</span>
            <h2 className="text-xl font-bold text-neutral-800 mt-1 flex items-center gap-2">
              <Bot className="w-5 h-5 text-blue-500 animate-pulse" />
              {botInfo?.result?.first_name || "Bot Dispatcher"}
            </h2>
            {botInfo?.result?.username && (
              <a
                href={`https://t.me/${botInfo.result.username}`}
                target="_blank"
                referrerPolicy="no-referrer"
                className="text-xs text-blue-600 font-medium hover:underline flex items-center gap-1 mt-1"
              >
                @{botInfo.result.username}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <span className="bg-green-50 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-green-200">
            Active Polling
          </span>
        </div>
        <p className="text-sm text-neutral-500 mt-3">
          Upload scripts directly to the bot on Telegram, or deploy through this web panel. All commands like start, stop, delete, and log viewing are synchronized in real-time.
        </p>
      </div>

      {/* Deploy Status Cards */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider uppercase text-neutral-400">Deployments</span>
          <Layers className="w-4 h-4 text-neutral-400" />
        </div>
        <div className="mt-4">
          <div className="text-3xl font-extrabold text-neutral-900">{stats?.totalBots ?? 0}</div>
          <div className="flex items-center gap-3 mt-2 text-xs font-medium flex-wrap">
            <span className="text-green-600 flex items-center gap-1">
              <Play className="w-3 h-3 fill-green-600" /> {stats?.activeBots ?? 0} running
            </span>
            <span className="text-amber-600 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {stats?.crashedBots ?? 0} crashed
            </span>
          </div>
          {stats?.processMetrics && (
            <div className="text-[11px] text-neutral-400 mt-2 font-mono flex items-center gap-1">
              <Activity className="w-3 h-3 text-emerald-500" />
              <span>{stats.processMetrics.activePids} live background PID{stats.processMetrics.activePids === 1 ? "" : "s"}</span>
            </div>
          )}
        </div>
      </div>

      {/* System Resources */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider uppercase text-neutral-400">RAM Allocation</span>
          <Cpu className="w-4 h-4 text-neutral-400" />
        </div>
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <div className="text-3xl font-extrabold text-neutral-900">
              {stats?.memoryUsage ? `${stats.memoryUsage.percentage}%` : "0%"}
            </div>
            {stats?.processMetrics?.totalBotMemoryMB !== undefined && (
              <span className="text-xs font-semibold text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded">
                Bots: {stats.processMetrics.totalBotMemoryMB} MB
              </span>
            )}
          </div>
          <div className="w-full bg-neutral-100 rounded-full h-1.5 mt-2">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${
                (stats?.memoryUsage?.percentage ?? 0) > 80 ? "bg-red-500" : "bg-blue-600"
              }`}
              style={{ width: `${stats?.memoryUsage?.percentage ?? 0}%` }}
            ></div>
          </div>
          <div className="text-[10px] text-neutral-400 mt-1 flex justify-between">
            <span>{stats?.memoryUsage ? formatBytes(stats.memoryUsage.used) : "0 MB"} used</span>
            <span>{stats?.memoryUsage ? formatBytes(stats.memoryUsage.total) : "8 GB"} total</span>
          </div>
        </div>
      </div>

      {/* Server Uptime */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm flex flex-col justify-between md:col-span-3 lg:col-span-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider uppercase text-neutral-400">Runner Uptime</span>
          <Clock className="w-4 h-4 text-neutral-400" />
        </div>
        <div className="mt-4">
          <div className="text-xl font-bold text-neutral-900 font-mono">
            {stats?.uptime ? formatDurationSeconds(stats.uptime) : "0s"}
          </div>
          <p className="text-xs text-neutral-400 mt-2">
            Host system continuously runs scripts in background threads.
          </p>
        </div>
      </div>
    </div>
  );
}
