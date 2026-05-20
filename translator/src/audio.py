"""Audio frame plumbing for the translation agent."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from livekit import rtc

from config import AUDIO_CHANNELS, GEMINI_INPUT_SAMPLE_RATE, GEMINI_OUTPUT_SAMPLE_RATE

logger = logging.getLogger("translator.audio")


async def iter_pcm_for_gemini(
    track: rtc.RemoteAudioTrack,
) -> AsyncIterator[bytes]:
    """Read PCM frames from a LiveKit track, downsample to 16 kHz mono,
    yield raw little-endian int16 bytes ready for Gemini Live input."""

    stream = rtc.AudioStream(
        track,
        sample_rate=GEMINI_INPUT_SAMPLE_RATE,
        num_channels=AUDIO_CHANNELS,
    )
    try:
        async for ev in stream:
            # ev.frame.data is array.array("h") of int16 samples
            yield bytes(ev.frame.data)
    finally:
        await stream.aclose()


def make_audio_source() -> rtc.AudioSource:
    """An AudioSource sized for Gemini's 24 kHz mono output."""
    return rtc.AudioSource(GEMINI_OUTPUT_SAMPLE_RATE, AUDIO_CHANNELS)


async def push_pcm_to_source(
    source: rtc.AudioSource,
    pcm_bytes: bytes,
) -> None:
    """Wrap a raw 24 kHz mono int16 PCM chunk in an AudioFrame and capture it."""
    import array

    samples = array.array("h")
    samples.frombytes(pcm_bytes)
    frame = rtc.AudioFrame(
        data=samples.tobytes(),
        sample_rate=GEMINI_OUTPUT_SAMPLE_RATE,
        num_channels=AUDIO_CHANNELS,
        samples_per_channel=len(samples),
    )
    try:
        await source.capture_frame(frame)
    except Exception as exc:
        # The source can be closed concurrently when the session tears down.
        if "closed" in str(exc).lower() or "invalidstate" in str(exc).lower():
            logger.debug("AudioSource closed mid-capture; dropping frame")
        else:
            raise


class _BoundedQueue(asyncio.Queue[bytes]):
    """Small bounded queue used to back-pressure Gemini output into LiveKit publish."""


def new_output_queue(maxsize: int = 128) -> _BoundedQueue:
    return _BoundedQueue(maxsize=maxsize)
