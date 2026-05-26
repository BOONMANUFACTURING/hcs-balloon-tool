import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Crosshair, Trash2, Loader2, AlertCircle, CheckCircle2, Info,
  Maximize2, AlignJustify, List, FileText, StickyNote, Table2, Wrench
} from "lucide-react";
import type { Session, Balloon } from "@shared/schema";
import { GDT_TYPES, STANDARD_NOTES, DIMENSION_TERMS } from "@/lib/amatData";
import { ComboInput } from "@/components/ComboInput";

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

interface CropRect {
  x: number; y: number; w: number; h: number; // canvas pixel coords
}

interface ExtractionResult {
  rawReading: string;
  rowType: string;
  description: string;
  gdtType: string;
  nominalValue: string;
  balloonNumber?: string;
  confidence: "high" | "medium" | "low";
  mock?: boolean;
  error?: string;
}

interface PendingBalloon {
  cropRect: CropRect;
  pageNumber: number;
  xPercent: number;          // balloon circle center as % of page
  yPercent: number;
  anchorXPercent: number;    // leader line start (right edge of crop)
  anchorYPercent: number;
  cropDataUrl: string;
}

// ──────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────

const BALLOON_RADIUS_BASE = 12;
const CANVAS_PADDING = 16; // matches p-4 on the container div

// ──────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────

