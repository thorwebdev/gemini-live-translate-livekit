"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track, RoomEvent } from "livekit-client";
import LanguageSelector from "./components/LanguageSelector";

interface TranscriptEntry {
  id: string;
  text: string;
  language: string;
  final: boolean;
  timestamp: number;
}

function AttendeeView({ sessionId }: { sessionId: string }) {
  const room = useRoomContext();
  const [currentLanguage, setCurrentLanguage] = useState("original");
  const [translatorIdentity, setTranslatorIdentity] = useState<string | null>(
    null
  );
  const [isReceivingAudio, setIsReceivingAudio] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const currentLanguageRef = useRef(currentLanguage);
  const audioTracks = useTracks([Track.Source.Microphone]);
  const [isOrganizerConnected, setIsOrganizerConnected] = useState(false);

  // Track organizer connection status to avoid useRemoteParticipants hook overhead
  useEffect(() => {
    if (!room) return;

    const checkOrganizer = () => {
      const present = Array.from(room.remoteParticipants.values()).some((p) =>
        p.identity.startsWith("organizer-")
      );
      setIsOrganizerConnected(present);
    };

    checkOrganizer();

    room.on(RoomEvent.ParticipantConnected, checkOrganizer);
    room.on(RoomEvent.ParticipantDisconnected, checkOrganizer);
    return () => {
      room.off(RoomEvent.ParticipantConnected, checkOrganizer);
      room.off(RoomEvent.ParticipantDisconnected, checkOrganizer);
    };
  }, [room]);

  const [isWakeLockActive, setIsWakeLockActive] = useState(false);

  // Manage Screen Wake Lock to prevent the phone/device from sleeping
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



  // Listen for transcription data from translator bots
  useEffect(() => {
    if (!room) return;

    const handleData = (
      payload: Uint8Array,
      participant: unknown,
      kind: unknown,
      topic: string | undefined,
    ) => {
      // Only handle transcription topic
      if (topic !== "transcription") return;

      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type !== "transcription") return;

        // Only show transcriptions for the currently selected language
        if (data.language !== currentLanguageRef.current) return;

        setTranscripts((prev) => {
          const existing = prev.findIndex((t) => t.id === data.segmentId);
          const entry: TranscriptEntry = {
            id: data.segmentId,
            text: data.text,
            language: data.language,
            final: data.final,
            timestamp: data.timestamp,
          };

          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = {
              ...updated[existing],
              text: updated[existing].text + data.text,
              final: data.final,
            };
            return updated;
          }

          const next = [...prev, entry];
          return next.slice(-50);
        });
      } catch {
        // Not a JSON transcription message
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  // Manage which audio tracks are subscribed based on selected language
  // autoSubscribe: false means nothing plays by default
  // We explicitly subscribe only to the selected language's track
  useEffect(() => {
    if (!room) return;

    const updateSubscriptions = () => {
      for (const [, participant] of room.remoteParticipants) {
        const isOrganizer = participant.identity.startsWith("organizer-");
        const isSelectedTranslator =
          translatorIdentity && participant.identity === translatorIdentity;

        for (const [, pub] of participant.trackPublications) {
          if (pub.kind === Track.Kind.Audio) {
            if (currentLanguage === "original") {
              pub.setSubscribed(isOrganizer);
            } else {
              pub.setSubscribed(!!isSelectedTranslator);
            }
          }
        }
      }
    };

    updateSubscriptions();

    const handleUpdate = () => updateSubscriptions();
    room.on(RoomEvent.TrackPublished, handleUpdate);
    
    // Only run update if the participant that joined is the organizer or our translator bot
    const handleParticipantConnected = (participant: any) => {
      const isOrganizer = participant.identity.startsWith("organizer-");
      const isSelectedTranslator =
        translatorIdentity && participant.identity === translatorIdentity;
      if (isOrganizer || isSelectedTranslator) {
        updateSubscriptions();
      }
    };

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);

    return () => {
      room.off(RoomEvent.TrackPublished, handleUpdate);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
    };
  }, [room, currentLanguage, translatorIdentity]);
 
  // Update local participant attribute when language changes
  useEffect(() => {
    if (!room) return;
    
    const setLanguageAttr = () => {
      if (room.localParticipant) {
        room.localParticipant.setAttributes({ language: currentLanguage })
          .catch((err) => console.error("Failed to set participant attributes:", err));
      }
    };

    setLanguageAttr();
    
    room.on(RoomEvent.Connected, setLanguageAttr);
    return () => {
      room.off(RoomEvent.Connected, setLanguageAttr);
    };
  }, [room, currentLanguage]);

  useEffect(() => {
    const hasAudio = audioTracks.some((t) => {
      const pub = t.publication;
      if (currentLanguage === "original") {
        return t.participant.identity.startsWith("organizer-") && pub.isSubscribed;
      } else {
        return (
          translatorIdentity &&
          t.participant.identity === translatorIdentity &&
          pub.isSubscribed
        );
      }
    });
    setIsReceivingAudio(hasAudio);
  }, [audioTracks, currentLanguage, translatorIdentity]);

  // Unsubscribe from translation when tab closes
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable fire-and-forget during page unload
      if (currentLanguageRef.current && currentLanguageRef.current !== "original") {
        const body = JSON.stringify({
          sessionId,
          targetLanguage: currentLanguageRef.current,
        });
        navigator.sendBeacon(
          "/api/translate/unsubscribe",
          new Blob([body], { type: "application/json" })
        );
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // Also fire on React unmount (e.g. navigation away)
      handleBeforeUnload();
    };
  }, [sessionId]);

  const handleLanguageChange = useCallback(
    (langCode: string, newTranslatorIdentity: string | null) => {
      // Unsubscribe from the previous language
      const prev = currentLanguageRef.current;
      if (prev && prev !== "original" && prev !== langCode) {
        fetch("/api/translate/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, targetLanguage: prev }),
        }).catch(() => {});
      }

      setCurrentLanguage(langCode);
      currentLanguageRef.current = langCode;
      setTranslatorIdentity(newTranslatorIdentity);
      // Clear transcripts when switching languages
      setTranscripts([]);
    },
    [sessionId]
  );

  const isConnected = isOrganizerConnected;

  return (
    <div className="container enter">
      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <h1 className="display display-lg" style={{ marginBottom: 8 }}>
          <em>Listening</em>
        </h1>
        <p className="mono">{sessionId}</p>
      </div>

      {/* Status */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className={`waveform ${isReceivingAudio ? "active" : "idle"}`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="waveform-bar" />
              ))}
            </div>

            {isConnected ? (
              <span className="status status--active">
                <span className="status-dot pulse" />
                {currentLanguage === "original"
                  ? "Original"
                  : currentLanguage.toUpperCase()}
              </span>
            ) : (
              <span className="status status--waiting">
                <span className="status-dot pulse" />
                Waiting for broadcast
              </span>
            )}

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
        </div>
      </div>

      <hr className="rule" />

      {/* Language selector */}
      <div style={{ padding: "28px 0" }}>
        <LanguageSelector
          sessionId={sessionId}
          currentLanguage={currentLanguage}
          onLanguageChange={handleLanguageChange}
        />
      </div>

      <hr className="rule" />

      {/* Transcription output */}
      <div style={{ padding: "28px 0" }}>
        <span className="label" style={{ display: "block", marginBottom: 16 }}>
          Transcription
        </span>

        <div
          style={{
            maxHeight: 240,
            overflowY: "auto",
            paddingRight: 8,
          }}
        >
          {transcripts.length === 0 ? (
            <p className="body-sm italic">
              {currentLanguage === "original"
                ? "Select a language to see transcription"
                : "Waiting for translated speech…"}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {transcripts.map((t, i) => (
                <p
                  key={`${t.id}-${i}`}
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: t.final ? "var(--fg)" : "var(--fg-tertiary)",
                    transition: "color 0.3s ease",
                  }}
                >
                  {t.text}
                </p>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </div>
      </div>

      <hr className="rule" />

      {/* Info */}
      <p className="body-sm" style={{ paddingTop: 28 }}>
        Each language activates a dedicated Gemini Live API session
        for real-time translation.
      </p>
    </div>
  );
}


export default function WatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);
  const [token, setToken] = useState("");
  const [livekitUrl, setLivekitUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    async function fetchToken() {
      try {
        const identity = `attendee-${Math.random().toString(36).slice(2, 8)}`;
        const res = await fetch(
          `/api/token?room=${sessionId}&identity=${identity}&role=attendee`
        );
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setToken(data.token);
        setLivekitUrl(data.serverUrl);
      } catch (err) {
        setError((err as Error).message);
      }
    }
    fetchToken();
  }, [sessionId]);

  if (error) {
    return (
      <div className="page">
        <div className="container" style={{ textAlign: "center" }}>
          <p className="display display-md" style={{ marginBottom: 16 }}>
            Something went wrong
          </p>
          <p className="body-sm" style={{ marginBottom: 32 }}>{error}</p>
          <button
            className="btn btn-outline"
            onClick={() => window.location.reload()}
          >
            Retry
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
          <p className="mono">Joining…</p>
        </div>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="page">
        <div className="container enter" style={{ textAlign: "center" }}>
          <h1 className="display display-lg" style={{ marginBottom: 12 }}>
            <em>Ready</em>
          </h1>
          <p className="body-sm" style={{ marginBottom: 40 }}>
            Tap below to join the broadcast and enable audio.
          </p>
          <button
            className="btn"
            onClick={() => setStarted(true)}
          >
            Start listening
          </button>
          <p className="mono" style={{ marginTop: 32, fontSize: 12 }}>
            Session {sessionId}
          </p>
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
        connectOptions={{ autoSubscribe: false }}
        options={{ disconnectOnPageLeave: false }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
        }}
      >
        <RoomAudioRenderer />
        <AttendeeView sessionId={sessionId} />
      </LiveKitRoom>
    </div>
  );
}
