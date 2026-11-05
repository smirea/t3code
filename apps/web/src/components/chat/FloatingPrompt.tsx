import { ChevronDownIcon } from "lucide-react";
import { useState, type Ref } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import { useStickyPrompt, type StickyPromptStore } from "./stickyPromptStore";
import type { TimelineMinimapItem } from "./timelineMinimapItems";
import {
  PinnedPromptPill,
  resolvePinnedPromptLook,
  UserPromptMarkdown,
} from "./TimelineUserMessageRow";

/**
 * The stuck prompt, pinned at the sticky line over its own timeline row. It takes the row
 * bubble's width and type, so at the hand-off it covers the row's first lines exactly and the
 * rest of the row scrolls on underneath it, like a sticky header.
 */
export function FloatingPrompt({
  ref,
  store,
  prompts,
  rows,
  resyncKey,
  onSelect,
  onResync,
}: {
  readonly ref?: Ref<HTMLDivElement>;
  readonly store: StickyPromptStore;
  readonly prompts: ReadonlyArray<TimelineMinimapItem>;
  readonly rows: ReadonlyArray<MessagesTimelineRow>;
  /** A change remeasures once its render commits, such as a restored thread position landing. */
  readonly resyncKey: string;
  readonly onSelect: (rowIndex: number) => void;
  readonly onResync: () => void;
}) {
  const pinned = useStickyPrompt(store);
  const prompt = pinned ? prompts.find((item) => item.id === pinned.rowId) : undefined;
  const row = prompt ? rows[prompt.rowIndex] : undefined;
  const message = row?.kind === "message" ? row.message : undefined;
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  if (expandedRowId !== null && expandedRowId !== pinned?.rowId) setExpandedRowId(null);
  const expanded = message !== undefined && expandedRowId === pinned?.rowId;
  const look = message ? resolvePinnedPromptLook(message) : undefined;
  const toggleExpanded = () => setExpandedRowId(expanded ? null : (pinned?.rowId ?? null));

  const resync = (element: HTMLSpanElement | null) => {
    if (element) onResync();
  };
  // Measured after layout, so a hand-off never forces a synchronous layout to place the chevron.
  const watchClamp = (element: HTMLDivElement | null) => {
    const card = element?.closest<HTMLElement>("[data-pinned-prompt-card]");
    if (!element || !card) return;
    return observeResize(element, () => {
      const truncated = element.scrollHeight > element.clientHeight + 1 ? "true" : "false";
      if (card.dataset.truncated !== truncated) card.dataset.truncated = truncated;
    });
  };

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-x-0 top-0 z-30"
      data-testid="floating-prompt"
      data-visible={look ? "true" : "false"}
      data-row-id={look ? pinned?.rowId : undefined}
      data-expanded={expanded ? "true" : "false"}
    >
      <span hidden key={resyncKey} ref={resync} />
      <div data-pinned-prompt-layer="" className="chat-composer-lane absolute inset-x-0 top-0">
        {look && message && prompt ? (
          <div className="chat-content-lane flex justify-end">
            <div
              data-pinned-prompt-card=""
              style={pinned?.width ? { width: pinned.width } : undefined}
              className={cn(
                "group/pinned pointer-events-auto relative min-w-0 rounded-2xl bg-message text-message-foreground text-sm leading-relaxed shadow-md shadow-black/10 ring-1 ring-black/5 dark:shadow-black/60 dark:ring-white/10",
                pinned?.width ? "max-w-full" : "max-w-[80%]",
              )}
            >
              {look.kind !== "bubble" ? (
                <>
                  <PinnedPromptPill look={look} expanded={expanded} onToggle={toggleExpanded} />
                  {expanded ? (
                    <div className="max-h-[50vh] overflow-y-auto overscroll-contain px-3 pb-3">
                      <UserPromptMarkdown message={message} />
                    </div>
                  ) : null}
                </>
              ) : expanded ? (
                <div
                  dir={look.dir}
                  className="max-h-[50vh] overflow-y-auto overscroll-contain p-3 pe-9"
                >
                  <UserPromptMarkdown message={message} />
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={`Jump to prompt: ${look.label}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    // The copy changes once the timeline lands on its prompt; focus must not stay.
                    event.currentTarget.blur();
                    onSelect(prompt.rowIndex);
                  }}
                  className="block w-full cursor-pointer rounded-2xl p-3 text-start transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring dark:hover:brightness-110"
                >
                  <div
                    key={prompt.id}
                    ref={watchClamp}
                    dir={look.dir}
                    className="line-clamp-2 break-words"
                  >
                    {look.paragraphs.map((paragraph) => (
                      // Same paragraph spacing as the timeline's markdown, so lines match the row.
                      <p key={paragraph.key} className="whitespace-pre-line [&+&]:mt-[0.65rem]">
                        {paragraph.text}
                      </p>
                    ))}
                  </div>
                </button>
              )}
              {look.kind === "bubble" ? (
                <div
                  className={cn(
                    "absolute end-0 bottom-0 items-end rounded-ee-2xl bg-linear-to-l from-message from-60% to-transparent ps-8 pe-1.5 pt-2 pb-1.5",
                    expanded ? "flex" : "hidden group-data-[truncated=true]/pinned:flex",
                  )}
                >
                  <button
                    type="button"
                    aria-label={expanded ? "Collapse prompt" : "Show full prompt"}
                    aria-expanded={expanded}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={toggleExpanded}
                    className="flex size-6 cursor-pointer items-center justify-center rounded-full text-message-foreground/70 hover:bg-foreground/10 hover:text-message-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <ChevronDownIcon className={cn("size-4", expanded && "rotate-180")} />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
