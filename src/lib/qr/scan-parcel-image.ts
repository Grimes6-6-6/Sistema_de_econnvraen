import { extractParcelTrackingCode } from "@/lib/domain/parcel-receipt";

export async function scanParcelQrImage(file: File): Promise<string> {
  const { default: QrScanner } = await import("qr-scanner");
  let decodedValue: string;
  try {
    const result = await QrScanner.scanImage(file, {
      returnDetailedScanResult: true,
    });
    decodedValue = result.data;
  } catch {
    // Some native browser detectors miss a small QR inside a full receipt.
    // Retry with the software decoder on the original image, without resizing.
    const { createWorker } = await import("qr-scanner/qr-scanner-worker.min.js");
    const worker = createWorker();
    try {
      worker.postMessage({ type: "inversionMode", data: "both" });
      const result = await QrScanner.scanImage(file, {
        qrEngine: worker,
        returnDetailedScanResult: true,
      });
      decodedValue = result.data;
    } finally {
      worker.terminate();
    }
  }

  const trackingCode = extractParcelTrackingCode(decodedValue);
  if (!trackingCode) throw new Error("INVALID_PARCEL_QR");
  return trackingCode;
}
