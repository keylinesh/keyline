/**
 * One-click copy for terminal commands. Shows a brief "copied" confirmation.
 */

import { useEffect, useRef, useState } from "react";

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      className={copied ? "copy-btn copied" : "copy-btn"}
      aria-label={label ?? `copy ${text}`}
      title="copy"
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
      {copied ? "copied ✓" : "copy"}
    </button>
  );
}
