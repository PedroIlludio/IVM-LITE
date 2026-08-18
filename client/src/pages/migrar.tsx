import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { localListProjects } from "@/lib/local-store";
import type { IvmProject } from "@/lib/ivm-store";

/**
 * Migração de um projeto LOCAL para o Supabase.
 *
 * Existe porque o app é dois bancos: em desenvolvimento os projetos vivem em
 * `data/projects/*.json` (rotas `/api/local/*`, que são `somenteDev`) e em
 * produção vivem na tabela `ivm_lites`. Um projeto calibrado na máquina —
 * torres, pavimentos, 106 unidades, câmeras — simplesmente não existe no ar,
 * e recadastrá-lo à mão significa refazer a calibração inteira.
 *
 * Roda no NAVEGADOR de propósito: as escritas em `ivm_lites` passam por RLS
 * (`owner = auth.uid()`), então precisam de uma sessão autenticada — e é o
 * navegador que a tem. Daqui ela também alcança o Storage; um script de
 * terminal precisaria da chave de serviço, que ninguém deveria guardar.
 *
 * O que ela faz, nesta ordem:
 *
 * 1. sobe cada arquivo `/uploads/…` que o projeto referencia para o bucket
 *    `ivm-assets`, sob o id do projeto;
 * 2. troca no JSON toda ocorrência do caminho local pela URL pública do
 *    Storage — sem isso o deploy referenciaria `/uploads/…`, que não existe em
 *    produção (a pasta é ignorada pelo git);
 * 3. cria a incorporadora do projeto, se houver — `ivm_lites.incorporadora_id`
 *    é chave estrangeira, e sem ela o banco recusa o projeto;
 * 4. grava o projeto em `ivm_lites`.
 *
 * É idempotente por arquivo (`upsert: true`) e não apaga nada do local: o
 * projeto continua onde estava, e a migração pode ser repetida se falhar no
 * meio.
 */

type Passo = { texto: string; estado: "ok" | "erro" | "fazendo" };

