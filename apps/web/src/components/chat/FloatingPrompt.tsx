import { ImageIcon } from "lucide-react";
import { useState, type CSSProperties, type Ref } from "react";

import { cn } from "~/lib/utils";
import type { ChatMessage } from "../../types";
import { Button } from "../ui/button";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import {
  LEADING_PROMPT_ROW_ID,
  useStickyPrompt,
  type StickyPromptStore,
} from "./stickyPromptStore";
import type { TimelineMinimapItem } from "./timelineMinimapItems";
import {
  BUBBLE_CHIP_CLASS_NAME,
  PinnedPromptPill,
  resolvePinnedPromptLook,
  UserPromptMarkdown,
  type PinnedPromptLook,
} from "./TimelineUserMessageRow";

/**
 * Where to cut a block to its first two rendered lines, or null when it has two or fewer. Cutting
 * between lines two and three keeps the last line shown whole whatever the markdown's spacing.
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
 * Sizes a card per scroll frame without reading layout. It covers `covered`, what is left of its
 * row below the line, so the row never shows twice; `cap` is what a collapsed row shows. Shrinking,
 * its bottom edge first rises through the footer space, then clips the content to two lines.
 */
export function sizePromptCard(
  card: HTMLElement,
  { covered, cap }: { readonly covered: number; readonly cap: number },
): number | undefined {
  const body = card.querySelector<HTMLElement>("[data-pinned-prompt-body]");
  if (card.dataset.content === undefined || !body) return undefined;
  if (card.dataset.expanded === "true") {
    if (card.style.height !== "") card.style.height = "";
    if (body.style.height !== "") body.style.height = "";
    if (card.dataset.floating !== "true") card.dataset.floating = "true";
    return undefined;
  }
  const content = Number(card.dataset.content);
  const padding = Number(card.dataset.padding);
  const height = Math.max(Number(card.dataset.target), covered);
  const shown = Math.min(cap, content, height - padding);
  const cardHeight = `${height}px`;
  if (card.style.height !== cardHeight) card.style.height = cardHeight;
  const bodyHeight = `${shown}px`;
  if (body.style.height !== bodyHeight) body.style.height = bodyHeight;
  const truncated = content > shown + 0.5 ? "true" : "false";
  if (card.dataset.truncated !== truncated) card.dataset.truncated = truncated;
  const floating = height > covered + 0.5 ? "true" : "false";
  if (card.dataset.floating !== floating) card.dataset.floating = floating;
  return height;
}

/**
 * A prompt drawn like its timeline bubble: the row's markdown and fade, with "Show full message"
 * tucked into the bottom corner. Its size is set by `sizePromptCard`; measuring writes the
 * prompt's height and its two-line height onto the card for it.
 */
