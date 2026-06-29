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

function splitIntoParagraphs(text: string, sentencesPerParagraph = 2): string[] {
  // A sentence ends with a punctuation mark (. ? !) followed by space or end of string.
  const sentenceRegex = /[^.!?]+[.!?]+(?:\s+|$)/g;
  const matches = text.match(sentenceRegex);

  if (!matches) {
    return [text];
  }

  const paragraphs: string[] = [];
  for (let i = 0; i < matches.length; i += sentencesPerParagraph) {
    const chunk = matches.slice(i, i + sentencesPerParagraph).join("").trim();
    if (chunk) {
      paragraphs.push(chunk);
    }
  }

  const matchedTextLength = matches.join("").length;
  if (matchedTextLength < text.length) {
    const remaining = text.slice(matchedTextLength).trim();
    if (remaining) {
      if (paragraphs.length > 0) {
        paragraphs[paragraphs.length - 1] += " " + remaining;
      } else {
        paragraphs.push(remaining);
      }
    }
  }

  return paragraphs;
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

  const [fontSize, setFontSize] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("watch_font_size");
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 12 && parsed <= 28) {
          return parsed;
        }
      }
    }
    return 16;
  });

  useEffect(() => {
    localStorage.setItem("watch_font_size", fontSize.toString());
  }, [fontSize]);

  const increaseFontSize = () => {
    setFontSize((prev) => Math.min(prev + 2, 28));
  };

  const decreaseFontSize = () => {
    setFontSize((prev) => Math.max(prev - 2, 12));
  };



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
    room.on(RoomEvent.Connected, handleUpdate);
    room.on(RoomEvent.TrackPublished, handleUpdate);
    room.on(RoomEvent.TrackUnpublished, handleUpdate);
    
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
      room.off(RoomEvent.Connected, handleUpdate);
      room.off(RoomEvent.TrackPublished, handleUpdate);
      room.off(RoomEvent.TrackUnpublished, handleUpdate);
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
        return t.participant.identity.startsWith("organizer-") && pub.isSubscribed && !pub.isMuted;
      } else {
        return (
          translatorIdentity &&
          t.participant.identity === translatorIdentity &&
          pub.isSubscribed &&
          !pub.isMuted
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

  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!room) return;

    const checkConnected = () => {
      const hasOrganizer = Array.from(room.remoteParticipants.values()).some((p) => {
        if (!p.identity.startsWith("organizer-")) return false;
        return Array.from(p.trackPublications.values()).some(
          (pub) => pub.kind === Track.Kind.Audio && !pub.isMuted
        );
      });
      setIsConnected(hasOrganizer);
    };

    checkConnected();

    room.on(RoomEvent.Connected, checkConnected);
    room.on(RoomEvent.SignalConnected, checkConnected);
    room.on(RoomEvent.ParticipantConnected, checkConnected);
    room.on(RoomEvent.ParticipantDisconnected, checkConnected);
    room.on(RoomEvent.TrackPublished, checkConnected);
    room.on(RoomEvent.TrackUnpublished, checkConnected);
    room.on(RoomEvent.TrackSubscribed, checkConnected);
    room.on(RoomEvent.TrackUnsubscribed, checkConnected);
    room.on(RoomEvent.TrackMuted, checkConnected);
    room.on(RoomEvent.TrackUnmuted, checkConnected);

    const interval = setInterval(checkConnected, 1000);

    return () => {
      room.off(RoomEvent.Connected, checkConnected);
      room.off(RoomEvent.SignalConnected, checkConnected);
      room.off(RoomEvent.ParticipantConnected, checkConnected);
      room.off(RoomEvent.ParticipantDisconnected, checkConnected);
      room.off(RoomEvent.TrackPublished, checkConnected);
      room.off(RoomEvent.TrackUnpublished, checkConnected);
      room.off(RoomEvent.TrackSubscribed, checkConnected);
      room.off(RoomEvent.TrackUnsubscribed, checkConnected);
      room.off(RoomEvent.TrackMuted, checkConnected);
      room.off(RoomEvent.TrackUnmuted, checkConnected);
      clearInterval(interval);
    };
  }, [room]);

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
          disabled={!isConnected}
        />
      </div>

      <hr className="rule" />

      {/* Transcription output */}
      <div style={{ padding: "28px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <span className="label">Transcription</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={decreaseFontSize}
              disabled={fontSize <= 12}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--fg-secondary)",
                padding: "4px 10px",
                fontSize: "12px",
                fontFamily: "var(--font-mono)",
                cursor: fontSize <= 12 ? "not-allowed" : "pointer",
                opacity: fontSize <= 12 ? 0.4 : 1,
                transition: "all 0.2s ease",
              }}
              title="Decrease font size"
            >
              A-
            </button>
            <button
              onClick={increaseFontSize}
              disabled={fontSize >= 28}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--fg-secondary)",
                padding: "4px 10px",
                fontSize: "12px",
                fontFamily: "var(--font-mono)",
                cursor: fontSize >= 28 ? "not-allowed" : "pointer",
                opacity: fontSize >= 28 ? 0.4 : 1,
                transition: "all 0.2s ease",
              }}
              title="Increase font size"
            >
              A+
            </button>
          </div>
        </div>

        <div
          style={{
            maxHeight: 320,
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
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {transcripts.map((t, i) => {
                const paragraphs = splitIntoParagraphs(t.text, 2);
                return (
                  <div key={`${t.id}-${i}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {paragraphs.map((para, paraIdx) => (
                      <p
                        key={paraIdx}
                        style={{
                          fontFamily: "var(--font-body)",
                          fontSize: `${fontSize}px`,
                          lineHeight: 1.6,
                          color: t.final ? "var(--fg)" : "var(--fg-secondary)",
                          transition: "color 0.3s ease, font-size 0.2s ease",
                        }}
                      >
                        {para}
                      </p>
                    ))}
                  </div>
                );
              })}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </div>
      </div>

      <hr className="rule" />

      <p className="body-sm" style={{ paddingTop: 28 }}>
        Translation generated by <a href="https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-live-3-5-translate/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline", color: "inherit" }}>Gemini 3.5 Live Translate</a> in real-time.
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
    const isInactiveSession = error.includes("not started yet") || error.includes("not found");
    return (
      <div className="page">
        <div className="container" style={{ textAlign: "center" }}>
          <p className="display display-md" style={{ marginBottom: 16 }}>
            {isInactiveSession ? "Broadcast Not Started" : "Something went wrong"}
          </p>
          <p className="body-sm" style={{ marginBottom: 32 }}>{error}</p>
          <button
            className="btn btn-outline"
            onClick={() => window.location.reload()}
          >
            {isInactiveSession ? "Check Again" : "Retry"}
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
