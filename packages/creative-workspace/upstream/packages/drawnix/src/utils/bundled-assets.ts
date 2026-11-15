import tuziLogoUrl from '../../../../apps/web/public/logo-tuzi.png';

/** Resolve legacy built-in asset paths at display time without rewriting saved profiles. */
export function resolveBuiltinAssetUrl(url: string): string {
  return url === '/logo-tuzi.png' || url === './logo-tuzi.png' ? tuziLogoUrl : url;
}
