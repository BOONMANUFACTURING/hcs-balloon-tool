import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Key, CheckCircle2, Eye, EyeOff, Info } from "lucide-react";

export default function Settings() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load from localStorage and sync to in-memory global
  useEffect(() => {
    const stored = localStorage.getItem("hcs_openai_key") || "";
    if (stored) (window as any).__HCS_OPENAI_KEY = stored;
    const existing = (window as any).__HCS_OPENAI_KEY || "";
    setApiKey(existing);
  }, []);

  function saveKey() {
    const trimmed = apiKey.trim();
    (window as any).__HCS_OPENAI_KEY = trimmed;
    localStorage.setItem("hcs_openai_key", trimmed);
    setSaved(true);
    toast({ title: "API key saved" });
    setTimeout(() => setSaved(false), 2000);
  }

  function clearKey() {
    (window as any).__HCS_OPENAI_KEY = "";
    localStorage.removeItem("hcs_openai_key");
    setApiKey("");
    toast({ title: "API key cleared" });
  }

  const isMasked = !showKey && apiKey.length > 8;
  const displayKey = isMasked ? apiKey.slice(0, 4) + "•".repeat(apiKey.length - 8) + apiKey.slice(-4) : apiKey;

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

        {/* OpenAI API Key */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Key className="w-4 h-4" />
              OpenAI API Key
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 bg-muted/50 border border-border rounded p-3">
              <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Your API key is stored in memory for this browser session only — it is never sent to any server except OpenAI directly via the extraction endpoint.</p>
                <p>To get an API key: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">platform.openai.com/api-keys</a></p>
                <p>Without a key, the tool runs in <strong>mock mode</strong> — balloons can still be placed and edited manually.</p>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">API Key (starts with sk-...)</label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={displayKey}
                  onChange={e => { if (showKey) setApiKey(e.target.value); }}
                  onFocus={() => setShowKey(true)}
                  placeholder="sk-..."
                  className="text-xs font-mono"
                  data-testid="input-api-key"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="flex-shrink-0"
                  onClick={() => setShowKey(!showKey)}
                  data-testid="button-toggle-key-visibility"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1 text-sm"
                onClick={saveKey}
                disabled={!apiKey.trim()}
                data-testid="button-save-key"
              >
                {saved ? (
                  <><CheckCircle2 className="w-4 h-4 mr-1" />Saved!</>
                ) : (
                  "Save Key"
                )}
              </Button>
              {apiKey && (
                <Button
                  variant="outline"
                  className="text-sm text-destructive border-destructive/50 hover:bg-destructive/10"
                  onClick={clearKey}
                  data-testid="button-clear-key"
                >
                  Clear
                </Button>
              )}
            </div>

            {(window as any).__HCS_OPENAI_KEY ? (
              <p className="text-xs text-green-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                API key is active — GPT-4o Vision extraction enabled
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No API key — tool is in mock mode</p>
            )}
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">About</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p><strong className="text-foreground">HCS Balloon Tool</strong> — Trial Version</p>
            <p>Extracts AMAT FAI dimensions from engineering drawings using GPT-4o Vision.</p>
            <p>Company: HCS Engineering Pte Ltd · Customer: Applied Materials (AMAT)</p>
            <div className="pt-2 border-t border-border space-y-1 text-[10px]">
              <p>Col B = Row Type (NOTE / DIMENSION)</p>
              <p>Col D = Description (e.g. 3X DIAMETER, WELDING AND GRIND FLUSH)</p>
              <p>Col F = GD&amp;T Type (POSITION, ANGULARITY, DIAMETER...)</p>
              <p>Col G = Nominal Value (numeric or "In Compliance")</p>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
