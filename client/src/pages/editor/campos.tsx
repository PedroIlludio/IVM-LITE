import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Globe2, Plus, Trash2, Upload } from "lucide-react";
import { genId } from "@/lib/ivm-store";
import type { ItemLista } from "@shared/schema";

/* ---------------------------------------------------------------------------
   PRIMITIVAS DO INSPETOR

   Saíram de `ivm-editor.tsx` — onde dividiam um arquivo de cinco mil linhas com
   a página inteira e as duas abas mais pesadas. São controles genéricos: não
   conhecem projeto, unidade nem nível, e é justamente por isso que servem às
   onze abas. Quem precisa de contexto do projeto mora na aba dele.
   --------------------------------------------------------------------------- */

/**
 * Classe base dos campos.
 *
 * `text-input` do DESIGN.md: fill `canvas-soft`, hairline, raio 8px. O padding
 * da spec (12/16px) é de formulário de marketing — num inspetor com trinta
 * campos ele empurraria metade da aba para fora da tela, então fica no passo
 * de 4px da própria escala. Raio 6px em vez de 8: num campo de 22px de altura
 * o 8px come os cantos do valor.
 */
export const CAMPO =
  "w-full rounded-[6px] border border-[var(--ed-line)] bg-[var(--ed-soft)] px-2 py-[3px] text-[11px] " +
  "text-white outline-none transition-colors placeholder:text-[var(--ed-dim)] " +
  "hover:border-white/25 focus:border-white/55 focus:bg-[#22242a]";

