import { useEffect, useState } from 'react';
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const change = () => setMatches(list.matches);
    change();
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, [query]);
  return matches;
}
// Matches the CSS breakpoint where the sidebar becomes a drawer.
export const narrowQuery = '(max-width: 760px)';
// A failed fetch, a timeout, or a non-JSON reply (such as a proxy error page) means the
// server could not be reached: a connection state rather than a user error.
export const unreachable = (error: unknown) =>
  error instanceof Error &&
  (error.name === 'TimeoutError' ||
    error.name === 'SyntaxError' ||
    (error.name === 'TypeError' && /fetch|network|load failed/i.test(error.message)));
export const explain = (error: unknown) =>
  unreachable(error)
    ? 'Can’t reach the server. Check your connection and try again.'
    : error instanceof Error
      ? error.message
      : 'Something went wrong';
const spanFormat = new Intl.DateTimeFormat([], {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
export function formatSpan(from: string | null, to: string | null) {
  if (!from || !to) return '';
  return spanFormat.formatRange(new Date(from), new Date(to));
}
