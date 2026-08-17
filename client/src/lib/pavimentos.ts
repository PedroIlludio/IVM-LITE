import type { CameraView } from "./placements";

/**
 * Mapa de pavimentos para o modo "Pavimentos 3D" (corte + vista por andar).
 *
 * O GLB é uma fachada (sem lajes reais), então as alturas são uma aproximação
 * VISUAL calibrada no 3D. Base do modelo em Z ≈ -3.1 (m), topo ≈ 27.3 → ~30 m.
 * Usamos 10 níveis residenciais de ~3 m (Térreo + Pav 1–9) e o Rooftop acima.
 */

/** Z (espaço do modelo) da base do prédio — descoberto pela bbox do GLB. */
export const MODEL_BASE_Z = -3.1;
/** Altura de cada nível (m). */
export const NIVEL_M = 3;
/** Azimute (graus) da vista para o mar a partir do terreno (leste). */
export const SEA_HEADING = 92;

export type PavTipo = "rooftop" | "unidades" | "terreo" | "subsolo";

export interface Pavimento {
  id: string;
  label: string;
  tipo: PavTipo;
  /** Nº do pavimento (para filtrar unidades), quando tipo = "unidades". */
  pavimento?: number;
  /** Altura da câmera acima do solo (m) para a vista daquele nível. */
  camH: number;
  /** Z de corte no modelo; null = sem corte (prédio inteiro). */
  cutZ: number | null;
  /** Trecho do nome da planta humanizada (para níveis especiais). */
  plantaMatch?: string;

  // --- Campos do nível EDITADO no editor (ausentes na escada automática) ----

  /**
   * Área do corte: um retângulo no plano do modelo. Tudo o que estiver ACIMA
   * dele é removido; fora dele, o empreendimento fica íntegro.
   *
   * Ausente = o corte atravessa o modelo inteiro.
   *
   * É um retângulo livre, e não uma referência a uma torre, de propósito: o
   * modelo importado é o empreendimento completo e o que se quer abrir quase
   * nunca coincide com o volume calibrado de um bloco — é uma ala, uma lâmina,
   * meio pavimento. Amarrar o corte à torre obrigava a calibrar o volume dela
   * primeiro só para poder cortar.
   *
   * `rot` é o giro do retângulo em torno do vertical, em graus.
   */
  area?: { x: number; y: number; comprimento: number; largura: number; rot: number };
  /** Bloco a que o nível se refere (rótulo e filtro de unidades, não o corte). */
  torreId?: string;
  /**
   * Distância da câmera acima do corte, em metros do modelo. Sobrepõe a
   * distância do projeto — use só quando um nível precisa de outro alcance
   * (um rooftop mais largo, por exemplo).
   *
   * A câmera em si NÃO é guardada: ela é derivada do centro da área, olhando
   * para baixo. Câmera capturada à mão mudava de enquadramento a cada andar,
   * e a diferença de um pavimento para o outro parecia desleixo.
   */
  camDist?: number;
  /** Inclinação só deste nível (graus). Sem ela, a do projeto. */
  camPitch?: number;
  /**
   * Giro só deste nível (graus), somado ao eixo maior do retângulo.
   *
   * Existe pelo mesmo motivo de `camPitch`: um pavimento cuja planta lê melhor
   * virada — uma ala em L, um rooftop com a piscina de um lado — não deve
   * obrigar a virar a sequência inteira.
   */
  camGiro?: number;
  /**
   * Texto do nível na vitrine, escrito no editor.
   *
   * Antes esta linha era uma de três frases FIXAS no código, escolhidas pelo
   * tipo do nível ("Garagem e infraestrutura", "Lazer no rooftop — vista
   * panorâmica do mar"…). Eram copy do piloto: num empreendimento cujo
   * subsolo não é garagem, a vitrine afirmava algo falso e não havia onde
   * corrigir. Vazio = a linha não aparece.
   */
  descricao?: string;
  /** Planta deste nível (URL direta; substitui o casamento por nome). */
  plantaUrl?: string;
  /**
   * Deita a planta NO CHÃO do pavimento, dentro da cena 3D.
   *
   * A `plantaUrl` já existia, mas só como imagem 2D ao lado do modelo. Aqui ela
   * vira parte da cena: o visitante vê a distribuição dos ambientes no lugar
   * onde eles ficam, em vez de comparar um desenho com um volume e ter de fazer
   * a correspondência de cabeça.
   *
   * Usa o MESMO retângulo do corte (`area`) — posição, tamanho e giro. É o que
   * garante que a planta e o corte falem do mesmo pavimento: dois retângulos
   * independentes divergiriam no primeiro ajuste.
   */
  plantaNoChao?: boolean;
  /**
   * Retângulo PRÓPRIO da planta: onde ela é deitada, com que tamanho e giro.
   *
   * Numa primeira versão a planta usava o retângulo do corte (`area`). Estava
   * errado por um motivo simples: o corte do MODELO INTEIRO — sem retângulo — é
   * o caso normal, e nele a planta ficava bloqueada por um pré-requisito que
   * quase nenhum nível tem. Pior, amarrava duas coisas independentes: o corte
   * delimita o que some, a planta delimita onde o desenho encosta.
   *
   * Ausente, nasce do retângulo do corte quando há um; senão, da pegada da
   * torre do nível; senão, de um retângulo de partida para ajustar.
   */
  plantaArea?: { x: number; y: number; comprimento: number; largura: number; rot: number };
  /**
   * Altura da planta MEDIDA A PARTIR DO CORTE, em metros do modelo.
   *
   * Relativa, e não absoluta. Já foi das duas formas e a absoluta estava
   * errada: derivar o piso de um pé-direito — configurado ou lido do nível de
   * baixo — é sempre um palpite sobre a geometria de um GLB que ninguém aqui
   * modelou. Errado o palpite, a planta nasce fora do piso em TODOS os
   * pavimentos e o usuário corrige um por um sem saber de onde vem a diferença.
   *
   * Relativa, não há palpite nenhum: a planta fica onde o usuário disse que ela
   * fica, contado do plano de corte — que é a única referência que ele enxerga
   * na tela. E resolve de graça o que exigia código: duplicar um nível preserva
   * a distância, arrastar o corte leva a planta junto, e o valor achado num
   * pavimento vale para os outros, porque os pavimentos são iguais.
   *
   * O pivô da planta escreve AQUI. Ausente, 0,05 — rente ao corte, longe o
   * bastante para não brigar em profundidade com a laje.
   */
  plantaZOffset?: number;
  /** Opacidade da planta no 3D (0 a 1). Sem ela, 0,85. */
  plantaOpacidade?: number;
}

