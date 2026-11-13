import { downloadText, safeFileName } from "../export/download";
import { serializeSongFile, toSongFile, type SongFile } from "../export/json";
import { encodeShare } from "../export/url";
import { useStore } from "../state/store";

export function currentSongFile(): SongFile {
  const { songName, scaleId, tonic, song } = useStore.getState();
  return toSongFile({ name: songName, scaleId, tonic, song });
}

export function exportJson(): void {
  const file = currentSongFile();
  downloadText(serializeSongFile(file, true), `${safeFileName(file.name)}.chordplanner.json`, "application/json");
}

export async function shareUrl(): Promise<string> {
  return location.origin + location.pathname + location.search + (await encodeShare(currentSongFile()));
}
