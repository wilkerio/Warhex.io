class AudioManager {
    constructor () {
        this.audioContext = new (window.AudioContext)();
        this.sounds = new Map(); // Map to store loaded sounds
        this.activeSources = new Map(); // Map to store active sound sources
    }

    async loadSound (key, url) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.sounds.set(key, audioBuffer);
    }

    playSound (key, loop = false, volume = 1.0) {
        if (!this.sounds.has(key)) {
            console.error(`Sound '${key}' not found.`);
            return null;
        }

        const soundBuffer = this.sounds.get(key);
        const source = this.audioContext.createBufferSource();
        source.buffer = soundBuffer;

        // Create a gain node for volume control
        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);

        source.connect(gainNode).connect(this.audioContext.destination);

        source.loop = loop;
        source.start();

        // Store the source and gain node for control
        this.activeSources.set(source, gainNode);

        // Return the source and gain node for additional control if needed
        return { source, gainNode };
    }

    setVolume (source, volume = 1.0) {
        const gainNode = this.activeSources.get(source);
        if (!gainNode) {
            console.error(`Source not found in active sources.`);
            return;
        }

        gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
    }

    stopSound (source) {
        if (!source) {
            console.error(`Invalid source node provided.`);
            return;
        }

        source.stop();
        this.activeSources.delete(source);
    }

    pauseAll () {
        this.audioContext.suspend();
    }

    resumeAll () {
        this.audioContext.resume();
    }
}

// Example usage:
// const audioManager = new AudioManager();
// await audioManager.loadSound('bullet', 'path/to/bullet.mp3');
// const { source, gainNode } = audioManager.playSound('bullet', false, 0.8); // Play at 80% volume
// audioManager.setVolume(source, 0.5); // Change the volume to 50%
// audioManager.stopSound(source); // Stop the bullet sound
// audioManager.pauseAll(); // Pause all sounds
