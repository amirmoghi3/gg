import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteProfileImage,
  fetchProfileImages,
  requestUploadUrl,
  saveProfileImage,
  setPrimaryImage,
  updateProfile,
  uploadFile
} from "../../../lib/api";
import { getCountries } from "../../../lib/countries";
import type { ProfileImage, UserProfile } from "../../../lib/types";
import { compressImage } from "../../../lib/utils";

type ProfilePanelProps = {
  token: string;
  user: UserProfile;
  onUserUpdate: (user: UserProfile) => void;
};

export function ProfilePanel({ token, user, onUserUpdate }: ProfilePanelProps) {
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [instagram, setInstagram] = useState(user.instagram ?? "");
  const [linkedin, setLinkedin] = useState(user.linkedin ?? "");
  const [country, setCountry] = useState(user.country ?? "");
  const [status, setStatus] = useState("");
  const [images, setImages] = useState<ProfileImage[]>([]);
  const [loading, setLoading] = useState(false);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const countries = useMemo(() => getCountries(), []);

  useEffect(() => {
    void refreshImages();
  }, []);

  const refreshImages = async () => {
    const data = await fetchProfileImages(token);
    if (!data) return;
    setImages(data);
  };

  const handleSave = async () => {
    setStatus("Saving...");
    const updated = await updateProfile(token, {
      nickname: nickname.trim(),
      bio: bio.trim(),
      avatarUrl: user.avatarUrl,
      instagram: instagram.trim(),
      linkedin: linkedin.trim(),
      country
    });
    if (!updated) {
      setStatus("Save failed.");
      return;
    }
    onUserUpdate(updated);
    setStatus("Saved.");
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    setStatus("Uploading...");
    const list = Array.from(files);
    for (const file of list) {
      if (file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif")) {
        setStatus("GIF is not supported.");
        setLoading(false);
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setStatus("Each image must be under 10MB.");
        setLoading(false);
        return;
      }
      const compressed = await compressImage(file);
      if (!compressed) {
        setStatus("Image compression failed.");
        setLoading(false);
        return;
      }
      const uploadResult = await requestUploadUrl(token, compressed.name, compressed.type);
      if (!uploadResult) {
        setStatus("Upload failed.");
        setLoading(false);
        return;
      }
      const ok = await uploadFile(uploadResult.uploadUrl, compressed);
      if (!ok) {
        setStatus("Upload failed.");
        setLoading(false);
        return;
      }
      await saveProfileImage(token, uploadResult.publicUrl);
    }
    await refreshImages();
    setStatus("Upload complete.");
    setLoading(false);
    if (uploadRef.current) uploadRef.current.value = "";
  };

  const handleSetPrimary = async (image: ProfileImage) => {
    await setPrimaryImage(token, image.id);
    await refreshImages();
    const updated = await updateProfile(token, { avatarUrl: image.url });
    if (updated) {
      onUserUpdate(updated);
      window.dispatchEvent(
        new CustomEvent("gg:local-avatar-updated", { detail: { url: image.url } })
      );
    }
  };

  const handleDelete = async (image: ProfileImage) => {
    await deleteProfileImage(token, image.id);
    await refreshImages();
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-ink-800/80 p-6 text-white shadow-panel">
      <h2 className="text-xl font-semibold">Profile</h2>
      <div className="mt-4 grid gap-3">
        <input
          className="rounded-xl bg-white px-4 py-3 text-sm text-ink-900"
          placeholder="Nickname"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
        />
        <textarea
          className="min-h-[120px] rounded-xl bg-white px-4 py-3 text-sm text-ink-900"
          placeholder="Bio"
          value={bio}
          onChange={(event) => setBio(event.target.value)}
        />
        <input
          className="rounded-xl bg-white px-4 py-3 text-sm text-ink-900"
          placeholder="Instagram link"
          value={instagram}
          onChange={(event) => setInstagram(event.target.value)}
        />
        <input
          className="rounded-xl bg-white px-4 py-3 text-sm text-ink-900"
          placeholder="LinkedIn link"
          value={linkedin}
          onChange={(event) => setLinkedin(event.target.value)}
        />
        <select
          className="rounded-xl bg-white px-4 py-3 text-sm text-ink-900"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
        >
          <option value="">Select country</option>
          {countries.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        <div className="grid gap-3">
          <input
            ref={uploadRef}
            className="hidden"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => void handleUpload(event.target.files)}
          />
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Photos</div>
              <button
                className="rounded-lg bg-aura-400 px-3 py-1 text-xs font-semibold text-ink-900"
                onClick={() => uploadRef.current?.click()}
                disabled={loading}
              >
                Upload Images
              </button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
              {images.map((image) => (
                <div
                  key={image.id}
                  className={`rounded-xl border p-2 ${image.isPrimary ? "border-aura-400" : "border-white/10"}`}
                >
                  <img className="h-24 w-full rounded-lg object-cover" src={image.url} alt="" />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/80"
                      onClick={() => void handleSetPrimary(image)}
                    >
                      {image.isPrimary ? "Primary" : "Set Primary"}
                    </button>
                    <button
                      className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/60"
                      onClick={() => void handleDelete(image)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <button
          className="mt-2 w-fit rounded-xl bg-aura-400 px-4 py-2 text-sm font-semibold text-ink-900"
          onClick={() => void handleSave()}
        >
          Save Profile
        </button>
        <div className="text-xs text-white/60">{status}</div>
      </div>
    </div>
  );
}
