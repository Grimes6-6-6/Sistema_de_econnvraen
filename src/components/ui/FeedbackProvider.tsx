"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from "lucide-react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type NoticeType = "success" | "error" | "warning" | "info";

interface NoticeInput {
  type?: NoticeType;
  title: string;
  message?: string;
  duration?: number;
}

interface ConfirmationInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  input?: {
    label: string;
    placeholder?: string;
    minLength?: number;
  };
}

interface ConfirmationResult {
  confirmed: boolean;
  value: string;
}

interface FeedbackContextValue {
  notify: (notice: NoticeInput) => void;
  requestConfirmation: (
    confirmation: ConfirmationInput,
  ) => Promise<ConfirmationResult>;
}

interface Notice extends NoticeInput {
  id: string;
  type: NoticeType;
}

interface PendingConfirmation extends ConfirmationInput {
  resolve: (result: ConfirmationResult) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const noticeStyles: Record<
  NoticeType,
  { container: string; icon: React.ComponentType<{ className?: string }> }
> = {
  success: {
    container: "border-emerald-400/30 bg-emerald-950/95 text-emerald-50",
    icon: CheckCircle2,
  },
  error: {
    container: "border-red-400/30 bg-red-950/95 text-red-50",
    icon: XCircle,
  },
  warning: {
    container: "border-amber-400/30 bg-amber-950/95 text-amber-50",
    icon: AlertTriangle,
  },
  info: {
    container: "border-sky-400/30 bg-sky-950/95 text-sky-50",
    icon: Info,
  },
};

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [confirmation, setConfirmation] =
    useState<PendingConfirmation | null>(null);
  const [confirmationValue, setConfirmationValue] = useState("");
  const confirmationValueRef = useRef("");
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const dialogInputId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const notify = useCallback(
    (input: NoticeInput) => {
      const notice: Notice = {
        ...input,
        id: crypto.randomUUID(),
        type: input.type ?? "info",
      };
      setNotices((current) => [...current.slice(-3), notice]);

      const duration = input.duration ?? (notice.type === "error" ? 7000 : 4500);
      if (duration > 0) {
        window.setTimeout(() => dismissNotice(notice.id), duration);
      }
    },
    [dismissNotice],
  );

  const requestConfirmation = useCallback(
    (input: ConfirmationInput) =>
      new Promise<ConfirmationResult>((resolve) => {
        setConfirmationValue("");
        confirmationValueRef.current = "";
        setConfirmation({ ...input, resolve });
      }),
    [],
  );

  const closeConfirmation = useCallback(
    (confirmed: boolean) => {
      if (!confirmation) return;
      confirmation.resolve({
        confirmed,
        value: confirmationValueRef.current.trim(),
      });
      setConfirmation(null);
      setConfirmationValue("");
      confirmationValueRef.current = "";
    },
    [confirmation],
  );

  useEffect(() => {
    if (!confirmation) return;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      (confirmation.input ? inputRef.current : cancelButtonRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeConfirmation(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [closeConfirmation, confirmation]);

  const minLength = confirmation?.input?.minLength ?? 0;
  const canConfirm = !confirmation?.input || confirmationValue.trim().length >= minLength;

  return (
    <FeedbackContext.Provider value={{ notify, requestConfirmation }}>
      {children}

      <div
        className="pointer-events-none fixed inset-x-4 top-4 z-[80] flex flex-col items-end gap-3 sm:left-auto sm:w-[26rem]"
        aria-live="polite"
        aria-atomic="false"
      >
        {notices.map((notice) => {
          const style = noticeStyles[notice.type];
          const Icon = style.icon;
          return (
            <section
              key={notice.id}
              className={`pointer-events-auto w-full rounded-2xl border p-4 shadow-2xl backdrop-blur-xl ${style.container}`}
              role={notice.type === "error" ? "alert" : "status"}
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-5">{notice.title}</p>
                  {notice.message && (
                    <p className="mt-1 text-sm leading-5 opacity-90">
                      {notice.message}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismissNotice(notice.id)}
                  className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  aria-label={`Cerrar aviso: ${notice.title}`}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </section>
          );
        })}
      </div>

      {confirmation && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConfirmation(false);
          }}
        >
          <section
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogDescriptionId}
            className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl sm:p-7"
          >
            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                  confirmation.tone === "danger"
                    ? "bg-red-500/15 text-red-300"
                    : "bg-emerald-500/15 text-emerald-300"
                }`}
                aria-hidden="true"
              >
                {confirmation.tone === "danger" ? (
                  <AlertTriangle className="h-6 w-6" />
                ) : (
                  <Info className="h-6 w-6" />
                )}
              </div>
              <div className="min-w-0">
                <h2 id={dialogTitleId} className="text-xl font-black text-white">
                  {confirmation.title}
                </h2>
                <p
                  id={dialogDescriptionId}
                  className="mt-2 text-sm leading-6 text-slate-300"
                >
                  {confirmation.message}
                </p>
              </div>
            </div>

            {confirmation.input && (
              <div className="mt-6">
                <label
                  htmlFor={dialogInputId}
                  className="mb-2 block text-sm font-bold text-slate-200"
                >
                  {confirmation.input.label}
                </label>
                <input
                  ref={inputRef}
                  id={dialogInputId}
                  value={confirmationValue}
                  onChange={(event) => {
                    setConfirmationValue(event.target.value);
                    confirmationValueRef.current = event.target.value;
                  }}
                  placeholder={confirmation.input.placeholder}
                  minLength={minLength}
                  className="min-h-12 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 text-white outline-none placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
                />
                {minLength > 0 && (
                  <p className="mt-2 text-xs text-slate-400">
                    Mínimo {minLength} caracteres ({confirmationValue.trim().length}/{minLength}).
                  </p>
                )}
              </div>
            )}

            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={() => closeConfirmation(false)}
                className="rounded-xl border border-white/10 px-5 py-3 font-bold text-slate-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {confirmation.cancelLabel ?? "Volver"}
              </button>
              <button
                type="button"
                disabled={!canConfirm}
                onClick={() => closeConfirmation(true)}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-black text-white focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  confirmation.tone === "danger"
                    ? "bg-red-600 hover:bg-red-500 focus-visible:ring-red-300"
                    : "bg-emerald-600 hover:bg-emerald-500 focus-visible:ring-emerald-300"
                }`}
              >
                {confirmation.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </section>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error("useFeedback debe usarse dentro de FeedbackProvider.");
  }
  return context;
}
