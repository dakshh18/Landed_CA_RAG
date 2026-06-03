"use client";

// Lists every document the assistant has been given access to, with snapshot
// dates. This is the trust surface: users can see exactly what we know.
import { FileText, AlertCircle } from "lucide-react";
import { useDocuments } from "@/hooks/useDocuments";
import { cn } from "@/lib/cn";

export function CorpusList() {
  const { data, isLoading, error } = useDocuments();

  return (
    <div className="flex flex-col gap-3">
      <div className="px-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-landed-muted">
          Knowledge base
        </h2>
        <p className="mt-0.5 text-[11px] text-landed-muted">
          {isLoading
            ? "Loading…"
            : data
            ? `${data.length} document${data.length === 1 ? "" : "s"} indexed`
            : ""}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>API unreachable. Is the backend running on port 8080?</span>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {isLoading &&
          Array.from({ length: 4 }).map((_, i) => (
            <li
              key={i}
              className="h-[58px] animate-pulse rounded-lg border border-landed-border bg-white"
            />
          ))}

        {data?.map((doc) => (
          <li key={doc.id}>
            <a
              href={doc.source_url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "group flex flex-col gap-0.5 rounded-lg border border-landed-border bg-white p-2.5 transition",
                "hover:border-landed-navy-light hover:shadow-card"
              )}
            >
              <div className="flex items-start gap-2">
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-landed-navy-light" />
                <span className="line-clamp-2 text-xs font-medium leading-snug text-landed-navy group-hover:text-landed-navy-light">
                  {doc.title}
                </span>
              </div>
              <div className="ml-5 flex items-center gap-2 text-[10px] text-landed-muted">
                <span>{doc.chunk_count} chunk{doc.chunk_count === 1 ? "" : "s"}</span>
                {doc.fetched_at && (
                  <>
                    <span aria-hidden>·</span>
                    <span>as of {doc.fetched_at}</span>
                  </>
                )}
              </div>
            </a>
          </li>
        ))}

        {data?.length === 0 && (
          <li className="rounded-lg border border-dashed border-landed-border p-3 text-xs text-landed-muted">
            No documents ingested yet. Run <code className="font-mono">npm run ingest</code> on the backend.
          </li>
        )}
      </ul>
    </div>
  );
}
