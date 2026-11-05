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

const writtenStyles = new WeakMap<HTMLElement, Map<string, string>>();

/**
 * Writes a style only when it changed since the last write. Reading `element.style` back cannot
 * tell: it returns values normalized ("0 0px" reads "0px 0px", 55.015625px reads 55.0156px), so a
 * read-back check rewrites every frame and each rewrite re-layerizes the page.
 */
export function writeStyle(
  element: HTMLElement,
  property: "height" | "translate" | "top" | "maskImage" | "clipPath",
  value: string,
): void {
  let written = writtenStyles.get(element);
  if (!written) {
    written = new Map();
    writtenStyles.set(element, written);
  }
  if (written.get(property) === value) return;
  written.set(property, value);
  element.style[property] = value;
}

/** Top padding a floating card keeps once its content has lifted into the rest. */
const FLOATING_TOP_PADDING_PX = 8;

/**
 * Where to cut a block to its first two rendered lines (null when it has two or fewer), and how far
 * its first line sits below its top, as a leading quote or heading margin does. Cutting between
 * lines two and three keeps the last line shown whole whatever the markdown's spacing.
 */
function twoLineCut(element: HTMLElement): { cut: number | null; leading: number } {
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
  lines.sort((a, b) => a.top - b.top);
  const top = element.getBoundingClientRect().top;
  return {
    cut: lines.length < 3 ? null : (lines[1]!.bottom + lines[2]!.top) / 2 - top,
    leading: lines.length > 0 ? Math.max(0, lines[0]!.top - top) : 0,
  };
}

/**
 * Sizes a card per scroll frame without reading layout. It covers `covered`, what is left of its
 * row below the line, so the row never shows twice; `cap` is what a collapsed row shows. Shrinking,
 * its bottom edge rises through the footer space, the content lifts into the top whitespace, and
 * then the content clips to two lines. `lift: false` keeps the row's top padding.
 */
export function sizePromptCard(
  card: HTMLElement,
  {
    covered,
    cap,
    lift = true,
  }: { readonly covered: number; readonly cap: number; readonly lift?: boolean },
): number | undefined {
  const body = card.querySelector<HTMLElement>("[data-pinned-prompt-body]");
  if (card.dataset.content === undefined || !body) return undefined;
  if (card.dataset.expanded === "true") {
    writeStyle(card, "height", "");
    writeStyle(body, "height", "");
    writeStyle(body, "translate", "");
    if (card.dataset.floating !== "true") card.dataset.floating = "true";
    return undefined;
  }
  const content = Number(card.dataset.content);
  const padding = Number(card.dataset.padding);
  const liftable = Number(card.dataset.lift);
  const maxLift = lift ? liftable : 0;
  const height = Math.max(Number(card.dataset.target) + liftable - maxLift, covered);
  const wanted = Math.min(cap, content);
  const lifted = Math.min(maxLift, Math.max(0, wanted - (height - padding)));
  const shown = Math.min(wanted, height - padding + lifted);
  const cardHeight = `${height}px`;
  writeStyle(card, "height", cardHeight);
  const bodyHeight = `${shown}px`;
  writeStyle(body, "height", bodyHeight);
  const bodyTranslate = lifted > 0 ? `0 ${-lifted}px` : "";
  writeStyle(body, "translate", bodyTranslate);
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
      const { cut, leading } = twoLineCut(content);
      // Only a clipped copy lifts; a short one keeps the row's even padding.
      const lift =
        cut === null
          ? 0
          : Math.max(0, parseFloat(cardStyle.paddingTop) - FLOATING_TOP_PADDING_PX) + leading;
      card.dataset.content = String(height);
      card.dataset.padding = String(padding);
      card.dataset.lift = String(lift);
      card.dataset.target = String(padding + (cut ?? height) - lift);
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
          expanded ? "min-h-0 flex-1 overflow-y-auto overscroll-contain" : "overflow-hidden"
        }
      >
        {/* Remounted on a toggle so the measure runs even when the height does not change. */}
        {/* flow-root keeps a leading quote's margin inside, where measuring sees it. */}
        <div key={`${message.id}:${expanded}`} ref={measure} className="flow-root">
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
    sizePromptCard(card, { covered: 0, cap: Infinity, lift: false });
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
