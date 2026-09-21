import { useEffect, useState } from "react";
import { Clock, X, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { corDaCategoriaPoi, iconeDaCategoria, type EstiloPoi } from "@/lib/poi-icones";
import type { EditablePoi } from "@/lib/ivm-store";

/**
 * Cartão de detalhe do ponto de interesse, no lado DIREITO do viewport.
 *
 * Direita porque a esquerda é do painel do empreendimento: os dois abertos do
 * mesmo lado disputariam o mesmo espaço, e fechar um para ler o outro quebra a
 * comparação — que é exatamente o gesto de quem está avaliando o entorno.
 *
 * Só aparece quando há o que dizer. Um ponto sem descrição nem foto já está
 * inteiro na lista da esquerda (nome, ícone, tempo); repetir isso num cartão
 * vazio seria ruído ocupando um terço da cena.
 */
export function CartaoPoi({ poi, estilo, onFechar, onFoto }: {
  poi: EditablePoi | null;
  estilo?: EstiloPoi;
  onFechar: () => void;
  /** Abre a foto em tela cheia — reaproveita o lightbox da vitrine. */
  onFoto?: (url: string) => void;
}) {
  const [iFoto, setIFoto] = useState(0);

  // Trocar de ponto volta para a capa. Sem isto, escolher um ponto com uma foto
  // logo depois de outro com cinco deixava o índice fora da faixa e o cartão
  // abria vazio.
  useEffect(() => { setIFoto(0); }, [poi?.id]);

  if (!poi) return null;
  const fotos = poi.fotos ?? [];
  const temConteudo = fotos.length > 0 || !!poi.descricao?.trim();
  if (!temConteudo) return null;

  const Icone = iconeDaCategoria(poi.categoria, estilo);
  const cor = corDaCategoriaPoi(poi.categoria, estilo);
  const atual = fotos[Math.min(iFoto, fotos.length - 1)];
  const passo = (d: number) => setIFoto((i) => (i + d + fotos.length) % fotos.length);

  return (
    /*
      `top-[72px]`, não `top-4`: "Vista principal", noturno e captura vivem no
      canto superior direito. Colado no alto, o cartão nascia por cima deles — o
      visitante abria um ponto de interesse e perdia o botão de voltar para a
      vista principal, que é justamente o que ele quer depois de olhar o entorno.
    */
    <div
      data-testid="cartao-poi"
      className="absolute right-4 top-[72px] z-30 flex max-h-[calc(100vh-96px)] w-[min(92vw,340px)] flex-col overflow-hidden rounded-[10px] glassmorphism shadow-2xl"
    >
      {fotos.length > 0 && (
        <div className="relative shrink-0">
          <img
            src={atual}
            alt={poi.name}
            onClick={() => onFoto?.(atual)}
            className="h-[190px] w-full cursor-zoom-in object-cover"
          />
          {fotos.length > 1 && (
            <>
              <button
                onClick={() => passo(-1)}
                aria-label="Foto anterior"
                className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white/85 hover:bg-black/70"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => passo(1)}
                aria-label="Próxima foto"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white/85 hover:bg-black/70"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              {/* Pontinhos: dizem QUANTAS fotos existem. Sem eles a seta é a
                  única pista de que há mais, e ela some na foto escura. */}
              <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
                {fotos.map((_, k) => (
                  <span
                    key={k}
                    className={`h-1.5 w-1.5 rounded-full ${
                      k === Math.min(iFoto, fotos.length - 1) ? "bg-white" : "bg-white/40"
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={onFechar}
        aria-label="Fechar"
        className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white/85 hover:bg-black/70"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Rola só o texto: descrição longa não pode empurrar a foto para fora
          da tela nem estourar o cartão para baixo do rodapé. */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3.5">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex-shrink-0" style={{ color: cor }}>
            <Icone className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="v-body-sm font-semibold leading-snug">{poi.name}</h3>
            {poi.categoria && <p className="v-meta">{poi.categoria}</p>}
          </div>
          {poi.tempo && (
            <div className="flex flex-shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 py-0.5">
              <Clock className="h-3 w-3 text-[var(--v-ink-3)]" />
              <span className="v-meta whitespace-nowrap">{poi.tempo}</span>
            </div>
          )}
        </div>

        {poi.descricao?.trim() && (
          // `whitespace-pre-line`: o corretor escreve em parágrafos no editor, e
          // sem isto tudo virava um bloco corrido.
          <p className="v-body-sm whitespace-pre-line leading-relaxed text-[var(--v-ink-2)]">
            {poi.descricao}
          </p>
        )}

        {!fotos.length && (
          <p className="v-meta flex items-center gap-1">
            <MapPin className="h-3 w-3" /> Sem fotos deste ponto
          </p>
        )}
      </div>
    </div>
  );
}
