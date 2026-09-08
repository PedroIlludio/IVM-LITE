/**
 * O pacote `draco3dgltf` não traz tipagem. Só usamos a fábrica do codificador,
 * e ela é declarada aqui em vez de puxarmos um `@types` de terceiro para uma
 * função só.
 *
 * `locateFile` é o gancho que aponta para o `.wasm`: sem ele a biblioteca monta
 * um caminho relativo que, num SPA, cai no rewrite e volta como `index.html` —
 * o erro é `WebAssembly.instantiate(): expected magic word`.
 */
declare module "draco3dgltf" {
  interface OpcoesModulo {
    locateFile?: (arquivo: string) => string;
  }
  const draco3dgltf: {
    createEncoderModule(opcoes?: OpcoesModulo): Promise<unknown>;
    createDecoderModule(opcoes?: OpcoesModulo): Promise<unknown>;
  };
  export default draco3dgltf;
}
