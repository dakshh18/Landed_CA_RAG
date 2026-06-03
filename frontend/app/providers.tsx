"use client";

// All client-side context providers go here so app/layout.tsx can stay a
// server component (faster initial render). Right now: just TanStack Query.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  // One QueryClient per browser session. `useState` keeps the same instance
  // across re-renders (creating it inline would reset cache every render).
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60_000,    // 5 min — corpus list barely changes
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