export function Linha({ label, children, empilhado }: {
  label?: string; children: React.ReactNode; empilhado?: boolean;
}) {
  if (empilhado) {
    return (
      <div>
        {label && <span className="mb-1 block text-[10px] text-[var(--ed-dim)]">{label}</span>}
        {children}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="w-[84px] shrink-0 truncate text-[10px] text-[var(--ed-dim)]" title={label}>
          {label}
        </span>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Campo numerico com SCRUB: arrastar na horizontal varia o valor, clicar entra
 * em digitacao. E o gesto padrao de Blender, Figma e After Effects - bem mais
 * rapido do que mirar na setinha de um input[type=number] para calibrar 3D.
 * Shift reduz o passo, para ajuste fino.
 */
export function NumeroScrub({ v, step = 1, casas: casasProp, onChange, mono = true, disabled }: {
  v: number;
  /** Quanto o valor anda por pixel de arraste. */
  step?: number;
  /**
   * Casas decimais gravadas. Separado do `step` de propósito.
   *
   * As duas coisas eram a mesma: as casas saíam do `step`, então um campo com
   * `step={1}` — o caso de quase toda medida em metros — gravava INTEIROS. Não
   * dava para pôr 12,5 m numa torre nem digitando: o valor era arredondado na
   * hora. Quem quer arrastar de metro em metro não quer, por isso, perder o
   * meio metro.
   */
  casas?: number;
  onChange: (v: number) => void;
  mono?: boolean;
  disabled?: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [txt, setTxt] = useState("");
  const arraste = useRef<{ x: number; v0: number; moveu: boolean } | null>(null);
  /**
   * Duas casas por padrão, SEMPRE.
   *
   * As casas saíam do `step`, então todo campo com `step={1}` — a maioria —
   * gravava inteiro: não dava para pôr 12,5 m nem digitando, porque o valor era
   * arredondado na hora. Este é um editor de calibração 3D; medida em metro
   * redondo é exceção, não regra.
   *
   * Não estraga os campos que querem inteiro (pavimento, nº de andares): eles
   * já arredondam no próprio `onChange`. E `Number(n.toFixed(2))` descarta zero
   * à direita, então 5 continua aparecendo como "5", não "5,00".
   */
  const casas = casasProp ?? Math.max(2, (String(step).split(".")[1] ?? "").length);

  function aplicar(n: number) {
    if (Number.isFinite(n)) onChange(Number(n.toFixed(casas)));
  }

  // Travado: o valor continua legível (é informação), mas sem os gestos. Um
  // `disabled` de input não bastaria — o scrub é um div com handlers de ponteiro.
  if (disabled) {
    return (
      <div className={`${CAMPO} flex items-center justify-between opacity-40 ${mono ? "font-mono" : ""}`}
        title="Travado">
        <span className="truncate">{Number(v.toFixed(casas))}</span>
      </div>
    );
  }

  if (editando) {
    return (
      <input
        autoFocus
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => { aplicar(parseFloat(txt.replace(",", "."))); setEditando(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { aplicar(parseFloat(txt.replace(",", "."))); setEditando(false); }
          if (e.key === "Escape") setEditando(false);
        }}
        className={`${CAMPO} font-mono`}
      />
    );
  }

  return (
    <div
      className={`ed-scrub ${CAMPO} flex items-center justify-between ${mono ? "font-mono" : ""}`}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        arraste.current = { x: e.clientX, v0: v, moveu: false };
      }}
      onPointerMove={(e) => {
        const a = arraste.current;
        if (!a) return;
        const dx = e.clientX - a.x;
        // So altera depois de 3px: senao um clique tremido mudaria o valor.
        if (!a.moveu && Math.abs(dx) < 3) return;
        a.moveu = true;
        aplicar(a.v0 + dx * step * (e.shiftKey ? 0.2 : 1));
      }}
      onPointerUp={(e) => {
        const a = arraste.current;
        arraste.current = null;
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        // Clique sem arraste = digitar.
        if (a && !a.moveu) { setTxt(String(v)); setEditando(true); }
      }}
      title="Arraste para alterar - clique para digitar - Shift para ajuste fino"
    >
      <span className="truncate">{Number(v.toFixed(casas))}</span>
    </div>
  );
}

export function Text({ label, v, onChange }: { label: string; v: string; onChange: (v: string) => void }) {
  return (
    <Linha label={label}>
      <input type="text" value={v} onChange={(e) => onChange(e.target.value)} className={CAMPO} />
    </Linha>
  );
}

export function Area({ label, v, rows, onChange }: { label: string; v: string; rows: number; onChange: (v: string) => void }) {
  return (
    <Linha label={label} empilhado>
      <textarea value={v} rows={rows} onChange={(e) => onChange(e.target.value)}
        className={`${CAMPO} resize-none leading-relaxed`} />
    </Linha>
  );
}

export function NumIn({ label, v, step, casas, onChange, disabled, empilhado }: {
  label: string;
  v: number;
  step: number;
  /** Casas decimais gravadas; sem isto, as do `step`. */
  casas?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  /**
   * Rótulo ACIMA do campo, em vez de ao lado.
   *
   * Obrigatório dentro de grade de três colunas: `Linha` reserva 84px fixos
   * para o rótulo, e numa coluna de painel lateral não sobra largura para o
   * campo — ele era empurrado para fora e ficava invisível. Lado a lado
   * continua sendo o padrão, que é melhor onde há largura inteira.
   */
  empilhado?: boolean;
}) {
  return (
    <Linha label={label} empilhado={empilhado}>
      <NumeroScrub v={v} step={step} casas={casas} onChange={onChange} disabled={disabled} />
    </Linha>
  );
}

export function ColorIn({ label, v, onChange }: { label: string; v: string; onChange: (v: string) => void }) {
  return (
    <Linha label={label}>
      <div className="flex items-center gap-1.5">
        <label className="relative h-[22px] w-[22px] shrink-0 cursor-pointer overflow-hidden rounded-[3px] border border-white/15"
          style={{ background: v }}>
          <input type="color" value={v} onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        <input type="text" value={v} onChange={(e) => onChange(e.target.value)}
          className={`${CAMPO} font-mono uppercase`} />
      </div>
    </Linha>
  );
}

export function ImgUp({ label, url, inputRef, onPick, onClear }: {
  label: string; url?: string; inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (f: File) => void; onClear: () => void;
}) {
  return (
    <Linha label={label}>
      <div className="flex items-center gap-1.5">
        <button onClick={() => inputRef.current?.click()}
          className="relative h-[30px] w-[42px] shrink-0 overflow-hidden rounded-[3px] border border-white/[0.08] bg-black/30 hover:border-teal-400/50">
          {url
            ? <img src={url} alt="" className="h-full w-full object-contain" />
            : <Upload className="absolute inset-0 m-auto h-3 w-3 text-white/30" />}
        </button>
        <button onClick={() => inputRef.current?.click()}
          className="min-w-0 flex-1 truncate rounded-[3px] border border-white/[0.08] bg-black/25 px-1.5 py-[3px] text-left text-[11px] text-white/70 hover:border-white/15">
          {url ? "Substituir..." : "Enviar imagem..."}
        </button>
        {url && (
          <button onClick={onClear} title="Remover"
            className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
            <Trash2 className="h-3 w-3" />
          </button>
        )}
        <input ref={inputRef as React.RefObject<HTMLInputElement>} type="file" accept="image/*" className="hidden"
          onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
      </div>
    </Linha>
  );
}

export function Slider({ label, v, min, max, step, suffix, onChange, disabled }: {
  label: string; v: number; min: number; max: number; step: number; suffix: string;
  onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <Linha label={label}>
      <div className={`flex items-center gap-2 ${disabled ? "opacity-40" : ""}`}>
        <input type="range" min={min} max={max} step={step} value={v} disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))} className="ed-range min-w-0 flex-1" />
        <span className="w-14 shrink-0 text-right font-mono text-[10px] text-white/60">
          {v.toFixed(step < 1 ? (step < 0.05 ? 2 : 1) : 0)}{suffix}
        </span>
      </div>
    </Linha>
  );
}

