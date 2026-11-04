import { ChevronDownIcon } from "lucide-react";
import { useState, type Ref } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { markdownPreviewText } from "./timelineMinimapItems";

export function FloatingPrompt({
  ref,
  belowTopFade,
  text,
  visible,
  onSelect,
}: {
  readonly ref?: Ref<HTMLDivElement>;
  readonly belowTopFade: boolean;
  readonly text: string | null;
  readonly visible: boolean;
  readonly onSelect: () => void;
}) {
  const fullText = text?.trim() || "User message";
  const compactText = markdownPreviewText(fullText).replace(/\s+/g, " ").trim() || fullText;
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const [wasVisible, setWasVisible] = useState(visible);
  // Collapse on re-show rather than on hide, so the exit animation keeps its content.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setExpandedFor(null);
  }
  const expanded = expandedFor === fullText;
  const [truncated, setTruncated] = useState(false);
  const measureClamp = (element: HTMLSpanElement | null) => {
    if (!element) return;
    const measure = () => setTruncated(element.scrollHeight > element.clientHeight + 1);
    measure();
    return observeResize(element, measure);
  };

  return (
    // The zone starts at the sticky line and clips only its top edge, so a pushed-out prompt
    // slides under the line instead of over the top fade and nav.
    <div
      ref={ref}
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-30 [clip-path:inset(0_-100vw_-100vh_-100vw)]",
        belowTopFade ? "top-(--workspace-titlebar-scroll-fade-height)" : "top-0",
      )}
      data-testid="floating-prompt"
      data-visible={visible ? "true" : "false"}
      inert={!visible}
    >
      <div className="chat-composer-lane absolute inset-x-0 top-1">
        <div className="chat-content-lane flex justify-center">
          <div
            className={cn(
              "relative max-w-full rounded-2xl border border-border/60 bg-message text-message-foreground text-sm leading-5 shadow-lg shadow-black/15 transition-[opacity,translate,scale] duration-150 ease-out motion-reduce:transition-none",
              visible
                ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                : "-translate-y-2 scale-[0.98] opacity-0",
            )}
          >
            {expanded ? (
              <div className="max-h-[50vh] overflow-y-auto py-2 ps-3 pe-9 whitespace-pre-wrap break-words">
                {fullText}
              </div>
            ) : (
              <button
                type="button"
                aria-label={`Jump to prompt: ${compactText}`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={onSelect}
                className={cn(
                  "block w-full cursor-pointer rounded-2xl py-2 ps-3 text-left transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring dark:hover:brightness-110",
                  truncated ? "pe-9" : "pe-3",
                )}
              >
                <span key={compactText} ref={measureClamp} className="line-clamp-2 break-words">
                  {compactText}
                </span>
              </button>
            )}
            {truncated || expanded ? (
              <button
                type="button"
                aria-label={expanded ? "Collapse prompt" : "Show full prompt"}
                aria-expanded={expanded}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => setExpandedFor(expanded ? null : fullText)}
                className="absolute end-1.5 bottom-1.5 flex size-6 cursor-pointer items-center justify-center rounded-full text-message-foreground/70 hover:bg-foreground/10 hover:text-message-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <ChevronDownIcon
                  className={cn(
                    "size-4 transition-transform duration-200 motion-reduce:transition-none",
                    expanded && "rotate-180",
                  )}
                />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
