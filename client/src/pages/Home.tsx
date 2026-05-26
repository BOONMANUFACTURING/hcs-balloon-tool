import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { FileText, Plus, Trash2, Settings, Upload, FolderOpen } from "lucide-react";
import type { Session } from "@shared/schema";

export default function Home() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sessionName, setSessionName] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [uploading, setUploading] = useState(false);

  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ["/api/sessions"],
    queryFn: () => apiRequest("GET", "/api/sessions").then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/sessions"] }),
  });

  async function handleUpload(file: File) {
    if (!file || !sessionName.trim()) {
      toast({ title: "Please enter a session name", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("pdf", file);
      form.append("name", sessionName.trim());
      form.append("partNumber", partNumber.trim());
      const res = await fetch("/api/sessions/upload", { method: "POST", body: form });
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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
            <FileText className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-semibold text-foreground text-sm">HCS Balloon Tool</h1>
            <p className="text-xs text-muted-foreground">AMAT FAI Extraction</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/settings")} data-testid="button-settings">
          <Settings className="w-4 h-4 mr-2" />
          Settings
        </Button>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        {/* Upload new session */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4" />
              New Drawing Session
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                <label className="text-xs text-muted-foreground">Part Number</label>
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
              <p className="text-xs text-muted-foreground mt-1">Max 100MB</p>
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
              <div className="text-xs text-muted-foreground text-center animate-pulse">Uploading PDF...</div>
            )}
          </CardContent>
        </Card>

        {/* Existing sessions */}
        {sessions.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Sessions</h2>
            {sessions.map(s => (
              <Card key={s.id} className="hover:border-primary transition-colors cursor-pointer" onClick={() => navigate(`/session/${s.id}`)} data-testid={`card-session-${s.id}`}>
                <CardContent className="py-3 px-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FolderOpen className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.pdfFileName} · {new Date(s.updatedAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={e => { e.stopPropagation(); deleteMutation.mutate(s.id); }}
                    data-testid={`button-delete-session-${s.id}`}
                  >
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
