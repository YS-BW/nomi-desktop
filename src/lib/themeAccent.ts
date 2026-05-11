export const DEFAULT_ACCENT_COLOR = "#7c9cf6";

export const ACCENT_PRESETS = [
  { id: "mist-blue", label: "雾蓝", color: "#7c9cf6" },
  { id: "ice-cyan", label: "冰青", color: "#59c3c3" },
  { id: "sage", label: "鼠尾草", color: "#7fb685" },
  { id: "amber", label: "琥珀", color: "#d9a441" },
  { id: "rose", label: "雾玫瑰", color: "#d28ea7" },
  { id: "violet", label: "蓝紫", color: "#8e87f7" },
] as const;

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function normalizeAccentColor(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return DEFAULT_ACCENT_COLOR;
  }
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    const [, r, g, b] = normalized;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return DEFAULT_ACCENT_COLOR;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeAccentColor(hex);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbaFromHex(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${clampChannel(r)}, ${clampChannel(g)}, ${clampChannel(b)}, ${alpha})`;
}

export function mixHex(hex: string, mixWith: string, ratio: number): string {
  const base = hexToRgb(hex);
  const target = hexToRgb(mixWith);
  const nextRatio = Math.max(0, Math.min(1, ratio));
  const r = base.r + (target.r - base.r) * nextRatio;
  const g = base.g + (target.g - base.g) * nextRatio;
  const b = base.b + (target.b - base.b) * nextRatio;
  return `#${clampChannel(r).toString(16).padStart(2, "0")}${clampChannel(g).toString(16).padStart(2, "0")}${clampChannel(b).toString(16).padStart(2, "0")}`;
}

export function getAccentContrastColor(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? "#111827" : "#ffffff";
}
