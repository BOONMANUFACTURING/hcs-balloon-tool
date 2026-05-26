import { Router, Route, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Home from "@/pages/Home";
import DrawingTool from "@/pages/DrawingTool";
import Settings from "@/pages/Settings";

// Restore API key from localStorage on every app load — build 20260526c
const stored = localStorage.getItem("hcs_openai_key");
if (stored) (window as any).__HCS_OPENAI_KEY = stored;

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
