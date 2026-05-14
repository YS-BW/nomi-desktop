import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export interface SystemNotificationInput {
  title: string;
  body: string;
  group?: string;
  key?: string;
}

let permissionDenied = false;

function canUseSystemNotifications(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.Notification !== "undefined" &&
    isTauri()
  );
}

function createNotificationId(key?: string): number | undefined {
  if (!key) {
    return undefined;
  }
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return Math.abs(hash || 1);
}

async function ensureNotificationPermission(): Promise<boolean> {
  if (!canUseSystemNotifications() || permissionDenied) {
    return false;
  }
  try {
    if (await isPermissionGranted()) {
      return true;
    }
    const permission = await requestPermission();
    const granted = permission === "granted";
    permissionDenied = !granted;
    return granted;
  } catch {
    permissionDenied = true;
    return false;
  }
}

export async function sendSystemNotification(input: SystemNotificationInput): Promise<boolean> {
  const granted = await ensureNotificationPermission();
  if (!granted) {
    return false;
  }
  try {
    sendNotification({
      id: createNotificationId(input.key),
      title: input.title,
      body: input.body,
      group: input.group,
      autoCancel: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function resetSystemNotificationPermissionCache() {
  permissionDenied = false;
}
