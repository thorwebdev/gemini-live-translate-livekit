/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use client";

import { useEffect, useState, useCallback, use, useRef, FormEvent } from "react";
import {
  LiveKitRoom,
  useLocalParticipant,
  useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track, RoomEvent } from "livekit-client";
import SessionQRCode from "@/components/SessionQRCode";
import { getLanguageByCode } from "@/lib/languages";

interface TranslationInfo {
  language: string;
  translatorIdentity: string;
  status: string;
  subscriberCount: number;
}

function BroadcastControls({
  sessionId,
  onEndBroadcast,
}: {
  sessionId: string;
  onEndBroadcast: () => void;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [translations, setTranslations] = useState<TranslationInfo[]>([]);
  const [listenerCount, setListenerCount] = useState(0);

  // Track active attendees count without useRemoteParticipants hook overhead
  useEffect(() => {
    if (!room) return;

    const updateCount = () => {
      const count = Array.from(room.remoteParticipants.values()).filter(
        (p) => !p.identity.startsWith("translator-")
      ).length;
      setListenerCount(count);
    };

    updateCount();

    room.on(RoomEvent.ParticipantConnected, updateCount);
    room.on(RoomEvent.ParticipantDisconnected, updateCount);
    return () => {
      room.off(RoomEvent.ParticipantConnected, updateCount);
      room.off(RoomEvent.ParticipantDisconnected, updateCount);
    };
  }, [room]);

  // Custom audio mixer states
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isTabAudioEnabled, setIsTabAudioEnabled] = useState(false);
  const [micVolume, setMicVolume] = useState(100);
  const [tabVolume, setTabVolume] = useState(100);
  const [isWakeLockActive, setIsWakeLockActive] = useState(false);

  // Manage Screen Wake Lock to prevent the phone/device from sleeping during broadcast
  useEffect(() => {
    if (typeof window === "undefined" || !("wakeLock" in navigator)) {
      return;
    }

    let wakeLock: any = null;

    async function requestWakeLock() {
      try {
        wakeLock = await (navigator as any).wakeLock.request("screen");
        setIsWakeLockActive(true);
        
        wakeLock.addEventListener("release", () => {
          setIsWakeLockActive(false);
        });
      } catch (err) {
        console.error("Failed to acquire Screen Wake Lock:", err);
      }
    }

    requestWakeLock();

    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && !wakeLock) {
        await requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLock) {
        wakeLock.release().catch((err: any) => {
          console.error("Failed to release Screen Wake Lock:", err);
        });
      }
    };
  }, []);

  // References to keep Web Audio API elements alive
  const audioContextRef = useRef<AudioContext | null>(null);
  const destinationNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null);
  const tabStreamRef = useRef<MediaStream | null>(null);
  const tabSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const tabGainNodeRef = useRef<GainNode | null>(null);
  const publishedTrackPubRef = useRef<any>(null);



  const joinUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/session/${sessionId}/watch`
      : "";

  const fetchTranslations = useCallback(async () => {
    try {
      const res = await fetch(`/api/translate/status?sessionId=${sessionId}`);
      const data = await res.json();
      setTranslations(data.translations || []);
    } catch (err) {
      console.error("Failed to fetch translations:", err);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchTranslations();
    const interval = setInterval(fetchTranslations, 3000);
    return () => clearInterval(interval);
  }, [fetchTranslations]);

  // Main AudioContext and track publishing lifecycle
  useEffect(() => {
    if (!room || !room.localParticipant) return;

    let active = true;
    let localPub: any = null;

    async function initAudio() {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        audioContextRef.current = ctx;

        const dest = ctx.createMediaStreamDestination();
        destinationNodeRef.current = dest;

        const mixedTrack = dest.stream.getAudioTracks()[0];

        if (active && room.localParticipant) {
          const pub = await room.localParticipant.publishTrack(mixedTrack, {
            name: "broadcast-audio",
            source: Track.Source.Microphone,
          });
          publishedTrackPubRef.current = pub;
          localPub = pub;
          await pub.mute();
          console.log("Published and initially muted mixed audio track:", pub.trackSid);
        }
      } catch (err) {
        console.error("Failed to initialize client audio mixer:", err);
      }
    }

    initAudio();

    return () => {
      active = false;
      if (localPub && room.localParticipant) {
        room.localParticipant.unpublishTrack(localPub.track).catch((err) => {
          console.error("Failed to unpublish mixed track:", err);
        });
      }
      
      // Stop all streams and close AudioContext
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
      }
      if (micSourceNodeRef.current) {
        micSourceNodeRef.current.disconnect();
        micSourceNodeRef.current = null;
      }
      if (micGainNodeRef.current) {
        micGainNodeRef.current.disconnect();
        micGainNodeRef.current = null;
      }
      if (tabStreamRef.current) {
        tabStreamRef.current.getTracks().forEach((track) => track.stop());
        tabStreamRef.current = null;
      }
      if (tabSourceNodeRef.current) {
        tabSourceNodeRef.current.disconnect();
        tabSourceNodeRef.current = null;
      }
      if (tabGainNodeRef.current) {
        tabGainNodeRef.current.disconnect();
        tabGainNodeRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      destinationNodeRef.current = null;
      publishedTrackPubRef.current = null;
    };
  }, [room, room?.localParticipant]);

  // Synchronize muted status of the published track with active inputs
  useEffect(() => {
    const pub = publishedTrackPubRef.current;
    if (!pub) return;

    const hasActiveInput = isMicEnabled || isTabAudioEnabled;
    if (hasActiveInput) {
      pub.unmute()
        .then(() => console.log("[BroadcastControls] Unmuted broadcast-audio track"))
        .catch((err: any) => console.error("Failed to unmute track:", err));
    } else {
      pub.mute()
        .then(() => console.log("[BroadcastControls] Muted broadcast-audio track"))
        .catch((err: any) => console.error("Failed to mute track:", err));
    }
  }, [isMicEnabled, isTabAudioEnabled]);

  const toggleMicrophone = async () => {
    const ctx = audioContextRef.current;
    const dest = destinationNodeRef.current;
    if (!ctx || !dest) return;

    if (isMicEnabled) {
      if (micSourceNodeRef.current) {
        micSourceNodeRef.current.disconnect();
        micSourceNodeRef.current = null;
      }
      if (micGainNodeRef.current) {
        micGainNodeRef.current.disconnect();
        micGainNodeRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
      }
      setIsMicEnabled(false);
    } else {
      try {
        await ctx.resume();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;

        const source = ctx.createMediaStreamSource(stream);
        micSourceNodeRef.current = source;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(micVolume / 100, ctx.currentTime);
        micGainNodeRef.current = gainNode;

        source.connect(gainNode);
        gainNode.connect(dest);

        setIsMicEnabled(true);
      } catch (err) {
        console.error("Failed to access microphone:", err);
        alert("Could not access microphone: " + (err as Error).message);
      }
    }
  };

  const toggleTabAudio = async () => {
    const ctx = audioContextRef.current;
    const dest = destinationNodeRef.current;
    if (!ctx || !dest) return;

    if (isTabAudioEnabled) {
      if (tabSourceNodeRef.current) {
        tabSourceNodeRef.current.disconnect();
        tabSourceNodeRef.current = null;
      }
      if (tabGainNodeRef.current) {
        tabGainNodeRef.current.disconnect();
        tabGainNodeRef.current = null;
      }
      if (tabStreamRef.current) {
        tabStreamRef.current.getTracks().forEach((track) => track.stop());
        tabStreamRef.current = null;
      }
      setIsTabAudioEnabled(false);
    } else {
      try {
        await ctx.resume();
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: "browser" },
          audio: true,
        });

        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
          stream.getTracks().forEach((track) => track.stop());
          alert("No audio track selected. Make sure to check the 'Share tab audio' checkbox in the system sharing prompt.");
          return;
        }

        tabStreamRef.current = stream;

        const source = ctx.createMediaStreamSource(stream);
        tabSourceNodeRef.current = source;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(tabVolume / 100, ctx.currentTime);
        tabGainNodeRef.current = gainNode;

        source.connect(gainNode);
        gainNode.connect(dest);

        setIsTabAudioEnabled(true);

        const handleTrackEnded = () => {
          if (tabSourceNodeRef.current) {
            tabSourceNodeRef.current.disconnect();
            tabSourceNodeRef.current = null;
          }
          if (tabGainNodeRef.current) {
            tabGainNodeRef.current.disconnect();
            tabGainNodeRef.current = null;
          }
          stream.getTracks().forEach((track) => track.stop());
          tabStreamRef.current = null;
          setIsTabAudioEnabled(false);
        };

        audioTracks[0].onended = handleTrackEnded;
        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length > 0) {
          videoTracks[0].onended = handleTrackEnded;
        }
      } catch (err) {
        console.error("Failed to capture tab audio:", err);
        if ((err as Error).name !== "NotAllowedError") {
          alert("Could not capture tab audio: " + (err as Error).message);
        }
      }
    }
  };

  const handleMicVolumeChange = (vol: number) => {
    setMicVolume(vol);
    if (micGainNodeRef.current && audioContextRef.current) {
      micGainNodeRef.current.gain.setValueAtTime(vol / 100, audioContextRef.current.currentTime);
    }
  };

  const handleTabVolumeChange = (vol: number) => {
    setTabVolume(vol);
    if (tabGainNodeRef.current && audioContextRef.current) {
      tabGainNodeRef.current.gain.setValueAtTime(vol / 100, audioContextRef.current.currentTime);
    }
  };

  const isAudioActive = isMicEnabled || isTabAudioEnabled;
  let statusText = "Muted";
  if (isMicEnabled && isTabAudioEnabled) {
    statusText = "Live (Mic + Tab)";
  } else if (isMicEnabled) {
    statusText = "Live (Mic)";
  } else if (isTabAudioEnabled) {
    statusText = "Live (Tab)";
  }

  return (
    <div className="container enter">
      {/* Header */}
      <div style={{ marginBottom: 48 }}>
        <h1 className="display display-lg" style={{ marginBottom: 8 }}>
          Broadcasting
        </h1>
        <p className="mono">{sessionId}</p>
      </div>

      {/* Audio Inputs */}
      <div style={{ marginBottom: 40 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className={`waveform ${isAudioActive ? "active" : "idle"}`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="waveform-bar" />
              ))}
            </div>
            <span
              className="status"
              style={{ color: isAudioActive ? "var(--success)" : "var(--fg-ghost)" }}
            >
              <span className={`status-dot ${isAudioActive ? "pulse" : ""}`} />
              {statusText}
            </span>

            {isWakeLockActive && (
              <span
                className="status status--active"
                style={{
                  marginLeft: 12,
                  padding: "4px 8px",
                  background: "var(--success-soft)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  fontSize: "11px",
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginRight: 4, verticalAlign: "middle" }}
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Screen Awake
              </span>
            )}
          </div>

          <span className="mono">
            {listenerCount} listener{listenerCount !== 1 ? "s" : ""}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Microphone Box */}
          <div
            style={{
              padding: "16px",
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 500, fontSize: "14px" }}>Microphone</span>
              <button
                onClick={toggleMicrophone}
                className="btn"
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  border: isMicEnabled ? "1px solid var(--error)" : "none",
                  background: isMicEnabled ? "transparent" : "var(--fg)",
                  color: isMicEnabled ? "var(--error)" : "var(--bg)",
                  cursor: "pointer",
                }}
              >
                {isMicEnabled ? "Disable" : "Enable"}
              </button>
            </div>
            {isMicEnabled && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="mono" style={{ width: "32px", fontSize: "11px" }}>Vol</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={micVolume}
                  onChange={(e) => handleMicVolumeChange(Number(e.target.value))}
                  style={{ flexGrow: 1, accentColor: "var(--fg)", cursor: "pointer" }}
                />
                <span className="mono" style={{ width: "40px", textAlign: "right", fontSize: "11px" }}>
                  {micVolume}%
                </span>
              </div>
            )}
          </div>

          {/* Browser Tab Audio Box */}
          <div
            style={{
              padding: "16px",
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 500, fontSize: "14px" }}>Browser Tab Audio</span>
              <button
                onClick={toggleTabAudio}
                className="btn"
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  border: isTabAudioEnabled ? "1px solid var(--error)" : "none",
                  background: isTabAudioEnabled ? "transparent" : "var(--fg)",
                  color: isTabAudioEnabled ? "var(--error)" : "var(--bg)",
                  cursor: "pointer",
                }}
              >
                {isTabAudioEnabled ? "Stop Sharing" : "Share Tab"}
              </button>
            </div>
            {isTabAudioEnabled && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="mono" style={{ width: "32px", fontSize: "11px" }}>Vol</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={tabVolume}
                  onChange={(e) => handleTabVolumeChange(Number(e.target.value))}
                  style={{ flexGrow: 1, accentColor: "var(--fg)", cursor: "pointer" }}
                />
                <span className="mono" style={{ width: "40px", textAlign: "right", fontSize: "11px" }}>
                  {tabVolume}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <hr className="rule" />

      {/* QR code */}
      <div
        style={{
          padding: "32px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <span className="label">Share with attendees</span>
        <SessionQRCode url={joinUrl} size={140} />
        <p className="mono" style={{ wordBreak: "break-all", textAlign: "center" }}>
          {joinUrl}
        </p>
      </div>

      <hr className="rule" />

      {/* Active translations */}
      <div style={{ padding: "28px 0" }}>
        <span className="label" style={{ marginBottom: 16, display: "block" }}>
          Translations · {translations.length}
        </span>

        {translations.length === 0 ? (
          <p className="body-sm italic">
            None yet — attendees can request them
          </p>
        ) : (
          translations.map((t) => {
            const lang = getLanguageByCode(t.language);
            return (
              <div key={t.language} className="lang-row">
                <div className="lang-row-left">
                  <span className="lang-flag">{lang?.flag || "🌐"}</span>
                  <span className="lang-name">
                    {lang?.name || t.language.toUpperCase()}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="lang-meta">
                    {t.subscriberCount} listener{t.subscriberCount !== 1 ? "s" : ""}
                  </span>
                  <span className={`status status--${t.status === "active" ? "active" : "waiting"}`}>
                    <span className="status-dot pulse" />
                    {t.status}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <hr className="rule" />

      {/* End */}
      <div style={{ paddingTop: 28 }}>
        <button
          className="btn-danger"
          onClick={async () => {
            onEndBroadcast();
            try {
              // Explicitly notify server that broadcast is ended to stop all translator bots
              await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
            } catch (err) {
              console.error("Failed to explicitly delete session on broadcast end:", err);
            }
            room.disconnect();
            window.location.href = "/";
          }}
          style={{ width: "100%" }}
        >
          End broadcast
        </button>
      </div>
    </div>
  );
}

export default function BroadcastPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);
  const [token, setToken] = useState("");
  const [livekitUrl, setLivekitUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [passwordPromptRequired, setPasswordPromptRequired] = useState(false);
  const [localPassword, setLocalPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const isEndingRef = useRef(false);

  const handleEndBroadcast = useCallback(() => {
    isEndingRef.current = true;
  }, []);

  const fetchToken = useCallback(async (pass: string) => {
    try {
      const identity = `organizer-host`;
      const url = `/api/token?room=${sessionId}&identity=${identity}&role=organizer${pass ? `&password=${encodeURIComponent(pass)}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      
      if (res.status === 401) {
        setPasswordPromptRequired(true);
        return false;
      }
      
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to fetch token");
      }
      
      if (pass) {
        sessionStorage.setItem("broadcast_password", pass);
      }
      setToken(data.token);
      setLivekitUrl(data.serverUrl);
      setPasswordPromptRequired(false);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, [sessionId]);

  useEffect(() => {
    const cachedPass = sessionStorage.getItem("broadcast_password") || "";
    fetchToken(cachedPass);
  }, [fetchToken]);

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    setPasswordError(null);
    const success = await fetchToken(localPassword);
    setVerifying(false);
    if (!success && !error) {
      setPasswordError("Incorrect password");
    }
  };

  if (passwordPromptRequired) {
    return (
      <div className="page enter">
        <div className="container" style={{ textAlign: "center" }}>
          <h1 className="display display-md" style={{ marginBottom: 12 }}>
            <em>Password</em> Required
          </h1>
          <p className="body-sm" style={{ marginBottom: 32 }}>
            This broadcast session is password-protected.
          </p>
          <form onSubmit={handlePasswordSubmit}>
            <div style={{ marginBottom: 20 }}>
              <input
                type="password"
                className="input-field"
                placeholder="Enter password"
                value={localPassword}
                onChange={(e) => setLocalPassword(e.target.value)}
                style={{ textAlign: "center" }}
                disabled={verifying}
                required
              />
            </div>
            {passwordError && (
              <p className="body-sm" style={{ color: "var(--error)", marginBottom: 20 }}>
                {passwordError}
              </p>
            )}
            <button
              type="submit"
              className="btn btn-dark"
              style={{ width: "100%" }}
              disabled={verifying}
            >
              {verifying ? "Verifying…" : "Submit"}
            </button>
          </form>
          <button
            className="btn btn-ghost"
            onClick={() => (window.location.href = "/")}
            style={{ marginTop: 16 }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="container" style={{ textAlign: "center" }}>
          <p className="display display-md" style={{ marginBottom: 16 }}>
            Something went wrong
          </p>
          <p className="body-sm" style={{ marginBottom: 32 }}>{error}</p>
          <button className="btn btn-outline" onClick={() => (window.location.href = "/")}>
            Go home
          </button>
        </div>
      </div>
    );
  }

  if (!token || !livekitUrl) {
    return (
      <div className="page">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="page page-top">
      <LiveKitRoom
        video={false}
        audio={false}
        token={token}
        serverUrl={livekitUrl}
        options={{ disconnectOnPageLeave: false }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
        }}
        onDisconnected={() => {
          if (!isEndingRef.current) {
            setError("Disconnected from LiveKit room. Please check your credentials or network connection.");
          }
        }}
      >
        <BroadcastControls sessionId={sessionId} onEndBroadcast={handleEndBroadcast} />
      </LiveKitRoom>
    </div>
  );
}
