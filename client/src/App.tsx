import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import ExplorarPage from "@/pages/explorar";
import EditorPage from "@/pages/editor";
import AdminPage from "@/pages/admin";
import IvmEditorPage from "@/pages/ivm-editor";
import IvmViewPage from "@/pages/ivm-view";

function Router() {
  return (
    <Switch>
      {/*
        Em desenvolvimento a raiz cai direto no painel: abrir o localhost é
        sempre para ir trabalhar num projeto, e a landing ficava no caminho.
        Em produção `/` continua sendo a landing pública da plataforma.
      */}
      <Route path="/">
        {import.meta.env.DEV ? <Redirect to="/admin" /> : <LandingPage />}
      </Route>
      {/* Piloto local (Quinta hardcoded) — base/template da experiência. */}
      <Route path="/explorar" component={ExplorarPage} />
      <Route path="/editor" component={EditorPage} />
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
