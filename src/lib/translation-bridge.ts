/**
 * TranslationBridge: Connects a LiveKit room to a Gemini Live API WebSocket
 * for real-time audio translation.
 *
 * Each bridge instance:
 * 1. Joins the LiveKit room as a bot participant (e.g., "translator-es")
 * 2. Subscribes to the organizer's audio track
 * 3. Pipes PCM audio frames to Gemini Live API via WebSocket
 * 4. Receives translated audio back and publishes it as a new track
 */

import {
  Room,
  RoomEvent,
  LocalAudioTrack,
  AudioSource,
  AudioFrame,
  TrackPublishOptions,
  TrackSource,
  RemoteTrackPublication,
  RemoteParticipant,
  RemoteAudioTrack,
  TrackKind,
  AudioStream,
} from "@livekit/rtc-node";
import WebSocket from "ws";

export type BridgeStatus = "starting" | "active" | "error" | "closed";

export class TranslationBridge {
  private room: Room | null = null;
  private geminiWs: WebSocket | null = null;
  private audioSource: AudioSource | null = null;
  private localTrack: LocalAudioTrack | null = null;
  private publishedTrackSid: string = "";
  private transcriptionSegmentId: number = 0;
  private framesSentToGemini: number = 0;
  private framesReceivedFromGemini: number = 0;
  private resumptionHandle: string | null = null;
  private isReconnecting: boolean = false;

  public readonly targetLanguage: string;
  public readonly sessionId: string;
  public readonly identity: string;
  public status: BridgeStatus = "starting";
  public subscriberCount: number = 0;
  public onStop?: () => void;

  // Gemini Live API config
  private readonly geminiApiKey: string;
  private readonly geminiModel: string = "gemini-3.1-flash-lite-live-translate";
  private readonly sampleRate: number = 24000; // Gemini outputs 24kHz
  private readonly inputSampleRate: number = 48000; // LiveKit default
  private readonly channels: number = 1;

  // LiveKit config
  private readonly livekitUrl: string;
  private readonly livekitApiKey: string;
  private readonly livekitApiSecret: string;

  private geminiSetupComplete: boolean = false;
  private organizerIdentity: string;
  private lastAudioFrameTime: number = 0;
  private captureChain: Promise<void> = Promise.resolve();

  constructor(
    sessionId: string,
    targetLanguage: string,
    organizerIdentity: string,
    config: {
      geminiApiKey: string;
      livekitUrl: string;
      livekitApiKey: string;
      livekitApiSecret: string;
    }
  ) {
    this.sessionId = sessionId;
    this.targetLanguage = targetLanguage;
    this.organizerIdentity = organizerIdentity;
    this.identity = `translator-${targetLanguage}`;
    this.geminiApiKey = config.geminiApiKey;
    this.livekitUrl = config.livekitUrl;
    this.livekitApiKey = config.livekitApiKey;
    this.livekitApiSecret = config.livekitApiSecret;
  }

