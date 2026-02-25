export default class ExitPromptManager {
    constructor(core) {
        this.core = core;
        this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
        window.addEventListener("beforeunload", this.handleBeforeUnload);
    }

    isGameplayActive() {
        return Boolean(this.core?.gameManager?.player && !this.core?.uiManager?.menuOpen);
    }

    formatSessionDuration(startTimestamp) {
        if (!startTimestamp) return "0m";

        const totalSeconds = Math.max(0, Math.floor((Date.now() - startTimestamp) / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
        if (minutes > 0) return `${minutes}m ${seconds}s`;
        return `${seconds}s`;
    }

    getCurrentPoints() {
        const leaderboardPoints = this.core?.leaderboard?.getCurrentPlayerScore?.();
        if (typeof leaderboardPoints === "number" && leaderboardPoints >= 0) {
            return leaderboardPoints;
        }
        return 0;
    }

    buildExitMessage() {
        const sessionTime = this.formatSessionDuration(this.core?.gameManager?.stats?.time);
        const points = this.getCurrentPoints();

        return [
            "Are you sure you want to leave Warhex.io?",
            "",
            "SESSION HIGHLIGHTS",
            `Time Played: ${sessionTime}`,
            `Points: ${points.toLocaleString("en-US")}`,
            "",
            "Your base is still standing. Stay and push your score higher."
        ].join("\n");
    }

    handleBeforeUnload(event) {
        if (!this.isGameplayActive()) return;

        const message = this.buildExitMessage();
        event.preventDefault();
        event.returnValue = message;
        return message;
    }
}

