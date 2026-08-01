import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Minimal toast store.
 *
 * Deliberately not a hook: react-query's MutationCache reports failures from
 * outside the React tree, and every save in this app needs to be able to say
 * so. A mutation that fails silently is indistinguishable from one that
 * succeeded, which is how bookings and payments went missing without anyone
 * seeing an error.
 */

const DEFAULT_ERROR_DURATION_MS = 8000;
const DEFAULT_SUCCESS_DURATION_MS = 4000;

let nextId = 1;
let toasts = [];
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function subscribeToToasts(listener) {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}

export function getToasts() {
  return toasts;
}

export function showToast({ message, variant = "error", duration }) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return null;

  const id = nextId++;
  const ms =
    duration ??
    (variant === "error" ? DEFAULT_ERROR_DURATION_MS : DEFAULT_SUCCESS_DURATION_MS);

  toasts = [...toasts, { id, message: text, variant }];
  emit();

  if (ms > 0 && typeof setTimeout === "function") {
    setTimeout(() => dismissToast(id), ms);
  }
  return id;
}

export function dismissToast(id) {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function clearToasts() {
  if (toasts.length === 0) return;
  toasts = [];
  emit();
}

export function showErrorToast(message) {
  return showToast({ message, variant: "error" });
}

export function showSuccessToast(message) {
  return showToast({ message, variant: "success" });
}

const variantStyles = {
  error: "border-red-200 bg-red-50 text-red-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

const variantIcons = {
  error: AlertCircle,
  success: CheckCircle,
};

export function ToastViewport() {
  const [items, setItems] = useState(getToasts);

  useEffect(() => subscribeToToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      {items.map((toast) => {
        const Icon = variantIcons[toast.variant] || AlertCircle;
        return (
          <div
            key={toast.id}
            role={toast.variant === "error" ? "alert" : "status"}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 shadow-lg",
              variantStyles[toast.variant] || variantStyles.error
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1 text-sm leading-relaxed break-words">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
