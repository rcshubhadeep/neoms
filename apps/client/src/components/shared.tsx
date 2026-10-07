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
