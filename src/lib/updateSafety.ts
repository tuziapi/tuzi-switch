/** Guards are registered by workspaces that may hold unsaved work. */
type Guard = () => Promise<void>;
const guards = new Set<Guard>();
export function registerUpdateGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}
export async function prepareForUpdate(): Promise<void> {
  for (const guard of [...guards]) await guard();
}
