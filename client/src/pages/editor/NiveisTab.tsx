import { useMemo } from "react";
import {
  Camera, ChevronDown, ChevronUp, Copy, Eye, LayoutGrid, Plus, Scissors, Trash2, Upload,
} from "lucide-react";
import type { GizmoModo } from "@/components/Scene3D";
import { genId } from "@/lib/ivm-store";
import { pavimentos, type NivelDef, type PavimentosCfg } from "@/lib/pavimentos";
import { torreLabel, type TorreDef } from "@/lib/unidades";
import { volumeDaTorre } from "@/lib/unidades3d";
import { CAMPO, Linha, NumIn, Section, Slider } from "./campos";

/**
 * Rótulo do próximo nível: incrementa o primeiro número do nome. "5º
 * Pavimento" vira "6º Pavimento", "Pav 0" vira "Pav 1". Sem número no nome
 * (Rooftop, Térreo), marca como cópia — inventar um número ali seria pior.
 */
function proximoRotulo(s: string): string {
  const m = s.match(/\d+/);
  if (!m || m.index == null) return `${s} (cópia)`;
  return s.slice(0, m.index) + String(Number(m[0]) + 1) + s.slice(m.index + m[0].length);
}

/**
 * Aba "Níveis e cortes".
 *
 * O modelo importado é o empreendimento completo, sem lajes: o que revela um
 * andar é um plano de recorte. Até aqui esses planos eram DERIVADOS de uma
 * escada uniforme (base + altura do nível × n) aplicada ao modelo inteiro —
 * o que só descreve um prédio único de pés-direitos iguais.
 *
 * Esta aba torna cada nível um objeto editável: altura própria (arrastável na
 * cena), escopo próprio (o empreendimento todo ou a pegada de um bloco) e
 * câmera própria. A escada automática continua existindo como GERADOR, para
 * a lista não começar vazia nem ter de ser digitada nível a nível.
 */
