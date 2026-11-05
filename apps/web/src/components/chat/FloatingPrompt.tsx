import { ChevronDownIcon } from "lucide-react";
import { useState, type Ref } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import { useStuckPromptRowId, type StickyPromptStore } from "./stickyPromptStore";
import { markdownPreviewText, type TimelineMinimapItem } from "./timelineMinimapItems";
import { resolveUserPromptText, UserPromptMarkdown } from "./TimelineUserMessageRow";

/**
 * The copy of the stuck prompt pinned under the nav. It matches the timeline's user bubble so the
 * hand-off from the row is in place; the row hides itself while this copy shows.
 */
export function FloatingPrompt({
  ref,
  store,
  prompts,
  rows,
  belowTopFade,
  onSelect,
  onLayoutChange,
}: {
  readonly ref?: Ref<HTMLDivElement>;
  readonly store: StickyPromptStore;
  readonly prompts: ReadonlyArray<TimelineMinimapItem>;
  readonly rows: ReadonlyArray<MessagesTimelineRow>;
  readonly belowTopFade: boolean;
  readonly onSelect: (rowIndex: number) => void;
  /** Called after the pinned copy's content swaps, so the push-out offset can be remeasured. */
  readonly onLayoutChange: () => void;
}) {
  const stuckRowId = useStuckPromptRowId(store);
  const prompt = stuckRowId === null ? undefined : prompts.find((item) => item.id === stuckRowId);
  const row = prompt ? rows[prompt.rowIndex] : undefined;
  const message = row?.kind === "message" ? row.message : undefined;
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const expanded = message !== undefined && expandedRowId === stuckRowId;
  const [truncated, setTruncated] = useState(false);

  const measureClamp = (element: HTMLDivElement | null) => {
    if (!element) return;
    const measure = () => setTruncated(element.scrollHeight > element.clientHeight + 1);
    measure();
    onLayoutChange();
    return observeResize(element, measure);
  };
  const attachExpanded = (element: HTMLDivElement | null) => {
    if (element) onLayoutChange();
  };
  const label = message
    ? markdownPreviewText(resolveUserPromptText(message)).replace(/\s+/g, " ").trim() ||
      "User message"
    : "";

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
      data-visible={message ? "true" : "false"}
      data-row-id={message ? stuckRowId : undefined}
      data-expanded={expanded ? "true" : "false"}
    >
      <div className="chat-composer-lane absolute inset-x-0 top-0">
        {message && prompt ? (
          <div className="chat-content-lane flex justify-end">
            <div className="pointer-events-auto relative min-w-0 max-w-[80%] rounded-2xl bg-message text-message-foreground text-sm leading-relaxed shadow-md shadow-black/10">
              {expanded ? (
                <div
                  ref={attachExpanded}
                  className="max-h-[50vh] overflow-y-auto overscroll-contain p-3 pe-9"
                >
                  <UserPromptMarkdown message={message} />
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={`Jump to prompt: ${label}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(prompt.rowIndex)}
                  className={cn(
                    "block w-full cursor-pointer rounded-2xl p-3 text-left transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring dark:hover:brightness-110",
                    truncated && "pe-9",
                  )}
                >
                  <div key={prompt.id} ref={measureClamp} className="line-clamp-2 break-words">
                    {label}
                  </div>
                </button>
              )}
              {truncated || expanded ? (
                <button
                  type="button"
                  aria-label={expanded ? "Collapse prompt" : "Show full prompt"}
                  aria-expanded={expanded}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => setExpandedRowId(expanded ? null : stuckRowId)}
                  className="absolute end-1.5 bottom-1.5 flex size-6 cursor-pointer items-center justify-center rounded-full text-message-foreground/70 hover:bg-foreground/10 hover:text-message-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ChevronDownIcon className={cn("size-4", expanded && "rotate-180")} />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
