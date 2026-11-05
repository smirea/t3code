import { ChevronDownIcon, ImageIcon } from "lucide-react";
import { useState, type Ref } from "react";

import { cn } from "~/lib/utils";
import type { ChatMessage } from "../../types";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import {
  LEADING_PROMPT_ROW_ID,
  useStickyPrompt,
  type StickyPromptStore,
} from "./stickyPromptStore";
import type { TimelineMinimapItem } from "./timelineMinimapItems";
import {
  PinnedPromptPill,
  resolvePinnedPromptLook,
  UserPromptMarkdown,
} from "./TimelineUserMessageRow";

/**
 * Where to cut a block to its first two rendered lines, or null when it has two or fewer. A
 * height cut instead of `line-clamp` leaves no ellipsis after a paragraph that happens to end on
 * line two; the chevron's fade already says there is more.
 */
function twoLineCut(element: HTMLElement): number | null {
  const lines: Array<{ top: number; bottom: number }> = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node && lines.length < 3; node = walker.nextNode()) {
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width === 0) continue;
      const line = lines.find((candidate) => Math.abs(candidate.top - rect.top) < 1);
      if (line) line.bottom = Math.max(line.bottom, rect.bottom);
      else lines.push({ top: rect.top, bottom: rect.bottom });
    }
  }
  if (lines.length < 3) return null;
  lines.sort((a, b) => a.top - b.top);
  return (lines[1]!.bottom + lines[2]!.top) / 2 - element.getBoundingClientRect().top;
}

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
  leadingPrompt,
  resyncKey,
  onSelect,
  onSelectLeading,
  onResync,
  onWheel,
}: {
  readonly ref?: Ref<HTMLDivElement>;
  readonly store: StickyPromptStore;
  readonly prompts: ReadonlyArray<TimelineMinimapItem>;
  readonly rows: ReadonlyArray<MessagesTimelineRow>;
  /** The prompt of the turn the loaded history opens inside, which has no row yet. */
  readonly leadingPrompt: ChatMessage | null;
  /** A change remeasures once its render commits, such as a restored thread position landing. */
  readonly resyncKey: string;
  readonly onSelect: (rowIndex: number) => void;
  readonly onSelectLeading: (message: ChatMessage) => void;
  readonly onResync: () => void;
  /** The collapsed copy sits over the timeline, so wheeling on it scrolls the timeline. */
  readonly onWheel: (event: WheelEvent) => void;
}) {
  const pinned = useStickyPrompt(store);
  const prompt = pinned ? prompts.find((item) => item.id === pinned.rowId) : undefined;
  const row = prompt ? rows[prompt.rowIndex] : undefined;
  const message =
    pinned?.rowId === LEADING_PROMPT_ROW_ID
      ? (leadingPrompt ?? undefined)
      : row?.kind === "message"
        ? row.message
        : undefined;
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  if (expandedRowId !== null && expandedRowId !== pinned?.rowId) setExpandedRowId(null);
  const expanded = message !== undefined && expandedRowId === pinned?.rowId;
  const look = message ? resolvePinnedPromptLook(message) : undefined;
  const toggleExpanded = () => setExpandedRowId(expanded ? null : (pinned?.rowId ?? null));

  const resync = (element: HTMLSpanElement | null) => {
    if (element) onResync();
  };
  const forwardWheel = (card: HTMLDivElement | null) => {
    if (!card || expanded) return;
    card.addEventListener("wheel", onWheel, { passive: false });
    return () => card.removeEventListener("wheel", onWheel);
  };
  // Measured after layout, so a hand-off never forces a layout to place the chevron.
  const clampToTwoLines = (element: HTMLDivElement | null) => {
    const card = element?.closest<HTMLElement>("[data-pinned-prompt-card]");
    if (!element || !card) return;
    // oxlint-disable-next-line t3code/no-raw-resize-observer -- writes DOM only, never React state; observeResize's flush would pull unrelated pending renders into every hand-off frame
    const observer = new ResizeObserver(() => {
      const cut = twoLineCut(element);
      const maxHeight = cut === null ? "" : `${cut}px`;
      if (element.style.maxHeight !== maxHeight) element.style.maxHeight = maxHeight;
      const truncated = cut === null ? "false" : "true";
      if (card.dataset.truncated !== truncated) card.dataset.truncated = truncated;
    });
    observer.observe(element);
    return () => observer.disconnect();
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
        {look && message && pinned ? (
          <div className="chat-content-lane flex justify-end">
            <div
              ref={forwardWheel}
              data-pinned-prompt-card=""
              dir={look.kind === "bubble" ? look.dir : undefined}
              style={pinned?.width ? { width: pinned.width } : undefined}
              className={cn(
                "group/pinned pointer-events-auto relative min-w-0 rounded-2xl bg-message text-message-foreground text-sm leading-relaxed shadow-md shadow-black/10 ring-1 ring-black/5 dark:shadow-black/60 dark:ring-white/15",
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
                <div className="max-h-[50vh] overflow-y-auto overscroll-contain p-3 pe-9">
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
                    if (prompt) onSelect(prompt.rowIndex);
                    else onSelectLeading(message);
                  }}
                  // Cut copies end on the boundary of the row's third line, so it shows whole below.
                  className="block w-full cursor-pointer rounded-2xl p-3 text-start transition-[filter] group-data-[truncated=true]/pinned:pb-0 hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring dark:hover:brightness-110"
                >
                  {look.attachmentsOnly ? (
                    <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                      <ImageIcon className="size-4 shrink-0" />
                      <span className="truncate">{look.label}</span>
                    </span>
                  ) : (
                    <div
                      key={pinned.rowId}
                      ref={clampToTwoLines}
                      className="overflow-hidden break-words"
                    >
                      {look.paragraphs.map((paragraph) => (
                        // Same paragraph spacing as the timeline's markdown, so lines match the row.
                        <p key={paragraph.key} className="whitespace-pre-line [&+&]:mt-[0.65rem]">
                          {paragraph.text}
                        </p>
                      ))}
                    </div>
                  )}
                </button>
              )}
              {look.kind === "bubble" && !look.attachmentsOnly ? (
                <div
                  className={cn(
                    "absolute end-0 bottom-0 rounded-ee-2xl bg-linear-to-l from-message from-60% to-transparent ps-8 pe-1.5 rtl:bg-linear-to-r",
                    // Collapsed, the fade covers only the end of the last line shown.
                    expanded
                      ? "flex items-end pt-2 pb-1.5"
                      : "hidden h-[1lh] items-center group-data-[truncated=true]/pinned:flex",
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

/**
 * The prompt of the turn the loaded history opens inside, shown where it belongs: above the
 * loaded rows. Its text has loaded, its row has not; clicking it loads history through it.
 */
export function LeadingPromptPreview({
  message,
  onSelect,
}: {
  readonly message: ChatMessage;
  readonly onSelect: (message: ChatMessage) => void;
}) {
  const look = resolvePinnedPromptLook(message);
  if (look.kind !== "bubble") return null;
  const clampToTwoLines = (element: HTMLDivElement | null) => {
    if (!element) return;
    // oxlint-disable-next-line t3code/no-raw-resize-observer -- writes DOM only, never React state; observeResize's flush would pull unrelated pending renders into the frame
    const observer = new ResizeObserver(() => {
      const cut = twoLineCut(element);
      const maxHeight = cut === null ? "" : `${cut}px`;
      if (element.style.maxHeight !== maxHeight) element.style.maxHeight = maxHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  };
  return (
    <div className="messages-timeline-row-frame pb-4">
      <div className="chat-content-lane flex justify-end">
        <button
          type="button"
          data-leading-prompt-anchor=""
          dir={look.dir}
          aria-label={`Load prompt: ${look.label}`}
          onClick={() => onSelect(message)}
          className="min-w-0 max-w-[80%] cursor-pointer rounded-2xl bg-message p-3 text-start text-message-foreground text-sm leading-relaxed transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring dark:hover:brightness-110"
        >
          <div key={message.id} ref={clampToTwoLines} className="overflow-hidden break-words">
            {look.paragraphs.map((paragraph) => (
              <p key={paragraph.key} className="whitespace-pre-line [&+&]:mt-[0.65rem]">
                {paragraph.text}
              </p>
            ))}
          </div>
        </button>
      </div>
    </div>
  );
}
