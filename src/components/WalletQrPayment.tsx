import Image from "next/image";

type QrWallet = "YAPE" | "PLIN";

export default function WalletQrPayment({
  amount,
  method,
}: {
  amount: string | number;
  method: QrWallet;
}) {
  const total = Number(amount);
  const isPlin = method === "PLIN";
  const methodLabel = isPlin ? "Plin" : "Yape";

  return (
    <section
      className="rounded-lg border border-stone-300 bg-white p-4 text-sm text-stone-800"
      aria-label={`Cobrar con ${methodLabel}`}
    >
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <a
          href="/payments/yape.png"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md outline-offset-4 focus-visible:outline-2"
        >
          <Image
            src="/payments/yape.png"
            alt={`QR interoperable de Carlos Alexis Melgar Vila para pagar con ${methodLabel}. Abrir imagen completa.`}
            width={1131}
            height={1599}
            unoptimized
            className="h-auto w-60 max-w-full rounded-md"
          />
          <span className="mt-2 block text-center text-xs font-semibold underline">
            Abrir QR en tamaño completo
          </span>
        </a>
        <div className="space-y-2">
          <h4 className="font-semibold">Pago con {methodLabel}</h4>
          <p>
            Titular: <strong>Carlos Alexis Melgar Vila</strong>
          </p>
          {Number.isFinite(total) && total > 0 && (
            <p className="text-lg font-bold">
              {new Intl.NumberFormat("es-PE", {
                style: "currency",
                currency: "PEN",
              }).format(total)}
            </p>
          )}
          {isPlin ? (
            <>
              <p>
                Escanea este QR interoperable desde Plin y verifica que la app
                muestre al titular indicado antes de pagar.
              </p>
              <p className="text-xs text-stone-600">
                El QR conserva la marca Yape porque fue emitido por esa cuenta;
                Plin puede leerlo mediante la interoperabilidad entre billeteras.
              </p>
            </>
          ) : (
            <p>Escanea el QR y comprueba que coincidan el titular y el importe.</p>
          )}
          <p className="text-xs text-stone-600">
            Operador: confirma el abono en la cuenta receptora y registra el
            código de operación. Una captura de pantalla no acredita el pago.
          </p>
          <p className="text-xs text-stone-600">
            El sistema registra el cobro; no verifica automáticamente las
            operaciones de {methodLabel}.
          </p>
        </div>
      </div>
      <label className="mt-4 flex items-start gap-2 border-t border-stone-200 pt-3 text-xs font-medium">
        <input
          type="checkbox"
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-stone-800"
        />
        Confirmé el abono y el importe en la cuenta receptora antes de emitir el
        comprobante.
      </label>
    </section>
  );
}
