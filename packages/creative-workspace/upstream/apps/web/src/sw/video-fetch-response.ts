export type VideoCacheFetchResult =
  | { kind: 'cacheable'; response: Response }
  | { kind: 'direct'; corsFailed: boolean }
  | { kind: 'http-error'; response: Response };

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export async function fetchVideoForCache(
  url: URL,
  fetchImpl: FetchLike = fetch
): Promise<VideoCacheFetchResult> {
  try {
    const response = await fetchImpl(new URL(url), {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'default',
    });

    if (!response.ok) {
      return { kind: 'http-error', response };
    }

    if (response.status === 206) {
      return { kind: 'direct', corsFailed: false };
    }

    return { kind: 'cacheable', response };
  } catch {
    return { kind: 'direct', corsFailed: true };
  }
}

export function fetchOriginalVideoRequest(
  request: Request,
  fetchImpl: FetchLike = fetch
): Promise<Response> {
  return fetchImpl(request);
}
