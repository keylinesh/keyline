/**
 * One-click copy for terminal commands and ids: an icon button with a hover
 * tooltip that flips to "Copied!" for a moment after copying.
 */

import { useEffect, useRef, useState } from "react";

function ClipboardIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      className={copied ? "copy-btn copied" : "copy-btn"}
      data-tip={copied ? "Copied!" : "Copy"}
      aria-label={label ?? `copy ${text}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard unavailable (permissions / non-secure context): do nothing.
        }
      }}
    >
      {copied ? <CheckIcon /> : <ClipboardIcon />}
    </button>
  );
}
