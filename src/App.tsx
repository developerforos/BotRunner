import { useState, useEffect } from "react";
import { Bot, Stats, BotInfo } from "./types";
import StatsPanel from "./components/StatsPanel";
import UploadZone from "./components/UploadZone";
import BotCard from "./components/BotCard";
import BotConfigModal from "./components/BotConfigModal";
import ConsoleLogs from "./components/ConsoleLogs";
import RenderDeployModal from "./components/RenderDeployModal";
import { Terminal, Search, Bot as BotIcon, RefreshCw, Layers, Cloud } from "lucide-react";

export default function App() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  
  // Modals state
  const [activeLogsBot, setActiveLogsBot] = useState<Bot | null>(null);
  const [activeConfigBot, setActiveConfigBot] = useState<Bot | null>(null);
  const [isRenderModalOpen, setIsRenderModalOpen] = useState(false);

  const safeFetchJson = async <T,>(url: string, timeoutMs = 5000): Promise<T | null> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        return (await res.json()) as T;
      }
      return null;
    } catch {
      return null;
    }
  };

  const fetchDashboardData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [botsData, statsData, infoData] = await Promise.all([
        safeFetchJson<Bot[]>("/api/bots"),
        safeFetchJson<Stats>("/api/stats"),
        safeFetchJson<BotInfo>("/api/bot-info"),
      ]);

      if (botsData) setBots(botsData);
      if (statsData) setStats(statsData);
      if (infoData) setBotInfo(infoData);
    } catch {
      // Gracefully retain existing state on temporary network jitter
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    // Continuous background synchronization (live state sync)
    const interval = setInterval(() => fetchDashboardData(true), 4000);
    return () => clearInterval(interval);
  }, []);

  const handleActionCompleted = () => {
    fetchDashboardData(true);
  };

  const filteredBots = bots.filter((b) => {
    const q = searchQuery.toLowerCase();
    return b.name.toLowerCase().includes(q) || b.filename.toLowerCase().includes(q) || b.language.includes(q);
  });

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-800 flex flex-col font-sans selection:bg-blue-100 selection:text-blue-900">
      
      {/* Visual Navigation Banner */}
      <header className="bg-white border-b border-neutral-200 py-4 px-6 md:px-12 flex items-center justify-between sticky top-0 z-40 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 text-white p-2 rounded-lg flex items-center justify-center border border-blue-700 shadow-sm">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-neutral-900 leading-tight">
              BotRunner <span className="font-medium text-neutral-400">Hub</span>
            </h1>
            <p className="text-[11px] text-neutral-400 font-medium">Automatic Script Engine & Telegram Bot Controller</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsRenderModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-all active:scale-98"
          >
            <Cloud className="w-3.5 h-3.5" />
            Render Web Service
          </button>

          <button
            onClick={() => fetchDashboardData()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-neutral-200 text-neutral-600 rounded-lg text-xs font-semibold hover:bg-neutral-50 active:bg-neutral-100 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Sync Node
          </button>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-8 md:px-8 space-y-8">
        
        {/* Real-time statistics banner */}
        <StatsPanel stats={stats} botInfo={botInfo} />

        {/* Deploy Upload Area */}
        <UploadZone onUploadSuccess={handleActionCompleted} />

        {/* Filter controls & lists */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-neutral-400" />
                Active Workspaces ({filteredBots.length})
              </h3>
              <p className="text-xs text-neutral-400 mt-0.5">
                Manage, pause, or view production terminal logs for each background running process.
              </p>
            </div>

            {/* Keyword Search Input */}
            <div className="relative max-w-sm w-full">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search bot name, filename, language..."
                className="w-full bg-white border border-neutral-200 rounded-lg pl-9 pr-4 py-2 text-xs text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {filteredBots.length === 0 ? (
            <div className="bg-white border border-neutral-200 rounded-xl py-12 px-4 text-center">
              <div className="bg-neutral-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                <BotIcon className="w-6 h-6 text-neutral-400" />
              </div>
              <h4 className="text-sm font-semibold text-neutral-700">No matching scripts found</h4>
              <p className="text-xs text-neutral-400 mt-1 max-w-xs mx-auto">
                No active scripts matched your search criteria, or no files have been deployed yet. Try dragging files here or sending them to your Telegram Bot!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredBots.map((bot) => (
                <BotCard
                  key={bot.id}
                  bot={bot}
                  onAction={handleActionCompleted}
                  onViewLogs={(b) => setActiveLogsBot(b)}
                  onConfigEnv={(b) => setActiveConfigBot(b)}
                />
              ))}
            </div>
          )}
        </section>

      </main>

      {/* Retro styled terminal logs */}
      {activeLogsBot && (
        <ConsoleLogs
          bot={activeLogsBot}
          onClose={() => setActiveLogsBot(null)}
        />
      )}

      {/* Configuration modal */}
      {activeConfigBot && (
        <BotConfigModal
          bot={activeConfigBot}
          onClose={() => setActiveConfigBot(null)}
          onSave={handleActionCompleted}
        />
      )}

      {/* Render Web Service Deployment modal */}
      <RenderDeployModal
        isOpen={isRenderModalOpen}
        onClose={() => setIsRenderModalOpen(false)}
      />

      {/* Elegant footer */}
      <footer className="bg-white border-t border-neutral-200 py-6 px-4 text-center text-xs text-neutral-400 mt-12">
        <p>© 2026 BotRunner Hub. Automatically compiling, launching, and managing isolated scripts in background sub-shells.</p>
      </footer>

    </div>
  );
}
