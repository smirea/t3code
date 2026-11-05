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
 * A prompt drawn like its timeline bubble: the row's markdown, fade and "Show full message"
 * footer. Its height is set from outside; the body clips to whatever the footer leaves of it.
 * Measuring writes `natural` (the whole prompt) and `target` (two lines and the footer) onto the
 * card, so a scroll frame sizes it without reading layout.
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
    const footer = card?.querySelector<HTMLElement>("[data-pinned-prompt-footer]");
    if (!content || !card || !footer) return;
    // oxlint-disable-next-line t3code/no-raw-resize-observer -- writes DOM only, never React state; observeResize's flush would pull unrelated pending renders into every hand-off frame
    const observer = new ResizeObserver(() => {
      const cardStyle = getComputedStyle(card);
      const padding = parseFloat(cardStyle.paddingTop) + parseFloat(cardStyle.paddingBottom);
      const natural = content.offsetHeight + padding;
      const cut = twoLineCut(content);
      const footerHeight = footer.offsetHeight + parseFloat(getComputedStyle(footer).marginTop);
      const target = cut === null ? natural : Math.min(natural, padding + cut + footerHeight);
      card.dataset.natural = String(natural);
      card.dataset.target = String(target);
      onMeasured(card);
    });
    observer.observe(content);
    return () => observer.disconnect();
  };
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
        "group/pinned pointer-events-auto relative flex min-w-0 flex-col overflow-hidden rounded-2xl bg-message p-3 text-message-foreground",
        "data-[expanded=true]:max-h-[50vh] data-[floating=true]:shadow-md data-[floating=true]:shadow-black/10 data-[floating=true]:ring-1 data-[floating=true]:ring-black/5 dark:data-[floating=true]:shadow-black/60 dark:data-[floating=true]:ring-white/15",
        BUBBLE_CHIP_CLASS_NAME,
        className,
      )}
    >
      <div
        className={cn(
          "min-h-0 flex-1",
          expanded
            ? "overflow-y-auto overscroll-contain"
            : // The row's collapsed fade, shortened on a two-line copy so its last line stays readable.
              "overflow-hidden group-data-[truncated=true]/pinned:[mask-image:linear-gradient(to_bottom,#000_calc(100%_-_min(1.75rem,25%)),transparent)]",
        )}
      >
        {/* Remounted on a toggle so the measure runs even when the height does not change. */}
        <div key={`${message.id}:${expanded}`} ref={measure}>
          <UserPromptMarkdown message={message} preview={!expanded} />
        </div>
      </div>
      {expanded ? null : (
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
      )}
      <div
        data-pinned-prompt-footer=""
        className={cn(
          "relative mt-1.5 flex items-center justify-end gap-2",
          !expanded &&
            "group-data-[truncated=false]/pinned:invisible group-data-[truncated=false]/pinned:absolute",
        )}
      >
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
      </div>
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
    const natural = Number(card.dataset.natural);
    const target = Number(card.dataset.target);
    const open = card.dataset.expanded === "true";
    const height = open ? "" : `${target}px`;
    if (card.style.height !== height) card.style.height = height;
    const truncated = !open && target < natural - 0.5 ? "true" : "false";
    if (card.dataset.truncated !== truncated) card.dataset.truncated = truncated;
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
