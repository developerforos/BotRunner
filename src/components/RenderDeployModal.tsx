import { useState, useEffect } from "react";
import { 
  Cloud, 
  X, 
  Copy, 
  Check, 
  Download, 
  ExternalLink, 
  Terminal, 
  Server, 
  HardDrive, 
  Send, 
  ShieldCheck, 
  RefreshCw,
  Cpu,
  FileCode,
  Layers,
  Sparkles
} from "lucide-react";
import { RenderStatus, RenderConfig } from "../types";

interface RenderDeployModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function RenderDeployModal({ isOpen, onClose }: RenderDeployModalProps) {
  const [activeTab, setActiveTab] = useState<"blueprint" | "docker" | "guide" | "webhook">("blueprint");
  const [status, setStatus] = useState<RenderStatus | null>(null);
  const [config, setConfig] = useState<RenderConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Webhook trigger state
  const [webhookUrl, setWebhookUrl] = useState(() => localStorage.getItem("render_deploy_hook") || "");
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const fetchRenderData = async () => {
      setLoading(true);
      try {
        const [statusRes, configRes] = await Promise.all([
          fetch("/api/render/status").then((r) => r.json()),
          fetch("/api/render/config").then((r) => r.json()),
        ]);
        setStatus(statusRes);
        setConfig(configRes);
      } catch (e) {
        console.error("Failed to load Render config data:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchRenderData();
  }, [isOpen]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDownload = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleTriggerWebhook = async () => {
    if (!webhookUrl.trim()) return;
    setTriggering(true);
    setTriggerResult(null);
    localStorage.setItem("render_deploy_hook", webhookUrl.trim());

    try {
      const res = await fetch("/api/render/deploy-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: webhookUrl.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTriggerResult({ success: true, message: "Deploy hook triggered successfully! Render is building your service." });
      } else {
        setTriggerResult({ success: false, message: data.error || "Failed to trigger Render deployment." });
      }
    } catch (err: any) {
      setTriggerResult({ success: false, message: err.message || "Network error while connecting to Render." });
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white border border-neutral-200 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4.5 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 text-white flex items-center justify-center shadow-xs">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-neutral-900">Render Web Service Deployment</h2>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-800 rounded-full flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Production Ready
                </span>
              </div>
              <p className="text-xs text-neutral-500">
                Deploy BotRunner Hub to Render.com with persistent storage & 24/7 background bot execution.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/50 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Runtime Diagnostics Summary */}
        <div className="px-6 py-3 bg-neutral-900 text-white flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 text-neutral-300">
              <Server className="w-3.5 h-3.5 text-blue-400" />
              <span>Node.js: <strong className="text-white font-mono">{status?.nodeVersion || process.version}</strong></span>
            </div>
            <div className="flex items-center gap-1.5 text-neutral-300">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span>Python Engine: <strong className="text-white">{status?.pythonAvailable ? "Enabled" : "Auto-configured"}</strong></span>
            </div>
            <div className="flex items-center gap-1.5 text-neutral-300">
              <HardDrive className="w-3.5 h-3.5 text-amber-400" />
              <span>Disk Mount: <strong className="text-white font-mono">./deployments</strong></span>
            </div>
            <div className="flex items-center gap-1.5 text-neutral-300">
              <Terminal className="w-3.5 h-3.5 text-purple-400" />
              <span>Health Path: <strong className="text-white font-mono">/api/health</strong></span>
            </div>
          </div>

          <a
            href="https://dashboard.render.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-blue-300 hover:text-blue-200 flex items-center gap-1 ml-auto"
          >
            Open Render Dashboard <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center px-6 border-b border-neutral-200 bg-white gap-2 pt-2">
          <button
            onClick={() => setActiveTab("blueprint")}
            className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === "blueprint"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Render Blueprint (render.yaml)
          </button>
          <button
            onClick={() => setActiveTab("docker")}
            className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === "docker"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            Dockerfile (Dual Runtime)
          </button>
          <button
            onClick={() => setActiveTab("guide")}
            className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === "guide"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Step-by-Step Setup
          </button>
          <button
            onClick={() => setActiveTab("webhook")}
            className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === "webhook"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            Deploy Webhook Trigger
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-neutral-50/50 space-y-4">
          {/* TAB 1: BLUEPRINT */}
          {activeTab === "blueprint" && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between bg-blue-50/70 border border-blue-200/80 rounded-xl p-3.5">
                <div>
                  <h4 className="text-xs font-bold text-blue-950">1-Click Infrastructure Blueprint (`render.yaml`)</h4>
                  <p className="text-[11px] text-blue-700 mt-0.5">
                    Render Blueprint automatically configures the web service, build hooks, port, health check, and persistent volume.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyToClipboard(config?.renderYaml || "", "blueprint")}
                    className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 rounded-lg flex items-center gap-1.5 shadow-2xs transition-colors"
                  >
                    {copiedKey === "blueprint" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === "blueprint" ? "Copied" : "Copy YAML"}
                  </button>
                  <button
                    onClick={() => handleDownload("render.yaml", config?.renderYaml || "")}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5 shadow-2xs transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download render.yaml
                  </button>
                </div>
              </div>

              <div className="bg-neutral-900 rounded-xl p-4 text-neutral-100 font-mono text-xs overflow-x-auto border border-neutral-800 shadow-inner">
                <pre>{config?.renderYaml || "# Loading render.yaml configuration..."}</pre>
              </div>
            </div>
          )}

          {/* TAB 2: DOCKERFILE */}
          {activeTab === "docker" && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between bg-neutral-100 border border-neutral-200 rounded-xl p-3.5">
                <div>
                  <h4 className="text-xs font-bold text-neutral-900">Multi-Runtime Docker Container (`Dockerfile`)</h4>
                  <p className="text-[11px] text-neutral-600 mt-0.5">
                    Includes Node.js 22 LTS, Python 3, pip, venv, and build tools for running both Node and Python scripts concurrently.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyToClipboard(config?.dockerfile || "", "dockerfile")}
                    className="px-3 py-1.5 text-xs font-semibold text-neutral-700 bg-white border border-neutral-200 hover:bg-neutral-50 rounded-lg flex items-center gap-1.5 shadow-2xs transition-colors"
                  >
                    {copiedKey === "dockerfile" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === "dockerfile" ? "Copied" : "Copy Dockerfile"}
                  </button>
                  <button
                    onClick={() => handleDownload("Dockerfile", config?.dockerfile || "")}
                    className="px-3 py-1.5 text-xs font-semibold text-neutral-800 bg-neutral-200 hover:bg-neutral-300 rounded-lg flex items-center gap-1.5 shadow-2xs transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Dockerfile
                  </button>
                </div>
              </div>

              <div className="bg-neutral-900 rounded-xl p-4 text-neutral-100 font-mono text-xs overflow-x-auto border border-neutral-800 shadow-inner">
                <pre>{config?.dockerfile || "# Loading Dockerfile..."}</pre>
              </div>
            </div>
          )}

          {/* TAB 3: STEP BY STEP GUIDE */}
          {activeTab === "guide" && (
            <div className="space-y-4 animate-in fade-in duration-150 text-xs text-neutral-700">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Step 1 */}
                <div className="bg-white border border-neutral-200 p-4 rounded-xl shadow-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[10px]">1</span>
                    <h5 className="font-bold text-neutral-900">Push to GitHub / GitLab</h5>
                  </div>
                  <p className="text-neutral-500 leading-relaxed">
                    Export your project to GitHub or GitLab. The workspace root includes <code>render.yaml</code>, <code>render-build.sh</code>, and <code>Dockerfile</code>.
                  </p>
                </div>

                {/* Step 2 */}
                <div className="bg-white border border-neutral-200 p-4 rounded-xl shadow-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[10px]">2</span>
                    <h5 className="font-bold text-neutral-900">Create Web Service on Render</h5>
                  </div>
                  <p className="text-neutral-500 leading-relaxed">
                    In <a href="https://dashboard.render.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-semibold">Render Dashboard</a>, click <strong>New +</strong> &rarr; <strong>Blueprint</strong> (or <strong>Web Service</strong>) and link your repository.
                  </p>
                </div>

                {/* Step 3 */}
                <div className="bg-white border border-neutral-200 p-4 rounded-xl shadow-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[10px]">3</span>
                    <h5 className="font-bold text-neutral-900">Set Build & Start Commands</h5>
                  </div>
                  <div className="space-y-1.5 font-mono text-[11px] bg-neutral-50 p-2.5 rounded-lg border border-neutral-200">
                    <div className="flex items-center justify-between">
                      <div><strong className="text-neutral-700">Build:</strong> <code className="text-blue-600 font-bold">npm install --include=dev &amp;&amp; npm run build</code></div>
                      <button
                        onClick={() => copyToClipboard("npm install --include=dev && npm run build", "cmd_build")}
                        className="px-1.5 py-0.5 text-[10px] bg-white border border-neutral-200 hover:bg-neutral-100 rounded text-neutral-600 flex items-center gap-1"
                        title="Copy Build Command"
                      >
                        {copiedKey === "cmd_build" ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        {copiedKey === "cmd_build" ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div><strong className="text-neutral-700">Start:</strong> <code className="text-emerald-600 font-bold">npm run start</code></div>
                      <button
                        onClick={() => copyToClipboard("npm run start", "cmd_start")}
                        className="px-1.5 py-0.5 text-[10px] bg-white border border-neutral-200 hover:bg-neutral-100 rounded text-neutral-600 flex items-center gap-1"
                        title="Copy Start Command"
                      >
                        {copiedKey === "cmd_start" ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        {copiedKey === "cmd_start" ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <div><strong className="text-neutral-700">Health Check:</strong> <code>/api/health</code></div>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="bg-white border border-neutral-200 p-4 rounded-xl shadow-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[10px]">4</span>
                    <h5 className="font-bold text-neutral-900">Attach Persistent Disk (1 GB)</h5>
                  </div>
                  <p className="text-neutral-500 leading-relaxed">
                    Under <strong>Disks</strong> in Render, mount a 1GB disk to <code>/opt/render/project/src/deployments</code> (or <code>/app/deployments</code> for Docker) to preserve uploaded bots permanently.
                  </p>
                </div>

              </div>

              {/* Environment Variables Table */}
              <div className="bg-white border border-neutral-200 rounded-xl p-4 space-y-2 shadow-xs">
                <h5 className="font-bold text-neutral-900">Recommended Render Environment Variables</h5>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-neutral-200 text-neutral-400 font-semibold">
                        <th className="py-1.5">Variable Key</th>
                        <th className="py-1.5">Value / Example</th>
                        <th className="py-1.5">Required</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 font-mono text-[11px]">
                      <tr>
                        <td className="py-1.5 font-bold text-neutral-800">NODE_ENV</td>
                        <td className="py-1.5 text-neutral-600">production</td>
                        <td className="py-1.5 text-emerald-600 font-sans font-semibold">Yes</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 font-bold text-neutral-800">TELEGRAM_BOT_TOKEN</td>
                        <td className="py-1.5 text-neutral-600">8923444398:AAFlnI-...</td>
                        <td className="py-1.5 text-amber-600 font-sans font-semibold">Recommended</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 font-bold text-neutral-800">GEMINI_API_KEY</td>
                        <td className="py-1.5 text-neutral-600">AIzaSy...</td>
                        <td className="py-1.5 text-neutral-400 font-sans">Optional</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: DEPLOY WEBHOOK */}
          {activeTab === "webhook" && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="bg-white border border-neutral-200 p-5 rounded-xl shadow-xs space-y-3">
                <div>
                  <h4 className="text-xs font-bold text-neutral-900">Trigger Render Live Redeployment</h4>
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    Paste your Render Deploy Hook URL from your Render Web Service settings to trigger an instant cloud rebuild from this dashboard.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-neutral-700">Render Deploy Hook URL</label>
                  <input
                    type="url"
                    placeholder="https://api.render.com/deploy/srv-c0000000000000000000?key=abc123xyz"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  <p className="text-[10px] text-neutral-400">
                    Find this in Render Dashboard &rarr; Your Web Service &rarr; Settings &rarr; Deploy Hook.
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={handleTriggerWebhook}
                    disabled={triggering || !webhookUrl.trim()}
                    className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors"
                  >
                    {triggering ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    {triggering ? "Triggering Render..." : "Trigger Redeploy Now"}
                  </button>

                  {triggerResult && (
                    <div className={`text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1.5 ${
                      triggerResult.success
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                        : "bg-red-50 border-red-200 text-red-800"
                    }`}>
                      {triggerResult.success ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <X className="w-3.5 h-3.5 text-red-600" />}
                      <span>{triggerResult.message}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-neutral-100 bg-neutral-50 flex items-center justify-between text-xs text-neutral-500">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Render Web Service Compatibility: 100% Configured</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-900 text-white font-semibold rounded-lg transition-colors shadow-2xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
