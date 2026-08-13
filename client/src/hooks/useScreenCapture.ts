import { useState, useRef, useCallback, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";

interface UseScreenCaptureOptions {
  timeEntryId: string | null;
  crmProjectId: string | null;
  isRunning: boolean;
  minIntervalSeconds?: number;
  maxIntervalSeconds?: number;
}

export function useScreenCapture({
  timeEntryId,
  crmProjectId,
  isRunning,
  minIntervalSeconds = 180,
  maxIntervalSeconds = 300,
}: UseScreenCaptureOptions) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const getRandomInterval = useCallback(() => {
    return (minIntervalSeconds + Math.random() * (maxIntervalSeconds - minIntervalSeconds)) * 1000;
  }, [minIntervalSeconds, maxIntervalSeconds]);

  const captureFrame = useCallback(async () => {
    if (!streamRef.current || !timeEntryId || !crmProjectId) return;

    const track = streamRef.current.getVideoTracks()[0];
    if (!track || track.readyState !== "live") {
      stopCapture();
      return;
    }

    try {
      if (!videoRef.current) {
        videoRef.current = document.createElement("video");
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.muted = true;
        await videoRef.current.play();
      }

      const canvas = document.createElement("canvas");
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(video, 0, 0);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.7)
      );
      if (!blob) return;

      const uploadRes = await apiRequest("POST", "/api/time-tracking/screenshots/upload-url", { timeEntryId });
      const { uploadURL, objectPath } = await uploadRes.json();

      await fetch(uploadURL, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": "image/jpeg" },
      });

      const storageKey = objectPath;

      await apiRequest("POST", "/api/time-tracking/screenshots", {
        timeEntryId,
        crmProjectId,
        storageKey,
        capturedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("Screenshot capture failed:", err);
      setCaptureError("Screenshot capture failed. Will retry on next interval.");
    }
  }, [timeEntryId, crmProjectId]);

  const scheduleNextCapture = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      await captureFrame();
      if (streamRef.current && isRunning) {
        scheduleNextCapture();
      }
    }, getRandomInterval());
  }, [captureFrame, getRandomInterval, isRunning]);

  const startCapture = useCallback(async () => {
    if (streamRef.current) return;
    setCaptureError(null);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      streamRef.current = stream;
      setIsCapturing(true);

      stream.getVideoTracks()[0].addEventListener("ended", () => {
        stopCapture();
      });

      await captureFrame();
      scheduleNextCapture();
    } catch (err: any) {
      console.error("Screen capture permission denied:", err);
      setCaptureError("Screen sharing was denied or cancelled");
      setIsCapturing(false);
    }
  }, [captureFrame, scheduleNextCapture]);

  const stopCapture = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    setIsCapturing(false);
    setCaptureError(null);
  }, []);

  useEffect(() => {
    if (!isRunning && streamRef.current) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    } else if (isRunning && streamRef.current && !timerRef.current) {
      scheduleNextCapture();
    }
  }, [isRunning, scheduleNextCapture]);

  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  return {
    isCapturing,
    captureError,
    startCapture,
    stopCapture,
  };
}
