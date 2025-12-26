export default class ThemeManager {
    static currentTheme = 'default'; // Static property to hold the current theme
    static currentThemeProperties = {}; // Static property to hold the current theme properties

    constructor() {
        this.themeProperties = {
            default: {
                background: "#fff",
                lineColor: "#00000020",
                protectionColor: "#ff000020",
                selectionColor: "rgba(0, 0, 0, 0.1)",
                selectionStroke:  "rgba(0, 0, 0, 0.2)",
            },
            dark: {
                background: "#202020",
                lineColor: "#ffffff20",
                protectionColor: "#ff000020",
                selectionColor: "rgba(255, 255, 255, 0.1)",
                selectionStroke:  "rgba(255, 255, 255, 0.2)",
            },
            midnight: {
                background: "radial-gradient(circle, rgba(11,75,107,1) 0%, rgba(7,12,20,1) 100%)",
                lineColor: "#ffffff20",
                protectionColor: "#ff00004d",
                selectionColor: "rgba(255, 255, 255, 0.1)",
                selectionStroke:  "rgba(255, 255, 255, 0.2)",
            },
            galactic: {
                background: "radial-gradient(circle, rgb(107 11 81) 0%, rgb(7, 12, 20) 100%)",
                lineColor: "#ffffff20",
                protectionColor: "#ff00004d",
                selectionColor: "rgba(255, 255, 255, 0.1)",
                selectionStroke:  "rgba(255, 255, 255, 0.2)",
            },
            grassy: {
                background: "#bce987",
                lineColor: "#00000020",
                protectionColor: "#ff000020",
                selectionColor: "rgba(0, 0, 0, 0.1)",
                selectionStroke:  "rgba(0, 0, 0, 0.2)",
            },
            sea: {
                background: "#89cbff",
                lineColor: "#00000020",
                protectionColor: "#ff000020",
                selectionColor: "rgba(0, 0, 0, 0.1)",
                selectionStroke:  "rgba(0, 0, 0, 0.2)",
            },
            desert: {
                background: "#ffe289",
                lineColor: "#00000020",
                protectionColor: "#ff000020",
                selectionColor: "rgba(0, 0, 0, 0.1)",
                selectionStroke:  "rgba(0, 0, 0, 0.2)",
            }
            ,
            universe: {
                background: "#050010",
                lineColor: "#ffffff30",
                protectionColor: "#ff000040",
                selectionColor: "rgba(255, 255, 255, 0.15)",
                selectionStroke:  "rgba(255, 255, 255, 0.3)",
            }
        };

        // Check for a saved theme in local storage
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            ThemeManager.currentTheme = savedTheme; // Set the static theme property
        }

        this.applyTheme(ThemeManager.currentTheme); // Apply the current theme
    }

    applyTheme(savedTheme) {
        ThemeManager.currentTheme = savedTheme || ThemeManager.currentTheme; // Use saved theme or current theme
        localStorage.setItem('theme', ThemeManager.currentTheme);

        // Save the current theme properties
        ThemeManager.currentThemeProperties = this.themeProperties[ThemeManager.currentTheme] || this.themeProperties.default;

        // Apply background style to root; body transparent when using canvas background
        document.documentElement.style.background = ThemeManager.currentThemeProperties.background || this.themeProperties.default.background;
        document.body.style.background = ThemeManager.currentTheme === 'universe' ? 'transparent' : ThemeManager.currentThemeProperties.background || this.themeProperties.default.background;

        // If universe theme, create animated canvas background; otherwise remove it
        if (ThemeManager.currentTheme === 'universe') {
            this._createUniverseBackground();
        } else {
            this._removeUniverseBackground();
        }

        this._updateTextColors();
    }

    _updateTextColors() {
        const changelogElement = document.getElementById('changelog');
        const metricsElement = document.getElementById('game-metrics');

        if (changelogElement && metricsElement) {
            if (ThemeManager.currentTheme === 'midnight' || ThemeManager.currentTheme === 'dark' || ThemeManager.currentTheme === 'galactic') {
                changelogElement.style.color = 'white';
                metricsElement.style.color = 'white';
            } else {
                changelogElement.style.color = 'black';
                metricsElement.style.color = 'black';
            }
        }
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
}
