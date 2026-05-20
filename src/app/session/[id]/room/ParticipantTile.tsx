"use client";

import { useEffect, useRef } from "react";
import {
  useIsSpeaking,
  useParticipantAttributes,
} from "@livekit/components-react";
import { Track, type RemoteParticipant } from "livekit-client";
import { PARTICIPANT_LANG_ATTR } from "@/lib/config";
import { getLanguageByCode } from "@/lib/languages";

export default function ParticipantTile({
  participant,
}: {
  participant: RemoteParticipant;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isSpeaking = useIsSpeaking(participant);
  const { attributes } = useParticipantAttributes({ participant });
  const lang = attributes?.[PARTICIPANT_LANG_ATTR];
  const langInfo = lang ? getLanguageByCode(lang) : undefined;

  // Attach the camera track to a <video> manually. (We avoid the prebuilt
  // ParticipantTile because it pulls audio routing we don't want.)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const attach = () => {
      for (const pub of participant.videoTrackPublications.values()) {
        if (pub.source === Track.Source.Camera && pub.track) {
          pub.track.attach(video);
          return;
        }
      }
      video.srcObject = null;
    };

    const detach = () => {
      for (const pub of participant.videoTrackPublications.values()) {
        if (pub.source === Track.Source.Camera && pub.track) {
          pub.track.detach(video);
        }
      }
    };

    attach();
    participant.on("trackSubscribed", attach);
    participant.on("trackUnsubscribed", attach);
    participant.on("trackPublished", attach);
    participant.on("trackUnpublished", attach);
    return () => {
      detach();
      participant.off("trackSubscribed", attach);
      participant.off("trackUnsubscribed", attach);
      participant.off("trackPublished", attach);
      participant.off("trackUnpublished", attach);
    };
  }, [participant]);

  const hasCamera = Array.from(
    participant.videoTrackPublications.values(),
  ).some((pub) => pub.source === Track.Source.Camera && pub.track?.isMuted === false);

  return (
    <div
      style={{
        position: "relative",
        background: "var(--bg-inset)",
        border: `1px solid ${isSpeaking ? "var(--accent)" : "var(--border)"}`,
        overflow: "hidden",
        aspectRatio: "16 / 9",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: hasCamera ? "block" : "none",
        }}
      />
      {!hasCamera && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span className="display display-md" style={{ color: "var(--fg-tertiary)" }}>
            {(participant.name || participant.identity).slice(0, 1).toUpperCase()}
          </span>
        </div>
      )}

      {/* Bottom-left: name + language badge */}
      <div
        style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          background: "rgba(26, 25, 23, 0.78)",
          color: "var(--bg)",
          padding: "6px 10px",
          fontSize: 12,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span>{participant.name || participant.identity}</span>
        {langInfo && (
          <span title={langInfo.name} style={{ opacity: 0.85 }}>
            {langInfo.flag} {langInfo.code.toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}
