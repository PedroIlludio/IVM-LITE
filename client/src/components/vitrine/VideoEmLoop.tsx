import { useEffect, useRef } from "react";

/** Quanto antes do fim o vídeo volta ao começo, em segundos. */
const ANTECIPACAO = 0.25;

/** Acima disto o vídeo não é guardado em memória: toca direto da rede. */
const LIMITE_COPIA_BYTES = 80 * 1024 * 1024;

/**
 * Vídeo de fundo em loop SEM a pausa na emenda.
 *
 * Duas causas para o vídeo congelar ao recomeçar, e uma resposta para cada:
 *
 * 1. O `loop` nativo só volta DEPOIS do fim: para no último quadro e então
 *    busca o começo. Aqui o retorno acontece um pouco antes, ainda tocando.
 * 2. Voltar ao início pede de novo aquele trecho ao servidor quando ele saiu
 *    do buffer — numa conexão comum, é o vídeo parado por um tempo a cada
 *    volta. Por isso o arquivo é baixado inteiro UMA vez, em segundo plano, e
 *    a partir da primeira volta toca dessa cópia local: nenhuma emenda depende
 *    mais da rede.
 *
 * O `loop` nativo fica ligado como rede de segurança (aba em segundo plano
 * atrasa o quadro de verificação).
 */
export default function VideoEmLoop({ src, poster, className }: {
  src: string;
  poster?: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let quadro = 0;
    let copia: string | null = null;
    let trocou = false;
    const ctrl = new AbortController();

    // Cópia local, em segundo plano. Falhou ou é grande demais: segue da rede.
    fetch(src, { signal: ctrl.signal })
      .then(async (r) => {
        const tam = Number(r.headers.get("content-length") ?? 0);
        if (!r.ok || tam > LIMITE_COPIA_BYTES) return;
        const blob = await r.blob();
        if (!ctrl.signal.aborted && blob.size <= LIMITE_COPIA_BYTES) copia = URL.createObjectURL(blob);
      })
      .catch(() => {});

    const verificar = () => {
      const d = v.duration;
      if (Number.isFinite(d) && d > ANTECIPACAO * 4 && v.currentTime >= d - ANTECIPACAO) {
        if (copia && !trocou) {
          // A troca acontece na emenda, onde o salto já é esperado.
          trocou = true;
          v.src = copia;
        }
        v.currentTime = 0;
        if (v.paused) void v.play().catch(() => {});
      }
      quadro = requestAnimationFrame(verificar);
    };
    quadro = requestAnimationFrame(verificar);

    return () => {
      ctrl.abort();
      cancelAnimationFrame(quadro);
      if (copia) URL.revokeObjectURL(copia);
    };
  }, [src]);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      className={className}
    />
  );
}
