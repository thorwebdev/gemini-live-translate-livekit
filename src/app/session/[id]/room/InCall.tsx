"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useLocalParticipant,
  useRemoteParticipants,
  useRoomContext,
} from "@livekit/components-react";
import { ConnectionState, ParticipantKind, RoomEvent } from "livekit-client";
import { PARTICIPANT_LANG_ATTR } from "@/lib/config";
import { getLanguageByCode } from "@/lib/languages";
import { useTranslationRouting } from "./useTranslationRouting";
import VideoGrid from "./VideoGrid";
import SelfView from "./SelfView";
import ControlBar from "./ControlBar";
import LanguagePill from "./LanguagePill";
import CaptionsSidebar from "./CaptionsSidebar";

export default function InCall({
  initialLang,
  onLeave,
}: {
  initialLang: string;
  onLeave: () => void;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const remotes = useRemoteParticipants();
  const [lang, setLang] = useState(initialLang);
  const [captionsOpen, setCaptionsOpen] = useState(false);

  // Push the local lang into participant attributes so the agent + peers see
  // it. setAttributes is silently dropped before the room is connected, so we
  // both fire on `lang` change and re-fire when the connection becomes ready.
  useEffect(() => {
    if (!localParticipant || !room) return;
    const apply = () => {
      if (room.state === ConnectionState.Connected) {
        localParticipant.setAttributes({ [PARTICIPANT_LANG_ATTR]: lang });
      }
    };
    apply();
    room.on(RoomEvent.Connected, apply);
    return () => {
      room.off(RoomEvent.Connected, apply);
    };
  }, [room, localParticipant, lang]);

  useTranslationRouting(lang);

  const humanRemotes = useMemo(
    () => remotes.filter((p) => p.kind !== ParticipantKind.AGENT),
    [remotes],
  );
  const peerLangs = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const p of humanRemotes) {
      map.set(p.identity, p.attributes?.[PARTICIPANT_LANG_ATTR]);
    }
    return map;
  }, [humanRemotes]);

  const langInfo = getLanguageByCode(lang);
  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/session/${room.name}`
      : "";

  return (
    <div
      className={`room-shell${captionsOpen ? " room-shell--captions-open" : ""}`}
    >
      <div className="room">
        {/* Top chrome */}
        <header className="room-chrome">
          <div className="chrome-meta">
            <span>
              {humanRemotes.length + 1}{" "}
              {humanRemotes.length === 0 ? "person" : "people"}
            </span>
            <span className="divider">·</span>
            <span>
              Hearing in{" "}
              <strong style={{ color: "var(--fg)", fontWeight: 500 }}>
                {langInfo?.name ?? lang}
              </strong>
            </span>
          </div>
          <LanguagePill value={lang} onChange={setLang} />
        </header>

        {/* Stage */}
        <main className="room-stage">
          {humanRemotes.length === 0 ? (
            <EmptyStage inviteUrl={inviteUrl} />
          ) : (
            <VideoGrid participants={humanRemotes} myLang={lang} />
          )}
          <SelfView />
        </main>

        {/* Control bar */}
        <ControlBar
          onLeave={onLeave}
          inviteUrl={inviteUrl}
          captionsOpen={captionsOpen}
          onToggleCaptions={() => setCaptionsOpen((v) => !v)}
        />
      </div>

      {/* Captions — sibling column of .room so the room is pushed, not covered */}
      <CaptionsSidebar
        open={captionsOpen}
        onClose={() => setCaptionsOpen(false)}
        myLang={lang}
        peerLangs={peerLangs}
      />
    </div>
  );
}

function EmptyStage({ inviteUrl }: { inviteUrl: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignored
    }
  }

  return (
    <div className="empty-stage enter">
      <span className="empty-stage-eyebrow">You&apos;re alone in here</span>
      <h2 className="display display-lg" style={{ marginBottom: 12 }}>
        Waiting for others
      </h2>
      <p className="body">
        Share the link below. Translation spins up automatically when someone
        joins with a different language.
      </p>
      <div className="invite-card">
        <div className="invite-card-url">{inviteUrl}</div>
        <button className="invite-card-btn" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
