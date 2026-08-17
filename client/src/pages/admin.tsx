import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Loader2, Plus, Pencil, Eye, Trash2, LogOut, Globe, Lock,
  Building, AlertTriangle, Copy,
} from "lucide-react";
import type { Empreendimento, Incorporadora } from "@shared/schema";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  duplicateProject,
  listIncorporadoras,
  createIncorporadora,
  temIncorporadoras,
  projectPath,
  slugReservado,
  slugify,
  MODO_LOCAL,
  getUser,
  onAuthChange,
  signIn,
  signUp,
  signOut,
  type IvmProject,
  type ProjectData,
} from "@/lib/ivm-store";

/**
 * Campo de texto do painel — `text-input` do DESIGN.md: fill `canvas-soft`,
 * hairline, raio 8px, corpo em 14px.
 */
const CAMPO =
  "rounded-[8px] border border-[var(--ed-line)] bg-[var(--ed-soft)] px-3 py-2 text-[14px] " +
  "text-white outline-none transition-colors placeholder:text-[var(--ed-dim)] " +
  "hover:border-white/25 focus:border-white/55";

/** Empreendimento em branco para um projeto novo (preenchido no editor). */
function blankProject(name: string, slug: string): ProjectData {
  const emp: Empreendimento = {
    id: slug,
    name,
    slug,
    address: "",
    neighborhood: "",
    lat: -8.9398,
    lng: -35.1696,
    terreno: "-",
    torres: "-",
    pavimentos: "",
    plantas: [],
    peDireito: "-",
    highlights: [],
    amenities: [],
    pontosDeInteresse: [],
    status: "Lançamento",
  };
  return {
    empreendimento: emp,
    config: {
      heading: 0,
      pitch: 0,
      roll: 0,
      scale: 1,
      heightOffset: 0,
      offsetEast: 0,
      offsetNorth: 0,
      placeholder: { width: 30, depth: 30, height: 96 },
      tzOffset: -3,
    },
  };
}

export default function AdminPage() {
  // No modo local não há sessão a verificar: entra direto no painel.
  const [signedIn, setSignedIn] = useState<boolean | null>(MODO_LOCAL ? true : null);

  useEffect(() => {
    if (MODO_LOCAL) return;
    let off: (() => void) | undefined;
    getUser()
      .then((u) => setSignedIn(!!u))
      .catch(() => setSignedIn(false));
    onAuthChange(setSignedIn).then((fn) => (off = fn));
    return () => off?.();
  }, []);

  if (signedIn === null) {
    return (
      <div className="tool flex h-screen items-center justify-center bg-[var(--ed-canvas)]">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }
  return signedIn ? <Dashboard /> : <AuthForm />;
}

function AuthForm() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const err = mode === "in" ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    if (err) setMsg(err);
    else if (mode === "up") setMsg("Conta criada. Confirme o e-mail (se solicitado) e faça login.");
  }

  return (
    <div className="tool flex h-screen items-center justify-center bg-[var(--ed-canvas)] p-4">
      {/* `ex-auth-form-card` do DESIGN.md: chrome de cartão + text-inputs. */}
      <form onSubmit={submit} className="tool-card w-full max-w-sm p-6 !bg-[var(--ed-soft)]">
        <div className="mb-1 flex items-center gap-2">
          <Lock className="h-4 w-4 text-white" />
          <span className="tool-eyebrow text-[var(--ed-dim)]">IVM Lite · Admin</span>
        </div>
        <h1 className="mb-5 text-[32px] font-normal leading-9 tracking-[-0.019em] text-white">
          {mode === "in" ? "Entrar" : "Criar conta"}
        </h1>
        <input
          type="email"
          placeholder="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${CAMPO} mb-2 w-full`}
        />
        <input
          type="password"
          placeholder="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`${CAMPO} mb-4 w-full`}
        />
        <button
          disabled={busy}
          className="tool-pill-primary flex w-full items-center justify-center gap-2 px-3 py-2 text-[14px]"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "in" ? "Entrar" : "Criar conta"}
        </button>
        {msg && <p className="mt-3 text-[12px] text-[var(--ed-accent-soft)]">{msg}</p>}
        <button
          type="button"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="mt-4 w-full text-center text-[14px] text-[var(--ed-dim)] transition-colors hover:text-white"
        >
          {mode === "in" ? "Criar uma conta" : "Já tenho conta — entrar"}
        </button>
      </form>
    </div>
  );
}