/**
 * Lista de itens de verdade — destaques e lazer.
 *
 * Substitui a caixa de texto de "um por linha", em que apagar um item era
 * reescrever o bloco inteiro e não havia onde pôr foto nem explicação. Cada
 * item se abre no clique: título sempre visível, descrição e foto sob demanda,
 * para a lista de vinte itens continuar navegável.
 */
export function ListaRica({ itens, onItens, onEnviarFoto, vazio, exemplo }: {
  itens: ItemLista[];
  onItens: (n: ItemLista[]) => void;
  onEnviarFoto: (id: string, aplicar: (url: string) => void) => void;
  vazio: string;
  exemplo: string;
}) {
  const [abertoId, setAbertoId] = useState<string | null>(null);

  function patch(id: string, p: Partial<ItemLista>) {
    onItens(itens.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }
  function mover(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= itens.length) return;
    const n = [...itens];
    [n[i], n[j]] = [n[j], n[i]];
    onItens(n);
  }

  return (
    <>
      {itens.length === 0 && <p className="text-[10px] text-white/30">{vazio}</p>}

      {itens.map((it, i) => {
        const aberto = abertoId === it.id;
        return (
          <div key={it.id} className="rounded-[6px] border border-[var(--ed-line)] bg-[var(--ed-soft)]">
            <div className="flex items-center gap-1 p-1">
              {it.imagemUrl && (
                <img src={it.imagemUrl} alt="" className="h-6 w-8 shrink-0 rounded-[3px] object-cover" />
              )}
              <input
                value={it.titulo}
                onChange={(e) => patch(it.id, { titulo: e.target.value })}
                placeholder={exemplo}
                className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-[11px] text-white outline-none placeholder:text-[var(--ed-dim)]"
              />
              {it.panoramaUrl && (
                <Globe2 className="h-3 w-3 shrink-0 text-teal-300" aria-label="Tem foto 360" />
              )}
              <button onClick={() => setAbertoId(aberto ? null : it.id)}
                title={aberto ? "Fechar" : "Foto, foto 360 e descrição"}
                className={`shrink-0 rounded-[3px] p-1 transition-colors ${
                  aberto || it.descricao || it.imagemUrl || it.panoramaUrl ? "text-white" : "text-white/30 hover:text-white/80"
                }`}>
                <ChevronRight className={`h-3 w-3 transition-transform ${aberto ? "rotate-90" : ""}`} />
              </button>
              <div className="flex shrink-0 flex-col">
                <button onClick={() => mover(i, -1)} disabled={i === 0}
                  className="rounded-[3px] p-0.5 text-white/30 hover:text-white disabled:opacity-20">
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button onClick={() => mover(i, 1)} disabled={i === itens.length - 1}
                  className="rounded-[3px] p-0.5 text-white/30 hover:text-white disabled:opacity-20">
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
              {/* Apagar de verdade: o que a caixa de texto não permitia. */}
              <button onClick={() => onItens(itens.filter((x) => x.id !== it.id))}
                title="Remover item"
                className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>

            {aberto && (
              <div className="space-y-1.5 border-t border-[var(--ed-line)] p-1.5">
                <textarea
                  rows={2}
                  value={it.descricao ?? ""}
                  onChange={(e) => patch(it.id, { descricao: e.target.value || undefined })}
                  placeholder="Descrição (opcional) — aparece sob o título na vitrine"
                  className={`${CAMPO} resize-y`}
                />
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onEnviarFoto(it.id, (url) => patch(it.id, { imagemUrl: url }))}
                    className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[3px] border border-[var(--ed-line)] py-1 text-[10px] text-white/70 hover:border-white/25 hover:text-white">
                    <Upload className="h-3 w-3" /> {it.imagemUrl ? "Trocar foto" : "Enviar foto"}
                  </button>
                  {it.imagemUrl && (
                    <button onClick={() => patch(it.id, { imagemUrl: undefined })}
                      title="Remover a foto"
                      className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {/* Foto 360 num botão SEPARADO, e não numa opção do mesmo
                    envio: as duas convivem no item (ver `panoramaUrl`), e um
                    seletor faria parecer que subir uma apaga a outra. */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onEnviarFoto(it.id, (url) => patch(it.id, { panoramaUrl: url }))}
                    title="Foto equirretangular (proporção 2:1) — o visitante entra e olha em volta"
                    className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[3px] border py-1 text-[10px] transition-colors ${
                      it.panoramaUrl
                        ? "border-teal-400/40 bg-teal-500/10 text-teal-300 hover:bg-teal-500/20"
                        : "border-[var(--ed-line)] text-white/70 hover:border-white/25 hover:text-white"
                    }`}>
                    <Globe2 className="h-3 w-3" /> {it.panoramaUrl ? "Trocar foto 360" : "Enviar foto 360"}
                  </button>
                  {it.panoramaUrl && (
                    <button onClick={() => patch(it.id, { panoramaUrl: undefined })}
                      title="Remover a foto 360"
                      className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button
        onClick={() => {
          const novo: ItemLista = { id: genId("item"), titulo: "" };
          onItens([...itens, novo]);
          setAbertoId(null);
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-[3px] border border-[var(--ed-line)] py-1.5 text-[11px] text-white/70 hover:border-white/25 hover:text-white">
        <Plus className="h-3.5 w-3.5" /> Adicionar item
      </button>
    </>
  );
}

/** Escala do modelo: scrub + atalhos de passo, porque a faixa util e enorme. */
export function Num({ label, v, onChange, disabled }: {
  label: string; v: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Linha label={label}>
        <NumeroScrub v={v} step={0.01} onChange={(n) => onChange(Math.max(0.0001, n))} disabled={disabled} />
      </Linha>
      <div className="flex gap-1 pl-[92px]">
        {[0.001, 0.01, 0.1, 1].map((pp) => (
          <button key={pp} onClick={() => onChange(pp)} disabled={disabled}
            className="flex-1 rounded-[3px] border border-white/[0.08] py-0.5 text-[9px] text-white/45 hover:border-white/20 hover:text-white/80 disabled:opacity-30 disabled:hover:border-white/[0.08]">
            {pp}
          </button>
        ))}
      </div>
    </div>
  );
}
/**
 * Grupo colapsavel de largura total. Sangra para fora do padding do painel
 * (-mx-3) para o cabecalho e a divisoria irem de borda a borda: e o que separa
 * "secoes de um inspetor" de "cartoes empilhados numa pagina".
 */
export function Section({ title, children, aberta = true }: {
  title: string; children: React.ReactNode; aberta?: boolean;
}) {
  const [open, setOpen] = useState(aberta);
  return (
    <div className="-mx-3 border-t border-[var(--ed-line)] first:-mt-2 first:border-t-0">
      {/* O eyebrow mono em caixa alta é a assinatura tipográfica do DESIGN.md —
          e aqui ele também é o que faz um cabeçalho fechado se ler como rótulo
          de seção, e não como mais um botão da pilha. */}
      <button onClick={() => setOpen((o) => !o)}
        className={`ed-eyebrow flex w-full items-center gap-1.5 px-3 py-2 transition-colors ${
          open ? "text-white/70 hover:text-white" : "text-[var(--ed-dim)] hover:text-white/80"
        }`}>
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        {title}
      </button>
      {open && <div className="space-y-1.5 px-3 pb-3">{children}</div>}
    </div>
  );
}
