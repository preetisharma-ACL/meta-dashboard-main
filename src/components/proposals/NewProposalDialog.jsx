import { createSignal, createEffect, on, Show } from "solid-js";
import {
  createProposal,
  saveMyProfile,
  BROCHURE_TYPES,
  BROCHURE_ACCEPT,
  BROCHURE_MAX_BYTES,
} from "../../services/proposals";
import { errorMessage } from "../../utils/apiErrors";
import { Modal, InlineError, FIELD, LABEL, GHOST_BTN, PRIMARY_BTN, Spinner } from "./ProposalUI";

// ─── New proposal ─────────────────────────────────────────────────────────────
// Brief + who it is prepared by (+ a brochure for admin). "Use my profile"
// sends no prepared_by and the server fills it from meta.me. When meta.me has
// no name or phone yet, the profile fields are asked for here; with "Save as
// my profile" ticked they are PUT to /meta/ first, otherwise they ride along as
// prepared_by for this one proposal.
//
// Props: open, meta, onClose(), onCreated(detail), onMeta(nextMeta)

const blankPerson = () => ({ name: "", designation: "", phone: "", email: "" });

export default function NewProposalDialog(props) {
  const [brief, setBrief] = createSignal("");
  const [who, setWho] = createSignal("me"); // "me" | "other"
  const [mine, setMine] = createSignal(blankPerson());
  const [saveProfile, setSaveProfile] = createSignal(true);
  const [other, setOther] = createSignal(blankPerson());
  const [file, setFile] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  const me = () => props.meta?.me ?? {};
  const profileIncomplete = () => !String(me().name ?? "").trim() || !String(me().phone ?? "").trim();

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setBrief("");
        setWho("me");
        setMine({
          name: me().name ?? "",
          designation: me().designation ?? "",
          phone: me().phone ?? "",
          email: me().email ?? "",
        });
        setSaveProfile(true);
        setOther(blankPerson());
        setFile(null);
        setBusy(false);
        setError("");
      },
    ),
  );

  const pickFile = (f) => {
    setError("");
    if (!f) return setFile(null);
    if (f.type && !BROCHURE_TYPES.includes(f.type)) {
      setFile(null);
      return setError("The brochure must be a PDF, JPG, PNG or WEBP.");
    }
    if (f.size > BROCHURE_MAX_BYTES) {
      setFile(null);
      return setError("The brochure is over 15 MB.");
    }
    setFile(f);
  };

  const valid = () => {
    if (!brief().trim()) return false;
    if (who() === "other") return !!other().name.trim();
    if (profileIncomplete()) return !!mine().name.trim() && !!mine().phone.trim();
    return true;
  };

  const submit = async () => {
    if (!valid() || busy()) return;
    setBusy(true);
    setError("");
    try {
      let preparedBy = null;
      if (who() === "other") {
        preparedBy = trimAll(other());
      } else if (profileIncomplete()) {
        const p = trimAll(mine());
        if (saveProfile()) {
          const next = await saveMyProfile(p);
          if (next) props.onMeta?.(next);
        } else {
          preparedBy = { ...p, email: p.email || me().email || "" };
        }
      }
      const detail = await createProposal({
        brief: brief().trim(),
        preparedBy,
        brochure: props.meta?.brochure_upload ? file() : null,
      });
      if (!detail?.id) throw new Error("The server did not return the new proposal.");
      props.onCreated(detail);
    } catch (err) {
      setError(err?.status === 403 ? "You don't have permission to create proposals." : errorMessage(err, "Could not create the proposal."));
      setBusy(false);
    }
  };

  const personFields = (get, set, withEmail) => (
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label class={LABEL}>Name</label>
        <input class={FIELD} value={get().name} onInput={(e) => set({ ...get(), name: e.target.value })} />
      </div>
      <div>
        <label class={LABEL}>Designation</label>
        <input class={FIELD} value={get().designation} onInput={(e) => set({ ...get(), designation: e.target.value })} />
      </div>
      <div>
        <label class={LABEL}>Phone</label>
        <input class={FIELD} type="tel" value={get().phone} onInput={(e) => set({ ...get(), phone: e.target.value })} />
      </div>
      <Show when={withEmail}>
        <div>
          <label class={LABEL}>Email</label>
          <input class={FIELD} type="email" value={get().email} onInput={(e) => set({ ...get(), email: e.target.value })} />
        </div>
      </Show>
    </div>
  );

  return (
    <Modal open={props.open} title="New proposal" width="max-w-2xl" busy={busy()} onClose={props.onClose}>
      <Show
        when={!busy()}
        fallback={
          <div class="py-14 flex flex-col items-center gap-3 text-[#54657E] dark:text-gray-300">
            <Spinner class="w-7 h-7 text-[#AC2334]" />
            <p class="text-sm font-semibold">Reading the brief…</p>
            <p class="text-xs text-[#8593A8]">This takes a few seconds.</p>
          </div>
        }
      >
        <form
          class="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <label class={LABEL} for="np-brief">Paste or type the client brief</label>
            <textarea
              id="np-brief"
              class={FIELD + " min-h-[12rem] leading-relaxed"}
              data-autofocus
              value={brief()}
              onInput={(e) => setBrief(e.target.value)}
              placeholder="Leads, CPL, qualified %, project facts, anything the client told you."
            />
          </div>

          <fieldset>
            <legend class={LABEL}>Prepared by</legend>
            <div class="flex flex-wrap gap-4 mb-3 text-sm text-[#14233A] dark:text-gray-200">
              <label class="inline-flex items-center gap-2 cursor-pointer">
                <input type="radio" name="np-who" checked={who() === "me"} onChange={() => setWho("me")} class="accent-[#AC2334]" />
                Use my profile
              </label>
              <label class="inline-flex items-center gap-2 cursor-pointer">
                <input type="radio" name="np-who" checked={who() === "other"} onChange={() => setWho("other")} class="accent-[#AC2334]" />
                Someone else
              </label>
            </div>
            <Show when={who() === "me"}>
              <Show
                when={profileIncomplete()}
                fallback={
                  <div class="rounded-lg bg-[#F8FAFC] dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 px-4 py-3 text-sm text-[#14233A] dark:text-gray-200">
                    <p class="font-semibold">{me().name}</p>
                    <p class="text-[#54657E] dark:text-gray-400">
                      {[me().designation, me().phone, me().email].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                }
              >
                <p class="text-xs text-[#8593A8] dark:text-gray-400 mb-2">Your profile has no name or phone yet. The PDF prints these.</p>
                {personFields(mine, setMine, false)}
                <label class="mt-3 inline-flex items-center gap-2 text-sm text-[#14233A] dark:text-gray-200 cursor-pointer">
                  <input type="checkbox" checked={saveProfile()} onChange={(e) => setSaveProfile(e.target.checked)} class="accent-[#AC2334]" />
                  Save as my profile
                </label>
              </Show>
            </Show>
            <Show when={who() === "other"}>{personFields(other, setOther, true)}</Show>
          </fieldset>

          <Show when={props.meta?.brochure_upload}>
            <div>
              <label class={LABEL} for="np-brochure">Brochure (optional)</label>
              <input
                id="np-brochure"
                type="file"
                accept={BROCHURE_ACCEPT}
                class="block w-full text-sm text-[#54657E] dark:text-gray-300 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-[#F1F4F9] file:text-[#14233A] file:font-semibold hover:file:bg-[#E2E8F1] dark:file:bg-gray-700 dark:file:text-gray-100"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              <p class="mt-1 text-xs text-[#8593A8] dark:text-gray-400">PDF, JPG, PNG or WEBP up to 15 MB. Only read by the AI, not stored.</p>
            </div>
          </Show>

          <InlineError message={error()} />

          <div class="flex justify-end gap-2 pt-1">
            <button type="button" class={GHOST_BTN} onClick={() => props.onClose()}>
              Cancel
            </button>
            <button type="submit" class={PRIMARY_BTN} disabled={!valid()}>
              Create proposal
            </button>
          </div>
        </form>
      </Show>
    </Modal>
  );
}

const trimAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v ?? "").trim()]));
