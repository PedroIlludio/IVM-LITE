import { useEffect, useState, type ReactNode } from "react";
import { MessageCircle, Phone, Mail, type LucideIcon } from "lucide-react";
import { montarMensagemContato, type ContatoCfg } from "@/lib/ivm-store";
import type { UnidadeStatus } from "@/lib/unidades";

/**
 * Mesma consulta das regras compactas em vitrine.css — as duas precisam concordar.
 *
 * "Compacto" deixou de ser só o celular. Até 1024px em pé — iPad, iPad Pro em
 * retrato, celular grande — a cena não cabe junto de um cartão de 300px à
 * direita: sobravam ~370px de maquete entre a ilha e o painel, e o cartão da
 * unidade abria por cima da lista. Nessas telas a vitrine passa a usar o mesmo
 * desenho do celular (seção em tela cheia, coluna à esquerda), que é largo o
 * bastante para ler e não disputa espaço com a maquete.
 *
 * A segunda linha é a tela BAIXA (celular deitado, janela curta): ali o cartão
 * da direita não tem altura para existir. Não pede mais `pointer: coarse` —
 * uma janela de 1024×420 no desktop sofre do mesmo aperto.
 */
export const CONSULTA_MOVEL =
  "(max-width: 1024px) and (orientation: portrait), (max-width: 1024px) and (max-height: 540px)";

/**
 * A fatia TABLETE do compacto — o sub-bloco `(min-width: 600px) and
 * (min-height: 600px)` de vitrine.css, escrito por extenso.
 *
 * O segundo braço de `CONSULTA_MOVEL` (tela baixa) não sobrevive a
 * `min-height: 600px`, então a interseção das duas é esta linha só.
 *
 * Existe porque nem tudo que o celular ESCONDE deve sumir no iPad. No celular a
 * lista de pontos do entorno sai e o visitante toca os alfinetes; numa tela de
 * 768×1024 cabem a lista E o mapa, e tirá-la seria perder dez endereços com
 * tempo de deslocamento — o conteúdo que justifica a seção.
 */
export const CONSULTA_TABLETE =
  "(min-width: 600px) and (min-height: 600px) and (max-width: 1024px) and (orientation: portrait)";

function useConsulta(consulta: string) {
  const [vale, setVale] = useState(
    () => typeof window !== "undefined" && window.matchMedia(consulta).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const ver = () => setVale(mq.matches);
    ver();
    mq.addEventListener("change", ver);
    return () => mq.removeEventListener("change", ver);
  }, [consulta]);
  return vale;
}

/** Tela compacta (celular, ou tablet em pé)? Para o que o CSS sozinho não resolve. */
export function useMovel() {
  return useConsulta(CONSULTA_MOVEL);
}

/** Dentro do compacto, é a fatia tablete? Implica `useMovel()`. */
export function useTablete() {
  return useConsulta(CONSULTA_TABLETE);
}

/** Seções da ilha de navegação. `comparar` é tela, não seção: sai de Unidades. */
export type Secao = "home" | "projeto" | "lazer" | "unidades" | "local" | "galeria";
export type Tela = Secao | "comparar";

/** Seções em que o 3D aparece — e com ele o controle de clima. */
export const TELAS_COM_3D: Tela[] = ["home", "projeto", "unidades"];

/** Cor do status sobre vidro escuro e sobre fundo claro. */
export const COR_STATUS: Record<UnidadeStatus, { escuro: string; claro: string; label: string }> = {
  disponivel: { escuro: "#9ec9a6", claro: "#3f6b4f", label: "Disponível" },
  reservada: { escuro: "#c9a06a", claro: "#8a6f4e", label: "Reservada" },
  vendida: { escuro: "#d79a92", claro: "#8c3b30", label: "Vendida" },
};

export interface ItemNav {
  id: Secao;
  rotulo: string;
  icone: LucideIcon;
}

/** Símbolo da marca invertido (branco) para fundo escuro. */
export function Simbolo({ url, tamanho, claro = false, alt = "" }: {
  url?: string; tamanho: number; claro?: boolean; alt?: string;
}) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt={alt}
      style={{
        height: tamanho,
        width: "auto",
        filter: claro ? "brightness(0) opacity(.87)" : "brightness(0) invert(1)",
      }}
    />
  );
}

