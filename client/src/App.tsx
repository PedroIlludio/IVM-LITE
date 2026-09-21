import { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";

/* Cada rota baixa só a sua própria interface. Antes, abrir uma vitrine pública
   também carregava o editor administrativo inteiro e suas ferramentas 3D. */
const NotFound = lazy(() => import("@/pages/not-found"));
const AdminPage = lazy(() => import("@/pages/admin"));
const IvmEditorPage = lazy(() => import("@/pages/ivm-editor"));
const IvmViewPage = lazy(() => import("@/pages/ivm-view"));
const MigrarPage = lazy(() => import("@/pages/migrar"));

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
        {/*
          Só o <Router /> vai dentro do anteparo.

          O <Toaster /> fica FORA de propósito: ele é o canal por onde o resto
          do sistema avisa o que aconteceu, e um aviso preso dentro da árvore
          que acabou de quebrar não chega a ninguém.
        */}
        <ErrorBoundary area="rota">
          <Suspense fallback={
            <div className="grid min-h-[100dvh] place-items-center bg-slate-950 text-sm text-white/70">
              Carregando…
            </div>
          }>
            <Router />
          </Suspense>
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
