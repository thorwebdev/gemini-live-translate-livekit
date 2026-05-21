"use client";

import { useEffect, useRef, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Track } from "livekit-client";

export default function SelfView() {
  const { localParticipant, cameraTrack } = useLocalParticipant();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraOn, setCameraOn] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const track = cameraTrack?.track;
    const on =
      !!track &&
      cameraTrack?.source === Track.Source.Camera &&
      !cameraTrack.isMuted;
    if (on && track) {
      track.attach(video);
      setCameraOn(true);
      return () => {
        track.detach(video);
      };
    }
    video.srcObject = null;
    setCameraOn(false);
  }, [cameraTrack, localParticipant]);

  const displayName = localParticipant?.name || "you";

  return (
    <div className="self-view">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="self-view-video"
        style={{ display: cameraOn ? "block" : "none" }}
      />
      {!cameraOn && (
        <div className="self-view-empty">
          <span>{displayName}</span>
        </div>
      )}
    </div>
  );
}