export default function MigrarPage() {
  const [projetos, setProjetos] = useState<IvmProject[]>([]);
  const [escolhido, setEscolhido] = useState<string>("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [logado, setLogado] = useState<string | null>(null);
  const [passos, setPassos] = useState<Passo[]>([]);
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0 });

  const log = (texto: string, estado: Passo["estado"] = "ok") =>
    setPassos((p) => [...p, { texto, estado }]);

  useEffect(() => {
    localListProjects()
      .then((ps) => {
        setProjetos(ps);
        setEscolhido(ps[0]?.id ?? "");
      })
      .catch(() => log("Não consegui listar os projetos locais.", "erro"));
    getSupabase()
      .then((sb) => sb.auth.getUser())
      .then(({ data }) => setLogado(data.user?.email ?? null))
      .catch(() => {});
  }, []);

  async function entrar() {
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) throw new Error(error.message);
      const { data } = await sb.auth.getUser();
      setLogado(data.user?.email ?? null);
      setSenha("");
    } catch (e) {
      log(`Login falhou: ${(e as Error).message}`, "erro");
    }
  }

  async function migrar() {
    const projeto = projetos.find((p) => p.id === escolhido);
    if (!projeto) return;
    setRodando(true);
    setPassos([]);
    try {
      const sb = await getSupabase();
      const { data: userData } = await sb.auth.getUser();
      const owner = userData.user?.id;
      if (!owner) throw new Error("Sem sessão — entre com a conta do Supabase antes.");

      // O JSON inteiro vira texto: é nele que os caminhos são trocados, de uma
      // vez só, sem precisar saber em que campo cada imagem estava.
      let bruto = JSON.stringify(projeto.data);
      const refs = Array.from(new Set(bruto.match(/\/uploads\/[^"]+/g) ?? []));
      setProgresso({ feitos: 0, total: refs.length });
      log(`${refs.length} arquivo(s) para subir.`);

      for (const ref of refs) {
        const nome = ref.split("/").pop()!;
        const resp = await fetch(ref);
        if (!resp.ok) {
          log(`${nome}: não encontrado no servidor local (HTTP ${resp.status})`, "erro");
          continue;
        }
        const blob = await resp.blob();
        const caminho = `${projeto.id}/${nome}`;

        /**
         * Três tentativas por arquivo.
         *
         * O Storage devolve 400 esporádico numa remessa longa — e com a trava
         * do fim (que recusa gravar o projeto se sobrar caminho local), um
         * único tropeço em sessenta anulava a migração inteira, incluindo os
         * cinquenta e nove uploads que deram certo. Repetir é barato; recomeçar
         * do zero não é.
         */
        let erroFinal: string | null = null;
        for (let tentativa = 1; tentativa <= 3; tentativa++) {
          const { error } = await sb.storage
            .from("ivm-assets")
            .upload(caminho, blob, { upsert: true, contentType: blob.type || undefined });
          if (!error) { erroFinal = null; break; }
          erroFinal = error.message || JSON.stringify(error);
          if (tentativa < 3) {
            log(`${nome}: ${erroFinal} — tentando de novo (${tentativa}/3)`, "fazendo");
            await new Promise((r) => setTimeout(r, 800 * tentativa));
          }
        }
        if (erroFinal) {
          log(`${nome}: ${erroFinal}`, "erro");
          continue;
        }
        const { data } = sb.storage.from("ivm-assets").getPublicUrl(caminho);
        // Troca TODAS as ocorrências: a mesma imagem costuma aparecer em mais
        // de um lugar (galeria, tipologia, nível).
        bruto = bruto.split(ref).join(data.publicUrl);
        setProgresso((p) => ({ ...p, feitos: p.feitos + 1 }));
        log(`${nome} → Storage`);
      }

      /**
       * Trava: nenhum caminho local pode sobreviver no JSON.
       *
       * `/uploads/…` só existe na máquina de quem edita — a pasta é ignorada
       * pelo git e não vai para o deploy. Gravar o projeto com um caminho
       * desses publica uma vitrine com imagem quebrada, e o erro só apareceria
       * para o cliente. Melhor parar aqui: os arquivos que subiram continuam no
       * bucket, então repetir a migração só reenvia o que faltou.
       */
      const faltaram = Array.from(new Set(bruto.match(/\/uploads\/[^"]+/g) ?? []));
      if (faltaram.length > 0) {
        for (const f of faltaram) log(`ficou local: ${f.split("/").pop()}`, "erro");
        throw new Error(
          `Migração interrompida: ${faltaram.length} arquivo(s) não subiram. ` +
          "Clique em Migrar de novo — só os que faltam serão reenviados.",
        );
      }

      /**
       * A incorporadora vai ANTES, e com o mesmo id.
       *
       * `ivm_lites.incorporadora_id` é chave estrangeira: gravar o projeto
       * apontando para uma incorporadora que não existe no destino é recusado
       * pelo banco. Preservar o id (em vez de criar outra) mantém o vínculo
       * exatamente como estava e o endereço público `/{incorporadora}/{slug}`
       * continua valendo.
       */
      const inc = projeto.incorporadora;
      if (inc) {
        const { error: errInc } = await sb.from("incorporadoras").upsert(
          {
            id: inc.id,
            slug: inc.slug,
            nome: inc.nome,
            logo_url: inc.logoUrl ?? null,
            tema: inc.tema ?? {},
            owner,
          },
          { onConflict: "id" },
        );
        if (errInc) throw new Error(`incorporadora "${inc.nome}": ${errInc.message}`);
        log(`Incorporadora ${inc.nome} → incorporadoras`);
      }

      log("Gravando o projeto em ivm_lites…", "fazendo");
      const { error: errProj } = await sb.from("ivm_lites").upsert(
        {
          id: projeto.id,
          slug: projeto.slug,
          name: projeto.name,
          published: projeto.published,
          incorporadora_id: projeto.incorporadora?.id ?? null,
          data: JSON.parse(bruto),
          owner,
        },
        { onConflict: "id" },
      );
      if (errProj) throw new Error(errProj.message);

      log(`Pronto. O projeto responde em /v/${projeto.slug}`);
    } catch (e) {
      log((e as Error).message, "erro");
    } finally {
      setRodando(false);
    }
  }

  const campo = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-8 font-sans">
      <div>
        <h1 className="text-xl font-semibold">Migrar projeto local → Supabase</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Sobe os arquivos para o bucket <code>ivm-assets</code>, troca os caminhos
          <code> /uploads/…</code> pelas URLs públicas e grava o projeto em
          <code> ivm_lites</code>. Não apaga nada do local.
        </p>
      </div>

      <section className="space-y-2 rounded border border-neutral-200 p-4">
        <h2 className="text-sm font-semibold">1. Conta do Supabase</h2>
        {logado ? (
          <p className="text-sm text-green-700">Conectado como {logado}</p>
        ) : (
          <div className="flex gap-2">
            <input className={campo} placeholder="e-mail" value={email}
              onChange={(e) => setEmail(e.target.value)} />
            <input className={campo} type="password" placeholder="senha" value={senha}
              onChange={(e) => setSenha(e.target.value)} />
            <button onClick={entrar}
              className="shrink-0 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
              Entrar
            </button>
          </div>
        )}
        <p className="text-xs text-neutral-500">
          A escrita em <code>ivm_lites</code> passa por RLS (<code>owner = auth.uid()</code>),
          então exige sessão. A senha vai direto para o Supabase.
        </p>
      </section>

      <section className="space-y-2 rounded border border-neutral-200 p-4">
        <h2 className="text-sm font-semibold">2. Projeto</h2>
        <select className={campo} value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
          {projetos.map((p) => (
            <option key={p.id} value={p.id}>{p.name} — /v/{p.slug}</option>
          ))}
        </select>
      </section>

      <button
        onClick={migrar}
        disabled={rodando || !logado || !escolhido}
        className="w-full rounded bg-teal-600 px-4 py-2 font-semibold text-white disabled:opacity-40"
      >
        {rodando ? `Migrando… ${progresso.feitos}/${progresso.total}` : "Migrar para o Supabase"}
      </button>

      {passos.length > 0 && (
        <ol className="max-h-80 space-y-1 overflow-y-auto rounded border border-neutral-200 p-3 font-mono text-xs">
          {passos.map((p, i) => (
            <li key={i} className={
              p.estado === "erro" ? "text-red-600"
              : p.estado === "fazendo" ? "text-neutral-500"
              : "text-neutral-800"}>
              {p.estado === "erro" ? "✕" : "·"} {p.texto}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
