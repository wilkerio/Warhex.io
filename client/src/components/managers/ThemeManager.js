export default class ThemeManager {
    static currentTheme = 'universe'; // Static property to hold the current theme
    static currentThemeProperties = {}; // Static property to hold the current theme properties

    constructor() {
        this.themeProperties = {
            universe: {
                background: "#050010",
                lineColor: "#ffffff30",
                protectionColor: "#ff000040",
                selectionColor: "rgba(255, 255, 255, 0.15)",
                selectionStroke:  "rgba(255, 255, 255, 0.3)",
                darkColor: "#666666",
                outlineWidth: 8,
                lanePad: 20,
                backgroundColor: "#050010",
                outerColor: "rgba(0, 0, 0, 0.8)",
                indicatorColor: "rgba(255,255,255,0.65)",
                turretColor: "#a8a8a8",
                bulletColor: "#a8a8a8",
                redColor: "rgba(255, 0, 0, 0.6)",
                targetColor: "#b4b4b4",
            },
            nostalgia: {
                background: "#ffffff",
                lineColor: "#00000020",
                protectionColor: "#ff000020",
                selectionColor: "rgba(0, 0, 0, 0.1)",
                selectionStroke: "rgba(0, 0, 0, 0.2)",
                darkColor: "#666666",
                outlineWidth: 7,
                lanePad: 20,
                backgroundColor: "#ebebeb",
                outerColor: "#d6d6d6",
                indicatorColor: "rgba(0,0,0,0.08)",
                turretColor: "#A8A8A8",
                bulletColor: "#A8A8A8",
                redColor: "rgba(255, 0, 0, 0.1)",
                targetColor: "#b4b4b4",
            }
        };

        const savedTheme = localStorage.getItem('theme');
        const initialTheme = this.themeProperties[savedTheme] ? savedTheme : 'universe';
        this.applyTheme(initialTheme);
    }

    applyTheme(savedTheme) {
        ThemeManager.currentTheme = this.themeProperties[savedTheme] ? savedTheme : 'universe';
        localStorage.setItem('theme', ThemeManager.currentTheme);

        // Save the current theme properties
        ThemeManager.currentThemeProperties = this.themeProperties[ThemeManager.currentTheme];

        // Apply background style to root; body transparent when using canvas background
        document.documentElement.style.background = ThemeManager.currentThemeProperties.background;
        document.body.style.background = ThemeManager.currentTheme === 'universe' ? 'transparent' : ThemeManager.currentThemeProperties.background;

        // If universe theme, create animated canvas background; otherwise remove it
        if (ThemeManager.currentTheme === 'universe') {
            this._createUniverseBackground();
            this._removeNostalgiaOverrides();
        } else {
            this._removeUniverseBackground();
            if (ThemeManager.currentTheme === 'nostalgia') {
                this._applyNostalgiaOverrides();
            } else {
                this._removeNostalgiaOverrides();
            }
        }

        this._updateTextColors();
    }

    _updateTextColors() {
        const changelogElement = document.getElementById('changelog');
        const metricsElement = document.getElementById('game-metrics');

        if (!changelogElement || !metricsElement) return;
        if (ThemeManager.currentTheme === 'nostalgia') {
            changelogElement.style.color = '#000000';
            metricsElement.style.color = '#000000';
            return;
        }
        changelogElement.style.color = 'white';
        metricsElement.style.color = 'white';
    }

    _createUniverseBackground() {
        // avoid duplicate
        this._removeUniverseBackground();

        // Clean up any old tiled star element that may cause grid artifacts
        const oldStars = document.getElementById('universe-stars');
        if (oldStars) oldStars.remove();

        const c = document.createElement('canvas');
        c.id = 'bg';
        c.style.position = 'fixed';
        c.style.inset = '0';
        c.style.zIndex = '-1';
        c.style.pointerEvents = 'none';
        document.body.appendChild(c);
        const x = c.getContext('2d');

        // Ajusta o tamanho do canvas
        const resize = () => {
            c.width = innerWidth;
            c.height = innerHeight;
        };
        resize();
        this._universeResize = resize;
        addEventListener('resize', resize);

        // Partículas do fundo
        const p = Array.from({ length: 700 }, () => ({
            a: Math.random() * Math.PI * 2,
            d: Math.random() * Math.max(300, Math.max(innerWidth, innerHeight)),
            s: Math.random() * 0.002 + 0.001,
            jitterX: 0,
            jitterY: 0
        }));

        // Apply jitter once if removeGrid is enabled
        const removeGrid = localStorage.getItem('removeGrid') === 'true';
        if (removeGrid) {
            p.forEach(e => {
                e.jitterX = (Math.random() - 0.5) * 30;
                e.jitterY = (Math.random() - 0.5) * 30;
            });
        }

        let t = 0;
        const loop = () => {
            t += 0.45;

            x.clearRect(0, 0, c.width, c.height);

            p.forEach(e => {
                x.fillStyle = 'rgba(180,160,255,0.75)';
                const baseX = c.width / 2 + Math.cos(e.a + t * e.s) * e.d;
                const baseY = c.height / 2 + Math.sin(e.a + t * e.s) * e.d * 0.55;
                x.fillRect(
                    baseX + e.jitterX,
                    baseY + e.jitterY,
                    1.0,
                    1.0
                );
            });

            this._universeRAF = requestAnimationFrame(loop);
        };
        loop();
    }

    _removeUniverseBackground() {
        if (this._universeRAF) {
            cancelAnimationFrame(this._universeRAF);
            this._universeRAF = null;
        }
        if (this._universeResize) {
            removeEventListener('resize', this._universeResize);
            this._universeResize = null;
        }
        const existing = document.getElementById('bg');
        if (existing) existing.remove();
        const oldStars = document.getElementById('universe-stars');
        if (oldStars) oldStars.remove();
    }

    _applyNostalgiaOverrides() {
        this._removeNostalgiaOverrides();
        const style = document.createElement('style');
        style.id = 'nostalgia-theme-style';
        style.textContent = `
@font-face {
    font-family: 'regularF';
    src: url("/web/20230512025609im_/http://bloble.io/css/fonts/regular.ttf");
}

html, body {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    -khtml-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
}

body {
    margin: 0;
    overflow: hidden;
    background: #fff !important;
    color: #000;
    font-family: 'regularF', 'Ubuntu', 'Trebuchet MS', sans-serif;
}

canvas {
    image-rendering: optimizeSpeed;
    image-rendering: -moz-crisp-edges;
    image-rendering: -webkit-optimize-contrast;
    image-rendering: -o-crisp-edges;
    image-rendering: crisp-edges;
    -ms-interpolation-mode: nearest-neighbor;
}

a:link, a:visited, .spanLink { color: #60c1ff; text-decoration: none; }
a:hover, .spanLink:hover { color: #ff6060; }

/* HUD panels */
#leaderboard-container .leaderboard,
#chat,
#resource-container,
#power,
#shield,
#upgrade-container,
#upgrade-list,
#upgrade-tabs,
#game-metrics {
    background-color: rgba(40, 40, 40, 0.5) !important;
    color: #fff !important;
    font-family: 'regularF', 'Ubuntu', 'Trebuchet MS', sans-serif !important;
    border-radius: 4px !important;
}

/* Chat details */
#chat .header,
#chat-messages,
#chat-message-input,
#chat-button,
#chat-suggestions-container,
.chat-suggestion-item {
    background-color: rgba(40, 40, 40, 0.5) !important;
    color: #fff !important;
    border-color: rgba(255, 255, 255, 0.2) !important;
    font-family: 'regularF', 'Ubuntu', 'Trebuchet MS', sans-serif !important;
}

#chat-message-input::placeholder {
    color: rgba(255, 255, 255, 0.65) !important;
}

/* Leaderboard rows */
#leaderboard-container .title,
#leaderboard-container .player,
#leaderboard-container .name,
#leaderboard-container .score {
    color: #fff !important;
    font-family: 'regularF', 'Ubuntu', 'Trebuchet MS', sans-serif !important;
}

/* Toolbar / controls */
#toolbar-container,
.toolbar-item,
.toolbar-item.disabled,
#destroy-button,
#unit-controls-container,
.unit-control-button {
    background-color: rgba(40, 40, 40, 0.5) !important;
    color: #fff !important;
    border-radius: 4px !important;
}

/* Settings / menu buttons */
#menu-button,
#menu-settings-button,
#game-settings-button,
.global-settings-button,
.settings,
.settings button,
.settings select,
.settings input {
    color: #fff !important;
    font-family: 'regularF', 'Ubuntu', 'Trebuchet MS', sans-serif !important;
}

.settings,
#menu-container .actions > button,
#play-button,
#guest-button {
    background-color: rgba(40, 40, 40, 0.5) !important;
    border-radius: 4px !important;
}

.toolbar-item,
.toolbar-item-active,
.toolbar-tab,
.menu-button,
.btn {
    border-radius: 4px !important;
}
`;
        document.head.appendChild(style);
    }

    _removeNostalgiaOverrides() {
        const style = document.getElementById('nostalgia-theme-style');
        if (style) style.remove();
    }
}
