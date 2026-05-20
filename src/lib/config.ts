/**
 * Shared frontend constants. Mirrors the agent's `translator/src/config.py`
 * where relevant; keep them in sync if you change either.
 */

// Hard cap on participants per room (grill Q21). The token route also
// embeds this into RoomConfiguration.maxParticipants so the server enforces it.
export const MAX_PARTICIPANTS = 8;

// Idle disconnect: mic + camera both off, no attribute changes for this long
// -> client-side disconnect after a "still there?" prompt. (Grill Q21)
export const IDLE_DISCONNECT_MS = 15 * 60 * 1000;

// Sentinel meaning "no translation, native passthrough."
export const NATIVE_LANG = "none";

// Participant attribute carrying each participant's chosen language.
export const PARTICIPANT_LANG_ATTR = "lang";

// Track attribute keys for translator-published tracks. Must match the
// Python agent's TRACK_ATTR_* constants.
export const TRACK_ATTR_KIND = "kind";
export const TRACK_ATTR_SOURCE_IDENTITY = "source_identity";
export const TRACK_ATTR_TARGET_LANG = "target_lang";
export const TRANSLATION_TRACK_KIND = "translation";
