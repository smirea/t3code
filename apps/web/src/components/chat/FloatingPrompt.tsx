import { ImageIcon } from "lucide-react";
import { use, useState, type CSSProperties, type Ref } from "react";

import { cn } from "~/lib/utils";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import type { ChatMessage } from "../../types";
import { Button } from "../ui/button";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import {
  LEADING_PROMPT_ROW_ID,
  useStickyPrompt,
  type StickyPromptStore,
} from "./stickyPromptStore";
import type { TimelineMinimapItem } from "./timelineMinimapItems";
import { TimelineRowCtx } from "./timelineRowContext";
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
  property: "height" | "translate" | "top" | "maskImage" | "clipPath" | "opacity" | "minWidth",
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

/** What a floating card keeps of its padding, above its first line and below its last. */
const FLOATING_PADDING_PX = 8;

/** The least space between a whole prompt's last line and the time beside it. */
const STAMP_GAP_PX = 8;

/** How far a whole prompt scrolls under the line while it makes room for its time. */
const SETTLE_PX = 20;

/** A timeline bubble's widest, as a share of its lane (`max-w-[80%]`). */
const BUBBLE_MAX_WIDTH_RATIO = 0.8;

/**
 * Where to cut a block to its first two rendered lines (null when it has two or fewer), how far
 * its first line sits below its top, as a leading quote or heading margin does, and how far the cut
 * falls below the second line. Cutting between lines two and three keeps the last line shown whole
 * whatever the markdown's spacing. `ends` spans the last line shown, left to right.
 */
function twoLineCut(element: HTMLElement): {
  cut: number | null;
  leading: number;
  trailing: number;
  lastLine: number;
  ends: { left: number; right: number } | null;
  count: number;
} {
  const lines: Array<{ top: number; bottom: number; left: number; right: number }> = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node && lines.length < 3; node = walker.nextNode()) {
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width === 0) continue;
      const line = lines.find((candidate) => Math.abs(candidate.top - rect.top) < 1);
      if (line) {
        line.bottom = Math.max(line.bottom, rect.bottom);
        line.left = Math.min(line.left, rect.left);
        line.right = Math.max(line.right, rect.right);
      } else lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
    }
  }
  lines.sort((a, b) => a.top - b.top);
  const top = element.getBoundingClientRect().top;
  return {
    cut: lines.length < 3 ? null : (lines[1]!.bottom + lines[2]!.top) / 2 - top,
    leading: lines.length > 0 ? Math.max(0, lines[0]!.top - top) : 0,
    trailing: lines.length < 3 ? 0 : Math.max(0, (lines[2]!.top - lines[1]!.bottom) / 2),
    lastLine: lines.length < 3 ? 0 : lines[1]!.bottom - lines[1]!.top,
    ends: lines[Math.min(lines.length, 2) - 1] ?? null,
    count: lines.length,
  };
}

