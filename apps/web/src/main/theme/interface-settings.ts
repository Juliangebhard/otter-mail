/**
 * Contrast, glass opacity and the interface font size (Otter Code's
 * appearance settings, ported from it at a944cac52), and the reading width
 * (Mail's take on its chat width). Kept like the other UI choices
 * (localStorage, synced with the account), painted onto <html> for
 * styles.css: CSS variables, and the font size as the root font size every
 * rem scales from.
 */

import { useSyncExternalStore } from "react";
import { setSyncedPreference, type SyncedKey } from "../synced-preferences";

export type InterfaceSetting = Readonly<{
  key: SyncedKey;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}>;

/** Text and borders against their surface, in %: 100 is the theme as designed. */
export const CONTRAST: InterfaceSetting = {
  key: "otter:contrast",
  min: 50,
  max: 200,
  step: 5,
  defaultValue: 100,
};

/** How solid the frosted surfaces (menus, popovers, dialogs, toasts) are, in %. */
export const GLASS_OPACITY: InterfaceSetting = {
  key: "otter:glass-opacity",
  min: 40,
  max: 100,
  step: 5,
  defaultValue: 80,
};

/** The interface's base font size, in px. */
export const INTERFACE_FONT_SIZE: InterfaceSetting = {
  key: "otter:interface-font-size",
  min: 12,
  max: 20,
  step: 1,
  defaultValue: 14,
};

const SETTINGS = [CONTRAST, GLASS_OPACITY, INTERFACE_FONT_SIZE];
const CHANGE_EVENT = "otter:interface-settings-change";

/** How wide an open thread grows on a large window: its max-width. */
export const READING_WIDTHS = {
  normal: { label: "Normal", maxWidth: "48rem" },
  wide: { label: "Wide", maxWidth: "64rem" },
  full: { label: "Full width", maxWidth: "none" },
} as const;
export type ReadingWidth = keyof typeof READING_WIDTHS;
export const DEFAULT_READING_WIDTH: ReadingWidth = "full";
const READING_WIDTH_KEY = "otter:reading-width";

function isReadingWidth(value: string | null): value is ReadingWidth {
  return value !== null && Object.hasOwn(READING_WIDTHS, value);
}

export function getReadingWidth(): ReadingWidth {
  const value = localStorage.getItem(READING_WIDTH_KEY);
  return isReadingWidth(value) ? value : DEFAULT_READING_WIDTH;
}

export function setReadingWidth(width: ReadingWidth): void {
  setSyncedPreference(READING_WIDTH_KEY, width);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function isValid(setting: InterfaceSetting, value: number): boolean {
  return Number.isInteger(value) && value >= setting.min && value <= setting.max;
}

export function getInterfaceSetting(setting: InterfaceSetting): number {
  const raw = localStorage.getItem(setting.key);
  const value = raw === null ? NaN : Number(raw);
  return isValid(setting, value) ? value : setting.defaultValue;
}

export function setInterfaceSetting(setting: InterfaceSetting, value: number): void {
  if (!isValid(setting, value)) return;
  setSyncedPreference(setting.key, String(value));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === READING_WIDTH_KEY || SETTINGS.some((setting) => setting.key === e.key)) {
      onChange();
    }
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useInterfaceSetting(setting: InterfaceSetting): number {
  return useSyncExternalStore(subscribe, () => getInterfaceSetting(setting));
}

export function useReadingWidth(): ReadingWidth {
  return useSyncExternalStore(subscribe, getReadingWidth);
}

/** Paints them onto this window. */
export function applyInterfaceSettings(): void {
  const style = document.documentElement.style;

  // Otter Code's appearanceContrast.ts: below 100 text fades toward its
  // surface and borders thin out; above it text goes toward black (white in
  // dark) and borders take on a quarter as much of the text color.
  const contrast = getInterfaceSetting(CONTRAST);
  style.setProperty("--appearance-contrast-base", `${Math.min(contrast, 100)}%`);
  style.setProperty("--appearance-contrast-boost", `${Math.max(contrast - 100, 0)}%`);
  style.setProperty("--appearance-contrast-border-boost", `${Math.max(contrast - 100, 0) / 4}%`);

  const glass = getInterfaceSetting(GLASS_OPACITY);
  style.setProperty("--glass-opacity", `${glass}%`);
  // Solid glass has nothing to blur.
  if (glass === 100) style.setProperty("--glass-blur", "0px");
  else style.removeProperty("--glass-blur");

  style.fontSize = `${getInterfaceSetting(INTERFACE_FONT_SIZE)}px`;

  style.setProperty("--reading-width", READING_WIDTHS[getReadingWidth()].maxWidth);
}

/** Applies now and follows changes from this window, the others and other devices. */
export function startInterfaceSettings(): () => void {
  applyInterfaceSettings();
  return subscribe(applyInterfaceSettings);
}