export default function DrawingTool() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── PDF state ──
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const BALLOON_RADIUS = Math.round(scale * 13); // scales with zoom: 41%→5px, 100%→13px, 150%→20px, 177%→23px
  const [pageRendering, setPageRendering] = useState(false);

  // ── Draw-rect state ──
  // drawMode: false = pan/drag, true = single balloon, "notes" = bulk notes extract, "bom" = bulk BOM extract, "weld" = weld symbol extract
  const [drawMode, setDrawMode] = useState<boolean | "notes" | "bom" | "weld">(false);
  const [drawing, setDrawing] = useState(false);
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<CropRect | null>(null);

  // ── Drag-balloon state (refs for sync mouse handling) ──
  const draggingBalloonIdRef = useRef<number | null>(null);
  const dragStartCanvasRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartPercentRef = useRef<{ xPercent: number; yPercent: number } | null>(null);
  const [draggingBalloonId, setDraggingBalloonId] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ xPercent: number; yPercent: number } | null>(null);
  // Multi-drag: store original positions of all selected balloons at drag start
  const multiDragStartRef = useRef<Map<number, { xPercent: number; yPercent: number }> | null>(null);
  const [multiDragDeltas, setMultiDragDeltas] = useState<{ dx: number; dy: number } | null>(null);

  // ── Pan state (refs for sync access in mouse handlers) ──
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const panStartRef = useRef<{ mouseX: number; mouseY: number; scrollLeft: number; scrollTop: number } | null>(null);

  // ── Extraction state ──
  const [pending, setPending] = useState<PendingBalloon | null>(null);
  const [lastCropUrl, setLastCropUrl] = useState<string | null>(null); // persists for right-panel preview
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<ExtractionResult | null>(null);

  // ── Bulk extract state ──
  const [bulkExtracting, setBulkExtracting] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ type: "notes" | "bom" | "weld"; count: number } | null>(null);

  // ── Result panel edit state ──
  const [editRowType, setEditRowType] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editGdtType, setEditGdtType] = useState("");
  const [editNominal, setEditNominal] = useState("");
  const [editBalloonNum, setEditBalloonNum] = useState("");

  // ── Balloon list ──
  const [selectedBalloonId, setSelectedBalloonId] = useState<number | null>(null);
  const [selectedBalloonIds, setSelectedBalloonIds] = useState<Set<number>>(new Set());
  const [balloonNumInput, setBalloonNumInput] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageCanvasRef = useRef<HTMLCanvasElement | null>(null); // off-screen full-res page
  const pageNativeSizeRef = useRef<{ w: number; h: number } | null>(null);

  // Keep a live ref to balloons so mouse handlers always see the latest list
  const balloonsRef = useRef<Balloon[]>([]);

  // ──────────────────────────────────────────────────────────
  // Data queries
  // ──────────────────────────────────────────────────────────

  const { data: session } = useQuery<Session>({
    queryKey: ["/api/sessions", sessionId],
    queryFn: () => apiRequest("GET", `/api/sessions/${sessionId}`).then(r => r.json()),
  });

  const { data: balloons = [] } = useQuery<Balloon[]>({
    queryKey: ["/api/sessions", sessionId, "balloons"],
    queryFn: () => apiRequest("GET", `/api/sessions/${sessionId}/balloons`).then(r => r.json()),
  });

  // Keep ref in sync
  useEffect(() => { balloonsRef.current = balloons; }, [balloons]);

  const createBalloon = useMutation({
    mutationFn: (data: any) =>
      apiRequest("POST", `/api/sessions/${sessionId}/balloons`, data).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "balloons"] }),
  });

  const updateBalloon = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/balloons/${id}`, data).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "balloons"] }),
  });

  const deleteBalloon = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/balloons/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "balloons"] });
      setSelectedBalloonId(null);
    },
  });

  // ──────────────────────────────────────────────────────────
  // Load PDF.js from CDN
  // ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!session?.pdfDataBase64) return;

    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      const pdfjsLib = (window as any).pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

      const bytes = Uint8Array.from(atob(session.pdfDataBase64), c => c.charCodeAt(0));
      pdfjsLib.getDocument({ data: bytes }).promise.then((doc: any) => {
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
      });
    };
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, [session?.pdfDataBase64]);

  // ──────────────────────────────────────────────────────────
  // Render page to canvas
  // ──────────────────────────────────────────────────────────

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;
    setPageRendering(true);
    try {
      const page = await pdfDoc.getPage(currentPage);

      // Store native page size for fit calculations
      const native = page.getViewport({ scale: 1 });
      pageNativeSizeRef.current = { w: native.width, h: native.height };

      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const container = containerRef.current;

      // ── Centered zoom: capture scroll center ratio before resize ──
      let centerXRatio = 0.5;
      let centerYRatio = 0.5;
      if (container && canvas.width > 0) {
        centerXRatio = (container.scrollLeft + container.clientWidth  / 2) / canvas.width;
        centerYRatio = (container.scrollTop  + container.clientHeight / 2) / canvas.height;
      }

      canvas.width  = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;

      // ── Restore scroll so same point stays centered ──
      if (container && viewport.width > 0) {
        container.scrollLeft = centerXRatio * viewport.width  - container.clientWidth  / 2;
        container.scrollTop  = centerYRatio * viewport.height - container.clientHeight / 2;
      }

      // High-res off-screen canvas for crop extraction
      const hiRes = document.createElement("canvas");
      const hiViewport = page.getViewport({ scale: 3 });
      hiRes.width  = hiViewport.width;
      hiRes.height = hiViewport.height;
      await page.render({ canvasContext: hiRes.getContext("2d")!, viewport: hiViewport }).promise;
      pageCanvasRef.current = hiRes as any;

      // Size overlay to exactly match canvas
      if (overlayRef.current) {
        overlayRef.current.width        = viewport.width;
        overlayRef.current.height       = viewport.height;
        overlayRef.current.style.width  = viewport.width  + "px";
        overlayRef.current.style.height = viewport.height + "px";
      }
    } finally {
      setPageRendering(false);
    }
  }, [pdfDoc, currentPage, scale]);

  useEffect(() => { renderPage(); }, [renderPage]);

  // ──────────────────────────────────────────────────────────
  // Fit-to-page / Fit-to-width
  // ──────────────────────────────────────────────────────────

  function fitToPage() {
    const c = containerRef.current;
    const n = pageNativeSizeRef.current;
    if (!c || !n) return;
    const s = Math.max(0.1, Math.min(4, Math.min((c.clientWidth - 32) / n.w, (c.clientHeight - 32) / n.h)));
    setScale(parseFloat(s.toFixed(2)));
  }

  function fitToWidth() {
    const c = containerRef.current;
    const n = pageNativeSizeRef.current;
    if (!c || !n) return;
    setScale(parseFloat(Math.max(0.1, Math.min(4, (c.clientWidth - 32) / n.w)).toFixed(2)));
  }

  // ──────────────────────────────────────────────────────────
  // Keyboard shortcuts
  // ──────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      // Ctrl+S — save/update regardless of focus
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (pending && balloonNumInput.trim())  { saveBalloon(balloonNumInput); return; }
        if (selectedBalloonId && editBalloonNum.trim()) { updateSelectedBalloon(); return; }
        return;
      }
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); setScale(s => parseFloat(Math.min(4, s + 0.1).toFixed(2))); }
      else if (e.key === "-")              { e.preventDefault(); setScale(s => parseFloat(Math.max(0.1, s - 0.1).toFixed(2))); }
      else if (e.key === "0")              { e.preventDefault(); fitToPage(); }
      else if (e.key === "f" || e.key === "F") { e.preventDefault(); fitToWidth(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && (selectedBalloonId || selectedBalloonIds.size > 0)) {
        e.preventDefault();
        if (selectedBalloonIds.size > 0) {
          // Delete all selected
          for (const id of selectedBalloonIds) { deleteBalloon.mutate(id); }
          setSelectedBalloonIds(new Set());
          setSelectedBalloonId(null);
        } else if (selectedBalloonId) {
          deleteBalloon.mutate(selectedBalloonId);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, balloonNumInput, selectedBalloonId, selectedBalloonIds, editBalloonNum, deleteBalloon]);

  // ──────────────────────────────────────────────────────────
  // Overlay canvas — draw balloons + active rect
  // ──────────────────────────────────────────────────────────

  const drawOverlay = useCallback(() => {
    const canvas  = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    // Only resize when dimensions change — resizing clears the canvas
    if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
      overlay.width        = canvas.width;
      overlay.height       = canvas.height;
      overlay.style.width  = canvas.width  + "px";
      overlay.style.height = canvas.height + "px";
    }
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // Active crop rect
    if (currentRect) {
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth   = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h);
      ctx.fillStyle = "rgba(245,158,11,0.08)";
      ctx.fillRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h);
      ctx.setLineDash([]);
    }

    // ── helpers ──
    function drawCircle(cx: number, cy: number, label: string, fill: string, stroke: string, lw: number, dashed: boolean) {
      ctx.beginPath();
      ctx.arc(cx, cy, BALLOON_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth   = lw;
      ctx.stroke();
      if (dashed) {
        ctx.beginPath();
        ctx.arc(cx, cy, BALLOON_RADIUS + 5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(147,197,253,0.6)";
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle    = "#fff";
      const fs = Math.max(6, Math.round(BALLOON_RADIUS * (label.length > 2 ? 1.1 : 1.4)));
      ctx.font         = `bold ${fs}px sans-serif`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx, cy);
    }

    function drawLeader(ax: number, ay: number, cx: number, cy: number, color: string) {
      const angle = Math.atan2(cy - ay, cx - ax);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(cx - Math.cos(angle) * BALLOON_RADIUS, cy - Math.sin(angle) * BALLOON_RADIUS);
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ax, ay, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Pending preview
    if (pending && pending.pageNumber === currentPage) {
      const cx = (pending.xPercent / 100) * canvas.width;
      const cy = (pending.yPercent / 100) * canvas.height;
      const ax = (pending.anchorXPercent / 100) * canvas.width;
      const ay = (pending.anchorYPercent / 100) * canvas.height;
      drawLeader(ax, ay, cx, cy, "#92400e");
      drawCircle(cx, cy, "?", "#f59e0b", "#92400e", 1.5, false);
    }

    // Saved balloons on current page
    // ── Visual destack: compute draw positions that don't overlap at current zoom ──
    // Stored percent positions are preserved; only the rendered (cx,cy) is adjusted.
    const minGap = BALLOON_RADIUS * 2 + 2; // minimum centre-to-centre distance
    type DrawPos = { id: number; cx: number; cy: number };
    const drawn: DrawPos[] = [];

    function resolveDrawPos(rawCx: number, rawCy: number, id: number): { cx: number; cy: number } {
      let cy = rawCy;
      for (let attempt = 0; attempt < 30; attempt++) {
        const clash = drawn.find(d => Math.hypot(rawCx - d.cx, cy - d.cy) < minGap);
        if (!clash) break;
        // Push down by one diameter past the clashing balloon
        cy = clash.cy + minGap;
        // Clamp to canvas
        cy = Math.min(canvas.height - BALLOON_RADIUS - 2, cy);
      }
      return { cx: rawCx, cy };
    }

    balloons
      .filter(b => b.pageNumber === currentPage)
      .slice() // don't mutate
      .sort((a, b) => a.yPercent - b.yPercent) // top-to-bottom ordering for destack
      .forEach(b => {
        const isDragging = b.id === draggingBalloonId;
        const isSelected = b.id === selectedBalloonId || selectedBalloonIds.has(b.id);
        const isMultiDragging = multiDragDeltas && selectedBalloonIds.has(b.id);
        const liveX = isDragging && dragPos ? dragPos.xPercent
          : isMultiDragging ? b.xPercent + multiDragDeltas!.dx
          : b.xPercent;
        const liveY = isDragging && dragPos ? dragPos.yPercent
          : isMultiDragging ? b.yPercent + multiDragDeltas!.dy
          : b.yPercent;
        const rawCx = (liveX / 100) * canvas.width;
        const rawCy = (liveY / 100) * canvas.height;

        // Apply visual destack (skip for dragging balloon — it follows the mouse)
        const { cx, cy } = isDragging ? { cx: rawCx, cy: rawCy } : resolveDrawPos(rawCx, rawCy, b.id);
        drawn.push({ id: b.id, cx, cy });

        if (!isDragging && b.anchorXPercent && b.anchorYPercent) {
          drawLeader(
            (b.anchorXPercent / 100) * canvas.width,
            (b.anchorYPercent / 100) * canvas.height,
            cx, cy,
            isSelected ? "#93c5fd" : "#3b82f6"
          );
        }
        drawCircle(
          cx, cy, b.balloonNumber,
          isDragging ? "#1d4ed8" : isSelected ? "#1d4ed8" : "#1e40af",
          isDragging ? "#93c5fd" : isSelected ? "#93c5fd" : "#3b82f6",
          isDragging ? 3 : isSelected ? 2.5 : 1.5,
          isDragging
        );
      });
  }, [balloons, currentPage, currentRect, pending, selectedBalloonId, selectedBalloonIds, draggingBalloonId, dragPos, multiDragDeltas, scale, BALLOON_RADIUS]);

  useEffect(() => { drawOverlay(); }, [drawOverlay]);

  // ──────────────────────────────────────────────────────────
  // Canvas coordinate helper
  // Maps a mouse event to canvas pixel coordinates.
  // Accounts for container scroll and p-4 padding.
  // ──────────────────────────────────────────────────────────

  function getCanvasXY(e: React.MouseEvent): { x: number; y: number } {
    const container = containerRef.current!;
    const overlay   = overlayRef.current!;
    const cr        = container.getBoundingClientRect();
    // Raw position inside scrollable content
    const rawX = e.clientX - cr.left + container.scrollLeft - CANVAS_PADDING;
    const rawY = e.clientY - cr.top  + container.scrollTop  - CANVAS_PADDING;
    // Scale from CSS pixels to canvas pixels (should be 1:1, but guard anyway)
    const scaleX = overlay.width  / (parseFloat(overlay.style.width)  || overlay.width);
    const scaleY = overlay.height / (parseFloat(overlay.style.height) || overlay.height);
    return { x: rawX * scaleX, y: rawY * scaleY };
  }

  // ──────────────────────────────────────────────────────────
  // Mouse events on overlay canvas
  // ──────────────────────────────────────────────────────────

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (drawMode) {
      const pt = getCanvasXY(e);
      setDrawing(true);
      setStartPt(pt);
      setCurrentRect({ x: pt.x, y: pt.y, w: 0, h: 0 });
      return;
    }

    const { x, y } = getCanvasXY(e);
    const overlay   = overlayRef.current!;
    const W = overlay.width;
    const H = overlay.height;

    // Hit-test against balloons on current page (use ref — always fresh)
    const hit = balloonsRef.current.find(b => {
      if (b.pageNumber !== currentPage) return false;
      const cx = (b.xPercent / 100) * W;
      const cy = (b.yPercent / 100) * H;
      return Math.hypot(x - cx, y - cy) <= BALLOON_RADIUS + 6;
    });

    if (hit) {
      // Multi-select with Shift or Ctrl
      if (e.shiftKey || e.ctrlKey) {
        setSelectedBalloonId(null); // clear single select
        setSelectedBalloonIds(prev => {
          const next = new Set(prev);
          if (next.has(hit.id)) { next.delete(hit.id); } else { next.add(hit.id); }
          return next;
        });
        return;
      }
      // Single select — clear multi-select
      setSelectedBalloonIds(new Set());
      // Populate right panel
      setSelectedBalloonId(hit.id);
      setExtractResult({
        rawReading: hit.description || "",
        rowType: hit.rowType,
        description: hit.description,
        gdtType: hit.gdtType,
        nominalValue: hit.nominalValue,
        confidence: "high",
      });
      setEditRowType(hit.rowType);
      setEditDescription(hit.description);
      setEditGdtType(hit.gdtType);
      setEditNominal(hit.nominalValue);
      setEditBalloonNum(hit.balloonNumber);
      setPending(null);

      // If clicking a balloon that's part of multi-select, start multi-drag
      if (selectedBalloonIds.has(hit.id) && selectedBalloonIds.size > 1) {
        dragStartCanvasRef.current = { x, y };
        const startMap = new Map<number, { xPercent: number; yPercent: number }>();
        balloonsRef.current.filter(b => selectedBalloonIds.has(b.id)).forEach(b => {
          startMap.set(b.id, { xPercent: b.xPercent, yPercent: b.yPercent });
        });
        multiDragStartRef.current = startMap;
        setMultiDragDeltas({ dx: 0, dy: 0 });
        return;
      }
      // Single balloon drag
      draggingBalloonIdRef.current  = hit.id;
      dragStartCanvasRef.current    = { x, y };
      dragStartPercentRef.current   = { xPercent: hit.xPercent, yPercent: hit.yPercent };
      setDraggingBalloonId(hit.id);
      setDragPos({ xPercent: hit.xPercent, yPercent: hit.yPercent });
    } else {
      // Start panning
      const container = containerRef.current!;
      panningRef.current  = true;
      panStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, scrollLeft: container.scrollLeft, scrollTop: container.scrollTop };
      setPanning(true);
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    // Pan
    if (panningRef.current && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.mouseX;
      const dy = e.clientY - panStartRef.current.mouseY;
      containerRef.current!.scrollLeft = panStartRef.current.scrollLeft - dx;
      containerRef.current!.scrollTop  = panStartRef.current.scrollTop  - dy;
      return;
    }

    // Multi-balloon drag
    if (multiDragStartRef.current && dragStartCanvasRef.current) {
      const { x, y } = getCanvasXY(e);
      const W = overlayRef.current!.width;
      const H = overlayRef.current!.height;
      const dx = ((x - dragStartCanvasRef.current.x) / W) * 100;
      const dy = ((y - dragStartCanvasRef.current.y) / H) * 100;
      setMultiDragDeltas({ dx, dy });
      return;
    }

    // Single balloon drag — use refs to avoid stale-closure on draggingBalloonId
    if (draggingBalloonIdRef.current !== null) {
      const { x, y } = getCanvasXY(e);
      const W = overlayRef.current!.width;
      const H = overlayRef.current!.height;
      const newPos = {
        xPercent: Math.max(0, Math.min(100, (x / W) * 100)),
        yPercent: Math.max(0, Math.min(100, (y / H) * 100)),
      };
      setDragPos(newPos);
      return;
    }

    // Draw rect
    if (drawing && startPt) {
      const { x, y } = getCanvasXY(e);
      setCurrentRect({
        x: Math.min(startPt.x, x),
        y: Math.min(startPt.y, y),
        w: Math.abs(x - startPt.x),
        h: Math.abs(y - startPt.y),
      });
    }
  }

  async function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    // Finish pan
    if (panningRef.current) {
      panningRef.current  = false;
      panStartRef.current = null;
      setPanning(false);
      return;
    }

    // Finish multi-drag
    if (multiDragStartRef.current && multiDragDeltas) {
      const startMap = multiDragStartRef.current;
      const { dx, dy } = multiDragDeltas;
      multiDragStartRef.current = null;
      dragStartCanvasRef.current = null;
      setMultiDragDeltas(null);
      for (const [id, start] of startMap) {
        await updateBalloon.mutateAsync({
          id,
          data: {
            xPercent: Math.max(0, Math.min(100, start.xPercent + dx)),
            yPercent: Math.max(0, Math.min(100, start.yPercent + dy)),
            anchorXPercent: Math.max(0, Math.min(100, start.xPercent + dx)),
            anchorYPercent: Math.max(0, Math.min(100, start.yPercent + dy)),
          },
        });
      }
      return;
    }

    // Finish single balloon drag
    if (draggingBalloonIdRef.current !== null && dragPos) {
      const id       = draggingBalloonIdRef.current;
      const pos      = dragPos;
      const startPct = dragStartPercentRef.current;
      draggingBalloonIdRef.current = null;
      dragStartCanvasRef.current   = null;
      dragStartPercentRef.current  = null;
      setDraggingBalloonId(null);
      setDragPos(null);
      // Also shift anchor by the same delta so leader line moves with the balloon
      const original = balloonsRef.current.find(b => b.id === id);
      const dx = startPct ? pos.xPercent - startPct.xPercent : 0;
      const dy = startPct ? pos.yPercent - startPct.yPercent : 0;
      const newAnchorX = original?.anchorXPercent != null ? original.anchorXPercent + dx : pos.xPercent;
      const newAnchorY = original?.anchorYPercent != null ? original.anchorYPercent + dy : pos.yPercent;
      await updateBalloon.mutateAsync({
        id,
        data: {
          xPercent: pos.xPercent,
          yPercent: pos.yPercent,
          anchorXPercent: newAnchorX,
          anchorYPercent: newAnchorY,
        },
      });
      return;
    }

    // Finish draw rect
    if (!drawing || !currentRect) return;
    setDrawing(false);

    if (currentRect.w < 10 || currentRect.h < 10) {
      setCurrentRect(null);
      setStartPt(null);
      return;
    }

    // Crop from high-res canvas
    const hiCanvas      = pageCanvasRef.current as unknown as HTMLCanvasElement;
    const displayCanvas = canvasRef.current!;
    const scaleX = hiCanvas ? hiCanvas.width  / displayCanvas.width  : 1;
    const scaleY = hiCanvas ? hiCanvas.height / displayCanvas.height : 1;

    const cropCanvas       = document.createElement("canvas");
    cropCanvas.width       = currentRect.w * scaleX;
    cropCanvas.height      = currentRect.h * scaleY;
    const cropCtx          = cropCanvas.getContext("2d")!;
    cropCtx.drawImage(
      hiCanvas || displayCanvas,
      currentRect.x * scaleX, currentRect.y * scaleY,
      currentRect.w * scaleX, currentRect.h * scaleY,
      0, 0, cropCanvas.width, cropCanvas.height
    );
    const cropDataUrl = cropCanvas.toDataURL("image/png");

    // Anchor = right-middle of crop
    const anchorX        = currentRect.x + currentRect.w;
    const anchorY        = currentRect.y + currentRect.h / 2;
    const anchorXPercent = (anchorX / displayCanvas.width)  * 100;
    const anchorYPercent = (anchorY / displayCanvas.height) * 100;

    // ── Bulk modes: Notes, BOM, or Weld ──
    if (drawMode === "notes") {
      setCurrentRect(null);
      setStartPt(null);
      setDrawMode(false);
      await runBulkNotesExtract(cropDataUrl, currentRect);
      return;
    }
    if (drawMode === "bom") {
      const bomCropRect = currentRect;
      setCurrentRect(null);
      setStartPt(null);
      setDrawMode(false);
      await runBulkBomExtract(cropDataUrl, anchorXPercent, anchorYPercent, bomCropRect!);
      return;
    }
    if (drawMode === "weld") {
      const weldCropRect = currentRect;
      setCurrentRect(null);
      setStartPt(null);
      setDrawMode(false);
      await runBulkWeldExtract(cropDataUrl, anchorXPercent, anchorYPercent, weldCropRect!);
      return;
    }

    // ── Normal single-balloon mode ──
    // Balloon circle = 8px to the right of anchor, collision-nudged
    const GAP          = 8;
    const rawCircleX   = anchorX + GAP + BALLOON_RADIUS;
    const clampedX     = Math.min(rawCircleX, displayCanvas.width - BALLOON_RADIUS - 2);
    let   circleXPct   = (clampedX / displayCanvas.width) * 100;
    let   circleYPct   = anchorYPercent;

    // ── Collision avoidance: nudge Y if overlapping an existing balloon ──
    circleYPct = resolveCollision(circleXPct, circleYPct, displayCanvas.width, displayCanvas.height);

    const pend: PendingBalloon = {
      cropRect: currentRect,
      pageNumber: currentPage,
      xPercent: circleXPct,
      yPercent: circleYPct,
      anchorXPercent,
      anchorYPercent,
      cropDataUrl,
    };
    setPending(pend);
    setLastCropUrl(cropDataUrl); // persist for right-panel preview
    setCurrentRect(null);
    setStartPt(null);
    setDrawMode(false);
    setExtractResult(null);
    setSelectedBalloonId(null);

    await runExtraction(pend);
  }

  function onMouseLeave() {
    if (panningRef.current) {
      panningRef.current  = false;
      panStartRef.current = null;
      setPanning(false);
    }
    if (drawing) { setDrawing(false); setCurrentRect(null); setStartPt(null); }
    // Cancel multi-drag on leave
    if (multiDragStartRef.current) {
      multiDragStartRef.current = null;
      dragStartCanvasRef.current = null;
      setMultiDragDeltas(null);
    }
    if (draggingBalloonIdRef.current !== null && dragPos) {
      const id       = draggingBalloonIdRef.current;
      const pos      = dragPos;
      const startPct = dragStartPercentRef.current;
      draggingBalloonIdRef.current = null;
      dragStartCanvasRef.current   = null;
      dragStartPercentRef.current  = null;
      setDraggingBalloonId(null);
      setDragPos(null);
      const original  = balloonsRef.current.find(b => b.id === id);
      const dx = startPct ? pos.xPercent - startPct.xPercent : 0;
      const dy = startPct ? pos.yPercent - startPct.yPercent : 0;
      const newAnchorX = original?.anchorXPercent != null ? original.anchorXPercent + dx : pos.xPercent;
      const newAnchorY = original?.anchorYPercent != null ? original.anchorYPercent + dy : pos.yPercent;
      updateBalloon.mutateAsync({ id, data: { xPercent: pos.xPercent, yPercent: pos.yPercent, anchorXPercent: newAnchorX, anchorYPercent: newAnchorY } });
    }
  }

  // ──────────────────────────────────────────────────────────
  // Collision avoidance
  // Nudges circle Y up or down until it doesn't overlap any
  // existing balloon on the same page (canvas-percent coords).
  // ──────────────────────────────────────────────────────────

  function resolveCollision(xPct: number, yPct: number, canvasW: number, canvasH: number): number {
    const existing = balloonsRef.current.filter(b => b.pageNumber === currentPage);
    // Balloon is fixed 13px on screen. Express minimum gap as % of current canvas so
    // stored percent coords are consistent regardless of zoom at creation time.
    const minPx      = BALLOON_RADIUS * 2 + 6; // diameter + gap in canvas px
    const minDistYPct = (minPx / canvasH) * 100;
    const minDistXPx  = minPx;

    let resolved = yPct;
    let attempts = 0;
    const MAX = 20;

    while (attempts < MAX) {
      const collision = existing.find(b => {
        const dxPx = Math.abs(xPct - b.xPercent) / 100 * canvasW;
        const dyPx = Math.abs(resolved - b.yPercent) / 100 * canvasH;
        return Math.hypot(dxPx, dyPx) < minDistXPx;
      });
      if (!collision) break;
      resolved += (collision.yPercent < resolved ? minDistYPct : -minDistYPct);
      const marginPct = (BALLOON_RADIUS + 2) / canvasH * 100;
      resolved = Math.max(marginPct, Math.min(100 - marginPct, resolved));
      attempts++;
    }
    return resolved;
  }

  // ──────────────────────────────────────────────────────────
  // Extraction
  // ──────────────────────────────────────────────────────────

  async function runExtraction(pend: PendingBalloon) {
    setExtracting(true);
    setExtractResult(null);
    try {
      const apiKey = (window as any).__HCS_OPENAI_KEY || "";
      const blob   = await fetch(pend.cropDataUrl).then(r => r.blob());
      const form   = new FormData();
      form.append("crop", blob, "crop.png");

      const headers: Record<string, string> = {};
      if (apiKey) headers["x-openai-key"] = apiKey;

      const res  = await fetch("/api/extract", { method: "POST", headers, body: form });
      const data: ExtractionResult = await res.json();
      if (data.error) throw new Error(data.error);

      setExtractResult(data);
      setEditRowType(data.rowType     || "DIMENSION");
      setEditDescription(data.description || "");
      setEditGdtType(data.gdtType     || "");
      setEditNominal(data.nominalValue || "");
      setEditBalloonNum(data.balloonNumber || "");

      // ── Auto-save using AI result data directly (not from state, which hasn't updated yet) ──
      const nums = balloonsRef.current.map(b => parseInt(b.balloonNumber)).filter(n => !isNaN(n));
      const autoNum = nums.length > 0 ? String(Math.max(...nums) + 1) : "1";
      setBalloonNumInput(autoNum);
      const balloon = await createBalloon.mutateAsync({
        balloonNumber:  autoNum,
        pageNumber:     pend.pageNumber,
        xPercent:       pend.xPercent,
        yPercent:       pend.yPercent,
        anchorXPercent: pend.anchorXPercent,
        anchorYPercent: pend.anchorYPercent,
        rowType:        data.rowType     || "DIMENSION",
        description:    data.description || "",
        gdtType:        data.gdtType     || "",
        nominalValue:   data.nominalValue || "",
      });
      setSelectedBalloonId(balloon.id);
      // Populate right panel edit fields so it shows the saved balloon correctly
      setEditRowType(data.rowType     || "DIMENSION");
      setEditDescription(data.description || "");
      setEditGdtType(data.gdtType     || "");
      setEditNominal(data.nominalValue || "");
      setEditBalloonNum(autoNum);
      setPending(null);
      setExtractResult(null);
      toast({ title: `Balloon B${autoNum} saved`, description: data.description || "" });
      setDrawMode(true);
    } catch (err: any) {
      setExtractResult({ rawReading: "Extraction failed", rowType: "DIMENSION", description: "", gdtType: "", nominalValue: "", confidence: "low", error: err.message });
      setEditRowType("DIMENSION");
      setEditDescription("");
      setEditGdtType("");
      setEditNominal("");
      setEditBalloonNum("");
    } finally {
      setExtracting(false);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Save balloon — then auto-return to draw mode
  // ──────────────────────────────────────────────────────────

  async function saveBalloon(balloonNum: string) {
    if (!pending) return;
    const data = {
      balloonNumber:   balloonNum,
      pageNumber:      pending.pageNumber,
      xPercent:        pending.xPercent,
      yPercent:        pending.yPercent,
      anchorXPercent:  pending.anchorXPercent,
      anchorYPercent:  pending.anchorYPercent,
      rowType:         editRowType || "DIMENSION",
      description:     editDescription,
      gdtType:         editGdtType,
      nominalValue:    editNominal,
    };
    const balloon = await createBalloon.mutateAsync(data);
    setSelectedBalloonId(balloon.id);
    setPending(null);
    setExtractResult(null);
    toast({ title: `Balloon B${balloonNum} saved`, description: editDescription });
    // ── Auto re-enter draw mode so user can immediately draw next balloon ──
    setDrawMode(true);
  }

  async function updateSelectedBalloon() {
    if (!selectedBalloonId) return;
    await updateBalloon.mutateAsync({
      id: selectedBalloonId,
      data: { rowType: editRowType, description: editDescription, gdtType: editGdtType, nominalValue: editNominal, balloonNumber: editBalloonNum },
    });
    toast({ title: `Balloon B${editBalloonNum} updated` });
  }

  function cancelPending() {
    setPending(null);
    setExtractResult(null);
    setCurrentRect(null);
    setDrawMode(false);
  }

  // ──────────────────────────────────────────────────────────
  // Bulk extract: Notes (left edge) — calls /api/extract-notes
  // ──────────────────────────────────────────────────────────

  async function runBulkNotesExtract(cropDataUrl: string, cropRect: CropRect) {
    setBulkExtracting(true);
    setBulkResult(null);
    try {
      const apiKey = (window as any).__HCS_OPENAI_KEY || "";
      const blob   = await fetch(cropDataUrl).then(r => r.blob());
      const form   = new FormData();
      form.append("crop", blob, "crop.png");
      const headers: Record<string, string> = {};
      if (apiKey) headers["x-openai-key"] = apiKey;

      const res  = await fetch("/api/extract-notes", { method: "POST", headers, body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const notes: { noteNum: number; noteText: string; yPercent?: number }[] = data.notes || [];
      if (notes.length === 0) {
        toast({ title: "No notes found", description: "AI found no note lines in the selected area." });
        return;
      }

      // Place balloons on LEFT edge, Y aligned with each note's position in the crop
      const canvasW = canvasRef.current?.width  || 1000;
      const canvasH = canvasRef.current?.height || 1000;
      const X_PCT   = ((BALLOON_RADIUS + 4) / canvasW) * 100; // just inside left edge

      // Calculate starting number ONCE before the loop
      const existingNums = balloonsRef.current.map(b => parseInt(b.balloonNumber)).filter(n => !isNaN(n));
      let nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;

      let fallbackY = ((cropRect.y + BALLOON_RADIUS + 4) / canvasH) * 100;
      const stepPct = ((BALLOON_RADIUS * 2 + 6) / canvasH) * 100;

      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        // Use AI-provided yPercent (relative to crop) mapped to canvas, or fallback
        let yPct: number;
        if (note.yPercent != null) {
          // note.yPercent is % within crop image → map to canvas
          yPct = ((cropRect.y + (note.yPercent / 100) * cropRect.h) / canvasH) * 100;
        } else {
          yPct = fallbackY + i * stepPct;
        }
        await createBalloon.mutateAsync({
          balloonNumber:  String(nextNum),
          pageNumber:     currentPage,
          xPercent:       X_PCT,
          yPercent:       yPct,
          anchorXPercent: X_PCT,
          anchorYPercent: yPct,
          rowType:        "NOTE",
          description:    note.noteText,
          gdtType:        "",
          nominalValue:   "",
        });
        nextNum++;
      }

      setBulkResult({ type: "notes", count: notes.length });
      toast({ title: `${notes.length} note${notes.length !== 1 ? "s" : ""} extracted`, description: "Balloons placed on left edge." });
      fitToWidth();
    } catch (err: any) {
      toast({ title: "Notes extraction failed", description: err.message, variant: "destructive" });
    } finally {
      setBulkExtracting(false);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Bulk extract: BOM (right edge) — calls /api/extract-bom
  // ──────────────────────────────────────────────────────────

  async function runBulkBomExtract(cropDataUrl: string, anchorXPct: number, anchorYPct: number, cropRect: CropRect) {
    setBulkExtracting(true);
    setBulkResult(null);
    setLastCropUrl(cropDataUrl); // persist for right-panel preview
    setPending({
      cropRect,
      pageNumber: currentPage,
      xPercent: anchorXPct,
      yPercent: anchorYPct,
      anchorXPercent: anchorXPct,
      anchorYPercent: anchorYPct,
      cropDataUrl,
    });
    try {
      const apiKey = (window as any).__HCS_OPENAI_KEY || "";
      const blob   = await fetch(cropDataUrl).then(r => r.blob());
      const form   = new FormData();
      form.append("crop", blob, "crop.png");
      const headers: Record<string, string> = {};
      if (apiKey) headers["x-openai-key"] = apiKey;

      const res  = await fetch("/api/extract-bom", { method: "POST", headers, body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const rows: { itemNo: number; qty: number; description: string }[] = data.rows || [];
      if (rows.length === 0) {
        toast({ title: "No BOM rows found", description: "AI found no BOM rows in the selected area." });
        return;
      }

      // Place balloons on left edge of the crop rect, stacking bottom to top
      const canvasW = canvasRef.current?.width  || 1000;
      const canvasH = canvasRef.current?.height || 1000;
      // X position: zigzag — odd rows (1,3,5) inner (closer to frame), even rows (2,4,6) outer
      // Inner = just outside left edge, Outer = one balloon diameter further left
      const X_INNER = ((cropRect.x - BALLOON_RADIUS - 4) / canvasW) * 100;
      const X_OUTER = ((cropRect.x - BALLOON_RADIUS * 3 - 6) / canvasW) * 100; // min gap: just enough to not overlap
      // Y start: bottom of the crop rect, stack upward
      const cropBottomPct = ((cropRect.y + cropRect.h - BALLOON_RADIUS - 4) / canvasH) * 100;

      // Calculate starting number ONCE before the loop
      const existingNumsBom = balloonsRef.current.map(b => parseInt(b.balloonNumber)).filter(n => !isNaN(n));
      let nextNum = existingNumsBom.length > 0 ? Math.max(...existingNumsBom) + 1 : 1;
      // Sort by itemNo ascending so Item 1 is at index 0 (placed at bottom)
      const orderedRows = [...rows].sort((a, b) => a.itemNo - b.itemNo);
      // Row height = crop height divided by number of rows (align each balloon to its BOM row)
      const rowHeightPct = (cropRect.h / canvasH) * 100 / orderedRows.length;

      // Stack bottom to top: place each balloon going upward, zigzag inner/outer
      // i=0 (row 1, bottom) = inner, i=1 = outer, i=2 = inner, etc.
      for (let i = 0; i < orderedRows.length; i++) {
        const row = orderedRows[i];
        // Center of each row from bottom
        const yPct = cropBottomPct - i * rowHeightPct - rowHeightPct * 0.5;
        const X_PCT = i % 2 === 0 ? X_INNER : X_OUTER;
        await createBalloon.mutateAsync({
          balloonNumber:  String(nextNum + i),
          pageNumber:     currentPage,
          xPercent:       X_PCT,
          yPercent:       yPct,
          anchorXPercent: X_PCT,
          anchorYPercent: yPct,
          rowType:        "NOTE",
          description:    `ITEM ${row.itemNo} X ${row.qty} - ${row.description}`,
          gdtType:        "",
          nominalValue:   "",
        });
      }

      setBulkResult({ type: "bom", count: rows.length });
      toast({ title: `${rows.length} BOM row${rows.length !== 1 ? "s" : ""} extracted`, description: "Balloons placed on left edge." });
    } catch (err: any) {
      toast({ title: "BOM extraction failed", description: err.message, variant: "destructive" });
    } finally {
      setBulkExtracting(false);
      setPending(null);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Weld symbol extraction (bulk) — places balloons at anchor
  // ──────────────────────────────────────────────────────────

  async function runBulkWeldExtract(cropDataUrl: string, anchorXPct: number, anchorYPct: number, cropRect: CropRect) {
    setBulkExtracting(true);
    setBulkResult(null);
    setLastCropUrl(cropDataUrl); // persist for right-panel preview
    // Show crop preview in right panel (same as single balloon mode)
    setPending({
      cropRect,
      pageNumber: currentPage,
      xPercent: anchorXPct,
      yPercent: anchorYPct,
      anchorXPercent: anchorXPct,
      anchorYPercent: anchorYPct,
      cropDataUrl,
    });
    try {
      const apiKey = (window as any).__HCS_OPENAI_KEY || "";
      const blob   = await fetch(cropDataUrl).then(r => r.blob());
      const form   = new FormData();
      form.append("crop", blob, "crop.png");
      const headers: Record<string, string> = {};
      if (apiKey) headers["x-openai-key"] = apiKey;

      const res  = await fetch("/api/extract-weld", { method: "POST", headers, body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const rows: { rowType: string; description: string; gdtType: string; nominalValue: string }[] = data.rows || [];
      if (rows.length === 0) {
        toast({ title: "No weld rows found", description: "AI found no weld symbols in the selected area." });
        return;
      }

      // Place balloons stacked downward from anchor (right edge of crop)
      const canvasW = canvasRef.current?.width  || 1000;
      const canvasH = canvasRef.current?.height || 1000;

      // Calculate starting balloon number ONCE
      const existingNums = balloonsRef.current.map(b => parseInt(b.balloonNumber)).filter(n => !isNaN(n));
      let nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;

      let startY = anchorYPct;
      for (const row of rows) {
        const yPct = resolveCollision(anchorXPct, startY, canvasW, canvasH);
        await createBalloon.mutateAsync({
          balloonNumber:  String(nextNum),
          pageNumber:     currentPage,
          xPercent:       anchorXPct,
          yPercent:       yPct,
          anchorXPercent: anchorXPct,
          anchorYPercent: yPct,
          rowType:        row.rowType,
          description:    row.description,
          gdtType:        row.gdtType || "",
          nominalValue:   row.nominalValue || "",
          // Auto-assign tool + cal date for weld rows based on rowType
          tool:                row.rowType === "NOTE"
                                 ? "Visual - Visual inspection"
                                 : "Caliper - 0-300mm",
          calibrationDueDate:  row.rowType === "NOTE" ? "" : "03/01/2027",
        });
        nextNum++;
        startY = yPct + ((BALLOON_RADIUS * 2 + 6) / canvasH) * 100;
      }

      setBulkResult({ type: "weld", count: rows.length });
      toast({ title: `${rows.length} weld row${rows.length !== 1 ? "s" : ""} extracted`, description: "Balloons placed at crop anchor." });
    } catch (err: any) {
      toast({ title: "Weld extraction failed", description: err.message, variant: "destructive" });
    } finally {
      setBulkExtracting(false);
      setPending(null);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Quick-add BOM row (Item No × Qty — Description)
  // ──────────────────────────────────────────────────────────

  async function addBomRow(itemNo: number, qty: number, description: string) {
    const canvasW = canvasRef.current?.width  || 1000;
    const canvasH = canvasRef.current?.height || 1000;
    // Place off-drawing (top-right corner area, stacked)
    const xPct = 95;
    const rawY  = 5 + (balloons.filter(b => b.pageNumber === currentPage).length) * 5;
    const yPct  = resolveCollision(xPct, rawY, canvasW, canvasH);

    const nextNum = (() => {
      const nums = balloonsRef.current.map(b => parseInt(b.balloonNumber)).filter(n => !isNaN(n));
      return nums.length > 0 ? Math.max(...nums) + 1 : 1;
    })();

    await createBalloon.mutateAsync({
      balloonNumber:  String(nextNum),
      pageNumber:     currentPage,
      xPercent:       xPct,
      yPercent:       yPct,
      anchorXPercent: xPct,
      anchorYPercent: yPct,
      rowType:        "NOTE",
      description:    `ITEM ${itemNo} X ${qty} - ${description}`,
      gdtType:        "",
      nominalValue:   "",
    });
    toast({ title: `BOM row added: Item ${itemNo} × ${qty}` });
  }

  // ──────────────────────────────────────────────────────────
  // Quick-add NOTE row
  // ──────────────────────────────────────────────────────────

  async function addNoteRow(noteNum: number, noteText: string) {
    const canvasW = canvasRef.current?.width  || 1000;
    const canvasH = canvasRef.current?.height || 1000;
    const xPct = 95;
    const rawY  = 5 + (balloons.filter(b => b.pageNumber === currentPage).length) * 5;
    const yPct  = resolveCollision(xPct, rawY, canvasW, canvasH);

    const nextNum = (() => {
      const nums = balloonsRef.current.map(b => parseInt(b.balloonNumber)).filter(n => !isNaN(n));
      return nums.length > 0 ? Math.max(...nums) + 1 : 1;
    })();

    await createBalloon.mutateAsync({
      balloonNumber:  String(nextNum),
      pageNumber:     currentPage,
      xPercent:       xPct,
      yPercent:       yPct,
      anchorXPercent: xPct,
      anchorYPercent: yPct,
      rowType:        "NOTE",
      description:    noteText,
      gdtType:        "",
      nominalValue:   "",
    });
    toast({ title: `Note ${noteNum} added` });
  }

  // ──────────────────────────────────────────────────────────
  // Next balloon number
  // ──────────────────────────────────────────────────────────

  const nextBalloonNum = (() => {
    const nums = balloons.map(b => parseInt(b.balloonNumber)).filter(n => !isNaN(n));
    return nums.length > 0 ? String(Math.max(...nums) + 1) : "1";
  })();

  // Auto-save for single-balloon draw mode is now handled directly inside runExtraction()

  // ── Quick-add form state ──
  const [showBomForm,  setShowBomForm]  = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [bomItem,  setBomItem]  = useState("1");
  const [bomQty,   setBomQty]   = useState("1");
  const [bomDesc,  setBomDesc]  = useState("");
  const [noteNum,  setNoteNum]  = useState("1");
  const [noteText, setNoteText] = useState("");

  // ──────────────────────────────────────────────────────────
  // Confidence badge
  // ──────────────────────────────────────────────────────────

  function ConfidenceBadge({ c }: { c: "high" | "medium" | "low" }) {
    const cfg = {
      high:   { label: "High confidence",   cls: "bg-green-100 text-green-800 border-green-300"   },
      medium: { label: "Medium confidence", cls: "bg-yellow-100 text-yellow-800 border-yellow-300" },
      low:    { label: "Low confidence",    cls: "bg-red-100 text-red-800 border-red-300"          },
    };
    const { label, cls } = cfg[c] || cfg.low;
    return <span className={`text-xs px-2 py-0.5 rounded border font-medium ${cls}`}>{label}</span>;
  }

  // ──────────────────────────────────────────────────────────
  // Cursor + sorted list
  // ──────────────────────────────────────────────────────────

  const cursorStyle = drawMode ? "crosshair" : draggingBalloonId ? "grabbing" : panning ? "grabbing" : "grab";

  const sortedBalloons = [...balloons].sort((a, b) => {
    const na = parseInt(a.balloonNumber), nb = parseInt(b.balloonNumber);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.balloonNumber.localeCompare(b.balloonNumber);
  });

  const hasResult = extractResult || selectedBalloonId;

  // ──────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">

      {/* ── Top Bar ── */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-1" />Back
          </Button>
          <div className="h-4 w-px bg-border" />
          <div>
            <p className="text-sm font-semibold text-foreground">{session?.name || "Loading..."}</p>
            <p className="text-xs text-muted-foreground">{session?.pdfFileName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Draw mode */}
          <Button
            variant={drawMode === true ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setDrawMode(drawMode === true ? false : true);
              setPending(null); setCurrentRect(null);
            }}
            data-testid="button-draw-mode"
            className={drawMode === true ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-600" : ""}
          >
            <Crosshair className="w-4 h-4 mr-1" />
            {drawMode === true ? "Drawing… (click & drag)" : "Draw Balloon"}
          </Button>

          {/* Extract Notes (bulk) */}
          <Button
            variant={drawMode === "notes" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setDrawMode(drawMode === "notes" ? false : "notes");
              setPending(null); setCurrentRect(null);
              setShowBomForm(false); setShowNoteForm(false);
            }}
            data-testid="button-extract-notes"
            className={drawMode === "notes" ? "bg-blue-600 hover:bg-blue-700 text-white border-blue-700" : ""}
            title="Extract Notes: draw box over note block, AI creates N balloons on left edge"
          >
            <StickyNote className="w-4 h-4 mr-1" />
            {drawMode === "notes" ? "Drawing Notes…" : "Extract Notes"}
          </Button>

          {/* Extract BOM (bulk) */}
          <Button
            variant={drawMode === "bom" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setDrawMode(drawMode === "bom" ? false : "bom");
              setPending(null); setCurrentRect(null);
              setShowBomForm(false); setShowNoteForm(false);
            }}
            data-testid="button-extract-bom"
            className={drawMode === "bom" ? "bg-green-600 hover:bg-green-700 text-white border-green-700" : ""}
            title="Extract BOM: draw box over BOM table, AI creates N balloons on right edge"
          >
            <Table2 className="w-4 h-4 mr-1" />
            {drawMode === "bom" ? "Drawing BOM…" : "Extract BOM"}
          </Button>

          {/* Extract Weld (bulk) */}
          <Button
            variant={drawMode === "weld" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setDrawMode(drawMode === "weld" ? false : "weld");
              setPending(null); setCurrentRect(null);
              setShowBomForm(false); setShowNoteForm(false);
            }}
            data-testid="button-extract-weld"
            className={drawMode === "weld" ? "bg-purple-600 hover:bg-purple-700 text-white border-purple-700" : ""}
            title="Extract Weld: draw box over weld symbol area, AI creates NOTE+DIMENSION rows at anchor"
          >
            <Wrench className="w-4 h-4 mr-1" />
            {drawMode === "weld" ? "Drawing Weld…" : "Extract Weld"}
          </Button>

          {/* Quick-add BOM */}
          <Button
            variant="outline" size="sm"
            onClick={() => { setShowBomForm(v => !v); setShowNoteForm(false); }}
            data-testid="button-add-bom"
            title="Add BOM row (Item No × Qty — Description)"
          >
            <List className="w-4 h-4 mr-1" />BOM Row
          </Button>

          {/* Quick-add Note */}
          <Button
            variant="outline" size="sm"
            onClick={() => { setShowNoteForm(v => !v); setShowBomForm(false); }}
            data-testid="button-add-note"
            title="Add Note row"
          >
            <FileText className="w-4 h-4 mr-1" />Note Row
          </Button>

          {/* Zoom */}
          <div className="flex items-center gap-1 border border-border rounded px-1">
            <Button variant="ghost" size="icon" className="w-7 h-7"
              onClick={() => setScale(s => parseFloat(Math.max(0.1, s - 0.1).toFixed(2)))}
              data-testid="button-zoom-out" title="Zoom out (-)">
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs w-12 text-center text-muted-foreground font-mono">{Math.round(scale * 100)}%</span>
            <Button variant="ghost" size="icon" className="w-7 h-7"
              onClick={() => setScale(s => parseFloat(Math.min(4, s + 0.1).toFixed(2)))}
              data-testid="button-zoom-in" title="Zoom in (+)">
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <div className="w-px h-4 bg-border mx-0.5" />
            <Button variant="ghost" size="icon" className="w-7 h-7"
              onClick={fitToPage} data-testid="button-fit-page" title="Fit to page (0)">
              <Maximize2 className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="w-7 h-7"
              onClick={fitToWidth} data-testid="button-fit-width" title="Fit to width (F)">
              <AlignJustify className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Page nav */}
          <div className="flex items-center gap-1 border border-border rounded px-1">
            <Button variant="ghost" size="icon" className="w-7 h-7" disabled={currentPage <= 1}
              onClick={() => setCurrentPage(p => p - 1)} data-testid="button-prev-page">
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground w-20 text-center">
              Page {currentPage} / {totalPages || "?"}
            </span>
            <Button variant="ghost" size="icon" className="w-7 h-7" disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(p => p + 1)} data-testid="button-next-page">
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* ── BOM quick-add form ── */}
      {showBomForm && (
        <div className="border-b border-border bg-amber-50 px-4 py-2 flex items-end gap-2 flex-shrink-0" data-testid="bom-form">
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Item No</label>
            <Input value={bomItem} onChange={e => setBomItem(e.target.value)} className="h-7 w-16 text-xs" data-testid="bom-item" />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Qty</label>
            <Input value={bomQty} onChange={e => setBomQty(e.target.value)} className="h-7 w-16 text-xs" data-testid="bom-qty" />
          </div>
          <div className="space-y-0.5 flex-1">
            <label className="text-[10px] text-muted-foreground">Description</label>
            <Input value={bomDesc} onChange={e => setBomDesc(e.target.value)} placeholder="e.g. SHEET, ALUMINUM 5052" className="h-7 text-xs" data-testid="bom-desc" />
          </div>
          <Button size="sm" className="h-7 text-xs"
            onClick={async () => {
              await addBomRow(parseInt(bomItem) || 1, parseInt(bomQty) || 1, bomDesc);
              setBomDesc(""); setShowBomForm(false);
            }}
            disabled={!bomDesc.trim() || createBalloon.isPending}
            data-testid="bom-submit">
            Add
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowBomForm(false)}>✕</Button>
        </div>
      )}

      {/* ── Note quick-add form ── */}
      {showNoteForm && (
        <div className="border-b border-border bg-blue-50 px-4 py-2 flex items-end gap-2 flex-shrink-0" data-testid="note-form">
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Note #</label>
            <Input value={noteNum} onChange={e => setNoteNum(e.target.value)} className="h-7 w-16 text-xs" data-testid="note-num" />
          </div>
          <div className="space-y-0.5 flex-1">
            <label className="text-[10px] text-muted-foreground">Note Text</label>
            <Input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="e.g. UNLESS OTHERWISE SPECIFIED" className="h-7 text-xs" data-testid="note-text" />
          </div>
          <Button size="sm" className="h-7 text-xs"
            onClick={async () => {
              await addNoteRow(parseInt(noteNum) || 1, noteText);
              setNoteText(""); setShowNoteForm(false);
            }}
            disabled={!noteText.trim() || createBalloon.isPending}
            data-testid="note-submit">
            Add
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowNoteForm(false)}>✕</Button>
        </div>
      )}

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar — balloon list ── */}
        <aside className="w-48 border-r border-border bg-card flex flex-col flex-shrink-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Balloons ({balloons.length})
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sortedBalloons.length === 0 && (
              <p className="text-xs text-muted-foreground text-center mt-8 px-3 leading-relaxed">
                No balloons yet.<br />Click "Draw Balloon" to start.
              </p>
            )}
            {sortedBalloons.map(b => (
              <div
                key={b.id}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-border/50 hover:bg-secondary/50 transition-colors ${selectedBalloonId === b.id ? "bg-secondary" : ""}`}
                onClick={() => {
                  setSelectedBalloonId(b.id);
                  setCurrentPage(b.pageNumber);
                  setExtractResult({ rawReading: b.description, rowType: b.rowType, description: b.description, gdtType: b.gdtType, nominalValue: b.nominalValue, confidence: "high" });
                  setEditRowType(b.rowType);
                  setEditDescription(b.description);
                  setEditGdtType(b.gdtType);
                  setEditNominal(b.nominalValue);
                  setPending(null);
                }}
                data-testid={`balloon-item-${b.id}`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${b.rowType === "NOTE" ? "bg-blue-600" : "bg-primary"}`}>
                  <span className="text-[9px] font-bold text-white">{b.balloonNumber}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{b.description || "—"}</p>
                  <p className="text-[10px] text-muted-foreground">{b.rowType} · P{b.pageNumber}</p>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* ── PDF Canvas area ── */}
        <div
          ref={containerRef}
          className="overflow-auto bg-muted/30 p-4"
          style={{ flex: "1 1 0", minWidth: 0, maxWidth: "100%", cursor: panning ? "grabbing" : drawMode ? "default" : "grab" }}
          onMouseUp={() => { if (panningRef.current) { panningRef.current = false; panStartRef.current = null; setPanning(false); } }}
          onMouseLeave={() => { if (panningRef.current) { panningRef.current = false; panStartRef.current = null; setPanning(false); } }}
        >
          {!session && (
            <div className="flex items-center gap-2 text-muted-foreground mt-20">
              <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading session...</span>
            </div>
          )}
          {session && !pdfDoc && (
            <div className="flex items-center gap-2 text-muted-foreground mt-20">
              <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading PDF...</span>
            </div>
          )}
          {pdfDoc && (
            <div className="relative inline-block shadow-xl" style={{ lineHeight: 0 }}>
              <canvas ref={canvasRef} className="block" />
              <canvas
                ref={overlayRef}
                className="absolute inset-0"
                style={{ cursor: cursorStyle, touchAction: "none" }}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseLeave}
                data-testid="drawing-overlay"
              />
              {pageRendering && (
                <div className="absolute inset-0 bg-background/40 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right panel ── */}
        <aside className="w-72 border-l border-border bg-card flex flex-col flex-shrink-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex-shrink-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {selectedBalloonId ? "Edit Balloon" : pending ? "New Balloon" : "Result Panel"}
            </p>
          </div>

          {!hasResult && !pending && !extracting && (
            <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Crosshair className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No selection</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Click "Draw Balloon", drag a rectangle around a dimension, then the AI will extract it.
                </p>
              </div>
            </div>
          )}

          {bulkExtracting && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Bulk extracting with GPT-4o...</p>
              <p className="text-xs text-muted-foreground">Reading all rows, please wait</p>
            </div>
          )}

          {!bulkExtracting && bulkResult && !hasResult && !pending && !extracting && (
            <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-green-700" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {bulkResult.count} {bulkResult.type === "notes" ? "note" : bulkResult.type === "weld" ? "weld" : "BOM"} row{bulkResult.count !== 1 ? "s" : ""} extracted
                </p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {bulkResult.type === "weld" ? "Balloons placed at crop anchor." : "Balloons placed on left edge."}
                </p>
              </div>
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setBulkResult(null)}>Dismiss</Button>
            </div>
          )}

          {extracting && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Extracting with GPT-4o Vision...</p>
            </div>
          )}

          {!extracting && (extractResult || pending || selectedBalloonId) && (
            <div className="flex-1 overflow-y-auto flex flex-col">

              {(pending?.cropDataUrl || lastCropUrl) && (
                <div className="border-b border-border p-3">
                  <p className="text-xs text-muted-foreground mb-2">Crop preview</p>
                  <img src={pending?.cropDataUrl || lastCropUrl!} alt="Crop"
                    className="w-full rounded border border-border object-contain max-h-32 bg-white" />
                </div>
              )}

              {extractResult && (
                <div className="border-b border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground">AI Raw Reading</p>
                    {extractResult.confidence && !extractResult.error && (
                      <ConfidenceBadge c={extractResult.confidence as any} />
                    )}
                  </div>
                  {extractResult.mock && (
                    <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                      <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <p className="text-xs leading-relaxed">Mock mode — no API key. Go to Settings to add your OpenAI key.</p>
                    </div>
                  )}
                  {extractResult.error && (
                    <div className="flex items-start gap-2 text-red-700 bg-red-50 border border-red-200 rounded p-2">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <p className="text-xs leading-relaxed">{extractResult.error}</p>
                    </div>
                  )}
                  {!extractResult.error && extractResult.rawReading && (
                    <p className="text-xs text-foreground bg-muted/50 rounded p-2 leading-relaxed font-mono">
                      {extractResult.rawReading}
                    </p>
                  )}
                </div>
              )}

              <div className="p-3 space-y-3 flex-1">
                <p className="text-xs font-semibold text-muted-foreground">Edit Fields</p>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Col B — Row Type</label>
                  <div className="flex gap-2">
                    {["DIMENSION", "NOTE"].map(rt => (
                      <button key={rt} onClick={() => {
                          setEditRowType(rt);
                          if (rt === "NOTE" && !editNominal) setEditNominal("In Compliance");
                          if (rt === "DIMENSION" && editNominal === "In Compliance") setEditNominal("");
                        }}
                        className={`flex-1 text-xs py-1.5 rounded border font-medium transition-colors ${editRowType === rt ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:bg-secondary"}`}
                        data-testid={`button-rowtype-${rt.toLowerCase()}`}>{rt}</button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Col D — Description</label>
                  <ComboInput
                    value={editDescription}
                    onChange={setEditDescription}
                    options={editRowType === "NOTE" ? STANDARD_NOTES : DIMENSION_TERMS}
                    placeholder={editRowType === "NOTE" ? "Type to search notes..." : "Type to search dimensions..."}
                    data-testid="input-description"
                    onEnter={() => pending ? saveBalloon(balloonNumInput) : updateSelectedBalloon()}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Col F — GD&amp;T Type</label>
                  <ComboInput
                    value={editGdtType}
                    onChange={setEditGdtType}
                    options={GDT_TYPES}
                    placeholder="Type to search GD&T types..."
                    data-testid="input-gdt-type"
                    onEnter={() => pending ? saveBalloon(balloonNumInput) : updateSelectedBalloon()}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Col G — Nominal Value</label>
                  <ComboInput
                    value={editNominal}
                    onChange={setEditNominal}
                    options={editRowType === "NOTE" ? ["In Compliance"] : []}
                    placeholder={editRowType === "NOTE" ? "In Compliance" : "e.g. 0.438"}
                    data-testid="input-nominal"
                    onEnter={() => pending ? saveBalloon(balloonNumInput) : updateSelectedBalloon()}
                  />
                </div>
              </div>

              <div className="border-t border-border p-3 space-y-2 flex-shrink-0">
                {pending && (
                  <>
                    <div className="flex gap-2 items-center">
                      <div className="space-y-1 flex-1">
                        <label className="text-xs text-muted-foreground">Balloon #</label>
                        <Input value={balloonNumInput} onChange={e => setBalloonNumInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && balloonNumInput.trim()) { e.preventDefault(); saveBalloon(balloonNumInput); } }}
                          placeholder="e.g. 42" className="text-xs h-8" data-testid="input-balloon-number" />
                      </div>
                    </div>
                    <Button className="w-full text-xs h-8"
                      onClick={() => saveBalloon(balloonNumInput)}
                      disabled={!balloonNumInput.trim() || createBalloon.isPending}
                      data-testid="button-save-balloon">
                      {createBalloon.isPending
                        ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Saving...</>
                        : <><CheckCircle2 className="w-3 h-3 mr-1" />Save Balloon B{balloonNumInput}</>}
                    </Button>
                    <Button variant="outline" className="w-full text-xs h-8" onClick={cancelPending} data-testid="button-cancel">
                      Cancel
                    </Button>
                  </>
                )}

                {selectedBalloonId && !pending && (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Balloon #</label>
                      <Input value={editBalloonNum} onChange={e => setEditBalloonNum(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && editBalloonNum.trim()) { e.preventDefault(); updateSelectedBalloon(); } }}
                        placeholder="e.g. 42" className="text-xs h-8" data-testid="input-edit-balloon-number" />
                    </div>
                    <Button className="w-full text-xs h-8" onClick={updateSelectedBalloon}
                      disabled={updateBalloon.isPending || !editBalloonNum.trim()} data-testid="button-update-balloon">
                      {updateBalloon.isPending
                        ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Saving...</>
                        : <><CheckCircle2 className="w-3 h-3 mr-1" />Update Balloon</>}
                    </Button>
                    <Button variant="outline"
                      className="w-full text-xs h-8 text-destructive border-destructive/50 hover:bg-destructive/10"
                      onClick={() => deleteBalloon.mutate(selectedBalloonId)}
                      disabled={deleteBalloon.isPending} data-testid="button-delete-balloon">
                      <Trash2 className="w-3 h-3 mr-1" />Delete Balloon
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>

      </div>

      {/* ── Bottom instructions ── */}
      <div className="border-t border-border bg-card px-4 py-1.5 flex items-center gap-4 flex-shrink-0">
        <p className="text-xs text-muted-foreground">
          {drawMode === true
            ? "🖊 Click and drag to draw a rectangle around the dimension text"
            : drawMode === "notes"
            ? "🖊 Draw a box over the NOTES block — AI will extract all note lines as balloons on the LEFT edge"
            : drawMode === "bom"
            ? "🖊 Draw a box over the BOM table — AI will extract all rows as balloons on the LEFT edge"
            : drawMode === "weld"
            ? "🔩 Draw a box over the weld symbol — AI will extract NOTE + DIMENSION rows placed at the crop anchor"
            : "Click 'Draw Balloon' to start · Click a balloon to select/drag it · Pan by dragging empty space"}
        </p>
        {balloons.length > 0 && (
          <Badge variant="secondary" className="text-xs ml-auto">
            {balloons.length} balloon{balloons.length !== 1 ? "s" : ""} on this drawing
          </Badge>
        )}
      </div>

    </div>
  );
}
