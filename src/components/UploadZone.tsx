import React, { useState, useRef } from "react";
import { UploadCloud, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

interface UploadZoneProps {
  onUploadSuccess: () => void;
}

export default function UploadZone({ onUploadSuccess }: UploadZoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const [customName, setCustomName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "py" && ext !== "js" && ext !== "ts") {
      setStatusMsg({
        type: "error",
        text: "Unsupported file format. Please upload a .py, .js, or .ts script file.",
      });
      return;
    }

    setUploading(true);
    setStatusMsg(null);

    const formData = new FormData();
    formData.append("file", file);
    if (customName.trim()) {
      formData.append("customName", customName.trim());
    }

    try {
      const res = await fetch("/api/bots/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setStatusMsg({
        type: "success",
        text: `Successfully deployed "${data.bot.name}"! Dynamic parser resolved dependencies and started background execution.`,
      });
      setCustomName("");
      onUploadSuccess();
    } catch (err: any) {
      console.error(err);
      setStatusMsg({
        type: "error",
        text: `Deployment error: ${err.message}`,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div id="upload-zone" className="bg-white border border-neutral-200 rounded-xl p-6 shadow-sm mb-8">
      <h3 className="text-lg font-bold text-neutral-800 mb-4">Deploy New Script</h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Input configuration */}
        <div className="lg:col-span-1 flex flex-col justify-between">
          <div>
            <label htmlFor="custom-bot-name" className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
              Friendly Display Name (Optional)
            </label>
            <input
              id="custom-bot-name"
              type="text"
              placeholder="e.g. Weather Bot"
              className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              disabled={uploading}
            />
            <p className="text-xs text-neutral-400 mt-2">
              If omitted, the script filename will be used as the deployment name.
            </p>
          </div>
          <div className="text-xs text-neutral-400 bg-neutral-50 border border-neutral-100 rounded-lg p-3 mt-4">
            💡 <strong>Automatic Installation:</strong> We extract and download npm/pip imports in an isolated folder.
          </div>
        </div>

        {/* Right Drag & Drop Zone */}
        <div className="lg:col-span-2">
          <form
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={triggerFileInput}
            className={`w-full h-44 rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${
              dragActive
                ? "border-blue-500 bg-blue-50/40 scale-[0.99]"
                : "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50/50"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleChange}
              className="hidden"
              accept=".py,.js,.ts"
              disabled={uploading}
            />
            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <p className="text-sm font-semibold text-neutral-700 animate-pulse">
                  Analyzing script & installing package modules...
                </p>
                <p className="text-xs text-neutral-400">
                  Please do not reload. Spawning isolated workspace thread.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center p-4">
                <UploadCloud className="w-10 h-10 text-neutral-400 mb-2" />
                <p className="text-sm font-semibold text-neutral-700">
                  Drag & Drop file here, or <span className="text-blue-600 hover:underline">browse files</span>
                </p>
                <p className="text-xs text-neutral-400 mt-1">
                  Supports .py (Python 3) or .js / .ts (Node.js ES Modules/CommonJS)
                </p>
              </div>
            )}
          </form>
        </div>
      </div>

      {statusMsg && (
        <div
          className={`mt-4 p-3.5 rounded-lg border text-sm flex items-start gap-2.5 transition-all ${
            statusMsg.type === "success"
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {statusMsg.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}
    </div>
  );
}
