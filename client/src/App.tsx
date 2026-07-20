import { Router, Route, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Home from "@/pages/Home";
import DrawingTool from "@/pages/DrawingTool";
import Settings from "@/pages/Settings";

// Restore OpenRouter key + mode from localStorage on every app load
const storedKey   = localStorage.getItem("__HCS_OPENROUTER_KEY");
const storedMode  = localStorage.getItem("__HCS_OPENROUTER_MODE") || "normal";
const storedScans = Number(localStorage.getItem("__HCS_SCAN_COUNT") || "1");
if (storedKey)  (window as any).__HCS_OPENROUTER_KEY  = storedKey;
(window as any).__HCS_OPENROUTER_MODE  = storedMode;
(window as any).__HCS_SCAN_COUNT       = storedScans;

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/session/:id" component={DrawingTool} />
          <Route path="/settings" component={Settings} />
        </Switch>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}
