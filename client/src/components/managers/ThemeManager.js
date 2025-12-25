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

        // Apply background style
        document.body.style.background = ThemeManager.currentThemeProperties.background || this.themeProperties.default.background;

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
}
