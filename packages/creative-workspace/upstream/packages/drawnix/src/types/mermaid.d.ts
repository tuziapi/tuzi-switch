declare module 'mermaid' {
  interface MermaidRenderResult {
    svg: string;
  }

  interface MermaidApi {
    initialize(config: Record<string, unknown>): void;
    render(id: string, text: string): Promise<MermaidRenderResult>;
  }

  const mermaid: MermaidApi;
  export default mermaid;
}