export function NiveisTab({
  niveis, onNiveis, pavCfg, torres, selId, onSel, gizmoInfo,
  gizmoModo, onGizmoModo, escalaModelo, plantas, onVer, onEnviarPlanta,
  pivoNivel, onPivoNivel, onPavCfg,
}: {
  niveis: NivelDef[];
  onNiveis: (n: NivelDef[]) => void;
  pavCfg: PavimentosCfg;
  /** Grava o enquadramento dos cortes, que vale para a sequência inteira. */
  onPavCfg: (p: Partial<PavimentosCfg>) => void;
  torres: TorreDef[];
  selId: string | null;
  onSel: (id: string | null) => void;
  gizmoInfo: string | null;
  gizmoModo: GizmoModo;
  onGizmoModo: (m: GizmoModo) => void;
  /** Escala do GLB: converte metros do modelo em metros do mundo. */
  escalaModelo: number;
  /** Plantas já cadastradas no projeto, para reaproveitar sem novo upload. */
  /**
   * Plantas oferecidas no seletor, já unificadas por `plantasDoProjeto`.
   *
   * Antes chegava só `emp.plantas` — o array LEGADO. Num projeto que cadastrou
   * as plantas em Tipologias (o caminho atual), ele vinha vazio, o seletor nem
   * aparecia e sobrava só o botão de enviar. O usuário reenviava um arquivo que
   * já estava no projeto, criando um segundo asset e uma segunda verdade sobre
   * o mesmo desenho.
   */
  plantas: { area: string; url: string }[];
  /** Qual altura o pivô do 3D manipula: a do corte ou a da planta. */
  pivoNivel: "corte" | "planta";
  onPivoNivel: (m: "corte" | "planta") => void;
  onVer: (n: NivelDef, comCamera?: boolean) => void;
  onEnviarPlanta: (id: string) => void;
}) {
  /**
   * Com mais de uma torre, o gerador nasce apontado para a primeira.
   *
   * Gerar "para o prédio inteiro" num projeto de vários blocos produz um
   * "5º Pavimento" só, que corta as duas torres e conta as unidades das duas
   * — dois andares distintos tratados como um. É o erro mais fácil de cometer
   * aqui, então o padrão deixa de convidar a ele.
   */
  /**
   * Bloco que os níveis novos herdam. Com várias torres aponta para a primeira:
   * um nível sem bloco corta e conta as torres todas juntas, que é o erro mais
   * fácil de cometer aqui.
   */
  const torreGerar = torres.length > 1 ? torres[0].id : "";

  /** Escada automática em vigor enquanto ninguém editou nada. */
  const automaticos = useMemo(() => pavimentos(pavCfg), [pavCfg]);
  const usandoAutomatico = niveis.length === 0;
  /** Níveis que ainda não pertencem a bloco nenhum. */
  const semBloco = niveis.filter((n) => !n.torreId);

  function patch(id: string, p: Partial<NivelDef>) {
    onNiveis(niveis.map((n) => (n.id === id ? { ...n, ...p } : n)));
  }

  /**
   * Retângulo com a pegada de um bloco já calibrado — atalho para quem quer
   * exatamente uma torre. Copia os números; a área continua livre depois.
   */
  function areaDaTorre(torreId: string): NivelDef["area"] | undefined {
    const i = torres.findIndex((t) => t.id === torreId);
    if (i < 0) return undefined;
    const v = volumeDaTorre(torres[i], i, torres.length);
    return { x: v.x, y: v.y, comprimento: v.comprimento, largura: v.largura, rot: v.rot ?? 0 };
  }

  /**
   * Duplica um nível: mesma área, mesmo tamanho, mesmo lugar — só a altura
   * sobe um nível.
   *
   * É o gesto que monta uma escada irregular sem recalibrar nada: acerta-se o
   * primeiro pavimento (posição e tamanho do retângulo, que é o trabalho
   * chato) e os de cima saem dele.
   *
   * A cópia nasce NA MESMA ALTURA da original — como a duplicação de unidade e
   * a de pavimento. Ela subia um `nivelM` automaticamente, e esse palpite só
   * acertava quando todos os pés-direitos eram iguais; mas a razão desta aba
   * existir é justamente o prédio cujos níveis NÃO são uniformes. Num
   * pavimento de transição ou num térreo mais alto, a cópia caía no lugar
   * errado e o trabalho virava descobrir de quanto foi o erro.
   *
   * Empilhada, o gesto seguinte é único: arrastar a seta azul até a laje certa,
   * com o prédio se abrindo ao vivo. O rótulo e o número do pavimento já vêm
   * incrementados, que é a parte que não tem ambiguidade.
   */
  function duplicar(i: number) {
    const o = niveis[i];
    const novo: NivelDef = {
      ...o,
      id: genId("nivel"),
      label: proximoRotulo(o.label),
      // Mesma altura da original — ver o comentário acima.
      cutZ: o.cutZ,
      camH: o.camH,
      pavimento: o.tipo === "unidades" && o.pavimento != null ? o.pavimento + 1 : o.pavimento,
      // Cópias próprias: sem isto, mexer no retângulo de um mexeria no do outro.
      // Vale para os DOIS retângulos — o do corte e o da planta. O `...o` acima
      // já traz a planta inteira (desenho, altura, opacidade), que é o que se
      // quer: a cópia nasce com a mesma planta, no mesmo lugar e tamanho, e só
      // falta subir. Mas o objeto do retângulo viria compartilhado.
      area: o.area ? { ...o.area } : undefined,
      plantaArea: o.plantaArea ? { ...o.plantaArea } : undefined,
      // A câmera não precisa de tratamento: sendo derivada do centro da área e
      // da altura do corte, ela acompanha a cópia sozinha.
    };
    // Acima do original na lista, que vai do topo para a base.
    onNiveis([...niveis.slice(0, i), novo, ...niveis.slice(i)]);
    onSel(novo.id);
  }

  function novoNivel() {
    const id = genId("nivel");
    const acima = niveis[0]?.cutZ ?? pavCfg.baseZ + pavCfg.nivelM;
    onNiveis([
      { id, label: "Novo nível", tipo: "unidades", cutZ: acima + pavCfg.nivelM, camH: 1.6,
        torreId: torreGerar || undefined,
        // Nascer com a pegada do bloco escolhido poupa o ajuste mais chato.
        area: torreGerar ? areaDaTorre(torreGerar) : undefined },
      ...niveis,
    ]);
    onSel(id);
  }

  function mover(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= niveis.length) return;
    const n = [...niveis];
    [n[i], n[j]] = [n[j], n[i]];
    onNiveis(n);
  }

  return (
    <>
      <p className="text-[10px] leading-relaxed text-white/35"
        title="O modelo é uma casca sem lajes: quem revela um andar é um plano de corte.">
        Cada nível tem a sua altura, o seu escopo (o prédio todo ou um bloco) e
        a sua câmera.
      </p>

      {/*
        Enquadramento dos cortes — do PROJETO.

        A ajuda dos níveis já mandava o usuário "à distância definida em
        Enquadramento", e essa seção simplesmente não existia: `pavimentosCfg`
        nunca era escrito em lugar nenhum do editor. Os campos por nível diziam
        "0 = a do projeto" apontando para um valor inalcançável, e o giro não
        tinha controle nenhum — nem por nível, nem por projeto.

        A câmera do corte é DERIVADA (centro da área, olhando para baixo). Estes
        três números são tudo o que ela precisa, e valem para a sequência
        inteira: é o que faz subir de pavimento parecer um movimento só.
      */}
      <Section title="Enquadramento dos cortes" aberta={false}>
        <p className="text-[10px] leading-relaxed text-white/35">
          Vale para todos os níveis. Cada um pode sobrepor abaixo, quando um
          pavimento pedir outro alcance ou outro ângulo.
        </p>
        <NumIn label="Distância (m)" v={pavCfg.camDist} step={5}
          onChange={(v) => onPavCfg({ camDist: Math.max(5, v) })} />
        <NumIn label="Inclinação (°)" v={pavCfg.camPitch} step={5}
          onChange={(v) => onPavCfg({ camPitch: Math.max(-90, Math.min(-1, v)) })} />
        <NumIn label="Giro (°)" v={pavCfg.camGiro} step={15}
          onChange={(v) => onPavCfg({ camGiro: v })} />
        <p className="text-[9px] leading-relaxed text-white/30">
          <b>−90°</b> é a vista de cima, a planta baixa pura. Valores menores
          inclinam e deixam ver o volume. O giro parte do eixo maior do
          retângulo do corte — a planta entra na tela deitada no sentido em que
          é mais longa.
        </p>
      </Section>

      <Section title={`Níveis (${usandoAutomatico ? `${automaticos.length} automáticos` : niveis.length})`}>
        {usandoAutomatico && (
          <div className="rounded-[3px] border border-amber-400/25 bg-amber-400/[0.06] p-2">
            <p className="text-[10px] leading-relaxed text-amber-200/80">
              Este projeto ainda usa a escada automática — os {automaticos.length} níveis
              abaixo são calculados a partir do modelo, não editáveis. Crie um
              nível para começar a lista que você controla.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {automaticos.map((p) => (
                <span key={p.id} className="rounded-[3px] bg-white/[0.06] px-1.5 py-[2px] text-[9px] text-white/45">
                  {p.label}{p.cutZ != null && ` · ${p.cutZ.toFixed(1)}`}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Sem bloco, a régua da vitrine não tem o que separar — e é aqui que
            isso se descobre, não depois de publicar. */}
        {torres.length > 1 && semBloco.length > 0 && (
          <div className="rounded-[3px] border border-amber-400/25 bg-amber-400/[0.06] p-2">
            <p className="text-[10px] leading-relaxed text-amber-200/80">
              <b>{semBloco.length}</b> nível(is) sem bloco. Na vitrine eles caem
              todos numa lista só — sem as abas de bloco — e contam as unidades
              das {torres.length} torres juntas.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {torres.map((t) => (
                <button key={t.id}
                  onClick={() => {
                    if (!confirm(`Atribuir "${t.label}" aos ${semBloco.length} nível(is) sem bloco?`)) return;
                    const ids = new Set(semBloco.map((n) => n.id));
                    onNiveis(niveis.map((n) => (ids.has(n.id) ? { ...n, torreId: t.id } : n)));
                  }}
                  className="rounded-[3px] bg-white/10 px-2 py-1 text-[10px] text-white/80 hover:bg-white/20">
                  Atribuir a {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={novoNivel}
          className="flex w-full items-center justify-center gap-1.5 rounded-[3px] bg-teal-500 px-3 py-1.5 text-[11px] font-semibold text-[#0a0a0a] hover:bg-teal-400">
          <Plus className="h-3.5 w-3.5" /> Novo nível
        </button>

        {niveis.map((n, i) => {
          const aberto = selId === n.id;
          return (
            <div key={n.id}
              className={`rounded-[3px] border bg-black/20 ${aberto ? "border-teal-400/50" : "border-white/[0.08]"}`}>
              <div className="flex items-center gap-1.5 p-1.5">
                <Scissors className={`h-3 w-3 shrink-0 ${n.cutZ == null ? "text-white/20" : "text-teal-400/70"}`} />
                <button onClick={() => onSel(aberto ? null : n.id)}
                  className={`min-w-0 flex-1 truncate text-left text-[11px] ${aberto ? "text-teal-300" : "text-white/85"} hover:text-teal-300`}>
                  {n.label}
                  <span className="text-white/30">
                    {n.torreId
                      ? <span className="text-teal-300/70"> · {torreLabel(n.torreId, torres)}</span>
                      : torres.length > 1 && <span className="text-amber-300/70"> · sem bloco</span>}
                    {" · "}{n.cutZ == null ? "sem corte" : `Z ${n.cutZ.toFixed(1)}`}
                    {n.area && ` · ${Math.round(n.area.comprimento)}×${Math.round(n.area.largura)} m`}
                  </span>
                </button>
                {n.plantaUrl && <LayoutGrid className="h-3 w-3 shrink-0 text-teal-400/60" />}
                <button onClick={() => { onSel(n.id); onVer(n); }} title="Ver na cena"
                  className="shrink-0 rounded-[3px] p-1 text-white/40 hover:bg-white/10 hover:text-white">
                  <Eye className="h-3 w-3" />
                </button>
                <button onClick={() => duplicar(i)}
                  title="Duplicar — mesma área, tamanho e altura; suba com a seta azul"
                  className="shrink-0 rounded-[3px] p-1 text-white/40 hover:bg-white/10 hover:text-teal-300">
                  <Copy className="h-3 w-3" />
                </button>
                <div className="flex shrink-0 flex-col">
                  <button onClick={() => mover(i, -1)} disabled={i === 0}
                    className="text-white/30 hover:text-white disabled:opacity-20"><ChevronUp className="h-3 w-3" /></button>
                  <button onClick={() => mover(i, 1)} disabled={i === niveis.length - 1}
                    className="text-white/30 hover:text-white disabled:opacity-20"><ChevronDown className="h-3 w-3" /></button>
                </div>
                <button
                  onClick={() => {
                    onNiveis(niveis.filter((x) => x.id !== n.id));
                    if (selId === n.id) onSel(null);
                  }}
                  className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              {aberto && (
                <div className="space-y-1.5 border-t border-white/[0.06] p-1.5">
                  <Linha label="Nome">
                    <input value={n.label} onChange={(e) => patch(n.id, { label: e.target.value })} className={CAMPO} />
                  </Linha>
                  <Linha label="Tipo">
                    <select value={n.tipo} onChange={(e) => patch(n.id, { tipo: e.target.value as NivelDef["tipo"] })}
                      className={CAMPO}>
                      <option value="unidades" className="bg-[#0a0a0a]">Pavimento de unidades</option>
                      <option value="rooftop" className="bg-[#0a0a0a]">Rooftop</option>
                      <option value="terreo" className="bg-[#0a0a0a]">Térreo</option>
                      <option value="subsolo" className="bg-[#0a0a0a]">Subsolo</option>
                    </select>
                  </Linha>
                  {n.tipo === "unidades" && (
                    <NumIn label="Nº do pavimento" v={n.pavimento ?? 1} step={1}
                      onChange={(v) => patch(n.id, { pavimento: Math.max(0, Math.round(v)) })} />
                  )}
                  {torres.length > 0 && (
                    <>
                      <Linha label="Bloco">
                        <select value={n.torreId ?? ""}
                          onChange={(e) => patch(n.id, { torreId: e.target.value || undefined })}
                          className={CAMPO}>
                          <option value="" className="bg-[#0a0a0a]">— o empreendimento —</option>
                          {torres.map((t) => (
                            <option key={t.id} value={t.id} className="bg-[#0a0a0a]">{t.label}</option>
                          ))}
                        </select>
                      </Linha>
                      <p className="text-[10px] leading-relaxed text-white/30">
                        Separa a régua da vitrine por bloco e filtra as unidades:
                        este nível passa a contar só as unidades deste bloco.
                      </p>
                    </>
                  )}
                  <Linha label="Descrição" empilhado>
                    <textarea rows={2} value={n.descricao ?? ""}
                      placeholder="Aparece no cartão da vitrine. Vazio = não aparece."
                      onChange={(e) => patch(n.id, { descricao: e.target.value || undefined })}
                      className={`${CAMPO} resize-y`} />
                  </Linha>

                  <div className="pt-0.5 text-[9px] uppercase tracking-widest text-white/25">Corte</div>
                  <Linha label="Cortar">
                    <select
                      value={n.cutZ == null ? "nao" : "sim"}
                      onChange={(e) => patch(n.id, { cutZ: e.target.value === "nao" ? null : pavCfg.baseZ + pavCfg.nivelM })}
                      className={CAMPO}>
                      <option value="sim" className="bg-[#0a0a0a]">Cortar nesta altura</option>
                      <option value="nao" className="bg-[#0a0a0a]">Sem corte (prédio inteiro)</option>
                    </select>
                  </Linha>
                  {n.cutZ != null && (
                    <>
                      <NumIn label="Altura do corte (Z)" v={n.cutZ} step={0.5}
                        onChange={(v) => patch(n.id, { cutZ: v })} />
                      <p className="text-[10px] leading-relaxed text-white/30">
                        Arraste a <b className="text-[#4aa8ff]">seta azul</b> na cena para
                        ajustar — o prédio se abre ao vivo. <b>Ctrl</b> encaixa de metro
                        em metro.
                      </p>

                      {/* Ferramenta do pivô, aqui e não só no teclado: com o
                          retângulo, R (redimensionar) é o gesto mais usado. */}
                      <div className="flex gap-1">
                        {([["mover", "Mover", "W"], ["girar", "Girar", "E"], ["escalar", "Tamanho", "R"]] as const)
                          .map(([m, l, tecla]) => (
                            <button key={m} onClick={() => onGizmoModo(m)}
                              disabled={!n.area && m !== "mover"}
                              title={!n.area && m !== "mover"
                                ? "Sem área, o corte só tem altura para ajustar"
                                : `${l} (${tecla})`}
                              className={`flex-1 rounded-[3px] px-1 py-1 text-[10px] disabled:opacity-25 ${
                                gizmoModo === m ? "bg-teal-500 font-semibold text-[#0a0a0a]" : "bg-white/8 text-white/55 hover:bg-white/15"
                              }`}>
                              {l} <span className="text-[9px] opacity-50">{tecla}</span>
                            </button>
                          ))}
                      </div>
                      {gizmoInfo && (
                        <p className="rounded-[3px] bg-black/30 px-1.5 py-1 font-mono text-[10px] text-teal-300">
                          {gizmoInfo}
                        </p>
                      )}

                      <div className="pt-0.5 text-[9px] uppercase tracking-widest text-white/25">Área do corte</div>
                      <div className="flex rounded-[3px] border border-white/[0.08] bg-black/25 p-[2px]">
                        {([[false, "O modelo inteiro"], [true, "Só um retângulo"]] as const).map(([comArea, l]) => (
                          <button key={String(comArea)}
                            onClick={() => patch(n.id, {
                              area: comArea
                                ? (n.area ?? { x: 0, y: 0, comprimento: 40, largura: 30, rot: 0 })
                                : undefined,
                            })}
                            className={`flex-1 rounded-[2px] px-1 py-[3px] text-[10px] ${
                              !!n.area === comArea ? "bg-teal-500/90 font-semibold text-[#0a0a0a]" : "text-white/50 hover:text-white/85"
                            }`}>
                            {l}
                          </button>
                        ))}
                      </div>

                      {n.area ? (
                        <>
                          <p className="text-[10px] leading-relaxed text-white/30">
                            O retângulo ciano na cena é o corte: tudo <b>acima</b> dele some,
                            o resto do empreendimento fica íntegro. Com o nível aberto,
                            o pivô manipula o retângulo — <b>W</b> move (a seta azul é a
                            altura), <b>E</b> gira, <b>R</b> redimensiona.
                          </p>
                          {/* Mesmo motivo dos campos da torre: com step 1 o
                              retângulo do corte só aceitava metro inteiro. */}
                          <div className="grid grid-cols-2 gap-2">
                            <NumIn label="Largura X (m)" v={n.area.comprimento} step={0.1} casas={2}
                              onChange={(v) => patch(n.id, { area: { ...n.area!, comprimento: Math.max(0.1, v) } })} />
                            <NumIn label="Profund. Y (m)" v={n.area.largura} step={0.1} casas={2}
                              onChange={(v) => patch(n.id, { area: { ...n.area!, largura: Math.max(0.1, v) } })} />
                            <NumIn label="Centro X (m)" v={n.area.x} step={0.1} casas={2}
                              onChange={(v) => patch(n.id, { area: { ...n.area!, x: v } })} />
                            <NumIn label="Centro Y (m)" v={n.area.y} step={0.1} casas={2}
                              onChange={(v) => patch(n.id, { area: { ...n.area!, y: v } })} />
                            <NumIn label="Giro (°)" v={n.area.rot} step={1} casas={1}
                              onChange={(v) => patch(n.id, { area: { ...n.area!, rot: v } })} />
                          </div>
                          {torres.length > 0 && (
                            <Linha label="Encaixar em">
                              <select value="" onChange={(e) => {
                                const a = areaDaTorre(e.target.value);
                                if (a) patch(n.id, { area: a, torreId: e.target.value });
                              }} className={CAMPO}>
                                <option value="" className="bg-[#0a0a0a]">copiar de um bloco…</option>
                                {torres.map((t) => (
                                  <option key={t.id} value={t.id} className="bg-[#0a0a0a]">{t.label}</option>
                                ))}
                              </select>
                            </Linha>
                          )}
                        </>
                      ) : (
                        <p className="text-[10px] leading-relaxed text-white/30">
                          O corte atravessa o empreendimento inteiro nesta altura.
                        </p>
                      )}
                    </>
                  )}

                  <div className="pt-0.5 text-[9px] uppercase tracking-widest text-white/25">Câmera</div>
                  <p className="text-[10px] leading-relaxed text-white/30">
                    A câmera é <b>calculada</b>: centro da área, olhando para baixo,
                    à distância definida em <b>Enquadramento</b>. Entre um pavimento e
                    o outro só a altura muda — a troca vira uma subida limpa.
                  </p>
                  <NumIn label="Distância só deste nível (0 = a do projeto)"
                    v={n.camDist ?? 0} step={5}
                    onChange={(v) => patch(n.id, { camDist: v > 0 ? v : undefined })} />
                  <NumIn label="Inclinação só deste nível (0 = a do projeto)"
                    v={n.camPitch ?? 0} step={5}
                    onChange={(v) => patch(n.id, { camPitch: v < 0 ? Math.max(-90, v) : undefined })} />
                  <NumIn label="Giro só deste nível (0 = o do projeto)"
                    v={n.camGiro ?? 0} step={15}
                    onChange={(v) => patch(n.id, { camGiro: v !== 0 ? v : undefined })} />
                  <button onClick={() => onVer(n)}
                    className="flex w-full items-center justify-center gap-1 rounded-[3px] bg-white/10 px-2 py-1 text-[10px] text-white/75 hover:bg-white/20">
                    <Camera className="h-3 w-3" /> Testar o enquadramento
                  </button>

                  <div className="pt-0.5 text-[9px] uppercase tracking-widest text-white/25">Planta do nível</div>
                  {n.plantaUrl ? (
                    <div className="flex items-center gap-1.5">
                      <img src={n.plantaUrl} alt="" className="h-12 w-12 rounded-[3px] object-cover ring-1 ring-white/10" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-white/35">{n.plantaUrl}</span>
                      <button onClick={() => patch(n.id, { plantaUrl: undefined })}
                        className="rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <p className="text-[10px] leading-relaxed text-white/30">
                      Aparece ao lado das informações do nível na vitrine.
                    </p>
                  )}
                  <div className="flex gap-1">
                    {plantas.length > 0 ? (
                      <select value="" onChange={(e) => e.target.value && patch(n.id, { plantaUrl: e.target.value })}
                        className={`${CAMPO} min-w-0 flex-1`}>
                        <option value="" className="bg-[#0a0a0a]">escolher de Tipologias…</option>
                        {plantas.map((p, k) => (
                          <option key={k} value={p.url} className="bg-[#0a0a0a]">{p.area}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="min-w-0 flex-1 text-[9px] leading-relaxed text-white/30">
                        Nenhuma planta cadastrada ainda. Cadastre em
                        <b> Tipologias</b> para reaproveitar aqui, ou envie uma
                        avulsa ao lado.
                      </p>
                    )}
                    <button onClick={() => onEnviarPlanta(n.id)}
                      className="shrink-0 rounded-[3px] bg-white/10 px-2 py-1 text-[10px] text-white/75 hover:bg-white/20">
                      <Upload className="h-3 w-3" />
                    </button>
                  </div>

                  {/*
                    Planta NO CHÃO: deita o desenho dentro da cena, no lugar do
                    pavimento. Depende do retângulo do corte, que é o que dá
                    posição, tamanho e giro — sem ele não há onde deitá-la.
                  */}
                  {/*
                    SEMPRE visível, mesmo sem planta linkada.

                    Antes este bloco só existia quando `plantaUrl` estava
                    preenchida — e quem ainda não tinha linkado a planta não via
                    o recurso em lugar nenhum, então não descobria que ele
                    existe. Recurso escondido atrás do próprio pré-requisito é
                    recurso não entregue. Agora ele aparece dizendo o que falta.
                  */}
                  <div className="rounded-[3px] border border-white/[0.07] p-1.5">
                    <label className={`flex items-center gap-1.5 text-[10px] ${
                      n.plantaUrl && n.cutZ != null ? "text-white/70" : "text-white/30"
                    }`}>
                      <input type="checkbox" checked={!!n.plantaNoChao}
                        disabled={!n.plantaUrl || n.cutZ == null}
                        onChange={(e) => patch(n.id, {
                          plantaNoChao: e.target.checked,
                          // Ao ligar, o retângulo da planta já nasce em algum
                          // lugar plausível: o do corte se houver, senão a
                          // pegada da torre do nível, senão um de partida. Um
                          // retângulo vazio deixaria o usuário com um controle
                          // ligado e nada na tela.
                          ...(e.target.checked && !n.plantaArea
                            ? {
                                plantaArea: n.area
                                  ?? (n.torreId ? areaDaTorre(n.torreId) : undefined)
                                  ?? { x: 0, y: 0, comprimento: 40, largura: 30, rot: 0 },
                              }
                            : {}),
                        })} />
                      Deitar no chão do pavimento (3D)
                    </label>
                    {(() => {
                      const falta: string[] = [];
                      if (!n.plantaUrl) falta.push("uma planta escolhida acima");
                      if (n.cutZ == null) falta.push("a cota do corte");
                      return falta.length > 0 ? (
                        <p className="mt-1 text-[9px] leading-relaxed text-amber-300/70">
                          Falta {falta.join(" e ")}.
                        </p>
                      ) : !n.plantaNoChao ? (
                        <p className="mt-1 text-[9px] leading-relaxed text-white/30">
                          Deita o desenho dentro da cena, no lugar do pavimento,
                          em vez de só ao lado do modelo.
                        </p>
                      ) : (
                        <div className="mt-1.5 space-y-1">
                          {/*
                            Posicionar é um MOMENTO, não um estado.

                            O pivô da altura do corte é o que se usa o tempo
                            todo — clicar no pavimento corta e ele aparece. A
                            planta é ajustada uma vez e fica. Por isso um botão
                            que entra e sai, e não um seletor permanente: fora
                            desse momento o pivô volta a ser o do pavimento, que
                            é o comportamento que já estava certo.
                          */}
                          <button
                            onClick={() => onPivoNivel(pivoNivel === "planta" ? "corte" : "planta")}
                            className={`w-full rounded-[3px] py-1 text-[10px] font-semibold ${
                              pivoNivel === "planta"
                                ? "bg-amber-400 text-[#0a0a0a] hover:bg-amber-300"
                                : "border border-teal-400/40 text-teal-300 hover:bg-teal-500/10"
                            }`}>
                            {pivoNivel === "planta" ? "Fixar planta" : "Posicionar planta"}
                          </button>
                          {pivoNivel === "planta" && (
                            <p className="text-[9px] leading-relaxed text-amber-200/70">
                              O pivô no 3D agora é o da planta: mova, gire,
                              redimensione e use a seta vertical para pôr no
                              piso. Ao fixar, ele volta a ser o do pavimento.
                            </p>
                          )}
                          <NumIn label="Subir do corte (m)"
                            v={n.plantaZOffset ?? 0.05}
                            step={0.05} casas={2}
                            onChange={(v) => patch(n.id, { plantaZOffset: v })} />
                          <Slider label="Opacidade"
                            v={Math.round((n.plantaOpacidade ?? 0.85) * 100)}
                            min={10} max={100} step={5} suffix="%"
                            onChange={(v) => patch(n.id, { plantaOpacidade: v / 100 })} />
                          <p className="text-[9px] leading-relaxed text-white/30">
                            Distância do plano de corte, não altura absoluta.
                            Acertado num pavimento, o valor serve para os
                            outros: duplicar leva junto e arrastar o corte leva
                            a planta.
                          </p>
                        </div>
                      );
                    })()}
                  </div>

                  <button onClick={() => duplicar(i)}
                    className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-[3px] border border-teal-400/30 py-1 text-[10px] text-teal-300 hover:bg-teal-500/10">
                    <Copy className="h-3 w-3" />
                    Duplicar neste nível
                  </button>
                  <p className="text-[10px] leading-relaxed text-white/25">
                    A cópia mantém área, tamanho, posição, câmera e <b>altura</b> —
                    só o nome e o número do pavimento avançam. Suba-a até a laje
                    certa com a <b className="text-[#4aa8ff]">seta azul</b>, vendo o
                    prédio se abrir. É o caminho para montar os andares a partir do
                    primeiro já calibrado.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </Section>
    </>
  );
}
