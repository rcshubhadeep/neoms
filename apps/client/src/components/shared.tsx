export const explain = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong';
export function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      n<span>·</span>
    </span>
  );
}
