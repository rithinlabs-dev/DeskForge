// Pure helpers for the Glass Effect Wizard in the Look panel (no DOM, no Tauri, unit-tested).
//
// The wizard asks Rust what this Windows build supports (diagnostics), then shows each method on the real pinned
// widget, one after another. "Windows accepted it" is not the same as "you can see it", so the user makes the final
// choice by eye; `recommend` only suggests a starting point.
import type { GlassEffect, GlassKind } from "./appearance";

/** A concrete method (everything except "auto"). */
export type GlassMethodKind = Exclude<GlassKind, "auto">;

export interface MethodSupport {
  kind: GlassMethodKind;
  label: string;
  /** Whether this Windows build should support it. */
  supported: boolean;
  /** Whether the tint colour and opacity sliders change it. */
  tintControl: boolean;
  note: string;
}

/** Mirrors `glass::Diagnostics` in Rust. */
export interface GlassDiagnostics {
  build: number;
  windows: string;
  nativeBlurApi: boolean;
  methods: MethodSupport[];
}

export type TrialStatus = "pending" | "trying" | "accepted" | "rejected";

export interface Trial {
  kind: GlassMethodKind;
  status: TrialStatus;
  effect: GlassEffect | null;
  error: string | null;
}

/** Used if the diagnostics call itself fails: assume nothing is known and let the user test everything. */
export function fallbackDiagnostics(): GlassDiagnostics {
  const m = (kind: GlassMethodKind, label: string, tintControl: boolean, note: string): MethodSupport => ({
    kind, label, supported: true, tintControl, note,
  });
  return {
    build: 0,
    windows: "unknown Windows version",
    nativeBlurApi: false,
    methods: [
      m("acrylic", "Acrylic (frosted)", true, "Tint colour and opacity work."),
      m("blur", "Plain blur", true, "Clear blur behind the widget."),
      m("backdrop", "Windows 11 backdrop", false, "Windows 11 22H2 or later."),
      m("mica", "Mica", false, "Windows 11 22H2 or later."),
      m("wallpaper", "Frosted wallpaper", true, "DeskForge blurs your wallpaper behind the widget; works everywhere."),
      m("sheen", "Translucent sheen", true, "No native effect; works everywhere."),
    ],
  };
}

/** The native methods worth trying on this PC, in table order. The two DeskForge-drawn looks need no test. */
export function trialPlan(d: GlassDiagnostics): GlassMethodKind[] {
  return d.methods.filter((m) => m.kind !== "sheen" && m.kind !== "wallpaper" && m.supported).map((m) => m.kind);
}

export function newTrials(plan: readonly GlassMethodKind[]): Trial[] {
  return plan.map((kind): Trial => ({ kind, status: "pending", effect: null, error: null }));
}

/** One line for the panel: what Windows this is and what should work. */
export function diagnosticLine(d: GlassDiagnostics): string {
  const likely = d.methods.filter((m) => m.supported && m.kind !== "sheen" && m.kind !== "wallpaper").map((m) => m.label);
  const works = likely.length ? likely.join(", ") : "none (the translucent sheen will be used)";
  return `${d.windows} · native blur API: ${d.nativeBlurApi ? "found" : "not found"} · should work: ${works}`;
}

/**
 * A starting point for the user, never a verdict: the first accepted method that honours the tint sliders, else the
 * first accepted one, else the frosted wallpaper (DeskForge draws it itself, so it cannot be refused by Windows).
 */
export function recommend(trials: readonly Trial[], d: GlassDiagnostics | null): GlassMethodKind {
  const tintControl = (kind: GlassMethodKind) => d?.methods.find((m) => m.kind === kind)?.tintControl ?? false;
  const accepted = trials.filter((t) => t.status === "accepted");
  return (accepted.find((t) => tintControl(t.kind)) ?? accepted[0])?.kind ?? "wallpaper";
}

export function trialText(t: Trial): string {
  switch (t.status) {
    case "pending":
      return "waiting";
    case "trying":
      return "trying now: look at your desktop widget";
    case "accepted":
      return t.effect && t.effect !== t.kind ? `accepted by Windows (as ${t.effect})` : "accepted by Windows";
    default:
      return `rejected: ${t.error ?? "unknown reason"}`;
  }
}