/** Nível é o pavimento já editável — mesmo formato, nome do domínio novo. */
export type NivelDef = Pavimento;

/**
 * Nível que abre um pavimento, para o corte seguir a unidade em edição.
 *
 * Procura entre os níveis EDITADOS primeiro — são eles que têm a cota calibrada
 * à mão e o retângulo do bloco. Só quando nenhum corresponde é que cai na
 * escada automática, que acerta o pé-direito uniforme e erra o resto.
 *
 * O bloco entra na busca porque num projeto de várias torres o "4º pavimento"
 * existe em cada uma, em cotas diferentes. Um nível sem bloco atende qualquer
 * torre: ele corta o modelo inteiro, que é o que ele se propõe a fazer.
 */
export function nivelDoPavimento(
  niveis: NivelDef[], cfg: Partial<PavimentosCfg>, pavimento: number, torreId?: string,
): NivelDef | null {
  const candidatos = niveis.filter((n) => n.pavimento === pavimento && n.cutZ != null);
  return (
    candidatos.find((n) => n.torreId === torreId)
    ?? candidatos.find((n) => !n.torreId)
    ?? pavimentos(cfg).find((p) => p.pavimento === pavimento && p.cutZ != null)
    ?? null
  );
}

/** Altura da planta do nível no modelo: o corte mais o deslocamento dela. */
export function alturaDaPlanta(n: NivelDef): number | null {
  return n.cutZ == null ? null : n.cutZ + (n.plantaZOffset ?? 0.05);
}

/**
 * Calibração de pavimentos de um projeto. Cada IVM Lite tem o seu modelo, então
 * base/altura/nº de andares vêm da config; os defaults são os do Quinta.
 */
