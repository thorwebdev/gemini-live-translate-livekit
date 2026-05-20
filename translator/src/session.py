"""One bidirectional Gemini Live session bridging a speaker to a target language."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import random

from google import genai
from google.genai import types as genai_types
from livekit import rtc

from audio import iter_pcm_for_gemini, make_audio_source, push_pcm_to_source
from config import (
    GEMINI_INPUT_SAMPLE_RATE,
    GEMINI_MAX_FAILURES_BEFORE_LONG_BACKOFF,
    GEMINI_MODEL,
    GEMINI_RECONNECT_BACKOFF_SEC,
    TRACK_ATTR_KIND,
    TRACK_ATTR_SOURCE_IDENTITY,
    TRACK_ATTR_TARGET_LANG,
    TRANSLATION_TRACK_KIND,
)

logger = logging.getLogger("translator.session")


class GeminiSession:
    """Bridges a single speaker's mic into a single target-language translation track.

    Lifecycle:
      - `start()` connects to Gemini Live, publishes a translator track to the room,
        and starts the in/out audio pumps.
      - `aclose()` tears everything down. Idempotent.
      - On Gemini errors, the session reconnects with exponential backoff. After
        `GEMINI_MAX_FAILURES_BEFORE_LONG_BACKOFF` consecutive failures the track is
        marked as `error_state="failed"` until external action (e.g., a router
        reconcile triggered by a listener language change) recreates the session.
    """

    def __init__(
        self,
        *,
        room: rtc.Room,
        speaker_identity: str,
        speaker_track: rtc.RemoteAudioTrack,
        target_lang: str,
        gemini_api_key: str,
    ) -> None:
        self._room = room
        self._speaker_identity = speaker_identity
        self._speaker_track = speaker_track
        self._target_lang = target_lang
        self._gemini_api_key = gemini_api_key

        self._client = genai.Client(api_key=gemini_api_key)
        self._audio_source = make_audio_source()
        self._local_track: rtc.LocalAudioTrack | None = None
        self._track_sid: str | None = None
        self._consecutive_failures = 0
        self._tasks: list[asyncio.Task] = []
        self._closed = asyncio.Event()

    # --- Public API ---------------------------------------------------------

    async def start(self) -> None:
        """Publish the translator track and start the connect-and-pump loop."""
        track_name = f"tx:{self._speaker_identity}:{self._target_lang}"
        self._local_track = rtc.LocalAudioTrack.create_audio_track(
            track_name, self._audio_source
        )
        publish_opts = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)

        pub = await self._room.local_participant.publish_track(
            self._local_track, publish_opts
        )
        self._track_sid = pub.sid

        # Track attributes for frontend subscription routing.
        await self._room.local_participant.update_published_track_attributes(
            pub.sid,
            {
                TRACK_ATTR_KIND: TRANSLATION_TRACK_KIND,
                TRACK_ATTR_SOURCE_IDENTITY: self._speaker_identity,
                TRACK_ATTR_TARGET_LANG: self._target_lang,
            },
        )

        logger.info(
            "started translator track sid=%s name=%s for %s -> %s",
            self._track_sid,
            track_name,
            self._speaker_identity,
            self._target_lang,
        )

        self._tasks.append(
            asyncio.create_task(self._run(), name=f"session/{track_name}")
        )

    async def aclose(self) -> None:
        if self._closed.is_set():
            return
        self._closed.set()

        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            try:  # noqa: SIM105
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks.clear()

        # Unpublish and free the audio source.
        if self._track_sid:
            try:
                await self._room.local_participant.unpublish_track(self._track_sid)
            except Exception as exc:
                logger.debug("unpublish failed for %s: %s", self._track_sid, exc)

        with contextlib.suppress(Exception):
            await self._audio_source.aclose()

        logger.info(
            "closed translator session for %s -> %s",
            self._speaker_identity,
            self._target_lang,
        )

    # --- Internal pumps -----------------------------------------------------

    async def _run(self) -> None:
        """Outer loop: connect, pump, reconnect on failure."""
        while not self._closed.is_set():
            try:
                await self._connect_and_pump()
                # If _connect_and_pump returns cleanly, the speaker track ended.
                # Don't reconnect; rely on the router to clean us up.
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._consecutive_failures += 1
                idx = min(
                    self._consecutive_failures - 1,
                    len(GEMINI_RECONNECT_BACKOFF_SEC) - 1,
                )
                delay = GEMINI_RECONNECT_BACKOFF_SEC[idx]
                delay += random.uniform(0, delay * 0.2)  # jitter
                if (
                    self._consecutive_failures
                    >= GEMINI_MAX_FAILURES_BEFORE_LONG_BACKOFF
                ):
                    await self._set_track_attr_error("failed")
                logger.warning(
                    "Gemini session error (%s -> %s) attempt #%d: %s; backing off %.2fs",
                    self._speaker_identity,
                    self._target_lang,
                    self._consecutive_failures,
                    exc,
                    delay,
                )
                try:
                    await asyncio.wait_for(self._closed.wait(), timeout=delay)
                    return  # closed during backoff
                except asyncio.TimeoutError:
                    pass

    async def _connect_and_pump(self) -> None:
        """One Gemini connect + bidirectional pump."""
        live_config = self._build_live_config()
        async with self._client.aio.live.connect(
            model=GEMINI_MODEL, config=live_config
        ) as session:
            logger.info(
                "Gemini connected: %s -> %s",
                self._speaker_identity,
                self._target_lang,
            )
            self._consecutive_failures = 0
            await self._clear_track_attr_error()

            send_task = asyncio.create_task(
                self._pump_input(session), name="gemini-input"
            )
            recv_task = asyncio.create_task(
                self._pump_output(session), name="gemini-output"
            )

            done, pending = await asyncio.wait(
                {send_task, recv_task},
                return_when=asyncio.FIRST_EXCEPTION,
            )
            for task in pending:
                task.cancel()
            for task in done:
                exc = task.exception()
                if exc is not None:
                    raise exc

    def _build_live_config(self) -> genai_types.LiveConnectConfig:
        """Build the Gemini Live setup with streaming translation enabled."""
        # The streaming translation config and output transcription are accepted
        # by the v1beta Live API as fields on the setup payload. The Python SDK's
        # LiveConnectConfig may expose them as native fields in future versions;
        # for now we pass via the dict-style config to mirror the bidi WS schema.
        return {  # type: ignore[return-value]
            "response_modalities": ["AUDIO"],
            "output_audio_transcription": {},
            "streaming_translation_config": {
                "target_language_code": self._target_lang,
                "echo_target_language": False,
            },
            "realtime_input_config": {
                "automatic_activity_detection": {"disabled": False},
            },
        }

    async def _pump_input(self, session) -> None:
        """Read PCM from the speaker's track and forward to Gemini."""
        async for pcm in iter_pcm_for_gemini(self._speaker_track):
            if self._closed.is_set():
                return
            await session.send_realtime_input(
                audio=genai_types.Blob(
                    data=pcm,
                    mime_type=f"audio/pcm;rate={GEMINI_INPUT_SAMPLE_RATE}",
                )
            )

    async def _pump_output(self, session) -> None:
        """Receive Gemini translated audio + transcription, route into the room."""
        async for response in session.receive():
            if self._closed.is_set():
                return

            sc = getattr(response, "server_content", None)
            if sc is None:
                continue

            # Translated audio frames
            model_turn = getattr(sc, "model_turn", None)
            if model_turn is not None:
                for part in getattr(model_turn, "parts", []) or []:
                    inline = getattr(part, "inline_data", None)
                    if inline and inline.data:
                        await push_pcm_to_source(self._audio_source, inline.data)

            # Translated transcript -> text stream for the captions sidebar
            ot = getattr(sc, "output_transcription", None)
            if ot and getattr(ot, "text", None):
                await self._publish_transcript(ot.text, final=False)

            if getattr(sc, "turn_complete", False):
                await self._publish_transcript("", final=True)

    async def _publish_transcript(self, text: str, *, final: bool) -> None:
        """Best-effort text-stream publish. Frontend filters by attributes."""
        if not text and not final:
            return
        try:
            # Send each chunk as its own text-stream message; frontend appends.
            writer = await self._room.local_participant.stream_text(
                topic="lk.translation",
                sender_identity=self._speaker_identity,
                attributes={
                    "target_lang": self._target_lang,
                    "source_identity": self._speaker_identity,
                    "final": "true" if final else "false",
                },
            )
            if text:
                await writer.write(text)
            await writer.aclose()
        except Exception as exc:
            logger.debug("text-stream publish failed: %s", exc)

    async def _set_track_attr_error(self, state: str) -> None:
        if not self._track_sid:
            return
        with contextlib.suppress(Exception):
            await self._room.local_participant.update_published_track_attributes(
                self._track_sid,
                {
                    TRACK_ATTR_KIND: TRANSLATION_TRACK_KIND,
                    TRACK_ATTR_SOURCE_IDENTITY: self._speaker_identity,
                    TRACK_ATTR_TARGET_LANG: self._target_lang,
                    "error_state": state,
                },
            )

    async def _clear_track_attr_error(self) -> None:
        if not self._track_sid:
            return
        with contextlib.suppress(Exception):
            await self._room.local_participant.update_published_track_attributes(
                self._track_sid,
                {
                    TRACK_ATTR_KIND: TRANSLATION_TRACK_KIND,
                    TRACK_ATTR_SOURCE_IDENTITY: self._speaker_identity,
                    TRACK_ATTR_TARGET_LANG: self._target_lang,
                    "error_state": "",
                },
            )
