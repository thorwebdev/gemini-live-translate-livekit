"""Reconciles the set of active GeminiSession instances to room demand."""

from __future__ import annotations

import asyncio
import logging

from livekit import rtc

from config import (
    NATIVE_LANG,
    PARTICIPANT_LANG_ATTR,
    RECONCILE_DEBOUNCE_SEC,
    SESSION_GRACE_SEC,
)
from session import GeminiSession

logger = logging.getLogger("translator.router")

# (speaker_identity, target_lang)
SessionKey = tuple[str, str]


class TranslationRouter:
    """Owns the room's translation-session lifecycle.

    Demand model (from grill Q16):
      A session (S, T) exists iff there is at least one listener with lang == T
      AND speaker S has an enabled mic track AND S.lang != T.

    Mute or last-listener-leaves triggers a SESSION_GRACE_SEC teardown so brief
    coughs/toggles don't thrash Gemini connections.
    """

    def __init__(self, room: rtc.Room, gemini_api_key: str) -> None:
        self._room = room
        self._gemini_api_key = gemini_api_key

        # Per-speaker mic track that is currently subscribed and unmuted.
        self._speaker_tracks: dict[str, rtc.RemoteAudioTrack] = {}

        # Active sessions keyed by (speaker_identity, target_lang).
        self._sessions: dict[SessionKey, GeminiSession] = {}

        # Pending teardown timers keyed the same way.
        self._grace_tasks: dict[SessionKey, asyncio.Task] = {}

        # Detached close tasks (fire-and-forget); we keep references to prevent
        # the GC from collecting them mid-shutdown.
        self._detached_tasks: set[asyncio.Task] = set()

        self._reconcile_handle: asyncio.TimerHandle | None = None
        self._reconcile_lock = asyncio.Lock()

    # --- Lifecycle ---------------------------------------------------------

    def start(self) -> None:
        room = self._room

        @room.on("participant_connected")
        def _on_conn(_: rtc.RemoteParticipant) -> None:
            self._schedule_reconcile()

        @room.on("participant_disconnected")
        def _on_disc(p: rtc.RemoteParticipant) -> None:
            self._on_participant_left(p.identity)
            self._schedule_reconcile()

        @room.on("participant_attributes_changed")
        def _on_attrs(_changed: dict[str, str], _p: rtc.Participant) -> None:
            self._schedule_reconcile()

        @room.on("track_subscribed")
        def _on_subscribed(
            track: rtc.Track,
            _pub: rtc.RemoteTrackPublication,
            participant: rtc.RemoteParticipant,
        ) -> None:
            if track.kind == rtc.TrackKind.KIND_AUDIO and isinstance(
                track, rtc.RemoteAudioTrack
            ):
                self._speaker_tracks[participant.identity] = track
                self._schedule_reconcile()

        @room.on("track_unsubscribed")
        def _on_unsubscribed(
            track: rtc.Track,
            _pub: rtc.RemoteTrackPublication,
            participant: rtc.RemoteParticipant,
        ) -> None:
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                self._speaker_tracks.pop(participant.identity, None)
                self._schedule_reconcile()

        @room.on("track_muted")
        def _on_muted(_pub: rtc.TrackPublication, _p: rtc.Participant) -> None:
            self._schedule_reconcile()

        @room.on("track_unmuted")
        def _on_unmuted(_pub: rtc.TrackPublication, _p: rtc.Participant) -> None:
            self._schedule_reconcile()

        # Backfill any participants/tracks already present at startup.
        for p in room.remote_participants.values():
            for pub in p.track_publications.values():
                if (
                    pub.track
                    and pub.kind == rtc.TrackKind.KIND_AUDIO
                    and isinstance(pub.track, rtc.RemoteAudioTrack)
                ):
                    self._speaker_tracks[p.identity] = pub.track

        self._schedule_reconcile()

    async def aclose(self) -> None:
        if self._reconcile_handle:
            self._reconcile_handle.cancel()
            self._reconcile_handle = None

        for task in self._grace_tasks.values():
            task.cancel()
        self._grace_tasks.clear()

        await asyncio.gather(
            *(s.aclose() for s in self._sessions.values()),
            return_exceptions=True,
        )
        self._sessions.clear()

    # --- Reconciliation ----------------------------------------------------

    def _schedule_reconcile(self) -> None:
        loop = asyncio.get_event_loop()
        if self._reconcile_handle is not None:
            self._reconcile_handle.cancel()
        self._reconcile_handle = loop.call_later(
            RECONCILE_DEBOUNCE_SEC,
            lambda: asyncio.create_task(self._reconcile()),
        )

    async def _reconcile(self) -> None:
        async with self._reconcile_lock:
            desired = self._compute_desired_sessions()
            existing = set(self._sessions.keys())

            # Cancel any pending grace teardowns for sessions we still want.
            for key in desired & set(self._grace_tasks.keys()):
                task = self._grace_tasks.pop(key)
                task.cancel()

            # Schedule grace teardown for sessions no longer desired.
            for key in existing - desired:
                if key not in self._grace_tasks:
                    self._grace_tasks[key] = asyncio.create_task(
                        self._grace_teardown(key)
                    )

            # Start newly-desired sessions.
            for key in desired - existing:
                if key in self._grace_tasks:
                    # Race: an old session is still cooling down — let it finish
                    # before starting a new one. Reschedule.
                    continue
                speaker_identity, target_lang = key
                track = self._speaker_tracks.get(speaker_identity)
                if track is None:
                    continue
                session = GeminiSession(
                    room=self._room,
                    speaker_identity=speaker_identity,
                    speaker_track=track,
                    target_lang=target_lang,
                    gemini_api_key=self._gemini_api_key,
                )
                self._sessions[key] = session
                try:
                    await session.start()
                except Exception as exc:
                    logger.exception(
                        "failed to start session %s -> %s: %s",
                        speaker_identity,
                        target_lang,
                        exc,
                    )
                    self._sessions.pop(key, None)

    def _compute_desired_sessions(self) -> set[SessionKey]:
        target_langs = self._listener_target_langs()
        if not target_langs:
            return set()

        speakers = self._active_speakers()

        desired: set[SessionKey] = set()
        for speaker_identity, source_lang in speakers:
            for tgt in target_langs:
                if tgt == source_lang:
                    continue
                desired.add((speaker_identity, tgt))
        return desired

    def _listener_target_langs(self) -> set[str]:
        """Languages any human listener wants (excluding the native sentinel)."""
        langs: set[str] = set()
        for p in self._room.remote_participants.values():
            lang = (p.attributes or {}).get(PARTICIPANT_LANG_ATTR)
            if lang and lang != NATIVE_LANG:
                langs.add(lang)
        return langs

    def _active_speakers(self) -> list[tuple[str, str]]:
        """List of (identity, lang) for speakers that have an enabled mic track."""
        out: list[tuple[str, str]] = []
        for p in self._room.remote_participants.values():
            lang = (p.attributes or {}).get(PARTICIPANT_LANG_ATTR)
            if not lang or lang == NATIVE_LANG:
                # Without a declared language, we can't safely translate.
                continue
            if p.identity not in self._speaker_tracks:
                continue
            if not self._has_unmuted_mic(p):
                continue
            out.append((p.identity, lang))
        return out

    def _has_unmuted_mic(self, p: rtc.RemoteParticipant) -> bool:
        for pub in p.track_publications.values():
            if pub.kind == rtc.TrackKind.KIND_AUDIO and not pub.muted:
                return True
        return False

    # --- Teardown ----------------------------------------------------------

    async def _grace_teardown(self, key: SessionKey) -> None:
        try:
            await asyncio.sleep(SESSION_GRACE_SEC)
        except asyncio.CancelledError:
            return

        # If, after the grace window, the session is still undesired, kill it.
        if key in self._sessions and key not in self._compute_desired_sessions():
            session = self._sessions.pop(key)
            await session.aclose()
        self._grace_tasks.pop(key, None)

    def _on_participant_left(self, identity: str) -> None:
        """Speaker fully left: immediate teardown of all their sessions."""
        self._speaker_tracks.pop(identity, None)
        for key in list(self._sessions.keys()):
            if key[0] == identity:
                session = self._sessions.pop(key)
                # Cancel any pending grace teardown so we don't double-close.
                pending = self._grace_tasks.pop(key, None)
                if pending:
                    pending.cancel()
                task = asyncio.create_task(session.aclose())
                self._detached_tasks.add(task)
                task.add_done_callback(self._detached_tasks.discard)
