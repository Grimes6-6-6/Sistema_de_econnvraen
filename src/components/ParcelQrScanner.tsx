"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImageUp, LoaderCircle, X } from "lucide-react";
import type QrScanner from "qr-scanner";
import { extractParcelTrackingCode } from "@/lib/domain/parcel-receipt";

type ParcelQrScannerProps = {
  onClose: () => void;
  onCodeScanned: (trackingCode: string) => void;
};

export default function ParcelQrScanner({
  onClose,
  onCodeScanned,
}: ParcelQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const handledRef = useRef(false);
  const [cameraError, setCameraError] = useState("");
  const [isStarting, setIsStarting] = useState(true);
  const [isReadingImage, setIsReadingImage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    handledRef.current = false;

    const acceptResult = (value: string) => {
      if (handledRef.current) return;

      const trackingCode = extractParcelTrackingCode(value);
      if (!trackingCode) {
        setCameraError("El QR leído no pertenece a un recibo de encomienda válido.");
        return;
      }

      handledRef.current = true;
      scannerRef.current?.stop();
      onCodeScanned(trackingCode);
      onClose();
    };

    const startScanner = async () => {
      try {
        const { default: QrScannerClient } = await import("qr-scanner");
        if (cancelled || !videoRef.current) return;

        const scanner = new QrScannerClient(
          videoRef.current,
          (scanResult) => acceptResult(scanResult.data),
          {
            preferredCamera: "environment",
            maxScansPerSecond: 8,
            highlightScanRegion: true,
            highlightCodeOutline: true,
            returnDetailedScanResult: true,
          },
        );
        scannerRef.current = scanner;
        await scanner.start();
      } catch {
        if (!cancelled) {
          setCameraError(
            "No se pudo abrir la cámara. Autoriza el permiso o selecciona una foto del QR.",
          );
        }
      } finally {
        if (!cancelled) setIsStarting(false);
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, [onClose, onCodeScanned]);

  const readQrImage = async (file: File | undefined) => {
    if (!file) return;

    setIsReadingImage(true);
    setCameraError("");
    try {
      const { default: QrScannerClient } = await import("qr-scanner");
      const result = await QrScannerClient.scanImage(file, {
        returnDetailedScanResult: true,
        alsoTryWithoutScanRegion: true,
      });
      const trackingCode = extractParcelTrackingCode(result.data);
      if (!trackingCode) {
        throw new Error("INVALID_PARCEL_QR");
      }

      handledRef.current = true;
      scannerRef.current?.stop();
      onCodeScanned(trackingCode);
      onClose();
    } catch {
      setCameraError(
        "No pudimos leer un QR válido en esa imagen. Intenta con una foto más clara.",
      );
    } finally {
      setIsReadingImage(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="parcel-qr-scanner-title"
      className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4"
    >
      <section className="corporate-dialog w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-premium sm:p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="parcel-qr-scanner-title" className="text-lg font-black text-white">
              Escanear QR del recibo
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Coloca el código QR dentro del recuadro.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar lector QR"
            className="rounded-xl border border-white/10 bg-slate-800 p-2 text-slate-300 transition hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="relative aspect-square overflow-hidden rounded-2xl border border-emerald-500/30 bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-full w-full object-cover"
          />
          {isStarting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/80 text-sm font-bold text-slate-300">
              <LoaderCircle className="h-7 w-7 animate-spin text-emerald-400" />
              Abriendo cámara…
            </div>
          )}
        </div>

        {cameraError && (
          <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-bold text-amber-200">
            {cameraError}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs font-bold text-emerald-300">
            <Camera className="h-4 w-4" /> Cámara activa
          </div>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-800 px-4 py-3 text-xs font-bold text-white transition hover:bg-slate-700">
            {isReadingImage ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ImageUp className="h-4 w-4" />
            )}
            Leer desde foto
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={isReadingImage}
              onChange={(event) => {
                void readQrImage(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        <p className="text-center text-[10px] leading-relaxed text-slate-500">
          La cámara se usa únicamente para leer el QR y se apaga al cerrar esta ventana.
        </p>
      </section>
    </div>
  );
}
