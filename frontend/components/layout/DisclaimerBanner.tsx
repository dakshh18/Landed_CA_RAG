// Persistent, non-dismissable banner. Reinforces responsible use and tells
// users what this thing is (and isn't) before they ask anything.
import { Info } from "lucide-react";

export function DisclaimerBanner() {
  return (
    <div className="flex items-center gap-2 bg-landed-banner px-4 py-2 text-xs text-white">
      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Informational only — not official immigration advice. Verify on{" "}
        <a
          href="https://www.canada.ca/en/immigration-refugees-citizenship.html"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-white/90"
        >
          canada.ca
        </a>
        .
      </span>
    </div>
  );
}
