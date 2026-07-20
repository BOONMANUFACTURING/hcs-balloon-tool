import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Key, CheckCircle2, Eye, EyeOff, Info, Zap } from "lucide-react";

export default function Settings() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [apiKey,    setApiKey]    = useState("");
  const [showKey,   setShowKey]   = useState(false);
  const [mode,      setMode]      = useState("normal");
  const [saved,     setSaved]     = useState(false);

  useEffect(() => {
    const key = localStorage.getItem("__HCS_OPENROUTER_KEY") || "";
    const m   = localStorage.getItem("__HCS_OPENROUTER_MODE") || "normal";
    setApiKey(key);
    setMode(m);
    if (key) (window as any).__HCS_OPENROUTER_KEY = key;
    (window as any).__HCS_OPENROUTER_MODE = m;
  }, []);

  function saveKey() {
    const trimmed = apiKey.trim();
    (window as any).__HCS_OPENROUTER_KEY   = trimmed;
    (window as any).__HCS_OPENROUTER_MODE  = mode;
    localStorage.setItem("__HCS_OPENROUTER_KEY",  trimmed);
    localStorage.setItem("__HCS_OPENROUTER_MODE", mode);
    setSaved(true);
    toast({ title: "Settings saved" });
    setTimeout(() => setSaved(false), 2000);
  }

  function clearKey() {
    (window as any).__HCS_OPENROUTER_KEY = "";
    localStorage.removeItem("__HCS_OPENROUTER_KEY");
    setApiKey("");
    toast({ title: "API key cleared" });
  }

  const hasKey   = !!apiKey.trim();
  const isMasked = !showKey && apiKey.length > 8;
  const displayKey = isMasked
    ? apiKey.slice(0, 8) + "•".repeat(Math.max(0, apiKey.length - 12)) + apiKey.slice(-4)
    : apiKey;

  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")} data-testid="button-back">
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        <div className="h-4 w-px bg-border" />
        <div>
          <h1 className="font-semibold text-foreground text-sm">Settings</h1>
          <p className="text-xs text-muted-foreground">HCS Balloon Tool configuration</p>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-6 py-10 space-y-6">

        {/* ── AI API Key ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Key className="w-4 h-4" />
              AI Settings (OpenRouter)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">

            <div className="flex items-start gap-2 bg-muted/50 border border-border rounded p-3">
              <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Your API key is stored locally on this PC only — it is never sent to any server except OpenRouter.</p>
                <p>
                  Get your free key at:{" "}
                  <a href="https://openrouter.ai/settings/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    openrouter.ai/settings/api-keys
                  </a>
                </p>
                <p>Without a key the tool runs in <strong>mock mode</strong> — balloons can still be placed manually.</p>
              </div>
            </div>

            {/* API Key input */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">OpenRouter API Key</label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={displayKey}
                  onChange={e => { if (showKey) setApiKey(e.target.value); }}
                  onFocus={() => setShowKey(true)}
                  placeholder="sk-or-v1-..."
                  className="text-xs font-mono flex-1"
                  data-testid="input-api-key"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="flex-shrink-0"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {/* Scan mode toggle */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Scan Mode</label>
              <div className="flex gap-2">
                {[
                  { value: "normal", label: "Normal", sub: "Nemotron Vision · Free · Fast" },
                  { value: "deep",   label: "Deep",   sub: "Gemma 4 31B · Free · Higher accuracy" },
                ].map(m => (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value)}
                    className={`flex-1 py-2.5 px-3 rounded border text-xs font-medium transition-colors text-left ${
                      mode === m.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-secondary"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Zap className="w-3 h-3" />
                      {m.label}
                    </div>
                    <p className={`text-[10px] ${mode === m.value ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {m.sub}
                    </p>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">Both modes run 2 scans and pick the best result.</p>
            </div>

            {/* Save / Clear */}
            <div className="flex gap-2">
              <Button
                className="flex-1 text-sm"
                onClick={saveKey}
                data-testid="button-save-key"
              >
                {saved ? <><CheckCircle2 className="w-4 h-4 mr-1" />Saved!</> : "Save Settings"}
              </Button>
              {hasKey && (
                <Button
                  variant="outline"
                  className="text-sm text-destructive border-destructive/50 hover:bg-destructive/10"
                  onClick={clearKey}
                  data-testid="button-clear-key"
                >
                  Clear Key
                </Button>
              )}
            </div>

            {/* Status */}
            {hasKey ? (
              <p className="text-xs text-green-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                API key active — AI extraction enabled ({mode === "normal" ? "Normal" : "Deep"} scan)
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No API key — tool is in mock mode</p>
            )}
          </CardContent>
        </Card>

        {/* ── About ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">About</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p><strong className="text-foreground">HCS Balloon Tool</strong> — v1.0</p>
            <p>Extracts AMAT FAI dimensions from engineering drawings using AI vision.</p>
            <p>Company: HCS Engineering Pte Ltd · Customer: Applied Materials (AMAT)</p>
            <div className="pt-2 border-t border-border space-y-1 text-[10px]">
              <p>Col B = Row Type (NOTE / DIMENSION)</p>
              <p>Col D = Description (e.g. 3X DIAMETER, WELDING AND GRIND FLUSH)</p>
              <p>Col F = GD&amp;T Type (POSITION, ANGULARITY, DIAMETER...)</p>
              <p>Col G = Nominal Value (numeric or "In Compliance")</p>
              <p>Col H/I = Tolerance (from session tolerance table)</p>
              <p>Col L = Tool (CMM / Caliper / Visual / Welding Gage)</p>
              <p>Col N = FIR / PQR (session-level setting)</p>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
