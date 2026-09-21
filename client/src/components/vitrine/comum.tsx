import { useEffect, useState, type ReactNode } from "react";
import { MessageCircle, Phone, Mail, type LucideIcon } from "lucide-react";
import { montarMensagemContato, type ContatoCfg } from "@/lib/ivm-store";
import type { UnidadeStatus } from "@/lib/unidades";

/** Mesma consulta das regras de celular em vitrine.css — as duas precisam concordar. */
export const CONSULTA_MOVEL =
  "(max-width: 767px), (max-width: 1024px) and (max-height: 500px) and (pointer: coarse)";

/** Celular (retrato, ou deitado com toque)? Para o que o CSS sozinho não resolve. */
export function useMovel() {
  const [movel, setMovel] = useState(
    () => typeof window !== "undefined" && window.matchMedia(CONSULTA_MOVEL).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(CONSULTA_MOVEL);
    const ver = () => setMovel(mq.matches);
    ver();
    mq.addEventListener("change", ver);
    return () => mq.removeEventListener("change", ver);
  }, []);
  return movel;
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
 * Ilha vertical de navegação (desktop).
 *
 * Botões fixos de 42px; o rótulo é uma etiqueta FORA da ilha e só aparece no
 * hover do próprio item (ver `.vd-ilha-*` em vitrine.css). O ativo é indicado
 * apenas pelo fundo do ícone.
 */
export function IlhaNav({ itens, ativa, onEscolher, claro = false }: {
  itens: ItemNav[];
  ativa: Secao;
  onEscolher: (s: Secao) => void;
  claro?: boolean;
}) {
  return (
    <nav className="vd-ilha" data-claro={claro ? "1" : undefined} aria-label="Seções">
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

/** Barra de seções do celular: rolável, sem Home. */
export function BarraMovel({ itens, ativa, onEscolher }: {
  itens: ItemNav[];
  ativa: Secao;
  onEscolher: (s: Secao) => void;
}) {
  return (
    <nav className="vd-barra-movel vd-vidro-barra" aria-label="Seções">
      {itens.filter((i) => i.id !== "home").map(({ id, rotulo, icone: Icone }) => (
        <button
          key={id}
          type="button"
          onClick={() => onEscolher(ativa === id ? "home" : id)}
          data-on={ativa === id ? "1" : undefined}
          aria-label={rotulo}
        >
          <Icone className="h-4 w-4" strokeWidth={1.5} />
          <span className="vd-micro">{rotulo}</span>
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
