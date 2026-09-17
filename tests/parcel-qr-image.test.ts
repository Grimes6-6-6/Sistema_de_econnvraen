import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanParcelQrImage } from "@/lib/qr/scan-parcel-image";

const mocks = vi.hoisted(() => ({
  scanImage: vi.fn(),
  createWorker: vi.fn(),
  worker: { postMessage: vi.fn(), terminate: vi.fn() },
}));
vi.mock("qr-scanner", () => ({ default: { scanImage: mocks.scanImage } }));
vi.mock("qr-scanner/qr-scanner-worker.min.js", () => ({ createWorker: mocks.createWorker }));

const file = new File(["synthetic fixture"], "receipt.png", { type: "image/png" });
const decoded = { data: "https://econnvrae-next.vercel.app/public?tracking=ECV-260917-00034" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createWorker.mockReturnValue(mocks.worker);
});

describe("lectura de imágenes de recibos", () => {
  it("lee el código con el detector habitual sin iniciar un worker adicional", async () => {
    mocks.scanImage.mockResolvedValue(decoded);
    await expect(scanParcelQrImage(file)).resolves.toBe("ECV-260917-00034");
    expect(mocks.createWorker).not.toHaveBeenCalled();
  });

  it("reintenta con el lector software si el detector no reconoce el recibo", async () => {
    mocks.scanImage.mockRejectedValueOnce("No QR code found").mockResolvedValueOnce(decoded);
    await expect(scanParcelQrImage(file)).resolves.toBe("ECV-260917-00034");
    expect(mocks.scanImage).toHaveBeenLastCalledWith(file, {
      qrEngine: mocks.worker, returnDetailedScanResult: true,
    });
    expect(mocks.worker.terminate).toHaveBeenCalledOnce();
  });

  it("libera el worker también cuando la imagen es ilegible", async () => {
    mocks.scanImage.mockRejectedValue("No QR code found");
    await expect(scanParcelQrImage(file)).rejects.toBe("No QR code found");
    expect(mocks.worker.terminate).toHaveBeenCalledOnce();
  });

  it("distingue un QR ajeno de una imagen ilegible", async () => {
    mocks.scanImage.mockResolvedValue({ data: "https://example.com/another-page" });
    await expect(scanParcelQrImage(file)).rejects.toThrow("INVALID_PARCEL_QR");
    expect(mocks.createWorker).not.toHaveBeenCalled();
  });
});