/**
 * Sizes a card per frame without reading layout, covering `covered` (its row below the line);
 * `cap` is what a collapsed row shows. It shrinks through its footer and padding to two lines, or
 * a whole prompt grows a line for its time. `lift: false` keeps the row's padding.
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
  const sinkable = Number(card.dataset.sink);
  const maxLift = lift ? liftable : 0;
  const maxSink = lift ? sinkable : 0;
  const stamp = lift ? Number(card.dataset.stamp) : 0;
  const widen = lift ? Number(card.dataset.widen) : 0;
  const base = Number(card.dataset.target) + liftable - maxLift + sinkable - maxSink;
  const settled = stamp > 0 || widen > 0 ? Math.min(1, Math.max(0, base - covered) / SETTLE_PX) : 0;
  const height = Math.max(base + stamp * settled, covered);
  const wanted = Math.min(cap, content);
  const room = height - padding;
  const sunk = Math.min(maxSink, Math.max(0, wanted - room));
  const lifted = Math.min(maxLift, Math.max(0, wanted - room - sunk));
  const shown = Math.min(wanted, room + sunk + lifted);
  const cardHeight = `${height}px`;
  writeStyle(card, "height", cardHeight);
  const bodyHeight = `${shown}px`;
  writeStyle(body, "height", bodyHeight);
  const bodyTranslate = lifted > 0 ? `0 ${-lifted}px` : "";
  writeStyle(body, "translate", bodyTranslate);
  // The button stays over the last line while the bottom edge closes in under it, and a time
  // settles into the room a whole prompt makes for it.
  const toggle = card.querySelector<HTMLElement>("[data-pinned-prompt-toggle]");
  const progress = sunk > 0 ? sunk / sinkable : settled;
  const dropped = progress * Number(card.dataset.drop);
  if (toggle) {
    writeStyle(toggle, "translate", dropped !== 0 ? `0 ${dropped}px` : "");
    writeStyle(toggle, "opacity", settled > 0 && settled < 1 ? String(settled) : "");
  }
  const minWidth = settled > 0 && widen > 0 ? Number(card.dataset.width) + widen * settled : 0;
  writeStyle(card, "minWidth", minWidth > 0 ? `${minWidth}px` : "");
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
  time,
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
  readonly time?: string;
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
      const { cut, leading, trailing, lastLine, ends, count } = twoLineCut(content);
      // Only a clipped copy trims its padding; a short one keeps the row's.
      const lift =
        cut === null
          ? 0
          : Math.max(0, parseFloat(cardStyle.paddingTop) - FLOATING_PADDING_PX) + leading;
      const bottomTrim = Math.max(0, parseFloat(cardStyle.paddingBottom) - FLOATING_PADDING_PX);
      const sink = cut === null ? 0 : bottomTrim + trailing;
      // How far the button moves down to sit centered on the last line once the card is trimmed.
      const toggleHeight =
        card.querySelector<HTMLElement>("[data-pinned-prompt-toggle]")?.offsetHeight ?? 0;
      const timeElement = card.querySelector<HTMLElement>("[data-pinned-prompt-time]");
      // A whole prompt keeps the time at the end of its last line: a single line widens the card
      // for it, since that cannot rewrap; past the widest bubble it takes a line of its own.
      let stamp = 0;
      let widen = 0;
      if (cut === null && timeElement && ends) {
        const contentRect = content.getBoundingClientRect();
        const lineEnd =
          cardStyle.direction === "rtl"
            ? contentRect.right - ends.left
            : ends.right - contentRect.left;
        const needed =
          parseFloat(cardStyle.paddingInlineStart) +
          lineEnd +
          STAMP_GAP_PX +
          timeElement.offsetWidth +
          parseFloat(cardStyle.paddingInlineEnd);
        const width = parseFloat(card.style.width) || card.offsetWidth;
        const widest = (card.parentElement?.clientWidth ?? width) * BUBBLE_MAX_WIDTH_RATIO;
        if (needed > width) {
          if (count === 1 && needed <= widest) widen = needed - width;
          else stamp = toggleHeight - bottomTrim;
        }
        card.dataset.width = String(width);
      }
      const drop =
        cut === null ? (stamp > 0 ? bottomTrim : 0) : bottomTrim + (toggleHeight - lastLine) / 2;
      card.dataset.content = String(height);
      card.dataset.padding = String(padding);
      card.dataset.lift = String(lift);
      card.dataset.sink = String(sink);
      card.dataset.drop = String(drop);
      card.dataset.stamp = String(stamp);
      card.dataset.widen = String(widen);
      card.dataset.settle = String(stamp > 0 || widen > 0 ? SETTLE_PX : 0);
      card.dataset.target = String(padding + (cut ?? height) - lift - sink);
      onMeasured(card);
    });
    observer.observe(content);
    // The time's width changes with the clock format or the day, and decides whether it fits.
    const timeElement = card.querySelector("[data-pinned-prompt-time]");
    if (timeElement) observer.observe(timeElement);
    return () => observer.disconnect();
  };
  const timeLabel = time ? (
    <span
      data-pinned-prompt-time=""
      dir="auto"
      className="pointer-events-none flex h-7 items-center px-1 text-muted-foreground text-xs tabular-nums sm:h-6"
    >
      {time}
    </span>
  ) : null;
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
        // Clipped lines must not take focus; the card's jump button stands in for them.
        inert={!expanded}
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
        <div className="mt-1.5 flex items-center justify-end gap-1">
          {timeLabel}
          {toggle}
        </div>
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
              over the end of the last line shown. A floating copy shows its time here too. */}
          <div
            data-pinned-prompt-toggle=""
            className="pointer-events-none invisible absolute end-3 bottom-3 flex group-data-[floating=true]/pinned:visible group-data-[truncated=true]/pinned:visible"
          >
            <span className="hidden w-8 bg-linear-to-l from-message to-transparent group-data-[truncated=true]/pinned:block rtl:bg-linear-to-r" />
            <div className="flex items-center gap-1 bg-message">
              {timeLabel}
              <div className="pointer-events-auto hidden group-data-[truncated=true]/pinned:flex">
                {toggle}
              </div>
            </div>
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
  const { timestampFormat } = use(TimelineRowCtx);
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
                time={formatDayAwareTimestamp(message.createdAt, timestampFormat)}
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
