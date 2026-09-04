import { useState, useEffect } from "react";
import { Bot } from "../types";
import { X, Key, Trash2, Plus, Loader2 } from "lucide-react";

interface BotConfigModalProps {
  bot: Bot;
  onClose: () => void;
  onSave: () => void;
}

export default function BotConfigModal({ bot, onClose, onSave }: BotConfigModalProps) {
  const [envList, setEnvList] = useState<{ key: string; value: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bot.env) {
      const parsed = Object.entries(bot.env).map(([key, value]) => ({
        key,
        value,
      }));
      setEnvList(parsed);
    } else {
      setEnvList([]);
    }
  }, [bot]);

  const handleAddRow = () => {
    setEnvList([...envList, { key: "", value: "" }]);
  };

  const handleRemoveRow = (index: number) => {
    setEnvList(envList.filter((_, idx) => idx !== index));
  };

  const handleFieldChange = (index: number, field: "key" | "value", text: string) => {
    const updated = [...envList];
    updated[index][field] = text;
    setEnvList(updated);
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);

    // Build environment object
    const finalEnv: Record<string, string> = {};
    for (const item of envList) {
      const k = item.key.trim().toUpperCase();
      const v = item.value.trim();
      if (k) {
        finalEnv[k] = v;
      }
    }

    try {
      const res = await fetch(`/api/bots/${bot.id}/env`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env: finalEnv }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to update configuration");
      }

      onSave();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-neutral-200 rounded-xl max-w-lg w-full shadow-xl flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="p-4.5 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-blue-500" />
            <h4 className="text-base font-bold text-neutral-800">
              Configure Environment: <span className="font-semibold text-neutral-500">{bot.name}</span>
            </h4>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scroll Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <p className="text-xs text-neutral-500">
            Define environment variables that will be injected into your Python or Node.js environment during start up. Use keys like <code className="bg-neutral-50 px-1 border rounded text-neutral-600 font-mono">TELEGRAM_BOT_TOKEN</code>.
          </p>

          {error && (
            <div className="bg-red-50 text-red-700 text-xs p-3 rounded-lg border border-red-200">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
              <div className="col-span-5">Variable Key</div>
              <div className="col-span-6">Injected Value</div>
              <div className="col-span-1"></div>
            </div>

            {envList.length === 0 ? (
              <div className="text-center py-8 text-neutral-400 text-xs italic">
                No environment variables specified. Values fallback to global system scope.
              </div>
            ) : (
              envList.map((row, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-5">
                    <input
                      type="text"
                      placeholder="KEY_NAME"
                      className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs text-neutral-800 font-mono uppercase focus:outline-none focus:border-blue-500"
                      value={row.key}
                      onChange={(e) => handleFieldChange(index, "key", e.target.value)}
                      disabled={saving}
                    />
                  </div>
                  <div className="col-span-6">
                    <input
                      type="text"
                      placeholder="Value"
                      className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs text-neutral-800 font-mono focus:outline-none focus:border-blue-500"
                      value={row.value}
                      onChange={(e) => handleFieldChange(index, "value", e.target.value)}
                      disabled={saving}
                    />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <button
                      onClick={() => handleRemoveRow(index)}
                      className="text-neutral-400 hover:text-red-500 p-1 rounded-lg transition-colors"
                      disabled={saving}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={handleAddRow}
            className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-bold mt-2"
            disabled={saving}
          >
            <Plus className="w-3.5 h-3.5" />
            Add Environment Variable
          </button>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-neutral-50 border-t border-neutral-100 flex items-center justify-end gap-3 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-neutral-200 text-neutral-600 rounded-lg text-xs font-semibold hover:bg-neutral-100 transition-colors"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
            disabled={saving}
          >
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            Save Configuration
          </button>
        </div>

      </div>
    </div>
  );
}
