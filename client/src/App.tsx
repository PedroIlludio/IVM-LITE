import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import ExplorarPage from "@/pages/explorar";
import EditorPage from "@/pages/editor";
import AdminPage from "@/pages/admin";
import IvmEditorPage from "@/pages/ivm-editor";
import IvmViewPage from "@/pages/ivm-view";
import MigrarPage from "@/pages/migrar";

function Router() {
  return (
    <Switch>
      {/*
        Em desenvolvimento a raiz cai direto no painel: abrir o localhost é
        sempre para ir trabalhar num projeto, e a landing ficava no caminho.
        Em produção `/` continua sendo a landing pública da plataforma.
      */}
      {/*
        A raiz leva ao PAINEL, em qualquer ambiente.

        Em produção ela abria a `LandingPage` — conteúdo fixo do piloto Quinta,
        escrito no código, que não consulta o banco e não representa nenhum
        projeto real da plataforma. Era o que todo visitante via primeiro, e
        anunciava um empreendimento de outra incorporadora.

        As vitrines de verdade têm endereço próprio (`/{incorporadora}/{slug}`),
        e é esse link que se manda ao cliente. A raiz, portanto, é a porta de
        quem opera — não uma vitrine.
      */}
      <Route path="/">
        <Redirect to="/admin" />
      </Route>
      {/* Piloto local (Quinta hardcoded) — base/template da experiência. */}
      <Route path="/explorar" component={ExplorarPage} />
      <Route path="/editor" component={EditorPage} />
      {/* Plataforma IVM Lite (Supabase): admin + editor + páginas públicas. */}
      <Route path="/admin" component={AdminPage} />
      {/* Ferramenta de migração local → Supabase. Só em dev: ela lê
          `/api/local/*`, que não existe em produção. */}
      {import.meta.env.DEV && <Route path="/migrar" component={MigrarPage} />}
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
