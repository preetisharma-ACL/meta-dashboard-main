// ─── API error plumbing ───────────────────────────────────────────────────────
// VERIFIED envelope for a validation failure:
//   { success:false, message:"Validation failed",
//     error:{ code, detail, fields:{ <field>:[msg],
//                                    <nested>:{ <field>:[msg] },
//                                    non_field_errors:[msg] } } }
//
// api() attaches the WHOLE parsed body to err.data for an HTTP 4xx and lifts
// only the WRAPPER string ("Validation failed") onto err.message — so reading
// err.message alone throws away every actual reason. The field map is the thing
// worth reading, and it arrives two ways depending on the transport:
//   err.fields            → 200-envelope failure ({ success:false, error:{fields} })
//   err.data.error.fields → HTTP 4xx
// Both are read here. Same helper shape as RecordDisqualificationModal's
// fieldErrors(), lifted out so every screen reads these the same way.

const rawFieldErrors = (err) =>
  err?.fields ?? err?.data?.error?.fields ?? err?.data?.fields ?? null;

// DRF gives a list per key; take the first non-empty entry, but tolerate a bare
// string so a shape change degrades to "shown verbatim" rather than "[object]".
export const firstMessage = (v) => {
  if (!v) return null;
  if (Array.isArray(v)) return v.find((s) => typeof s === "string" && s) || null;
  return typeof v === "string" ? v : null;
};

// Flatten the field map to dotted paths so each message can be pinned to the one
// input that produced it, NESTED ONES INCLUDED:
//   fields.email                         → "email"
//   fields.client.onboarded_by_id        → "client.onboarded_by_id"
//   fields.campaign_manager.team_lead_id → "campaign_manager.team_lead_id"
// Messages are never rewritten on the way through — the backend's wording names
// the offending value, and paraphrasing it away is exactly what makes these
// errors unactionable.
export const collectFieldErrors = (err) => {
  const fields = rawFieldErrors(err);
  const out = {};
  if (!fields || typeof fields !== "object") return out;

  for (const [key, val] of Object.entries(fields)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      for (const [sub, subVal] of Object.entries(val)) {
        const msg = firstMessage(subVal);
        if (msg) out[`${key}.${sub}`] = msg;
      }
    } else {
      const msg = firstMessage(val);
      if (msg) out[key] = msg;
    }
  }
  return out;
};

// The banner text: the most specific thing the server said that ISN'T already
// pinned to a field. non_field_errors first (that's where cross-field rules
// land), then error.detail, then the wrapper message as a last resort.
export const errorBanner = (err, pinned = {}, fallback = "Request failed.") => {
  const nonField = Object.entries(pinned).find(([path]) =>
    path.endsWith("non_field_errors"),
  );
  if (nonField) return nonField[1];

  const detail = err?.data?.error?.detail ?? err?.data?.detail;
  if (typeof detail === "string" && detail) return detail;

  // err.message is only the wrapper ("Validation failed") on the 4xx path, so it
  // is worth showing only when nothing more specific exists at all.
  return err?.message || fallback;
};

// The most specific thing the server actually said, or null when it said
// nothing beyond the wrapper. Callers that can name a failure better than
// "Validation failed" (e.g. by HTTP status) use the null to decide when their
// own wording is the more useful one — without ever overriding real server text.
export const specificError = (err) => {
  const pinned = collectFieldErrors(err);
  const nonField = Object.entries(pinned).find(([path]) =>
    path.endsWith("non_field_errors"),
  );
  if (nonField) return nonField[1];

  const values = Object.values(pinned);
  if (values.length) return values[0];

  const detail = err?.data?.error?.detail ?? err?.data?.detail;
  if (typeof detail === "string" && detail) return detail;

  return null;
};

// The single best sentence to show for a failure, whether or not the caller has
// anywhere to pin individual fields. Prefers a real field message over the
// wrapper — on endpoints with no form behind them (a one-shot POST), a pinned
// message would otherwise never be seen at all.
export const errorMessage = (err, fallback = "Request failed.") =>
  specificError(err) ?? err?.message ?? fallback;
