import { useMemo, useState } from "react";
import { Camera, Copy, Crosshair, Link2, Plus, Trash2 } from "lucide-react";
import type { GizmoModo } from "@/components/Scene3D";
import type { CrmConfig } from "@/lib/ivm-store";
import type { PavimentosCfg } from "@/lib/pavimentos";
import { formatPreco, tipologiaEfetiva, unidadeComTipologia } from "@/lib/tipologias";
import {
  STATUS_META, torreLabel, type TorreDef, type TorreVolume, type Unidade, type UnidadeStatus,
} from "@/lib/unidades";
import { buildUnitBoxes, faixaVertical, volumeDaTorre } from "@/lib/unidades3d";
import { CAMERA_UNIDADE_PADRAO, type Tipologia } from "@shared/schema";
// `Text` é também um global do DOM: sem o import explícito o TypeScript resolvia
// para ele e o JSX ficava inválido em silêncio de intenção (erro obscuro, longe
// da causa). Importado, o local ganha.
import { CAMPO, Linha, NumIn, Section, Slider, Text } from "./campos";

/**
 * Aba "Unidades": espelho de vendas do projeto. Define as torres, calibra os
 * pavimentos do modelo (o que o corte 3D e o buscador usam), gera/edita as
 * unidades e configura de onde vem a disponibilidade (manual ou CRM).
 */
