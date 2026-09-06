import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Clock,
  MapPin,
  Package,
  QrCode,
  ShieldCheck,
  Ticket,
  Truck,
} from "lucide-react";

const services = [
  {
    icon: Ticket,
    title: "Pasajes e itinerarios",
    description:
      "Programación de salidas y atención de pasajeros entre Ayacucho y el VRAEM.",
  },
  {
    icon: Package,
    title: "Envío de encomiendas",
    description:
      "Registro de paquetes con comprobante, código de seguimiento y validación de entrega.",
  },
  {
    icon: Truck,
    title: "Recojo a domicilio",
    description:
      "Coordinación de recojos para facilitar el despacho desde el punto indicado por el cliente.",
  },
] as const;

export default function RootPage() {
  return (
    <main className="min-h-screen bg-[#f3eee4] text-slate-900">
      <header className="border-b border-[#ded2bf] bg-[#fffdf8]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-10">
          <Image
            src="/econnvrae-logo.png"
            alt="ECONNVRAE - Autos y camionetas al VRAEM"
            width={2086}
            height={754}
            priority
            className="h-11 w-auto max-w-40 object-contain object-left sm:h-14 sm:max-w-52"
          />

          <nav className="flex items-center gap-2" aria-label="Accesos principales">
            <Link
              href="/public"
              className="hidden rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#c6a04a] hover:text-slate-950 sm:inline-flex"
            >
              Seguimiento
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-md border border-[#af8224] bg-[#d8ad43] px-4 py-2.5 text-sm font-bold text-[#20180a] transition hover:bg-[#c99b32]"
            >
              Ingresar
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </nav>
        </div>
      </header>

      <section className="border-b border-[#ded2bf] bg-[#fffdf8]">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-12 lg:px-10 lg:py-24">
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#dfc98f] bg-[#fff8e5] px-3 py-1.5 text-xs font-bold text-[#765414]">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              Transporte interprovincial Ayacucho — VRAEM
            </div>

            <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-[1.08] tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              Viaja y envía tus encomiendas con atención cercana.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              ECONNVRAE brinda transporte de pasajeros, encomiendas y recojos a domicilio para conectar Ayacucho con el VRAEM.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-[#af8224] bg-[#d8ad43] px-6 py-3 text-sm font-bold text-[#20180a] shadow-sm transition hover:bg-[#c99b32] focus:outline-none focus:ring-2 focus:ring-[#9f7622] focus:ring-offset-2"
              >
                Ingresar al sistema
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/public"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-800 transition hover:border-[#c6a04a] hover:bg-[#fffaf0] focus:outline-none focus:ring-2 focus:ring-[#c6a04a] focus:ring-offset-2"
              >
                <QrCode className="h-4 w-4" aria-hidden="true" />
                Seguir una encomienda
              </Link>
            </div>

            <p className="mt-4 text-xs leading-5 text-slate-500">
              El seguimiento requiere el código del recibo y los últimos cuatro dígitos del DNI del destinatario.
            </p>
          </div>

          <div className="lg:col-span-5">
            <div className="overflow-hidden rounded-2xl border border-[#d9c9ae] bg-[#f6efe3] shadow-[0_18px_45px_rgba(71,55,31,0.10)]">
              <div className="border-b border-[#ded2bf] bg-[#272b28] px-6 py-5 text-white">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#f1cf75]">
                  Nuestra ruta
                </p>
                <p className="mt-2 text-xl font-bold">Ayacucho — VRAEM</p>
              </div>

              <div className="p-6 sm:p-8">
                <div className="flex items-center gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#cfb675] bg-white text-[#765414]">
                    <MapPin className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Punto de salida
                    </p>
                    <p className="mt-0.5 font-bold text-slate-900">Ayacucho</p>
                  </div>
                </div>

                <div className="ml-[21px] h-12 border-l-2 border-dashed border-[#c7a45a]" />

                <div className="flex items-center gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#cfb675] bg-white text-[#765414]">
                    <Truck className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Destinos atendidos
                    </p>
                    <p className="mt-0.5 font-bold text-slate-900">Distritos del VRAEM</p>
                  </div>
                </div>

                <div className="mt-7 grid grid-cols-2 gap-3 border-t border-[#ded2bf] pt-6">
                  <div className="rounded-lg bg-white p-4">
                    <Clock className="h-5 w-5 text-[#8a671d]" aria-hidden="true" />
                    <p className="mt-2 text-sm font-bold text-slate-900">Atención organizada</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Salidas programadas</p>
                  </div>
                  <div className="rounded-lg bg-white p-4">
                    <ShieldCheck className="h-5 w-5 text-[#8a671d]" aria-hidden="true" />
                    <p className="mt-2 text-sm font-bold text-slate-900">Envíos identificados</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Control mediante QR</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-18 lg:px-10" aria-labelledby="services-title">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a671d]">
            Servicios
          </p>
          <h2 id="services-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            Soluciones para pasajeros y clientes
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Atención para viajes y envíos con información clara durante cada etapa del servicio.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {services.map((service) => {
            const Icon = service.icon;
            return (
              <article key={service.title} className="border-t-4 border-[#c7a45a] bg-[#fffdf8] p-6 shadow-[0_5px_18px_rgba(71,55,31,0.06)]">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f4ead5] text-[#765414]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-lg font-bold text-slate-900">{service.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{service.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-y border-[#ded2bf] bg-[#fffdf8]">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center lg:px-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a671d]">
              Consulta para clientes
            </p>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">
              ¿Ya tienes tu comprobante de envío?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Escanea el QR o escribe el código para revisar el último estado registrado.
            </p>
          </div>
          <Link
            href="/public"
            className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-800 transition hover:border-[#c6a04a] hover:bg-[#fffaf0]"
          >
            Abrir seguimiento
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <footer className="bg-[#272b28] text-slate-300">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-7 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <p>© 2026 ECONNVRAE S.A.C.</p>
          <p>Transporte de pasajeros y encomiendas · Ayacucho — VRAEM</p>
        </div>
      </footer>
    </main>
  );
}
