import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Plus, Trash2, Settings, Upload,
  FolderOpen, Search, Clock, CheckCircle2, AlertCircle
} from "lucide-react";
import type { Session } from "@shared/schema";

function timeAgo(date: string | Date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)   return "Just now";
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

export default function Home() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sessionName, setSessionName] = useState("");
  const [partNumber, setPartNumber]   = useState("");
  const [uploading, setUploading]     = useState(false);
  const [search, setSearch]           = useState("");
  const [showNew, setShowNew]         = useState(false);

  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ["/api/sessions"],
    queryFn: () => apiRequest("GET", "/api/sessions").then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/sessions"] }),
  });

  async function handleUpload(file: File) {
    if (!sessionName.trim()) {
      toast({ title: "Please enter a session name first", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("pdf", file);
      form.append("name", sessionName.trim());
      form.append("partNumber", partNumber.trim());
      const res     = await fetch("/api/sessions/upload", { method: "POST", body: form });
      const session = await res.json();
      if (!res.ok) throw new Error(session.error || "Upload failed");
      qc.invalidateQueries({ queryKey: ["/api/sessions"] });
      navigate(`/session/${session.id}`);
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  // API key status
  const hasApiKey = !!(localStorage.getItem("__HCS_OPENROUTER_KEY") || "").trim();

  // Filter sessions
  const filtered = sessions.filter(s =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.pdfFileName || "").toLowerCase().includes(search.toLowerCase())
  );

  const recent = filtered.slice(0, 5);
  const older  = filtered.slice(5);

  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* ── Header ── */}
      <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
            <FileText className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-semibold text-foreground text-sm">HCS Balloon Tool</h1>
            <p className="text-xs text-muted-foreground">AMAT FAI Extraction · HCS Engineering Pte Ltd</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* API key status badge */}
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${
            hasApiKey
              ? "border-green-400 text-green-700 bg-green-50"
              : "border-amber-400 text-amber-700 bg-amber-50"
          }`}>
            {hasApiKey
              ? <><CheckCircle2 className="w-3 h-3" /> AI Ready</>
              : <><AlertCircle className="w-3 h-3" /> No API Key</>}
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/settings")} data-testid="button-settings">
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
        </div>
      </header>

      <div className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 space-y-6">

        {/* ── Stats row ── */}
        {sessions.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="py-4 px-5">
                <p className="text-2xl font-bold text-foreground">{sessions.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total Sessions</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4 px-5">
                <p className="text-2xl font-bold text-foreground">
                  {sessions.filter(s => {
                    const d = Date.now() - new Date(s.updatedAt).getTime();
                    return d < 7 * 86400000;
                  }).length}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">This Week</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4 px-5">
                <p className="text-2xl font-bold text-foreground">
                  {sessions[0] ? timeAgo(sessions[0].updatedAt) : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Last Activity</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── New session button / form ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {showNew ? "New Drawing Session" : "Start a New Session"}
            </h2>
            <Button size="sm" onClick={() => setShowNew(!showNew)} data-testid="button-new-session">
              <Plus className="w-4 h-4 mr-1" />
              {showNew ? "Cancel" : "New Session"}
            </Button>
          </div>

          {showNew && (
            <Card>
              <CardContent className="pt-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Session Name *</label>
                    <Input
                      placeholder="e.g. 0041-37744-16 Rev16"
                      value={sessionName}
                      onChange={e => setSessionName(e.target.value)}
                      data-testid="input-session-name"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Part Number (optional)</label>
                    <Input
                      placeholder="e.g. 0041-37744"
                      value={partNumber}
                      onChange={e => setPartNumber(e.target.value)}
                      data-testid="input-part-number"
                    />
                  </div>
                </div>

                <div
                  className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
                  data-testid="drop-zone"
                >
                  <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Drag & drop PDF here, or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF files only · Max 100MB</p>
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
                  data-testid="input-file"
                />

                {uploading && (
                  <div className="text-xs text-muted-foreground text-center animate-pulse">
                    Uploading PDF, please wait...
                  </div>
                )}

                {!hasApiKey && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded p-3">
                    <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700">
                      No API key set — AI extraction will run in mock mode.{" "}
                      <button onClick={() => navigate("/settings")} className="underline font-medium">
                        Go to Settings
                      </button>{" "}
                      to add your OpenRouter key.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Session history ── */}
        {sessions.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1">
                Session History
              </h2>
              {/* Search */}
              <div className="relative w-56">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search sessions..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
            </div>

            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">No sessions match your search.</p>
            )}

            {/* Recent (top 5) */}
            {recent.map((s, i) => (
              <SessionRow
                key={s.id}
                session={s}
                isRecent={i < 3}
                onOpen={() => navigate(`/session/${s.id}`)}
                onDelete={() => deleteMutation.mutate(s.id)}
              />
            ))}

            {/* Older sessions collapsible */}
            {older.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 py-1 select-none list-none">
                  <Clock className="w-3.5 h-3.5" />
                  Show {older.length} older session{older.length > 1 ? "s" : ""}
                </summary>
                <div className="mt-2 space-y-2">
                  {older.map(s => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      isRecent={false}
                      onOpen={() => navigate(`/session/${s.id}`)}
                      onDelete={() => deleteMutation.mutate(s.id)}
                    />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* ── Empty state ── */}
        {sessions.length === 0 && !showNew && (
          <div className="text-center py-16 space-y-3">
            <FolderOpen className="w-10 h-10 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No sessions yet</p>
            <p className="text-xs text-muted-foreground">Click "New Session" above to upload your first drawing</p>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Session row component ──
function SessionRow({
  session, isRecent, onOpen, onDelete
}: {
  session: Session;
  isRecent: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <Card
      className={`hover:border-primary transition-colors cursor-pointer ${isRecent ? "" : "opacity-80"}`}
      onClick={onOpen}
      data-testid={`card-session-${session.id}`}
    >
      <CardContent className="py-3 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
            <FolderOpen className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{session.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {session.pdfFileName}
              {session.partNumber ? ` · ${session.partNumber}` : ""}
              {" · "}
              {timeAgo(session.updatedAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-3"
            onClick={e => { e.stopPropagation(); onOpen(); }}
          >
            Open
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7"
            onClick={e => { e.stopPropagation(); onDelete(); }}
            data-testid={`button-delete-session-${session.id}`}
          >
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