function Dashboard() {
  const [projects, setProjects] = useState<IvmProject[] | null>(null);
  const [incorporadoras, setIncorporadoras] = useState<Incorporadora[]>([]);
  const [migracaoOk, setMigracaoOk] = useState<boolean | null>(null);
  const [newName, setNewName] = useState("");
  const [incSel, setIncSel] = useState("");
  const [novaInc, setNovaInc] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    try {
      setProjects(await listProjects());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "erro ao listar");
      setProjects([]);
    }
  }
  async function reloadIncorporadoras() {
    try {
      setIncorporadoras(await listIncorporadoras());
    } catch {
      setIncorporadoras([]);
    }
  }
  useEffect(() => {
    reload();
    reloadIncorporadoras();
    temIncorporadoras().then(setMigracaoOk).catch(() => setMigracaoOk(false));
  }, []);

  async function create() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const nome = newName.trim();
      const base = slugify(nome) || "ivm";
      // Com incorporadora, o slug só precisa ser único dentro dela — a URL sai
      // limpa (/farias/residencial-aurora). Sem dona, precisa ser único no
      // mundo inteiro, então ganha um sufixo aleatório.
      const slug = incSel ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        await createProject(nome, slug, blankProject(nome, slug), false, incSel || null);
      } catch (e) {
        const m = (e instanceof Error ? e.message : "").toLowerCase();
        // Já existe um projeto com esse slug nesta incorporadora: repete com sufixo.
        if (!m.includes("duplicate") && !m.includes("unique")) throw e;
        const alt = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        await createProject(nome, alt, blankProject(nome, alt), false, incSel || null);
      }
      setNewName("");
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "erro ao criar");
    } finally {
      setBusy(false);
    }
  }

  async function criarIncorporadora() {
    const nome = novaInc.trim();
    if (!nome) return;
    const slug = slugify(nome);
    if (!slug) return setMsg("Nome inválido para virar endereço.");
    if (slugReservado(slug)) {
      return setMsg(`"${slug}" é um endereço reservado do sistema. Escolha outro nome.`);
    }
    setBusy(true);
    try {
      const inc = await createIncorporadora(nome, slug);
      setNovaInc("");
      await reloadIncorporadoras();
      setIncSel(inc.id);
      setMsg(`Incorporadora criada: /${inc.slug}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "erro ao criar incorporadora");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 5000);
    }
  }

  /** Move um projeto para outra incorporadora (muda a URL pública). */
  async function moverPara(p: IvmProject, incorporadoraId: string) {
    setBusy(true);
    try {
      await updateProject(p.id, { incorporadoraId: incorporadoraId || null });
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "erro ao mover");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tool min-h-screen bg-[var(--ed-canvas)] text-white">
      <header className="flex items-center justify-between border-b border-[var(--ed-line)] px-6 py-4">
        <div className="flex items-center gap-3">
          <Globe className="h-4 w-4 text-white" />
          {/* Display da spec: peso 400 com tracking negativo. A spec proíbe
              negritar títulos — o tamanho e o tracking fazem a hierarquia. */}
          <h1 className="text-[20px] font-normal tracking-[-0.02em] text-white">IVM Lite</h1>
          <span className="tool-eyebrow text-[var(--ed-dim)]">Admin</span>
          {MODO_LOCAL && (
            <span
              className="tool-eyebrow rounded-full border border-[rgba(255,122,23,0.45)] px-2 py-0.5 text-[var(--ed-accent-soft)]"
              title="Projetos gravados em data/projects/ — sem Supabase e sem login"
            >
              local
            </span>
          )}
        </div>
        {!MODO_LOCAL && (
          <button onClick={() => signOut()} className="tool-pill flex items-center gap-1.5 px-3 py-1.5 text-[14px]">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        )}
      </header>

      <main className="mx-auto max-w-6xl p-6">
        {/* A migração 0002 é aplicada à mão no Supabase; sem ela a plataforma
            funciona, mas só no endereço legado /v/{slug}. */}
        {migracaoOk === false && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-500/10 px-4 py-3 text-xs text-amber-200 ring-1 ring-amber-500/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <b>Migração pendente.</b> A tabela <code>incorporadoras</code> ainda não existe no
              Supabase. Aplique <code>supabase/migrations/0002_incorporadoras.sql</code> pelo SQL
              Editor para habilitar as URLs <code>/incorporadora/empreendimento</code>. Até lá os
              projetos continuam publicados em <code>/v/slug</code>.
            </div>
          </div>
        )}

        {/* Incorporadoras */}
        {migracaoOk !== false && (
          <div className="tool-card mb-4 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Building className="h-3.5 w-3.5 text-[var(--ed-dim)]" />
              <span className="tool-eyebrow text-white">Incorporadoras</span>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {incorporadoras.length === 0 ? (
                <span className="text-[14px] text-[var(--ed-dim)]">Nenhuma ainda — crie a primeira abaixo.</span>
              ) : (
                incorporadoras.map((i) => (
                  <span
                    key={i.id}
                    className="rounded-full border border-[var(--ed-line)] px-2.5 py-1 font-mono text-[12px] text-[var(--ed-body)]"
                  >
                    /{i.slug}
                    <span className="ml-1.5 font-sans text-[var(--ed-dim)]">{i.nome}</span>
                  </span>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={novaInc}
                onChange={(e) => setNovaInc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && criarIncorporadora()}
                placeholder="Nova incorporadora (ex: Farias Incorporadora)"
                className={CAMPO}
              />
              <button
                onClick={criarIncorporadora}
                disabled={busy || !novaInc.trim()}
                className="tool-pill shrink-0 px-4 py-1.5 text-[14px]"
              >
                Criar
              </button>
            </div>
            {novaInc.trim() && (
              <p className="mt-2 font-mono text-[12px] text-[var(--ed-dim)]">
                URL: /{slugify(novaInc)}/…
              </p>
            )}
          </div>
        )}

        {/* Novo projeto */}
        <div className="mb-3 flex flex-wrap gap-2">
          {incorporadoras.length > 0 && (
            <select
              value={incSel}
              onChange={(e) => setIncSel(e.target.value)}
              className={`${CAMPO} w-auto`}
            >
              <option value="" className="bg-[#0a0a0a]">Sem incorporadora</option>
              {incorporadoras.map((i) => (
                <option key={i.id} value={i.id} className="bg-[#0a0a0a]">
                  {i.nome}
                </option>
              ))}
            </select>
          )}
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Nome do novo IVM Lite (ex: Edifício Aurora)"
            className={`${CAMPO} min-w-[16rem] flex-1`}
          />
          {/* A pílula branca preenchida da tela — a ação principal do painel. */}
          <button
            onClick={create}
            disabled={busy}
            className="tool-pill-primary flex shrink-0 items-center gap-2 px-5 py-2 text-[14px]"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Criar
          </button>
        </div>
        {newName.trim() && (
          <p className="mb-3 font-mono text-[12px] text-[var(--ed-dim)]">
            URL:{" "}
            {incSel
              ? `/${incorporadoras.find((i) => i.id === incSel)?.slug}/${slugify(newName)}`
              : `/v/${slugify(newName)}-xxxx`}
          </p>
        )}

        {msg && <p className="mb-3 text-[14px] text-white">{msg}</p>}

        {projects === null ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        ) : projects.length === 0 ? (
          <div className="tool-card flex flex-col items-center gap-2 px-6 py-12 !bg-[var(--ed-soft)]">
            <span className="tool-eyebrow text-[var(--ed-dim)]">Nenhum projeto</span>
            <p className="text-[16px] text-[var(--ed-body)]">Crie seu primeiro empreendimento acima.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <div
                key={p.id}
                className="tool-card group overflow-hidden"
              >
                <div className="flex aspect-[16/9] w-full items-center justify-center overflow-hidden border-b border-[var(--ed-line)] bg-[var(--ed-soft)]">
                  {p.data?.empreendimento?.thumbnailUrl ? (
                    <img
                      src={p.data.empreendimento.thumbnailUrl}
                      alt={`Capa de ${p.name}`}
                      className="h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-[var(--ed-dim)]">
                      <Building className="h-8 w-8 opacity-50" />
                      <span className="tool-eyebrow">Sem capa</span>
                    </div>
                  )}
                </div>

                <div className="space-y-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {/* Peso 400 — a spec não negrita; o tamanho faz a hierarquia. */}
                      <span className="truncate text-[16px] font-normal tracking-[-0.01em] text-white">{p.name}</span>
                      {p.published ? (
                        <span className="tool-eyebrow rounded-full border border-white/30 px-2 py-0.5 text-white">
                          publicado
                        </span>
                      ) : (
                        <span className="tool-eyebrow rounded-full border border-[var(--ed-line)] px-2 py-0.5 text-[var(--ed-dim)]">
                          rascunho
                        </span>
                      )}
                      {p.data?.config?.modelUrl && (
                        <span className="tool-eyebrow rounded-full border border-[var(--ed-line)] px-2 py-0.5 text-[var(--ed-dim)]">
                          3d
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[12px] text-[var(--ed-dim)]">{projectPath(p)}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--ed-line)] pt-3">
                  {incorporadoras.length > 0 && (
                    <select
                      value={p.incorporadora?.id ?? ""}
                      onChange={(e) => moverPara(p, e.target.value)}
                      disabled={busy}
                      title="Incorporadora — define o início da URL pública"
                      className={`${CAMPO} min-w-0 flex-1 !py-1.5 !text-[12px]`}
                    >
                      <option value="" className="bg-[#0a0a0a]">Sem incorporadora</option>
                      {incorporadoras.map((i) => (
                        <option key={i.id} value={i.id} className="bg-[#0a0a0a]">
                          {i.nome}
                        </option>
                      ))}
                    </select>
                  )}
                  <Link
                    href={`/admin/${p.id}`}
                    className="tool-pill flex items-center gap-1.5 px-3.5 py-1.5 text-[14px]"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </Link>
                  <Link
                    href={projectPath(p)}
                    className="tool-pill flex items-center gap-1.5 px-3.5 py-1.5 text-[14px]"
                  >
                    <Eye className="h-3.5 w-3.5" /> Ver
                  </Link>
                  <button
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const novo = await duplicateProject(p.id);
                        if (novo) setMsg(`Duplicado: ${novo.name}`);
                        await reload();
                      } catch (e) {
                        setMsg(e instanceof Error ? e.message : "erro ao duplicar");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={busy}
                    title="Duplicar projeto"
                    className="tool-pill p-2 text-[var(--ed-dim)] hover:!text-white"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm(`Remover "${p.name}"?`)) {
                        await deleteProject(p.id);
                        reload();
                      }
                    }}
                    title="Remover projeto"
                    className="tool-pill p-2 text-red-300 hover:!border-red-400/50 hover:!bg-red-500/15"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
