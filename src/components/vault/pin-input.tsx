"use client";

import { useRef, useState, useEffect, type KeyboardEvent, type ClipboardEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * 6-digit PIN input — six segmented boxes with auto-advance on type, backspace
 * to step back, paste of a 6-digit string fills all six, non-digits stripped.
 * Renders a hidden `<input name={name}>` with the concatenated value so this
 * drops into any `<form>` naturally.
 */
export function PinInput({
  name,
  autoFocus = true,
  value,
  onChange,
  disabled,
  invalid,
  mask = true,
}: {
  name: string;
  autoFocus?: boolean;
  value?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** Whether to mask digits (default true). Set false for non-secret transient
   * codes like TOTP, where the user benefits from seeing what they typed. */
  mask?: boolean;
}) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState("");
  const v = controlled ? (value ?? "") : internal;
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  function setValue(next: string) {
    const clean = next.replace(/\D/g, "").slice(0, 6);
    if (controlled) onChange?.(clean);
    else {
      setInternal(clean);
      onChange?.(clean);
    }
  }

  function handleChange(idx: number, raw: string) {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const nextChars = v.split("");
    while (nextChars.length < 6) nextChars.push("");
    nextChars[idx] = digit;
    const joined = nextChars.join("").slice(0, 6);
    setValue(joined);
    if (digit && idx < 5) refs.current[idx + 1]?.focus();
  }

  function handleKeyDown(idx: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (v[idx]) {
        const nextChars = v.split("");
        nextChars[idx] = "";
        setValue(nextChars.join(""));
      } else if (idx > 0) {
        refs.current[idx - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && idx > 0) {
      refs.current[idx - 1]?.focus();
    } else if (e.key === "ArrowRight" && idx < 5) {
      refs.current[idx + 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted) {
      e.preventDefault();
      setValue(pasted);
      const nextIdx = Math.min(pasted.length, 5);
      refs.current[nextIdx]?.focus();
    }
  }

  return (
    <>
      <input type="hidden" name={name} value={v} />
      <div className="flex justify-center gap-2">
        {[0, 1, 2, 3, 4, 5].map((idx) => (
          <input
            key={idx}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            type={mask ? "password" : "text"}
            inputMode="numeric"
            pattern="\d*"
            autoComplete="off"
            maxLength={1}
            value={v[idx] ?? ""}
            onChange={(e) => handleChange(idx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            onPaste={handlePaste}
            disabled={disabled}
            aria-label={`PIN digit ${idx + 1}`}
            className={cn(
              "size-11 rounded-md border text-center font-mono text-lg tabular-nums outline-none transition-colors",
              "border-input bg-background focus:border-primary focus:ring-2 focus:ring-primary/20",
              invalid && "border-rose-500/60 focus:border-rose-500 focus:ring-rose-500/20",
              disabled && "cursor-not-allowed opacity-60",
            )}
          />
        ))}
      </div>
    </>
  );
}
