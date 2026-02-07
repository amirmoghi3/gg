import heic2any from "heic2any";

const STORE_IMAGE_BASE =
  ((import.meta as any).env?.VITE_STORE_IMAGE_BASE as string | undefined) ?? "";

export function resolveStoreImageUrl(url?: string | null) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const base = STORE_IMAGE_BASE.replace(/\/$/, "");
  const path = url.startsWith("/") ? url : `/${url}`;
  return base ? `${base}${path}` : url;
}

export function parseUser<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function formatRelative(timestamp: number) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatCooldown(ms: number) {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export async function compressImage(file: File) {
  let workingFile = file;
  if (isHeicFile(file)) {
    workingFile = await convertHeicToJpeg(file);
    if (!workingFile) {
      console.error("HEIC conversion failed", { name: file.name, size: file.size });
      return null;
    }
  }
  const img = document.createElement("img");
  const url = URL.createObjectURL(workingFile);
  try {
    const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = url;
    });
    const maxSize = 512;
    const ratio = Math.min(maxSize / loaded.width, maxSize / loaded.height, 1);
    const width = Math.round(loaded.width * ratio);
    const height = Math.round(loaded.height * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error("Image compression failed: missing 2D context", {
        name: file.name,
        type: file.type,
        size: file.size
      });
      return null;
    }
    ctx.drawImage(loaded, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8)
    );
    if (!blob) {
      console.error("Image compression failed: toBlob returned null", {
        name: file.name,
        type: file.type,
        size: file.size
      });
      return null;
    }
    if (blob.size > 10 * 1024 * 1024) {
      console.error("Image compression failed: result too large", {
        name: file.name,
        size: blob.size
      });
      return null;
    }
    return new File([blob], workingFile.name.replace(/\.\w+$/, ".jpg"), {
      type: "image/jpeg"
    });
  } catch (err) {
    console.error("Image compression failed", {
      name: workingFile.name,
      type: workingFile.type,
      size: workingFile.size,
      error: err
    });
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function isHeicFile(file: File) {
  const lower = file.name.toLowerCase();
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    lower.endsWith(".heic") ||
    lower.endsWith(".heif")
  );
}

async function convertHeicToJpeg(file: File): Promise<File | null> {
  try {
    const result = (await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.9
    })) as Blob | Blob[];
    const blob = Array.isArray(result) ? result[0] : result;
    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
      type: "image/jpeg"
    });
  } catch (err) {
    console.error("HEIC conversion error", err);
    return null;
  }
}