function PromptCard({
  message,
  look,
  expanded,
  leading,
  style,
  className,
  onToggleExpanded,
  onJump,
  onMeasured,
  onWheel,
}: {
  readonly message: ChatMessage;
  readonly look: Extract<PinnedPromptLook, { kind: "bubble" }>;
  readonly expanded: boolean;
  readonly leading?: boolean;
  readonly style?: CSSProperties | undefined;
  readonly className?: string;
  readonly onToggleExpanded: () => void;
  readonly onJump: () => void;
  readonly onMeasured: (card: HTMLElement) => void;
  readonly onWheel?: (event: WheelEvent) => void;
}) {
  const forwardWheel = (card: HTMLDivElement | null) => {
    if (!card || !onWheel || expanded) return;
    card.addEventListener("wheel", onWheel, { passive: false });
    return () => card.removeEventListener("wheel", onWheel);
  };
  const measure = (content: HTMLDivElement | null) => {
    const card = content?.closest<HTMLElement>("[data-pinned-prompt-card]");
    if (!content || !card) return;
    // oxlint-disable-next-line t3code/no-raw-resize-observer -- writes DOM only, never React state; observeResize's flush would pull unrelated pending renders into every hand-off frame
    const observer = new ResizeObserver(() => {
      const cardStyle = getComputedStyle(card);
      const padding = parseFloat(cardStyle.paddingTop) + parseFloat(cardStyle.paddingBottom);
      const height = content.offsetHeight;
      const cut = twoLineCut(content);
      card.dataset.content = String(height);
      card.dataset.padding = String(padding);
      card.dataset.target = String(padding + (cut ?? height));
      onMeasured(card);
    });
    observer.observe(content);
    return () => observer.disconnect();
  };
  const toggle = (
    <Button
      type="button"
      size="xs"
      variant="ghost-muted"
      aria-expanded={expanded}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onToggleExpanded}
      className="-ml-1"
    >
      {expanded ? "Show less" : "Show full message"}
    </Button>
  );
  return (
    <div
      ref={forwardWheel}
      data-pinned-prompt-card=""
      data-leading-prompt-anchor={leading ? "" : undefined}
      data-expanded={expanded ? "true" : "false"}
      data-truncated="false"
      dir={look.dir}
      style={style}
      className={cn(
        "group/pinned pointer-events-auto relative min-w-0 overflow-hidden rounded-2xl bg-message p-3 text-message-foreground",
        "data-[expanded=true]:flex data-[expanded=true]:max-h-[50vh] data-[expanded=true]:flex-col data-[floating=true]:shadow-md data-[floating=true]:shadow-black/10 data-[floating=true]:ring-1 data-[floating=true]:ring-black/5 dark:data-[floating=true]:shadow-black/60 dark:data-[floating=true]:ring-white/15",
        BUBBLE_CHIP_CLASS_NAME,
        className,
      )}
    >
      <div
        data-pinned-prompt-body=""
        className={
          expanded
            ? "min-h-0 flex-1 overflow-y-auto overscroll-contain"
            : // The row's collapsed fade, shortened on a two-line copy so its last line stays readable.
              "overflow-hidden group-data-[truncated=true]/pinned:[mask-image:linear-gradient(to_bottom,#000_calc(100%_-_min(1.75rem,25%)),transparent)]"
        }
      >
        {/* Remounted on a toggle so the measure runs even when the height does not change. */}
        <div key={`${message.id}:${expanded}`} ref={measure}>
          <UserPromptMarkdown message={message} preview={!expanded} />
        </div>
      </div>
      {expanded ? (
        <div className="mt-1.5 flex items-center justify-end">{toggle}</div>
      ) : (
        <>
          <button
            type="button"
            aria-label={`${leading ? "Load prompt" : "Jump to prompt"}: ${look.label}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              // The copy changes once the timeline lands on its prompt; focus must not stay.
              event.currentTarget.blur();
              onJump();
            }}
            className="absolute inset-0 cursor-pointer rounded-2xl hover:bg-foreground/[0.03] focus-visible:outline-2 focus-visible:outline-ring"
          />
          {/* Where the row's footer sits; once the card shrinks past it, it rides the bottom edge
              over the end of the last line shown. */}
          <div className="absolute end-3 bottom-3 hidden group-data-[truncated=true]/pinned:flex">
            <span className="w-8 bg-linear-to-l from-message to-transparent rtl:bg-linear-to-r" />
            <div className="bg-message">{toggle}</div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The stuck prompt, pinned at the sticky line over its own timeline row. It takes the row
 * bubble's width and look and covers what is left of the row below the line, shrinking with it
 * to two lines, so the prompt shows once and the rest of the timeline scrolls on underneath.
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
  const jump = (target: ChatMessage) => {
    if (prompt) onSelect(prompt.rowIndex);
    else onSelectLeading(target);
  };

  const resync = (element: HTMLSpanElement | null) => {
    if (element) onResync();
  };
  const forwardWheel = (card: HTMLDivElement | null) => {
    if (!card || expanded) return;
    card.addEventListener("wheel", onWheel, { passive: false });
    return () => card.removeEventListener("wheel", onWheel);
  };
  const widthStyle = pinned?.width ? { width: pinned.width } : undefined;
  const widthClassName = pinned?.width ? "max-w-full" : "max-w-[80%]";

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
            {look.kind === "bubble" && !look.attachmentsOnly ? (
              <PromptCard
                message={message}
                look={look}
                expanded={expanded}
                style={widthStyle}
                className={widthClassName}
                onToggleExpanded={toggleExpanded}
                onJump={() => jump(message)}
                onMeasured={onResync}
                onWheel={onWheel}
              />
            ) : (
              <div
                ref={forwardWheel}
                data-pinned-prompt-card=""
                style={widthStyle}
                className={cn(
                  "pointer-events-auto relative min-w-0 rounded-2xl bg-message text-message-foreground text-sm leading-relaxed shadow-md shadow-black/10 ring-1 ring-black/5 dark:shadow-black/60 dark:ring-white/15",
                  widthClassName,
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
                ) : (
                  <button
                    type="button"
                    aria-label={`Jump to prompt: ${look.label}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.currentTarget.blur();
                      jump(message);
                    }}
                    className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-2xl p-3 text-start text-muted-foreground hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring dark:hover:brightness-110"
                  >
                    <ImageIcon className="size-4 shrink-0" />
                    <span className="truncate">{look.label}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The prompt of the turn the loaded history opens inside, shown where it belongs: above the
 * loaded rows, at the two lines a pinned prompt shrinks to. Its text has loaded, its row has not;
 * clicking it loads history through it.
 */
export function LeadingPromptPreview({
  message,
  onSelect,
}: {
  readonly message: ChatMessage;
  readonly onSelect: (message: ChatMessage) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const look = resolvePinnedPromptLook(message);
  if (look.kind !== "bubble" || look.attachmentsOnly) return null;
  const clampToTarget = (card: HTMLElement) => {
    sizePromptCard(card, { covered: 0, cap: Infinity });
    // It sits in the timeline, not over it.
    card.dataset.floating = "false";
  };
  return (
    <div className="messages-timeline-row-frame pb-4">
      <div className="chat-content-lane flex justify-end">
        <PromptCard
          message={message}
          look={look}
          expanded={expanded}
          leading
          className="max-w-[80%]"
          onToggleExpanded={() => setExpanded((value) => !value)}
          onJump={() => onSelect(message)}
          onMeasured={clampToTarget}
        />
      </div>
    </div>
  );
}