export interface PavimentosCfg {
  /** Z da base do prédio no espaço do modelo. */
  baseZ: number;
  /** Altura de cada nível (m). */
  nivelM: number;
  /** Nº de pavimentos de unidades (1..N). */
  numPavimentos: number;
  /** Azimute (graus) da vista principal a partir de cada andar. */
  viewHeading: number;
  /**
   * Distância da câmera acima do corte, em metros do modelo.
   *
   * É UMA para o projeto inteiro, de propósito: é o que faz a troca de
   * pavimento ser um movimento vertical limpo, sem o enquadramento pular de
   * um andar para o outro.
   */
  camDist: number;
  /**
   * Inclinação da câmera do corte, em graus. -90 é a vista de cima (planta);
   * valores maiores inclinam para a perspectiva. Vale para todos os níveis,
   * pelo mesmo motivo da distância.
   */
  camPitch: number;
  /** Giro da câmera a partir do eixo maior da área, em graus. */
  camGiro: number;
  temRooftop: boolean;
  temTerreo: boolean;
  temSubsolo: boolean;
}

export const DEFAULT_PAV_CFG: PavimentosCfg = {
  baseZ: MODEL_BASE_Z,
  nivelM: NIVEL_M,
  numPavimentos: 9,
  viewHeading: SEA_HEADING,
  camDist: 70,
  camPitch: -90,
  camGiro: 0,
  temRooftop: true,
  temTerreo: true,
  temSubsolo: true,
};

// Ordem do topo (rooftop) para a base (subsolo) — como aparece na régua.
export function pavimentos(cfg: Partial<PavimentosCfg> = {}): Pavimento[] {
  const c = { ...DEFAULT_PAV_CFG, ...cfg };
  const list: Pavimento[] = [];
  // Rooftop (sem corte — prédio inteiro; vista mais alta).
  if (c.temRooftop) {
    list.push({
      id: "rooftop",
      label: "Rooftop",
      tipo: "rooftop",
      camH: c.nivelM * (c.numPavimentos + 1) + 1.5,
      cutZ: null,
      plantaMatch: "Rooftop",
    });
  }
  // Pavimentos N → 1.
  for (let n = c.numPavimentos; n >= 1; n--) {
    list.push({
      id: `pav-${n}`,
      label: `${n}º Pavimento`,
      tipo: "unidades",
      pavimento: n,
      camH: c.nivelM * n + 1.5,
      cutZ: c.baseZ + c.nivelM * (n + 1), // corta no teto do andar n
    });
  }
  // Térreo.
  if (c.temTerreo) {
    list.push({ id: "terreo", label: "Térreo", tipo: "terreo", camH: 1.6, cutZ: c.baseZ + c.nivelM, plantaMatch: "Térreo" });
  }
  // Subsolo (sem corte/vista — só planta).
  if (c.temSubsolo) {
    list.push({ id: "subsolo", label: "Subsolo", tipo: "subsolo", camH: 1.6, cutZ: null, plantaMatch: "Subsolo" });
  }
  return list;
}

/**
 * Níveis em vigor: os editados no projeto, se houver, senão a escada
 * automática da calibração.
 *
 * A escada deixou de ser o mecanismo e passou a ser o PADRÃO: continua
 * servindo o projeto que nunca abriu a aba Níveis (nenhum deles quebra), e
 * serve de ponto de partida para quem vai ajustar à mão. Um empreendimento
 * com três torres de alturas diferentes não é representável por uma escada
 * uniforme — e era só isso que existia.
 */
export function niveisDe(cfg: Partial<PavimentosCfg>, niveis?: NivelDef[]): NivelDef[] {
  return niveis?.length ? niveis : pavimentos(cfg);
}

/**
 * Semeia a lista editável a partir da calibração — o mesmo gesto do gerador
 * de unidades: gera e depois se ajusta, em vez de digitar dez níveis à mão.
 *
 * Quando um bloco é indicado, os níveis nascem presos a ele (recortando só a
 * pegada dele) e com ids próprios, para as escadas de duas torres poderem
 * conviver na mesma lista.
 */
export function gerarNiveis(
  cfg: Partial<PavimentosCfg>,
  torreId?: string,
  area?: NivelDef["area"],
): NivelDef[] {
  const sufixo = torreId ? `-${torreId}` : "";
  return pavimentos(cfg).map((p) => ({
    ...p,
    id: `${p.id}${sufixo}`,
    torreId,
    area: area ? { ...area } : undefined,
  }));
}
