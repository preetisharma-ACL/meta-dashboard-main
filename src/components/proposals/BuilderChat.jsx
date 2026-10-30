import { createSignal, createMemo, createEffect, on, For, Show } from "solid-js";
import { Send, Undo2, CheckCircle2, PencilLine } from "lucide-solid";
import { CARD, InlineError, SMALL_BTN, Spinner } from "./ProposalUI";
import { fmtWhen } from "../../services/proposals";

// ─── Builder: chat (left panel) ───────────────────────────────────────────────
// messages[] {id, role: user|assistant|system, text, kind, created_at}.
// User right, assistant left, system as a small grey line. Under the latest
// assistant "confirm" message (until confirmed): Confirm details / Edit in
// form. Under the latest assistant "edit" message: Undo — undo pops the most
// recent change, so offering it on older edits would promise the wrong one.
//
// Props: detail, meta, busy, error, onDismissError(), onConfirm(), onChat(text)
// → Promise<bool>, onUndo(), onEditInForm()

const money = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "$0";
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
};

export default function BuilderChat(props) {
  const [text, setText] = createSignal("");
  let list;

  const messages = () => props.detail?.messages ?? [];
  const lastIdx = (kind) =>
    createMemo(() => {
      const m = messages();
      for (let i = m.length - 1; i >= 0; i--) if (m[i].role === "assistant" && m[i].kind === kind) return i;
      return -1;
    });
  const lastConfirm = lastIdx("confirm");
  const lastEdit = lastIdx("edit");

  // Keep the newest message in view.
  createEffect(
    on(
      () => [messages().length, props.busy],
      () => queueMicrotask(() => list && (list.scrollTop = list.scrollHeight)),
    ),
  );

  const send = async () => {
    const t = text().trim();
    if (!t || props.busy) return;
    if (await props.onChat(t)) setText("");
  };

  const ai = () => props.detail?.ai ?? props.meta?.ai ?? null;

  return (
    <div class={CARD + " flex flex-col min-h-[420px] xl:h-[calc(100vh-9.5rem)] xl:sticky xl:top-3"}>
      <div class="px-4 py-3 border-b border-[#E2E8F1] dark:border-gray-700">
        <h2 class="text-xs font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-300">Chat</h2>
      </div>

      <div ref={list} class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <Show when={messages().length} fallback={<p class="text-sm text-[#8593A8] text-center py-8">No messages yet.</p>}>
          <For each={messages()}>
            {(m, i) => (
              <Show
                when={m.role !== "system"}
                fallback={
                  <p class="text-[11px] text-center text-[#8593A8] dark:text-gray-500 whitespace-pre-line px-4">
                    {m.text}
                  </p>
                }
              >
                <div class={"flex flex-col " + (m.role === "user" ? "items-end" : "items-start")}>
                  <div
                    class={
                      "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line break-words " +
                      (m.role === "user"
                        ? "bg-[#14233A] text-white rounded-br-md dark:bg-[#2B3A55]"
                        : m.kind === "error"
                          ? "bg-[#FBEEF0] text-[#AC2334] border border-[#AC2334]/20 rounded-bl-md dark:bg-red-900/20 dark:text-red-300"
                          : "bg-[#F1F4F9] text-[#14233A] rounded-bl-md dark:bg-gray-700 dark:text-gray-100")
                    }
                  >
                    {m.text}
                  </div>
                  <span class="mt-0.5 px-1 text-[10px] text-[#9DAEC4] dark:text-gray-500">{fmtWhen(m.created_at)}</span>

                  <Show when={!props.detail?.confirmed && i() === lastConfirm()}>
                    <div class="mt-1.5 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        class={SMALL_BTN + " !bg-[#AC2334] !text-white !border-[#AC2334] hover:!bg-[#93192a]"}
                        disabled={props.busy}
                        onClick={() => props.onConfirm()}
                      >
                        <CheckCircle2 size={14} /> Confirm details
                      </button>
                      <button type="button" class={SMALL_BTN} disabled={props.busy} onClick={() => props.onEditInForm()}>
                        <PencilLine size={14} /> Edit in form
                      </button>
                    </div>
                  </Show>
                  <Show when={i() === lastEdit()}>
                    <button type="button" class={SMALL_BTN + " mt-1.5"} disabled={props.busy} onClick={() => props.onUndo()}>
                      <Undo2 size={14} /> Undo
                    </button>
                  </Show>
                </div>
              </Show>
            )}
          </For>
        </Show>
        <Show when={props.busy}>
          <div class="flex items-center gap-2 text-sm text-[#54657E] dark:text-gray-300 px-1" role="status">
            <Spinner class="w-4 h-4 text-[#AC2334]" /> Writing… this can take up to 20 seconds.
          </div>
        </Show>
      </div>

      <div class="border-t border-[#E2E8F1] dark:border-gray-700 p-3 space-y-2">
        <Show when={props.error}>
          <div class="flex items-start gap-2">
            <div class="flex-1">
              <InlineError message={props.error} />
            </div>
            <button type="button" aria-label="Dismiss" class="text-lg leading-none text-[#8593A8] hover:text-[#AC2334]" onClick={() => props.onDismissError()}>
              ×
            </button>
          </div>
        </Show>
        <form
          class="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            rows={2}
            class="flex-1 resize-none px-3 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-[#14233A] dark:text-gray-100 focus:ring-2 focus:ring-[#AC2334]/40 focus:border-[#AC2334] outline-none disabled:opacity-50"
            placeholder={props.busy ? "Writing…" : "Ask for a change, e.g. make the headline shorter"}
            aria-label="Message"
            value={text()}
            disabled={props.busy}
            onInput={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            type="submit"
            aria-label="Send"
            class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[#AC2334] text-white hover:bg-[#93192a] disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={props.busy || !text().trim()}
          >
            <Send size={16} />
          </button>
        </form>
        <Show when={ai() && ai().cap_usd != null}>
          <p class="text-[11px] text-[#8593A8] dark:text-gray-400">
            AI today: {money(ai().spent_today_usd)} of {money(ai().cap_usd)}
          </p>
        </Show>
      </div>
    </div>
  );
}