/**
 * Ilha vertical de navegação.
 *
 * Botões fixos de 42px; o rótulo é uma etiqueta FORA da ilha e só aparece no
 * hover do próprio item (ver `.vd-ilha-*` em vitrine.css). O ativo é indicado
 * apenas pelo fundo do ícone.
 *
 * `naHome` existe porque no celular a ilha desce para a coluna da esquerda,
 * junto do controle de luz, e lá ela divide a tela com as seções — que no
 * celular são tela cheia e já têm o próprio botão de voltar. Quem sabe em que
 * seção estamos é a página, não o CSS: ela marca e a media query decide.
 */
export function IlhaNav({ itens, ativa, onEscolher, claro = false, naHome = true }: {
  itens: ItemNav[];
  ativa: Secao;
  onEscolher: (s: Secao) => void;
  claro?: boolean;
  naHome?: boolean;
}) {
  return (
    <nav
      className="vd-ilha"
      data-claro={claro ? "1" : undefined}
      data-home={naHome ? "1" : undefined}
      aria-label="Seções"
    >
      {itens.map(({ id, rotulo, icone: Icone }) => (
        <button
          key={id}
          type="button"
          onClick={() => onEscolher(id)}
          data-on={ativa === id ? "1" : undefined}
          aria-current={ativa === id ? "page" : undefined}
          aria-label={rotulo}
          title={rotulo}
          data-testid={`nav-${id}`}
          className="vd-ilha-btn"
        >
          <Icone className="h-[18px] w-[18px]" strokeWidth={1.5} />
          <span className="vd-ilha-rotulo vd-rotulo">{rotulo}</span>
        </button>
      ))}
    </nav>
  );
}

/** Cabeçalho de cartão: rótulo de seção + ação à direita. */
export function CabecalhoCartao({ rotulo, extra, acao }: {
  rotulo: string; extra?: ReactNode; acao?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-4 py-3">
      <span className="vd-rotulo">{rotulo}</span>
      {extra}
      <span className="ml-auto flex items-center">{acao}</span>
    </div>
  );
}

/** Alça da folha inferior (celular): toque fecha a seção. */
export function Alca({ onFechar }: { onFechar: () => void }) {
  return (
    <button type="button" onClick={onFechar} aria-label="Fechar"
      className="vd-alca h-5 w-full shrink-0 items-center justify-center pt-2">
      <span className="block h-[3px] w-[34px] rounded-full bg-current opacity-40" />
    </button>
  );
}

export interface CanalContato {
  id: string;
  href: string;
  label: string;
  icone: ReactNode;
}

/**
 * Canais de contato preenchidos no projeto, WhatsApp primeiro — é o canal que
 * leva a mensagem já escrita com a unidade.
 */
export function canaisDeContato(
  contato: ContatoCfg | undefined,
  empreendimento: string,
  unidade?: string,
): CanalContato[] {
  if (!contato) return [];
  const out: CanalContato[] = [];
  const texto = montarMensagemContato(contato.mensagem, {
    unidade: unidade ?? "",
    empreendimento,
  });
  const zap = (contato.whatsapp ?? "").replace(/\D/g, "");
  if (zap) {
    out.push({
      id: "whatsapp",
      href: `https://wa.me/${zap}?text=${encodeURIComponent(texto)}`,
      label: "WhatsApp",
      icone: <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.5} />,
    });
  }
  if (contato.telefone?.trim()) {
    out.push({
      id: "telefone",
      href: `tel:${contato.telefone.replace(/[^\d+]/g, "")}`,
      label: "Ligar",
      icone: <Phone className="h-3.5 w-3.5" strokeWidth={1.5} />,
    });
  }
  if (contato.email?.trim()) {
    const assunto = unidade ? `${empreendimento} — unidade ${unidade}` : empreendimento;
    out.push({
      id: "email",
      href: `mailto:${contato.email.trim()}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(texto)}`,
      label: "E-mail",
      icone: <Mail className="h-3.5 w-3.5" strokeWidth={1.5} />,
    });
  }
  return out;
}

/** "1,48 M" / "890 mil" — preço abreviado da lista (centavos na entrada). */
export function precoAbreviado(centavos?: number): string {
  if (centavos == null) return "—";
  const reais = centavos / 100;
  if (reais >= 1_000_000) {
    return `${(reais / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
  }
  return `${Math.round(reais / 1000).toLocaleString("pt-BR")} mil`;
}

export const doisDigitos = (n: number) => String(n).padStart(2, "0");
