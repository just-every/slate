interface ManagedMailRuntime {
  ready: Promise<URL>;
  getD1Database(binding: string): Promise<D1Database>;
  getWorker(): Promise<{ scheduled(options: { cron: string }): Promise<unknown> }>;
  dispose(): Promise<void>;
}
export function managedMailRuntime(
  bindings: Record<string, string>,
  outboundService: (request: Request) => Promise<Response>,
  options?: { port?: number; tls?: {key:string;cert:string} },
): Promise<ManagedMailRuntime>;
