export function FloatingLastPrompt(props: {
  readonly text: string | null;
  readonly onSelect: () => void;
}) {
  const text = props.text?.replace(/\s+/g, " ").trim() || "User message";
  return (
    <div
      className="chat-composer-lane pointer-events-none absolute inset-x-0 top-2 z-30"
      data-testid="floating-last-prompt"
    >
      <div className="chat-content-lane flex justify-end">
        <button
          type="button"
          aria-label={`Jump to last prompt: ${text}`}
          onPointerDown={(event) => event.preventDefault()}
          onClick={props.onSelect}
          className="pointer-events-auto max-w-[80%] cursor-pointer rounded-2xl border border-border/60 bg-message px-3 py-2 text-left text-message-foreground text-sm leading-5 shadow-lg shadow-black/15 transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring dark:hover:brightness-110"
        >
          <span className="line-clamp-2 break-words">{text}</span>
        </button>
      </div>
    </div>
  );
}
