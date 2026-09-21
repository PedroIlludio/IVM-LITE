import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import AdminPage from "@/pages/admin";
import IvmEditorPage from "@/pages/ivm-editor";
import IvmViewPage from "@/pages/ivm-view";

function Router() {
  return (
    <Switch>
      {/* A raiz leva ao painel: todo conteúdo vem dos projetos no Supabase. */}
      <Route path="/">
        <Redirect to="/admin" />
      </Route>
      {/* Plataforma IVM Lite (Supabase): admin + editor + páginas públicas. */}
      <Route path="/admin" component={AdminPage} />
      <Route path="/admin/:id" component={IvmEditorPage} />
      {/* Endereço legado (projeto sem incorporadora definida). */}
      <Route path="/v/:slug" component={IvmViewPage} />
      {/*
        URL pública definitiva: /incorporadora/empreendimento.
        Precisa ficar POR ÚLTIMO — é um padrão de dois segmentos que casaria
        com /admin/:id e /v/:slug também. O <Switch> resolve pela ordem, e os
        slugs reservados (SLUGS_RESERVADOS em lib/ivm-store.ts) impedem criar
        uma incorporadora que sequestre uma rota do sistema.
      */}
      <Route path="/:incorporadora/:slug" component={IvmViewPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
