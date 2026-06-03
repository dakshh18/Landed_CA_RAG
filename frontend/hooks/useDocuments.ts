"use client";

// `GET /api/documents` cached with TanStack Query. Powers the sidebar list.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DocumentsResponse } from "@/lib/types";

export function useDocuments() {
  return useQuery({
    queryKey: ["documents"],
    queryFn: () => api<DocumentsResponse>("/api/documents"),
    select: (data) => data.documents,
  });
}
