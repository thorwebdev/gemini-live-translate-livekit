"use client";

import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  ParticipantKind,
  RoomEvent,
  type RemoteParticipant,
  type RemoteTrackPublication,
  Track,
} from "livekit-client";
import { NATIVE_LANG, PARTICIPANT_LANG_ATTR } from "@/lib/config";

// Translator-track name format set by the Python agent in
// translator/src/session.py: f"tx:{speaker_identity}:{target_lang}"
const TRANSLATION_TRACK_PREFIX = "tx:";

function parseTranslationTrackName(
  name: string,
): { sourceIdentity: string; targetLang: string } | null {
  if (!name.startsWith(TRANSLATION_TRACK_PREFIX)) return null;
  const parts = name.slice(TRANSLATION_TRACK_PREFIX.length).split(":");
  if (parts.length < 2) return null;
  // Identity can theoretically contain ":"; treat the last segment as the
  // target language and join the rest back.
  const targetLang = parts.pop()!;
  const sourceIdentity = parts.join(":");
  if (!sourceIdentity || !targetLang) return null;
  return { sourceIdentity, targetLang };
}

/**
 * Subscribes/unsubscribes to audio tracks based on the listener's chosen
 * language. Encodes the routing predicate from grill Q8:
 *
 *   for each remote participant P (human or agent):
 *     - if P is human and (myLang === 'none' OR P.lang === myLang):
 *         subscribe to mic; never subscribe to a translator track for P
 *     - if P is human and P.lang !== myLang:
 *         unsubscribe from mic; the agent's translator track will cover us
 *     - if P is the agent:
 *         for each of P's audio tracks:
 *           subscribe iff target_lang === myLang AND
 *                        source_identity belongs to a peer whose lang !== myLang
 *           else unsubscribe
 */
export function useTranslationRouting(myLang: string) {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;

    const apply = () => {
      const remotes = Array.from(room.remoteParticipants.values());
      const peerLangs = new Map<string, string | undefined>();
      for (const p of remotes) {
        if (p.kind === ParticipantKind.AGENT) continue;
        peerLangs.set(p.identity, p.attributes?.[PARTICIPANT_LANG_ATTR]);
      }

      for (const p of remotes) {
        if (p.kind === ParticipantKind.AGENT) {
          applyAgentSubscriptions(p, myLang, peerLangs);
        } else {
          applyHumanSubscriptions(p, myLang);
        }
      }
    };

    apply();

    const handlers: Array<[Parameters<typeof room.on>[0], () => void]> = [
      [RoomEvent.ParticipantConnected, apply],
      [RoomEvent.ParticipantDisconnected, apply],
      [RoomEvent.ParticipantAttributesChanged, apply],
      [RoomEvent.TrackPublished, apply],
      [RoomEvent.TrackUnpublished, apply],
      [RoomEvent.LocalTrackPublished, apply],
    ];
    for (const [event, handler] of handlers) {
      room.on(event, handler);
    }
    return () => {
      for (const [event, handler] of handlers) {
        room.off(event, handler);
      }
    };
  }, [room, myLang]);
}

function applyHumanSubscriptions(p: RemoteParticipant, myLang: string) {
  const theirLang = p.attributes?.[PARTICIPANT_LANG_ATTR];
  const hearNative = myLang === NATIVE_LANG || theirLang === myLang;

  for (const pub of p.audioTrackPublications.values()) {
    if (pub.source !== Track.Source.Microphone) continue;
    setSubscribed(pub, hearNative);
  }
}

function applyAgentSubscriptions(
  agent: RemoteParticipant,
  myLang: string,
  peerLangs: Map<string, string | undefined>,
) {
  for (const pub of agent.audioTrackPublications.values()) {
    const parsed = parseTranslationTrackName(pub.trackName);
    if (!parsed) {
      // Not a translation track (e.g., agent state audio). Don't touch.
      continue;
    }

    if (myLang === NATIVE_LANG) {
      setSubscribed(pub, false);
      continue;
    }

    const matchesMe = parsed.targetLang === myLang;
    const speakerLang = peerLangs.get(parsed.sourceIdentity);
    const speakerNotMyLang = speakerLang !== myLang;

    setSubscribed(pub, matchesMe && speakerNotMyLang);
  }
}

function setSubscribed(pub: RemoteTrackPublication, desired: boolean) {
  if (pub.isSubscribed !== desired) {
    pub.setSubscribed(desired);
  }
}
