import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 3600_000,
      retry: (count, err) => {
        // Never retry client errors; retry network and server errors twice.
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
        return count < 2;
      },
      refetchOnWindowFocus: true,
    },
    mutations: { retry: 0 },
  },
});
