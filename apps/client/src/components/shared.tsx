export const explain = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong';
