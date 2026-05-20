"""Unit tests for the TranslationRouter's pure demand-computation logic.

These do not exercise LiveKit connectivity or Gemini sessions; they verify that
the router computes the correct (speaker, target_lang) set given fake room
state.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Make `src/` importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from config import NATIVE_LANG, PARTICIPANT_LANG_ATTR  # noqa: E402
from router import TranslationRouter  # noqa: E402


def _fake_participant(identity: str, lang: str | None, *, mic_muted: bool = False):
    p = MagicMock()
    p.identity = identity
    p.attributes = {PARTICIPANT_LANG_ATTR: lang} if lang else {}
    # one fake audio publication
    pub = MagicMock()
    pub.kind = _AUDIO_KIND
    pub.muted = mic_muted
    pub.track = MagicMock(name="track")
    p.track_publications = {"pub-sid": pub}
    return p


def _fake_room(participants):
    room = MagicMock()
    room.remote_participants = {p.identity: p for p in participants}
    return room


# Import the actual TrackKind enum value the router compares against.
from livekit import rtc  # noqa: E402

_AUDIO_KIND = rtc.TrackKind.KIND_AUDIO


def _router_with(participants):
    room = _fake_room(participants)
    router = TranslationRouter(room=room, gemini_api_key="test-key")
    # Skip room.on() wiring; emulate the "tracks already subscribed" backfill.
    for p in participants:
        for pub in p.track_publications.values():
            if pub.kind == _AUDIO_KIND and pub.track:
                router._speaker_tracks[p.identity] = pub.track
    return router


def test_no_listeners_means_no_sessions():
    p1 = _fake_participant("alice", "en")
    p2 = _fake_participant("bob", "es")
    # Both have lang set, but for the "listener" view, "lang" is used as both
    # speak and listen. So actually they ARE listeners. Adjust: empty room.
    router = _router_with([])
    assert router._compute_desired_sessions() == set()


def test_native_only_listener_no_sessions():
    """A listener with lang='none' implies they want native passthrough."""
    p1 = _fake_participant("alice", NATIVE_LANG)
    router = _router_with([p1])
    assert router._compute_desired_sessions() == set()


def test_same_language_pair_no_sessions():
    """Two German speakers, no other languages → no translation needed."""
    p1 = _fake_participant("p1", "de")
    p2 = _fake_participant("p2", "de")
    router = _router_with([p1, p2])
    assert router._compute_desired_sessions() == set()


def test_two_different_languages_creates_pair():
    """English speaker + Spanish speaker → 2 sessions (one each direction)."""
    p1 = _fake_participant("p1", "en")
    p2 = _fake_participant("p2", "es")
    router = _router_with([p1, p2])
    assert router._compute_desired_sessions() == {
        ("p1", "es"),
        ("p2", "en"),
    }


def test_grill_example_four_participants():
    """P1=en, P2=es, P3=de, P4=de. P3↔P4 stays native (same lang)."""
    p1 = _fake_participant("p1", "en")
    p2 = _fake_participant("p2", "es")
    p3 = _fake_participant("p3", "de")
    p4 = _fake_participant("p4", "de")
    router = _router_with([p1, p2, p3, p4])
    expected = {
        ("p1", "es"),
        ("p1", "de"),
        ("p2", "en"),
        ("p2", "de"),
        ("p3", "en"),
        ("p3", "es"),
        ("p4", "en"),
        ("p4", "es"),
    }
    assert router._compute_desired_sessions() == expected


def test_muted_speaker_does_not_produce_outgoing_sessions():
    """A speaker with muted mic isn't translated FROM, but their language still
    counts as listener demand."""
    p1 = _fake_participant("p1", "en", mic_muted=True)
    p2 = _fake_participant("p2", "es")
    router = _router_with([p1, p2])
    # p1 muted -> no ("p1", *) session. p2 unmuted -> ("p2", "en") to serve p1.
    assert router._compute_desired_sessions() == {("p2", "en")}


def test_all_speakers_muted_no_sessions():
    """Demand exists but nobody is speaking -> nothing to translate."""
    p1 = _fake_participant("p1", "en", mic_muted=True)
    p2 = _fake_participant("p2", "es", mic_muted=True)
    router = _router_with([p1, p2])
    assert router._compute_desired_sessions() == set()


def test_listener_with_native_does_not_block_others():
    """A listener with lang='none' shouldn't add to target_langs, but their
    presence shouldn't suppress sessions either."""
    p1 = _fake_participant("p1", "en")
    p2 = _fake_participant("p2", "es")
    p3 = _fake_participant("p3", NATIVE_LANG)
    router = _router_with([p1, p2, p3])
    # p3 wants native; the en<->es pair still needs translation.
    assert router._compute_desired_sessions() == {
        ("p1", "es"),
        ("p2", "en"),
    }


@pytest.mark.parametrize(
    "speaker_lang,listener_lang,expected_session",
    [
        ("en", "es", True),
        ("de", "de", False),
        ("fr", NATIVE_LANG, False),
    ],
)
def test_single_pair(speaker_lang, listener_lang, expected_session):
    speaker = _fake_participant("speaker", speaker_lang)
    listener = _fake_participant("listener", listener_lang, mic_muted=True)
    router = _router_with([speaker, listener])
    sessions = router._compute_desired_sessions()
    if expected_session:
        assert ("speaker", listener_lang) in sessions
    else:
        assert sessions == set()
