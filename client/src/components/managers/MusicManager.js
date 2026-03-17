import { fetchGameMusicTracks } from "../../network/supabaseClient.js";

const MUSIC_VOLUME_KEY = "warhex_music_volume";
const MUSIC_MUTED_KEY = "warhex_music_muted";
const SILENT_WAV_DATA_URI = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export default class MusicManager {
    constructor (core) {
        this.core = core;
        this.audio = null;
        this.playlist = [];
        this.currentIndex = 0;
        this.userInteracted = false;
        this.loadingPromise = null;
        this.masterVolume = this.readStoredVolume();
        this.muted = this.readStoredMuted();
        this.autoplayUnlocked = false;
    }

    initialize () {
        this.ensureAudioElement();
        this.loadPlaylist()
            .then(() => {
                if (this.playlist.length > 0) {
                    const firstTrack = this.getCurrentTrack();
                    if (firstTrack?.url && !this.audio.src) {
                        this.audio.src = firstTrack.url;
                    }
                    console.log("MusicManager playlist loaded:", this.playlist.length, "tracks");
                } else {
                    console.warn("MusicManager playlist is empty.");
                }
                if (this.userInteracted) {
                    this.tryStartPlayback();
                }
            })
            .catch((error) => {
                console.warn("Music playlist init failed:", error);
            });
    }

    ensureAudioElement () {
        if (this.audio) return this.audio;
        const audio = new Audio();
        audio.preload = "auto";
        audio.loop = false;
        audio.addEventListener("ended", () => this.playNext());
        audio.addEventListener("error", () => this.playNext());
        this.audio = audio;
        this.applyVolume();
        return audio;
    }

    readStoredVolume () {
        try {
            const raw = Number(localStorage.getItem(MUSIC_VOLUME_KEY));
            if (Number.isFinite(raw)) {
                const normalized = Math.max(0, Math.min(1, raw));
                // Avoid silent startup due to stale 0-volume in storage.
                if (normalized <= 0.05) return 0.65;
                return normalized;
            }
        } catch {}
        return 0.65;
    }

    readStoredMuted () {
        // No mute UI yet; never start muted from stale storage value.
        return false;
    }

    persistAudioPrefs () {
        try {
            localStorage.setItem(MUSIC_VOLUME_KEY, String(this.masterVolume));
            localStorage.setItem(MUSIC_MUTED_KEY, this.muted ? "1" : "0");
        } catch {}
    }

    getCurrentTrack () {
        if (!Array.isArray(this.playlist) || this.playlist.length === 0) return null;
        if (this.currentIndex < 0 || this.currentIndex >= this.playlist.length) {
            this.currentIndex = 0;
        }
        return this.playlist[this.currentIndex] || null;
    }

    applyVolume () {
        if (!this.audio) return;
        const track = this.getCurrentTrack();
        const trackVolume = Math.max(0, Math.min(1, Number(track?.volume ?? 0.3) || 0.3));
        const targetVolume = this.muted ? 0 : Math.max(0, Math.min(1, this.masterVolume * trackVolume));
        this.audio.volume = targetVolume;
    }

    setMuted (muted) {
        this.muted = Boolean(muted);
        this.applyVolume();
        this.persistAudioPrefs();
    }

    setMasterVolume (volume) {
        this.masterVolume = Math.max(0, Math.min(1, Number(volume) || 0));
        this.applyVolume();
        this.persistAudioPrefs();
    }

    async loadPlaylist (force = false) {
        if (!force && this.playlist.length > 0) return this.playlist;
        if (this.loadingPromise) return this.loadingPromise;

        this.loadingPromise = (async () => {
            const result = await fetchGameMusicTracks(80);
            if (!result?.success) {
                console.warn("Could not fetch game music tracks:", result?.error || "unknown_error");
                return this.playlist;
            }
            const tracks = Array.isArray(result.data) ? result.data : [];
            this.playlist = tracks;
            if (this.currentIndex >= this.playlist.length) {
                this.currentIndex = 0;
            }
            if (this.playlist.length === 0) {
                console.warn("No active music tracks found.");
            }
            this.applyVolume();
            return this.playlist;
        })();

        try {
            return await this.loadingPromise;
        } finally {
            this.loadingPromise = null;
        }
    }

    async playTrackAt (index, autoPlay = true) {
        this.ensureAudioElement();
        if (this.playlist.length === 0) {
            await this.loadPlaylist();
        }
        if (this.playlist.length === 0) return false;

        const safeIndex = ((Number(index) || 0) % this.playlist.length + this.playlist.length) % this.playlist.length;
        this.currentIndex = safeIndex;
        const track = this.getCurrentTrack();
        if (!track?.url) return false;

        if (this.audio.src !== track.url) {
            this.audio.src = track.url;
        }
        this.audio.currentTime = 0;
        this.applyVolume();

        if (!autoPlay) return true;

        try {
            await this.audio.play();
            return true;
        } catch (error) {
            return false;
        }
    }

    async playNext () {
        if (!this.playlist.length) return false;
        const nextIndex = (this.currentIndex + 1) % this.playlist.length;
        return this.playTrackAt(nextIndex, true);
    }

    async tryStartPlayback () {
        if (!this.userInteracted) return false;
        this.ensureAudioElement();
        if (this.playlist.length === 0) {
            await this.loadPlaylist();
        }
        if (this.playlist.length === 0) return false;

        this.applyVolume();
        if (!this.audio.src) {
            return this.playTrackAt(this.currentIndex, true);
        }
        if (!this.audio.paused) return true;

        try {
            await this.audio.play();
            console.log("MusicManager playing:", this.getCurrentTrack()?.title || this.audio.src, "volume:", this.audio.volume);
            return true;
        } catch (error) {
            console.warn("MusicManager play blocked/failed:", error?.message || error);
            return false;
        }
    }

    async unlockAutoplay () {
        if (this.autoplayUnlocked) return true;
        this.ensureAudioElement();
        const previousSrc = this.audio.src;
        const previousMuted = this.audio.muted;
        const previousVolume = this.audio.volume;
        try {
            this.audio.src = SILENT_WAV_DATA_URI;
            this.audio.muted = true;
            this.audio.volume = 0;
            await this.audio.play();
            this.audio.pause();
            this.audio.currentTime = 0;
            this.autoplayUnlocked = true;
            return true;
        } catch (error) {
            return false;
        } finally {
            this.audio.muted = previousMuted;
            this.audio.volume = previousVolume;
            if (previousSrc) {
                this.audio.src = previousSrc;
            } else {
                this.audio.removeAttribute("src");
                this.audio.load();
            }
            this.applyVolume();
        }
    }

    async handleUserGestureStart () {
        this.userInteracted = true;
        if (this.masterVolume <= 0.05) {
            this.masterVolume = 0.65;
        }
        this.muted = false;
        this.applyVolume();
        this.persistAudioPrefs();
        await this.unlockAutoplay();
        await this.tryStartPlayback();
    }
}
