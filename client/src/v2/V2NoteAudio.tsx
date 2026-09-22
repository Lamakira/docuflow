/**
 * Voice notes on the Project Dossier (#213), in the v2 visual system.
 *
 * The v1 `AudioRecorder` / `NoteAudioPlayer` carry the discarded Tailwind
 * system, and ADR-0003 refuses to mix the two inside v2 chrome. The capture,
 * playback, and transcript-polling behaviour is the same; only the surface is
 * v2 tokens. Do not animate the composer or the elapsed counter — recording is
 * a state, not a celebration.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

function clock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60).toString().padStart(2, "0")}:${(safe % 60).toString().padStart(2, "0")}`;
}

export function V2AudioRecorder({
  onRecordingComplete,
  onCancel,
  isUploading = false,
}: {
  onRecordingComplete: (blob: Blob) => void;
  onCancel: () => void;
  isUploading?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function start() {
    setRefusal(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        onRecordingComplete(new Blob(chunksRef.current, { type: "audio/webm" }));
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed((value) => value + 1), 1000);
    } catch {
      // A refused microphone is the browser's answer, not a failure to hide.
      setRefusal("This browser did not grant microphone access.");
    }
  }

  function stop() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    recorderRef.current?.stop();
    setRecording(false);
  }

  function cancel() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => recorder.stream.getTracks().forEach((track) => track.stop());
      recorder.stop();
    }
    setRecording(false);
    onCancel();
  }

  return (
    <div className="df-audio-recorder" data-testid="v2-audio-recorder">
      {refusal ? <p className="df-refusal">{refusal}</p> : null}
      <span className="df-mono df-meta">
        {isUploading ? "UPLOADING" : recording ? "RECORDING" : "READY"}
      </span>
      <span className="df-audio-clock">{clock(elapsed)}</span>
      <span className="df-people-action">
        {recording ? (
          <Button variant="default" type="button" onClick={stop} disabled={isUploading} className="df-btn">
            Stop
          </Button>
        ) : (
          <Button variant="default" type="button" onClick={start} disabled={isUploading} className="df-btn">
            Record
          </Button>
        )}
        <Button variant="outline" type="button" onClick={cancel} disabled={isUploading} className="df-btn">
          Cancel
        </Button>
      </span>
    </div>
  );
}

const TRANSCRIPT_LABEL: Record<string, string> = {
  pending: "TRANSCRIPT PENDING",
  processing: "TRANSCRIBING",
  completed: "TRANSCRIPT",
  error: "TRANSCRIPT UNAVAILABLE",
};

export function V2NoteAudioPlayer({
  audioUrl,
  audioRecordingId,
  transcriptStatus: initialStatus,
  audioTranscript: initialTranscript,
}: {
  audioUrl: string;
  audioRecordingId?: string;
  transcriptStatus?: string;
  audioTranscript?: string;
}) {
  const [transcript, setTranscript] = useState(initialTranscript);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    if (!audioRecordingId || (status !== "processing" && status !== "pending")) return;
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`/api/audio/${audioRecordingId}`, { credentials: "include" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.transcriptStatus === "completed" && data.transcript) {
          setTranscript(data.transcript);
          setStatus("completed");
        } else if (data.transcriptStatus === "error") {
          setStatus("error");
        }
      } catch {
        // Leave the status alone: a failed poll is not a failed transcript.
      }
    }

    const interval = setInterval(check, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [audioRecordingId, status]);

  return (
    <div className="df-audio-note" data-testid="v2-note-audio">
      <audio controls preload="none" src={audioUrl} className="df-audio-player" />
      {status ? <span className="df-mono df-meta">{TRANSCRIPT_LABEL[status] ?? status.toUpperCase()}</span> : null}
      {transcript ? <p className="df-audio-transcript">{transcript}</p> : null}
    </div>
  );
}
