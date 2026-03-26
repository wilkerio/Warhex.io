//? Game Leaderboard 
// Menu Leaderboard is handled in UIManager
export default class Leaderboard {
    constructor(core) {
        this.core = core;
        this.players = [];
        this.currentPlayerScore = 0;
        this.container = document.getElementById("leaderboard-container");
        if (!this.container) {
            console.error("Leaderboard container not found!");
            return;
        }

        // Create leaderboard HTML
        this.leaderboardElement = document.createElement('div');
        this.leaderboardElement.classList.add('leaderboard');
        this.container.appendChild(this.leaderboardElement);

        // Store event listeners
        this.eventListeners = new Map();
    }

    removePlayer(playerId) {
        const playerIndex = this.players.findIndex(player => player.id === playerId);
        if (playerIndex !== -1) {
            this.players.splice(playerIndex, 1);

            if (this.eventListeners.has(playerId)) {
                const {
                    element,
                    listener
                } = this.eventListeners.get(playerId);
                element.removeEventListener('click', listener);
                this.eventListeners.delete(playerId);
            }

            this.renderEntries();
        }
    }

    clear() {
        this.players = [];
        this.currentPlayerScore = 0;

        this.eventListeners.forEach(({
            element,
            listener
        }) => {
            element.removeEventListener('click', listener);
        });
        this.eventListeners.clear();

        this.renderEntries();
    }

    parseScore(score) {
        if (score.fullValue !== null) {
            // If fullValue is provided, use it directly
            return score.fullValue;
        }

        let value = score.integerPart || 0; // Default to 0 if integerPart is missing

        if (score.unit === 'M') {
            // Million-scale: integerPart is in millions, fractionalPart is in ten-thousands
            value = value * 1000000 + (score.fractionalPart || 0) * 10000;
        } else if (score.unit === 'k') {
            // Thousand-scale: integerPart is in thousands, fractionalPart is in hundreds
            value = value * 1000 + (score.fractionalPart || 0) * 100;
        }

        return value;
    }

    formatScoreString(score) {
        if (score.fullValue !== null) {
            return score.fullValue.toString();
        }

        // Handle fractional part formatting
        let fractionalStr;
        if (score.fractionalPart !== null) {
            if (score.unit === 'M' && score.fractionalPart < 10) {
                // For million/thousand-scale, pad fractionalPart with a leading zero if < 10
                fractionalStr = `0${score.fractionalPart}`;
            } else {
                fractionalStr = score.fractionalPart.toString();
            }
        } else {
            fractionalStr = '0'; // Default to '0' if fractionalPart is missing
        }

        return `${score.integerPart}.${fractionalStr}${score.unit}`;
    }

    updateEntries(changes) {
        let needsUpdate = false;
        const currentPlayerId = this.core.gameManager.getCurrentPlayerId();

        // Update or add players based on changes
        changes.forEach(change => {
            const existingPlayer = this.players.find(player => player.id === change.playerId);
            const newScoreValue = this.parseScore(change.score);
            const formattedScore = this.formatScoreString(change.score);

            if (change.playerId === currentPlayerId) {
                this.currentPlayerScore = newScoreValue;
            }

            if (!existingPlayer || existingPlayer.parsedScore !== newScoreValue) {
                needsUpdate = true;

                if (existingPlayer) {
                    // Update existing player
                    existingPlayer.score = formattedScore;
                    existingPlayer.parsedScore = newScoreValue;
                } else {
                    // Add new player
                    this.players.push({
                        id: change.playerId,
                        name: this.core.gameManager.getPlayerById(change.playerId).name,
                        score: formattedScore,
                        parsedScore: newScoreValue
                    });
                }
            }
        });

        // If updates were made, sort all players and limit to top 10
        if (needsUpdate) {
            this.players.sort((a, b) => b.parsedScore - a.parsedScore); // Sort in descending order
            this.players = this.players.slice(0, 10); // Keep only the top 10 players
            this.renderEntries();
        }
    }

    getCurrentPlayerScore() {
        return this.currentPlayerScore || 0;
    }

    renderEntries() {
        // Preserve HUD collapse toggle injected by UIManager (renderEntries clears innerHTML).
        const collapseToggle = this.leaderboardElement.querySelector('.hud-collapse-toggle[data-hud-collapse="leaderboard"]');
        if (collapseToggle) collapseToggle.remove();

        this.leaderboardElement.innerHTML = '';

        this.eventListeners.forEach(({
            element,
            listener
        }) => {
            element.removeEventListener('click', listener);
        });
        this.eventListeners.clear();

        const title = document.createElement('h2');
        title.textContent = "Leaderboard";
        this.leaderboardElement.appendChild(title);

        const currentPlayerId = this.core.gameManager.getCurrentPlayerId();

        this.players.forEach((player, index) => {
            if (index === 9) return;

            const playerContainer = document.createElement('p');
            if (player.id === currentPlayerId) {
                playerContainer.classList.add('highlight');
            }

            const rankSpan = document.createElement('span');
            rankSpan.classList.add('rank');
            rankSpan.textContent = `${index + 1}.`;

            const nameSpan = document.createElement('span');
            nameSpan.classList.add('name');
            nameSpan.textContent = player.name;
            if (this.core?.networkManager?.isOwnerDisplayName?.(player.name)) {
                playerContainer.classList.add("owner-entry");
                nameSpan.classList.add("owner-name");
            }

            const onNameClick = () => {
                if (this.core?.uiManager?.tutorialActionMarks) {
                    this.core.uiManager.tutorialActionMarks.leaderboardNickAt = Date.now();
                }
                this.core.camera.setPosition(this.core.gameManager.getPlayerById(player.id).position, true);
            };

            nameSpan.addEventListener('click', onNameClick);
            this.eventListeners.set(player.id, {
                element: nameSpan,
                listener: onNameClick
            });

            const scoreSpan = document.createElement('span');
            scoreSpan.classList.add('score');
            scoreSpan.textContent = player.score;

            playerContainer.appendChild(rankSpan);
            playerContainer.appendChild(nameSpan);
            playerContainer.appendChild(scoreSpan);

            this.leaderboardElement.appendChild(playerContainer);
        });

        if (collapseToggle) {
            this.leaderboardElement.appendChild(collapseToggle);
        }

        this.core?.uiManager?.ensureHudCollapseControls?.();
        this.core?.uiManager?.applyHudCollapsedStates?.();
    }
}