export function UnidadesTab({
  unidades, torres, pavCfg, crm, tipologias, torreSelId, onTorreSel,
  placingTorreId, onPlacingTorre,
  sel, onSel, onSelClique, gizmoModo, onGizmoModo, plantaUnidId, onPlantaUnid,
  plantasDisponiveis,
  isolarPavimento, onIsolarPavimento,
  onUnidades, onTorres, onCrm, onTestarCamera,
}: {
  unidades: Unidade[];
  torres: TorreDef[];
  pavCfg: PavimentosCfg;
  crm: CrmConfig;
  tipologias: Tipologia[];
  torreSelId: string;
  onTorreSel: (id: string) => void;
  placingTorreId: string | null;
  onPlacingTorre: (id: string | null) => void;
  /** Seleção de unidades, compartilhada com a cena 3D. */
  sel: string[];
  onSel: (ids: string[]) => void;
  onSelClique: (id: string, mods: { ctrl: boolean; shift: boolean }) => void;
  gizmoModo: GizmoModo;
  /** Plantas cadastradas em Tipologias, para a unidade escolher a dela. */
  plantasDisponiveis: { area: string; url: string }[];
  /** Só o pavimento da unidade em foco aparece na cena. */
  isolarPavimento: boolean;
  onIsolarPavimento: (v: boolean) => void;
  /** Unidade com o contorno em edição no 3D. */
  plantaUnidId: string | null;
  onPlantaUnid: (id: string | null) => void;
  onGizmoModo: (m: GizmoModo) => void;
  onUnidades: (u: Unidade[]) => void;
  onTorres: (t: TorreDef[]) => void;
  onCrm: (c: CrmConfig) => void;
  /** Voa a cena até o enquadramento em edição, para conferir sem salvar. */
  onTestarCamera: (unitId: string, cam: { angulo: number; inclinacao: number; distancia: number }) => void;
}) {
  const torreSel = torreSelId;
  const setTorreSel = onTorreSel;
  /** Clique na grade: alternar disponibilidade ou abrir os dados da unidade. */
  const [modoGrade, setModoGrade] = useState<"status" | "dados">("status");
  const [msgImport, setMsgImport] = useState<string | null>(null);
  /** Retorno das operações de pavimento (duplicar, renumerar, criar). */
  const [msgEspelho, setMsgEspelho] = useState<string | null>(null);
  /** Mesclar preserva o que não está na planilha; substituir troca o espelho. */
  const [modoImport, setModoImport] = useState<"mesclar" | "substituir">("mesclar");

  const torreAtual = torreSel || torres[0]?.id || "";
  const daTorre = unidades.filter((u) => u.torre === torreAtual);

  /**
   * Do maior para o menor, do número do andar ao número da unidade.
   *
   * A fileira saía na ordem em que as unidades foram criadas — "2003, 2004,
   * 2005, 2002, 2006, 2001" —, que é a ordem de um acidente e não a de um
   * espelho. Sem ordem estável, duplicar um andar ou renumerar embaralha a
   * grade, o Shift+clique pega um intervalo que não é o que está entre os dois
   * cliques, e conferir andar contra andar exige ler número por número.
   *
   * Identificadores não numéricos ("A01") vão para o fim, em ordem entre si:
   * eles não pertencem à sequência numérica do andar.
   */
  const porAndar = useMemo(() => {
    const n = (u: Unidade) => Number(u.numero);
    const desc = (a: Unidade, b: Unidade) => {
      const na = n(a);
      const nb = n(b);
      const aNum = Number.isFinite(na);
      const bNum = Number.isFinite(nb);
      if (aNum && bNum) return nb - na;
      if (aNum !== bNum) return aNum ? -1 : 1;
      return b.numero.localeCompare(a.numero, "pt-BR", { numeric: true });
    };
    const m = new Map<number, Unidade[]>();
    for (const u of daTorre) {
      const arr = m.get(u.pavimento) ?? [];
      arr.push(u);
      m.set(u.pavimento, arr);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([pav, us]) => [pav, [...us].sort(desc)] as [number, Unidade[]]);
  }, [daTorre]);

  const cont = (s: UnidadeStatus) => unidades.filter((u) => u.status === s).length;

  /** Unidades selecionadas (na ordem do espelho, não na ordem dos cliques). */
  const selecionadas = unidades.filter((u) => sel.includes(u.id));
  /** Com uma só em foco, o inspetor mostra os campos dela; com várias, o lote. */
  const unidSel = selecionadas.length === 1 ? selecionadas[0] : null;
  /** A tipologia de onde vêm os atributos que a unidade em foco não declara. */
  const tipDoSel = unidSel ? tipologiaEfetiva(unidSel, tipologias) : undefined;

  function patchUnidade(id: string, patch: Partial<Unidade>) {
    onUnidades(unidades.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }
  /** Mesma edição aplicada a toda a seleção — o que a barra de lote usa. */
  function patchSelecionadas(patch: Partial<Unidade>) {
    const ids = new Set(sel);
    onUnidades(unidades.map((u) => (ids.has(u.id) ? { ...u, ...patch } : u)));
  }

  /**
   * Ordem em que a grade desenha as unidades — a base do intervalo do Shift.
   * Tem de vir do que está na tela, e não de uma ordenação própria, senão o
   * intervalo selecionado não é o que o usuário vê entre os dois cliques.
   */
  const ordemGrade = useMemo(
    () => porAndar.flatMap(([, us]) => us.map((u) => u.id)),
    [porAndar],
  );

  /**
   * Clique numa unidade da grade.
   *
   * Shift estende o intervalo desde a âncora (o último item da seleção), Ctrl
   * acumula, e o clique simples faz o que o modo da grade diz. A âncora é
   * mantida no fim da lista para que um segundo Shift+clique reabra o intervalo
   * a partir dela, e não do canto oposto.
   */
  function cliqueNaGrade(u: Unidade, e: React.MouseEvent) {
    const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
    if (mods.shift && sel.length) {
      const ancora = sel[sel.length - 1];
      const i = ordemGrade.indexOf(ancora);
      const j = ordemGrade.indexOf(u.id);
      if (i >= 0 && j >= 0) {
        const faixa = ordemGrade.slice(Math.min(i, j), Math.max(i, j) + 1);
        onSel([...faixa.filter((x) => x !== ancora), ancora]);
        return;
      }
    }
    if (!mods.ctrl && !mods.shift && modoGrade === "status") {
      ciclar(u);
      return;
    }
    onSelClique(u.id, mods);
  }

  /**
   * Caixa que o fatiamento da torre desenha para cada unidade, por id.
   *
   * É a MESMA função que a cena usa, então o número que o inspetor mostra é o
   * tamanho que está na tela — e não uma segunda conta parecida que divergiria
   * na primeira mudança de calibração.
   */
  const caixasCalculadas = useMemo(
    () =>
      new Map(
        buildUnitBoxes({ buildingId: "calc", unidades, torres, pavCfg }).map((c) => [c.id, c]),
      ),
    [unidades, torres, pavCfg],
  );

  /**
   * Tamanho e posição EM VIGOR de uma unidade: os dela, se já tiver pivô
   * próprio, ou os que o fatiamento da torre lhe dá.
   *
   * Sem isto os campos de tamanho apareceriam vazios (ou zerados) para toda
   * unidade da grade, que é a maioria — e o usuário teria de adivinhar o valor
   * atual antes de mudá-lo.
   */
  function posEfetiva(u: Unidade): NonNullable<Unidade["posicao"]> | null {
    if (u.posicao) return u.posicao;
    const c = caixasCalculadas.get(u.id);
    if (!c) return null;
    // A caixa vem com o CENTRO; `posicao.z` é a base.
    return { x: c.x, y: c.y, z: c.z - c.dz / 2, dx: c.dx, dy: c.dy, dz: c.dz, rot: c.rot };
  }

  /**
   * Ajusta tamanho/posição de QUALQUER unidade.
   *
   * Antes só mexia em quem já tinha `posicao`, então as unidades da grade — a
   * maioria de um espelho real — não tinham onde definir largura, profundidade
   * ou altura: herdavam a fatia da torre e pronto. Agora o primeiro ajuste
   * materializa a posição no lugar exato em que o fatiamento já a desenhava,
   * exatamente como o primeiro arraste do pivô na cena faz. Nada salta de
   * lugar; a unidade só passa a ter valores próprios.
   */
  function patchPosicao(id: string, patch: Partial<NonNullable<Unidade["posicao"]>>) {
    onUnidades(
      unidades.map((u) => {
        if (u.id !== id) return u;
        const base = posEfetiva(u);
        return base ? { ...u, posicao: { ...base, ...patch } } : u;
      }),
    );
  }

  // --- Duplicação -------------------------------------------------------------

  /**
   * Próximo número livre na torre a partir de um número base.
   *
   * O id da unidade é `torre-numero`: repetir o número criaria duas unidades
   * com a mesma chave, e a cena passaria a desenhar duas caixas indistinguíveis
   * no mesmo lugar. Incrementa o sufixo numérico preservando o zero à esquerda
   * ("104" → "105", "A01" → "A02").
   */
  function numeroLivre(torre: string, base: string, reservados: Set<string>): string {
    const usados = new Set([
      ...unidades.filter((u) => u.torre === torre).map((u) => u.numero),
      ...Array.from(reservados),
    ]);
    if (!usados.has(base)) return base;
    const m = base.match(/^(.*?)(\d+)$/);
    const prefixo = m ? m[1] : base;
    const largura = m ? m[2].length : 2;
    let n = m ? parseInt(m[2], 10) : 0;
    for (let i = 0; i < 9999; i++) {
      n++;
      const cand = `${prefixo}${String(n).padStart(largura, "0")}`;
      if (!usados.has(cand)) return cand;
    }
    // Inalcançável na prática; ainda assim não devolve um número repetido.
    return `${base}-${Date.now().toString(36)}`;
  }

  /**
   * Duplica as unidades selecionadas. A cópia entra logo depois da original e
   * já nasce selecionada, no lugar da anterior — é o gesto de "mais uma igual".
   *
   * A cópia nasce EXATAMENTE sobre a original, de propósito. Ela era deslocada
   * pela própria largura para "não parecer que nada aconteceu", mas isso jogava
   * a peça para um lado arbitrário que quase nunca era o desejado — e o
   * primeiro trabalho passava a ser desfazer o deslocamento. Empilhada, o gesto
   * seguinte é único e óbvio: pegar a seta do eixo certo e subir. Quem confirma
   * que a cópia existe é a seleção, que já passa para ela.
   */
  function duplicarSelecionadas() {
    if (!sel.length) return;
    const reservados = new Set<string>();
    const copias = new Map<string, Unidade>();
    for (const id of sel) {
      const u = unidades.find((x) => x.id === id);
      if (!u) continue;
      const numero = numeroLivre(u.torre, u.numero, reservados);
      reservados.add(numero);
      copias.set(u.id, {
        ...u,
        id: `${u.torre}-${numero}`,
        numero,
        // Mesma posição da original — ver o comentário acima.
        posicao: u.posicao ? { ...u.posicao } : undefined,
      });
    }
    if (!copias.size) return;
    const out: Unidade[] = [];
    for (const u of unidades) {
      out.push(u);
      const c = copias.get(u.id);
      if (c) out.push(c);
    }
    onUnidades(out);
    onSel(Array.from(copias.values()).map((c) => c.id));
  }

  /**
   * Copia um pavimento inteiro da torre atual para um andar novo, acima do mais
   * alto que existe. É o gesto que falta num espelho real: pavimento-tipo se
   * repete dezenas de vezes, e regerar a torre pelo gerador apaga o trabalho de
   * quem já ajustou preço e status andar a andar.
   *
   * As cópias nascem EXATAMENTE sobre as originais, como a duplicação de
   * unidade: a seleção passa para elas e o gesto seguinte é único — pegar a
   * seta azul e subir o andar inteiro de uma vez.
   *
   * Elas subiam sozinhas uma altura de nível em Z. O palpite acertava só quando
   * o pé-direito do andar batia com o `nivelM` da calibração; num pavimento de
   * transição, num mezanino ou num térreo mais alto, o resultado caía no lugar
   * errado — e aí o trabalho era descobrir de quanto tinha sido o erro para
   * desfazê-lo. Empilhado, não há palpite: o que vale é o que você arrasta.
   *
   * Vale só para quem tem pivô próprio. A unidade da grade não guarda Z: ela é
   * fatiada pelo `pavimento`, então já nasce na altura do andar novo sozinha.
   */
  function duplicarPavimento(pav: number) {
    const origem = unidades.filter((u) => u.torre === torreAtual && u.pavimento === pav);
    if (!origem.length) return;
    const maior = Math.max(...unidades.filter((u) => u.torre === torreAtual).map((u) => u.pavimento));
    const destino = maior + 1;
    const reservados = new Set<string>();
    const novas = origem.map((u) => {
      // "104" no 1º andar vira "204" no 2º: troca o prefixo do andar e mantém
      // o sufixo, que é o que identifica a posição da unidade no pavimento.
      const sufixo = u.numero.slice(String(pav).length);
      const base = `${destino}${sufixo || "01"}`;
      const numero = numeroLivre(u.torre, base, reservados);
      reservados.add(numero);
      return {
        ...u,
        id: `${u.torre}-${numero}`,
        numero,
        pavimento: destino,
        // Mesma posição da original — ver o comentário acima.
        posicao: u.posicao ? { ...u.posicao } : undefined,
      };
    });
    onUnidades([...unidades, ...novas]);
    onSel(novas.map((u) => u.id));
    const comPivo = novas.filter((u) => u.posicao).length;
    setMsgEspelho(
      `Pavimento ${pav} duplicado como ${destino} (${novas.length} unidades).` +
        (comPivo
          ? ` ${comPivo} com pivô próprio ficaram sobre as originais — use a seta azul para subir.`
          : ""),
    );
  }

  /** Remove um pavimento inteiro da torre atual. */
  function apagarPavimento(pav: number) {
    const alvo = unidades.filter((u) => u.torre === torreAtual && u.pavimento === pav);
    if (!alvo.length) return;
    if (!confirm(`Apagar as ${alvo.length} unidades do pavimento ${pav} em ${torreLabel(torreAtual, torres)}?`)) return;
    const ids = new Set(alvo.map((u) => u.id));
    onUnidades(unidades.filter((u) => !ids.has(u.id)));
    onSel(sel.filter((id) => !ids.has(id)));
  }

  /**
   * Renumera um pavimento inteiro. Serve para o caso mais chato do espelho
   * real: o empreendimento pula o 13º, ou a numeração começa no 2º porque o
   * térreo é comercial — e sem isto a única saída era refazer o andar.
   *
   * NÃO move nada de lugar. Renumerar era subir as unidades com pivô próprio
   * em Z, o que contradiz o propósito acima: nos dois exemplos — pular o 13º,
   * começar no 2º — o que muda é o RÓTULO, e o apartamento continua fisicamente
   * onde sempre esteve. Quem renumerava para acertar a numeração via o
   * empreendimento inteiro escorregar para cima de brinde.
   */
  function renumerarPavimento(pav: number, destino: number) {
    if (!Number.isFinite(destino) || destino === pav) return;
    const alvo = unidades.filter((u) => u.torre === torreAtual && u.pavimento === pav);
    if (!alvo.length) return;
    if (unidades.some((u) => u.torre === torreAtual && u.pavimento === destino)) {
      setMsgEspelho(`O pavimento ${destino} já existe — escolha outro número.`);
      return;
    }
    const ids = new Set(alvo.map((u) => u.id));
    onUnidades(
      unidades.map((u) => {
        if (!ids.has(u.id)) return u;
        const sufixo = u.numero.slice(String(pav).length);
        const numero = `${destino}${sufixo || "01"}`;
        return {
          ...u,
          id: `${u.torre}-${numero}`,
          numero,
          pavimento: destino,
          // A posição não é tocada: renumerar é rótulo, não mudança de lugar.
        };
      }),
    );
    onSel([]);
    setMsgEspelho(`Pavimento ${pav} renumerado para ${destino}.`);
  }

  // Volume da torre em edição (com o padrão aplicado, para os campos nunca
  // aparecerem vazios antes da primeira calibração).
  /**
   * Índice da torre em edição — derivado de `torreAtual`, não de `torreSel`.
   *
   * Com `torreSel` vazio (o estado inicial da aba), `torreAtual` já cai na
   * primeira torre e é ELA que aparece destacada na fileira de pastilhas. Mas
   * este índice comparava com `torreSel` cru, dava -1, e a seção de volume
   * respondia "Escolha uma torre" com uma torre visivelmente escolhida na tela.
   * Os campos de tamanho simplesmente não existiam até alguém clicar de novo na
   * pastilha que já estava acesa.
   */
  const torreIdx = torres.findIndex((t) => t.id === torreAtual);
  const torreEmEdicao = torreIdx >= 0 ? torres[torreIdx] : null;
  /**
   * Volume da torre aberta. Serve de BASE para o patch — cada linha da lista
   * calcula o próprio volume para exibir, mas quem grava é sempre a torre
   * selecionada, que é a única cujos campos estão na tela.
   */
  const vol: TorreVolume = torreEmEdicao
    ? volumeDaTorre(torreEmEdicao, torreIdx, torres.length)
    : { x: 0, y: 0, comprimento: 0, largura: 0, rot: 0 };
  function setVolume(patch: Partial<TorreVolume>) {
    if (torreIdx < 0) return;
    const n = [...torres];
    n[torreIdx] = { ...n[torreIdx], volume: { ...vol, ...patch } };
    onTorres(n);
  }

  /** Clique numa unidade: percorre disponível -> reservada -> vendida. */
  function ciclar(u: Unidade) {
    const ordem: UnidadeStatus[] = ["disponivel", "reservada", "vendida"];
    const prox = ordem[(ordem.indexOf(u.status) + 1) % 3];
    onUnidades(unidades.map((x) => (x.id === u.id ? { ...x, status: prox } : x)));
  }

  /**
   * Cria uma unidade no espelho da torre atual.
   *
   * É o caminho ÚNICO de entrada agora: cria-se a unidade, diz-se em que
   * pavimento ela está e ela aparece na grade. O gerador de "N por andar × M
   * pavimentos" que existia aqui saiu — ele partia do princípio de que todo
   * andar é igual, e quando não era (que é o caso normal) obrigava a gerar
   * demais e apagar o que sobrava. Andar repetido se resolve duplicando o
   * pavimento na própria grade, que preserva preço, status e tipologia.
   */
  function criarUnidade(pavimento?: number) {
    const torre = torreAtual || torres[0]?.id;
    if (!torre) {
      setMsgEspelho("Cadastre uma torre antes de criar unidades.");
      return;
    }
    const daT = unidades.filter((u) => u.torre === torre);
    const pav = pavimento ?? (daT.length ? Math.max(...daT.map((u) => u.pavimento)) : 1);
    const noAndar = daT.filter((u) => u.pavimento === pav).length;
    const numero = numeroLivre(torre, `${pav}${String(noAndar + 1).padStart(2, "0")}`, new Set());
    // Só o vínculo: área, quartos, suítes e vagas ficam na tipologia e a
    // vitrine os resolve de lá (ver `unidadeComTipologia`).
    const t = tipologias[0];
    const nova: Unidade = {
      id: `${torre}-${numero}`,
      torre,
      pavimento: pav,
      numero,
      tipologia: t?.nome ?? "",
      tipologiaId: t?.id,
      status: "disponivel",
    };
    onUnidades([...unidades, nova]);
    // Já nasce aberta no editor: o passo seguinte é sempre acertar número,
    // pavimento e tipologia dela.
    onSel([nova.id]);
    setMsgEspelho(null);
  }

  /**
   * Renomeia a unidade. O id é `torre-numero`, então trocar o número troca o
   * id — e um número já usado na torre criaria duas unidades com a mesma
   * chave, indistinguíveis na cena.
   */
  function renomearUnidade(id: string, numero: string) {
    const u = unidades.find((x) => x.id === id);
    if (!u || !numero.trim()) return;
    const novoId = `${u.torre}-${numero}`;
    if (novoId !== id && unidades.some((x) => x.id === novoId)) {
      setMsgEspelho(`Já existe a unidade ${numero} em ${torreLabel(u.torre, torres)}.`);
      return;
    }
    onUnidades(unidades.map((x) => (x.id === id ? { ...x, id: novoId, numero } : x)));
    onSel(sel.map((s) => (s === id ? novoId : s)));
    setMsgEspelho(null);
  }

  // --- Planilha ---------------------------------------------------------------

  /** Colunas do CSV, na ordem de exportação. */
  const COLUNAS = [
    "torre", "pavimento", "numero", "tipologia", "areaPrivativa",
    "quartos", "suites", "vagas", "orientacao", "preco", "status",
  ] as const;

  function exportarCsv() {
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const linhas = [COLUNAS.join(";")];
    // Exporta o que a vitrine mostra, e não só o que está gravado na unidade:
    // uma planilha com as colunas de área e quartos em branco porque o dado
    // mora na tipologia não serve para conferir espelho com ninguém.
    for (const bruta of unidades) {
      const u = unidadeComTipologia(bruta, tipologias);
      linhas.push(
        [
          u.torre, u.pavimento, u.numero, u.tipologia, u.areaPrivativa ?? "",
          u.quartos ?? "", u.suites ?? "", u.vagas ?? "", u.orientacao ?? "",
          // Preço em reais com vírgula decimal — é o que o Excel brasileiro lê.
          u.preco != null ? (u.preco / 100).toFixed(2).replace(".", ",") : "",
          u.status,
        ].map(esc).join(";"),
      );
    }
    // BOM para o Excel reconhecer o UTF-8 e não estragar os acentos.
    const blob = new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "espelho.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Divide uma linha de CSV respeitando aspas. */
  function separarLinha(linha: string, sep: string): string[] {
    const out: string[] = [];
    let atual = "";
    let aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const ch = linha[i];
      if (ch === '"') {
        if (aspas && linha[i + 1] === '"') { atual += '"'; i++; }
        else aspas = !aspas;
      } else if (ch === sep && !aspas) {
        out.push(atual.trim());
        atual = "";
      } else atual += ch;
    }
    out.push(atual.trim());
    return out;
  }

  /**
   * Importa a planilha casando pelo CABEÇALHO, não pela posição — uma tabela de
   * vendas real nunca vem na ordem que a gente inventou. Colunas desconhecidas
   * são ignoradas e as ausentes preservam o valor que a unidade já tinha.
   */
  async function importarCsv(file: File) {
    const txt = (await file.text()).replace(/^﻿/, "");
    const linhas = txt.split(/\r?\n/).filter((l) => l.trim());
    if (linhas.length < 2) return setMsgImport("Planilha vazia.");

    // Separador: o que aparecer mais no cabeçalho.
    const sep = (linhas[0].match(/;/g)?.length ?? 0) >= (linhas[0].match(/,/g)?.length ?? 0) ? ";" : ",";
    const cab = separarLinha(linhas[0], sep).map((c) =>
      c.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""),
    );
    const col = (...nomes: string[]) => {
      for (const n of nomes) {
        const i = cab.indexOf(n);
        if (i >= 0) return i;
      }
      return -1;
    };
    const iTorre = col("torre", "bloco");
    const iNumero = col("numero", "unidade", "apto", "apartamento");
    if (iTorre < 0 || iNumero < 0) {
      return setMsgImport('Faltam as colunas "torre" e "numero" no cabeçalho.');
    }
    const iPav = col("pavimento", "andar");
    const iTip = col("tipologia", "planta", "tipo");
    const iArea = col("areaprivativa", "area", "areaprivativa(m2)", "m2");
    const iQuartos = col("quartos", "dormitorios", "dorms");
    const iSuites = col("suites");
    const iVagas = col("vagas", "garagem");
    const iOrient = col("orientacao", "face", "posicao");
    const iPreco = col("preco", "valor", "preco(r$)");
    const iStatus = col("status", "situacao", "disponibilidade");

    /** Aceita as grafias mais comuns de status vindas de CRM/planilha. */
    const lerStatus = (v: string): UnidadeStatus | undefined => {
      const s = v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      if (["disponivel", "disponible", "livre", "a venda", "avenda"].includes(s)) return "disponivel";
      if (["reservada", "reservado", "reserva", "proposta"].includes(s)) return "reservada";
      if (["vendida", "vendido", "venda", "quitado"].includes(s)) return "vendida";
      return undefined;
    };
    const num = (v?: string) => {
      if (!v) return undefined;
      const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) ? n : undefined;
    };

    const porId = new Map(unidades.map((u) => [u.id, u]));
    const out: Unidade[] = [];
    let novas = 0;
    for (const linha of linhas.slice(1)) {
      const c = separarLinha(linha, sep);
      const torre = c[iTorre];
      const numero = c[iNumero];
      if (!torre || !numero) continue;
      const id = `${torre}-${numero}`;
      const anterior = porId.get(id);
      if (!anterior) novas++;
      const tipNome = iTip >= 0 ? c[iTip] : anterior?.tipologia;
      const tip = tipologias.find((t) => t.nome === tipNome);
      const precoReais = iPreco >= 0 ? num(c[iPreco]) : undefined;
      /**
       * Valor que a planilha traz e a tipologia já dá é herança, não exceção.
       * Guardá-lo na unidade congelaria o dado num simples ida-e-volta
       * exportar → importar: a coluna sai preenchida com o valor herdado e
       * voltaria gravada como se fosse uma particularidade daquela unidade.
       */
      const proprio = (v: number | undefined, doTipo?: number) =>
        v == null || v === doTipo ? undefined : v;

      out.push({
        // Campos ausentes na planilha mantêm o que a unidade já tinha.
        ...(anterior ?? { id, torre, pavimento: 1, numero, tipologia: "", status: "disponivel" as UnidadeStatus }),
        id,
        torre,
        numero,
        // Sem coluna de pavimento, deduz do número ("504" → 5), com 1 de piso.
        pavimento:
          (iPav >= 0 ? num(c[iPav]) : undefined) ??
          anterior?.pavimento ??
          (Number(numero.slice(0, -2)) || 1),
        tipologia: tipNome ?? "",
        tipologiaId: tip?.id ?? anterior?.tipologiaId,
        areaPrivativa: proprio((iArea >= 0 ? num(c[iArea]) : undefined) ?? anterior?.areaPrivativa, tip?.areaPrivativa),
        quartos: proprio((iQuartos >= 0 ? num(c[iQuartos]) : undefined) ?? anterior?.quartos, tip?.quartos),
        suites: proprio((iSuites >= 0 ? num(c[iSuites]) : undefined) ?? anterior?.suites, tip?.suites),
        vagas: proprio((iVagas >= 0 ? num(c[iVagas]) : undefined) ?? anterior?.vagas, tip?.vagas),
        orientacao: ((iOrient >= 0 ? c[iOrient]?.toUpperCase() : undefined) ?? anterior?.orientacao) as Unidade["orientacao"],
        preco: precoReais != null ? Math.round(precoReais * 100) : anterior?.preco,
        status: (iStatus >= 0 ? lerStatus(c[iStatus]) : undefined) ?? anterior?.status ?? "disponivel",
      });
    }

    if (!out.length) return setMsgImport("Nenhuma linha válida encontrada.");

    const naPlanilha = new Set(out.map((u) => u.id));
    const forasteiras = unidades.filter((u) => !naPlanilha.has(u.id));

    if (modoImport === "substituir") {
      // Substituir descarta tudo que não está na planilha, inclusive exceções.
      // Nunca em silêncio: o número vai no aviso antes de acontecer.
      if (
        forasteiras.length > 0 &&
        !confirm(
          `Substituir o espelho?

${forasteiras.length} unidade(s) que NÃO estão na planilha ` +
            `serão removidas (incluindo ${forasteiras.filter((u) => u.posicao).length} com posição personalizada).`,
        )
      ) {
        return setMsgImport("Importação cancelada.");
      }
      onUnidades(out);
      return setMsgImport(
        `${out.length} unidades importadas (${novas} novas) · ${forasteiras.length} removida(s).`,
      );
    }

    // Mesclar (padrão): a planilha atualiza quem ela cita e não mexe no resto.
    //
    // Cada unidade é substituída NO LUGAR em que já estava, e só as realmente
    // novas entram no fim. Concatenar `[...forasteiras, ...out]` jogava para o
    // começo tudo o que a planilha não citava — o espelho inteiro se
    // reorganizava sozinho a cada importação, sem nada ter mudado de fato.
    const atualizadas = new Map(out.map((u) => [u.id, u]));
    const existentes = new Set(unidades.map((u) => u.id));
    onUnidades([
      ...unidades.map((u) => atualizadas.get(u.id) ?? u),
      ...out.filter((u) => !existentes.has(u.id)),
    ]);
    setMsgImport(
      `${out.length} atualizada(s), ${novas} nova(s) · ${forasteiras.length} mantida(s) fora da planilha.`,
    );
  }

  return (
    <>
      {/* ===== Cabeçalho da aba =====
          Resumo + o ÚNICO seletor de torre. Antes ele aparecia três vezes
          (volume, gerador e espelho), cada um com a sua própria fileira de
          pastilhas dizendo a mesma coisa — e nada indicava que eram o mesmo
          estado. Uma torre escolhida aqui vale para a aba inteira. */}
      <div className="space-y-1.5 rounded-[3px] bg-white/[0.04] px-2 py-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-white/55">
            {unidades.length} unidades
          </span>
          <div className="flex gap-2 text-[10px]">
            {(["disponivel", "reservada", "vendida"] as UnidadeStatus[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1 text-white/55" title={STATUS_META[s].label}>
                <span className="h-2 w-2 rounded-sm" style={{ background: STATUS_META[s].cor }} />
                {cont(s)}
              </span>
            ))}
          </div>
        </div>
        {torres.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {torres.map((t) => (
              <button key={t.id} onClick={() => setTorreSel(t.id)}
                title={`${unidades.filter((u) => u.torre === t.id).length} unidades`}
                className={`rounded-full px-2.5 py-0.5 text-[11px] ${
                  torreAtual === t.id ? "bg-teal-500 font-semibold text-[#0a0a0a]" : "bg-white/5 text-white/55 hover:bg-white/10"}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ===== Seleção em lote =====
          Aparece só quando há seleção, ancorada no topo do inspetor: o que se
          faz com N unidades tem de estar visível seja qual for a seção aberta. */}
      {sel.length > 0 && (
        <div className="sticky top-0 z-10 -mx-3 space-y-1.5 border-b border-teal-400/25 bg-[#111111] px-3 py-2 shadow-lg shadow-black/40">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-teal-300">
              {sel.length} {sel.length === 1 ? "unidade" : "unidades"} selecionada{sel.length === 1 ? "" : "s"}
            </span>
            {selecionadas.some((u) => u.posicao) && (
              <span className="text-[10px] text-white/30">
                · {selecionadas.filter((u) => u.posicao).length} com pivô
              </span>
            )}
            <button onClick={() => onSel([])}
              className="ml-auto text-[10px] text-white/40 hover:text-white">
              limpar (Esc)
            </button>
          </div>

          {/* Ferramenta do pivô: aqui, e não só na aba Modelo, porque nesta aba
              o pivô é o da unidade/torre e trocar de ferramenta é parte do gesto. */}
          {selecionadas.some((u) => u.posicao) && (
            <div className="flex gap-1">
              {(["mover", "girar", "escalar"] as GizmoModo[]).map((m) => (
                <button key={m} onClick={() => onGizmoModo(m)}
                  disabled={selecionadas.filter((u) => u.posicao).length > 1 && m !== "mover"}
                  title={m === "mover" ? "W" : m === "girar" ? "E" : "R"}
                  className={`flex-1 rounded-[3px] px-1 py-1 text-[10px] capitalize disabled:opacity-25 ${
                    gizmoModo === m ? "bg-teal-500 font-semibold text-[#0a0a0a]" : "bg-white/8 text-white/55 hover:bg-white/15"
                  }`}>
                  {m}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-1">
            {(["disponivel", "reservada", "vendida"] as UnidadeStatus[]).map((s) => (
              <button key={s} onClick={() => patchSelecionadas({ status: s })}
                className="flex-1 rounded-[3px] py-1 text-[9px] font-semibold text-[#0a0a0a] hover:opacity-85"
                style={{ background: STATUS_META[s].cor }}>
                {STATUS_META[s].label}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            <select
              value=""
              onChange={(e) => {
                const t = tipologias.find((x) => x.id === e.target.value);
                if (!t) return;
                // Vincula, não copia: a ficha da vitrine lê os atributos da
                // tipologia, então corrigi-los lá chega em todas as unidades.
                patchSelecionadas({ tipologiaId: t.id, tipologia: t.nome });
              }}
              className="min-w-0 flex-1 rounded-[3px] bg-white/10 px-1.5 py-1 text-[10px] outline-none ring-1 ring-white/10">
              <option value="" className="bg-[#0a0a0a]">aplicar tipologia…</option>
              {tipologias.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#0a0a0a]">{t.nome}</option>
              ))}
            </select>
            <input type="number" min={0} step={1000} placeholder="preço R$"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const v = parseFloat((e.target as HTMLInputElement).value);
                if (Number.isFinite(v)) patchSelecionadas({ preco: Math.round(v * 100) });
              }}
              title="Digite e pressione Enter para aplicar a todas"
              className="w-24 rounded-[3px] bg-white/10 px-1.5 py-1 text-[10px] outline-none ring-1 ring-white/10 focus:ring-teal-400/50" />
          </div>

          <div className="flex gap-1">
            <button onClick={duplicarSelecionadas}
              title="Cria uma cópia de cada unidade selecionada, com o próximo número livre"
              className="flex items-center gap-1 rounded-[3px] bg-white/10 px-2 py-1 text-[10px] text-white/75 hover:bg-white/20">
              <Copy className="h-3 w-3" /> Duplicar
            </button>
            {selecionadas.some((u) => u.posicao) && (
              <button onClick={() => patchSelecionadas({ posicao: undefined })}
                className="flex-1 rounded-[3px] bg-white/10 px-1.5 py-1 text-[10px] text-white/75 hover:bg-white/20">
                Devolver à grade
              </button>
            )}
            <button
              onClick={() => {
                if (!confirm(`Apagar ${sel.length} unidade(s) do espelho?`)) return;
                const ids = new Set(sel);
                onUnidades(unidades.filter((u) => !ids.has(u.id)));
                onSel([]);
              }}
              className="rounded-[3px] bg-red-500/15 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/25">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* ===== Espelho =====
          É o trabalho diário desta aba, então vem PRIMEIRO e aberto. Tudo o
          que se configura uma vez (torres, calibração, volume, gerador, preços,
          CRM, CSV) desceu para seções fechadas: antes eram oito blocos abertos
          e a grade — a única coisa que se usa todo dia — ficava no fim. */}
      {torres.length > 0 && (
        <Section title={`Espelho · ${torreLabel(torreAtual, torres)}`}>
          {/* Criar é o caminho de entrada do espelho, então é a primeira coisa
              da seção — e a única quando a torre ainda está vazia. */}
          <button onClick={() => criarUnidade()}
            className="flex w-full items-center justify-center gap-1.5 rounded-[3px] bg-teal-500 px-3 py-1.5 text-[11px] font-semibold text-[#0a0a0a] hover:bg-teal-400">
            <Plus className="h-3.5 w-3.5" /> Nova unidade
          </button>
          {/* Fora do ramo da grade: `criarUnidade` avisa por aqui quando não há
              torre nenhuma, e nesse caso a grade não é renderizada. */}
          {msgEspelho && <p className="text-[10px] text-teal-300">{msgEspelho}</p>}

          {porAndar.length === 0 ? (
            <p className="text-center text-[10px] leading-relaxed text-white/30">
              Nenhuma unidade em {torreLabel(torreAtual, torres) || "esta torre"}.
              Crie a primeira, diga em que pavimento ela está — e depois duplique
              o andar inteiro para os que se repetem.
            </p>
          ) : (
          <>
          <div className="flex gap-1">
            {([["status", "Alternar status"], ["dados", "Editar dados"]] as const).map(([m, l]) => (
              <button key={m} onClick={() => { setModoGrade(m); onSel([]); }}
                className={`flex-1 rounded-[3px] px-2 py-1 text-[10px] ${
                  modoGrade === m ? "bg-teal-500 font-semibold text-[#0a0a0a]" : "bg-white/10 text-white/60 hover:bg-white/20"}`}>
                {l}
              </button>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-white/35"
            title="Ctrl+clique acumula · Shift+clique pega o intervalo · o número do andar seleciona a fileira · contorno ciano = pivô próprio">
            {modoGrade === "status"
              ? "Clique alterna disponível → reservada → vendida."
              : "Clique abre os dados da unidade."}{" "}
            <span className="text-white/25">Ctrl/Shift acumulam.</span>
          </p>

          <div className="space-y-1">
            {porAndar.map(([pav, us]) => (
              <div key={pav} className="group flex items-center gap-1.5">
                <button
                  onClick={(e) => {
                    const ids = us.map((u) => u.id);
                    onSel(e.ctrlKey || e.metaKey ? Array.from(new Set([...sel, ...ids])) : ids);
                  }}
                  title="Selecionar o andar inteiro (Ctrl+clique soma à seleção)"
                  className={`w-7 shrink-0 rounded py-1 font-mono text-[10px] hover:bg-white/15 ${
                    us.every((u) => sel.includes(u.id)) ? "bg-teal-500/25 text-teal-200" : "bg-white/[0.06] text-white/50"
                  }`}>
                  {pav}
                </button>

                {/* Ações do andar. Aparecem no hover da fileira: estão sempre
                    ao alcance, sem ocupar a largura do painel o tempo todo. */}
                <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button onClick={() => duplicarPavimento(pav)} title={`Duplicar o pavimento ${pav} num andar novo`}
                    className="rounded-[3px] p-0.5 text-white/35 hover:bg-white/10 hover:text-white">
                    <Copy className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => {
                      const v = prompt(`Renumerar o pavimento ${pav} para qual andar?`, String(pav));
                      if (v != null) renumerarPavimento(pav, parseInt(v, 10));
                    }}
                    title={`Renumerar o pavimento ${pav}`}
                    className="rounded-[3px] px-1 py-0.5 font-mono text-[9px] text-white/35 hover:bg-white/10 hover:text-white">
                    #
                  </button>
                  <button onClick={() => apagarPavimento(pav)} title={`Apagar o pavimento ${pav}`}
                    className="rounded-[3px] p-0.5 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-1">
                  {us.map((u) => (
                    <button key={u.id}
                      onClick={(e) => cliqueNaGrade(u, e)}
                      title={`${u.numero} · ${STATUS_META[u.status].label}${u.preco ? ` · ${formatPreco(u.preco)}` : ""}${u.posicao ? " · pivô próprio" : ""}\nCtrl+clique acumula · Shift+clique seleciona o intervalo`}
                      className={`h-7 w-7 rounded text-[9px] font-semibold transition-transform hover:scale-110 ${
                        sel.includes(u.id) ? "ring-2 ring-white" : u.posicao ? "ring-1 ring-cyan-300/60" : ""
                      }`}
                      style={{ background: STATUS_META[u.status].cor, color: u.status === "reservada" ? "#04141d" : "#fff" }}>
                      {u.numero}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Editor da unidade escolhida */}
          {unidSel && (
            <div className="space-y-1.5 rounded-md bg-white/[0.06] p-2 ring-1 ring-teal-400/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">
                  {torreLabel(unidSel.torre, torres)} · {unidSel.numero}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={duplicarSelecionadas} title="Duplicar esta unidade"
                    className="rounded-[3px] p-1 text-white/40 hover:bg-white/10 hover:text-white">
                    <Copy className="h-3 w-3" />
                  </button>
                  <button onClick={() => onSel([])} className="text-[10px] text-white/40 hover:text-white">
                    fechar
                  </button>
                </div>
              </div>

              <div className="flex gap-1">
                {(["disponivel", "reservada", "vendida"] as UnidadeStatus[]).map((s) => (
                  <button key={s} onClick={() => patchUnidade(unidSel.id, { status: s })}
                    className={`flex-1 rounded px-1 py-1 text-[10px] font-semibold ${
                      unidSel.status === s ? "text-[#0a0a0a]" : "text-white/60 hover:opacity-80"}`}
                    style={{ background: unidSel.status === s ? STATUS_META[s].cor : "rgba(255,255,255,0.08)" }}>
                    {STATUS_META[s].label}
                  </button>
                ))}
              </div>

              {/* Número e pavimento moram AQUI: são o que define onde a unidade
                  cai no espelho e podem ser editados em um único lugar. */}
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="mb-0.5 block text-[9px] text-white/40">Número</label>
                  <input
                    key={unidSel.id}
                    defaultValue={unidSel.numero}
                    onBlur={(e) => renomearUnidade(unidSel.id, e.target.value.trim())}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    title="Troca o número e, com ele, o identificador da unidade"
                    className="w-full rounded bg-white/10 px-1.5 py-1 text-[11px] outline-none ring-1 ring-white/10 focus:ring-teal-400/50" />
                </div>
                <div>
                  <label className="mb-0.5 block text-[9px] text-white/40">Pavimento</label>
                  <input type="number" min={0} step={1} value={unidSel.pavimento}
                    onChange={(e) => patchUnidade(unidSel.id, {
                      pavimento: Math.max(0, parseInt(e.target.value, 10) || 0),
                    })}
                    title="Muda a unidade de andar no espelho"
                    className="w-full rounded bg-white/10 px-1.5 py-1 text-[11px] outline-none ring-1 ring-white/10 focus:ring-teal-400/50" />
                </div>
              </div>

              <select value={unidSel.tipologiaId ?? ""}
                onChange={(e) => {
                  const t = tipologias.find((x) => x.id === e.target.value);
                  patchUnidade(unidSel.id, t
                    ? { tipologiaId: t.id, tipologia: t.nome }
                    : { tipologiaId: undefined });
                }}
                className="w-full rounded bg-white/10 px-1.5 py-1 text-[11px] outline-none ring-1 ring-white/10">
                <option value="" className="bg-[#0a0a0a]">— sem tipologia —</option>
                {tipologias.map((t) => (
                  <option key={t.id} value={t.id} className="bg-[#0a0a0a]">{t.nome}</option>
                ))}
              </select>

              {/* Campos VAZIOS aqui não significam vitrine vazia: a unidade sem
                  valor próprio mostra o da tipologia, e o placeholder diz qual
                  é. Preencher só faz sentido para a exceção — a cobertura com
                  área diferente do tipo dela. */}
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="mb-0.5 block text-[9px] text-white/40">Preço (R$)</label>
                  <input type="number" min={0} step={1000}
                    value={unidSel.preco != null ? unidSel.preco / 100 : ""}
                    onChange={(e) => patchUnidade(unidSel.id, {
                      preco: e.target.value === "" ? undefined : Math.round(parseFloat(e.target.value) * 100),
                    })}
                    className="w-full rounded bg-white/10 px-1.5 py-1 text-[11px] outline-none ring-1 ring-white/10 focus:ring-teal-400/50" />
                </div>
                <div>
                  <label className="mb-0.5 block text-[9px] text-white/40">Área privativa (m²)</label>
                  <input type="number" min={0} step={0.5} value={unidSel.areaPrivativa ?? ""}
                    placeholder={tipDoSel?.areaPrivativa != null ? `${tipDoSel.areaPrivativa} (tipologia)` : ""}
                    title={tipDoSel?.areaPrivativa != null
                      ? `Vazio = ${tipDoSel.areaPrivativa} m², da tipologia ${tipDoSel.nome}`
                      : undefined}
                    onChange={(e) => patchUnidade(unidSel.id, {
                      areaPrivativa: e.target.value === "" ? undefined : parseFloat(e.target.value),
                    })}
                    className="w-full rounded bg-white/10 px-1.5 py-1 text-[11px] outline-none ring-1 ring-white/10 focus:ring-teal-400/50" />
                </div>
                <div>
                  <label className="mb-0.5 block text-[9px] text-white/40">Quartos</label>
                  <input type="number" min={0} step={1} value={unidSel.quartos ?? ""}
                    placeholder={tipDoSel?.quartos != null ? `${tipDoSel.quartos} (tipologia)` : ""}
                    title={tipDoSel?.quartos != null
                      ? `Vazio = ${tipDoSel.quartos}, da tipologia ${tipDoSel.nome}`
                      : undefined}
                    onChange={(e) => patchUnidade(unidSel.id, {
                      quartos: e.target.value === "" ? undefined : parseInt(e.target.value, 10),
                    })}
                    className="w-full rounded bg-white/10 px-1.5 py-1 text-[11px] outline-none ring-1 ring-white/10" />
                </div>
                <div>
                  <label className="mb-0.5 block text-[9px] text-white/40">Orientação</label>
                  <select value={unidSel.orientacao ?? ""}
                    onChange={(e) => patchUnidade(unidSel.id, {
                      orientacao: (e.target.value || undefined) as Unidade["orientacao"],
                    })}
                    className={CAMPO}>
                    <option value="" className="bg-[#0a0a0a]">—</option>
                    {["N", "NE", "L", "SE", "S", "SO", "O", "NO"].map((o) => (
                      <option key={o} value={o} className="bg-[#0a0a0a]">{o}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ===== Volume da unidade =====
                  Tamanho e posição da caixa no modelo, para QUALQUER unidade.
                  Uma cobertura mais larga, um garden mais
                  fundo ou um pé-direito duplo não cabem na fatia uniforme da
                  torre, e até aqui só dava para ajustá-los criando um pivô à
                  mão antes. */}
              {(() => {
                const pos = posEfetiva(unidSel);
                if (!pos) return null;
                const proprio = !!unidSel.posicao;
                const set = (p: Partial<NonNullable<Unidade["posicao"]>>) =>
                  patchPosicao(unidSel.id, p);
                return (
                  <>
                    {/* Isolar o andar: o corte já abre o pavimento certo, mas
                        as unidades dos outros continuavam desenhadas — as de
                        cima inclusive, boiando sobre a laje aberta. */}
                    <label className="flex items-center gap-1.5 text-[10px] text-white/70">
                      <input type="checkbox" checked={isolarPavimento}
                        onChange={(e) => onIsolarPavimento(e.target.checked)} />
                      Mostrar só as unidades deste pavimento
                    </label>

                    <div className="ed-eyebrow pt-1 text-[var(--ed-dim)]">Volume da unidade</div>
                    <p className="text-[10px] leading-relaxed text-white/35">
                      {proprio
                        ? "Esta unidade tem tamanho próprio — sai do fatiamento da torre."
                        : "Valores herdados do fatiamento da torre. Mexer em qualquer um passa a valer só para esta unidade, no lugar em que ela já está."}
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">
                      <NumIn empilhado label="Largura X (m)" v={pos.dx ?? 8} step={0.1} casas={2}
                        onChange={(v) => set({ dx: Math.max(0.1, v) })} />
                      <NumIn empilhado label="Profund. Y (m)" v={pos.dy ?? 10} step={0.1} casas={2}
                        onChange={(v) => set({ dy: Math.max(0.1, v) })} />
                      <NumIn empilhado label="Altura Z (m)" v={pos.dz ?? pavCfg.nivelM} step={0.1} casas={2}
                        onChange={(v) => set({ dz: Math.max(0.1, v) })} />
                    </div>

                    {/* ===== Contorno próprio =====
                        Apartamento raramente é retângulo perfeito: tem corredor
                        que avança, quina cortada, quarto que recua. Com caixa,
                        ou a unidade invade a vizinha ou deixa vão. */}
                    {(() => {
                      const planta = pos.planta;
                      const dx = pos.dx ?? 8;
                      const dy = pos.dy ?? 10;
                      if (!planta?.length) {
                        return (
                          <button
                            onClick={() => set({
                              // Nasce como o retângulo atual: subdividir não
                              // pode mudar a forma, só passar a permitir mudá-la.
                              planta: [
                                { x: -dx / 2, y: -dy / 2 },
                                { x: dx / 2, y: -dy / 2 },
                                { x: dx / 2, y: dy / 2 },
                                { x: -dx / 2, y: dy / 2 },
                              ],
                            })}
                            className="w-full rounded-[3px] border border-teal-400/30 py-1 text-[10px] font-semibold text-teal-300 hover:bg-teal-500/10">
                            Subdividir contorno
                          </button>
                        );
                      }
                      const editando = plantaUnidId === unidSel.id;
                      return (
                        <div className="space-y-1 rounded-[3px] border border-teal-400/20 p-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="flex-1 text-[10px] font-semibold text-teal-300">
                              Contorno · {planta.length} vértices
                            </span>
                            <button
                              onClick={() => set({ planta: undefined })}
                              title="Voltar a ser uma caixa"
                              className="rounded-[3px] border border-[var(--ed-line)] px-1.5 py-0.5 text-[9px] text-white/45 hover:border-white/25 hover:text-white/85">
                              voltar à caixa
                            </button>
                          </div>
                          {/* O ajuste é NA CENA, não aqui. Uma lista de X e Y
                              descreve a forma sem mostrá-la: para saber se o
                              recorte bate com a parede era preciso digitar,
                              olhar o 3D e voltar. Arrastar o ponto no lugar
                              onde ele está responde na hora. */}
                          <button
                            onClick={() => onPlantaUnid(editando ? null : unidSel.id)}
                            className={`w-full rounded-[3px] py-1 text-[10px] font-semibold ${
                              editando
                                ? "bg-amber-400 text-[#0a0a0a] hover:bg-amber-300"
                                : "border border-amber-400/40 text-amber-200 hover:bg-amber-400/10"
                            }`}>
                            {editando ? "Concluir contorno" : "Editar contorno no 3D"}
                          </button>
                          {editando && (
                            <p className="text-[9px] leading-relaxed text-amber-200/70">
                              Cada canto tem <b>dois pontos</b> ligados por uma
                              prumada: um no piso, outro no teto. Arrastar move
                              o canto <b>para os lados</b> — pelos dois pontos dá
                              no mesmo. <b>Shift</b> arrastando muda a
                              <b>altura</b>, cada ponto na sua superfície: o de
                              baixo levanta o piso, o de cima levanta o teto. É
                              como se faz rampa, meio-nível e pé-direito duplo
                              sem entortar as paredes. Clique no <b>círculo
                              vazado</b> no meio de uma aresta para inserir um
                              canto ali: nasce sem mudar a forma, e só então
                              você o move.
                            </p>
                          )}
                          <p className="text-[9px] leading-relaxed text-white/30">
                            Mover e girar a unidade continuam em Posição e giro —
                            o contorno acompanha.
                          </p>
                        </div>
                      );
                    })()}

                    <details>
                      <summary className="cursor-pointer text-[10px] text-white/35 hover:text-white/60">
                        Posição e giro
                      </summary>
                      <div className="mt-1.5 space-y-1.5">
                        <div className="grid grid-cols-3 gap-1.5">
                          <NumIn empilhado label="X (m)" v={pos.x} step={0.1} casas={2} onChange={(v) => set({ x: v })} />
                          <NumIn empilhado label="Y (m)" v={pos.y} step={0.1} casas={2} onChange={(v) => set({ y: v })} />
                          <NumIn empilhado label="Base Z (m)" v={pos.z} step={0.1} casas={2} onChange={(v) => set({ z: v })} />
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          <NumIn empilhado label="Giro Z (°)" v={pos.rot ?? 0} step={5} onChange={(v) => set({ rot: v })} />
                          <NumIn empilhado label="Inclin. X (°)" v={pos.rotX ?? 0} step={5} onChange={(v) => set({ rotX: v })} />
                          <NumIn empilhado label="Inclin. Y (°)" v={pos.rotY ?? 0} step={5} onChange={(v) => set({ rotY: v })} />
                        </div>
                      </div>
                    </details>

                    {proprio && (
                      <button
                        onClick={() => patchUnidade(unidSel.id, { posicao: undefined })}
                        title="Volta a herdar tamanho e posição da fatia da torre"
                        className="w-full rounded-[3px] border border-white/[0.08] py-1 text-[10px] text-white/45 hover:border-white/20 hover:text-white/80">
                        Devolver ao fatiamento da torre
                      </button>
                    )}
                    {/* Aplicar em lote: uma linha inteira de coberturas tem o
                        mesmo volume, e repetir três números vinte vezes é o tipo
                        de trabalho que faz o editor ser abandonado. */}
                    {sel.length > 1 && (
                      <button
                        onClick={() => {
                          const dims = { dx: pos.dx, dy: pos.dy, dz: pos.dz };
                          const ids = new Set(sel);
                          onUnidades(
                            unidades.map((u) => {
                              if (!ids.has(u.id)) return u;
                              const base = posEfetiva(u);
                              return base ? { ...u, posicao: { ...base, ...dims } } : u;
                            }),
                          );
                        }}
                        className="w-full rounded-[3px] border border-[var(--ed-line)] py-1 text-[10px] text-white/60 hover:border-white/25 hover:text-white">
                        Aplicar este tamanho nas {sel.length} selecionadas
                      </button>
                    )}
                  </>
                );
              })()}

              {(() => {
                const tipDaUnidade = tipologias.find(
                  (t) => t.id === unidSel.tipologiaId || t.nome === unidSel.tipologia,
                );
                // O que a vitrine vai mostrar: a escolhida, senão a do tipo.
                const plantaEfetiva = unidSel.plantaUrl ?? tipDaUnidade?.plantaUrl;
                return (
                <>
              {/* ===== Planta da unidade =====
                  ESCOLHER, nao enviar.

                  As plantas sao cadastradas em Tipologias, num lugar so, e a
                  unidade apenas aponta para uma delas. Enviar por aqui criaria
                  um segundo arquivo para o mesmo desenho a cada unidade que o
                  usasse - trezentas unidades, trezentas copias da mesma planta
                  no servidor, e nenhuma forma de trocar todas de uma vez.

                  Serve ao caso real: duas unidades do mesmo tipo em pontas
                  opostas do pavimento tem plantas espelhadas. Cadastram-se as
                  duas em Tipologias e cada unidade escolhe a sua. */}
              <div className="ed-eyebrow pt-1 text-[var(--ed-dim)]">Planta desta unidade</div>
              {plantasDisponiveis.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  {plantaEfetiva && (
                    <img src={plantaEfetiva} alt=""
                      className="h-12 w-12 shrink-0 rounded-[3px] bg-black/30 object-contain ring-1 ring-white/10" />
                  )}
                  <select
                    value={unidSel.plantaUrl ?? ""}
                    onChange={(e) => patchUnidade(unidSel.id, {
                      plantaUrl: e.target.value || undefined,
                    })}
                    className={`${CAMPO} min-w-0 flex-1`}>
                    <option value="" className="bg-[#0a0a0a]">
                      {tipDaUnidade?.plantaUrl
                        ? `a da tipologia (${tipDaUnidade.nome})`
                        : "a da tipologia - sem planta"}
                    </option>
                    {plantasDisponiveis.map((pl) => (
                      <option key={pl.url} value={pl.url} className="bg-[#0a0a0a]">
                        {pl.area}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-[9px] leading-relaxed text-white/30">
                  Nenhuma planta cadastrada. Envie em <b>Tipologias</b> e ela
                  passa a aparecer aqui para escolher.
                </p>
              )}
              <p className="text-[9px] leading-relaxed text-white/30">
                Sem escolha, vale a da tipologia da unidade.
              </p>
                </>
                );
              })()}

              {/* ===== Enquadramento da unidade =====
                  Três valores relativos à unidade, não uma câmera capturada:
                  mover o empreendimento no mapa não invalida os trezentos
                  enquadramentos de uma vez. */}
              <div className="ed-eyebrow pt-1 text-[var(--ed-dim)]">Câmera da unidade</div>
              <p className="text-[10px] leading-relaxed text-white/35">
                De onde a vitrine olha para esta unidade quando o visitante a
                escolhe — e nesse momento só ela fica visível na cena.
              </p>
              {(() => {
                const cam = unidSel.camera ?? CAMERA_UNIDADE_PADRAO;
                const setCam = (p: Partial<typeof cam>) =>
                  patchUnidade(unidSel.id, { camera: { ...cam, ...p } });
                return (
                  <>
                    <Slider label="Ângulo (360°)" v={cam.angulo} min={0} max={360} step={5} suffix="°"
                      onChange={(v) => setCam({ angulo: v })} />
                    <Slider label="Inclinação" v={cam.inclinacao} min={-89} max={0} step={1} suffix="°"
                      onChange={(v) => setCam({ inclinacao: v })} />
                    <Slider label="Distância" v={cam.distancia} min={10} max={400} step={5} suffix="m"
                      onChange={(v) => setCam({ distancia: v })} />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => onTestarCamera(unidSel.id, cam)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-[3px] border border-[var(--ed-line)] py-1 text-[10px] text-white/70 hover:border-white/25 hover:text-white">
                        <Camera className="h-3 w-3" /> Testar
                      </button>
                      {unidSel.camera && (
                        <button
                          onClick={() => patchUnidade(unidSel.id, { camera: undefined })}
                          title="Voltar ao enquadramento padrão do projeto"
                          className="shrink-0 rounded-[3px] border border-[var(--ed-line)] px-2 py-1 text-[10px] text-white/45 hover:border-white/25 hover:text-white/85">
                          padrão
                        </button>
                      )}
                    </div>
                    {/* Aplicar em lote: acertar um ângulo bom e repeti-lo na
                        fachada inteira é o gesto real — trezentas unidades não
                        se enquadram uma a uma. */}
                    {sel.length > 1 && (
                      <button
                        onClick={() => patchSelecionadas({ camera: { ...cam } })}
                        className="w-full rounded-[3px] border border-[var(--ed-line)] py-1 text-[10px] text-white/60 hover:border-white/25 hover:text-white">
                        Aplicar este enquadramento nas {sel.length} selecionadas
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          )}
          </>
          )}
        </Section>
      )}

      {/*
        ===== Torres, num lugar só =====

        A torre estava repartida em três pontos da aba: as pastilhas do topo
        selecionavam, a seção "Torres" renomeava e "Volume 3D da torre"
        dimensionava — esta última falando de "a torre" sem dizer qual, e
        dependendo de uma seleção feita lá em cima. Para mudar o tamanho de uma
        torre era preciso saber que os três lugares eram o mesmo estado.

        Agora é uma lista: clicar na torre a seleciona E abre os controles dela
        ali mesmo. É o padrão que as abas Níveis e Tipologias já usavam.
      */}
      <Section title={`Torres (${torres.length})`}>
        {torres.length === 0 && (
          <p className="text-center text-[10px] leading-relaxed text-white/30">
            Nenhuma torre. Crie a primeira para começar o espelho — é ela que
            define o volume onde as unidades são fatiadas.
          </p>
        )}

        {torres.map((t, i) => {
          const aberta = t.id === torreAtual;
          const nUnid = unidades.filter((u) => u.torre === t.id).length;
          // O volume mostrado é o da torre da LINHA, não o da seleção: cada
          // linha fala de si mesma.
          const vt = volumeDaTorre(t, i, torres.length);
          const ft = faixaVertical(vt, pavCfg);
          return (
            <div key={t.id}
              className={`rounded-[3px] border bg-black/20 ${
                aberta ? "border-teal-400/50" : "border-white/[0.08]"
              }`}>
              <div className="flex items-center gap-1.5 p-1.5">
                <button
                  onClick={() => setTorreSel(t.id)}
                  title="Editar esta torre"
                  className={`min-w-0 flex-1 truncate text-left text-[11px] hover:text-teal-300 ${
                    aberta ? "font-semibold text-teal-300" : "text-white/85"
                  }`}>
                  {t.label}
                  <span className="ml-1 font-normal text-white/35">
                    · {nUnid} un · {Math.round(vt.comprimento)}×{Math.round(vt.largura)}×{Math.round(ft.altura)} m
                  </span>
                </button>
                <button
                  onClick={() => {
                    if (!confirm(`Remover a torre "${t.label}" e as suas ${nUnid} unidade(s)?`)) return;
                    onTorres(torres.filter((x) => x.id !== t.id));
                    onUnidades(unidades.filter((u) => u.torre !== t.id));
                  }}
                  className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              {aberta && (
                <div className="space-y-1.5 border-t border-white/[0.06] p-1.5">
                  <Linha label="Nome">
                    <input value={t.label}
                      onChange={(e) => {
                        const n = [...torres];
                        n[i] = { ...n[i], label: e.target.value };
                        onTorres(n);
                      }}
                      className={CAMPO} />
                  </Linha>

                  <div className="pt-0.5 text-[9px] uppercase tracking-widest text-white/25">
                    Volume 3D
                  </div>
                  <p className="text-[10px] leading-relaxed text-white/35">
                    A caixa em que as unidades do andar são fatiadas. Ajuste até
                    encaixar no prédio — o preview é ao vivo.
                  </p>

                  <div className="flex gap-1">
                    {(["mover", "girar", "escalar"] as GizmoModo[]).map((m) => (
                      <button key={m} onClick={() => onGizmoModo(m)}
                        disabled={sel.length > 0}
                        title={sel.length > 0
                          ? "Limpe a seleção de unidades (Esc) para voltar ao pivô da torre"
                          : undefined}
                        className={`flex-1 rounded-[3px] px-1 py-1 text-[10px] capitalize disabled:opacity-25 ${
                          gizmoModo === m ? "bg-teal-500 font-semibold text-[#0a0a0a]" : "bg-white/8 text-white/55 hover:bg-white/15"
                        }`}>
                        {m}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => onPlacingTorre(placingTorreId === t.id ? null : t.id)}
                    className={`flex w-full items-center justify-center gap-1.5 rounded-[3px] px-3 py-1.5 text-[11px] font-semibold ${
                      placingTorreId === t.id
                        ? "animate-pulse bg-amber-400 text-[#0a0a0a]"
                        : "bg-teal-500 text-[#0a0a0a] hover:bg-teal-400"
                    }`}>
                    <Crosshair className="h-3.5 w-3.5" />
                    {placingTorreId === t.id ? "Clique no mapa..." : "Posicionar no mapa"}
                  </button>

                  {/* step 0,1 e duas casas: encaixar uma caixa num prédio é
                      trabalho de centímetro. */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <NumIn empilhado label="Largura X (m)" v={vt.comprimento} step={0.1} casas={2}
                      onChange={(v) => setVolume({ comprimento: Math.max(0.1, v) })} />
                    <NumIn empilhado label="Profund. Y (m)" v={vt.largura} step={0.1} casas={2}
                      onChange={(v) => setVolume({ largura: Math.max(0.1, v) })} />
                    <NumIn empilhado label="Altura Z (m)" v={ft.altura} step={0.1} casas={2}
                      onChange={(v) => setVolume({ altura: Math.max(0.1, v) })} />
                  </div>

                  <details>
                    <summary className="cursor-pointer text-[10px] text-white/35 hover:text-white/60">
                      Posição e giro
                    </summary>
                    <div className="mt-1.5 space-y-1.5">
                      <div className="grid grid-cols-3 gap-1.5">
                        <NumIn empilhado label="Centro X (m)" v={vt.x} step={0.1} casas={2}
                          onChange={(v) => setVolume({ x: v })} />
                        <NumIn empilhado label="Centro Y (m)" v={vt.y} step={0.1} casas={2}
                          onChange={(v) => setVolume({ y: v })} />
                        <NumIn empilhado label="Base Z (m)" v={ft.base} step={0.1} casas={2}
                          onChange={(v) => setVolume({ z: v })} />
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <NumIn empilhado label="Giro Z (°)" v={vt.rot ?? 0} step={1} casas={1}
                          onChange={(v) => setVolume({ rot: v })} />
                        <NumIn empilhado label="Inclin. X (°)" v={vt.rotX ?? 0} step={1} casas={1}
                          onChange={(v) => setVolume({ rotX: v })} />
                        <NumIn empilhado label="Inclin. Y (°)" v={vt.rotY ?? 0} step={1} casas={1}
                          onChange={(v) => setVolume({ rotY: v })} />
                      </div>
                    </div>
                  </details>

                  <p className="text-[10px] leading-relaxed text-white/30">
                    A altura se divide pelos {pavCfg.numPavimentos} pavimentos e a
                    largura pelas unidades de cada andar, na ordem do número.
                  </p>
                </div>
              )}
            </div>
          );
        })}

        <button
          onClick={() => {
            const label = prompt("Nome da torre (ex: Ocean)")?.trim();
            if (!label) return;
            const id = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-");
            if (torres.some((t) => t.id === id)) return alert("Já existe uma torre com esse id.");
            onTorres([...torres, { id, label }]);
            setTorreSel(id);
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-[3px] border border-[var(--ed-line)] px-3 py-1.5 text-[11px] text-white/70 hover:border-white/25 hover:text-white">
          <Plus className="h-3.5 w-3.5" /> Adicionar torre
        </button>
      </Section>

      {/* CRM */}
      <Section title="Disponibilidade (CRM)" aberta={false}>
        <div className="flex gap-1">
          {([["manual", "Manual"], ["endpoint", "CRM"]] as const).map(([m, l]) => (
            <button key={m} onClick={() => onCrm({ ...crm, mode: m })}
              className={`flex-1 rounded-md px-2 py-1.5 text-[11px] ${
                crm.mode === m ? "bg-teal-500 font-semibold text-[#0a0a0a]" : "bg-white/10 text-white/60 hover:bg-white/20"}`}>
              {l}
            </button>
          ))}
        </div>
        {crm.mode === "endpoint" ? (
          <>
            <Text label="URL do endpoint" v={crm.url ?? ""} onChange={(v) => onCrm({ ...crm, url: v })} />
            <NumIn label="Atualizar a cada (min · 0 = só ao abrir)" v={crm.refreshMin ?? 0} step={1}
              onChange={(v) => onCrm({ ...crm, refreshMin: Math.max(0, Math.round(v)) })} />
            <p className="text-[10px] leading-relaxed text-white/35">
              <Link2 className="mr-1 inline h-3 w-3" />
              Deve devolver JSON no formato <code className="text-white/50">[{"{ numero, torre, status }"}]</code>, com status
              <code className="text-white/50"> disponivel/reservada/vendida</code>. O espelho abaixo é o fallback se o CRM não responder.
            </p>
          </>
        ) : (
          <p className="text-[10px] text-white/35">A disponibilidade é a editada aqui.</p>
        )}
      </Section>

      {/* Planilha */}
      <Section title="Planilha (CSV)" aberta={false}>
        <p className="text-[10px] leading-relaxed text-white/35"
          title="Também reconhece: pavimento, tipologia, areaPrivativa, quartos, suites, vagas, orientacao, preco, status.">
          Casa as colunas pelo <b>cabeçalho</b>, em qualquer ordem; as ausentes
          preservam o que a unidade já tem. Obrigatórias:{" "}
          <code className="text-white/40">torre</code> e{" "}
          <code className="text-white/40">numero</code>.
        </p>
        <Linha label="Ao importar">
          <div className="flex rounded-[3px] border border-white/[0.08] bg-black/25 p-[2px]">
            {([["mesclar", "Mesclar"], ["substituir", "Substituir"]] as const).map(([m, l]) => (
              <button key={m} onClick={() => setModoImport(m)}
                className={`flex-1 rounded-[2px] px-1 py-[3px] text-[10px] ${
                  modoImport === m ? "bg-teal-500/90 font-semibold text-[#0a0a0a]" : "text-white/50 hover:text-white/85"
                }`}>
                {l}
              </button>
            ))}
          </div>
        </Linha>
        <p className="text-[10px] leading-relaxed text-white/30">
          {modoImport === "mesclar"
            ? "As unidades que não estiverem na planilha permanecem como estão."
            : "O espelho passa a ser exatamente o da planilha — o que não estiver nela é removido."}
        </p>
        <div className="flex gap-1.5">
          <button onClick={exportarCsv}
            className="flex-1 rounded-md bg-white/10 px-2 py-1.5 text-[11px] text-white/70 hover:bg-white/20">
            Exportar CSV
          </button>
          <label className="flex-1 cursor-pointer rounded-md bg-white/10 px-2 py-1.5 text-center text-[11px] text-white/70 hover:bg-white/20">
            Importar CSV
            <input type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importarCsv(f); e.target.value = ""; }} />
          </label>
        </div>
        {msgImport && <p className="text-[10px] text-teal-300">{msgImport}</p>}
      </Section>
    </>
  );
}