  async start(): Promise<void> {
    console.log(
      `[TranslationBridge:${this.targetLanguage}] Starting bridge for session ${this.sessionId}`
    );

    try {
      // 1. Generate token and join LiveKit room
      await this.joinLiveKitRoom();

      // 2. Connect to Gemini Live API
      await this.connectGemini();

      // 3. Subscribe to organizer's audio and wire up the pipeline
      await this.subscribeToOrganizer();

      this.status = "active";
      console.log(
        `[TranslationBridge:${this.targetLanguage}] Bridge is active`
      );
    } catch (error) {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] Failed to start:`,
        error
      );
      this.status = "error";
      throw error;
    }
  }

  async stop(): Promise<void> {
    console.log(
      `[TranslationBridge:${this.targetLanguage}] Stopping bridge`
    );
    this.status = "closed";

    if (this.geminiWs) {
      this.geminiWs.close();
      this.geminiWs = null;
    }

    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }

    this.audioSource = null;
    this.localTrack = null;
    this.geminiSetupComplete = false;

    if (this.onStop) {
      this.onStop();
    }
  }

  private async joinLiveKitRoom(): Promise<void> {
    // Generate a token for the bot participant using the server SDK
    const { AccessToken } = await import("livekit-server-sdk");

    const at = new AccessToken(this.livekitApiKey, this.livekitApiSecret, {
      identity: this.identity,
      name: `Translator (${this.targetLanguage.toUpperCase()})`,
    });

    at.addGrant({
      roomJoin: true,
      room: this.sessionId,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    // Create and connect to the room
    this.room = new Room();

    this.room.on(RoomEvent.Disconnected, () => {
      console.log(
        `[TranslationBridge:${this.targetLanguage}] Disconnected from room`
      );
      this.status = "closed";
    });

    this.room.on(
      RoomEvent.ParticipantDisconnected,
      (participant: RemoteParticipant) => {
        if (participant.identity === this.organizerIdentity) {
          console.log(
            `[TranslationBridge:${this.targetLanguage}] Organizer ${this.organizerIdentity} disconnected, stopping bridge`
          );
          this.stop().catch((err) => {
            console.error(
              `[TranslationBridge:${this.targetLanguage}] Error stopping bridge after organizer disconnect:`,
              err
            );
          });
        }
      }
    );

    await this.room.connect(this.livekitUrl, token, {
      autoSubscribe: false,
      dynacast: false,
    });

    console.log(
      `[TranslationBridge:${this.targetLanguage}] Joined room as ${this.identity}`
    );

    // Create an AudioSource to publish translated audio
    // Gemini outputs 24kHz mono PCM
    this.audioSource = new AudioSource(this.sampleRate, this.channels);
    this.localTrack = LocalAudioTrack.createAudioTrack(
      `translated-audio-${this.targetLanguage}`,
      this.audioSource
    );

    const publishOptions = new TrackPublishOptions();
    publishOptions.source = TrackSource.SOURCE_MICROPHONE;

    await this.room.localParticipant!.publishTrack(
      this.localTrack,
      publishOptions
    );

    // Save published track SID for transcription
    const pubs = this.room.localParticipant!.trackPublications;
    for (const [, pub] of pubs) {
      if (pub.track === this.localTrack) {
        this.publishedTrackSid = pub.sid || "";
        break;
      }
    }

    console.log(
      `[TranslationBridge:${this.targetLanguage}] Published translated audio track (sid: ${this.publishedTrackSid || 'pending'})`
    );
  }

  private async connectGemini(): Promise<void> {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.geminiApiKey}`;

    return new Promise<void>((resolve, reject) => {
      this.geminiWs = new WebSocket(wsUrl);

      this.geminiWs.on("open", () => {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Gemini WebSocket connected`
        );
        this.sendGeminiSetup();
      });

      this.geminiWs.on("message", (data: WebSocket.Data) => {
        this.handleGeminiMessage(data);
        if (!this.geminiSetupComplete) {
          // Wait for setup complete message
          // resolve will be called in handleGeminiMessage
        }
      });

      this.geminiWs.on("error", (error) => {
        console.error(
          `[TranslationBridge:${this.targetLanguage}] Gemini WebSocket error:`,
          error
        );
        if (!this.geminiSetupComplete) {
          reject(error);
        }
      });

      this.geminiWs.on("close", (code: number, reason: Buffer) => {
        const reasonStr = reason.toString();
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Gemini WebSocket closed`,
          { code, reason: reasonStr }
        );
        if (!this.geminiSetupComplete) {
          reject(new Error(`Gemini WebSocket closed before setup: code=${code} reason=${reasonStr}`));
        } else if (this.status === "active") {
          // Auto-reconnect on GoAway or unexpected closure
          console.log(
            `[TranslationBridge:${this.targetLanguage}] Reconnecting Gemini WebSocket...`
          );
          this.geminiSetupComplete = false;
          this.reconnectGemini();
        }
      });

      // Store resolve for use when setup complete arrives
      const checkSetup = setInterval(() => {
        if (this.geminiSetupComplete) {
          clearInterval(checkSetup);
          resolve();
        }
      }, 100);

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!this.geminiSetupComplete) {
          clearInterval(checkSetup);
          reject(new Error("Gemini setup timeout"));
        }
      }, 15000);
    });
  }

  /**
   * Reconnect the Gemini WebSocket after a GoAway or unexpected closure.
   * Reuses the existing LiveKit room + audio pipeline.
   */
  private async reconnectGemini(): Promise<void> {
    if (this.isReconnecting) {
      console.log(
        `[TranslationBridge:${this.targetLanguage}] Reconnection already in progress. Skipping duplicate request.`
      );
      return;
    }
    this.isReconnecting = true;

    try {
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.geminiApiKey}`;
      console.log(
        `[TranslationBridge:${this.targetLanguage}] Reconnecting Gemini WebSocket with handle: ${this.resumptionHandle || "none"}...`
      );

      const nextWs = new WebSocket(wsUrl);
      let nextSetupComplete = false;

      nextWs.on("open", () => {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Gemini reconnect WebSocket opened`
        );
        this.sendGeminiSetup(nextWs);
      });

      nextWs.on("message", (data: WebSocket.Data) => {
        try {
          if (!nextSetupComplete) {
            const msg = JSON.parse(data.toString());
            if (msg.setupComplete) {
              console.log(
                `[TranslationBridge:${this.targetLanguage}] Gemini reconnect setup complete`
              );
              nextSetupComplete = true;
              this.geminiSetupComplete = true;

              const oldWs = this.geminiWs;
              this.geminiWs = nextWs;
              this.isReconnecting = false;

              if (oldWs) {
                console.log(
                  `[TranslationBridge:${this.targetLanguage}] Gracefully closing old Gemini WebSocket`
                );
                oldWs.removeAllListeners();
                oldWs.close();
              }
              return;
            }
          }
          this.handleGeminiMessage(data);
        } catch (error) {
          console.error(
            `[TranslationBridge:${this.targetLanguage}] Error handling reconnect message:`,
            error
          );
        }
      });

      nextWs.on("error", (error) => {
        console.error(
          `[TranslationBridge:${this.targetLanguage}] Gemini reconnect error:`,
          error
        );
      });

      nextWs.on("close", (code: number, reason: Buffer) => {
        const reasonStr = reason.toString();
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Gemini reconnect WebSocket closed`,
          { code, reason: reasonStr }
        );

        if (this.geminiWs === nextWs) {
          this.geminiSetupComplete = false;
          if (this.status === "active") {
            setTimeout(() => {
              this.reconnectGemini();
            }, 1000);
          }
        } else {
          this.isReconnecting = false;
          if (this.status === "active") {
            setTimeout(() => {
              this.reconnectGemini();
            }, 2000);
          }
        }
      });
    } catch (error) {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] Gemini reconnect initialization failed:`,
        error
      );
      this.isReconnecting = false;
      if (this.status === "active") {
        setTimeout(() => {
          this.reconnectGemini();
        }, 5000);
      }
    }
  }

  private sendGeminiSetup(ws: WebSocket = this.geminiWs!): void {
    const setupMessage = {
      setup: {
        model: `models/${this.geminiModel}`,
        outputAudioTranscription: {},
        generationConfig: {
          responseModalities: ["AUDIO"],
          translationConfig: {
            targetLanguageCode: this.targetLanguage,
            echoTargetLanguage: true,
          },
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
          },
        },
        sessionResumption: this.resumptionHandle
          ? { handle: this.resumptionHandle }
          : {},
      },
    };

    console.log(
      `[TranslationBridge:${this.targetLanguage}] Sending Gemini setup (resuming: ${!!this.resumptionHandle}):`,
      JSON.stringify(setupMessage, null, 2)
    );

    ws.send(JSON.stringify(setupMessage));
  }

  private handleGeminiMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      // Log all messages before setup is complete for debugging
      if (!this.geminiSetupComplete) {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Gemini message (pre-setup):`,
          JSON.stringify(message).slice(0, 500)
        );
      }

      // Handle setup complete
      if (message.setupComplete) {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Gemini setup complete`
        );
        this.geminiSetupComplete = true;
        return;
      }

      // Handle session resumption update
      if (message.sessionResumptionUpdate) {
        const update = message.sessionResumptionUpdate;
        if (update.resumable && update.newHandle) {
          this.resumptionHandle = update.newHandle;
          console.log(
            `[TranslationBridge:${this.targetLanguage}] Received sessionResumptionUpdate with newHandle: ${this.resumptionHandle}`
          );
        }
      }

      // Handle GoAway message
      if (message.goAway) {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Received goAway message from Gemini. Time left: ${message.goAway.timeLeft || "unknown"}. Initiating graceful session resumption...`
        );
        this.reconnectGemini().catch((err) => {
          console.error(
            `[TranslationBridge:${this.targetLanguage}] Error during goAway reconnection:`,
            err
          );
        });
      }

      // Handle audio response
      const serverContent = message?.serverContent;
      const parts = serverContent?.modelTurn?.parts;

      if (parts?.length) {
        for (const part of parts) {
          if (part.inlineData?.data) {
            this.framesReceivedFromGemini++;
            if (this.framesReceivedFromGemini <= 3 || this.framesReceivedFromGemini % 100 === 0) {
              console.log(
                `[TranslationBridge:${this.targetLanguage}] Received audio frame #${this.framesReceivedFromGemini} from Gemini (${part.inlineData.data.length} bytes base64)`
              );
            }
            // Queue frame for sequential capture (avoid promise pile-up)
            this.queueAudioFrame(part.inlineData.data);
          }
        }
      }

      // Handle output transcription (separate field from modelTurn)
      if (serverContent?.outputTranscription?.text) {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Transcription:`,
          serverContent.outputTranscription.text.slice(0, 100)
        );
        this.publishTranscriptionText(
          serverContent.outputTranscription.text,
          !serverContent.turnComplete
        );
      }

      // If turn is complete, advance the segment id
      if (serverContent?.turnComplete) {
        this.transcriptionSegmentId++;
      }
    } catch (error) {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] Error parsing Gemini message:`,
        error
      );
    }
  }

  /**
   * Queue an audio frame for sequential capture.
   * Chains each captureFrame call to avoid promise pile-up.
   */
  private queueAudioFrame(base64Audio: string): void {
    this.captureChain = this.captureChain.then(() =>
      this.publishTranslatedAudio(base64Audio)
    );
  }

  private async publishTranslatedAudio(base64Audio: string): Promise<void> {
    if (!this.audioSource || this.status === "closed") return;

    try {
      const pcmBuffer = Buffer.from(base64Audio, "base64");
      const int16 = new Int16Array(
        pcmBuffer.buffer,
        pcmBuffer.byteOffset,
        pcmBuffer.byteLength / 2
      );

      const frame = new AudioFrame(int16, this.sampleRate, this.channels, int16.length);
      await this.audioSource.captureFrame(frame);

      const now = Date.now();
      if (this.lastAudioFrameTime && now - this.lastAudioFrameTime > 2000) {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Audio resumed after ${now - this.lastAudioFrameTime}ms gap (frame #${this.framesReceivedFromGemini})`
        );
      }
      this.lastAudioFrameTime = now;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("InvalidState") || msg.includes("closed")) {
        console.warn(
          `[TranslationBridge:${this.targetLanguage}] AudioSource closed — stopping capture`
        );
        this.audioSource = null;
      } else {
        console.error(
          `[TranslationBridge:${this.targetLanguage}] Error capturing audio frame:`,
          error
        );
      }
    }
  }

  private async subscribeToOrganizer(): Promise<void> {
    if (!this.room) return;

    // Find the organizer participant and subscribe to their audio
    const participants = this.room.remoteParticipants;

    for (const [, participant] of participants) {
      if (participant.identity === this.organizerIdentity) {
        this.subscribeToParticipantAudio(participant);
        return;
      }
    }

    // If organizer hasn't joined yet, wait for them
    console.log(
      `[TranslationBridge:${this.targetLanguage}] Waiting for organizer ${this.organizerIdentity}...`
    );

    // Listen for the organizer to publish their track
    this.room.on(
      RoomEvent.TrackPublished,
      (
        publication: RemoteTrackPublication,
        participant: RemoteParticipant
      ) => {
        if (
          participant.identity === this.organizerIdentity &&
          publication.kind === TrackKind.KIND_AUDIO
        ) {
          publication.setSubscribed(true);
        }
      }
    );

    // Once subscribed, pipe to Gemini
    this.room.on(
      RoomEvent.TrackSubscribed,
      (
        track: RemoteAudioTrack,
        publication: RemoteTrackPublication,
        participant: RemoteParticipant
      ) => {
        if (
          participant.identity === this.organizerIdentity &&
          publication.kind === TrackKind.KIND_AUDIO
        ) {
          this.pipeTrackToGemini(track);
        }
      }
    );
  }

  /**
   * Manually subscribe to a participant's audio track (needed when autoSubscribe is off).
   */
  private subscribeToParticipantAudio(
    participant: RemoteParticipant
  ): void {
    for (const [, publication] of participant.trackPublications) {
      if (publication.kind === TrackKind.KIND_AUDIO) {
        // Manually subscribe — this triggers TrackSubscribed event
        publication.setSubscribed(true);
      }
    }

    // Also listen for TrackSubscribed to pipe to Gemini
    this.room!.on(
      RoomEvent.TrackSubscribed,
      (
        track: RemoteAudioTrack,
        pub: RemoteTrackPublication,
        p: RemoteParticipant
      ) => {
        if (
          p.identity === this.organizerIdentity &&
          pub.kind === TrackKind.KIND_AUDIO
        ) {
          this.pipeTrackToGemini(track);
        }
      }
    );
  }

  private pipeTrackToGemini(track: RemoteAudioTrack): void {
    console.log(
      `[TranslationBridge:${this.targetLanguage}] Subscribed to organizer audio track, piping to Gemini`
    );

    const audioStream = new AudioStream(track, {
      sampleRate: this.inputSampleRate,
      numChannels: this.channels,
      frameSizeMs: 100,
    });

    // Process frames as they arrive via ReadableStream reader
    const reader = audioStream.getReader();
    const readLoop = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.sendAudioToGemini(value);
      }
    };

    readLoop().catch((err: Error) => {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] Audio stream error:`,
        err
      );
    });
  }

  private sendAudioToGemini(frame: AudioFrame): void {
    if (
      !this.geminiWs ||
      this.geminiWs.readyState !== WebSocket.OPEN ||
      !this.geminiSetupComplete
    ) {
      return;
    }

    try {
      // Convert AudioFrame's Int16Array data to base64
      const int16Data = frame.data;
      const buffer = Buffer.from(int16Data.buffer, int16Data.byteOffset, int16Data.byteLength);
      const base64 = buffer.toString("base64");

      this.framesSentToGemini++;
      if (this.framesSentToGemini <= 3 || this.framesSentToGemini % 500 === 0) {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Sent audio frame #${this.framesSentToGemini} to Gemini (${base64.length} bytes base64, ${int16Data.length} samples)`
        );
      }

      const message = {
        realtimeInput: {
          audio: {
            mimeType: `audio/pcm;rate=${this.inputSampleRate}`,
            data: base64,
          },
        },
      };

      this.geminiWs.send(JSON.stringify(message));
    } catch (error) {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] Error sending audio to Gemini:`,
        error
      );
    }
  }

  private async publishTranscriptionText(text: string, interim: boolean): Promise<void> {
    if (!this.room || !this.room.localParticipant) return;

    try {
      const payload = JSON.stringify({
        type: "transcription",
        language: this.targetLanguage,
        segmentId: `${this.targetLanguage}-${this.transcriptionSegmentId}`,
        text,
        final: !interim,
        timestamp: Date.now(),
      });

      await this.room.localParticipant.publishData(
        new TextEncoder().encode(payload),
        { reliable: true, topic: "transcription" }
      );
    } catch (error) {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] Error publishing transcription:`,
        error
      );
    }
  }
}
