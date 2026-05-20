"use client";

import { useEffect, useRef } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Track } from "livekit-client";

export default function SelfView() {
  const { localParticipant, cameraTrack } = useLocalParticipant();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const track = cameraTrack?.track;
    if (track && !track.isMuted) {
      track.attach(video);
      return () => {
        track.detach(video);
      };
    } else {
      video.srcObject = null;
    }
  }, [cameraTrack, localParticipant]);

  const cameraOn =
    !!cameraTrack?.track &&
    cameraTrack.source === Track.Source.Camera &&
    !cameraTrack.isMuted;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        width: 180,
        aspectRatio: "16 / 9",
        background: "var(--bg-inset)",
        border: "1px solid var(--border)",
        overflow: "hidden",
        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
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
          transform: "scaleX(-1)", // mirror self-view
          display: cameraOn ? "block" : "none",
        }}
      />
      {!cameraOn && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span className="mono" style={{ color: "var(--fg-tertiary)" }}>
            you
          </span>
        </div>
      )}
    </div>
  );
}
